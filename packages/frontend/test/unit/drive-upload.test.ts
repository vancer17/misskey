/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：网盘上传传输适配器协议测试。
 * 作用：验证网络失败、取消和无效 JSON 均结束回执，且失效请求不再发布文件。
 * 数据链：受控 XHR 事件 → uploadFile → 拒绝或取消结果；不证明真实业务上传成功。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { uploadFile, UploadAbortedError } from '@/utility/drive.js';
import { globalEvents } from '@/events.js';

/** 直接从上传方法投影进度回调协议，不另行定义上传接口。 */
type UploadProgress = NonNullable<NonNullable<Parameters<typeof uploadFile>[1]>['onProgress']>;

/** 从拦截发送的真实调用上下文取得 XHR，测试不替换构造器或网络回执。 */
function currentRequest(): XMLHttpRequest {
	const current: unknown = vi.mocked(XMLHttpRequest.prototype.send).mock.contexts.at(-1);
	if (!(current instanceof XMLHttpRequest)) throw new Error('Expected upload request');
	return current;
}

vi.mock('@@/js/config.js', /** 为协议测试提供固定接口位置，send 被拦截而不访问网络。 */ (): { apiUrl: string } => ({ apiUrl: 'https://example.invalid/api' }));
vi.mock('@/os.js', /** 隔离提示组件，测试仅检查上传回执。 */ (): { alert: ReturnType<typeof vi.fn> } => ({ alert: vi.fn() }));
vi.mock('@/utility/misskey-api.js', /** 未调用的网盘选择辅助依赖不进入本套件。 */ (): { misskeyApi: ReturnType<typeof vi.fn> } => ({ misskeyApi: vi.fn() }));
vi.mock('@/stream.js', /** 上传传输不依赖网盘 URL 导入的流连接。 */ (): { useStream: ReturnType<typeof vi.fn> } => ({ useStream: vi.fn() }));
vi.mock('@/i18n.js', /** 保留提示读取接口，不把文案作为网络结果。 */ (): { i18n: { ts: Record<string, string> } } => ({ i18n: { ts: {} } }));
vi.mock('@/preferences.js', /** 不加载本地偏好存储；本套件不调用选择辅助函数。 */ (): { prefer: { s: Record<string, never> } } => ({ prefer: { s: {} } }));
vi.mock('@/i.js', /** 只提供构造上传请求需要的测试身份参数。 */ (): { $i: { token: string; policies: { maxFileSizeMb: number } } } => ({ $i: { token: 'upload-protocol-test', policies: { maxFileSizeMb: 1 } } }));
vi.mock('@/instance.js', /** 使用固定大小限制允许测试文件进入传输阶段。 */ (): { instance: { maxFileSize: number } } => ({ instance: { maxFileSize: 1024 } }));
vi.mock('@/events.js', /** 观察是否错误发布文件回执，不伪造成功文件。 */ (): { globalEvents: { emit: ReturnType<typeof vi.fn> } } => ({ globalEvents: { emit: vi.fn() } }));
vi.mock('@/utility/media-proxy.js', /** 未调用的图片裁剪依赖不进入本套件。 */ (): { getProxiedImageUrl: ReturnType<typeof vi.fn> } => ({ getProxiedImageUrl: vi.fn() }));
vi.mock('@/utility/id.js', /** 未调用的 URL 导入标记依赖不进入本套件。 */ (): { genId: ReturnType<typeof vi.fn> } => ({ genId: vi.fn() }));

describe('drive upload transport settlement', /** 只覆盖上传适配器终态与迟到回调。 */ (): void => {
	beforeEach(/** 捕获实际构造的 XHR，不发送任何测试网络请求。 */ (): void => {
		vi.clearAllMocks();
		vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(/** 保留真实传输对象，由用例触发协议事件。 */ (): void => {
			// 不发送网络请求，传输终态由当前用例控制。
		});
	});

	afterEach(/** 每个用例结束后恢复浏览器传输方法。 */ (): void => { vi.restoreAllMocks(); });

	it.each(['error', 'timeout'] as const)('rejects a transport %s event', /** 浏览器传输失败不能留下永不结束的文件 Promise。 */ async (eventName: 'error' | 'timeout'): Promise<void> => {
		const upload: ReturnType<typeof uploadFile> = uploadFile(new File(['frame'], 'frame.png', { type: 'image/png' }));
		const request: XMLHttpRequest = currentRequest();
		request.dispatchEvent(new ProgressEvent(eventName));
		await expect(upload.filePromise).rejects.toBeInstanceOf(Error);
		expect(globalEvents.emit).not.toHaveBeenCalled();
		expect(request.onload).toBeNull();
		expect(request.upload.onprogress).toBeNull();
	});

	it('keeps explicit cancellation distinct from failure', /** 调用公开取消句柄后交付既有取消错误。 */ async (): Promise<void> => {
		const upload: ReturnType<typeof uploadFile> = uploadFile(new File(['frame'], 'frame.png', { type: 'image/png' }));
		upload.abort();
		await expect(upload.filePromise).rejects.toBeInstanceOf(UploadAbortedError);
		expect(globalEvents.emit).not.toHaveBeenCalled();
	});

	it('settles a browser abort event', /** 浏览器自身中止也必须交付相同的取消回执。 */ async (): Promise<void> => {
		const upload: ReturnType<typeof uploadFile> = uploadFile(new File(['frame'], 'frame.png', { type: 'image/png' }));
		const request: XMLHttpRequest = currentRequest();
		request.dispatchEvent(new ProgressEvent('abort'));
		await expect(upload.filePromise).rejects.toBeInstanceOf(UploadAbortedError);
		expect(globalEvents.emit).not.toHaveBeenCalled();
	});

	it.each([200, 502])('rejects malformed JSON from HTTP %s', /** 成功或失败状态下的无效协议响应均应结束等待。 */ async (status: number): Promise<void> => {
		const upload: ReturnType<typeof uploadFile> = uploadFile(new File(['frame'], 'frame.png', { type: 'image/png' }));
		const request: XMLHttpRequest = currentRequest();
		Object.defineProperty(request, 'status', { value: status });
		Object.defineProperty(request, 'responseText', { value: '{invalid' });
		Object.defineProperty(request, 'response', { value: '{invalid' });
		request.dispatchEvent(new ProgressEvent('load'));
		await expect(upload.filePromise).rejects.toBeInstanceOf(SyntaxError);
		expect(globalEvents.emit).not.toHaveBeenCalled();
	});

	it('ignores a load callback already queued before cancellation', /** 取消前已排队的回调不得在取消后发布文件或覆盖终态。 */ async (): Promise<void> => {
		const onProgress: Mock<UploadProgress> = vi.fn<UploadProgress>();
		const upload: ReturnType<typeof uploadFile> = uploadFile(new File(['frame'], 'frame.png', { type: 'image/png' }), { onProgress });
		const request: XMLHttpRequest = currentRequest();
		const lateLoad: XMLHttpRequest['onload'] = request.onload;
		const lateProgress: XMLHttpRequestUpload['onprogress'] = request.upload.onprogress;
		upload.abort();
		await expect(upload.filePromise).rejects.toBeInstanceOf(UploadAbortedError);
		lateLoad?.call(request, new ProgressEvent('load'));
		lateProgress?.call(request, new ProgressEvent('progress', { lengthComputable: true, loaded: 1, total: 5 }));
		expect(globalEvents.emit).not.toHaveBeenCalled();
		expect(onProgress).not.toHaveBeenCalled();
	});
});
