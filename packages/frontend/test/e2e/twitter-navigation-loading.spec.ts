/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：四条 Twitter 主路径的加载连续性真实后端回归。
 * 作用：区分代码等待、实体等待、列表等待与刷新，逐帧检查主题及宿主稳定性。
 * 数据链：真实账号／频道／帖子 → 延迟真实传输 → 原页面 → DOM 观测；不伪造业务响应。
 */
import { expect, test } from '@playwright/test';
import type { JSHandle, Locator, Page, PlaywrightTestArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState, acceptSignupRules, locateMkInput, closeUserSetupDialog } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 每个用例独占真实夹具，不读取开发账号或复用其他测试状态。 */
let admin: RegisteredUser;
let viewer: AccountWithToken;
let author: AccountWithToken;
let channel: Misskey.entities.Channel;
let errors: string[];

/** 一次可释放的传输闸门，不保存任何接口数据。 */
type TransportGate = Readonly<{ reached: Promise<void>; release: () => void }>;
/** 只记录视觉边界的观测值，不包含页面业务实体。 */
type NavigationFrames = Readonly<{ frames: number; wrongBackground: number; replacedHost: number; emptyOutlet: number }>;
/** 浏览器内单次观测的公开结束动作。 */
type NavigationMonitor = Readonly<{ finish: () => NavigationFrames }>;

/** 持有符合条件的真实请求，测试明确放行之后才继续原传输。 */
async function holdTransport(page: Page, pattern: string, matches: (request: Request) => boolean = /** 默认持有匹配 URL 的真实请求。 */ (): boolean => true): Promise<TransportGate> {
	let release: () => void = /** 闸门建立前没有待释放任务。 */ (): void => {};
	let reached: () => void = /** 首个匹配请求到达后才有可见等待阶段。 */ (): void => {};
	const waiting: Promise<void> = new Promise<void>(/** 保存测试的显式放行入口。 */ (resolve: () => void): void => { release = resolve; });
	const arrived: Promise<void> = new Promise<void>(/** 保存请求开始的通知入口。 */ (resolve: () => void): void => { reached = resolve; });
	await page.route(pattern, /** 只调整时序，不替换接口内容。 */ async (route: Route): Promise<void> => {
		if (matches(route.request())) { reached(); await waiting; }
		await route.continue();
	});
	return { reached: arrived, release };
}

/** 从导航前开始观测，任何一帧错误底色／替换宿主／空出口都会计数。 */
async function monitorNavigation(page: Page): Promise<JSHandle<NavigationMonitor>> {
	return page.getByTestId('twitter-root').evaluateHandle(/** 仅观测实际 DOM，结束时释放动画帧。 */ (root: HTMLElement): NavigationMonitor => {
		const host: HTMLElement | null = root.querySelector('[data-twitter-scroll-viewport]');
		if (host == null) throw new Error('Missing Twitter scroll host');
		const scrollHost: HTMLElement = host;
		let frames: number = 0;
		let wrongBackground: number = 0;
		let replacedHost: number = 0;
		let emptyOutlet: number = 0;
		let frame: number = 0;

		/** 检查加载交接本身，不以最终截图代替过程验证。 */
		function sample(): void {
			frames++;
			if (!root.isConnected || root.querySelector('[data-twitter-scroll-viewport]') !== scrollHost) replacedHost++;
			const outlet: HTMLElement | null = scrollHost.querySelector('[data-twitter-route-outlet]');
			if (outlet == null || outlet.childElementCount === 0) emptyOutlet++;
			else if (getComputedStyle(outlet).backgroundColor !== getComputedStyle(scrollHost).backgroundColor) wrongBackground++;
			frame = requestAnimationFrame(sample);
		}

		frame = requestAnimationFrame(sample);
		return { finish: /** 在当前文档结束观测，不遗留跨测试任务。 */ (): NavigationFrames => {
			cancelAnimationFrame(frame);
			return { frames, wrongBackground, replacedHost, emptyOutlet };
		} };
	});
}

/** 结束逐帧观测并确认每个被采样的加载阶段都保有主题与宿主。 */
async function expectContinuous(monitor: JSHandle<NavigationMonitor>): Promise<void> {
	const result: NavigationFrames = await monitor.evaluate(/** 只取回无业务数据的计数。 */ (value: NavigationMonitor): NavigationFrames => value.finish());
	await monitor.dispose();
	expect(result.frames).toBeGreaterThan(0);
	expect(result.wrongBackground).toBe(0);
	expect(result.replacedHost).toBe(0);
	expect(result.emptyOutlet).toBe(0);
}

/** 在浏览器原有缓存协议中放入真实会话，后续认证仍由真实后端处理。 */
async function openSession(page: Page, path: string = '/'): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 夹具只使用现有账户及语言持久化格式。 */ (account: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(account));
		localStorage.setItem('lang', 'en-US');
	}, viewer);
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=twitter`);
	await expect(page.getByTestId('twitter-scroll-viewport')).toBeVisible();
}

/** 使用同一主导航完成 SPA 切换，移动端消费底栏的实际链接。 */
function navigationLink(page: Page, path: string): Locator {
	return page.locator(`[data-testid="twitter-sidebar"] a[href="${path}"], [data-testid="twitter-mobile-bar"] a[href="${path}"]`).filter({ visible: true }).last();
}

test.beforeEach(/** 各场景重建独立实例内的真实资料与查询结果。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'loading_admin', 'loading-admin-password', true);
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, name: 'Loading Regression', disableRegistration: false, emailRequiredForSignup: false });
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'loading_viewer', password: 'loading-password' });
	author = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'loading_author', password: 'loading-password' });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	channel = await api(BASE_URL, 'channels/create', { i: author.token, name: 'Loading channel', description: 'Real channel description' });
	await api(BASE_URL, 'notes/create', { i: author.token, channelId: channel.id, text: 'Real channel post' });
	await api(BASE_URL, 'notes/create', { i: viewer.token, text: 'Real profile post' });
	await api(BASE_URL, 'following/create', { i: author.token, userId: viewer.id });
	errors = [];
	page.on('pageerror', /** 不屏蔽渲染与异步错误。 */ (error: Error): void => { errors.push(error.message); });
});

test.afterEach(/** 首帧至结束都不得存在未处理异常。 */ (): void => { expect(errors).toEqual([]); });

test('冷频道代码等待使用主题一致占位，API 等待始终有频道骨架', /** 两段加载分别持有，证明不能只靠预加载掩盖缺失状态。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openSession(page, '/channels');
	await page.getByRole('tab', { name: 'Explore', exact: true }).click();
	const link: Locator = page.locator(`a[href="/channels/${channel.id}"]`).first();
	await expect(link).toBeVisible();
	const code: TransportGate = await holdTransport(page, '**/*', /** 只阻断本次导航尚未加载的脚本。 */ (request: Request): boolean => request.resourceType() === 'script');
	const data: TransportGate = await holdTransport(page, '**/api/channels/show');
	const monitor: JSHandle<NavigationMonitor> = await monitorNavigation(page);
	try {
		await link.click();
		await code.reached;
		await expect(page.getByTestId('twitter-route-loading')).toBeVisible();
		await page.screenshot({ path: info.outputPath('channel-code-pending.png') });
		code.release();
		await data.reached;
		await expect(page.getByTestId('twitter-channel-loading')).toBeVisible();
		await expect(page.getByTestId('twitter-channel-header')).toBeVisible();
		await page.screenshot({ path: info.outputPath('channel-api-pending.png') });
		data.release();
		await expect(page.getByTestId('twitter-channel').getByRole('heading', { name: channel.name, exact: true }).last()).toBeVisible();
		await expect(page.getByTestId('twitter-channel-loading')).toHaveCount(0);
		await expectContinuous(monitor);
	} finally { code.release(); data.release(); }
});

for (const width of [1440, 390]) {
	test(`资料、时间线和通知在 ${width}px API 等待时保留页头及有效加载反馈`, /** 三条主路径都通过真实入口进入，各自等待真实接口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await page.setViewportSize({ width, height: 1000 });
		await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' });
		const timeline: TransportGate = await holdTransport(page, '**/api/notes/timeline');
		await openSession(page);
		await timeline.reached;
		await expect(page.getByTestId('twitter-timeline').getByRole('status')).toBeVisible();
		await page.screenshot({ path: info.outputPath('timeline-api-pending.png') });
		timeline.release();
		await expect(page.getByTestId('twitter-timeline').getByTestId('twitter-note')).toBeVisible();
		const profile: TransportGate = await holdTransport(page, '**/api/users/show');
		const monitor: JSHandle<NavigationMonitor> = await monitorNavigation(page);
		try {
			await navigationLink(page, `/@${viewer.username}`).click();
			await profile.reached;
			await expect(page.getByTestId('twitter-profile-header')).toBeVisible();
			await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
			await page.screenshot({ path: info.outputPath('profile-api-pending.png') });
			profile.release();
			await expect(page.getByTestId('twitter-profile')).toBeVisible();
			await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('Real profile post');
			const notifications: TransportGate = await holdTransport(page, '**/api/i/notifications*');
			try {
				await navigationLink(page, '/my/notifications').click();
				await notifications.reached;
				await expect(page.getByTestId('twitter-notifications').getByRole('status')).toBeVisible();
				await page.screenshot({ path: info.outputPath('notifications-api-pending.png') });
				notifications.release();
				await expect(page.getByTestId('twitter-notifications')).toContainText('loading_author');
			} finally { notifications.release(); }
			await expectContinuous(monitor);
		} finally { profile.release(); }
	});
}

test('频道首拉失败提供显式重试，成功空集合不解释为失败', /** 仅首次中断传输，重试后继续使用真实后端。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	let fail: boolean = true;
	await page.route('**/api/channels/show', /** 后端结果不替换；失败后不自动循环请求。 */ async (route: Route): Promise<void> => {
		if (fail) { fail = false; await route.abort(); } else await route.continue();
	});
	await openSession(page, `/channels/${channel.id}`);
	await expect(page.getByTestId('twitter-channel-error').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	await expect(page.getByTestId('twitter-channel-header')).toBeVisible();
	await page.getByTestId('twitter-channel-error').getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.getByTestId('twitter-channel-error')).toHaveCount(0);
	await expect(page.getByTestId('twitter-channel')).toContainText('No notes');
});

test('收藏未关注频道和关注取关后始终停留合法标签', /** 收藏与关注分别由真实接口建立，不将二者合并为同一事实。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await api(BASE_URL, 'channels/favorite', { i: viewer.token, channelId: channel.id });
	await openSession(page, `/channels/${channel.id}`);
	const root: Locator = page.getByTestId('twitter-channel');
	await expect(root.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(root.getByRole('tab', { name: 'Home', exact: true })).toHaveCount(0);
	await root.getByRole('button', { name: 'Follow', exact: true }).click();
	await expect(root.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute('aria-selected', 'true');
	await root.getByRole('button', { name: 'Unfollow', exact: true }).click();
	await expect(root.getByRole('tab', { name: 'Home', exact: true })).toHaveCount(0);
	await expect(root.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('个人资料缓存回访刷新期间保留原列表，失败后可重试', /** 保留的是唯一查询所有者现有集合，不能只是截图或额外副本。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSession(page, `/@${viewer.username}`);
	const notes: Locator = page.getByTestId('twitter-user-timeline-notes');
	await expect(notes).toContainText('Real profile post');
	await navigationLink(page, '/my/notifications').click();
	await expect(page.getByTestId('twitter-notifications')).toBeVisible();
	const pending: TransportGate = await holdTransport(page, '**/api/users/notes');
	try {
		await page.goBack();
		await pending.reached;
		await expect(notes).toContainText('Real profile post');
		await expect(notes.getByRole('status', { name: 'Loading' })).toHaveCount(0);
		pending.release();
		await expect(notes).toContainText('Real profile post');
	} finally { pending.release(); }
	await navigationLink(page, '/my/notifications').click();
	await expect(page.getByTestId('twitter-notifications')).toBeVisible();
	let fail: boolean = true;
	await page.route('**/api/users/notes', /** 只中断普通帖面板第一次回访，隐藏面板与重试仍使用真实响应。 */ async (route: Route): Promise<void> => {
		const body: { withRenotes?: boolean } = route.request().postDataJSON() as { withRenotes?: boolean };
		if (fail && body.withRenotes) { fail = false; await route.abort(); } else await route.continue();
	});
	await page.goBack();
	await expect(notes.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	await expect(notes).toContainText('Real profile post');
	await notes.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(notes.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
	await expect(notes).toContainText('Real profile post');
});

test('个人资料回访新增帖子占满首批后仍确认原窗口末帖', /** 真实新增超过首批容量，证明刷新范围按原末标识延伸而非仅保留原数量。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSession(page, `/@${viewer.username}`);
	const notes: Locator = page.getByTestId('twitter-user-timeline-notes');
	await expect(notes).toContainText('Real profile post');
	await navigationLink(page, '/my/notifications').click();
	await expect(page.getByTestId('twitter-notifications')).toBeVisible();
	for (let index: number = 0; index < 20; index++) {
		await api(BASE_URL, 'notes/create', { i: viewer.token, text: `New profile window ${index}` });
	}
	await page.goBack();
	await expect(notes).toContainText('New profile window 19');
	await expect(notes).toContainText('Real profile post');
});

test('个人资料翻页在途时修改排序不会丢失新查询', /** 控制栏直接调用分页所有者，必须等待旧分页后确认新范围。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	for (let index: number = 0; index < 35; index++) {
		await api(BASE_URL, 'notes/create', { i: viewer.token, text: `Profile pagination ${index}` });
	}
	await openSession(page, `/@${viewer.username}`);
	const notes: Locator = page.getByTestId('twitter-user-timeline-notes');
	await expect(notes.getByTestId('twitter-note')).toHaveCount(20);
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	const older: TransportGate = await holdTransport(page, '**/api/users/notes', /** 仅持有真实向后翻页，首批新查询正常放行。 */ (request: Request): boolean => {
		const body: Misskey.Endpoints['users/notes']['req'] = request.postDataJSON() as Misskey.Endpoints['users/notes']['req'];
		return body.untilId != null;
	});
	try {
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 使用原生滚动触发现有自动分页。 */ (node: HTMLElement): void => { node.scrollTop = node.scrollHeight; });
		await older.reached;
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 返回控制栏操作排序，避免吸顶头覆盖屏外控件。 */ (node: HTMLElement): void => { node.scrollTop = 0; });
		await notes.locator('[tabindex="0"]').filter({ has: page.getByText('Newest First', { exact: true }) }).first().click();
		const confirmed: Promise<Response> = page.waitForResponse(/** 新排序必须通过原协议真正向后端确认，不能只反转旧数组。 */ (response: Response): boolean => {
			if (!response.url().endsWith('/api/users/notes') || !response.ok()) return false;
			const body: Misskey.Endpoints['users/notes']['req'] = response.request().postDataJSON() as Misskey.Endpoints['users/notes']['req'];
			return body.sinceId === '0';
		});
		await page.getByRole('menuitem', { name: 'Oldest First', exact: true }).click();
		older.release();
		const result: Misskey.entities.Note[] = await (await confirmed).json() as Misskey.entities.Note[];
		expect(result.length).toBeGreaterThan(0);
		await expect(notes.getByTestId('twitter-note')).toHaveCount(result.length);
		await expect(notes.getByTestId('twitter-note').first()).toHaveAttribute('data-note-id', result[0].id);
	} finally { older.release(); }
});

test('新用户通过注册登录进入频道后保持完整加载链', /** 用户报告的实际入口必须经过原注册与登录流程。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.goto(`${BASE_URL}/?ui=twitter`);
	await page.getByTestId('signup').click();
	await acceptSignupRules(page);
	await locateMkInput(page, 'signup-username').fill('loading_signup');
	await locateMkInput(page, 'signup-password').fill('loading-signup-password');
	await locateMkInput(page, 'signup-password-retype').fill('loading-signup-password');
	await page.getByTestId('signup-submit').click();
	await expect(page.getByTestId('twitter-scroll-viewport')).toBeVisible();
	await expect(page.getByTestId('user-setup-dialog').getByTestId('modal-window-close')).toBeVisible();
	await closeUserSetupDialog(page);
	await navigationLink(page, '/channels').click();
	await page.getByRole('tab', { name: 'Explore', exact: true }).click();
	await page.locator(`a[href="/channels/${channel.id}"]`).first().click();
	await expect(page.getByTestId('twitter-channel')).toContainText(channel.name);
	await expect(page.getByTestId('twitter-channel-loading')).toHaveCount(0);
});

/** 通过真实反应形成热门；以真实查询确认结果，避免假定后端概率更新一定执行。 */
async function confirmFeatured(note: Misskey.entities.Note): Promise<void> {
	for (let attempt: number = 0; attempt < 80; attempt++) {
		await api(BASE_URL, 'notes/reactions/create', { i: viewer.token, noteId: note.id, reaction: '👍' });
		const featured: Misskey.entities.Note[] = await api(BASE_URL, 'notes/featured', { i: viewer.token, channelId: channel.id, limit: 100 });
		if (featured.some(/** 只接受服务端实际返回的热门成员。 */ (value: Misskey.entities.Note): boolean => value.id === note.id)) return;
		await api(BASE_URL, 'notes/reactions/delete', { i: viewer.token, noteId: note.id });
	}
	throw new Error('Real backend did not publish the reacted note to featured results');
}

test('频道热门回访刷新跨过旧末标识，保留旧帖直至完整窗口确认', /** 新帖占满首屏后仍必须通过真实分页保留原窗口及滚动锚点。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const old: Misskey.entities.NotesCreateResponse = await api(BASE_URL, 'notes/create', { i: author.token, channelId: channel.id, text: 'Retained featured anchor' });
	await confirmFeatured(old.createdNote);
	await openSession(page, `/channels/${channel.id}`);
	const featured: Locator = page.getByTestId('twitter-channel-featured');
	await expect(featured).toContainText('Retained featured anchor');
	await navigationLink(page, '/my/notifications').click();
	await expect(page.getByTestId('twitter-notifications')).toBeVisible();
	for (let index: number = 0; index < 10; index++) {
		const next: Misskey.entities.NotesCreateResponse = await api(BASE_URL, 'notes/create', { i: author.token, channelId: channel.id, text: `New featured ${index}` });
		await confirmFeatured(next.createdNote);
	}
	const pending: TransportGate = await holdTransport(page, '**/api/notes/featured');
	try {
		await page.goBack();
		await pending.reached;
		await expect(featured).toContainText('Retained featured anchor');
		pending.release();
		await expect(featured).toContainText('New featured 9');
		await expect(featured).toContainText('Retained featured anchor');
	} finally { pending.release(); }
});

test('仅聚焦资料入口预热代码，不提前读取用户业务数据', /** 首次意图可以加载代码，但不能变成业务查询或导航副作用。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSession(page);
	await expect(page.getByTestId('twitter-timeline').getByTestId('twitter-note')).toBeVisible();
	const businessReads: string[] = [];
	page.on('request', /** 只记录相关 API 路径，不收集请求内容。 */ (request: Request): void => {
		const path: string = new URL(request.url()).pathname;
		if (path === '/api/users/show' || path === '/api/users/notes') businessReads.push(path);
	});
	await navigationLink(page, `/@${viewer.username}`).focus();
	await page.evaluate(/** 让模块任务获得浏览器执行机会，不以固定时长决定产品行为。 */ async (): Promise<void> => {
		await new Promise<void>(/** 两帧足够确认入口未启动同步业务请求。 */ (resolve: () => void): void => { requestAnimationFrame(/** 等待下一次绘制提交。 */ (): void => { requestAnimationFrame(/** 结束本次观察窗口。 */ (): void => { resolve(); }); }); });
	});
	expect(businessReads).toEqual([]);
	await expect(page.getByTestId('twitter-timeline')).toBeVisible();
});
