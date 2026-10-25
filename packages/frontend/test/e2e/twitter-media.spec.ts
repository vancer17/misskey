/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 帖子附件展示的真实后端端到端验收。
 * 作用：以真实 PNG 上传、帖子与媒体解码验证自然比例、单行横滑及完整图库。
 * 数据链：隔离测试实例 → 云盘与帖子 API → 既有登录启动链 → DOM 几何和原生交互。
 * 边界：仅在专用测试实例调用 reset-db；不伪造业务响应或向产品注入附件状态。
 */
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { APIResponse, CDPSession, Locator, Page, PlaywrightTestArgs, Request, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 只保存在测试进程中的真实普通账户。 */
let account: AccountWithToken;
/** 当前浏览器收集的未处理执行异常。 */
let pageErrors: string[];

/** 上传夹具的原始像素尺寸；只用于产生合法图片和独立计算预期几何。 */
type ImageDimensions = Readonly<{
	width: number;
	height: number;
}>;

/** 真实 DOM 的只读测量投影，不参与应用业务决策。 */
type MediaGeometry = Readonly<{
	id: string;
	width: number;
	height: number;
	top: number;
	left: number;
	backgroundImage: string;
}>;

/** 压缩矩阵覆盖不同数量、窄屏和主题，避免对所有维度做无意义笛卡尔积。 */
type MediaScenario = Readonly<{
	count: number;
	viewportWidth: number;
	colorScheme: 'light' | 'dark';
}>;

/** 创建真实帖子，服务端返回的附件顺序始终是唯一事实。 */
async function createNote(text: string, files: readonly Misskey.entities.DriveFile[], replyId?: string): Promise<Misskey.entities.Note> {
	const result: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', {
		i: account.token,
		text,
		...(files.length === 0 ? {} : { fileIds: files.map(/** 只向请求传输已上传实体的标识。 */ (file: Misskey.entities.DriveFile): string => file.id) }),
		...(replyId === undefined ? {} : { replyId }),
	});
	return result.createdNote;
}

/** 使用浏览器真实 Canvas 编码 PNG；边框和条带便于人工检查裁切及留白。 */
async function uploadImage(page: Page, index: number, dimensions: ImageDimensions, sensitive: boolean = false): Promise<Misskey.entities.DriveFile> {
	const base64: string = await page.evaluate(/** 只生成测试文件字节，不接触应用状态。 */ (input: { index: number; dimensions: ImageDimensions }): string => {
		const canvas: HTMLCanvasElement = document.createElement('canvas');
		canvas.width = input.dimensions.width;
		canvas.height = input.dimensions.height;
		const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
		if (context === null) throw new Error('真实 Canvas 上下文不可用');
		context.fillStyle = `hsl(${input.index * 41 % 360} 45% 65%)`;
		context.fillRect(0, 0, canvas.width, canvas.height);
		if (input.index % 5 === 2) context.clearRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
		context.strokeStyle = '#152536';
		context.lineWidth = 8;
		context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
		context.fillStyle = '#152536';
		context.font = '24px sans-serif';
		context.fillText(`Media ${input.index}: ${canvas.width} × ${canvas.height}`, 16, 40);
		for (let row: number = 72; row < canvas.height; row += 64) context.fillRect(16, row, canvas.width - 32, 8);
		return canvas.toDataURL('image/png').split(',')[1];
	}, { index, dimensions });
	const response: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: {
			i: account.token,
			isSensitive: String(sensitive),
			file: { name: `adaptive-media-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') },
		},
	});
	expect(response.ok()).toBe(true);
	const file: Misskey.entities.DriveFile = await response.json();
	expect(file.properties.width).toBe(dimensions.width);
	expect(file.properties.height).toBe(dimensions.height);
	return file;
}

/** 顺序上传横图、竖图、方图、长截图与全景图，保证不同附件均有真实实体标识。 */
async function uploadImages(page: Page, count: number): Promise<Misskey.entities.DriveFile[]> {
	const dimensions: readonly ImageDimensions[] = [
		{ width: 640, height: 360 },
		{ width: 360, height: 640 },
		{ width: 480, height: 480 },
		{ width: 240, height: 1440 },
		{ width: 1440, height: 240 },
	];
	const files: Misskey.entities.DriveFile[] = [];
	for (let index: number = 0; index < count; index++) files.push(await uploadImage(page, index, dimensions[index % dimensions.length]));
	return files;
}

/** 以真实账户的持久化契约开启 Twitter 页面，等待主题与字体稳定后测量。 */
async function openTwitter(page: Page, path: string): Promise<void> {
	await page.goto(`${BASE_URL}${path}?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet]')).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await page.evaluate(/** 字体就绪后测量，避免用固定延迟猜测排版时机。 */ async (): Promise<void> => { await document.fonts.ready; });
}

/** 按实体标识定位帖子内的包装组件，避免把头像、引用附件或回复附件混入。 */
function noteMedia(page: Page, noteId: string, entry: 'twitter-note' | 'twitter-thread-note' = 'twitter-note'): Locator {
	return page.locator(`[data-testid="${entry}"][data-note-id="${noteId}"]`).first().getByTestId('twitter-note-media').first();
}

/** 直接从各附件根元素读取渲染尺寸和背景，保持断言独立于布局实现函数。 */
async function geometries(media: Locator): Promise<MediaGeometry[]> {
	return media.locator('[data-media-id]').evaluateAll(/** DOM 属性只作为验收证据，不写回领域对象。 */ (elements: HTMLElement[]): MediaGeometry[] => elements.map(
		/** 为单个真实附件采样 CSS 盒模型。 */
		(element: HTMLElement): MediaGeometry => {
			const rect: DOMRect = element.getBoundingClientRect();
			return {
				id: element.dataset.mediaId ?? '',
				width: rect.width,
				height: rect.height,
				top: rect.top,
				left: rect.left,
				backgroundImage: getComputedStyle(element).backgroundImage,
			};
		},
	));
}

/** 验证比例、上限、顶部对齐和附件间距，允许 CSS 子像素舍入的一像素误差。 */
async function expectAdaptiveGeometry(page: Page, media: Locator, files: readonly Misskey.entities.DriveFile[]): Promise<void> {
	const strip: Locator = media.getByTestId('media-strip');
	await expect(strip).toBeVisible();
	await expect(media.locator('[data-media-id]')).toHaveCount(files.length);
	const containerWidth: number = await strip.evaluate(/** 可用宽度来自实际滚动宿主。 */ (element: HTMLElement): number => element.clientWidth);
	const viewportHeight: number = await page.evaluate(/** svh 在没有移动浏览器工具栏的固定测试视口中等于实际内高。 */ (): number => window.innerHeight);
	const maxHeight: number = Math.min(379.5, viewportHeight * 0.5);
	await expect.poll(/** ResizeObserver 与资源就绪的结果必须收敛到真实文件比例。 */ async (): Promise<boolean> => {
		const sizes: MediaGeometry[] = await geometries(media);
		return sizes.length === files.length && sizes.every(/** 每项单独按原图计算，不能用第一项比例统一裁切。 */ (size: MediaGeometry, index: number): boolean => {
			const file: Misskey.entities.DriveFile = files[index];
			const width: number | undefined = file.properties.width;
			const height: number | undefined = file.properties.height;
			if (width === undefined || height === undefined) return false;
			const expectedWidth: number = Math.min(containerWidth, maxHeight * width / height);
			return Math.abs(size.width - expectedWidth) < 1.5 && Math.abs(size.height - expectedWidth * height / width) < 1.5;
		});
	}).toBe(true);
	const sizes: MediaGeometry[] = await geometries(media);
	for (let index: number = 0; index < sizes.length; index++) {
		const size: MediaGeometry = sizes[index];
		expect(size.id).toBe(files[index].id);
		expect(size.backgroundImage).toBe('none');
		expect(Math.abs(size.top - sizes[0].top)).toBeLessThan(1);
		expect(size.width).toBeLessThanOrEqual(containerWidth + 1);
		expect(size.height).toBeLessThanOrEqual(maxHeight + 1);
		if (index > 0) expect(Math.abs(size.left - sizes[index - 1].left - sizes[index - 1].width - 4)).toBeLessThan(1);
	}
	const pageOverflow: number = await page.evaluate(/** 横向溢出只属于媒体轨道，不能扩展文档宽度。 */ (): number => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(pageOverflow).toBeLessThanOrEqual(1);
}

/** 等待原生滚轮和滚动吸附连续十二帧稳定，避免把异步滚动误认为按钮已完成。 */
async function waitForScrollIdle(strip: Locator): Promise<void> {
	await strip.evaluate(/** 同步浏览器实际滚动位置，不依赖产品中的动画状态。 */ async (element: HTMLElement): Promise<void> => {
		await new Promise<void>(/** 只观测滚动，不改变当前目标位置。 */ (resolve: () => void): void => {
			let previous: number = element.scrollLeft;
			let stableFrames: number = 0;

			/** 触控惯性和吸附均结束后才继续后续交互。 */
			function sample(): void {
				stableFrames = Math.abs(element.scrollLeft - previous) < 0.1 ? stableFrames + 1 : 0;
				previous = element.scrollLeft;
				if (stableFrames >= 12) resolve();
				else requestAnimationFrame(sample);
			}

			requestAnimationFrame(sample);
		});
	});
}

/** 在横条首尾之间使用真实按钮滚动，验证边界状态与最后附件可达。 */
async function expectNavigation(page: Page, media: Locator, lastFile: Misskey.entities.DriveFile): Promise<void> {
	const strip: Locator = media.getByTestId('media-strip');
	const overflow: boolean = await strip.evaluate(/** 只有真实溢出才需要前后控件。 */ (element: HTMLElement): boolean => element.scrollWidth > element.clientWidth + 1);
	if (!overflow) {
		await expect(media.getByTestId('media-next')).toBeHidden();
		await expect(media.getByTestId('media-previous')).toBeHidden();
		return;
	}
	const originalUrl: string = page.url();
	await expect(media.getByTestId('media-previous')).toBeDisabled();
	await strip.hover();
	await page.mouse.wheel(240, 0);
	await expect.poll(/** 原生横向滚轮必须改变轨道位置。 */ async (): Promise<number> => strip.evaluate(
		/** 不通过组件实例或状态驱动滚动。 */ (element: HTMLElement): number => element.scrollLeft,
	)).toBeGreaterThan(0);
	await expect(page).toHaveURL(originalUrl);
	await waitForScrollIdle(strip);
	await media.getByTestId('media-previous').click();
	await waitForScrollIdle(strip);
	await expect(media.getByTestId('media-previous')).toBeDisabled();
	for (let attempt: number = 0; attempt < 20 && await media.getByTestId('media-next').isEnabled(); attempt++) {
		await media.getByTestId('media-next').click();
		await waitForScrollIdle(strip);
	}
	await expect(media.getByTestId('media-next')).toBeDisabled();
	await expect(media.locator(`[data-media-id="${lastFile.id}"]`)).toBeInViewport({ ratio: 0.9 });
	await expect(page).toHaveURL(originalUrl);
}

/** 单个完整图库按真实附件顺序响应键盘切换，并在关闭时恢复原页面。 */
async function expectGalleryOrder(page: Page, media: Locator, files: readonly Misskey.entities.DriveFile[]): Promise<void> {
	await media.getByTestId('media-strip').evaluate(/** 回到第一项后进行轻点，不以导航按钮打开图库。 */ (element: HTMLElement): void => { element.scrollTo({ left: 0, behavior: 'instant' }); });
	const originalUrl: string = page.url();
	await media.locator(`[data-media-id="${files[0].id}"] img`).last().click();
	await expect(page).toHaveURL(`${originalUrl}#pswp`);
	const lightbox: Locator = page.locator('div:has(> ._modalBg)').filter({ has: page.getByText(files[0].name, { exact: true }) });
	await expect(lightbox).toBeVisible();
	await expect(lightbox.getByText(files[0].name, { exact: true })).toBeInViewport();
	if (files.length > 1) {
		await page.keyboard.press('ArrowRight');
		await expect(lightbox.getByText(files[1].name, { exact: true })).toBeInViewport();
		await page.keyboard.press('ArrowLeft');
		await expect(lightbox.getByText(files[0].name, { exact: true })).toBeInViewport();
	}
	await page.keyboard.press('Escape');
	await expect(lightbox).toHaveCount(0);
	await expect(page).toHaveURL(originalUrl);
}

test.setTimeout(120_000);

test.beforeEach(/** 仅重建独立测试服务的数据，账号认证始终经过真实后端。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'media_admin', 'media-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'media_user', password: 'media-user-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	pageErrors = [];
	page.on('pageerror', /** 收集页面真实执行错误，不屏蔽媒体加载失败。 */ (error: Error): void => { pageErrors.push(error.message); });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 仅写入既有认证缓存；后续启动仍验证账户。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, account);
});

test.afterEach(/** 每个场景结束后确认没有未处理异常。 */ (): void => { expect(pageErrors).toEqual([]); });

for (const scenario of [
	{ count: 1, viewportWidth: 320, colorScheme: 'light' },
	{ count: 2, viewportWidth: 390, colorScheme: 'dark' },
	{ count: 5, viewportWidth: 1440, colorScheme: 'light' },
	{ count: 16, viewportWidth: 390, colorScheme: 'dark' },
] as const satisfies readonly MediaScenario[]) {
	test(`${scenario.count} 个真实附件在 ${scenario.viewportWidth}px ${scenario.colorScheme} 下按比例单行展示`, /** 数量矩阵走相同真实上传、布局和图库链路。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
		await page.setViewportSize({ width: scenario.viewportWidth, height: 900 });
		await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: 'reduce' });
		const files: Misskey.entities.DriveFile[] = await uploadImages(page, scenario.count);
		const note: Misskey.entities.Note = await createNote(`Adaptive media ${scenario.count}`, files);
		await openTwitter(page, '/@media_user');
		await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scenario.colorScheme);
		const media: Locator = noteMedia(page, note.id);
		await media.scrollIntoViewIfNeeded();
		await expectAdaptiveGeometry(page, media, files);
		await media.screenshot({ path: testInfo.outputPath('adaptive-media.png'), animations: 'disabled' });
		await expectNavigation(page, media, files[files.length - 1]);
		await expectGalleryOrder(page, media, files);
	});
}

test('详情与回复线程复用自然比例横条及完整附件图库', /** 同一后端附件分别经过详情入口和线程入口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const files: Misskey.entities.DriveFile[] = await uploadImages(page, 2);
	const root: Misskey.entities.Note = await createNote('Detail adaptive media root', files);
	const reply: Misskey.entities.Note = await createNote('Thread adaptive media reply', files, root.id);
	await openTwitter(page, `/notes/${root.id}`);
	const detail: Locator = page.getByTestId('twitter-note-detail').getByTestId('twitter-note-media').first();
	await expectAdaptiveGeometry(page, detail, files);
	await expectGalleryOrder(page, detail, files);
	const thread: Locator = noteMedia(page, reply.id, 'twitter-thread-note');
	await thread.scrollIntoViewIfNeeded();
	await expectAdaptiveGeometry(page, thread, files);
	await expectGalleryOrder(page, thread, files);
});

test('敏感隐藏与省流揭示继续复用既有权限及加载流程', /** 几何已知时不为测量绕过现有省流加载边界。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 900 });
	const sensitive: Misskey.entities.DriveFile = await uploadImage(page, 30, { width: 360, height: 640 }, true);
	const ordinary: Misskey.entities.DriveFile = await uploadImage(page, 31, { width: 640, height: 360 });
	const note: Misskey.entities.Note = await createNote('Sensitive and data saver media', [sensitive, ordinary]);
	await openTwitter(page, '/@media_user');
	let media: Locator = noteMedia(page, note.id);
	await media.scrollIntoViewIfNeeded();
	await expectAdaptiveGeometry(page, media, [sensitive, ordinary]);
	const hidden: Locator = media.locator(`[data-media-id="${sensitive.id}"]`);
	await expect(hidden.getByText('Click to show', { exact: true })).toBeVisible();
	await hidden.getByText('Click to show', { exact: true }).click();
	await expect(hidden.getByText('Click to show', { exact: true })).toBeHidden();
	await expect(page).toHaveURL(/\/@media_user\?ui=twitter$/);
	await page.evaluate(/** 经实际偏好管理器启用省流，由原持久化机制传递到重载。 */ async (): Promise<void> => {
		const resource: PerformanceEntry | undefined = performance.getEntriesByType('resource').find(
			/** 使用应用当前已加载的实例，保留真实 HMR 查询参数。 */
			(entry: PerformanceEntry): boolean => new URL(entry.name).pathname === '/vite/src/preferences.ts',
		);
		if (resource === undefined) throw new Error('未找到已加载的偏好模块');
		const preferences: typeof import('../../src/preferences.js') = await import(resource.name);
		preferences.prefer.commit('dataSaver', { ...preferences.prefer.s.dataSaver, media: true });
	});
	const mediaRequests: string[] = [];
	const sourceUrls: Set<string> = new Set([sensitive.url, sensitive.thumbnailUrl, ordinary.url, ordinary.thumbnailUrl].filter(
		/** 仅监控后端实际返回的可用媒体资源。 */ (url: string | null | undefined): url is string => typeof url === 'string',
	));
	page.on('request', /** 只记录媒体地址，不输出认证请求体。 */ (request: Request): void => {
		if (sourceUrls.has(request.url())) mediaRequests.push(request.url());
	});
	await page.reload();
	media = noteMedia(page, note.id);
	await media.scrollIntoViewIfNeeded();
	await expectAdaptiveGeometry(page, media, [sensitive, ordinary]);
	await expect(media.getByText('Click to show', { exact: true })).toHaveCount(2);
	expect(mediaRequests).toEqual([]);
	await media.locator(`[data-media-id="${ordinary.id}"]`).getByText('Click to show', { exact: true }).click();
	await expect(media.locator(`[data-media-id="${ordinary.id}"] img`).last()).toBeVisible();
	await expect.poll(/** 揭示后才允许现有媒体请求发生。 */ (): number => mediaRequests.length).toBeGreaterThan(0);
});

test('缺少尺寸元数据的竖视频与图片混排后保持真实比例并能解码播放', /** 封面自然尺寸补足显示几何，播放器仍消费真实上传视频。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const path: string = testInfo.outputPath('portrait.mp4');
	execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=12', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path], { timeout: 30_000 });
	const videoResponse: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: { i: account.token, file: { name: 'portrait.mp4', mimeType: 'video/mp4', buffer: await readFile(path) } },
	});
	expect(videoResponse.ok()).toBe(true);
	const video: Misskey.entities.DriveFile = await videoResponse.json();
	expect(video.type).toBe('video/mp4');
	const image: Misskey.entities.DriveFile = await uploadImage(page, 32, { width: 640, height: 360 });
	const note: Misskey.entities.Note = await createNote('Mixed portrait video and image', [video, image]);
	await openTwitter(page, '/@media_user');
	const media: Locator = noteMedia(page, note.id);
	await media.scrollIntoViewIfNeeded();
	await expect.poll(/** 视频只用实际已加载封面的自然比例修正临时布局。 */ async (): Promise<number> => {
		const size: MediaGeometry | undefined = (await geometries(media)).find(/** 定位真实视频实体对应的测量。 */ (item: MediaGeometry): boolean => item.id === video.id);
		return size === undefined ? 0 : size.width / size.height;
	}).toBeCloseTo(180 / 320, 2);
	const sizes: MediaGeometry[] = await geometries(media);
	expect(Math.abs(sizes[0].top - sizes[1].top)).toBeLessThan(1);
	await media.locator(`[data-media-id="${video.id}"] .ti-player-play`).click();
	const player: Locator = page.locator('video').last();
	await expect(player).toBeVisible();
	await player.evaluate(/** 静音后由真实浏览器执行媒体解码，不能用封面成功替代播放成功。 */ async (element: HTMLVideoElement): Promise<void> => {
		element.muted = true;
		await element.play();
	});
	await expect.poll(/** 已解码画面和时间进度必须同时有效。 */ async (): Promise<boolean> => player.evaluate(
		/** 直接读取真实媒体元素的尺寸、时间与播放质量。 */ (element: HTMLVideoElement): boolean => element.currentTime > 0.2 && element.videoWidth === 180 && element.videoHeight === 320 && element.getVideoPlaybackQuality().totalVideoFrames > 0,
	)).toBe(true);
});

test('原生触控横滑、纵向滚轮与键盘入口保持各自语义', /** 使用 Chromium 的真实触控输入，不用合成点击冒充手势。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 900 });
	for (let index: number = 0; index < 12; index++) await createNote(`Media scroll filler ${index}\n${'Real vertically scrollable timeline content.\n'.repeat(3)}`, []);
	const files: Misskey.entities.DriveFile[] = await uploadImages(page, 5);
	const note: Misskey.entities.Note = await createNote('Touch and keyboard media', files);
	await openTwitter(page, '/@media_user');
	const media: Locator = noteMedia(page, note.id);
	const strip: Locator = media.getByTestId('media-strip');
	await media.scrollIntoViewIfNeeded();
	const originalUrl: string = page.url();
	const bounds: { x: number; y: number; width: number; height: number } | null = await strip.boundingBox();
	if (bounds === null) throw new Error('真实媒体横条没有可触控区域');
	const session: CDPSession = await page.context().newCDPSession(page);
	await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
	const startX: number = bounds.x + bounds.width - 24;
	const endX: number = bounds.x + 24;
	const y: number = bounds.y + Math.min(80, bounds.height / 2);
	try {
		await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
		for (let step: number = 1; step <= 8; step++) {
			await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 8, y }] });
			await page.evaluate(/** 每帧交付一次原生触控输入，保留浏览器手势识别。 */ async (): Promise<void> => {
				await new Promise<void>(/** 与浏览器帧同步，不设置产品计时器。 */ (resolve: () => void): void => { requestAnimationFrame(/** 采样帧结束后继续手势。 */ (): void => { resolve(); }); });
			});
		}
		await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await waitForScrollIdle(strip);
		await expect.poll(/** 手势必须改变实际横条位置。 */ async (): Promise<number> => strip.evaluate(/** 原生偏移是唯一手势结果。 */ (element: HTMLElement): number => element.scrollLeft)).toBeGreaterThan(0);
		await expect(page).toHaveURL(originalUrl);
	} finally {
		await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
		await session.detach();
	}
	const viewport: Locator = page.getByTestId('twitter-scroll-viewport');
	const beforeTop: number = await viewport.evaluate(/** 保存纵向主视口位置。 */ (element: HTMLElement): number => element.scrollTop);
	const beforeLeft: number = await strip.evaluate(/** 保存横条当前位置用于检测误捕获。 */ (element: HTMLElement): number => element.scrollLeft);
	await strip.hover();
	await page.mouse.wheel(0, 300);
	await expect.poll(/** 普通纵向滚轮应继续滚动时间线。 */ async (): Promise<number> => viewport.evaluate(/** 读取主视口而非窗口的实际偏移。 */ (element: HTMLElement): number => element.scrollTop)).toBeGreaterThan(beforeTop);
	await waitForScrollIdle(strip);
	expect(Math.abs(await strip.evaluate(/** 检查横条未把纵向滚轮转成横滑。 */ (element: HTMLElement): number => element.scrollLeft) - beforeLeft)).toBeLessThan(1);
	await media.scrollIntoViewIfNeeded();
	await strip.evaluate(/** 回到起点以检查键盘方向导航。 */ (element: HTMLElement): void => { element.scrollTo({ left: 0, behavior: 'instant' }); });
	await page.evaluate(/** 经实际偏好管理器关闭动画，仍保留同一轨道。 */ async (): Promise<void> => {
		const resource: PerformanceEntry | undefined = performance.getEntriesByType('resource').find(/** 使用当前实例而非重建偏好。 */ (entry: PerformanceEntry): boolean => new URL(entry.name).pathname === '/vite/src/preferences.ts');
		if (resource === undefined) throw new Error('未找到偏好模块');
		const preferences: typeof import('../../src/preferences.js') = await import(resource.name);
		preferences.prefer.commit('animation', false);
	});
	await strip.focus();
	await page.keyboard.press('ArrowRight');
	await expect.poll(/** 宿主方向键作用于真实横条。 */ async (): Promise<number> => strip.evaluate(/** 只读取当前偏移。 */ (element: HTMLElement): number => element.scrollLeft)).toBeGreaterThan(0);
	await waitForScrollIdle(strip);
	await page.keyboard.press('ArrowLeft');
	await expect(media.getByTestId('media-previous')).toBeDisabled();
	await page.locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]`).first().focus();
	await page.keyboard.press('o');
	await expect(page).toHaveURL(`${originalUrl}#pswp`);
	await expect(page.locator('div:has(> ._modalBg)').getByText(files[0].name, { exact: true })).toBeInViewport();
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(originalUrl);
});

test('真实图片传输失败时保留已知比例和页面交互', /** 只中断真实文件传输，不伪造后端实体或业务响应。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 900 });
	const file: Misskey.entities.DriveFile = await uploadImage(page, 40, { width: 360, height: 640 });
	const note: Misskey.entities.Note = await createNote('Failed image transport', [file]);
	let failed: number = 0;
	const sources: Set<string> = new Set([file.url, file.thumbnailUrl].filter(/** 只匹配实际服务端媒体地址。 */ (url: string | null | undefined): url is string => typeof url === 'string'));
	await page.route(/** 精确限定文件传输，不影响 API 或其他静态资源。 */ (url: URL): boolean => sources.has(url.href), /** 在真实网络层注入加载中断。 */ async (route: Route): Promise<void> => { failed++; await route.abort(); });
	await openTwitter(page, '/@media_user');
	const media: Locator = noteMedia(page, note.id);
	await media.scrollIntoViewIfNeeded();
	await expect.poll(/** 确认失败分支实际执行。 */ (): number => failed).toBeGreaterThan(0);
	await expectAdaptiveGeometry(page, media, [file]);
	await expect(media.getByTestId('media-next')).toBeHidden();
	await expect(page).toHaveURL(/\/@media_user\?ui=twitter$/);
});
