/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 首页正文切换的真实浏览器集成回归。
 * 作用：证明点击正文横移、骨架延显、终态交接、深滚动和迟到响应的实际时序。
 * 数据链：隔离后端真实账号／帖子 → 原时间线页面 → 只读动画及滚动几何。
 * 网络控制只延迟真实响应或制造传输失败，不拼造帖子、空态或领域响应。
 */
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { APIResponse, Locator, Page, PlaywrightTestArgs, Route, TestInfo } from '@playwright/test';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 真实服务端签发的当前浏览身份，不输出到验证产物。 */
let viewer: AccountWithToken;
/** 只有本实例管理员用于构造真实的非关注来源内容。 */
let admin: RegisteredUser;
/** 从首帧开始记录未处理异常，几何通过不能掩盖渲染失败。 */
let errors: string[];

/** 已收到真实响应的可释放交接门，仅控制浏览器接收时序。 */
type ResponseGate = Readonly<{ received: Promise<void>; delivered: Promise<void>; release: () => void }>;
/** 原 CSS 动画三个进度点的真实正文坐标。 */
type BodyMotion = Readonly<{ width: number; start: number; middle: number; end: number; duration: number }>;
/** 首帧至加载完成的展示事实，只用于回归断言。 */
type BodyFrame = Readonly<{ key: string | null; time: number; opacity: number; contentOpacity: number; x: number | null; scrollTop: number; height: number; panels: number }>;
/** 可跨浏览器回调保存的采样窗口，不保存业务实体。 */
type SamplingWindow = Window & { twitterBodyFrames?: BodyFrame[]; twitterBodySampling?: boolean };

test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'no-preference' } });

test.beforeEach(/** 每个用例重建独立真实帖子流，避免沿用上一轮请求或缓存。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	errors = [];
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'body_motion_admin', 'body-transition-password', true);
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, name: 'Body transition regression', emailRequiredForSignup: false });
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'body_motion_viewer', password: 'body-transition-password' });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	for (let index: number = 0; index < 28; index++) {
		await api(BASE_URL, 'notes/create', { i: viewer.token, text: `Body transition ${index}\n${'Real backend content preserves deep scroll geometry.\n'.repeat(3)}` });
	}
	await api(BASE_URL, 'notes/create', { i: admin.token, text: 'Only local source content.' });
	page.on('pageerror', /** 错误消息不包含测试认证值。 */ (error: Error): void => { errors.push(error.message); });
});

test.afterEach(/** 不屏蔽页面运行错误或过期回调异常。 */ (): void => { expect(errors).toEqual([]); });

/** 使用产品既有持久化契约，经真实启动链读取账号和展示偏好。 */
async function openTimeline(page: Page, swipe: boolean = false, animation: boolean = true, account: AccountWithToken = viewer): Promise<Locator> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 只播种原有档案格式，不向页面注入替代业务事实。 */ (input: { account: AccountWithToken; swipe: boolean; animation: boolean }): void => {
		localStorage.setItem('account', JSON.stringify(input.account));
		localStorage.setItem('lang', 'en-US');
		localStorage.setItem('preferences', JSON.stringify({ id: 'body-transition', version: '2026.8.0-alpha.0', type: 'main', modifiedAt: Date.now(), name: 'Transition', preferences: {
			enableHorizontalSwipe: [[{}, input.swipe, {}]], animation: [[{}, input.animation, {}]],
		} }));
	}, { account, swipe, animation });
	await page.goto(`${BASE_URL}/?ui=twitter`);
	const root: Locator = page.getByTestId('twitter-timeline');
	await expect(root.locator('[data-twitter-timeline-load-boundary]')).toHaveAttribute('aria-busy', 'false');
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await page.evaluate(/** 字体加载完成后才开始采集动画和锚点。 */ async (): Promise<void> => { await document.fonts.ready; });
	return root;
}

/** 找到已提交的当前正文，离场 DOM 不得参与新来源的终态断言。 */
function currentPanel(root: Locator, key: string): Locator {
	return root.locator(`[data-mk-swiper-panel="${key}"]:not([inert])`);
}

/** 延迟浏览器收到某个真实后端响应，释放后仍交付原始响应。 */
async function holdResponse(page: Page, endpoint: string): Promise<ResponseGate> {
	const delivery: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	const received: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	const delivered: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	await page.route(`**/api/${endpoint}`, /** 请求及响应都来自真实实例，仅接收边界被测试控制。 */ async (route: Route): Promise<void> => {
		const response: APIResponse = await route.fetch();
		received.resolve();
		await delivery.promise;
		await route.fulfill({ response });
		delivered.resolve();
	});
	return { received: received.promise, delivered: delivered.promise, release: /** 无最短停留或业务状态写入，只释放真实传输。 */ (): void => { delivery.resolve(); } };
}

/** 逐帧记录加载覆盖透明度及真实宿主滚动，不快进动画。 */
async function startSampling(root: Locator): Promise<void> {
	await root.evaluate(/** 采样结果只供测试读取，不参与产品呈现。 */ (element: HTMLElement): void => {
		const sampleWindow: SamplingWindow = window as SamplingWindow;
		const start: number = performance.now();
		sampleWindow.twitterBodyFrames = [];
		sampleWindow.twitterBodySampling = true;

		/** 每一帧读取当前可见来源，不把离场覆盖层误算成当前骨架。 */
		function record(): void {
			const host: HTMLElement | null = document.querySelector('[data-testid="twitter-scroll-viewport"]');
			const panel: HTMLElement | null = element.querySelector('[data-mk-swiper-panel]:not([inert])');
			const overlay: HTMLElement | null = panel?.querySelector('[data-twitter-timeline-skeleton]') ?? null;
			const content: HTMLElement | null = panel?.querySelector('[data-twitter-timeline-content]') ?? null;
			sampleWindow.twitterBodyFrames!.push({ key: element.querySelector<HTMLElement>('[data-twitter-tab-key][aria-current="page"]')?.dataset.twitterTabKey ?? null, time: performance.now() - start, opacity: overlay == null ? 0 : Number(getComputedStyle(overlay).opacity), contentOpacity: content == null ? 0 : Number(getComputedStyle(content).opacity), x: panel == null ? null : new DOMMatrixReadOnly(getComputedStyle(panel).transform).m41, scrollTop: host?.scrollTop ?? -1, height: host?.scrollHeight ?? -1, panels: element.querySelectorAll('[data-mk-swiper-panel]').length });
			if (sampleWindow.twitterBodySampling) requestAnimationFrame(record);
		}

		record();
	});
}

/** 停止本次帧采样并将证据附在 Playwright 报告中。 */
async function finishSampling(page: Page, info: TestInfo): Promise<BodyFrame[]> {
	const frames: BodyFrame[] = await page.evaluate(/** 返回几何投影，不序列化帖子内容。 */ (): BodyFrame[] => {
		const sampleWindow: SamplingWindow = window as SamplingWindow;
		sampleWindow.twitterBodySampling = false;
		return sampleWindow.twitterBodyFrames ?? [];
	});
	const path: string = info.outputPath('body-frames.json');
	await writeFile(path, JSON.stringify(frames, null, 2));
	await info.attach('body-frames', { path, contentType: 'application/json' });
	return frames;
}

/** 对真实正文过渡定位到中点，截图时不使用禁用动画选项。 */
async function pauseBodyMotion(root: Locator, target: string): Promise<BodyMotion> {
	return root.evaluate(/** 等待实际 CSS 转场建立，不依赖固定时长猜测。 */ async (element: HTMLElement, key: string): Promise<BodyMotion> => {
		const tab: HTMLElement | null = element.querySelector(`[data-twitter-tab-key="${key}"]`);
		if (tab == null) throw new Error('Missing real source tab');
		tab.click();
		for (let frame: number = 0; frame < 30; frame++) {
			const panel: HTMLElement | null = element.querySelector(`[data-mk-swiper-panel="${key}"]`);
			if (panel != null) {
				void getComputedStyle(panel).transform;
				const motions: Animation[] = panel.getAnimations().filter(/** 只采正文位移，忽略覆盖层淡入和标签指示条。 */ (animation: Animation): boolean => animation instanceof CSSTransition && animation.transitionProperty === 'transform');
				if (motions.length > 0) {
					const motion: Animation = motions[0];
					motion.pause();
					const duration: number = Number(motion.effect?.getComputedTiming().duration ?? 0);

					/** 读取当前 CSS 横移值，不从目标类名推算位置。 */
					function x(): number { return new DOMMatrixReadOnly(getComputedStyle(panel!).transform).m41; }

					motion.currentTime = 0;
					const start: number = x();
					motion.currentTime = duration;
					const end: number = x();
					motion.currentTime = duration * 0.5;
					return { width: panel.getBoundingClientRect().width, start, middle: x(), end, duration };
				}
			}
			await new Promise<void>(/** 等待浏览器下一次实际绘制。 */ (resolve: () => void): void => { requestAnimationFrame(/** 仅交回采样控制权。 */ (): void => { resolve(); }); });
		}
		throw new Error('Click did not create a body transform transition');
	}, target);
}

/** 结束被测试暂停的真实动画，以便 Vue 自然完成离场清理。 */
async function finishBodyMotion(root: Locator): Promise<void> {
	await root.evaluate(/** 仅结束已有展示动画，不推进网络或修改页面选中值。 */ (element: HTMLElement): void => {
		const motions: Animation[] = element.getAnimations({ subtree: true });
		for (let index: number = 0; index < motions.length; index++) if (motions[index].playState === 'paused') motions[index].finish();
	});
}

for (let swipeIndex: number = 0; swipeIndex < 2; swipeIndex++) {
	const swipe: boolean = swipeIndex === 1;
	test(`手势${swipe ? '开启' : '关闭'}时点击均有正文横移中间帧`, /** 两种偏好分别通过实际页面点击切换，内容请求立即进行。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		if (swipe) await page.setViewportSize({ width: 390, height: 900 });
		const root: Locator = await openTimeline(page, swipe);
		expect(await root.locator('[data-mk-swiper]').evaluate(/** 挂载正文转场不能在关闭手势时限制原生横向触摸。 */ (element: HTMLElement): string => getComputedStyle(element).touchAction)).toBe(swipe ? 'pan-y pinch-zoom' : 'auto');
		const gate: ResponseGate = await holdResponse(page, 'notes/local-timeline');
		try {
			const motion: BodyMotion = await pauseBodyMotion(root, 'local');
			await gate.received;
			expect(motion.duration).toBe(180);
			expect(Math.abs(motion.start - motion.width)).toBeLessThanOrEqual(1);
			expect(motion.middle).toBeGreaterThan(1);
			expect(motion.middle).toBeLessThan(motion.start - 1);
			expect(Math.abs(motion.end)).toBeLessThanOrEqual(1);
			await page.screenshot({ path: info.outputPath('body-middle.png'), animations: 'allow' });
			await writeFile(info.outputPath('body-motion.json'), JSON.stringify(motion, null, 2));
			await finishBodyMotion(root);
			gate.release();
			await expect(currentPanel(root, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
			await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
		} finally { gate.release(); }
	});
}

test('快速真实响应不会闪现骨架覆盖层', /** 骨架延显不阻塞请求，也不要求真实结果等待横移完成。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const root: Locator = await openTimeline(page);
	await startSampling(root);
	await root.locator('[data-twitter-tab-key="local"]').click();
	const panel: Locator = currentPanel(root, 'local');
	await expect(panel.getByText('Only local source content.', { exact: true })).toBeVisible();
	await expect(panel.locator('[data-twitter-timeline-load-boundary]')).toHaveAttribute('aria-busy', 'false');
	await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
	const frames: BodyFrame[] = await finishSampling(page, info);
	expect(frames.length).toBeGreaterThan(2);
	expect(frames.some(/** 自然播放过程中正文确实经过非终态位置。 */ (frame: BodyFrame): boolean => frame.x != null && Math.abs(frame.x) > 1 && Math.abs(frame.x) < 500)).toBe(true);
	expect(Math.max(...frames.map(/** 透明覆盖层的存在不等于骨架已被用户看到。 */ (frame: BodyFrame): number => frame.opacity))).toBe(0);
});

test('慢真实响应先稳定呈现骨架并交接结果，用户接管后不再次回顶', /** 延迟只作用于已完成的真实响应，不制造接口数据。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const root: Locator = await openTimeline(page);
	const gate: ResponseGate = await holdResponse(page, 'notes/local-timeline');
	try {
		await startSampling(root);
		await root.locator('[data-twitter-tab-key="local"]').click();
		await gate.received;
		const panel: Locator = currentPanel(root, 'local');
		await expect.poll(/** 延显后透明度达到稳定加载终态。 */ async (): Promise<string> => panel.locator('[data-twitter-timeline-skeleton]').evaluate(/** 读取真实覆盖层的样式。 */ (element: HTMLElement): string => getComputedStyle(element).opacity)).toBe('1');
		await page.screenshot({ path: info.outputPath('slow-loading.png'), animations: 'allow' });
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 新来源加载中允许用户自主选择少量滚动。 */ (host: HTMLElement): void => { host.scrollTop = Math.min(40, host.scrollHeight - host.clientHeight); host.dispatchEvent(new Event('wheel')); });
		const controlledTop: number = await page.getByTestId('twitter-scroll-viewport').evaluate(/** 保存实际可滚动范围中的用户位置。 */ (host: HTMLElement): number => host.scrollTop);
		gate.release();
		await expect(panel.getByText('Only local source content.', { exact: true })).toBeVisible();
		await expect(panel.locator('[data-twitter-timeline-load-boundary]')).toHaveAttribute('aria-busy', 'false');
		await expect.poll(/** 加载完成仅淡出骨架，不重新裁定滚动。 */ async (): Promise<number> => page.getByTestId('twitter-scroll-viewport').evaluate(/** 实际滚动位置来自唯一 Shell 宿主。 */ (host: HTMLElement): number => host.scrollTop)).toBe(controlledTop);
		await expect.poll(/** 结果和骨架需完成各自真实透明度交接。 */ async (): Promise<string> => panel.locator('[data-twitter-timeline-skeleton]').evaluate(/** 读取覆盖层的最终透明度。 */ (element: HTMLElement): string => getComputedStyle(element).opacity)).toBe('0');
		const frames: BodyFrame[] = await finishSampling(page, info);
		expect(frames.some(/** 加载交接确实存在透明度中间帧。 */ (frame: BodyFrame): boolean => frame.opacity > 0 && frame.opacity < 1)).toBe(true);
		expect(frames.some(/** 骨架必须有真实可见帧。 */ (frame: BodyFrame): boolean => frame.opacity > 0)).toBe(true);
	} finally { gate.release(); }
});

test('真实响应在骨架淡入途中到达时从当前透明度反转', /** 延显阈值附近不重建覆盖层，也不强制等待最短骨架停留时间。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const root: Locator = await openTimeline(page);
	const gate: ResponseGate = await holdResponse(page, 'notes/local-timeline');
	try {
		await startSampling(root);
		const partial: number = await root.evaluate(/** 从点击同一任务观察，并暂停首个自然中间帧；真实响应到达后验证 CSS 从当前值反转。 */ async (element: HTMLElement): Promise<number> => {
			const tab: HTMLElement | null = element.querySelector('[data-twitter-tab-key="local"]');
			if (tab == null) throw new Error('Missing actual local source tab');
			tab.click();
			for (let frame: number = 0; frame < 60; frame++) {
				const overlay: HTMLElement | null = element.querySelector('[data-mk-swiper-panel="local"] [data-twitter-timeline-skeleton]');
				const opacity: number = overlay == null ? 0 : Number(getComputedStyle(overlay).opacity);
				if (opacity > 0 && opacity < 1 && overlay != null) {
					const motions: Animation[] = overlay.getAnimations();
					for (let index: number = 0; index < motions.length; index++) motions[index].pause();
					return opacity;
				}
				await new Promise<void>(/** 等待真实绘制时机，不覆盖产品动效时长。 */ (resolve: () => void): void => { requestAnimationFrame(/** 交回逐帧观察控制。 */ (): void => { resolve(); }); });
			}
			throw new Error('Skeleton did not pass through a partial opacity');
		});
		await gate.received;
		const overlay: Locator = currentPanel(root, 'local').locator('[data-twitter-timeline-skeleton]');
		expect(partial).toBeGreaterThan(0);
		expect(partial).toBeLessThan(1);
		gate.release();
		await gate.delivered;
		await expect(currentPanel(root, 'local').locator('[data-twitter-timeline-load-boundary]')).toHaveAttribute('aria-busy', 'false');
		await expect.poll(/** 真实结果返回后同一覆盖层自然淡出到零。 */ async (): Promise<string> => overlay.evaluate(/** 读取终态，不把 DOM 存在误判为骨架残留。 */ (element: HTMLElement): string => getComputedStyle(element).opacity)).toBe('0');
		await expect(currentPanel(root, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
		const frames: BodyFrame[] = await finishSampling(page, info);
		const visible: BodyFrame[] = frames.filter(/** 只检查本次新来源骨架的实际绘制帧。 */ (frame: BodyFrame): boolean => frame.key === 'local' && frame.opacity > 0);
		expect(visible.length).toBeGreaterThan(0);
		expect(Math.max(...visible.map(/** 中途完成不应先跳到完全不透明再淡出。 */ (frame: BodyFrame): number => frame.opacity))).toBeLessThan(1);
	} finally { gate.release(); }
});

test('深滚动切源在首帧保留旧可见片段并明确进入新来源顶部', /** 离场层只保留 DOM，旧业务实例不能继续操作真实滚动。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const root: Locator = await openTimeline(page);
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 复现人工核查中的七百像素阅读位置。 */ (host: HTMLElement): void => { host.scrollTop = 700; });
	await expect.poll(/** 确认测试确实从深滚动开始。 */ async (): Promise<number> => page.getByTestId('twitter-scroll-viewport').evaluate(/** 唯一主滚动宿主。 */ (host: HTMLElement): number => host.scrollTop)).toBe(700);
	const gate: ResponseGate = await holdResponse(page, 'notes/local-timeline');
	try {
		await startSampling(root);
		const sample: { beforeY: number; afterY: number; top: number; inert: boolean; hidden: string | null } = await root.evaluate(/** 同一帧内点击并在 Vue 提交后的首个绘制边界读取补偿。 */ async (element: HTMLElement): Promise<{ beforeY: number; afterY: number; top: number; inert: boolean; hidden: string | null }> => {
			const notes: HTMLElement[] = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="twitter-note"]'));
			const note: HTMLElement | undefined = notes.find(/** 选择屏幕中段的旧片段，而非已在视口外的列表首项。 */ (node: HTMLElement): boolean => node.getBoundingClientRect().top >= 100);
			if (note == null) throw new Error('Expected visible real note anchor');
			const beforeY: number = note.getBoundingClientRect().top;
			const tab: HTMLElement | null = element.querySelector('[data-twitter-tab-key="local"]');
			if (tab == null) throw new Error('Expected local source tab');
			tab.click();
			await Promise.resolve();
			const leaving: HTMLElement | null = element.querySelector('[data-mk-swiper-panel="home"]');
			if (leaving == null) throw new Error('Expected retained outgoing DOM');
			return { beforeY, afterY: note.getBoundingClientRect().top, top: document.querySelector<HTMLElement>('[data-testid="twitter-scroll-viewport"]')?.scrollTop ?? -1, inert: leaving.inert, hidden: leaving.getAttribute('aria-hidden') };
		});
		expect(Math.abs(sample.beforeY - sample.afterY)).toBeLessThanOrEqual(1);
		expect(sample.top).toBe(0);
		expect(sample.inert).toBe(true);
		expect(sample.hidden).toBe('true');
		await gate.received;
		gate.release();
		await expect(currentPanel(root, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
		await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
		const frames: BodyFrame[] = await finishSampling(page, info);
		expect(frames.filter(/** 初始采样之外，明确回顶后不依靠高度收缩夹到四像素。 */ (frame: BodyFrame): boolean => frame.key === 'local').every(/** 没有来源结果就绪后的二次滚动。 */ (frame: BodyFrame): boolean => frame.scrollTop === 0)).toBe(true);
		await writeFile(info.outputPath('deep-scroll-anchor.json'), JSON.stringify(sample, null, 2));
	} finally { gate.release(); }
});

test('快速往返切源只允许最新结果生效且离场层数量有界', /** 旧来源响应晚到也不能重新接管当前列表或触发清理新面板。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const root: Locator = await openTimeline(page);
	const gate: ResponseGate = await holdResponse(page, 'notes/local-timeline');
	try {
		await startSampling(root);
		await root.locator('[data-twitter-tab-key="local"]').click();
		await gate.received;
		await root.evaluate(/** 两个真实点击放在相邻提交周期，避免自动等待耗尽过渡。 */ async (element: HTMLElement): Promise<void> => {
			/** 将意图交给既有按钮事件，不直接写入页面状态。 */
			function click(key: string): void { const tab: HTMLElement | null = element.querySelector(`[data-twitter-tab-key="${key}"]`); if (tab == null) throw new Error('Missing source tab'); tab.click(); }

			click('global');
			await Promise.resolve();
			click('home');
		});
		await expect(root.locator('[data-twitter-tab-key="home"]')).toHaveAttribute('aria-current', 'page');
		await expect(currentPanel(root, 'home').getByTestId('twitter-note').first()).toBeVisible();
		await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 最新来源就绪后用户自主继续阅读。 */ (host: HTMLElement): void => { host.scrollTop = 400; host.dispatchEvent(new Event('wheel')); });
		gate.release();
		await gate.delivered;
		expect(await page.getByTestId('twitter-scroll-viewport').evaluate(/** 迟到旧响应不得将最新来源再拉回顶部。 */ (host: HTMLElement): number => host.scrollTop)).toBe(400);
		await expect(currentPanel(root, 'home').getByText('Only local source content.', { exact: true })).toHaveCount(0);
		const frames: BodyFrame[] = await finishSampling(page, info);
		expect(Math.max(...frames.map(/** 一份离场 DOM 加唯一当前面板，不积累过时来源。 */ (frame: BodyFrame): number => frame.panels))).toBeLessThanOrEqual(2);
	} finally { gate.release(); }
});

test('真实空态、传输失败和重试都由同一加载边界交接', /** 空态来自真实无帖账号，错误来自网络故障，重试仍访问真实接口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const emptyViewer: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'body_motion_empty', password: 'body-transition-password' });
	await api(BASE_URL, 'i/registry/set', { i: emptyViewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	const root: Locator = await openTimeline(page, false, true, emptyViewer);
	await expect(currentPanel(root, 'home').getByTestId('twitter-note')).toHaveCount(0);
	await expect(currentPanel(root, 'home').getByRole('heading')).toBeVisible();
	await page.route('**/api/notes/local-timeline', /** 传输故障不伪造任何领域响应。 */ async (route: Route): Promise<void> => { await route.abort('failed'); }, { times: 1 });
	await root.locator('[data-twitter-tab-key="local"]').click();
	const panel: Locator = currentPanel(root, 'local');
	await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	await expect(panel.locator('[data-twitter-timeline-load-boundary]')).toHaveAttribute('aria-busy', 'false');
	await panel.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(panel.getByText('Only local source content.', { exact: true })).toBeVisible();
	await root.locator('[data-twitter-tab-key="home"]').click();
	await expect(currentPanel(root, 'home').getByRole('heading')).toBeVisible();
	await expect(currentPanel(root, 'home').locator('[data-twitter-timeline-load-boundary]')).toHaveAttribute('aria-busy', 'false');
});

test('关闭动画或减少动态效果时直接交接且保持切源回顶', /** 无动态效果仍需准确清理临时几何，不保留不可交互层。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	for (let reducedIndex: number = 0; reducedIndex < 2; reducedIndex++) {
		const reduced: boolean = reducedIndex === 1;
		await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
		const root: Locator = await openTimeline(page, false, reduced);
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 无动画也从真实中部阅读位置切源。 */ (host: HTMLElement): void => { host.scrollTop = 700; });
		await root.locator('[data-twitter-tab-key="local"]').click();
		await expect(currentPanel(root, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
		await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
		expect(await root.evaluate(/** 正文及加载交接均无排队 CSS 动画。 */ (element: HTMLElement): number => element.getAnimations({ subtree: true }).filter(/** 排除不相关的头像和页面装饰动画，只读取正文动画。 */ (animation: Animation): boolean => (animation.effect as KeyframeEffect | null)?.target instanceof Element && ((animation.effect as KeyframeEffect).target as Element).closest('[data-mk-swiper]') != null).length)).toBe(0);
		expect(await page.getByTestId('twitter-scroll-viewport').evaluate(/** 新来源定位不依赖动画完成回调。 */ (host: HTMLElement): number => host.scrollTop)).toBe(0);
	}
});

test('路由回访恢复后切源取消旧位置恢复任务', /** 保留离开返回时间线的既有位置恢复，显式切源则回到新来源顶部。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const root: Locator = await openTimeline(page);
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 记录可恢复的真实阅读位置，并以原生输入撤销启动期恢复。 */ (host: HTMLElement): void => { host.dispatchEvent(new Event('wheel')); host.scrollTop = 700; });
	await page.getByTestId('twitter-sidebar').locator('a[href="/channels"]').click();
	await expect(page.getByTestId('twitter-communities')).toBeVisible();
	await page.goBack();
	await expect(root).toBeVisible();
	await expect.poll(/** 缓存回访先恢复原来源阅读位置。 */ async (): Promise<number> => page.getByTestId('twitter-scroll-viewport').evaluate(/** 主宿主恢复结果。 */ (host: HTMLElement): number => host.scrollTop)).toBe(700);
	await root.locator('[data-twitter-tab-key="local"]').click();
	await expect(currentPanel(root, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
	await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
	expect(await page.getByTestId('twitter-scroll-viewport').evaluate(/** 迟到恢复任务不能将新来源拉回旧阅读位置。 */ (host: HTMLElement): number => host.scrollTop)).toBe(0);
});

test('正文离场尚未完成时离页回访不继承旧来源锚点', /** 主出口捕获必须忽略惯性离场 DOM，而不是将旧来源片段存成新来源位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const root: Locator = await openTimeline(page);
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 从旧来源的中部阅读位置发起切换。 */ (host: HTMLElement): void => { host.dispatchEvent(new Event('wheel')); host.scrollTop = 700; });
	await root.evaluate(/** 在同一绘制周期完成来源提交与真实侧栏导航。 */ async (element: HTMLElement): Promise<void> => {
		const tab: HTMLElement | null = element.querySelector('[data-twitter-tab-key="local"]');
		if (tab == null) throw new Error('Missing local source tab');
		tab.click();
		await Promise.resolve();
		const sidebar: HTMLElement | null = document.querySelector('[data-testid="twitter-sidebar"] a[href="/channels"]');
		if (sidebar == null) throw new Error('Missing real sidebar community link');
		sidebar.click();
	});
	await expect(page.getByTestId('twitter-communities')).toBeVisible();
	await page.goBack();
	await expect(root).toBeVisible();
	await expect(root.locator('[data-twitter-tab-key="local"]')).toHaveAttribute('aria-current', 'page');
	await expect(currentPanel(root, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
	await expect(root.locator('[data-mk-swiper-panel]')).toHaveCount(1);
	expect(await page.getByTestId('twitter-scroll-viewport').evaluate(/** 离场锚点不得将新来源重新带回七百像素位置。 */ (host: HTMLElement): number => host.scrollTop)).toBe(0);
});

test('独立窗口回访的一百毫秒恢复任务不能覆盖随后的切源回顶', /** 使用真实窗口路由缓存，不将主出口宿主或其恢复机制冒充窗口行为。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	await page.goto(`${BASE_URL}/@${viewer.username}?ui=twitter`);
	await expect(page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').first()).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 主页面保持自己的独立阅读位置。 */ (host: HTMLElement): void => { host.dispatchEvent(new Event('wheel')); host.scrollTop = 500; });
	await page.getByTestId('twitter-sidebar').getByRole('link', { name: 'Timeline', exact: true }).last().click({ button: 'right' });
	await page.getByRole('menuitem', { name: /Open in window/ }).click();
	const windowTimeline: Locator = page.getByTestId('twitter-timeline');
	await expect(windowTimeline.getByTestId('twitter-note').first()).toBeVisible();
	await windowTimeline.evaluate(/** 窗口内使用原有元素滚动，主页面不参与。 */ (element: HTMLElement): void => { element.scrollTop = 400; });
	await windowTimeline.getByTestId('twitter-note').nth(4).locator('a[href^="/notes/"]').first().click();
	await expect(page.getByTestId('twitter-note-detail')).toBeVisible();
	const frame: Locator = page.locator('._shadow').filter({ has: page.getByTestId('twitter-note-detail') }).last();
	const elapsed: number = await frame.evaluate(/** 回访挂载后立即点击真实来源按钮，早于 keeper 的一百毫秒修正。 */ async (element: HTMLElement): Promise<number> => {
		const back: HTMLButtonElement | null = element.querySelector('button:has(i.ti-arrow-left)');
		if (back == null) throw new Error('Missing actual window history button');
		const start: number = performance.now();
		back.click();
		for (let frameIndex: number = 0; frameIndex < 30; frameIndex++) {
			const tab: HTMLElement | null = element.querySelector('[data-testid="twitter-timeline"] [data-twitter-tab-key="local"]');
			if (tab != null) { tab.click(); return performance.now() - start; }
			await new Promise<void>(/** 等待真实缓存页重新挂载。 */ (resolve: () => void): void => { requestAnimationFrame(/** 保留回访后的最早用户操作窗口。 */ (): void => { resolve(); }); });
		}
		throw new Error('Window timeline did not reactivate');
	});
	expect(elapsed).toBeLessThan(100);
	await expect(currentPanel(windowTimeline, 'local').getByText('Only local source content.', { exact: true })).toBeVisible();
	await expect(windowTimeline.locator('[data-mk-swiper-panel]')).toHaveCount(1);
	expect(await windowTimeline.evaluate(/** 来源转场完成已经越过一百毫秒，旧修正不得重新出现。 */ (element: HTMLElement): number => element.scrollTop)).toBe(0);
	expect(await page.getByTestId('twitter-scroll-viewport').evaluate(/** 窗口内部切换不得影响主资料页。 */ (host: HTMLElement): number => host.scrollTop)).toBe(500);
});
