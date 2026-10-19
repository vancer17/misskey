/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 二维码页面验收领域：通过真实用户、二维码像素、文件选择器和后端识别验证完整入口。
 * 摄像头用浏览器测试设备提供真实 MediaStream，仅在媒体 API 边界控制设备拓扑、异常与迟到回执。
 * 解析中的视图通过暂缓交付真实后端响应验证；独立浏览器的真实标签切换验证可见性生命周期。
 * 测试实例由外部启动流程提供；本文件不检查数据库、服务进程或部署状态。
 */
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import type { APIResponse, Browser, BrowserContext, ConsoleMessage, FileChooser, Locator, Page, PlaywrightTestArgs, PlaywrightWorkerArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type QRCodeStyling from 'qr-code-styling';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';

/** 外部启动流程指定的独立实例地址，可分别传入 localhost 与局域网 HTTP 来源。 */
const BASE_URL: string = process.env.QR_E2E_ORIGIN ?? 'http://localhost:61812';
/** 独立实例配置中的规范 URL，用于独立核对二维码内容，不从扫描结果反推预期。 */
const CANONICAL_URL: string = process.env.QR_TEST_CANONICAL_URL ?? BASE_URL;
/** 外部测试矩阵明确指定本轮访问来源，页面实际安全上下文仍需断言。 */
const INSECURE: boolean = process.env.QR_E2E_INSECURE === '1';
/** 视觉产物需要人工审核，未建立批准基线前不将自身截图冒充视觉回归通过。 */
const SCREENSHOTS: boolean = process.env.QR_E2E_SCREENSHOTS === '1';
/** 外部独立 Chromium 的连接地址；未提供时仅跳过原生可见性场景。 */
const NATIVE_CDP_ENDPOINT: string | undefined = process.env.QR_E2E_NATIVE_CDP;
/** 复用已安装二维码库生成追加图片夹具，仅载入独立空白页面。 */
const QR_CODE_SCRIPT: string = createRequire(import.meta.url).resolve('qr-code-styling');

/** 测试进程内保存真实账号，报告与截图不输出认证令牌。 */
let account: AccountWithToken;
/** 本轮页面未处理异常及本地化缺键日志，完成交互后统一断言。 */
let pageErrors: string[];

/** 媒体边界可以公开的设备拓扑，枚举失败与实际开流失败分别控制。 */
type DeviceScenario = 'single' | 'multiple' | 'none' | 'enumerationError';

/** 单场景媒体边界选项，不向产品注入组件状态或扫码结果。 */
type MediaOptions = { delayFirst?: boolean; denyFirst?: boolean; devices?: DeviceScenario };

/** 媒体边界探针仅持有原生媒体流与受控回执，不修改扫码器、组件或业务 API。 */
type MediaProbe = {
	calls: number;
	streams: MediaStream[];
	tracks: MediaStreamTrack[][];
	release: (() => void) | null;
	devices: DeviceScenario;
	enumerations: number;
	requestedDevices: (string | null)[];
};

/** 浏览器测试会话中保存媒体观察句柄，使离开扫码视图后仍能核对原有轨道。 */
type QrTestWindow = Window & typeof globalThis & { qrMediaProbe: MediaProbe };

/** 独立图片夹具页面暴露库的浏览器构造器，不与产品页面共享实例。 */
type QrFixtureWindow = Window & typeof globalThis & { QRCodeStyling: typeof QRCodeStyling };

/** 从浏览器返回的脱敏事实；媒体流和可执行句柄不传出浏览器。 */
type MediaEvidence = {
	calls: number;
	states: MediaStreamTrackState[][];
};

/** 暂存真实后端的完整响应，只控制交付时机以观察解析中的界面。 */
type HeldApResponse = { received: Promise<APIResponse>; release: () => void };

/** 原生可见性专用页面沿用外部浏览器默认上下文，避免 Playwright 自动启用焦点模拟。 */
const nativeTest: typeof test = test.extend({
	/** 只连接测试依赖并管理本用例创建的页面；浏览器进程及临时用户目录由外部流程负责。 */
	page: async ({ playwright }: Pick<PlaywrightWorkerArgs, 'playwright'>, use: (page: Page) => Promise<void>): Promise<void> => {
		if (!NATIVE_CDP_ENDPOINT) throw new Error('QR_E2E_NATIVE_CDP is required for native visibility tests.');
		const browser: Browser = await playwright.chromium.connectOverCDP(NATIVE_CDP_ENDPOINT, { noDefaults: true });
		try {
			const context: BrowserContext | undefined = browser.contexts()[0];
			if (!context) throw new Error('The native test browser did not expose its default context.');
			const page: Page = await context.newPage();
			try {
				await page.bringToFront();
				await use(page);
			} finally {
				await page.close();
			}
		} finally {
			// 对外部 CDP 浏览器关闭本次连接，进程清理由外部启动流程完成。
			await browser.close();
		}
	},
});

/** 使用后端签发的既有会话格式登录，随后沿真实资料设置入口进入二维码页面。 */
async function openFromProfileSettings(page: Page, scheme?: 'light' | 'dark'): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 沿用产品账户和语言缓存协议，前端身份恢复仍请求真实后端。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'zh-CN');
	}, account);
	if (scheme) {
		await page.goto(`${BASE_URL}/settings/theme?ui=twitter`);
		const toggle: Locator = page.locator('.rfqxtzch .toggleWrapper > .toggle');
		await expect(toggle).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-color-scheme', /^(light|dark)$/);
		if (await page.locator('html').getAttribute('data-color-scheme') !== scheme) {
			await toggle.click();
			await expect.poll(/** 同步设备主题开启时，现有产品流程会要求确认改为手动选择。 */ async (): Promise<boolean> => {
				return await page.getByTestId('modal-dialog-ok').isVisible() || await page.locator('html').getAttribute('data-color-scheme') === scheme;
			}).toBe(true);
			if (await page.getByTestId('modal-dialog-ok').isVisible()) await page.getByTestId('modal-dialog-ok').click();
		}
		await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme);
		await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	}
	await page.goto(`${BASE_URL}/settings/profile?ui=twitter`);
	const entry: Locator = page.locator('a[href="/qr"]');
	await expect(entry).toBeVisible();
	await entry.click();
	await expect(page.getByTestId('twitter-qr-page')).toBeVisible();
	await expect(page.getByRole('heading', { name: '二维码', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible();
	await expect(page.getByRole('tab', { name: '显示', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tab', { name: '扫描', exact: true })).toHaveAttribute('aria-selected', 'false');
	const secure: boolean = await page.evaluate(/** 记录浏览器实际来源能力，不能把环境变量本身当作验证结果。 */ (): boolean => window.isSecureContext);
	expect(secure).toBe(!INSECURE);
}

/** 等待异步二维码绘制已产出真实深色像素，避免读取尚未绘制的空 Canvas。 */
async function qrCanvas(page: Page): Promise<Locator> {
	const canvas: Locator = page.getByTestId('profile-qr-code').locator('canvas');
	await expect(canvas).toBeVisible();
	await expect.poll(/** 检查实际像素而非只等待 Canvas 元素挂载。 */ async (): Promise<boolean> => canvas.evaluate(
		/** 深色模块应已写入不透明像素；图像可识别性随后通过实际解码验证。 */
		(element: HTMLCanvasElement): boolean => {
			const context: CanvasRenderingContext2D | null = element.getContext('2d');
			if (!context || element.width === 0 || element.height === 0) return false;
			const pixels: Uint8ClampedArray = context.getImageData(0, 0, element.width, element.height).data;
			let darkPixels: number = 0;
			for (let index: number = 0; index < pixels.length; index += 4) {
				if (pixels[index + 3] > 0 && pixels[index] < 128 && pixels[index + 1] < 128 && pixels[index + 2] < 128) darkPixels++;
			}
			return darkPixels > 100;
		},
	)).toBe(true);
	return canvas;
}

/** 在隔离空白页生成补充二维码或无二维码 PNG；主用户二维码仍从产品画布获取。 */
async function fixtureImage(page: Page, content: string | null): Promise<Buffer> {
	const fixture: Page = await page.context().newPage();
	try {
		await fixture.addScriptTag({ path: QR_CODE_SCRIPT });
		const encoded: string = await fixture.evaluate(/** 只生成输入图片，不访问产品页面的运行模块和业务状态。 */ async (data: string | null): Promise<string> => {
			if (data === null) {
				const canvas: HTMLCanvasElement = window.document.createElement('canvas');
				canvas.width = 320;
				canvas.height = 320;
				const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
				if (!context) throw new Error('The fixture canvas could not be created.');
				context.fillStyle = '#ffffff';
				context.fillRect(0, 0, canvas.width, canvas.height);
				return canvas.toDataURL('image/png').split(',')[1];
			}
			const code: QRCodeStyling = new (window as QrFixtureWindow).QRCodeStyling({ width: 320, height: 320, margin: 16, data });
			const image: Blob | Buffer | null = await code.getRawData('png');
			if (!(image instanceof Blob)) throw new Error('The fixture QR code did not produce a browser PNG.');
			const bytes: Uint8Array = new Uint8Array(await image.arrayBuffer());
			let binary: string = '';
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary);
		}, content);
		return Buffer.from(encoded, 'base64');
	} finally {
		await fixture.close();
	}
}

/** 沿真实文件选择器提交图片；空文件数组对应没有选择图片的结束路径。 */
async function chooseImage(page: Page, image: Buffer | null, name: string = 'qr-fixture.png'): Promise<void> {
	const chooser: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByTestId('qr-image-upload').click();
	await (await chooser).setFiles(image ? { name, mimeType: 'image/png', buffer: image } : []);
}

/** 先完成真实 ap/show 请求，再暂缓向浏览器交付响应以观察处理中状态。 */
async function holdNextApResponse(page: Page): Promise<HeldApResponse> {
	let resolveResponse!: (response: APIResponse) => void;
	let release!: () => void;
	const received: Promise<APIResponse> = new Promise<APIResponse>(/** 保存服务器已经返回的响应，不制造业务实体。 */ (resolve: (response: APIResponse) => void): void => { resolveResponse = resolve; });
	const delivery: Promise<void> = new Promise<void>(/** 测试完成待处理界面断言后才交付原始响应。 */ (resolve: () => void): void => { release = resolve; });
	await page.route('**/api/ap/show', /** 路由边界只改变交付时序，请求和完整响应都来自真实后端。 */ async (route: Route): Promise<void> => {
		const response: APIResponse = await route.fetch();
		resolveResponse(response);
		await delivery;
		await route.fulfill({ response });
	}, { times: 1 });
	return { received, release };
}

/** 在默认上下文切换真实标签页，可在仍隐藏时核对轨道；不覆盖可见性、焦点模拟或页面监听器。 */
async function hideAndRestore(page: Page, whileHidden?: () => Promise<void>): Promise<void> {
	const foreground: Page = await page.context().newPage();
	try {
		await foreground.bringToFront();
		await expect.poll(/** 另一原生标签激活后，被测页面必须实际进入隐藏状态。 */ async (): Promise<boolean> => page.evaluate(
			/** 读取标准可见性事实，不使用测试参数代替结果。 */
			(): boolean => window.document.hidden,
		)).toBe(true);
		await whileHidden?.();
	} finally {
		await foreground.close();
		await page.bringToFront();
	}
	await expect.poll(/** 原标签重新激活后必须恢复真实可见状态。 */ async (): Promise<boolean> => page.evaluate(
		/** 等待产品正常处理浏览器恢复事件。 */
		(): boolean => window.document.hidden,
	)).toBe(false);
}

/** 安装媒体边界观察器；原生流来自外部配置的 Chromium 测试摄像头。 */
async function observeMedia(page: Page, options: MediaOptions = {}): Promise<void> {
	await page.evaluate(/** 测试只控制媒体边界的设备公开信息、异常与回执时序。 */ (settings: MediaOptions): void => {
		const mediaDevices: MediaDevices = navigator.mediaDevices;
		const open: (constraints?: MediaStreamConstraints) => Promise<MediaStream> = mediaDevices.getUserMedia.bind(mediaDevices);
		const probe: MediaProbe = {
			// 当前测试会话申请摄像头的总次数。
			calls: 0,
			// 每次原生请求真正产生的媒体流，按取得顺序保存。
			streams: [],
			// 独立保留轨道引用，扫码库从流中移除轨道后仍能核对实际释放。
			tracks: [],
			// 首次延迟请求的交付控制句柄。
			release: null,
			// 当前对产品公开的硬件拓扑；成功视频始终使用 Chromium 原生测试流。
			devices: settings.devices ?? 'single',
			// 观察设备清单是否真的重新读取，不从按钮外观推断检测已完成。
			enumerations: 0,
			// 保存产品传入的精确设备选择，再将夹具 ID 映射到真实测试摄像头。
			requestedDevices: [],
		};
		(window as QrTestWindow).qrMediaProbe = probe;
		mediaDevices.getUserMedia = /** 保留实际设备请求，只在第一轮控制边界结果。 */ async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
			const call: number = ++probe.calls;
			if (settings.denyFirst && call === 1) throw new DOMException('QR media test denied permission.', 'NotAllowedError');
			if (probe.devices === 'none') throw new DOMException('QR media test has no camera.', 'NotFoundError');
			const video: MediaTrackConstraints | undefined = typeof constraints?.video === 'object' ? constraints.video : undefined;
			const selection: ConstrainDOMString | undefined = video?.deviceId;
			const exact: string | null = typeof selection === 'object' && !Array.isArray(selection) && typeof selection.exact === 'string' ? selection.exact : null;
			probe.requestedDevices.push(exact);
			const nativeConstraints: MediaStreamConstraints | undefined = exact?.startsWith('qr-camera-') ? { ...constraints, video: { ...video, deviceId: undefined } } : constraints;
			const stream: MediaStream = await open(nativeConstraints);
			probe.streams.push(stream);
			probe.tracks.push(stream.getTracks());
			if (settings.delayFirst && call === 1) {
				await new Promise<void>(/** 暂存真实流回执，等待视图切换后再交付。 */ (resolve: () => void): void => { probe.release = resolve; });
			}
			return stream;
		};
		mediaDevices.enumerateDevices = /** 模拟设备数量与列表读取失败，调用本身不会申请额外媒体流。 */ async (): Promise<MediaDeviceInfo[]> => {
			probe.enumerations++;
			if (probe.devices === 'enumerationError') throw new DOMException('QR media test cannot enumerate devices.', 'NotReadableError');
			if (probe.devices === 'none') return [];
			return Array.from({ length: probe.devices === 'multiple' ? 2 : 1 },
				/** 将稳定的夹具设备 ID 作为浏览器接口响应，真实流在请求时取得。 */
				(_value: unknown, index: number): MediaDeviceInfo => ({
					// 原样接收产品设备选择的 ID。
					deviceId: `qr-camera-${index + 1}`,
					// 同一独立测试设备组。
					groupId: 'qr-test-cameras',
					// 只公开视频输入，避免音频输入参与摄像头数量。
					kind: 'videoinput',
					// 弹窗可按用户看见的设备名称选择。
					label: `测试摄像头 ${index + 1}`,
					/** 满足原生设备序列化协议，测试不依赖此方法反推 UI 状态。 */
					toJSON(): Record<string, string> {
						return { deviceId: this.deviceId, groupId: this.groupId, kind: this.kind, label: this.label };
					},
				}),
			);
		};
	}, options);
}

/** 模拟插拔设备或枚举恢复，事件通过原生媒体 API 发送。 */
async function setDeviceScenario(page: Page, devices: DeviceScenario, announce: boolean = true): Promise<void> {
	await page.evaluate(/** 不改组件清单，让产品监听器自己重新读取媒体边界。 */ (change: { devices: DeviceScenario; announce: boolean }): void => {
		(window as QrTestWindow).qrMediaProbe.devices = change.devices;
		if (change.announce) navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
	}, { devices, announce });
}

/** 读取所有历史流的轨道状态，不能只检查 video.srcObject 被清空。 */
async function mediaEvidence(page: Page): Promise<MediaEvidence> {
	return page.evaluate(/** 历史流留在测试会话中，视图销毁后仍可观察是否真正释放。 */ (): MediaEvidence => {
		const probe: MediaProbe = (window as QrTestWindow).qrMediaProbe;
		return {
			calls: probe.calls,
			states: probe.tracks.map(/** 读取取得流时保留的轨道，避免库移除轨道后丢失释放证据。 */ (tracks: MediaStreamTrack[]): MediaStreamTrackState[] => tracks.map(
				/** 保留 ended 与 live 的浏览器原始状态。 */
				(track: MediaStreamTrack): MediaStreamTrackState => track.readyState,
			)),
		};
	});
}

/** 验证摄像头实际产生视频帧，成功文案或运行按钮不单独作为开流证明。 */
async function expectVideoFrames(page: Page, minimumTime: number = 0.6): Promise<void> {
	await expect(page.getByTestId('qr-camera-stop')).toBeVisible();
	await expect.poll(/** 同时观察有效尺寸、播放进度与真实解码帧。 */ async (): Promise<boolean> => page.getByTestId('qr-video').evaluate(
		/** 直接读取浏览器视频元素，不读取组件内部状态。 */
		(video: HTMLVideoElement, elapsed: number): boolean => video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime > elapsed && video.getVideoPlaybackQuality().totalVideoFrames > 0,
		minimumTime,
	)).toBe(true);
}

/** 保留可人工复核的页面截图，截图本身不作为新视觉基线通过的证明。 */
async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	const path: string = testInfo.outputPath(`${name}.png`);
	await page.screenshot({ path, animations: 'disabled', fullPage: true });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.beforeEach(/** 每个场景在外部提供的独立后端重新创建真实账号。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'qr_admin', 'qr-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'qr_user', password: 'qr-user-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	pageErrors = [];
	page.on('pageerror', /** 正常页面操作不应泄露未处理异常。 */ (error: Error): void => { pageErrors.push(error.message); });
	page.on('console', /** 本地化缺键也计入失败，避免裸键名通过页面断言。 */ (message: ConsoleMessage): void => {
		if (message.type() === 'error' && /^(Unexpected locale key|Missing locale parameters):/.test(message.text())) pageErrors.push(message.text());
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
});

test.afterEach(/** 预期设备失败应由页面消费，不出现原始英文弹窗或未处理异常。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	expect(pageErrors).toEqual([]);
	await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(0);
	await expect(page.getByText('Camera not found.', { exact: true })).toHaveCount(0);
});

test('资料设置进入 Twitter 二维码页，真实二维码图片解析为当前用户', /** 覆盖展示像素、中文页签、图片识别与后端对象归一化。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	await openFromProfileSettings(page);
	const canvas: Locator = await qrCanvas(page);
	const dataUrl: string = await canvas.evaluate(/** 导出页面实际生成的二维码图像，不能使用另造的理想二维码。 */ (element: HTMLCanvasElement): string => element.toDataURL('image/png'));
	const encoded: string | undefined = dataUrl.split(',')[1];
	if (!encoded) throw new Error('The rendered QR code did not produce a PNG payload.');
	const pixels: Buffer = Buffer.from(encoded, 'base64');
	await page.getByRole('tab', { name: '显示', exact: true }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('tab', { name: '扫描', exact: true })).toBeFocused();
	await expect(page.getByRole('tab', { name: '扫描', exact: true })).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Home');
	await expect(page.getByRole('tab', { name: '显示', exact: true })).toBeFocused();
	await expect(page.getByRole('tab', { name: '显示', exact: true })).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('End');
	await expect(page.getByRole('tab', { name: '扫描', exact: true })).toBeFocused();
	await expect(page.getByRole('tabpanel')).toHaveAccessibleName('扫描');
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
	const held: HeldApResponse = await holdNextApResponse(page);
	const resolved: Promise<Response> = page.waitForResponse(/** 识别必须请求真实 ActivityPub 解析接口。 */ (response: Response): boolean => response.url().endsWith('/api/ap/show'));
	await chooseImage(page, pixels, 'profile-qr.png');
	try {
		const original: APIResponse = await held.received;
		expect(original.status()).toBe(200);
		await expect(page.getByTestId('qr-processing-status')).toHaveText('正在获取二维码内容…');
		await expect(page.getByTestId('qr-image-upload')).toBeDisabled();
		await expect(page.getByTestId('qr-results')).toHaveCount(0);
	} finally {
		held.release();
	}
	const response: Response = await resolved;
	expect(response.status()).toBe(200);
	const request: Misskey.Endpoints['ap/show']['req'] = response.request().postDataJSON();
	expect(request.uri).toBe(`${CANONICAL_URL}/users/${account.id}`);
	const result: Misskey.Endpoints['ap/show']['res'] = await response.json();
	expect(result.type).toBe('User');
	expect(result.object.id).toBe(account.id);
	await expect(page.getByTestId('qr-results')).toBeVisible();
	await expect(page.getByTestId('qr-user-result')).toHaveCount(1);
	await expect(page.getByTestId('qr-user-result')).toContainText('qr_user');
	await expect(page.getByTestId('qr-user-result')).toHaveAttribute('data-user-id', account.id);
	await page.getByTestId('qr-reader').getByRole('button', { name: '全部', exact: true }).click();
	const rawResult: Locator = page.getByTestId('qr-raw-result');
	await expect(rawResult).toBeVisible();
	await rawResult.getByRole('tab', { name: '文本', exact: true }).click();
	await expect(page.getByTestId('qr-raw-text')).toHaveText(`${CANONICAL_URL}/users/${account.id}`);
	await rawResult.locator('summary').click();
	await expect(page.getByTestId('qr-raw-text')).toBeHidden();
	await rawResult.locator('summary').click();
	await expect(page.getByTestId('qr-raw-text')).toBeVisible();
	await testInfo.attach('qr-decoded-user', { body: JSON.stringify({ uri: request.uri, type: result.type, id: result.object.id }), contentType: 'application/json' });
	if (SCREENSHOTS) await capture(page, testInfo, 'qr-image-recognized');
	await page.getByRole('button', { name: '返回', exact: true }).click();
	await expect(page.getByTestId('twitter-qr-page')).toHaveCount(0);
	await expect(page.locator('a[href="/qr"]')).toBeVisible();
});

test('局域网 HTTP 扫描显示中文环境说明并保留图片识别入口', /** 不安全来源不得被误报为电脑没有摄像头。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	test.skip(!INSECURE, '该场景仅在外部矩阵指定的局域网 HTTP 来源运行。');
	await openFromProfileSettings(page);
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	const status: Locator = page.getByTestId('qr-camera-status');
	await expect(status).toHaveText('当前访问地址无法使用摄像头，请通过 HTTPS 打开，或选择图片识别二维码。');
	await expect(page.getByTestId('qr-image-upload')).toBeEnabled();
	await expect(page.getByTestId('qr-camera-start')).toBeDisabled();
	await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
	await expect(page.getByTestId('qr-camera-flash')).toBeDisabled();
	await expect(page.getByTestId('qr-camera-stop')).toHaveCount(0);
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
});

test('未选择文件和无二维码图片不会展开首次结果区域', /** 文件选择结束与成功识别分别处理，空白图仍经过真实图片解码。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const blank: Buffer = await fixtureImage(page, null);
	await openFromProfileSettings(page);
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
	await chooseImage(page, null);
	await expect(page.getByTestId('qr-image-upload')).toBeEnabled();
	await expect(page.getByTestId('qr-processing-status')).toHaveCount(0);
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
	await chooseImage(page, blank, 'blank-image.png');
	await expect(page.getByText('未找到二维码', { exact: true })).toBeVisible();
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('qr-processing-status')).toHaveCount(0);
	await expect(page.getByTestId('qr-image-upload')).toBeEnabled();
});

test('文本普通网址与真实帖子完成后归类，追加处理中保留已有结果', /** 每次输入都是实际 PNG，实体归类仍由真实后端决定。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const text: string = 'QR plain text acceptance';
	const plainUrl: string = `${CANONICAL_URL}/robots.txt`;
	const created: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text: '二维码识别出的测试帖子' });
	const noteUrl: string = `${CANONICAL_URL}/notes/${created.createdNote.id}`;
	const textImage: Buffer = await fixtureImage(page, text);
	const urlImage: Buffer = await fixtureImage(page, plainUrl);
	const noteImage: Buffer = await fixtureImage(page, noteUrl);
	await openFromProfileSettings(page);
	let apRequests: number = 0;
	page.on('request', /** 仅统计真实解析请求，重复上传不能再次请求同一已完成实体。 */ (request: Request): void => {
		if (request.url().endsWith('/api/ap/show')) apRequests++;
	});
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
	await chooseImage(page, textImage, 'plain-text-qr.png');
	await expect(page.getByTestId('qr-results')).toBeVisible();
	await expect(page.getByTestId('qr-results').getByRole('button', { name: '全部', exact: true })).toBeDisabled();
	await expect(page.getByTestId('qr-raw-result')).toHaveCount(1);
	expect(apRequests).toBe(0);
	const unresolved: Promise<Response> = page.waitForResponse(/** 普通网址应实际尝试解析，失败后保留原始二维码内容。 */ (response: Response): boolean => response.url().endsWith('/api/ap/show'));
	await chooseImage(page, urlImage, 'plain-url-qr.png');
	expect((await unresolved).status()).toBeGreaterThanOrEqual(400);
	await expect(page.getByTestId('qr-raw-result')).toHaveCount(2);
	await expect(page.getByTestId('qr-results')).toBeVisible();
	const held: HeldApResponse = await holdNextApResponse(page);
	await chooseImage(page, noteImage, 'note-qr.png');
	try {
		const response: APIResponse = await held.received;
		expect(response.status()).toBe(200);
		const result: Misskey.Endpoints['ap/show']['res'] = await response.json();
		expect(result.type).toBe('Note');
		expect(result.object.id).toBe(created.createdNote.id);
		await expect(page.getByTestId('qr-processing-status')).toHaveText('正在获取二维码内容…');
		await expect(page.getByTestId('qr-results')).toBeVisible();
		await expect(page.getByTestId('qr-raw-result')).toHaveCount(2);
		await page.getByTestId('qr-results').getByRole('button', { name: '用户', exact: true }).click();
	} finally {
		held.release();
	}
	await expect(page.getByTestId('qr-processing-status')).toHaveCount(0);
	await expect(page.getByTestId('qr-results').getByRole('button', { name: '用户', exact: true })).toBeDisabled();
	await page.getByTestId('qr-results').getByRole('button', { name: '帖子', exact: true }).click();
	await expect(page.getByTestId('qr-note-result')).toHaveAttribute('data-note-id', created.createdNote.id);
	await expect(page.getByTestId('qr-note-result')).toContainText('二维码识别出的测试帖子');
	await page.getByTestId('qr-results').getByRole('button', { name: '全部', exact: true }).click();
	await expect(page.getByTestId('qr-raw-result')).toHaveCount(3);
	for (const result of await page.getByTestId('qr-raw-result').all()) await result.getByRole('tab', { name: '文本', exact: true }).click();
	await expect(page.getByTestId('qr-raw-text')).toHaveText([noteUrl, plainUrl, text]);
	await chooseImage(page, noteImage, 'same-note-qr.png');
	await expect(page.getByTestId('qr-image-upload')).toBeEnabled();
	await expect(page.getByTestId('qr-results')).toBeVisible();
	await expect(page.getByTestId('qr-raw-result')).toHaveCount(3);
	expect(apRequests).toBe(2);
	await testInfo.attach('qr-raw-and-note-results', { body: JSON.stringify({ text, plainUrl, noteUrl, apRequests }), contentType: 'application/json' });
});

test('没有摄像头时禁用控制，重新检测设备后允许手动启动', /** 设备恢复只能恢复操作能力，枚举自身不会暗中开启摄像头。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	test.skip(INSECURE, '设备插拔恢复使用 localhost 的真实测试摄像头。');
	await openFromProfileSettings(page);
	await observeMedia(page, { devices: 'none' });
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await expect(page.getByTestId('qr-camera-start')).toBeDisabled();
	await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
	await expect(page.getByTestId('qr-camera-refresh')).toBeEnabled();
	await expect(page.getByTestId('qr-image-upload')).toBeEnabled();
	await expect(page.getByTestId('qr-results')).toHaveCount(0);
	expect(await mediaEvidence(page)).toEqual({ calls: 1, states: [] });
	await setDeviceScenario(page, 'single', false);
	const previousReads: number = await page.evaluate(/** 保存重检前的原生枚举次数，确认按钮真正触发了新读取。 */ (): number => (window as QrTestWindow).qrMediaProbe.enumerations);
	await page.getByTestId('qr-camera-refresh').click();
	await expect(page.getByTestId('qr-camera-start')).toBeEnabled();
	const currentReads: number = await page.evaluate(/** 读取完成后重新观察媒体边界调用，不能只凭启动按钮变亮判定。 */ (): number => (window as QrTestWindow).qrMediaProbe.enumerations);
	expect(currentReads).toBeGreaterThan(previousReads);
	expect(await mediaEvidence(page)).toEqual({ calls: 1, states: [] });
	await page.getByTestId('qr-camera-start').click();
	await expectVideoFrames(page);
	await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
	await page.getByRole('button', { name: '返回', exact: true }).click();
	await expect.poll(/** 恢复后取得的真实媒体轨道在离页时同样必须结束。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended']] });
});

test('摄像头权限失败可重试，启动暂停和离开页面均正确释放真实轨道', /** 媒体异常仅在接口边界注入，成功路径使用真实浏览器流。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	test.skip(INSECURE, '真实测试摄像头需在 localhost 安全上下文运行。');
	await openFromProfileSettings(page);
	await observeMedia(page, { denyFirst: true });
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await expect(page.getByTestId('qr-camera-status')).toHaveText('未获准使用摄像头，请检查浏览器的摄像头权限后重试。');
	expect(await mediaEvidence(page)).toEqual({ calls: 1, states: [] });
	await expect(page.getByTestId('qr-camera-start')).toBeEnabled();
	await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
	await page.getByTestId('qr-camera-start').click();
	await expectVideoFrames(page);
	await expect(page.getByText('当前只有一个可选择的摄像头。', { exact: true })).toBeVisible();
	await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
	expect(await mediaEvidence(page)).toEqual({ calls: 2, states: [['live']] });
	await page.getByTestId('qr-camera-stop').click();
	await expect.poll(/** 暂停时必须立即释放已取得的媒体轨道。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended']] });
	await expect(page.getByTestId('qr-camera-start')).toBeEnabled();
	await expect(page.getByTestId('qr-camera-stop')).toHaveCount(0);
	expect(await mediaEvidence(page)).toEqual({ calls: 2, states: [['ended']] });
	await page.getByTestId('qr-camera-start').click();
	await expectVideoFrames(page);
	expect(await mediaEvidence(page)).toEqual({ calls: 3, states: [['ended'], ['live']] });
	await page.getByRole('button', { name: '返回', exact: true }).click();
	await expect(page.getByTestId('twitter-qr-page')).toHaveCount(0);
	await expect.poll(/** 路由离开后仍检查历史流，不能只检查预览节点移除。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 3, states: [['ended'], ['ended']] });
	await testInfo.attach('qr-camera-lifecycle', { body: JSON.stringify(await mediaEvidence(page)), contentType: 'application/json' });
});

test('多个摄像头可切换，设备列表失败不停止正在播放的真实流', /** 仅设备拓扑与约束映射在媒体边界模拟，切换后的流仍由浏览器原生创建。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	test.skip(INSECURE, '摄像头选择使用 localhost 的真实测试摄像头。');
	await openFromProfileSettings(page);
	await observeMedia(page, { devices: 'multiple' });
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await expectVideoFrames(page);
	await expect(page.getByTestId('qr-camera-choose')).toBeEnabled();
	await page.getByTestId('qr-camera-choose').click();
	const confirm: Locator = page.getByTestId('modal-dialog-ok');
	await expect(confirm).toBeVisible();
	const select: Locator = confirm.locator('..').locator('..').locator('[tabindex="0"]');
	await select.press('Space');
	await page.getByText('测试摄像头 2', { exact: true }).click();
	await confirm.click();
	await expectVideoFrames(page);
	await expect.poll(/** 摄像头切换必须释放旧轨道，同时保留新的真实媒体流。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['live']] });
	const selections: (string | null)[] = await page.evaluate(/** 核对用户选择的设备 ID 已到达原生请求边界。 */ (): (string | null)[] => (window as QrTestWindow).qrMediaProbe.requestedDevices);
	expect(selections).toEqual([null, 'qr-camera-2']);
	const beforeError: number = await page.getByTestId('qr-video').evaluate(/** 记录枚举失败前的视频时间，后续必须继续推进。 */ (video: HTMLVideoElement): number => video.currentTime);
	await setDeviceScenario(page, 'enumerationError');
	await expect(page.getByText('暂时无法读取摄像头列表，请重新检测设备。', { exact: true })).toBeVisible();
	await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
	await expectVideoFrames(page, beforeError + 0.6);
	expect(await mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['live']] });
	await setDeviceScenario(page, 'multiple', false);
	await page.getByTestId('qr-camera-refresh').click();
	await expect(page.getByTestId('qr-camera-choose')).toBeEnabled();
	expect(await mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['live']] });
	await page.getByRole('button', { name: '返回', exact: true }).click();
	await expect.poll(/** 枚举恢复不会遗留额外流，离页时只需释放两轮已记录的轨道。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['ended']] });
	await testInfo.attach('qr-camera-selection', { body: JSON.stringify({ selections, ...await mediaEvidence(page) }), contentType: 'application/json' });
});

test('旧摄像头请求迟到时释放旧流且不能覆盖重新进入后的扫描', /** 重建扫描视图后先让新请求完成，再交付旧请求的真实媒体流。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	test.skip(INSECURE, '迟到媒体回执使用 localhost 的真实测试摄像头。');
	await openFromProfileSettings(page);
	await observeMedia(page, { delayFirst: true });
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await page.waitForFunction(/** 确认第一次原生请求已产生流，只是尚未交给页面。 */ (): boolean => (window as QrTestWindow).qrMediaProbe.release !== null);
	await page.getByRole('tab', { name: '显示', exact: true }).click();
	await page.getByRole('tab', { name: '扫描', exact: true }).click();
	await expectVideoFrames(page);
	const releaseTime: number = await page.getByTestId('qr-video').evaluate(/** 标记交付旧流时新视频已经播放到的时间。 */ (video: HTMLVideoElement): number => video.currentTime);
	await page.evaluate(/** 将旧流交给已经卸载的旧视图，不改变新扫描任务。 */ (): void => { (window as QrTestWindow).qrMediaProbe.release?.(); });
	await expectVideoFrames(page, releaseTime + 0.6);
	await expect.poll(/** 旧流必须结束，而新任务持有的流继续有效。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['live']] });
	const latestAttached: boolean = await page.getByTestId('qr-video').evaluate(/** 预览应仍绑定第二次请求返回的实际流。 */ (video: HTMLVideoElement): boolean => video.srcObject === (window as QrTestWindow).qrMediaProbe.streams[1]);
	expect(latestAttached).toBe(true);
	await page.getByRole('button', { name: '返回', exact: true }).click();
	await expect(page.getByTestId('twitter-qr-page')).toHaveCount(0);
	await expect.poll(/** 最终离开后两轮轨道都必须结束。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['ended']] });
	await testInfo.attach('qr-late-camera-result', { body: JSON.stringify(await mediaEvidence(page)), contentType: 'application/json' });
});

nativeTest.describe('二维码原生标签可见性', { tag: '@native-visibility' }, /** 只有提供独立浏览器连接的矩阵才运行原生隐藏与恢复验收。 */ (): void => {
	nativeTest.skip(!NATIVE_CDP_ENDPOINT, '提供 QR_E2E_NATIVE_CDP，连接未启用焦点模拟的独立 Chromium 默认上下文。');

	nativeTest('LAN HTTP 标签隐藏后保留不可用原因和禁用控制', /** 非安全来源的设备失败在真实后台切换后不能丢失。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		nativeTest.skip(!INSECURE, '该场景仅在外部矩阵指定的局域网 HTTP 来源运行。');
		await openFromProfileSettings(page);
		await page.getByRole('tab', { name: '扫描', exact: true }).click();
		const status: Locator = page.getByTestId('qr-camera-status');
		await expect(status).toHaveText('当前访问地址无法使用摄像头，请通过 HTTPS 打开，或选择图片识别二维码。');
		await expect(page.getByTestId('qr-camera-start')).toBeDisabled();
		await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
		await hideAndRestore(page);
		await expect(status).toHaveText('当前访问地址无法使用摄像头，请通过 HTTPS 打开，或选择图片识别二维码。');
		await expect(page.getByTestId('qr-camera-start')).toBeDisabled();
		await expect(page.getByTestId('qr-camera-choose')).toBeDisabled();
		await expect(page.getByTestId('qr-camera-flash')).toBeDisabled();
		await expect(page.getByTestId('qr-camera-stop')).toHaveCount(0);
		await expect(page.getByTestId('qr-image-upload')).toBeEnabled();
		await expect(page.getByTestId('qr-results')).toHaveCount(0);
	});

	nativeTest('运行中隐藏会释放并恢复，主动暂停后不自行重开摄像头', /** 原生可见性接管只恢复此前运行的会话，并保留用户主动暂停意图。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
		nativeTest.skip(INSECURE, '摄像头暂停恢复使用 localhost 的真实测试摄像头。');
		await openFromProfileSettings(page);
		await observeMedia(page);
		await page.getByRole('tab', { name: '扫描', exact: true }).click();
		await expectVideoFrames(page);
		await hideAndRestore(page, /** 在标签仍隐藏时直接验证旧流结束，不能从恢复后的状态倒推释放。 */ async (): Promise<void> => {
			await expect.poll(/** 隐藏阶段不得保留旧轨道，也不得另行申请摄像头。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 1, states: [['ended']] });
		});
		await expectVideoFrames(page);
		expect(await mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['live']] });
		await page.getByTestId('qr-camera-stop').click();
		await expect.poll(/** 再次进入后台之前，主动暂停必须结束恢复时取得的媒体轨道。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['ended']] });
		await hideAndRestore(page);
		await expect(page.getByTestId('qr-camera-status')).toHaveText('摄像头已暂停，可重新启动或选择图片识别二维码。');
		await expect(page.getByTestId('qr-camera-start')).toBeEnabled();
		await expect(page.getByTestId('qr-camera-stop')).toHaveCount(0);
		expect(await mediaEvidence(page)).toEqual({ calls: 2, states: [['ended'], ['ended']] });
		await page.getByTestId('qr-camera-start').click();
		await expectVideoFrames(page);
		expect(await mediaEvidence(page)).toEqual({ calls: 3, states: [['ended'], ['ended'], ['live']] });
		await page.getByRole('button', { name: '返回', exact: true }).click();
		await expect.poll(/** 标签恢复后的手动启动同样必须在离页时释放所有媒体轨道。 */ async (): Promise<MediaEvidence> => mediaEvidence(page)).toEqual({ calls: 3, states: [['ended'], ['ended'], ['ended']] });
		await testInfo.attach('qr-native-paused-camera', { body: JSON.stringify(await mediaEvidence(page)), contentType: 'application/json' });
	});
});

test.describe('二维码桌面移动与明暗视觉产物', /** 仅在外部指定视觉采样时生成四组展示与扫描截图。 */ (): void => {
	test.skip(!SCREENSHOTS, '设置 QR_E2E_SCREENSHOTS=1 生成待人工审核的视觉产物。');
	const widths: number[] = [1440, 390];
	const schemes: ('light' | 'dark')[] = ['light', 'dark'];
	for (const width of widths) {
		for (const scheme of schemes) {
			test(`${width}px ${scheme} 展示和扫描`, /** 截图使用产品真实主题和响应式布局，同时检查横向溢出。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
				await page.setViewportSize({ width, height: 1000 });
				await openFromProfileSettings(page, scheme);
				await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme);
				await qrCanvas(page);
				const pageWidth: number = await page.evaluate(/** 页面实际布局宽度不得超过当前视口。 */ (): number => window.document.documentElement.scrollWidth);
				expect(pageWidth).toBeLessThanOrEqual(width);
				await capture(page, testInfo, `qr-show-${width}-${scheme}`);
				await page.getByRole('tab', { name: '扫描', exact: true }).click();
				if (INSECURE) {
					await expect(page.getByTestId('qr-camera-status')).toContainText('HTTPS');
				} else {
					await expectVideoFrames(page);
					await page.getByTestId('qr-camera-stop').click();
				}
				await expect(page.getByTestId('qr-results')).toHaveCount(0);
				const scanWidth: number = await page.evaluate(/** 状态说明与按钮换行后同样不得造成横向溢出。 */ (): number => window.document.documentElement.scrollWidth);
				expect(scanWidth).toBeLessThanOrEqual(width);
				await capture(page, testInfo, `qr-scan-${width}-${scheme}`);
			});
		}
	}
});
