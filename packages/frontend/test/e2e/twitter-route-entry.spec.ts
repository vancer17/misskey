/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter Shell 路由布局与进场表现的真实浏览器验收。
 * 作用：区分代码等待、业务查询等待、右栏生命周期和页面动效，验证导航过程而非仅验证最终截图。
 * 数据链：隔离实例真实账户与数据 → 原生导航／真实传输闸门 → DOM 几何和浏览器动画观测。
 * 边界：只重置 localhost:61812 专用测试实例；不伪造业务响应、不读取开发账户、不直接修改业务 Store。
 */
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { JSHandle, Locator, Page, PlaywrightTestArgs, Request, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { PossiblyNonNormalizedPreferencesProfile } from '../../src/preferences/manager.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 保留原生滚动条占位，不能由隐藏滚动条掩盖页面外框横移。 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar'] }, contextOptions: { reducedMotion: 'no-preference' } });

/** 管理者只创建隔离实例内的真实夹具。 */
let admin: RegisteredUser;
/** 当前浏览器使用的真实普通账户。 */
let viewer: AccountWithToken;
/** 第二个账户建立通知和私信，不用模拟事件代替后端动作。 */
let author: AccountWithToken;
/** 只收集异常消息，不输出认证请求或账户实体。 */
let errors: string[];

/** 通过现有传输调用真实协议，返回类型始终从生成的 Schema 派生。 */
async function realApi<E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(account: RegisteredUser, endpoint: E, params: P): Promise<Misskey.api.SwitchCaseResponseType<E, P>> {
	return await api(BASE_URL, endpoint, { ...params, i: account.token }) as Misskey.api.SwitchCaseResponseType<E, P>;
}

/** 创建普通账户并完成既有引导，聊天接收范围明确由真实接口设置。 */
async function createAccount(username: string, name: string): Promise<AccountWithToken> {
	const account: Misskey.Endpoints['admin/accounts/create']['res'] = await realApi(admin, 'admin/accounts/create', { username, password: 'route-entry-test-password' });
	await realApi(account, 'i/update', { name, chatScope: 'everyone' });
	await realApi(account, 'i/registry/set', { scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return { ...await realApi(account, 'i', {}), token: account.token };
}

/** 使用原浏览器持久化格式登录，偏好仅控制界面表现，不覆盖权限或业务状态。 */
async function openSession(page: Page, path: string = '/', animation: boolean = true): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 注入真实账户和原有偏好协议，认证仍由正常 Bootstrap 完成。 */ (input: { account: AccountWithToken; animation: boolean }): void => {
		const preferences: PossiblyNonNormalizedPreferencesProfile = {
			id: 'route-entry-regression', version: '1', type: 'main', modifiedAt: Date.now(), name: 'Route entry regression',
			preferences: { animation: [[{}, input.animation, {}]], 'experimental.stackingRouterView': [[{}, false, {}]] },
		};
		localStorage.setItem('account', JSON.stringify(input.account));
		localStorage.setItem('lang', 'en-US');
		localStorage.setItem('ui', 'twitter');
		localStorage.setItem('preferences', JSON.stringify(preferences));
	}, { account: viewer, animation });
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=twitter`);
	await expect(page.getByTestId('twitter-scroll-viewport')).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
}

/** 导航始终通过当前可见的正式链接，不直接调用 Router 或写入页面状态。 */
function navigation(page: Page, path: string): Locator {
	return page.locator(`[data-testid="twitter-sidebar"] a[href="${path}"], [data-testid="twitter-mobile-bar"] a[href="${path}"]`).filter({ visible: true }).last();
}

/** 只保存闸门控制权，业务请求及响应内容不进入测试状态。 */
type TransportGate = Readonly<{ reached: Promise<void>; release: () => void }>;

/** 延迟真实请求并继续原传输；代码等待和 API 等待可以独立释放。 */
async function holdTransport(page: Page, pattern: string, matches: (request: Request) => boolean = /** 默认持有匹配地址的真实请求。 */ (): boolean => true): Promise<TransportGate> {
	let release: () => void = /** 到达请求前没有待释放传输。 */ (): void => {};
	let reached: () => void = /** 首个匹配请求到达后才宣告等待阶段成立。 */ (): void => {};
	const waiting: Promise<void> = new Promise<void>(/** 保存显式放行入口，不依赖固定等待时间。 */ (resolve: () => void): void => { release = resolve; });
	const arrived: Promise<void> = new Promise<void>(/** 保存真实请求已到达的通知入口。 */ (resolve: () => void): void => { reached = resolve; });
	await page.route(pattern, /** 只调整时序，不使用 fulfill 或替换业务结果。 */ async (route: Route): Promise<void> => {
		if (matches(route.request())) { reached(); await waiting; }
		await route.continue();
	});
	return { reached: arrived, release };
}

/** 逐帧数据仅用于判断 Shell 几何，不能反向参与产品布局或业务决策。 */
type ShellFrames = Readonly<{ frames: number; badFrames: number; replacedHosts: number; emptyOutlets: number; examples: readonly string[] }>;

/** 单次浏览器观测提供只读快照和明确的资源清理入口。 */
type ShellMonitor = Readonly<{ snapshot: () => ShellFrames; finish: () => ShellFrames }>;

/** 持有原宿主身份，逐帧识别错误的紧凑轨道和异步内容交接空洞。 */
async function observeShell(page: Page): Promise<JSHandle<ShellMonitor>> {
	return await page.getByTestId('twitter-root').evaluateHandle(/** 原生矩形是验收事实，测试不读取 Vue 内部状态。 */ (root: HTMLElement): ShellMonitor => {
		const host: HTMLElement | null = root.querySelector('[data-twitter-scroll-viewport]');
		if (!host) throw new Error('Expected the existing Twitter scroll host');
		const originalHost: HTMLElement = host;
		let frames: number = 0;
		let badFrames: number = 0;
		let replacedHosts: number = 0;
		let emptyOutlets: number = 0;
		let frame: number = 0;
		const examples: string[] = [];

		/** 用户切换的是页面，外框只按当前路由形态及视口进入对应的最终几何。 */
		function sample(): void {
			frames++;
			if (!originalHost.isConnected || root.querySelector('[data-twitter-scroll-viewport]') !== originalHost) replacedHosts++;
			const main: HTMLElement | null = root.querySelector('[data-testid="twitter-main"]');
			const sidebar: HTMLElement | null = root.querySelector('[data-testid="twitter-sidebar"]');
			const outlet: HTMLElement | null = root.querySelector('[data-twitter-route-outlet]');
			if (!outlet || outlet.childElementCount === 0) emptyOutlets++;
			if (main) {
				const width: number = window.innerWidth;
				const viewportWidth: number = originalHost.clientWidth;
				const chat: boolean = window.location.pathname === '/chat' || window.location.pathname.startsWith('/chat/');
				const sidebarWidth: number = width <= 500 ? 0 : width >= 1280 ? 275 : 72;
				const mainWidth: number = width <= 500 ? viewportWidth : width >= 1280 && chat ? 950 : Math.min(600, viewportWidth - sidebarWidth);
				const frameWidth: number = sidebarWidth + mainWidth + (width >= 1280 && !chat ? 350 : 0);
				const mainLeft: number = (viewportWidth - frameWidth) / 2 + sidebarWidth;
				const rectangle: DOMRect = main.getBoundingClientRect();
				const error: number = Math.max(Math.abs(rectangle.width - mainWidth), Math.abs(rectangle.left - mainLeft), Math.abs((sidebar?.getBoundingClientRect().width ?? 0) - sidebarWidth));
				if (error > 1 || originalHost.scrollWidth - originalHost.clientWidth > 1) {
					badFrames++;
					if (examples.length < 8) examples.push(JSON.stringify({ path: location.pathname, width, viewportWidth, x: rectangle.left, actualWidth: rectangle.width, mainLeft, mainWidth, sidebar: sidebar?.getBoundingClientRect().width ?? null }));
				}
			} else badFrames++;
			frame = requestAnimationFrame(sample);
		}

		/** 快照只复制计数和无业务数据的失败几何。 */
		function snapshot(): ShellFrames { return { frames, badFrames, replacedHosts, emptyOutlets, examples: [...examples] }; }

		frame = requestAnimationFrame(sample);
		return { snapshot, finish: /** 每个用例在 finally 结束采样，不遗留跨导航计时器。 */ (): ShellFrames => { cancelAnimationFrame(frame); return snapshot(); } };
	});
}

/** 等待实际绘制次数，确保代码和查询等待阶段都进入了浏览器采样。 */
async function sampledFrames(monitor: JSHandle<ShellMonitor>, minimum: number): Promise<void> {
	await expect.poll(/** 不用固定 sleep 代替布局已经绘制的证据。 */ async (): Promise<number> => monitor.evaluate(/** 读取当前观测帧数。 */ (value: ShellMonitor): number => value.snapshot().frames)).toBeGreaterThanOrEqual(minimum);
}

/** 成功与失败的终态观测均落盘，列表 reporter 结束后仍可独立复核。 */
async function saveEvidence(info: TestInfo, name: string, value: unknown): Promise<void> {
	const path: string = info.outputPath(`${name}.json`);
	await writeFile(path, JSON.stringify(value, null, 2));
	await info.attach(name, { path, contentType: 'application/json' });
}

/** 单个真实 WAAPI 动画的当前状态，只包含表现参数。 */
type EntryMotion = Readonly<{ duration: number; opacity: number; playState: AnimationPlayState; connected: boolean; inOutlet: boolean }>;

/** 文档启动期间只记录具名动画数量和采样帧，不接触产品数据。 */
type StartupObservation = { frames: number; entries: number };

/** 测试专属窗口投影仅在当前浏览器上下文存在，不进入产品类型或持久化。 */
type StartupObservationWindow = Window & { __routeEntryStartupObservation?: StartupObservation };

/** 浏览器动画控制器只暂停／推进原动画用于采样，不伪造 animate 结果。 */
type MotionMonitor = Readonly<{
	count: () => number;
	states: () => readonly EntryMotion[];
	seek: (index: number, progress: number) => EntryMotion;
	finish: (index: number) => void;
	dispose: () => void;
}>;

/** 捕获指定的具名进场动画，排除趋势骨架与悬浮反馈。 */
async function observeMotion(page: Page, pause: boolean, id: string = 'twitter-route-entry'): Promise<JSHandle<MotionMonitor>> {
	return await page.evaluateHandle(/** 保存浏览器 Animation 原对象，采样后仍由产品生命周期取消和清理。 */ (input: { pause: boolean; id: string }): MotionMonitor => {
		const animations: Animation[] = [];
		let frame: number = 0;

		/** 每帧发现新动画；暂停发生在其有效播放周期内，便于复核真实中间帧。 */
		function collect(): void {
			for (const animation of document.getAnimations()) {
				if (animation.id !== input.id || animations.includes(animation)) continue;
				animations.push(animation);
				if (input.pause) animation.pause();
			}
			frame = requestAnimationFrame(collect);
		}

		/** 使用已确认的原动画对象读取应用后透明度，不从 keyframe 直接猜测画面。 */
		function inspect(animation: Animation): EntryMotion {
			const effect: KeyframeEffect | null = animation.effect instanceof KeyframeEffect ? animation.effect : null;
			const target: Element | null = effect?.target ?? null;
			return { duration: Number(effect?.getTiming().duration ?? 0), opacity: target ? Number.parseFloat(getComputedStyle(target).opacity) : 1, playState: animation.playState, connected: target?.isConnected ?? false, inOutlet: target?.closest('[data-twitter-route-outlet]') != null };
		}

		frame = requestAnimationFrame(collect);
		return {
			count: /** 只报告已实际建立的动画数量。 */ (): number => animations.length,
			states: /** 动画取消后的状态也保留，便于检查快速导航没有遗留任务。 */ (): readonly EntryMotion[] => animations.map(/** 每个动画仍读取原对象。 */ (animation: Animation): EntryMotion => inspect(animation)),
			seek: /** 调整原 WAAPI 时间坐标，不改写元素样式或动画定义。 */ (index: number, progress: number): EntryMotion => {
				const animation: Animation | undefined = animations[index];
				if (!animation) throw new Error('Expected a captured route entry animation');
				animation.currentTime = Number(animation.effect?.getTiming().duration ?? 0) * progress;
				return inspect(animation);
			},
			finish: /** 完成原动画，产品 finish 处理仍正常运行。 */ (index: number): void => { animations[index]?.finish(); },
			dispose: /** 只清理测试的观察帧，取消动作继续由产品拥有。 */ (): void => { cancelAnimationFrame(frame); },
		};
	}, { pause, id });
}

/** 单次表现交接必须包含有效起点、中间透明度和完整终态。 */
async function expectEntryMotion(monitor: JSHandle<MotionMonitor>, index: number, inOutlet: boolean = true): Promise<Readonly<{ start: EntryMotion; middle: EntryMotion; end: EntryMotion }>> {
	await expect.poll(/** 观察具名动画出现，不能以任意 CSS 骨架动画替代。 */ async (): Promise<number> => monitor.evaluate(/** 当前实际捕获数量。 */ (value: MotionMonitor): number => value.count())).toBeGreaterThan(index);
	const start: EntryMotion = await monitor.evaluate(/** 原动画起始帧。 */ (value: MotionMonitor, entry: number): EntryMotion => value.seek(entry, 0), index);
	const middle: EntryMotion = await monitor.evaluate(/** 原缓动在中点应产生实际可见的中间值。 */ (value: MotionMonitor, entry: number): EntryMotion => value.seek(entry, 0.5), index);
	const end: EntryMotion = await monitor.evaluate(/** 完整终态仍是同一原动画。 */ (value: MotionMonitor, entry: number): EntryMotion => value.seek(entry, 1), index);
	expect(start.duration).toBe(180);
	expect(start.opacity).toBeCloseTo(0.7, 2);
	expect(middle.opacity).toBeGreaterThan(start.opacity);
	expect(middle.opacity).toBeLessThan(end.opacity);
	expect(end.opacity).toBe(1);
	expect(start.connected).toBe(true);
	expect(start.inOutlet).toBe(inOutlet);
	await monitor.evaluate(/** 放行后不让测试暂停阻塞下一次页面交接。 */ (value: MotionMonitor, entry: number): void => { value.finish(entry); }, index);
	return { start, middle, end };
}

test.beforeEach(/** 每个用例独占隔离数据库，全部业务夹具均由真实后端建立。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	errors = [];
	page.on('pageerror', /** 视觉终态不能掩盖页面或动效清理中的未处理异常。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 900 });
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'entry_admin', 'entry-admin-password', true);
	viewer = await createAccount('entry_viewer', 'Entry Viewer');
	author = await createAccount('entry_author', 'Entry Author');
	const role: Misskey.entities.Role = await realApi(admin, 'admin/roles/create', {
		name: 'Route entry regression', description: 'Isolated real browser fixture', color: null, iconUrl: null, target: 'manual', condFormula: {}, isPublic: false, isModerator: false, isAdministrator: false, asBadge: false, canEditMembersByModerator: false, displayOrder: 0,
		policies: { chatAvailability: { useDefault: false, priority: 1, value: 'available' }, rateLimitFactor: { useDefault: false, priority: 1, value: 0.01 } },
	});
	for (const account of [viewer, author]) await realApi(admin, 'admin/roles/assign', { roleId: role.id, userId: account.id });
	viewer = { ...await realApi(viewer, 'i', {}), token: viewer.token };
	author = { ...await realApi(author, 'i', {}), token: author.token };
	await realApi(admin, 'admin/update-meta', { pinnedUsers: [author.username] });
	/** 真实回复产生用户通知；不使用会在数据库重置后执行邮件查询的关注通知任务。 */
	const note: Misskey.Endpoints['notes/create']['res'] = await realApi(viewer, 'notes/create', { text: 'Route entry real timeline fixture' });
	await realApi(author, 'notes/create', { text: 'Route entry real reply notification', replyId: note.createdNote.id });
});

test.afterEach(/** 所有场景从启动到最终交接都必须没有未处理异常。 */ (): void => { expect(errors).toEqual([]); });

test('冷首屏代码占位交接到真实私信根不播放主列进场', /** 从文档启动即逐帧观测，避免启动动画在页面 ready 前结束而被终态查询漏掉。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await page.addInitScript(/** 记录原生动画，不重写 animate 或任何产品页面状态。 */ (): void => {
		const startupWindow: StartupObservationWindow = window as StartupObservationWindow;
		const observation: StartupObservation = { frames: 0, entries: 0 };
		startupWindow.__routeEntryStartupObservation = observation;
		const seen: WeakSet<Animation> = new WeakSet<Animation>();
		let frame: number = 0;

		/** 整个首屏加载期间都只计数真实主列进场。 */
		function sample(): void {
			observation.frames++;
			for (const animation of document.getAnimations()) {
				if (animation.id === 'twitter-route-entry' && !seen.has(animation)) { seen.add(animation); observation.entries++; }
			}
			frame = requestAnimationFrame(sample);
		}

		frame = requestAnimationFrame(sample);
		window.addEventListener('pagehide', /** 文档离开时停止测试观察，不保留跨文档任务。 */ (): void => { cancelAnimationFrame(frame); }, { once: true });
	});
	const scripts: TransportGate = await holdTransport(page, '**/*', /** 仅延迟实际私信页面模块，Bootstrap 和 Shell 正常启动。 */ (request: Request): boolean => request.resourceType() === 'script' && /MessagesPage(?:\.vue|[-.])/.test(new URL(request.url()).pathname));
	try {
		await openSession(page, '/chat');
		await scripts.reached;
		await expect(page.getByTestId('twitter-route-loading')).toBeVisible();
		await page.waitForFunction(/** 首屏占位已经实际绘制多帧后才放行真实模块。 */ (): boolean => ((window as StartupObservationWindow).__routeEntryStartupObservation?.frames ?? 0) >= 10);
		scripts.release();
		await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
		await page.waitForLoadState('networkidle');
		const observation: StartupObservation | undefined = await page.evaluate(/** 只回传本次文档的无业务数据计数。 */ (): StartupObservation | undefined => (window as StartupObservationWindow).__routeEntryStartupObservation);
		expect(observation?.frames).toBeGreaterThan(10);
		expect(observation?.entries).toBe(0);
		await saveEvidence(info, 'startup-without-route-motion', observation);
	} finally { scripts.release(); }
});

for (const width of [1440, 1280, 1279, 501, 500, 390] as const) {
	test(`${width}px 冷私信返回通知和时间线全程保持最终布局`, /** 分别延迟真实代码与真实通知查询，捕捉旧元信息造成的中间轨道。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await page.setViewportSize({ width, height: 900 });
		await openSession(page, '/chat');
		await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
		const scripts: TransportGate = await holdTransport(page, '**/*', /** 只持有尚未加载的真实脚本，不阻断认证和通知 API。 */ (request: Request): boolean => request.resourceType() === 'script');
		const notifications: TransportGate = await holdTransport(page, '**/api/i/notifications*');
		const monitor: JSHandle<ShellMonitor> = await observeShell(page);
		try {
			await navigation(page, '/my/notifications').click();
			await scripts.reached;
			await expect(page.getByTestId('twitter-route-loading')).toBeVisible();
			await sampledFrames(monitor, 4);
			scripts.release();
			await notifications.reached;
			await expect(page.getByTestId('twitter-notifications').getByRole('status')).toBeVisible();
			await sampledFrames(monitor, 8);
			notifications.release();
			await expect(page.getByTestId('twitter-notifications')).toContainText('Entry Author');
			await navigation(page, '/').click();
			await expect(page.getByTestId('twitter-timeline').getByTestId('twitter-note')).toContainText('Route entry real timeline fixture');
			await sampledFrames(monitor, 12);
		} finally {
			scripts.release();
			notifications.release();
			const frames: ShellFrames = await monitor.evaluate(/** 最终释放观测并取回整个导航期间的证据。 */ (value: ShellMonitor): ShellFrames => value.finish());
			await monitor.dispose();
			await saveEvidence(info, 'cold-route-layout', frames);
			expect(frames.frames).toBeGreaterThan(0);
			expect(frames.badFrames, frames.examples.join('\n')).toBe(0);
			expect(frames.replacedHosts).toBe(0);
			expect(frames.emptyOutlets).toBe(0);
		}
	});
}

test('普通暖导航及私信往返保留右栏实例、查询、可访问边界和草稿', /** 节点身份和真实 API 次数证明生命周期稳定，不把缓存截图当成业务状态。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	/** 只统计右栏协议，不保存请求体或认证信息。 */
	let railRequests: number = 0;
	page.on('request', /** 路由页面查询不能计为右栏重取。 */ (request: Request): void => { if (/\/api\/(?:hashtags\/trend|users\/recommendation|pinned-users)$/.test(request.url())) railRequests++; });
	await openSession(page);
	await expect(page.getByTestId('twitter-note')).toContainText('Route entry real timeline fixture');
	const rail: Locator = page.getByTestId('twitter-right-rail');
	await expect(rail).toBeVisible();
	await page.waitForLoadState('networkidle');
	const originalRail: JSHandle<HTMLElement> = await rail.evaluateHandle(/** 只保留实际 DOM 身份。 */ (element: HTMLElement): HTMLElement => element);
	const requestsAfterLoad: number = railRequests;
	await rail.locator('input[name="q"]').fill('retained unsent rail search');
	const monitor: JSHandle<ShellMonitor> = await observeShell(page);
	const railMotion: JSHandle<MotionMonitor> = await observeMotion(page, true, 'twitter-rail-entry');
	try {
		await navigation(page, '/my/notifications').click();
		await expect(page.getByTestId('twitter-notifications')).toContainText('Entry Author');
		expect(await originalRail.evaluate(/** 普通页面暖切换应复用同一栏，不重复创建查询所有者。 */ (element: HTMLElement): boolean => document.querySelector('[data-testid="twitter-right-rail"]') === element)).toBe(true);
		await navigation(page, '/chat').click();
		await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
		await expect(rail).toBeHidden();
		await expect(rail).toHaveAttribute('inert', '');
		await expect(rail).toHaveAttribute('aria-hidden', 'true');
		await rail.evaluate(/** 隐藏栏即使被请求聚焦，也不能抢占当前私信页面焦点。 */ (element: HTMLElement): void => { element.querySelector<HTMLInputElement>('input')?.focus(); });
		expect(await rail.evaluate(/** focus 隔离必须实际生效，而不只是添加一个样式类。 */ (element: HTMLElement): boolean => element.contains(document.activeElement))).toBe(false);
		await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveCount(0);
		await realApi(author, 'chat/messages/create-to-user', { toUserId: viewer.id, text: 'Unread inbox remains authoritative' });
		await expect.poll(/** 仅打开收件箱不能清除真实未读。 */ async (): Promise<boolean> => (await realApi(viewer, 'i', {})).hasUnreadChatMessages).toBe(true);
		await page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'Entry Author' }).click();
		const composer: Locator = page.getByTestId('twitter-message-composer').getByRole('textbox');
		await composer.fill('route-entry-private-draft');
		await navigation(page, '/').click();
		await expect(page.getByTestId('twitter-note')).toBeVisible();
		await expect(rail).toBeVisible();
		await expect(rail).not.toHaveAttribute('inert', '');
		await expect(rail).not.toHaveAttribute('aria-hidden', 'true');
		const railEntry: Awaited<ReturnType<typeof expectEntryMotion>> = await expectEntryMotion(railMotion, 0, false);
		expect(await originalRail.evaluate(/** 重新显示的是原栏与原搜索输入。 */ (element: HTMLElement): boolean => document.querySelector('[data-testid="twitter-right-rail"]') === element)).toBe(true);
		await expect(rail.locator('input[name="q"]')).toHaveValue('retained unsent rail search');
		await expect.poll(/** 右栏重新可见后，吸顶偏移重新消费其真实高度。 */ async (): Promise<number> => rail.evaluate(/** 对照实际 DOM 高度，不解释业务查询数据。 */ (element: HTMLElement): number => Math.abs(Number.parseFloat(getComputedStyle(element).getPropertyValue('--twitter-rail-height')) - element.offsetHeight))).toBeLessThanOrEqual(1);
		await page.waitForLoadState('networkidle');
		expect(railRequests).toBe(requestsAfterLoad);
		await saveEvidence(info, 'restored-rail-motion', railEntry);
		await navigation(page, '/chat').click();
		await page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'Entry Author' }).click();
		await expect(composer).toHaveValue('route-entry-private-draft');
	} finally {
		const frames: ShellFrames = await monitor.evaluate(/** 所有暖导航和私信往返使用同一个几何观测窗口。 */ (value: ShellMonitor): ShellFrames => value.finish());
		await monitor.dispose();
		await railMotion.evaluate(/** 结束右栏表现的独立观察，避免与主列动效混淆。 */ (value: MotionMonitor): void => { value.dispose(); });
		await railMotion.dispose();
		await originalRail.dispose();
		await saveEvidence(info, 'warm-rail-lifecycle', { frames, requestsAfterLoad, railRequests });
		expect(frames.badFrames, frames.examples.join('\n')).toBe(0);
		expect(frames.replacedHosts).toBe(0);
	}
});

test('代码占位与真实通知根分别执行可见的180ms进场', /** 采样原 WAAPI 的起点、中点和终点，API 加载完成不能再次播放整页动效。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openSession(page, '/chat');
	await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
	await page.waitForLoadState('networkidle');
	const scripts: TransportGate = await holdTransport(page, '**/*', /** 此时只阻断尚未加载的路由代码。 */ (request: Request): boolean => request.resourceType() === 'script');
	const notifications: TransportGate = await holdTransport(page, '**/api/i/notifications*');
	const monitor: JSHandle<MotionMonitor> = await observeMotion(page, true);
	try {
		await navigation(page, '/my/notifications').click();
		await scripts.reached;
		await expect(page.getByTestId('twitter-route-loading')).toBeVisible();
		const fallback: Awaited<ReturnType<typeof expectEntryMotion>> = await expectEntryMotion(monitor, 0);
		scripts.release();
		await notifications.reached;
		await expect(page.getByTestId('twitter-notifications').getByRole('status')).toBeVisible();
		const pageEntry: Awaited<ReturnType<typeof expectEntryMotion>> = await expectEntryMotion(monitor, 1);
		notifications.release();
		await expect(page.getByTestId('twitter-notifications')).toContainText('Entry Author');
		await page.waitForLoadState('networkidle');
		expect(await monitor.evaluate(/** 正文查询更新不能误判成新页面根。 */ (value: MotionMonitor): number => value.count())).toBe(2);
		await saveEvidence(info, 'fallback-page-motion', { fallback, pageEntry });
	} finally {
		scripts.release(); notifications.release();
		await monitor.evaluate(/** 释放测试的动画发现循环。 */ (value: MotionMonitor): void => { value.dispose(); });
		await monitor.dispose();
	}
});

test('快速导航取消旧进场，运行时减少动态效果立即生效且恢复不补播', /** 三个已加载页面在动画中途导航，验证最终路由拥有唯一活动表现。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openSession(page);
	await navigation(page, '/my/notifications').click();
	await expect(page.getByTestId('twitter-notifications')).toContainText('Entry Author');
	await navigation(page, '/chat').click();
	await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
	await navigation(page, '/').click();
	await expect(page.getByTestId('twitter-note')).toBeVisible();
	await page.waitForLoadState('networkidle');
	const monitor: JSHandle<MotionMonitor> = await observeMotion(page, true);
	try {
		await navigation(page, '/my/notifications').click();
		await expect.poll(/** 暖页面仍实际产生一次进场。 */ async (): Promise<number> => monitor.evaluate(/** 捕获的原动画数量。 */ (value: MotionMonitor): number => value.count())).toBe(1);
		await monitor.evaluate(/** 在真实动效中途开始下一次导航。 */ (value: MotionMonitor): void => { value.seek(0, 0.5); });
		await navigation(page, '/chat').click();
		await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
		await expect.poll(/** 第二次进场必须对应新页面。 */ async (): Promise<number> => monitor.evaluate(/** 累计保留被取消的旧对象。 */ (value: MotionMonitor): number => value.count())).toBe(2);
		await navigation(page, '/').click();
		await expect(page.getByTestId('twitter-note')).toBeVisible();
		await expect.poll(/** 最后一次导航建立自己的表现任务。 */ async (): Promise<number> => monitor.evaluate(/** 原生动画的实际数量。 */ (value: MotionMonitor): number => value.count())).toBe(3);
		const beforeReduce: readonly EntryMotion[] = await monitor.evaluate(/** 旧动画必须已取消，即使它的缓存 DOM 仍然连接文档。 */ (value: MotionMonitor): readonly EntryMotion[] => value.states());
		expect(beforeReduce.slice(0, -1).every(/** 动画取消由产品处理，不由测试 finish 掩盖。 */ (entry: EntryMotion): boolean => entry.playState === 'idle')).toBe(true);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect.poll(/** 媒体偏好在运行时改变也必须取消当前暂停动画。 */ async (): Promise<boolean> => monitor.evaluate(/** 检查全部原对象终止。 */ (value: MotionMonitor): boolean => value.states().every(/** 旧任务都应回到取消状态。 */ (entry: EntryMotion): boolean => entry.playState === 'idle'))).toBe(true);
		await navigation(page, '/my/notifications').click();
		await expect(page.getByTestId('twitter-notifications')).toBeVisible();
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.waitForLoadState('networkidle');
		expect(await monitor.evaluate(/** 偏好恢复不能给已呈现页面补播历史进场。 */ (value: MotionMonitor): number => value.count())).toBe(3);
		await saveEvidence(info, 'rapid-navigation-motion', { beforeReduce, afterReduce: await monitor.evaluate(/** 只保存无业务数据的表现终态。 */ (value: MotionMonitor): readonly EntryMotion[] => value.states()) });
	} finally {
		await monitor.evaluate(/** 释放测试采样资源，产品仍负责动画取消。 */ (value: MotionMonitor): void => { value.dispose(); });
		await monitor.dispose();
	}
});

for (const mode of ['system-reduce', 'preference-off'] as const) {
	test(`${mode} 启动及导航没有路由进场动效`, /** 两项既有偏好均只能改变表现，不能改变页面终态和导航。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		if (mode === 'system-reduce') await page.emulateMedia({ reducedMotion: 'reduce' });
		await openSession(page, '/', mode !== 'preference-off');
		await expect(page.getByTestId('twitter-note')).toBeVisible();
		const monitor: JSHandle<MotionMonitor> = await observeMotion(page, false);
		try {
			await navigation(page, '/my/notifications').click();
			await expect(page.getByTestId('twitter-notifications')).toContainText('Entry Author');
			await navigation(page, '/chat').click();
			await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
			await navigation(page, '/').click();
			await expect(page.getByTestId('twitter-note')).toBeVisible();
			await page.waitForLoadState('networkidle');
			expect(await monitor.evaluate(/** 只检查新增进场，不把其他功能的动画计入本次范围。 */ (value: MotionMonitor): number => value.count())).toBe(0);
		} finally {
			await monitor.evaluate(/** 清理只读采样循环。 */ (value: MotionMonitor): void => { value.dispose(); });
			await monitor.dispose();
		}
	});
}
