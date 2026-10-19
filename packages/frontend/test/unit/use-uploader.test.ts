/*
 * 共享附件上传测试领域：验证预处理、取消、重试与上传回调的任务归属和参数协议。
 * 使用真实 Vue 挂载与可控适配器响应；这些替身不作为媒体解码或真实后端行为的证据。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import type { App, WatchStopHandle } from 'vue';
import type { BrowserImageResizerConfigWithConvertedOutput } from '@misskey-dev/browser-image-resizer';
import { createApp, nextTick, watch } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUALITY_VERY_LOW } from 'mediabunny';
import { readAndCompressImage } from '@misskey-dev/browser-image-resizer';
import isAnimated from 'is-file-animated';
import { preferState } from '../setup.unit.js';
import type { UploaderItem } from '@/composables/use-uploader.js';
import type { CompressVideoOptions } from '@/utility/video-preprocessing/index.js';
import type { ensureSignin } from '@/i.js';
import type { MenuItem } from '@/types/menu.js';
import { useUploader } from '@/composables/use-uploader.js';
import { compressVideo } from '@/utility/video-preprocessing/index.js';
import { genId } from '@/utility/id.js';
import { uploadFile, UploadAbortedError } from '@/utility/drive.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

/** 登录替身只提供上传器读取的既有权限字段。 */
type SignedInFixture = {
	policies: Pick<ReturnType<typeof ensureSignin>['policies'], 'watermarkAvailable'>;
};

/** 限定上传器使用的 Blob 输出重载，避免测试工具只推断最后的画布输出重载。 */
type CompressImageToBlob = (
	image: Parameters<typeof readAndCompressImage>[0],
	config: Partial<BrowserImageResizerConfigWithConvertedOutput>,
) => Promise<Blob>;

vi.mock('@/i.js', /** 隔离登录持久层，仅提供上传器所需权限。 */ (): { ensureSignin: () => SignedInFixture } => ({
	/** 返回允许执行普通附件流程的登录上下文。 */
	ensureSignin: (): SignedInFixture => ({ policies: { watermarkAvailable: false } }),
}));

vi.mock('@/os.js', /** 记录回退提示，不创建真实弹窗。 */ (): Pick<typeof import('@/os.js'), 'toast'> => ({
	toast: vi.fn<typeof os.toast>(),
}));

vi.mock('@/utility/id.js', /** 让附件标识在每个用例中独立且确定。 */ (): Pick<typeof import('@/utility/id.js'), 'genId'> => ({
	genId: vi.fn<typeof genId>(),
}));

vi.mock('@/utility/video-preprocessing/index.js', /** 用可控响应验证媒体适配器的调用协议。 */ (): Pick<typeof import('@/utility/video-preprocessing/index.js'), 'compressVideo'> => ({
	compressVideo: vi.fn<typeof compressVideo>(),
}));

vi.mock('@misskey-dev/browser-image-resizer', /** 保留图片处理的异步边界以检查迟到提交。 */ (): { readAndCompressImage: CompressImageToBlob } => ({
	readAndCompressImage: vi.fn<CompressImageToBlob>(),
}));

vi.mock('is-file-animated', /** 避免将协议测试中的图片占位字节交给真实媒体解析器。 */ (): { default: typeof isAnimated } => ({
	default: vi.fn<typeof isAnimated>(),
}));

vi.mock('@/utility/isWebpSupported.js', /** 固定图片适配器的输出格式，不探测测试宿主。 */ (): Pick<typeof import('@/utility/isWebpSupported.js'), 'isWebpSupported'> => ({
	/** 返回本组协议测试使用的 WebP 能力。 */
	isWebpSupported: (): boolean => true,
}));

vi.mock('@/utility/lightbox.js', /** 隔离与本组上传协议无关的预览组件依赖。 */ (): Pick<typeof import('@/utility/lightbox.js'), 'isPreviewable' | 'getType'> => ({
	/** 本组用例不打开预览菜单。 */
	isPreviewable: (): boolean => false,
	/** 维持既有预览类型接口。 */
	getType: (): ReturnType<typeof import('@/utility/lightbox.js')['getType']> => 'video',
}));

vi.mock('@/utility/drive.js', /** 保留上传 Promise 与取消异常协议，不启动真实网络请求。 */ (): Pick<typeof import('@/utility/drive.js'), 'uploadFile' | 'UploadAbortedError'> => {
	/** 上传器与测试共同使用该模块导出的取消类型，避免加载网络模块的外围依赖。 */
	class MockUploadAbortedError extends Error {}

	return {
		uploadFile: vi.fn<typeof uploadFile>(),
		UploadAbortedError: MockUploadAbortedError,
	};
});

/** 外部异步操作的可控完成点，用于刻意制造取消后的迟到响应。 */
type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason: unknown) => void;
};

/** 记录调用方传入的权威视频参数及对应的独立异步响应。 */
type CompressionRequest = {
	file: Parameters<typeof compressVideo>[0];
	options: CompressVideoOptions;
	result: Deferred<Blob>;
};

/** 从既有上传函数派生请求记录，不复制上传接口定义。 */
type UploadRequest = {
	file: Parameters<typeof uploadFile>[0];
	options: NonNullable<Parameters<typeof uploadFile>[1]>;
	result: Deferred<Misskey.entities.DriveFile>;
	abort: ReturnType<typeof vi.fn<() => void>>;
};

/** 真实 Vue 宿主及其上传器，用于覆盖组件卸载时的释放协议。 */
type MountedUploader = {
	app: App;
	element: HTMLDivElement;
	uploader: ReturnType<typeof useUploader>;
};

/** 记录已调用的视频适配器操作。 */
const compressionRequests: CompressionRequest[] = [];
/** 通过赋值检查 Blob 重载确实属于原接口，并保留同一个运行时替身。 */
const readAndCompressImageBlob: CompressImageToBlob = readAndCompressImage;
/** 记录已调用的图片适配器操作。 */
const imageRequests: Deferred<Blob>[] = [];
/** 记录上传请求及其可控响应。 */
const uploadRequests: UploadRequest[] = [];
/** 记录视频回退文案的缺键和缺参数诊断，避免被预期媒体失败的日志替身吞掉。 */
const fallbackLocaleErrors: string[] = [];
/** 保存仍需卸载的真实 Vue 宿主。 */
const mountedUploaders: Set<MountedUploader> = new Set();
/** 记录仍有效的对象 URL 及其原始对象。 */
const objectUrls: Map<string, Blob | MediaSource> = new Map();
/** 保留浏览器 URL 构造能力，只替换对象 URL 的生命周期。 */
const NativeUrl: typeof URL = URL;
/** 仅恢复本文件替换的位图接口，不撤销公共 setup 安装的其他全局替身。 */
const nativeCreateImageBitmap: typeof createImageBitmap | undefined = globalThis.createImageBitmap;
let nextItemId: number = 0;
let createdObjectUrlCount: number = 0;

/** 创建由测试主动完成的 Promise，不强制替身遵循取消信号。 */
function createDeferred<T>(): Deferred<T> {
	let controls: Omit<Deferred<T>, 'promise'> | undefined;
	const promise: Promise<T> = new Promise<T>(
		/** 保存异步操作的完成接口，供迟到响应测试使用。 */
		(resolve: Deferred<T>['resolve'], reject: Deferred<T>['reject']): void => {
			controls = { resolve, reject };
		},
	);
	if (controls === undefined) throw new Error('Promise controls were not initialized.');
	return { promise, ...controls };
}

/** 取出已经观察到的请求，缺少请求时提供直接的测试错误。 */
function getEntry<T>(entries: readonly T[], index: number = 0): T {
	const entry: T | undefined = entries[index];
	if (entry === undefined) throw new Error(`Expected request at index ${index}.`);
	return entry;
}

/** 等待真实调用达到预期次数，避免猜测动态导入所需的微任务数量。 */
async function waitForCount<T>(entries: readonly T[], count: number): Promise<void> {
	await vi.waitFor(/** 请求数量由公共接口产生。 */ (): void => {
		expect(entries).toHaveLength(count);
	}, { timeout: 3000, interval: 5 });
}

/** 让已完成的 Promise 链和 Vue 更新走完，之后检查迟到回调没有副作用。 */
async function flushTasks(): Promise<void> {
	await new Promise<void>(/** 在下一事件循环检查本轮异步提交。 */ (resolve: () => void): void => {
		setTimeout(resolve, 0);
	});
	await nextTick();
}

/** 在真实 setup 生命周期中创建上传器，不替换 Vue 生命周期函数。 */
function mountUploader(): MountedUploader {
	const holder: Partial<Pick<MountedUploader, 'uploader'>> = {};
	const element: HTMLDivElement = document.createElement('div');
	document.body.appendChild(element);
	const app: App = createApp({
		/** 将组合函数绑定到真实宿主，并保持渲染树最小。 */
		setup: (): (() => null) => {
			holder.uploader = useUploader({ multiple: true });
			return /** 本测试只需要生命周期，不渲染业务界面。 */ (): null => null;
		},
	});
	app.mount(element);
	if (holder.uploader === undefined) throw new Error('Uploader was not initialized.');
	const mounted: MountedUploader = { app, element, uploader: holder.uploader };
	mountedUploaders.add(mounted);
	return mounted;
}

/** 卸载宿主一次，覆盖真实 dispose 路径并避免重复卸载警告。 */
function unmountUploader(mounted: MountedUploader): void {
	if (!mountedUploaders.delete(mounted)) return;
	mounted.app.unmount();
	mounted.element.remove();
}

/** 创建仅供上传参数协议使用的视频占位文件，不假定这些字节可以解码。 */
function createVideoFile(name: string = 'source.mov'): File {
	return new File(['original video bytes'], name, { type: 'video/quicktime' });
}

/** 创建可区分的压缩候选字节，只用于检查异步结果归属。 */
function createCandidate(value: string): Blob {
	return new Blob([value], { type: 'video/mp4' });
}

/** 按 misskey-js 的权威返回类型构造上传成功协议数据。 */
function createDriveFile(id: string = 'uploaded-file'): Misskey.entities.DriveFile {
	return {
		id,
		createdAt: '2026-10-18T00:00:00.000Z',
		name: 'source.mp4',
		type: 'video/mp4',
		md5: '00000000000000000000000000000000',
		size: 16,
		isSensitive: false,
		blurhash: null,
		properties: {},
		url: `https://example.invalid/files/${id}`,
		thumbnailUrl: null,
		comment: null,
		folderId: null,
		folder: null,
		userId: null,
		user: null,
	};
}

beforeEach(/** 重置适配器记录与用户偏好，避免请求或 URL 跨用例泄漏。 */ (): void => {
	vi.resetAllMocks();
	compressionRequests.length = 0;
	imageRequests.length = 0;
	uploadRequests.length = 0;
	fallbackLocaleErrors.length = 0;
	objectUrls.clear();
	nextItemId = 0;
	createdObjectUrlCount = 0;
	Object.assign(preferState, {
		keepOriginalFilename: true,
		defaultImageCompressionLevel: 2,
		defaultVideoCompressionLevel: 2,
		watermarkPresets: [],
		imageFramePresets: [],
		defaultWatermarkPresetId: null,
		uploadFolder: null,
	});
	vi.mocked(genId).mockImplementation(/** 生成本用例独立的附件标识。 */ (): string => `item-${++nextItemId}`);
	vi.mocked(isAnimated).mockResolvedValue(false);
	vi.mocked(compressVideo).mockImplementation(/** 记录完整的视频适配器调用，允许主动延迟完成。 */ (file: File, options: CompressVideoOptions): Promise<Blob> => {
		const result: Deferred<Blob> = createDeferred<Blob>();
		compressionRequests.push({ file, options, result });
		return result.promise;
	});
	vi.mocked(readAndCompressImageBlob).mockImplementation(/** 记录图片处理边界，不执行真实解码。 */ (): Promise<Blob> => {
		const result: Deferred<Blob> = createDeferred<Blob>();
		imageRequests.push(result);
		return result.promise;
	});
	vi.mocked(uploadFile).mockImplementation(/** 记录既有上传参数，允许服务器响应在取消后到达。 */ (file: UploadRequest['file'], options: Parameters<typeof uploadFile>[1]): ReturnType<typeof uploadFile> => {
		if (options === undefined) throw new Error('Expected upload options.');
		const result: Deferred<Misskey.entities.DriveFile> = createDeferred<Misskey.entities.DriveFile>();
		const abort: UploadRequest['abort'] = vi.fn<() => void>();
		uploadRequests.push({ file, options, result, abort });
		return { filePromise: result.promise, abort };
	});
	vi.stubGlobal('createImageBitmap', vi.fn<typeof createImageBitmap>().mockResolvedValue({ width: 320, height: 180, close: vi.fn<() => void>() }));
	vi.stubGlobal('URL', class UploaderTestUrl extends NativeUrl {
		/** 记录当前 URL 指向的文件对象，不依赖宿主 Blob 实现。 */
		static override createObjectURL(object: Blob | MediaSource): string {
			const url: string = `blob:uploader-test/${++createdObjectUrlCount}`;
			objectUrls.set(url, object);
			return url;
		}

		/** 移除已释放的 URL，供取消和卸载回归检查。 */
		static override revokeObjectURL(url: string): void {
			objectUrls.delete(url);
		}
	});
	vi.spyOn(console, 'error').mockImplementation(/** 消费预期的媒体适配器错误，但保留视频回退文案的本地化失败。 */ (...args: unknown[]): void => {
		const message: unknown = args[0];
		if (typeof message === 'string' && message.includes('videoCompressionFallback') && /^(Unexpected locale key|Missing locale parameters):/.test(message)) {
			fallbackLocaleErrors.push(message);
		}
	});
});

afterEach(/** 先卸载正在运行的上传器，再恢复浏览器外围替身。 */ (): void => {
	for (const mounted of mountedUploaders) unmountUploader(mounted);
	vi.restoreAllMocks();
	vi.stubGlobal('URL', NativeUrl);
	vi.stubGlobal('createImageBitmap', nativeCreateImageBitmap);
	expect(fallbackLocaleErrors).toEqual([]);
});

describe('useUploader 的任务生命周期与上传协议', /** 只验证适配器调用和异步回调归属，不把替身视作真实媒体证据。 */ (): void => {
	it('直接上传等待预处理，重复调用复用批次并保留附件对象', /** 共享 API 自身必须等待完整候选结果。 */ async (): Promise<void> => {
		const { uploader }: MountedUploader = mountUploader();
		const original: File = createVideoFile();
		uploader.addFiles([original]);
		const item: UploaderItem = getEntry(uploader.items.value);
		await waitForCount(compressionRequests, 1);
		const first: Promise<void> = uploader.upload();
		const second: Promise<void> = uploader.upload();
		await flushTasks();
		expect(uploadRequests).toHaveLength(0);
		expect(uploader.items.value[0]).toBe(item);
		const candidate: Blob = createCandidate('current candidate');
		getEntry(compressionRequests).result.resolve(candidate);
		await waitForCount(uploadRequests, 1);
		expect(getEntry(uploadRequests).file).toBe(candidate);
		getEntry(uploadRequests).result.resolve(createDriveFile());
		await Promise.all([first, second]);
		expect(uploadRequests).toHaveLength(1);
		expect(item.file).toBe(original);
		expect(uploader.items.value[0]).toBe(item);
	});

	it('取消后显式重试使用新参数，旧预处理的进度和完成不能覆盖新任务', /** 刻意让已取消操作继续完成以验证提交门禁。 */ async (): Promise<void> => {
		const { uploader }: MountedUploader = mountUploader();
		uploader.addFiles([createVideoFile()]);
		const item: UploaderItem = getEntry(uploader.items.value);
		await waitForCount(compressionRequests, 1);
		const previousAbort: UploaderItem['abortPreprocess'] = item.abortPreprocess;
		expect(previousAbort).toBeTypeOf('function');
		const oldResult: Promise<unknown> = uploader.upload().catch(/** 提前接住预期取消，随后检查实际异常类型。 */ (error: unknown): unknown => error);
		uploader.abortAll();
		item.compressionLevel = 3;
		const retry: Promise<void> = uploader.upload();
		await waitForCount(compressionRequests, 2);
		const oldRequest: CompressionRequest = getEntry(compressionRequests);
		const currentRequest: CompressionRequest = getEntry(compressionRequests, 1);
		expect(oldRequest.options.signal.aborted).toBe(true);
		expect(currentRequest.options.bitrate).toBe(QUALITY_VERY_LOW);
		previousAbort?.();
		expect(currentRequest.options.signal.aborted).toBe(false);
		currentRequest.options.onProgress(0.3);
		oldRequest.options.onProgress(0.9);
		oldRequest.result.resolve(createCandidate('obsolete candidate'));
		await flushTasks();
		expect(item.preprocessing).toBe(true);
		expect(item.preprocessProgress).toBe(0.3);
		expect(item.preprocessedFile).toBeNull();
		expect(item.abortPreprocess).toBeTypeOf('function');
		expect(os.toast).not.toHaveBeenCalled();
		const candidate: Blob = createCandidate('retry candidate');
		currentRequest.result.resolve(candidate);
		await waitForCount(uploadRequests, 1);
		getEntry(uploadRequests).result.resolve(createDriveFile());
		await retry;
		expect(await oldResult).toBeInstanceOf(UploadAbortedError);
		expect(item.preprocessedFile).toBe(candidate);
		expect(item.preprocessing).toBe(false);
	});

	it('重试转换失败会清除旧压缩结果，并把原始文件交给既有上传接口', /** 验证失败回退恢复原文件、大小和名称，并交付含文件名的完整提示。 */ async (): Promise<void> => {
		const { uploader }: MountedUploader = mountUploader();
		const original: File = createVideoFile();
		const fallbackTemplate: unknown = i18n.locale._uploader.videoCompressionFallback;
		expect(fallbackTemplate).toBeTypeOf('string');
		if (typeof fallbackTemplate !== 'string') throw new Error('The video fallback locale entry must contain a message template.');
		expect(fallbackTemplate.trim()).not.toBe('');
		expect(fallbackTemplate).toContain('{name}');
		uploader.addFiles([original]);
		const item: UploaderItem = getEntry(uploader.items.value);
		await waitForCount(compressionRequests, 1);
		getEntry(compressionRequests).result.resolve(createCandidate('first candidate'));
		const first: Promise<void> = uploader.upload();
		await waitForCount(uploadRequests, 1);
		const firstFailure: Error = new Error('First upload failed.');
		const firstAssertion: Promise<void> = expect(first).rejects.toBe(firstFailure);
		getEntry(uploadRequests).result.reject(firstFailure);
		await firstAssertion;
		expect(item.compressedSize).not.toBeNull();
		const retry: Promise<void> = uploader.upload();
		await waitForCount(compressionRequests, 2);
		expect(item.preprocessedFile).toBeNull();
		expect(item.compressedSize).toBeNull();
		expect(item.suffix).toBe('');
		getEntry(compressionRequests, 1).result.reject(new Error('Required track was discarded.'));
		await waitForCount(uploadRequests, 2);
		const request: UploadRequest = getEntry(uploadRequests, 1);
		expect(request.file).toBe(original);
		expect(request.options.name).toBe(original.name);
		expect(item.compressedSize).toBeNull();
		expect(item.suffix).toBe('');
		expect(objectUrls.get(item.objectUrl)).toBe(original);
		expect(os.toast).toHaveBeenCalledTimes(1);
		const fallbackMessage: unknown = getEntry(vi.mocked(os.toast).mock.calls)[0];
		expect(fallbackMessage).toBeTypeOf('string');
		expect(fallbackMessage).toBe(fallbackTemplate.split('{name}').join(original.name));
		expect(fallbackMessage).toContain(original.name);
		expect(fallbackMessage).not.toContain('{name}');
		expect(fallbackMessage).not.toContain('videoCompressionFallback');
		request.result.resolve(createDriveFile());
		await retry;
	});

	it('重复删除与真实卸载后，图片和视频的迟到结果不会误删附件或创建预览 URL', /** 同时覆盖两种候选处理路径的释放协议。 */ async (): Promise<void> => {
		const mounted: MountedUploader = mountUploader();
		const originalImage: File = new File(['original image bytes'.repeat(4)], 'source.png', { type: 'image/png' });
		mounted.uploader.addFiles([createVideoFile(), originalImage]);
		await waitForCount(compressionRequests, 1);
		await waitForCount(imageRequests, 1);
		const removed: UploaderItem = getEntry(mounted.uploader.items.value);
		const survivor: UploaderItem = getEntry(mounted.uploader.items.value, 1);
		const survivorUrl: string = survivor.objectUrl;
		mounted.uploader.removeItem(removed);
		mounted.uploader.removeItem(removed);
		const removedUrl: string = removed.objectUrl;
		getEntry(compressionRequests).options.onProgress(0.8);
		getEntry(compressionRequests).result.resolve(createCandidate('removed candidate'));
		await flushTasks();
		expect(mounted.uploader.items.value).toHaveLength(1);
		expect(mounted.uploader.items.value[0]).toBe(survivor);
		expect(survivor.objectUrl).toBe(survivorUrl);
		expect(objectUrls.get(survivorUrl)).toBe(originalImage);
		expect(removed.objectUrl).toBe(removedUrl);
		unmountUploader(mounted);
		const countAfterUnmount: number = createdObjectUrlCount;
		getEntry(imageRequests).resolve(new File(['image'], 'candidate.webp', { type: 'image/webp' }));
		await flushTasks();
		expect(mounted.uploader.items.value).toHaveLength(0);
		expect(createdObjectUrlCount).toBe(countAfterUnmount);
		expect(objectUrls.size).toBe(0);
		expect(uploadRequests).toHaveLength(0);
	});

	it('旧上传迟到成功不会干扰重试，当前成功事件可立即移除附件', /** 覆盖网络回调归属以及帖子组件现有的同步移除协议。 */ async (): Promise<void> => {
		const { uploader }: MountedUploader = mountUploader();
		uploader.addFiles([createVideoFile()]);
		const item: UploaderItem = getEntry(uploader.items.value);
		await waitForCount(compressionRequests, 1);
		getEntry(compressionRequests).result.resolve(createCandidate('first candidate'));
		const oldResult: Promise<unknown> = uploader.upload().catch(/** 接住旧批次的预期取消，避免制造未处理拒绝。 */ (error: unknown): unknown => error);
		await waitForCount(uploadRequests, 1);
		const previousAbort: UploaderItem['abort'] = item.abort;
		expect(previousAbort).toBeTypeOf('function');
		uploader.abortAll();
		expect(getEntry(uploadRequests).abort).toHaveBeenCalledTimes(1);
		const retry: Promise<void> = uploader.upload();
		await waitForCount(compressionRequests, 2);
		getEntry(compressionRequests, 1).result.resolve(createCandidate('retry candidate'));
		await waitForCount(uploadRequests, 2);
		previousAbort?.();
		expect(getEntry(uploadRequests, 1).abort).not.toHaveBeenCalled();
		expect(item.aborted).toBe(false);
		const uploaded: UploaderItem[] = [];
		uploader.events.on('itemUploaded', /** 模拟既有发帖调用方在事件中立即移除成功附件。 */ (context: { item: UploaderItem }): void => {
			uploaded.push(context.item);
			uploader.removeItem(context.item);
		});
		getEntry(uploadRequests, 1).options.onProgress?.(new ProgressEvent('progress', { loaded: 3, total: 10 }));
		getEntry(uploadRequests).options.onProgress?.(new ProgressEvent('progress', { loaded: 9, total: 10 }));
		getEntry(uploadRequests).result.resolve(createDriveFile('obsolete-file'));
		await flushTasks();
		expect(await oldResult).toBeInstanceOf(UploadAbortedError);
		expect(item.uploading).toBe(true);
		expect(item.uploaded).toBeNull();
		expect(item.progress).toEqual({ value: 3, max: 10 });
		expect(uploaded).toHaveLength(0);
		getEntry(uploadRequests, 1).result.resolve(createDriveFile('current-file'));
		await retry;
		expect(uploaded).toEqual([item]);
		expect(item.uploaded?.id).toBe('current-file');
		expect(uploader.items.value).toHaveLength(0);
	});

	it('原文件上传被既有接口拒绝时，批次拒绝且不执行成功续链', /** 仅验证失败传播协议，实际大小限制另由真实环境验证。 */ async (): Promise<void> => {
		const { uploader }: MountedUploader = mountUploader();
		const original: File = createVideoFile();
		uploader.addFiles([original]);
		await waitForCount(compressionRequests, 1);
		getEntry(compressionRequests).result.reject(new Error('Compression unavailable.'));
		const successContinuation: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>();
		const result: Promise<void> = uploader.upload().then(successContinuation);
		await waitForCount(uploadRequests, 1);
		expect(getEntry(uploadRequests).file).toBe(original);
		const uploadFailure: Error = new Error('Original file exceeds the upload limit.');
		const assertion: Promise<void> = expect(result).rejects.toBe(uploadFailure);
		getEntry(uploadRequests).result.reject(uploadFailure);
		await assertion;
		expect(successContinuation).not.toHaveBeenCalled();
		expect(getEntry(uploader.items.value).uploaded).toBeNull();
		expect(getEntry(uploader.items.value).uploadFailed).toBe(true);
	});

	it('批次中追加附件时不能提前成功，剩余附件在下一次明确上传中完成', /** 成功出口必须覆盖当前附件集合，不能依赖调用方另行检查。 */ async (): Promise<void> => {
		const { uploader }: MountedUploader = mountUploader();
		uploader.events.on('itemUploaded', /** 沿用发帖调用方立即移除已上传附件的协议。 */ (context: { item: UploaderItem }): void => {
			uploader.removeItem(context.item);
		});
		uploader.addFiles([createVideoFile('first.mov')]);
		await waitForCount(compressionRequests, 1);
		getEntry(compressionRequests).result.resolve(createCandidate('first candidate'));
		const first: Promise<void> = uploader.upload();
		await waitForCount(uploadRequests, 1);
		const added: File = createVideoFile('added.mov');
		uploader.addFiles([added]);
		await waitForCount(compressionRequests, 2);
		const firstAssertion: Promise<void> = expect(first).rejects.toBeInstanceOf(UploadAbortedError);
		getEntry(uploadRequests).result.resolve(createDriveFile('first-file'));
		await firstAssertion;
		expect(uploadRequests).toHaveLength(1);
		expect(uploader.items.value).toHaveLength(1);
		expect(getEntry(uploader.items.value).file).toBe(added);
		expect(getEntry(uploader.items.value).uploaded).toBeNull();
		const candidate: Blob = createCandidate('added candidate');
		getEntry(compressionRequests, 1).result.resolve(candidate);
		await flushTasks();
		const retry: Promise<void> = uploader.upload();
		await waitForCount(uploadRequests, 2);
		expect(getEntry(uploadRequests, 1).file).toBe(candidate);
		getEntry(uploadRequests, 1).result.resolve(createDriveFile('added-file'));
		await retry;
		expect(uploader.items.value).toHaveLength(0);
	});

	it('其他单项提前上传后，全部成功触发的真实卸载不会被误判为批次取消', /** 复现通用上传弹窗的 deep watch 完成关闭顺序。 */ async (): Promise<void> => {
		const mounted: MountedUploader = mountUploader();
		const uploader: ReturnType<typeof useUploader> = mounted.uploader;
		uploader.addFiles([createVideoFile('first.mov'), createVideoFile('second.mov')]);
		await waitForCount(compressionRequests, 2);
		getEntry(compressionRequests).result.resolve(createCandidate('first candidate'));
		getEntry(compressionRequests, 1).result.resolve(createCandidate('second candidate'));
		await flushTasks();
		const completedIds: string[] = [];
		const stopWatching: WatchStopHandle = watch(uploader.items, /** 全部上传被确认后立即关闭，允许关闭先于批次 await 恢复。 */ (): void => {
			if (uploader.items.value.length === 0 || uploader.items.value.some(/** 完成条件使用既有上传事实。 */ (item: UploaderItem): boolean => item.uploaded == null)) return;
			for (const item of uploader.items.value) {
				if (item.uploaded != null) completedIds.push(item.uploaded.id);
			}
			unmountUploader(mounted);
		}, { deep: true });
		try {
			const batch: Promise<void> = uploader.upload();
			await waitForCount(uploadRequests, 1);
			const secondItem: UploaderItem = getEntry(uploader.items.value, 1);
			const menuItem: MenuItem | undefined = uploader.getMenu(secondItem).find(/** 通过现有菜单调用单项上传，不暴露私有实现。 */ (entry: MenuItem): boolean => {
				return entry !== null && typeof entry === 'object' && 'icon' in entry && entry.icon === 'ti ti-upload';
			});
			if (menuItem == null || typeof menuItem !== 'object' || !('action' in menuItem) || typeof menuItem.action !== 'function') {
				throw new Error('The per-item upload action was not available.');
			}
			menuItem.action(new PointerEvent('click'));
			await waitForCount(uploadRequests, 2);
			getEntry(uploadRequests, 1).result.resolve(createDriveFile('second-file'));
			await flushTasks();
			expect(secondItem.uploaded?.id).toBe('second-file');
			getEntry(uploadRequests).result.resolve(createDriveFile('first-file'));
			await expect(batch).resolves.toBeUndefined();
			expect(completedIds).toEqual(['first-file', 'second-file']);
			expect(uploader.items.value).toHaveLength(0);
			expect(mountedUploaders.has(mounted)).toBe(false);
		} finally {
			stopWatching();
		}
	});
});
