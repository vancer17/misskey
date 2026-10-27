/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：文件上传底层传输。
 * 作用：把 XHR、multipart、取消与进度收敛为单次 Promise，不持有账户或业务状态。
 * 数据链：上层冻结的请求参数 → 原始 HTTP 响应 → SDK DriveFile；文件校验与提示由调用方处理。
 */
import type { entities } from 'misskey-js';

/** 上传参数；保留 Misskey 网盘文件字段，但不携带任何认证凭据。 */
export type DriveUploadOptions = {
	name?: string;
	folderId?: string | null;
	isSensitive?: boolean;
	caption?: string | null;
	/** 仅发布当前请求可计算的实际字节进度。 */
	onProgress?: (progress: { total: number; loaded: number }) => void;
	signal?: AbortSignal;
};

/** 同一次上传的等待结果与主动中止句柄。 */
export type DriveUploadHandle = {
	filePromise: Promise<entities.DriveFile>;
	/** 中止本次传输并结束等待，不删除服务端可能已创建的文件。 */
	abort: () => void;
};

/** 传输依赖由边界适配器提供，底层模块不解释认证方式。 */
export type DriveUploadRequest = {
	url: string;
	headers?: Readonly<Record<string, string>>;
	fields?: Readonly<Record<string, string>>;
	/** 允许外部传输实现替换，底层协议保持不变。 */
	createXhr?: () => XMLHttpRequest;
};

/** 用户取消或所属实例释放的上传回执，不代表服务端文件被删除。 */
export class UploadAbortedError extends Error {
	/** 创建可由现有上传 UI 识别的取消错误。 */
	constructor() {
		super('Upload aborted');
		this.name = 'UploadAbortedError';
	}
}

/** 非成功 HTTP 响应，交由业务提示或 BFF 错误映射解释。 */
export class DriveUploadHttpError extends Error {
	/** 保留真实 HTTP 状态和原始响应，不在底层推断账户失效。 */
	constructor(public readonly status: number, public readonly body: unknown) {
		super(`Upload failed: HTTP ${status}`);
		this.name = 'DriveUploadHttpError';
	}
}

/** 序列化文件并执行真实 XHR，所有终态只结算一次并移除事件监听。 */
export function createDriveUploadRequest(file: File | Blob, options: DriveUploadOptions, request: DriveUploadRequest): DriveUploadHandle {
	const xhr: XMLHttpRequest = request.createXhr?.() ?? new XMLHttpRequest();
	let cancel: () => void = /** 请求尚未开始时取消无需发送网络消息。 */ (): void => {};
	const filePromise: Promise<entities.DriveFile> = new Promise<entities.DriveFile>(
		/** 将浏览器传输事件映射到唯一文件回执。 */
		(resolve: (file: entities.DriveFile) => void, reject: (reason?: unknown) => void): void => {
			let settled: boolean = false;

			/** 清理当前请求，拒绝迟到事件继续发布进度和文件。 */
			function finish(): boolean {
				if (settled) return false;
				settled = true;
				options.signal?.removeEventListener('abort', cancel);
				xhr.onload = null;
				xhr.onerror = null;
				xhr.onabort = null;
				xhr.ontimeout = null;
				xhr.upload.onprogress = null;
				return true;
			}

			/** 任意失败均终结同一次请求，调用者决定如何展示。 */
			function fail(reason: unknown): void { if (finish()) reject(reason); }

			cancel = /** 同步终结等待并中止浏览器请求。 */ (): void => {
				if (settled) return;
				fail(new UploadAbortedError());
				xhr.abort();
			};
			if (options.signal?.aborted) { cancel(); return; }
			options.signal?.addEventListener('abort', cancel, { once: true });
			try {
				xhr.open('POST', request.url, true);
				for (const [name, value] of Object.entries(request.headers ?? {})) xhr.setRequestHeader(name, value);
				xhr.onerror = /** 网络故障不被解释为认证失效。 */ (): void => { fail(new Error('Upload network error')); };
				xhr.onabort = /** 浏览器主动中止沿用已有取消类型。 */ (): void => { fail(new UploadAbortedError()); };
				xhr.ontimeout = /** 浏览器超时不重发可能已经写入的文件。 */ (): void => { fail(new Error('Upload timed out')); };
				xhr.onload = /** 仅从真实响应发布文件；无效 JSON 明确拒绝。 */ (): void => {
					if (settled) return;
					try {
						let body: unknown = null;
						try {
							body = xhr.responseText.length > 0 ? JSON.parse(xhr.responseText) as unknown : null;
						} catch (error: unknown) {
							// 代理 HTML 错误页不属于文件协议；保留非成功 HTTP 状态并丢弃原文。
							if (xhr.status === 200) throw error;
						}
						if (xhr.status !== 200) { fail(new DriveUploadHttpError(xhr.status, body)); return; }
						if (body == null || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') throw new Error('Invalid upload response');
						if (finish()) resolve(body as entities.DriveFile);
					} catch (error: unknown) { fail(error); }
				};
				xhr.upload.onprogress = /** 只发布当前请求可计算的真实字节进度。 */ (event: ProgressEvent<EventTarget>): void => {
					if (!settled && event.lengthComputable) options.onProgress?.({ total: event.total, loaded: event.loaded });
				};
				const body: FormData = new FormData();
				for (const [name, value] of Object.entries(request.fields ?? {})) body.append(name, value);
				body.append('force', 'true');
				body.append('file', file);
				body.append('name', options.name ?? (file instanceof File ? file.name : 'untitled'));
				body.append('isSensitive', options.isSensitive ? 'true' : 'false');
				if (options.caption != null) body.append('comment', options.caption);
				if (options.folderId) body.append('folderId', options.folderId);
				xhr.send(body);
			} catch (error: unknown) { fail(error); }
		},
	);
	return { filePromise, abort: /** 取消该请求且不触及其他上传。 */ (): void => { cancel(); } };
}
