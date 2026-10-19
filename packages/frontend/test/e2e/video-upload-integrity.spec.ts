/*
 * 视频附件领域：通过真实浏览器、上传接口、存储文件与播放器验证媒体完整性。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { APIResponse, ConsoleMessage, FileChooser, Locator, Page, PlaywrightTestArgs, Request, Response, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import type { VideoCancellationResult } from './video-upload-harness.js';

/** 外部启动脚本提供的独立测试实例，不用于产品中的运行环境判断。 */
const BASE_URL: string = process.env.VIDEO_TEST_BASE_URL ?? 'http://localhost:61812';
/** 外部测试矩阵指定是否验证非安全 HTTP 下的原文件回退。 */
const INSECURE: boolean = process.env.VIDEO_TEST_INSECURE === '1';
/** 提交到测试目录的小型、真实音视频样本。 */
const FIXTURE_DIRECTORY: URL = new URL('./fixtures/video-upload/', import.meta.url);

/** ffprobe 对已下载存储文件返回的轨道事实。 */
type ProbeStream = {
	codec_type: string;
	codec_name?: string;
	width?: number;
	height?: number;
};

/** 仅保留本次真实媒体验收使用的 ffprobe 输出字段。 */
type ProbeResult = {
	streams: ProbeStream[];
};

/** 不同样本应保留的音视频数量及文件字节关系。 */
type MediaExpectation = {
	videoTracks: number;
	audioTracks: number;
	matchesOriginal: boolean;
};

/** 浏览器实际消费视频后的可观察结果，不以时间轴移动代替画面解码。 */
type PlaybackEvidence = {
	currentTime: number;
	width: number;
	height: number;
	decodedFrames: number;
	error: string | null;
};

/** 音频预览进入 lightbox 后的真实解码和播放事实。 */
type AudioPlaybackEvidence = {
	currentTime: number;
	duration: number;
	source: string;
	decodedBytes: number | null;
	error: string | null;
};

/** 仅存在于测试进程的真实测试账户凭据，不写入报告。 */
let admin: RegisteredUser;
/** 真实后端创建并签发令牌的普通用户。 */
let account: AccountWithToken;
/** 当前页面的未处理错误，完成后统一核对。 */
let pageErrors: string[];
/** 视频回退文案的缺键和缺参数日志同样属于失败，不能只监听 pageerror。 */
let fallbackLocaleErrors: string[];

/** 解析当前测试模块旁的真实媒体样本路径。 */
function fixturePath(name: string): string {
	return fileURLToPath(new URL(name, FIXTURE_DIRECTORY));
}

/** 对实际文件字节计算摘要，证明回退没有替换原始内容。 */
function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** 使用服务端签发的账户和指定语言启动真实前端，身份确认仍访问后端。 */
async function open(page: Page, lang: string = 'en-US'): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 使用现有账户和语言缓存协议完成测试登录。 */ (input: { user: AccountWithToken; lang: string }): void => {
		localStorage.setItem('account', JSON.stringify(input.user));
		localStorage.setItem('lang', input.lang);
	}, { user: account, lang });
	await page.goto(`${BASE_URL}/@video_user?ui=twitter`);
	await expect(page.getByTestId('twitter-sidebar')).toBeVisible();
	const isSecureContext: boolean = await page.evaluate(/** 以浏览器实际安全上下文证明本轮测试来源，不能只依赖启动参数。 */ (): boolean => window.isSecureContext);
	expect(isSecureContext).toBe(!INSECURE);
}

/** 通过侧栏与系统文件选择器向唯一发帖表单添加真实文件。 */
async function preparePost(page: Page, text: string, path: string): Promise<void> {
	await page.getByTestId('twitter-sidebar').getByTestId('open-post-form').click();
	await page.getByTestId('post-form-text').fill(text);
	let fallbackMessage: string | null = null;
	if (INSECURE) {
		const fallbackTemplate: unknown = await page.evaluate(/** 读取当前页面的原始字典，缺键不能通过格式化函数退化成测试期望值。 */ async (): Promise<unknown> => {
			const loadedModule: PerformanceEntry | undefined = performance.getEntriesByType('resource').find(
				/** 保留当前应用已加载模块的 HMR 身份，避免读取另一份本地化实例。 */
				(entry: PerformanceEntry): boolean => new URL(entry.name).pathname === '/vite/src/i18n.ts',
			);
			if (loadedModule === undefined) throw new Error('The application did not load its localization module before choosing the attachment.');
			const moduleUrl: string = loadedModule.name;
			const translations: typeof import('../../src/i18n.js') = await import(moduleUrl);
			return translations.i18n.locale._uploader.videoCompressionFallback;
		});
		expect(fallbackTemplate).toEqual(expect.any(String));
		if (typeof fallbackTemplate !== 'string') throw new Error('The video fallback locale entry must contain a message template.');
		expect(fallbackTemplate.trim()).not.toBe('');
		expect(fallbackTemplate).toContain('{name}');
		fallbackMessage = fallbackTemplate.split('{name}').join(basename(path));
	}
	const selected: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.locator('button:has(.ti-photo-plus)').click();
	await (await selected).setFiles(path);
	if (fallbackMessage !== null) {
		const fallbackToast: Locator = page.getByText(fallbackMessage, { exact: true });
		await expect(fallbackToast).toBeVisible({ timeout: 30_000 });
		await expect(fallbackToast).toContainText(basename(path));
		await expect(fallbackToast).not.toContainText('{name}');
		await expect(fallbackToast).not.toContainText('videoCompressionFallback');
	}
	await expect(page.getByTestId('post-form-submit')).toBeEnabled({ timeout: 30_000 });
}

/** 提交真实附件帖子，同时核对上传和发帖的服务端回执。 */
async function publishAttachment(page: Page, text: string, path: string): Promise<Misskey.entities.Note> {
	await preparePost(page, text, path);
	const uploaded: Promise<Response> = page.waitForResponse(
		/** 只有真实上传成功才进入存储文件验证。 */
		(response: Response): boolean => response.url().endsWith('/api/drive/files/create') && response.status() === 200,
	);
	const posted: Promise<Response> = page.waitForResponse(
		/** 使用真实帖子 ID 选择刚刚发布的卡片。 */
		(response: Response): boolean => response.url().endsWith('/api/notes/create') && response.status() === 200,
	);
	await page.getByTestId('post-form-submit').click();
	const file: Misskey.entities.DriveFile = await (await uploaded).json();
	const result: Misskey.Endpoints['notes/create']['res'] = await (await posted).json();
	expect(result.createdNote.files).toHaveLength(1);
	expect(result.createdNote.files?.[0].id).toBe(file.id);
	await expect(page.getByTestId('post-form-text')).toBeHidden();
	return result.createdNote;
}

/** 从真实帖子回执取得唯一附件，避免用本地构造对象替代服务器结果。 */
function onlyAttachment(note: Misskey.entities.Note): Misskey.entities.DriveFile {
	expect(note.files).toHaveLength(1);
	const file: Misskey.entities.DriveFile | undefined = note.files?.[0];
	if (file === undefined) throw new Error('The posted note did not contain its uploaded attachment.');
	return file;
}

/** 下载真实存储对象，验证其字节、轨道和后端缩略图，并保留脱敏的验收证据。 */
async function verifyStoredMedia(page: Page, file: Misskey.entities.DriveFile, originalPath: string, expected: MediaExpectation, testInfo: TestInfo): Promise<void> {
	const [original, response]: [Buffer, APIResponse] = await Promise.all([readFile(originalPath), page.request.get(file.url)]);
	expect(response.status()).toBe(200);
	const stored: Buffer = await response.body();
	expect(stored.byteLength).toBeGreaterThan(0);
	const originalHash: string = sha256(original);
	const storedHash: string = sha256(stored);
	if (expected.matchesOriginal) {
		expect(storedHash).toBe(originalHash);
	} else {
		expect(storedHash).not.toBe(originalHash);
	}

	const storedPath: string = testInfo.outputPath('stored-media.mp4');
	await writeFile(storedPath, stored);
	const probe: ProbeResult = JSON.parse(execFileSync('ffprobe', [
		'-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', storedPath,
	], { encoding: 'utf8', timeout: 30_000 }));
	const videoStreams: ProbeStream[] = probe.streams.filter(/** 统计实际存储文件的视频轨道。 */ (stream: ProbeStream): boolean => stream.codec_type === 'video');
	const audioStreams: ProbeStream[] = probe.streams.filter(/** 统计实际存储文件的音频轨道。 */ (stream: ProbeStream): boolean => stream.codec_type === 'audio');
	expect(videoStreams).toHaveLength(expected.videoTracks);
	expect(audioStreams).toHaveLength(expected.audioTracks);
	for (let index: number = 0; index < videoStreams.length; index++) {
		expect(videoStreams[index].width).toBeGreaterThan(0);
		expect(videoStreams[index].height).toBeGreaterThan(0);
	}

	if (expected.videoTracks > 0) {
		expect(file.type).toBe('video/mp4');
		const thumbnailUrl: string | null | undefined = file.thumbnailUrl;
		if (!thumbnailUrl) throw new Error('The backend did not generate a video thumbnail.');
		const thumbnail: APIResponse = await page.request.get(thumbnailUrl);
		expect(thumbnail.status()).toBe(200);
		expect(thumbnail.headers()['content-type']).toMatch(/^image\//);
		expect((await thumbnail.body()).byteLength).toBeGreaterThan(0);
	} else {
		expect(file.type).toBe('audio/mp4');
		expect(file.thumbnailUrl).toBeNull();
	}

	await testInfo.attach('stored-media-evidence', {
		body: JSON.stringify({ fileId: file.id, type: file.type, bytes: stored.byteLength, originalHash, storedHash, streams: probe.streams }, null, 2),
		contentType: 'application/json',
	});
}

/** 验证真实帖子缩略图已解码，再从现有播放入口确认视频实际产生画面帧。 */
async function verifyVideoPresentation(page: Page, note: Misskey.entities.Note, testInfo: TestInfo): Promise<void> {
	const file: Misskey.entities.DriveFile = onlyAttachment(note);
	const card: Locator = page.locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]`).first();
	await expect(card).toBeVisible();
	await expect.poll(/** 预览必须是目标附件的已加载图片，不能把头像加载成功当作视频预览成功。 */ async (): Promise<boolean> => {
		return card.locator('img').evaluateAll(/** 在真实 DOM 上检查目标缩略图的解码结果。 */ (images: HTMLImageElement[], thumbnailUrl: string | null | undefined): boolean => images.some(
			/** 只接受服务端为当前附件生成的缩略图。 */
			(image: HTMLImageElement): boolean => image.currentSrc === thumbnailUrl && image.complete && image.naturalWidth > 0,
		), file.thumbnailUrl);
	}).toBe(true);
	const previewPath: string = testInfo.outputPath('video-preview.png');
	await page.screenshot({ path: previewPath, animations: 'disabled' });
	await testInfo.attach('video-preview', { path: previewPath, contentType: 'image/png' });

	await card.locator('.ti-player-play').click();
	const player: Locator = page.locator('video').last();
	await expect(player).toBeVisible();
	await player.evaluate(/** 静音由测试播放器控制，画面仍由真实浏览器和文件解码。 */ async (video: HTMLVideoElement): Promise<void> => {
		video.muted = true;
		await video.play();
	});
	await expect.poll(/** 时间轴与解码帧必须同时前进。 */ async (): Promise<boolean> => player.evaluate(
		/** 直接读取浏览器媒体元素的播放结果。 */
		(video: HTMLVideoElement): boolean => video.currentTime > 0.3 && video.videoWidth > 0 && video.getVideoPlaybackQuality().totalVideoFrames > 0,
	)).toBe(true);
	const evidence: PlaybackEvidence = await player.evaluate(/** 保存可复核的实际播放事实。 */ (video: HTMLVideoElement): PlaybackEvidence => ({
		currentTime: video.currentTime,
		width: video.videoWidth,
		height: video.videoHeight,
		decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
		error: video.error?.message ?? null,
	}));
	expect(evidence.error).toBeNull();
	expect(evidence.height).toBeGreaterThan(0);
	expect(evidence.decodedFrames).toBeGreaterThan(0);
	const playbackPath: string = testInfo.outputPath('video-playback.png');
	await page.screenshot({ path: playbackPath, animations: 'disabled' });
	await testInfo.attach('video-playback', { path: playbackPath, contentType: 'image/png' });
	await testInfo.attach('video-playback-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
}

/** 通过原有通用上传弹窗上传文件，测试只在 sessionStorage 接收其公开 Promise 回执。 */
async function uploadThroughDialog(page: Page, path: string): Promise<Misskey.entities.DriveFile> {
	const bytes: Buffer = await readFile(path);
	const completionKey: string = 'video-upload-integrity-result';
	const failureKey: string = 'video-upload-integrity-error';
	await page.evaluate(/** 调用真实上传入口，不改写窗口对象或媒体实现。 */ async (input: { base64: string; completionKey: string; failureKey: string }): Promise<void> => {
		const loadedModule: PerformanceEntry | undefined = performance.getEntriesByType('resource').find(
			/** 保留真实应用使用的 HMR 查询参数，避免生成拥有独立弹窗数组的第二份模块。 */
			(entry: PerformanceEntry): boolean => new URL(entry.name).pathname === '/vite/src/os.ts',
		);
		if (loadedModule === undefined) throw new Error('The application did not load its os module before opening the uploader.');
		const moduleUrl: string = loadedModule.name;
		const os: typeof import('../../src/os.js') = await import(moduleUrl);
		const binary: string = atob(input.base64);
		const content: ArrayBuffer = new ArrayBuffer(binary.length);
		const view: Uint8Array = new Uint8Array(content);
		for (let index: number = 0; index < binary.length; index++) view[index] = binary.charCodeAt(index);
		const file: File = new File([content], 'video-audio.mp4', { type: 'video/mp4' });
		sessionStorage.removeItem(input.completionKey);
		sessionStorage.removeItem(input.failureKey);
		void os.launchUploader([file], { multiple: false }).then(
			/** 只保存公开上传结果，供测试读取服务端文件 ID。 */
			(files: Misskey.entities.DriveFile[]): void => { sessionStorage.setItem(input.completionKey, JSON.stringify(files)); },
		).catch(/** 消费失败并交给测试断言，不能产生未处理拒绝。 */ (error: unknown): void => {
			sessionStorage.setItem(input.failureKey, error instanceof Error ? error.message : String(error));
		});
	}, { base64: bytes.toString('base64'), completionKey, failureKey });
	const uploadButton: Locator = page.getByRole('button').filter({ has: page.locator('.ti-upload') });
	await expect(uploadButton).toHaveCount(1);
	await expect(uploadButton).toBeEnabled({ timeout: 30_000 });
	const uploaded: Promise<Response> = page.waitForResponse(
		/** 上传弹窗必须实际请求后端并获得成功回执。 */
		(response: Response): boolean => response.url().endsWith('/api/drive/files/create') && response.status() === 200,
	);
	await uploadButton.click();
	const file: Misskey.entities.DriveFile = await (await uploaded).json();
	await page.waitForFunction(/** 等待既有上传 Promise 真正结束。 */ (keys: { completionKey: string; failureKey: string }): boolean => sessionStorage.getItem(keys.completionKey) !== null || sessionStorage.getItem(keys.failureKey) !== null, { completionKey, failureKey });
	const failure: string | null = await page.evaluate(/** 读取脱敏的失败说明。 */ (key: string): string | null => sessionStorage.getItem(key), failureKey);
	expect(failure).toBeNull();
	const serialized: string | null = await page.evaluate(/** 读取原有弹窗返回的附件列表。 */ (key: string): string | null => sessionStorage.getItem(key), completionKey);
	if (serialized === null) throw new Error('The uploader dialog did not return its uploaded files.');
	const files: Misskey.entities.DriveFile[] = JSON.parse(serialized);
	expect(files).toHaveLength(1);
	expect(files[0].id).toBe(file.id);
	await expect(uploadButton).toBeHidden();
	return file;
}

test.beforeEach(/** 每个场景都在外部脚本启动的独立后端重建真实账户。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'video_admin', 'video-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'video_user', password: 'video-user-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	pageErrors = [];
	fallbackLocaleErrors = [];
	page.on('pageerror', /** 正常流程不得产生未处理的前端错误。 */ (error: Error): void => { pageErrors.push(error.message); });
	page.on('console', /** 仅将视频回退提示的本地化错误计入失败，允许预期的媒体压缩警告。 */ (message: ConsoleMessage): void => {
		if (message.type() !== 'error') return;
		const text: string = message.text();
		if (text.includes('videoCompressionFallback') && /^(Unexpected locale key|Missing locale parameters):/.test(text)) {
			fallbackLocaleErrors.push(text);
		}
	});
});

test.afterEach(/** 真实错误提示应被已有交互消费，而不是泄露为页面异常。 */ (): void => {
	expect(pageErrors).toEqual([]);
	expect(fallbackLocaleErrors).toEqual([]);
});

test('普通帖子的视频与音频完整保留，缩略图和播放画面均可见', /** 同一场景分别在安全和非安全测试来源执行。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const path: string = fixturePath('video-audio.mp4');
	await open(page);
	const note: Misskey.entities.Note = await publishAttachment(page, 'video with audio integrity', path);
	await verifyStoredMedia(page, onlyAttachment(note), path, { videoTracks: 1, audioTracks: 1, matchesOriginal: INSECURE }, testInfo);
	await verifyVideoPresentation(page, note, testInfo);
});

test('中文页面回退原视频时显示完整提示，并正常发布、预览和播放', /** 中文继承的提示必须在真实非安全来源完成原片上传，不能只验证英文新页面。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	test.skip(!INSECURE, 'This scenario verifies the localized original-file fallback on the insecure HTTP test origin.');
	const path: string = fixturePath('video-audio.mp4');
	await open(page, 'zh-CN');
	const note: Misskey.entities.Note = await publishAttachment(page, '中文视频原文件回退验收', path);
	await verifyStoredMedia(page, onlyAttachment(note), path, { videoTracks: 1, audioTracks: 1, matchesOriginal: true }, testInfo);
	await verifyVideoPresentation(page, note, testInfo);
});

test('无声视频仍保留视频轨并能够预览和播放', /** 没有音频是合法输入，不能因此误判压缩失败。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const path: string = fixturePath('video-silent.mp4');
	await open(page);
	const note: Misskey.entities.Note = await publishAttachment(page, 'silent video integrity', path);
	await verifyStoredMedia(page, onlyAttachment(note), path, { videoTracks: 1, audioTracks: 0, matchesOriginal: INSECURE }, testInfo);
	await verifyVideoPresentation(page, note, testInfo);
});

test('通用上传弹窗交付的真实视频附件同样保持完整', /** 覆盖共享上传器的另一入口，不依赖发帖表单的就绪按钮保护。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const path: string = fixturePath('video-audio.mp4');
	await open(page);
	const file: Misskey.entities.DriveFile = await uploadThroughDialog(page, path);
	await verifyStoredMedia(page, file, path, { videoTracks: 1, audioTracks: 1, matchesOriginal: INSECURE }, testInfo);
	const result: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text: 'generic uploader video integrity', fileIds: [file.id] });
	await page.reload();
	await verifyVideoPresentation(page, result.createdNote, testInfo);
});

test('只有音频轨的 MP4 由真实后端识别为音频附件', /** 扩展名和上传时 MIME 不能把音频文件误展示为无画面视频。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const path: string = fixturePath('audio-only.mp4');
	await open(page);
	const note: Misskey.entities.Note = await publishAttachment(page, 'audio-only container classification', path);
	await verifyStoredMedia(page, onlyAttachment(note), path, { videoTracks: 0, audioTracks: 1, matchesOriginal: true }, testInfo);
	const card: Locator = page.locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]`).first();
	await expect(card).toBeVisible();
	const audioPreview: Locator = card.locator('div[role="button"]:has(.ti-music):has(svg)');
	await expect(audioPreview).toBeVisible();
	await expect(card.locator('video')).toHaveCount(0);
	const screenshotPath: string = testInfo.outputPath('audio-attachment.png');
	await page.screenshot({ path: screenshotPath, animations: 'disabled' });
	await testInfo.attach('audio-attachment', { path: screenshotPath, contentType: 'image/png' });

	await audioPreview.locator('.ti-player-play').click();
	const player: Locator = page.locator('audio').last();
	await expect(player).toBeAttached();
	await expect(page.locator('video')).toHaveCount(0);
	await expect.poll(/** 等待懒加载及既有跨域重载流程完成，再操作当前音频元素。 */ async (): Promise<boolean> => player.evaluate(
		/** 元数据就绪说明当前元素已完成有效媒体加载。 */
		(audio: HTMLAudioElement): boolean => audio.readyState >= HTMLMediaElement.HAVE_METADATA,
	)).toBe(true);
	await player.evaluate(/** lightbox 的音频元素懒加载，进入实际播放器后再要求解码与播放。 */ async (audio: HTMLAudioElement): Promise<void> => {
		audio.muted = true;
		await audio.play();
	});
	await expect.poll(/** 实际音频播放必须产生可观察的时间进展。 */ async (): Promise<boolean> => player.evaluate(
		/** 检查真实音频元素已拿到数据，且播放没有媒体错误。 */
		(audio: HTMLAudioElement): boolean => audio.currentTime > 0.3 && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && audio.error === null,
	)).toBe(true);
	const evidence: AudioPlaybackEvidence = await player.evaluate(/** 保留 Chromium 实际音频解码字节及目标媒体来源。 */ (audio: HTMLAudioElement): AudioPlaybackEvidence => ({
		currentTime: audio.currentTime,
		duration: audio.duration,
		source: audio.currentSrc,
		decodedBytes: 'webkitAudioDecodedByteCount' in audio && typeof audio.webkitAudioDecodedByteCount === 'number' ? audio.webkitAudioDecodedByteCount : null,
		error: audio.error?.message ?? null,
	}));
	expect(evidence.source).toBe(onlyAttachment(note).url);
	expect(evidence.duration).toBeGreaterThan(0);
	expect(evidence.decodedBytes).toBeGreaterThan(0);
	expect(evidence.error).toBeNull();
	const playbackPath: string = testInfo.outputPath('audio-playback.png');
	await page.screenshot({ path: playbackPath, animations: 'disabled' });
	await testInfo.attach('audio-playback', { path: playbackPath, contentType: 'image/png' });
	await testInfo.attach('audio-playback-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('真实预处理取消后明确重试仍上传完整视频，旧句柄和删除不会影响新任务', /** 通过实际 Vue 生命周期和上传 API 验证共享入口的任务隔离。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const path: string = fixturePath('video-audio.mp4');
	const bytes: Buffer = await readFile(path);
	await open(page);
	const result: VideoCancellationResult = await page.evaluate(/** 仅载入测试入口，其内部仍使用真实共享上传器与媒体转换。 */ async (base64: string): Promise<VideoCancellationResult> => {
		const moduleUrl: string = '/vite/test/e2e/video-upload-harness.ts';
		const harness: typeof import('./video-upload-harness.js') = await import(moduleUrl);
		const binary: string = atob(base64);
		const content: ArrayBuffer = new ArrayBuffer(binary.length);
		const view: Uint8Array = new Uint8Array(content);
		for (let index: number = 0; index < binary.length; index++) view[index] = binary.charCodeAt(index);
		const file: File = new File([content], 'video-audio.mp4', { type: 'video/mp4' });
		return harness.exerciseVideoCancellation(file);
	}, bytes.toString('base64'));
	expect(result.abortedBeforeRetry).toBe(true);
	expect(result.clearedBeforeRetry).toBe(true);
	expect(result.uploadedEvents).toBe(1);
	expect(result.retainedOtherItem).toBe(true);
	expect(result.itemsAfterDispose).toBe(0);
	await verifyStoredMedia(page, result.uploaded, path, { videoTracks: 1, audioTracks: 1, matchesOriginal: INSECURE }, testInfo);
});

test('非安全 HTTP 回退原片后继续执行真实大小限制，超限不上传也不发帖', /** 使用真实策略和合法大文件，不伪造上传或发帖响应。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	test.skip(!INSECURE, 'This scenario verifies original-file fallback on the insecure HTTP test origin.');
	const path: string = testInfo.outputPath('video-over-limit.mp4');
	execFileSync('ffmpeg', [
		'-hide_banner', '-loglevel', 'error', '-y',
		'-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
		'-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
		'-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0',
		'-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path,
	], { timeout: 30_000 });
	expect((await stat(path)).size).toBeGreaterThan(1024 * 1024);
	await api(BASE_URL, 'admin/roles/update-default-policies', { i: admin.token, policies: { maxFileSizeMb: 1 } });
	try {
		await expect.poll(/** 先确认后端已应用真实权限策略。 */ async (): Promise<number> => {
			const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
			return me.policies.maxFileSizeMb;
		}).toBe(1);
		await open(page);
		await expect.poll(/** 前端必须从真实登录结果读到同一限制。 */ async (): Promise<number | undefined> => page.evaluate(
			/** 读取现有账户模块的权限，不向产品注入测试状态。 */
			async (): Promise<number | undefined> => {
				const moduleUrl: string = '/vite/src/i.ts';
				const identity: typeof import('../../src/i.js') = await import(moduleUrl);
				return identity.$i?.policies.maxFileSizeMb;
			},
		)).toBe(1);
		let uploads: number = 0;
		let posts: number = 0;
		page.on('request', /** 只记录写请求数量，不读取或输出令牌和请求体。 */ (request: Request): void => {
			if (request.url().endsWith('/api/drive/files/create')) uploads++;
			if (request.url().endsWith('/api/notes/create')) posts++;
		});
		const text: string = 'oversized original must remain unposted';
		await preparePost(page, text, path);
		await page.getByTestId('post-form-submit').click();
		await expect(page.getByTestId('modal-dialog-ok')).toBeVisible();
		const limitMessage: string = await page.evaluate(/** 读取现有本地化错误文案，避免硬编码另一套限制提示。 */ async (): Promise<string> => {
			const moduleUrl: string = '/vite/src/i18n.ts';
			const translations: typeof import('../../src/i18n.js') = await import(moduleUrl);
			return translations.i18n.ts.cannotUploadBecauseExceedsFileSizeLimit;
		});
		await expect(page.getByText(limitMessage, { exact: true })).toBeVisible();
		await page.getByTestId('modal-dialog-ok').click();
		await expect(page.getByTestId('post-form-text')).toHaveValue(text);
		await expect(page.getByTestId('post-form-submit')).toBeEnabled();
		const notes: Misskey.Endpoints['users/notes']['res'] = await api(BASE_URL, 'users/notes', { i: account.token, userId: account.id, limit: 10 });
		const files: Misskey.Endpoints['drive/files']['res'] = await api(BASE_URL, 'drive/files', { i: account.token, limit: 10 });
		expect(notes).toHaveLength(0);
		expect(files).toHaveLength(0);
		expect(uploads).toBe(0);
		expect(posts).toBe(0);
		const screenshotPath: string = testInfo.outputPath('oversized-original-kept.png');
		await page.screenshot({ path: screenshotPath, animations: 'disabled' });
		await testInfo.attach('oversized-original-kept', { path: screenshotPath, contentType: 'image/png' });
	} finally {
		await api(BASE_URL, 'admin/roles/update-default-policies', { i: admin.token, policies: {} });
	}
});
