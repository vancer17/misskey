/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 私信真实后端交互回归。
 * 隔离实例内的真实账户、消息、群成员和网盘文件经过产品 UI 与真实流式通道验证；
 * 不伪造 HTTP 业务响应，不访问开发账户，数据库重置仅使用专用 61812 测试实例。
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import type { APIResponse, Browser, BrowserContext, JSHandle, Locator, Page, PlaywrightTestArgs, PlaywrightWorkerArgs, Request, Response, Route, TestInfo, WebSocket, WebSocketRoute } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { PossiblyNonNormalizedPreferencesProfile } from '../../src/preferences/manager.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 每个用例的管理者只操作隔离数据库。 */
let admin: RegisteredUser;
/** 第一位真实普通用户。 */
let alice: AccountWithToken;
/** 第二位真实普通用户用于双向消息和独立浏览器会话。 */
let bob: AccountWithToken;
/** 第三位用户用于草稿隔离及接收策略验证。 */
let carol: AccountWithToken;
/** 只收集异常文本，绝不记录认证请求内容。 */
let errors: string[];

/** 通过共享传输调用真实后端，响应类型始终来自生成的权威协议。 */
async function realApi<E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(account: RegisteredUser, endpoint: E, params: P): Promise<Misskey.api.SwitchCaseResponseType<E, P>> {
	return await api(BASE_URL, endpoint, { ...params, i: account.token }) as Misskey.api.SwitchCaseResponseType<E, P>;
}

/** 创建真实用户，明确设置接收策略并保留服务端签发的完整账户快照。 */
async function createAccount(username: string, name: string): Promise<AccountWithToken> {
	const account: Misskey.Endpoints['admin/accounts/create']['res'] = await realApi(admin, 'admin/accounts/create', { username, password: 'dm-test-password' });
	await realApi(account, 'i/update', { name, chatScope: 'everyone' });
	await realApi(account, 'i/registry/set', { scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	const me: Misskey.entities.MeDetailed = await realApi(account, 'i', {});
	return { ...me, token: account.token };
}

/** 监听所有参与测试的页面未处理异常。 */
function observeErrors(page: Page): void {
	page.on('pageerror', /** 不把包含认证上下文的请求或页面对象输出到结果。 */ (error: Error): void => { errors.push(error.message); });
}

/** 注入产品已有会话格式，实际 API 与 WebSocket 仍由真实后端认证。 */
async function openAs(page: Page, account: AccountWithToken, path: string = '/chat', twitter: boolean = true, stacked: boolean = false): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 偏好只决定页面出口，不修改领域规则。 */ (input: { account: AccountWithToken; twitter: boolean; stacked: boolean }): void => {
		const preferences: PossiblyNonNormalizedPreferencesProfile = {
			id: 'messages-regression', version: '1', type: 'main', modifiedAt: Date.now(), name: 'Messages regression',
			preferences: { 'experimental.stackingRouterView': [[{}, input.stacked, {}]] },
		};
		window.localStorage.setItem('account', JSON.stringify(input.account));
		window.localStorage.setItem('lang', 'ja-JP');
		window.localStorage.setItem('preferences', JSON.stringify(preferences));
		window.localStorage.setItem('ui', input.twitter ? 'twitter' : 'universal');
	}, { account, twitter, stacked });
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=${twitter ? 'twitter' : 'default'}`);
	if (twitter && path.startsWith('/chat')) await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
}

/** 建立第二个独立账户浏览器上下文，不共享 localStorage。 */
async function participant(browser: Browser, account: AccountWithToken, path: string): Promise<{ context: BrowserContext; page: Page }> {
	const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
	const page: Page = await context.newPage();
	observeErrors(page);
	await openAs(page, account, path);
	return { context, page };
}

/** 输入区只定位当前可见工作区，避免缓存页面产生重复命中。 */
function composer(page: Page): Locator {
	return page.getByTestId('twitter-messages-conversation').getByRole('textbox', { name: 'メッセージを入力', exact: true });
}

/** 消息节点仅按服务端标识定位，不依赖生成的 CSS 类名。 */
function message(page: Page, id: string): Locator {
	return page.getByTestId('twitter-messages-conversation').locator(`[data-message-id="${id}"]`);
}

/** 通过实际表单按钮提交文本，发送结果与服务端历史分别验证。 */
async function sendText(page: Page, text: string): Promise<void> {
	await composer(page).fill(text);
	await page.getByTestId('twitter-messages-conversation').getByRole('button', { name: '送信', exact: true }).click();
	await expect(composer(page)).toHaveValue('');
	await expect(page.getByTestId('twitter-messages-conversation').getByText(text, { exact: true })).toBeVisible();
}

/** 从真实服务端读取私聊历史，明确关闭查询即标读。 */
async function history(account: RegisteredUser, otherId: string): Promise<Misskey.Endpoints['chat/messages/user-timeline']['res']> {
	return await realApi(account, 'chat/messages/user-timeline', { userId: otherId, limit: 100, markAsRead: false });
}

/** 浏览器布局观测只保存矩形，不能成为产品业务事实或断点的替代来源。 */
type LayoutRectangle = Readonly<{ x: number; right: number; width: number; height: number }>;

/** 普通主页与私信工作区共用的实际页面边界证据。 */
type ShellGeometry = Readonly<{
	sidebar: LayoutRectangle | null;
	main: LayoutRectangle;
	outerLeft: number;
	outerRight: number;
	viewportWidth: number;
	horizontalOverflow: number;
}>;

/** 等待真实字体完成后读取 Shell，不依赖 CSS Modules 名称或实现中的计算值。 */
async function measureShell(page: Page): Promise<ShellGeometry> {
	await page.evaluate(/** 字体变化结束后才把几何作为验收证据。 */ async (): Promise<void> => { await document.fonts.ready; });
	return await page.getByTestId('twitter-content-layout').evaluate(/** 只投影可见的 DOM 外框与主列。 */ (layout: HTMLElement): ShellGeometry => {
		/** DOMRect 只保留本次比较所需的无业务数据字段。 */
		const rectangle: (element: Element) => LayoutRectangle = (element: Element): LayoutRectangle => {
			const bounds: DOMRect = element.getBoundingClientRect();
			return { x: bounds.x, right: bounds.right, width: bounds.width, height: bounds.height };
		};
		const sidebar: Element | null = layout.querySelector('[data-testid="twitter-sidebar"]');
		const main: Element | null = layout.querySelector(':scope > main');
		const rail: Element | null = layout.querySelector('[data-testid="twitter-right-rail"]');
		const viewport: HTMLElement | null = layout.closest('[data-twitter-scroll-viewport]');
		if (!main || !viewport) throw new Error('Expected the existing Twitter Shell and main column');
		const mainBounds: LayoutRectangle = rectangle(main);
		const sidebarBounds: LayoutRectangle | null = sidebar ? rectangle(sidebar) : null;
		return {
			sidebar: sidebarBounds,
			main: mainBounds,
			outerLeft: sidebarBounds?.x ?? mainBounds.x,
			outerRight: rail && rail.getClientRects().length > 0 ? rectangle(rail).right : mainBounds.right,
			viewportWidth: viewport.clientWidth,
			horizontalOverflow: Math.max(viewport.scrollWidth - viewport.clientWidth, document.documentElement.scrollWidth - window.innerWidth),
		};
	});
}

/** 筛选指示条必须跟随真实选中按钮，不另存筛选状态。 */
async function expectSelectedFilter(page: Page, label: string): Promise<void> {
	const filters: Locator = page.getByTestId('twitter-messages-filters');
	const selected: Locator = filters.getByRole('button', { name: label, exact: true });
	await selected.click();
	await expect(selected).toHaveAttribute('aria-pressed', 'true');
	await expect(filters.locator('button[aria-pressed="true"]')).toHaveCount(1);
	const indicator: Locator = filters.getByTestId('twitter-tab-indicator');
	await expect(indicator).toBeVisible();
	await expect.poll(/** 动画完成后的实际中心点应与当前按钮一致。 */ async (): Promise<number> => {
		const buttonBox: Awaited<ReturnType<Locator['boundingBox']>> = await selected.boundingBox();
		const indicatorBox: Awaited<ReturnType<Locator['boundingBox']>> = await indicator.boundingBox();
		if (!buttonBox || !indicatorBox) return Number.POSITIVE_INFINITY;
		return Math.abs(buttonBox.x + buttonBox.width / 2 - indicatorBox.x - indicatorBox.width / 2);
	}).toBeLessThanOrEqual(1);
}

/** 历史阅读锚点来自当前可见消息，只用于检验布局切换没有跳转阅读位置。 */
type MessageAnchor = Readonly<{ id: string; offset: number }>;

/** 保存消息视口内第一条完整可见的服务端消息。 */
async function visibleMessageAnchor(page: Page): Promise<MessageAnchor> {
	return await messageScroll(page).evaluate(/** 从 DOM 标识和矩形观察阅读位置，不构造消息实体。 */ (viewport: HTMLElement): MessageAnchor => {
		const top: number = viewport.getBoundingClientRect().top;
		const bottom: number = viewport.getBoundingClientRect().bottom;
		const anchor: HTMLElement | undefined = Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find(/** 过滤被顶部裁切的消息，保证偏差比较不受取整边界影响。 */ (node: HTMLElement): boolean => node.getBoundingClientRect().top >= top + 1 && node.getBoundingClientRect().bottom <= bottom - 1);
		if (!anchor?.dataset.messageId) throw new Error('Expected a fully visible history message');
		return { id: anchor.dataset.messageId, offset: anchor.getBoundingClientRect().top - top };
	});
}

/** 通过现有消息视口的可访问名称定位，保持测试与具体样式类解耦。 */
function messageScroll(page: Page): Locator {
	return page.getByTestId('twitter-messages-conversation').locator('[tabindex="0"][aria-label="メッセージ"]');
}

/** 故障控制器只关闭传输或暂停握手，正常阶段始终连接真实服务端。 */
type StreamFault = Readonly<{
	disconnect: () => Promise<void>;
	reconnect: () => void;
	connections: () => number;
	subscriptions: () => number;
}>;

/** 记录展示层是否出现过提示，防止短时闪现被最终隐藏断言遗漏。 */
type StreamNoticeObservation = { shown: boolean; stop: () => void };

/** 在浏览器建立首个通道前安装传输故障，不构造任何业务帧或 HTTP 响应。 */
async function controlStream(page: Page): Promise<StreamFault> {
	let blocked: boolean = false;
	let connections: number = 0;
	let subscriptions: number = 0;
	page.on('websocket', /** 只观察真实客户端送出的频道订阅，不干预帧转发。 */ (socket: WebSocket): void => {
		if (new URL(socket.url()).pathname !== '/streaming') return;
		socket.on('framesent', /** 仅提取传输层频道名，认证信息和业务正文不进入诊断。 */ (frame: { payload: string | Buffer }): void => {
			try {
				const envelope: { type?: unknown; body?: { channel?: unknown } } = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()) as { type?: unknown; body?: { channel?: unknown } };
				if (envelope.type === 'connect' && envelope.body?.channel === 'chatUser') subscriptions++;
			} catch { /* 非 JSON 心跳不属于频道订阅。 */ }
		});
	});
	const active: Set<WebSocketRoute> = new Set();
	const pending: Set<() => void> = new Set();
	await page.routeWebSocket(/** 仅匹配本用例真实实例的流式端点，认证参数不输出。 */ (url: URL): boolean => url.pathname === '/streaming' && url.port === '61812', /** 暂停握手期间不能产生虚假的 connected 事件。 */ async (socket: WebSocketRoute): Promise<void> => {
		let closed: boolean = false;
		if (blocked) {
			await new Promise<void>(/** 客户端超时会撤销旧握手，恢复时只连接仍有效的请求。 */ (resolve: () => void): void => {
				pending.add(resolve);
				socket.onClose(/** 尚未连接服务端的握手只需释放等待。 */ (): void => { closed = true; pending.delete(resolve); resolve(); });
			});
		}
		if (closed) return;
		const server: WebSocketRoute = socket.connectToServer();
		/** 将客户端关闭正常传递给真实服务端，包含从暂停中释放的连接。 */
		socket.onClose(/** 只传播关闭，不截获或改写业务消息。 */ async (): Promise<void> => { active.delete(socket); await server.close(); });
		active.add(socket);
		connections++;
	});
	return Object.freeze({
		/** 切断当前真实连接，并在恢复前暂停后续握手。 */
		disconnect: async (): Promise<void> => {
			await expect.poll(/** 首次故障前必须确认真实 chatUser 已订阅，编辑器就绪不能代替连接就绪。 */ (): number => subscriptions).toBeGreaterThan(0);
			blocked = true;
			await Promise.all([...active].map(/** 关闭客户端后由既有 SDK 发起重连。 */ async (socket: WebSocketRoute): Promise<void> => { await socket.close({ code: 1012, reason: 'integration transport interruption' }); }));
			active.clear();
		},
		/** 释放暂停的握手，之后由正常真实服务器完成连接。 */
		reconnect: (): void => {
			blocked = false;
			pending.forEach(/** 恢复每个仍在等待的连接握手。 */ (resume: () => void): void => resume());
			pending.clear();
		},
		/** 仅提供握手次数观测，恢复成功另由真实消息和产品 UI 验证。 */
		connections: (): number => connections,
		/** 真实订阅帧已发出后才允许下一条消息证明恢复链路。 */
		subscriptions: (): number => subscriptions,
	});
}

/** 观察真实 DOM 提示的新增，不触碰连接事实或业务状态。 */
async function observeStreamNotice(page: Page): Promise<JSHandle<StreamNoticeObservation>> {
	return await page.evaluateHandle(/** 捕获提示闪现，返回的句柄仅在当前测试页有效。 */ (): StreamNoticeObservation => {
		const observation: StreamNoticeObservation = { shown: false, /** 句柄销毁前释放观察器。 */ stop: (): void => observer.disconnect() };
		const observer: MutationObserver = new MutationObserver(/** 只记录提示节点是否实际进入 DOM。 */ (): void => { if (document.querySelector('[data-testid="twitter-stream-notice"]')) observation.shown = true; });
		observer.observe(document.body, { childList: true, subtree: true });
		return observation;
	});
}

test.beforeEach(/** 每个用例仅重置一次专用测试实例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	if (new URL(BASE_URL).port !== '61812') throw new Error('Messages regression requires the isolated 61812 instance');
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'dm_admin', 'dm-admin-password', true);
	alice = await createAccount('dm_alice', 'DM Alice');
	bob = await createAccount('dm_bob', 'DM Bob');
	carol = await createAccount('dm_carol', 'DM Carol');
	const role: Misskey.entities.Role = await realApi(admin, 'admin/roles/create', {
		name: 'DM regression', description: 'Isolated integration fixtures', color: null, iconUrl: null, target: 'manual', condFormula: {},
		isPublic: false, isModerator: false, isAdministrator: false, asBadge: false, canEditMembersByModerator: false, displayOrder: 0,
		policies: { chatAvailability: { useDefault: false, priority: 1, value: 'available' }, rateLimitFactor: { useDefault: false, priority: 1, value: 0.01 } },
	});
	for (const account of [alice, bob, carol]) await realApi(admin, 'admin/roles/assign', { roleId: role.id, userId: account.id });
	alice = { ...await realApi(alice, 'i', {}), token: alice.token };
	bob = { ...await realApi(bob, 'i', {}), token: bob.token };
	carol = { ...await realApi(carol, 'i', {}), token: carol.token };
	errors = [];
	observeErrors(page);
});

test.afterEach(/** 可见结果不能掩盖未处理异常。 */ (): void => { expect(errors).toEqual([]); });

for (const width of [320, 390, 1440] as const) {
	test(`${width}px 空态、主页入口和消息编辑器可点击`, /** 同一真实业务链在窄屏和桌面分别执行。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await page.setViewportSize({ width, height: 900 });
		await openAs(page, alice);
		await expect(page.getByRole('heading', { name: '受信トレイは空です', exact: true })).toBeVisible();
		if (width === 1440) await expect(page.getByRole('heading', { name: '会話を始める', exact: true })).toBeVisible();
		else await expect(page.getByTestId('twitter-messages-conversation')).not.toBeVisible();
		await expect(page.getByTestId('twitter-right-rail')).not.toBeVisible();
		await page.screenshot({ path: info.outputPath(`messages-empty-${width}.png`), animations: 'disabled' });
		await page.goto(`${BASE_URL}/@${bob.username}?ui=twitter`);
		await page.getByTestId('twitter-profile-message').click();
		await expect(page).toHaveURL(new RegExp(`/chat/user/${bob.id}`));
		await expect(composer(page)).toBeEnabled();
		if (width < 1440) {
			await expect(page.getByTestId('twitter-messages-inbox')).not.toBeVisible();
			await expect(page.getByTestId('twitter-mobile-bar')).toHaveCount(0);
		} else await expect(page.getByTestId('twitter-messages-inbox')).toBeVisible();
		const button: Locator = page.getByTestId('twitter-messages-conversation').getByRole('button', { name: '送信', exact: true });
		await composer(page).fill(`responsive-${width}`);
		expect(await button.evaluate(/** 命中测试证明按钮没有被 FAB 或底栏遮挡。 */ (element: HTMLButtonElement): boolean => {
			const bounds: DOMRect = element.getBoundingClientRect();
			const hit: Element | null = window.document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
			return hit === element || element.contains(hit);
		})).toBe(true);
		await button.click();
		await expect(composer(page)).toHaveValue('');
		expect((await history(bob, alice.id))[0]?.text).toBe(`responsive-${width}`);
		await page.screenshot({ path: info.outputPath(`messages-conversation-${width}.png`), animations: 'disabled' });
	});
}

for (const width of [320, 390, 500, 501, 1279, 1280, 1440, 1920] as const) {
	test(`${width}px 私信与时间线共用居中外框、导航和标签风格`, /** 矩阵覆盖移动和桌面断点两侧，所有数据仍由真实实例提供。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await realApi(alice, 'notes/create', { text: `Shared Shell geometry ${width}` });
		await page.setViewportSize({ width, height: 900 });
		await openAs(page, alice, '/');
		await expect(page.getByTestId('twitter-note').first()).toBeVisible();
		await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
		const timeline: ShellGeometry = await measureShell(page);
		await page.screenshot({ path: info.outputPath(`shell-timeline-${width}.png`), animations: 'disabled' });
		await page.getByTestId('twitter-messages-nav').first().click();
		await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
		await expect(page.getByTestId('twitter-messages-inbox')).toBeVisible();
		const chat: ShellGeometry = await measureShell(page);
		expect(chat.horizontalOverflow).toBeLessThanOrEqual(1);
		expect(Math.abs(chat.outerLeft - timeline.outerLeft)).toBeLessThanOrEqual(1);
		expect(Math.abs(chat.outerRight - timeline.outerRight)).toBeLessThanOrEqual(1);
		expect(Math.abs(chat.outerLeft - (chat.viewportWidth - chat.outerRight))).toBeLessThanOrEqual(1);
		if (width <= 500) {
			expect(chat.sidebar).toBeNull();
			expect(Math.abs(chat.main.width - chat.viewportWidth)).toBeLessThanOrEqual(1);
		} else {
			expect(chat.sidebar).not.toBeNull();
			expect(Math.abs((chat.sidebar?.x ?? Number.POSITIVE_INFINITY) - (timeline.sidebar?.x ?? 0))).toBeLessThanOrEqual(1);
			expect(chat.sidebar?.width).toBe(width >= 1280 ? 275 : 72);
			if (width >= 1280) expect(Math.abs(chat.main.width - 950)).toBeLessThanOrEqual(2);
			else expect(chat.main.width).toBeLessThanOrEqual(600);
		}
		const inbox: Locator = page.getByTestId('twitter-messages-inbox');
		const inboxHeader: Awaited<ReturnType<Locator['boundingBox']>> = await inbox.locator(':scope > header').boundingBox();
		expect(inboxHeader?.height).toBe(50);
		const inboxBounds: Awaited<ReturnType<Locator['boundingBox']>> = await inbox.boundingBox();
		if (width >= 1280) {
			expect(Math.abs((inboxBounds?.width ?? 0) - 350)).toBeLessThanOrEqual(1);
			await expect(page.getByTestId('twitter-messages-conversation')).toBeVisible();
			const conversationBounds: Awaited<ReturnType<Locator['boundingBox']>> = await page.getByTestId('twitter-messages-conversation').boundingBox();
			expect(Math.abs((conversationBounds?.width ?? 0) - 600)).toBeLessThanOrEqual(2);
		} else {
			await expect(page.getByTestId('twitter-messages-conversation')).not.toBeVisible();
			expect(Math.abs((inboxBounds?.width ?? 0) - chat.main.width)).toBeLessThanOrEqual(2);
		}
		await expectSelectedFilter(page, 'ユーザー');
		await expectSelectedFilter(page, 'グループ');
		await expectSelectedFilter(page, 'すべて');
		await expect(page.getByTestId('twitter-right-rail')).not.toBeVisible();
		if (width <= 500) await expect(page.getByTestId('open-post-form')).toHaveCount(0);
		else {
			await expect(page.getByTestId('open-post-form')).toHaveCount(1);
			await expect(page.getByTestId('twitter-sidebar').getByTestId('open-post-form')).toHaveCount(1);
			await expect(page.getByTestId('open-post-form')).not.toHaveCSS('position', 'fixed');
		}
		await page.screenshot({ path: info.outputPath(`shell-messages-${width}.png`), animations: 'disabled' });
		await info.attach('shared-shell-geometry', { body: JSON.stringify({ width, timeline, chat }), contentType: 'application/json' });
	});
}

test('跨分栏与移动断点调整窗口保留草稿、历史锚点和未读事实', /** 仅改变浏览器几何，不能重选会话或标读尚未观察的新消息。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	test.setTimeout(120_000);
	for (let index: number = 0; index < 65; index++) await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: `anchor-${index.toString().padStart(2, '0')}` });
	/** 后创建的未读消息标识用于确认服务端延迟通知已经实际送达。 */
	let delayedMessageId: string | null = null;
	/** 只有真实 main 通道收到目标消息通知后才接受随后对账请求。 */
	let delayedNotificationObserved: boolean = false;
	/** 由真实流式事件释放准备阶段，不通过固定等待猜测服务端计时器。 */
	let resolveDelayedNotification: () => void;
	/** 完成条件只来自本次目标消息的真实延迟广播。 */
	const delayedNotification: Promise<void> = new Promise<void>(/** 保存本次目标通知的完成入口。 */ (resolve: () => void): void => { resolveDelayedNotification = resolve; });
	/** 只保留本用例监听过的真实连接，以便在准备结束时完整撤下观察器。 */
	const observedSockets: Set<WebSocket> = new Set();

	/** 只按真实通知名称和消息标识判定到达，不改写或输出帧内容。 */
	function observeDelayedNotification(frame: { payload: string | Buffer }): void {
		try {
			const envelope: { type?: unknown; body?: { type?: unknown; body?: { id?: unknown } } } = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()) as { type?: unknown; body?: { type?: unknown; body?: { id?: unknown } } };
			if (delayedMessageId !== null && envelope.type === 'channel' && envelope.body?.type === 'newChatMessage' && envelope.body.body?.id === delayedMessageId) {
				delayedNotificationObserved = true;
				resolveDelayedNotification();
			}
		} catch { /* 非 JSON 心跳不属于目标消息通知。 */ }
	}

	/** 在页面建立真实流式通道时安装只读监听，不接触认证查询参数。 */
	function observeSocket(socket: WebSocket): void {
		if (new URL(socket.url()).pathname !== '/streaming') return;
		observedSockets.add(socket);
		socket.on('framereceived', observeDelayedNotification);
	}

	page.on('websocket', observeSocket);
	try {
		await page.setViewportSize({ width: 1440, height: 900 });
		await openAs(page, alice, `/chat/user/${bob.id}`);
		await expect.poll(/** 初次底部观察可以按产品规则标读，后面的布局观测从此稳定状态开始。 */ async (): Promise<boolean> => (await realApi(alice, 'i', {})).hasUnreadChatMessages).toBe(false);
		await page.getByRole('button', { name: '以前のメッセージを読み込む', exact: true }).click();
		await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(60);
		await page.getByRole('button', { name: '以前のメッセージを読み込む', exact: true }).click();
		await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(65);
		await composer(page).fill('resize-private-draft');
		await messageScroll(page).evaluate(/** 进入历史阅读位置，实际 scroll 事件会撤销到底部的读租约。 */ (viewport: HTMLElement): void => { viewport.scrollTo({ top: 500, behavior: 'instant' }); });
		await expect.poll(/** 只有原生消息视口确实滚动后才建立锚点。 */ async (): Promise<number> => messageScroll(page).evaluate(/** 只读消息容器几何。 */ (viewport: HTMLElement): number => viewport.scrollTop)).toBe(500);
		const unread: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'unobserved-during-resize' });
		delayedMessageId = unread.id;
		await expect(page.getByTestId('twitter-messages-conversation').getByText('unobserved-during-resize', { exact: true })).toHaveCount(1);
		await expect.poll(/** 服务端保存真实未读；测试不通过 UI 文案推断这一业务事实。 */ async (): Promise<boolean> => (await realApi(alice, 'i', {})).hasUnreadChatMessages).toBe(true);
		/** 后端延迟通知会触发合法能力对账；计数窗口必须在这次真实请求完成之后开始。 */
		const metadataReconciled: Promise<Response | null> = page.waitForRequest(/** 只匹配目标延迟通知之后发起的能力查询。 */ (request: Request): boolean => delayedNotificationObserved && new URL(request.url()).pathname === '/api/chat/contacts/show').then(/** 等待真实响应，不能把发出请求当成对账完成。 */ (request: Request): Promise<Response | null> => request.response());
		/** 同一轮真实消息窗口对账至少完成首个响应，再等待剩余分页安静。 */
		const timelineReconciled: Promise<Response | null> = page.waitForRequest(/** 只匹配目标延迟通知之后发起的历史查询。 */ (request: Request): boolean => delayedNotificationObserved && new URL(request.url()).pathname === '/api/chat/messages/user-timeline').then(/** 后续分页继续由原 Store 执行，不伪造结果。 */ (request: Request): Promise<Response | null> => request.response());
		const [, metadataResponse, timelineResponse]: [void, Response | null, Response | null] = await Promise.all([delayedNotification, metadataReconciled, timelineReconciled]);
		expect(metadataResponse?.ok()).toBe(true);
		expect(timelineResponse?.ok()).toBe(true);
		await page.waitForLoadState('networkidle');
	} finally {
		page.off('websocket', observeSocket);
		for (const socket of observedSockets) socket.off('framereceived', observeDelayedNotification);
	}
	const anchor: MessageAnchor = await visibleMessageAnchor(page);
	/** 只计数已有真实查询，不记录请求头或认证参数。 */
	let selectionQueries: number = 0;
	/** 布局变化后出现的任何显式已读请求都必须被核查。 */
	let readRequests: number = 0;
	page.on('request', /** 观察传输次数，不拦截、替换或修改产品响应。 */ (request: Request): void => {
		if (/\/api\/chat\/(?:contacts\/show|messages\/user-timeline)$/.test(request.url())) selectionQueries++;
		if (request.url().endsWith('/api/chat/conversations/read')) readRequests++;
	});
	/** 每次观测保留尺寸与锚点偏差供失败诊断。 */
	const observations: { width: number; anchorOffset: number; geometry: ShellGeometry }[] = [];
	for (const width of [1279, 501, 500, 320, 1920, 1280, 1440] as const) {
		await page.setViewportSize({ width, height: 900 });
		await expect(composer(page)).toHaveValue('resize-private-draft');
		await expect(page).toHaveURL(new RegExp(`/chat/user/${bob.id}`));
		await expect.poll(/** resize 的布局提交后仍保持原消息相对视口的位置。 */ async (): Promise<number> => message(page, anchor.id).evaluate(/** 相对滚动宿主计算，允许外壳纵坐标改变。 */ (element: HTMLElement, offset: number): number => {
			const viewport: HTMLElement | null = element.closest('[tabindex="0"][aria-label="メッセージ"]');
			if (!viewport) return Number.POSITIVE_INFINITY;
			return Math.abs(element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - offset);
		}, anchor.offset)).toBeLessThanOrEqual(2);
		const geometry: ShellGeometry = await measureShell(page);
		expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
		const currentAnchorOffset: number = await message(page, anchor.id).evaluate(/** 仅投影锚点矩形，消息内容不会写入验收附件。 */ (element: HTMLElement): number => element.getBoundingClientRect().top - (element.closest('[tabindex="0"][aria-label="メッセージ"]')?.getBoundingClientRect().top ?? 0));
		observations.push({ width, anchorOffset: currentAnchorOffset, geometry });
	}
	expect(selectionQueries).toBe(0);
	expect(readRequests).toBe(0);
	expect((await realApi(alice, 'i', {})).hasUnreadChatMessages).toBe(true);
	await expect(page.getByTestId('twitter-messages-conversation').getByText('unobserved-during-resize', { exact: true })).not.toBeInViewport();
	await info.attach('messages-resize-history', { body: JSON.stringify({ anchor, observations, selectionQueries, readRequests }), contentType: 'application/json' });
});

test('双向实时、跨设备未读、反应和删除来自真实服务端', /** 两个账户及第三个同账户设备验证主通道同步。 */ async ({ page, browser }: Pick<PlaywrightTestArgs, 'page'> & Pick<PlaywrightWorkerArgs, 'browser'>): Promise<void> => {
	await openAs(page, alice, `/chat/user/${bob.id}`);
	const receiver: Awaited<ReturnType<typeof participant>> = await participant(browser, bob, '/chat');
	const otherDevice: Awaited<ReturnType<typeof participant>> = await participant(browser, bob, '/chat');
	try {
		await sendText(page, 'alice-live-message');
		await expect(receiver.page.getByTestId('twitter-messages-inbox').getByText('alice-live-message', { exact: true })).toBeVisible();
		await expect(otherDevice.page.getByTestId('twitter-messages-inbox').getByLabel('未読', { exact: true })).toBeVisible();
		expect((await realApi(bob, 'i', {})).hasUnreadChatMessages).toBe(true);
		await receiver.page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'DM Alice' }).click();
		await expect(receiver.page.getByTestId('twitter-messages-conversation').getByText('alice-live-message', { exact: true })).toBeVisible();
		await expect.poll(/** 单独的账户快照证明观察后的真实标读。 */ async (): Promise<boolean> => (await realApi(bob, 'i', {})).hasUnreadChatMessages).toBe(false);
		await expect(otherDevice.page.getByTestId('twitter-messages-inbox').getByLabel('未読', { exact: true })).toHaveCount(0);
		await sendText(receiver.page, 'bob-live-reply');
		await expect(page.getByTestId('twitter-messages-conversation').getByText('bob-live-reply', { exact: true })).toBeVisible();
		const sent: Misskey.Endpoints['chat/messages/user-timeline']['res'][number] | undefined = (await history(alice, bob.id)).find(/** 获取真实消息标识，避免由文案构造实体。 */ (item: Misskey.Endpoints['chat/messages/user-timeline']['res'][number]): boolean => item.text === 'alice-live-message');
		expect(sent).toBeDefined();
		if (!sent) return;
		await realApi(bob, 'chat/messages/react', { messageId: sent.id, reaction: '👍' });
		const reaction: Locator = message(receiver.page, sent.id).getByRole('button', { name: 'リアクション: 👍', exact: true });
		await expect(reaction).toHaveAttribute('aria-pressed', 'true');
		await reaction.click();
		await expect(reaction).toHaveCount(0);
		await message(page, sent.id).getByRole('button', { name: 'もっと！', exact: true }).click();
		await page.getByRole('menuitem').filter({ hasText: '削除' }).click();
		await page.getByTestId('modal-dialog-ok').click();
		await expect(message(page, sent.id)).toHaveCount(0);
		await expect(message(receiver.page, sent.id)).toHaveCount(0);
		expect((await history(alice, bob.id)).some(/** 删除必须在权威历史中生效。 */ (item: Misskey.Endpoints['chat/messages/user-timeline']['res'][number]): boolean => item.id === sent.id)).toBe(false);
	} finally {
		await receiver.context.close();
		await otherDevice.context.close();
	}
});

test('草稿按会话隔离、离页返回保留且不持久化正文', /** 会话切换与页面恢复都经过真实 SPA 导航。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'bob-seed' });
	await realApi(carol, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'carol-seed' });
	await page.setViewportSize({ width: 1440, height: 900 });
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await composer(page).fill('alice-bob-private-draft');
	await page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'DM Carol' }).click();
	await expect(composer(page)).toHaveValue('');
	await composer(page).fill('alice-carol-private-draft');
	await page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'DM Bob' }).click();
	await expect(composer(page)).toHaveValue('alice-bob-private-draft');
	await page.getByTestId('twitter-sidebar').locator('a[href="/"]').first().click();
	await expect(page.getByTestId('twitter-messages-workspace')).toHaveCount(0);
	await page.getByTestId('twitter-messages-nav').first().click();
	await page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'DM Bob' }).click();
	await expect(composer(page)).toHaveValue('alice-bob-private-draft');
	const persisted: string = await page.evaluate(/** 只返回是否含私信草稿所需的非凭据布尔证据。 */ (): string => Object.values(window.localStorage).filter(/** 本地值只做包含性匹配，不输出完整账户。 */ (value: unknown): value is string => typeof value === 'string' && value.includes('private-draft')).join(''));
		expect(persisted).toBe('');
});

test('接收范围、拉黑和只读策略显示明确原因', /** 限制全部来自真实权限接口，不用 Mock 证明业务拒绝。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await realApi(carol, 'i/update', { chatScope: 'mutual' });
	await openAs(page, alice, `/chat/user/${carol.id}`);
	await expect(page.getByText('このユーザーへのメッセージは許可されていません。', { exact: true })).toBeVisible();
	await expect(composer(page)).toBeDisabled();
	await realApi(carol, 'blocking/create', { userId: alice.id });
	await page.reload();
	await expect(page.getByText('ブロックの設定によりメッセージを送信できません。', { exact: true })).toBeVisible();
	const readRole: Misskey.entities.Role = await realApi(admin, 'admin/roles/create', {
		name: 'DM read only', description: 'Isolated policy', color: null, iconUrl: null, target: 'manual', condFormula: {},
		isPublic: false, isModerator: false, isAdministrator: false, asBadge: false, canEditMembersByModerator: false, displayOrder: 0,
		policies: { chatAvailability: { useDefault: false, priority: 2, value: 'readonly' } },
	});
	await realApi(admin, 'admin/roles/assign', { roleId: readRole.id, userId: alice.id });
	alice = { ...await realApi(alice, 'i', {}), token: alice.token };
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await expect(page.getByText('現在、チャットは閲覧のみ利用できます。', { exact: true })).toBeVisible();
	await expect(composer(page)).toBeDisabled();
});

test('历史和搜索完整分页，搜索深链由真实时间线定位', /** 超过两页的同关键词消息证明游标与查询生命周期。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const ids: string[] = [];
	for (let index: number = 0; index < 65; index++) {
		const sent: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(alice, 'chat/messages/create-to-user', { toUserId: bob.id, text: `needle-${index.toString().padStart(2, '0')}` });
		ids.push(sent.id);
	}
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(30);
	await page.getByRole('button', { name: '以前のメッセージを読み込む', exact: true }).click();
	await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(60);
	await page.getByRole('button', { name: '以前のメッセージを読み込む', exact: true }).click();
	await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(65);
	await page.getByRole('button', { name: 'メッセージを検索', exact: true }).click();
	await page.getByRole('searchbox', { name: 'メッセージを検索', exact: true }).fill('needle-');
	await page.getByRole('searchbox', { name: 'メッセージを検索', exact: true }).press('Enter');
	await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(30);
	await page.getByTestId('twitter-messages-conversation').getByRole('button', { name: 'もっと見る', exact: true }).click();
	await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(60);
	await page.getByTestId('twitter-messages-conversation').getByRole('button', { name: 'もっと見る', exact: true }).click();
	await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(65);
	await message(page, ids[0]).getByRole('button', { name: 'メッセージを表示', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/chat/messages/${ids[0]}`));
	await expect(message(page, ids[0])).toBeInViewport();
});

test('活动群会话响应真实账户策略更新，无需刷新页面', /** 角色分配本身不推送 meUpdated；随后真实 i/update 触发既有账户更新，专门证明私信消费链，不声称全站角色自动推送。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const receivedPolicies: string[] = [];
	page.on('websocket', /** 只观察实际通道，不注入或修改流式消息。 */ (socket: WebSocket): void => {
		socket.on('framereceived', /** 白名单提取策略字段，避免记录账户与认证数据。 */ (frame: { payload: string | Buffer }): void => {
			try {
				/** 测试只读投影用于观测传输，不参与产品业务判断。 */
				const envelope: { type?: string; body?: { type?: string; body?: { policies?: { chatAvailability?: string } } } } = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()) as { type?: string; body?: { type?: string; body?: { policies?: { chatAvailability?: string } } } };
				if (envelope.type === 'channel' && envelope.body?.type === 'meUpdated' && envelope.body.body?.policies?.chatAvailability) receivedPolicies.push(envelope.body.body.policies.chatAvailability);
			} catch { /* 心跳帧不是 JSON 账户更新。 */ }
		});
	});
	const room: Misskey.entities.ChatRoom = await realApi(alice, 'chat/rooms/create', { name: 'Live policy room' });
	await realApi(alice, 'chat/messages/create-to-room', { toRoomId: room.id, text: 'live-policy-message' });
	await openAs(page, alice, `/chat/room/${room.id}`);
	await expect(composer(page)).toBeEnabled();
	await expect(page.getByTestId('twitter-messages-conversation').getByText('live-policy-message', { exact: true })).toBeVisible();
	let previousRoleId: string | null = null;
	for (const availability of ['readonly', 'unavailable'] as const) {
		if (previousRoleId) await realApi(admin, 'admin/roles/unassign', { roleId: previousRoleId, userId: alice.id });
		const role: Misskey.entities.Role = await realApi(admin, 'admin/roles/create', {
			name: `Live DM ${availability}`, description: 'Real runtime policy revocation', color: null, iconUrl: null, target: 'manual', condFormula: {},
			isPublic: false, isModerator: false, isAdministrator: false, asBadge: false, canEditMembersByModerator: false, displayOrder: 0,
			policies: { chatAvailability: { useDefault: false, priority: 2, value: availability } },
		});
		await realApi(admin, 'admin/roles/assign', { roleId: role.id, userId: alice.id });
		previousRoleId = role.id;
		await realApi(alice, 'i/update', { description: `真实账户更新事件：${availability}` });
		await expect.poll(/** 必须收到真实 i/update 产生的账户策略帧，不能伪造推送或刷新页面。 */ (): boolean => receivedPolicies.includes(availability)).toBe(true);
		await expect(page).toHaveURL(new RegExp(`/chat/room/${room.id}`));
		if (availability === 'readonly') {
			await expect(composer(page)).toBeDisabled();
			await expect(page.getByTestId('twitter-messages-conversation').getByText('live-policy-message', { exact: true })).toBeVisible();
		} else await expect(page.getByTestId('twitter-messages-conversation').locator('[data-message-id]')).toHaveCount(0);
	}
});

test('私信附件使用真实网盘文件并保留所有权', /** 文件经真实上传、原有网盘选择器与消息发送链路交付。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const form: FormData = new FormData();
	form.set('i', alice.token);
	form.set('file', new Blob(['private attachment fixture'], { type: 'text/plain' }), 'dm-proof.txt');
	const response: globalThis.Response = await fetch(`${BASE_URL}/api/drive/files/create`, { method: 'POST', body: form });
	expect(response.ok).toBe(true);
	const file: Misskey.entities.DriveFile = await response.json() as Misskey.entities.DriveFile;
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await page.getByRole('button', { name: '添付ファイル', exact: true }).click();
	await page.getByRole('menuitem').filter({ hasText: 'ドライブから' }).click();
	await page.locator(`[data-scroll-anchor="${file.id}"]`).click();
	await page.getByRole('button', { name: /完了/ }).click();
	await expect(page.getByTestId('twitter-messages-conversation').getByText('dm-proof.txt', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: '送信', exact: true }).click();
	await expect(page.getByTestId('twitter-messages-conversation').getByRole('link').filter({ hasText: 'dm-proof.txt' })).toBeVisible();
	expect((await history(bob, alice.id))[0]?.fileId).toBe(file.id);
});

test('群邀请、加入、发送、静音、成员及退出形成完整闭环', /** 使用同一真实群聊和不同账户，不在测试中复制成员权限判断。 */ async ({ page, browser }: Pick<PlaywrightTestArgs, 'page'> & Pick<PlaywrightWorkerArgs, 'browser'>): Promise<void> => {
	const room: Misskey.entities.ChatRoom = await realApi(alice, 'chat/rooms/create', { name: 'DM room proof' });
	await openAs(page, alice, `/chat/room/${room.id}`);
	await expect(composer(page)).toBeEnabled();
	const receiver: Awaited<ReturnType<typeof participant>> = await participant(browser, bob, '/chat');
	try {
		await realApi(alice, 'chat/rooms/invitations/create', { roomId: room.id, userId: bob.id });
		await expect(receiver.page.getByTestId('twitter-messages-inbox').getByText('DM room proof', { exact: true })).toBeVisible();
		await receiver.page.getByTestId('twitter-messages-inbox').getByRole('button').filter({ hasText: 'DM room proof' }).click();
		await receiver.page.getByRole('button', { name: 'グループに参加', exact: true }).click();
		await expect(composer(receiver.page)).toBeEnabled();
		await sendText(receiver.page, 'group-live-message');
		await expect(page.getByTestId('twitter-messages-conversation').getByText('group-live-message', { exact: true })).toBeVisible();
		await receiver.page.getByRole('button', { name: 'グループの詳細', exact: true }).click();
		await expect(receiver.page.getByRole('region', { name: 'グループの詳細', exact: true }).getByText('DM Alice', { exact: true })).toBeVisible();
		await receiver.page.getByRole('button', { name: 'グループの通知をミュート', exact: true }).click();
		await expect(receiver.page.getByRole('button', { name: 'グループのミュートを解除', exact: true })).toBeVisible();
		await receiver.page.getByRole('button', { name: 'グループを退出', exact: true }).click();
		await receiver.page.getByTestId('modal-dialog-ok').click();
		await expect(receiver.page).toHaveURL(/\/chat(?:\?|$)/);
		expect((await realApi(bob, 'chat/rooms/joining', {})).some(/** 成员退出必须由服务端列表证明。 */ (membership: Misskey.entities.ChatRoomMembership): boolean => membership.roomId === room.id)).toBe(false);
	} finally { await receiver.context.close(); }
});

test('收件箱分页在实时失效后保留已加载深度和过滤边界', /** 超过一页的真实空群与私聊共同验证会话分页。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	for (let index: number = 0; index < 32; index++) await realApi(alice, 'chat/rooms/create', { name: `inbox-room-${index.toString().padStart(2, '0')}` });
	await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'inbox-private-first' });
	await page.setViewportSize({ width: 1440, height: 900 });
	await openAs(page, alice);
	const inbox: Locator = page.getByTestId('twitter-messages-inbox');
	await inbox.getByRole('button', { name: 'もっと見る', exact: true }).click();
	await expect(inbox.getByText('inbox-room-00', { exact: true })).toBeVisible();
	await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'inbox-private-updated' });
	await expect(inbox.getByText('inbox-private-updated', { exact: true })).toBeVisible();
	await expect(inbox.getByText('inbox-room-00', { exact: true })).toHaveCount(1);
	await page.getByTestId('twitter-messages-filters').getByRole('button', { name: 'ユーザー', exact: true }).click();
	await expect(inbox.getByText('inbox-private-updated', { exact: true })).toBeVisible();
	await expect(inbox.getByText('inbox-room-31', { exact: true })).toHaveCount(0);
	await page.getByTestId('twitter-messages-inbox-search').getByRole('searchbox').fill('missing-conversation');
	await page.getByTestId('twitter-messages-inbox-search').getByRole('searchbox').press('Enter');
	await expect(inbox.getByRole('heading', { name: '検索結果がありません', exact: true })).toBeVisible();
});

test('原生 UI 保留既有聊天路由和真实历史', /** Twitter 展示工作区不会取代原生 Misskey 组件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'native-chat-proof' });
	await openAs(page, alice, `/chat/user/${bob.id}`, false);
	await expect(page.getByTestId('twitter-messages-workspace')).toHaveCount(0);
	await expect(page.getByText('native-chat-proof', { exact: true })).toBeVisible();
	await expect(page.locator('textarea')).toBeVisible();
});

test('首页与私信边界保留滚动位置和叠层偏好', /** 真实长时间线经 SPA 导航离开返回；聊天只占自身有界空间，不改用户全局路由偏好。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	for (let index: number = 0; index < 35; index++) await realApi(alice, 'notes/create', { text: `Shell boundary note ${index}.\nLong timeline content for a real scroll restoration check.` });
	await page.setViewportSize({ width: 390, height: 900 });
	await openAs(page, alice, '/');
	await expect(page.getByTestId('twitter-note').first()).toBeVisible();
	await expect(page.getByTestId('open-post-form')).toBeVisible();
	const viewport: Locator = page.getByTestId('twitter-scroll-viewport');
	await viewport.evaluate(/** 真实主宿主滚动撤销启动期恢复，并进入正文阅读位置。 */ (element: HTMLElement): void => {
		element.dispatchEvent(new WheelEvent('wheel', { deltaY: 720 }));
		element.scrollTo({ top: 720, behavior: 'instant' });
	});
	await expect.poll(/** 确认实际主视口已进入深滚动，而非仅更改窗口位置。 */ async (): Promise<number> => viewport.evaluate(/** 只读原生滚动状态。 */ (element: HTMLElement): number => element.scrollTop)).toBe(720);
	/** 锚点来自已经显示的服务端帖子，不构造额外业务实体。 */
	const before: Readonly<{ top: number; anchorId: string; anchorOffset: number }> = await viewport.evaluate(/** 保存一条可见帖子的实际空间位置。 */ (element: HTMLElement): { top: number; anchorId: string; anchorOffset: number } => {
		const bounds: DOMRect = element.getBoundingClientRect();
		const anchor: HTMLElement | undefined = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="twitter-note"][data-note-id]')).find(/** 选择页头下方完整可见的第一条帖子。 */ (note: HTMLElement): boolean => note.getBoundingClientRect().top >= bounds.top + 60 && note.getBoundingClientRect().bottom <= bounds.bottom - 80);
		return { top: element.scrollTop, anchorId: anchor?.dataset.noteId ?? '', anchorOffset: anchor ? anchor.getBoundingClientRect().top - bounds.top : -1 };
	});
	expect(before.anchorId).not.toBe('');
	await page.getByTestId('twitter-messages-nav').click();
	await expect(page.getByTestId('twitter-messages-workspace')).toHaveCount(1);
	await expect(page.getByTestId('twitter-messages-workspace')).toBeVisible();
	await expect(viewport).toHaveAttribute('data-twitter-layout', 'messages');
	await expect(page.getByTestId('open-post-form')).toHaveCount(0);
	const overflow: number = await viewport.evaluate(/** 聊天外壳不能继承长时间线的外部滚动高度。 */ (element: HTMLElement): number => element.scrollHeight - element.clientHeight);
	expect(overflow).toBeLessThanOrEqual(1);
	await page.getByTestId('twitter-mobile-bar').locator('a[href="/"]').click();
	await expect(page.getByTestId('twitter-note').first()).toBeVisible();
	await expect.poll(/** 返回原路由后恢复用户原有阅读位置。 */ async (): Promise<number> => Math.abs(await viewport.evaluate(/** 从同一个主滚动宿主读取恢复结果。 */ (element: HTMLElement): number => element.scrollTop) - before.top)).toBeLessThan(2);
	const afterOffset: number = await page.locator(`[data-testid="twitter-note"][data-note-id="${before.anchorId}"]`).evaluate(/** 锚点的屏幕位置也必须恢复，不能只把不同内容滚到同一数字。 */ (element: HTMLElement): number => element.getBoundingClientRect().top - (element.closest('[data-twitter-scroll-viewport]')?.getBoundingClientRect().top ?? 0));
	expect(Math.abs(afterOffset - before.anchorOffset)).toBeLessThan(2);
	await info.attach('messages-shell-scroll', { body: JSON.stringify({ before, afterOffset, chatOuterOverflow: overflow }), contentType: 'application/json' });
	await openAs(page, alice, '/', true, true);
	await expect(page.getByTestId('twitter-note').first()).toBeVisible();
	await page.getByTestId('twitter-messages-nav').click();
	await expect(page.getByTestId('twitter-messages-workspace')).toHaveCount(1);
	await expect(page.locator('[data-twitter-route-outlet]')).toHaveCount(1);
	await expect(page.locator('[data-twitter-route-outlet]')).toHaveCSS('overflow', 'hidden');
	await page.getByTestId('twitter-mobile-bar').locator('a[href="/"]').click();
	await expect(page.getByTestId('twitter-note').first()).toBeVisible();
	expect(await page.evaluate(/** 只读取测试注入的既有偏好布尔值，不输出账户或凭据。 */ (): boolean => {
		const profile: { preferences?: Record<string, unknown> } = JSON.parse(window.localStorage.getItem('preferences') ?? '{}') as { preferences?: Record<string, unknown> };
		const value: unknown = profile.preferences?.['experimental.stackingRouterView'];
		return Array.isArray(value) && Array.isArray(value[0]) && value[0][1] === true;
	})).toBe(true);
});

test('真实写入后丢失发送回执保持待确认且不会自动重发', /** 仅丢弃真实后端已完成的响应，不替换业务响应，也不直接注入 Store 状态。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await expect(composer(page)).toBeEnabled();
	let sendRequests: number = 0;
	await page.route('**/api/chat/messages/create-to-user', /** 真实请求先完成写入，再模拟浏览器未收到回执的传输故障。 */ async (route: Route): Promise<void> => {
		sendRequests++;
		const response: APIResponse = await route.fetch();
		expect(response.ok()).toBe(true);
		await route.abort('failed');
	});
	const content: string = 'uncertain-real-write-proof';
	const sendButton: Locator = page.getByTestId('twitter-messages-conversation').getByRole('button', { name: '送信', exact: true });
	const warning: Locator = page.getByText('送信結果を確認できませんでした。会話を確認してから再送してください。', { exact: true });
	await composer(page).fill(content);
	await sendButton.click();
	await expect(warning).toBeVisible();
	await expect(composer(page)).toHaveValue(content);
	await expect(sendButton).toBeDisabled();
	expect((await history(alice, bob.id)).filter(/** 消息是否已写入只由真实历史证明。 */ (item: Misskey.Endpoints['chat/messages/user-timeline']['res'][number]): boolean => item.text === content)).toHaveLength(1);
	await page.getByRole('button', { name: '会話を再読み込み', exact: true }).click();
	await expect(page.getByTestId('twitter-messages-conversation').getByText(content, { exact: true })).toBeVisible();
	await expect(sendButton).toBeDisabled();
	await expect(warning).toBeVisible();
	await page.getByRole('button', { name: '確認して再送を有効にする', exact: true }).click();
	await page.getByTestId('modal-dialog-cancel').click();
	await expect(page.getByTestId('modal-dialog-cancel')).toHaveCount(0);
	await expect(sendButton).toBeDisabled();
	await page.getByRole('button', { name: '確認して再送を有効にする', exact: true }).click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(sendButton).toBeEnabled();
	await expect(composer(page)).toHaveValue(content);
	await expect(warning).toHaveCount(0);
	expect(sendRequests).toBe(1);
	expect((await history(alice, bob.id)).filter(/** 显式解锁也不能代替用户再次点击发送。 */ (item: Misskey.Endpoints['chat/messages/user-timeline']['res'][number]): boolean => item.text === content)).toHaveLength(1);
});

/** 原生浏览器及独立临时用户目录只服务于真实标签页生命周期验收。 */
type NativeVisibilityBrowser = Readonly<{ page: Page; context: BrowserContext; dispose: () => Promise<void> }>;

/** Playwright 默认焦点模拟使所有标签页可见，采用无默认模拟的原生 Chromium 连接保留真实生命周期。 */
async function nativeVisibilityBrowser(info: TestInfo): Promise<NativeVisibilityBrowser> {
	const profile: string = info.outputPath('native-visibility-profile');
	await mkdir(profile, { recursive: true });
	const chromiumProcess: ChildProcess = spawn(chromium.executablePath(), ['--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', 'about:blank'], { stdio: 'ignore' });
	let browser: Browser | null = null;
	try {
		let debuggingPort: number = 0;
		await expect.poll(/** Chromium 将随机本地调试端口写入当前测试专属目录。 */ async (): Promise<number> => {
			try { debuggingPort = Number((await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0]); } catch { debuggingPort = 0; }
			return debuggingPort;
		}).toBeGreaterThan(0);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`, { noDefaults: true });
		const context: BrowserContext | undefined = browser.contexts()[0];
		if (!context) throw new Error('Expected the native Chromium default context');
		const page: Page = context.pages()[0] ?? await context.newPage();
		observeErrors(page);
		return Object.freeze({
			page, context,
			/** 关闭调试连接及本用例进程，用户目录随测试产物隔离。 */
			dispose: async (): Promise<void> => { try { await browser?.close(); } finally { chromiumProcess.kill('SIGTERM'); } },
		});
	} catch (error: unknown) {
		try { await browser?.close(); } finally { chromiumProcess.kill('SIGTERM'); }
		throw error;
	}
}

/** 无显示服务的 CI 继续执行真实传输用例；实际后台可见性只在原生有头浏览器中验证。 */
test.describe('stream recovery native visibility', /** Headless Chromium 始终报告标签页可见，不能据此伪造后台验收。 */ (): void => {
	test.skip(!process.env.DISPLAY, 'Actual tab visibility requires a display server');

	test('stream recovery 短暂后台和短时断线保留草稿且不刷新', /** 实际切换浏览器标签页，再注入短暂传输故障验证恢复宽限。 */ async ({}: Pick<PlaywrightTestArgs, never>, info: TestInfo): Promise<void> => {
		const native: NativeVisibilityBrowser = await nativeVisibilityBrowser(info);
		const page: Page = native.page;
		let fault: StreamFault | null = null;
		let observation: JSHandle<StreamNoticeObservation> | null = null;
		try {
			await page.setViewportSize({ width: 390, height: 900 });
			fault = await controlStream(page);
			await openAs(page, alice, `/chat/user/${bob.id}`);
			await expect(composer(page)).toBeEnabled();
			await composer(page).fill('foreground-private-draft');
			let navigations: number = 0;
			page.on('request', /** 顶层文档请求代表实际刷新，不把恢复查询误计为刷新。 */ (request: Request): void => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
			observation = await observeStreamNotice(page);
			const otherTab: Page = await native.context.newPage();
			await otherTab.bringToFront();
			await expect.poll(/** 真正的 hidden 事实来自浏览器，不覆盖 document 字段。 */ async (): Promise<boolean> => page.evaluate(/** 页面生命周期只作为观测证据。 */ (): boolean => document.hidden)).toBe(true);
			await page.bringToFront();
			await expect.poll(/** 恢复前台后才开始观测连接提示。 */ async (): Promise<boolean> => page.evaluate(/** 读取原生可见性。 */ (): boolean => document.hidden)).toBe(false);
			await expect(composer(page)).toHaveValue('foreground-private-draft');
			await expect(page.getByTestId('twitter-stream-notice')).toHaveCount(0);
			const before: number = fault.connections();
			await fault.disconnect();
			await page.waitForTimeout(350);
			fault.reconnect();
			await expect.poll(/** 真实通道握手数必须增加，不能只检查提示消失。 */ (): number => fault?.connections() ?? 0).toBeGreaterThan(before);
			const received: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'short-outage-real-message' });
			await expect(message(page, received.id)).toHaveCount(1);
			await page.waitForTimeout(3_100);
			await expect(composer(page)).toHaveValue('foreground-private-draft');
			expect(await observation.evaluate(/** 任意瞬时提示也应使短断线验收失败。 */ (result: StreamNoticeObservation): boolean => result.shown)).toBe(false);
			expect(navigations).toBe(0);
		} finally {
			fault?.reconnect();
			await observation?.evaluate(/** 清理测试观察器，不修改产品状态。 */ (result: StreamNoticeObservation): void => result.stop());
			await observation?.dispose();
			await native.dispose();
		}
	});

	test('stream recovery 后台重连对账保留服务端未读事实', /** 隐藏期间恢复真实连接及 HTTP 对账，也不能由程序恢复自动标读。 */ async ({}: Pick<PlaywrightTestArgs, never>, info: TestInfo): Promise<void> => {
		const native: NativeVisibilityBrowser = await nativeVisibilityBrowser(info);
		const page: Page = native.page;
		let fault: StreamFault | null = null;
		try {
			const seed: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'hidden-recovery-seed' });
			fault = await controlStream(page);
			await openAs(page, alice, `/chat/user/${bob.id}`);
			await expect(message(page, seed.id)).toBeVisible();
			await expect.poll(/** 初始可见会话先完成正常阅读，随后才隔离后台行为。 */ async (): Promise<boolean> => (await realApi(alice, 'i', {})).hasUnreadChatMessages).toBe(false);
			let readRequests: number = 0;
			page.on('request', /** 只统计真实标读请求，不干预任何响应。 */ (request: Request): void => { if (request.url().endsWith('/api/chat/conversations/read')) readRequests++; });
			const otherTab: Page = await native.context.newPage();
			await otherTab.bringToFront();
			await expect.poll(/** 必须先观察到浏览器后台状态再开始故障。 */ async (): Promise<boolean> => page.evaluate(/** 只读真实可见性。 */ (): boolean => document.hidden)).toBe(true);
			await fault.disconnect();
			const unread: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'unread-through-hidden-reconnect' });
			const before: number = fault.connections();
			fault.reconnect();
			await expect.poll(/** 重新握手后由真实后端提供遗漏消息。 */ (): number => fault?.connections() ?? 0).toBeGreaterThan(before);
			await expect(message(page, unread.id)).toHaveCount(1);
			await expect(page.getByTestId('twitter-stream-notice')).toHaveCount(0);
			expect(await page.evaluate(/** DOM 查询不能把测试页切回前台。 */ (): boolean => document.hidden)).toBe(true);
			expect((await realApi(alice, 'i', {})).hasUnreadChatMessages).toBe(true);
			expect(readRequests).toBe(0);
			await page.bringToFront();
			await expect(page.getByTestId('twitter-stream-notice')).toHaveCount(0);
			const live: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'after-hidden-reconnect-live' });
			await expect(message(page, live.id)).toHaveCount(1);
		} finally {
			fault?.reconnect();
			await native.dispose();
		}
	});
});

test('stream recovery 短时断线在宽限内恢复不闪现提示', /** 无显示服务的 CI 也必须证明短故障抑制以及真实订阅恢复。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const fault: StreamFault = await controlStream(page);
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await expect(composer(page)).toBeEnabled();
	await composer(page).fill('short-outage-draft');
	const observation: JSHandle<StreamNoticeObservation> = await observeStreamNotice(page);
	try {
		const before: number = fault.subscriptions();
		await fault.disconnect();
		await page.waitForTimeout(350);
		fault.reconnect();
		await expect.poll(/** 实际频道重订阅后才检验后续实时消息。 */ (): number => fault.subscriptions()).toBeGreaterThan(before);
		const live: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'live-after-short-outage' });
		await expect(message(page, live.id)).toHaveCount(1);
		await page.waitForTimeout(3_100);
		expect(await observation.evaluate(/** 不能只用最终隐藏状态掩盖提示闪现。 */ (result: StreamNoticeObservation): boolean => result.shown)).toBe(false);
		await expect(composer(page)).toHaveValue('short-outage-draft');
	} finally {
		fault.reconnect();
		await observation.evaluate(/** 清理仅用于本次 UI 观测的资源。 */ (result: StreamNoticeObservation): void => result.stop());
		await observation.dispose();
	}
});

test('stream recovery 持续断线、关闭提示和再次断线恢复真实消息', /** 一轮真实连接故障验证提示生命周期，并用服务端写入证明遗漏数据及订阅恢复。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 900 });
	const removed: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'removed-during-stream-outage' });
	const reacted: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(alice, 'chat/messages/create-to-user', { toUserId: bob.id, text: 'reacted-during-stream-outage' });
	const fault: StreamFault = await controlStream(page);
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await expect(message(page, removed.id)).toBeVisible();
	await expect(message(page, reacted.id)).toBeVisible();
	await composer(page).fill('sustained-outage-draft');
	let navigations: number = 0;
	page.on('request', /** 恢复数据必须通过原查询链，不能刷新整个文档。 */ (request: Request): void => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
	const notice: Locator = page.getByTestId('twitter-stream-notice');
	await fault.disconnect();
	await expect(notice).toBeVisible();
	await expect(notice).toHaveCount(1);
	const bounds: Awaited<ReturnType<Locator['boundingBox']>> = await notice.boundingBox();
	if (!bounds) throw new Error('Expected a visible mobile stream notice');
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
	await page.screenshot({ path: info.outputPath('twitter-stream-notice-mobile.png'), animations: 'disabled' });
	await notice.getByRole('button', { name: 'なにもしない', exact: true }).click();
	await expect(notice).toHaveCount(0);
	await realApi(bob, 'chat/messages/delete', { messageId: removed.id });
	await realApi(bob, 'chat/messages/react', { messageId: reacted.id, reaction: '👍' });
	const missed: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'created-during-stream-outage' });
	await page.waitForTimeout(3_100);
	await expect(notice).toHaveCount(0);
	await expect(message(page, removed.id)).toHaveCount(1);
	await expect(message(page, missed.id)).toHaveCount(0);
	fault.reconnect();
	await expect(message(page, removed.id)).toHaveCount(0);
	await expect(message(page, missed.id)).toHaveCount(1);
	await expect(message(page, reacted.id).getByRole('button', { name: 'リアクション: 👍', exact: true })).toBeVisible();
	const live: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'live-after-stream-recovery' });
	await expect(message(page, live.id)).toHaveCount(1);
	await expect(notice).toHaveCount(0);
	await fault.disconnect();
	await expect(notice).toBeVisible();
	await expect(notice).toHaveCount(1);
	fault.reconnect();
	await expect(notice).toHaveCount(0);
	await expect(composer(page)).toHaveValue('sustained-outage-draft');
	expect(navigations).toBe(0);
	expect((await history(alice, bob.id)).filter(/** 重连查询与流式订阅不能把同一真实消息插入两次。 */ (item: Misskey.Endpoints['chat/messages/user-timeline']['res'][number]): boolean => item.id === missed.id)).toHaveLength(1);
});

test('stream recovery 浏览器离线后联网恢复数据且无需再次切页', /** 浏览器 HTTP 离线和真实流式重连共同恢复，故障期服务端写入仍由独立 API 完成。 */ async ({ page, context }: Pick<PlaywrightTestArgs, 'page' | 'context'>): Promise<void> => {
	const fault: StreamFault = await controlStream(page);
	await openAs(page, alice, `/chat/user/${bob.id}`);
	await expect(composer(page)).toBeEnabled();
	await composer(page).fill('offline-recovery-draft');
	try {
		await fault.disconnect();
		await context.setOffline(true);
		await expect(page.getByTestId('twitter-stream-notice')).toBeVisible();
		const missed: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'created-while-browser-offline' });
		await expect(message(page, missed.id)).toHaveCount(0);
		await context.setOffline(false);
		fault.reconnect();
		await expect(page.getByTestId('twitter-stream-notice')).toHaveCount(0);
		await expect(message(page, missed.id)).toHaveCount(1);
		await expect(composer(page)).toHaveValue('offline-recovery-draft');
		const live: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'live-after-browser-online' });
		await expect(message(page, live.id)).toHaveCount(1);
	} finally {
		await context.setOffline(false);
		fault.reconnect();
	}
});

test('stream recovery 原生 UI 保留现有断线提示回退', /** 共享宿主插槽不得修改非 Twitter UI 既有提示的展示与关闭行为。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'native-stream-recovery-seed' });
	const fault: StreamFault = await controlStream(page);
	await openAs(page, alice, `/chat/user/${bob.id}`, false);
	await expect(page.getByText('native-stream-recovery-seed', { exact: true })).toBeVisible();
	const before: number = fault.subscriptions();
	await fault.disconnect();
	await expect(page.getByText('サーバーから切断されました', { exact: true })).toBeVisible();
	fault.reconnect();
	await expect.poll(/** 真实 chatUser 重订阅帧发出后才发送恢复证明消息。 */ (): number => fault.subscriptions()).toBeGreaterThan(before);
	const live: Misskey.Endpoints['chat/messages/create-to-user']['res'] = await realApi(bob, 'chat/messages/create-to-user', { toUserId: alice.id, text: 'native-live-after-reconnect' });
	await expect(page.getByText(live.text ?? '', { exact: true })).toBeVisible();
	await expect(page.getByTestId('twitter-stream-notice')).toHaveCount(0);
	await expect(page.getByText('サーバーから切断されました', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'なにもしない', exact: true }).click();
	await expect(page.getByText('サーバーから切断されました', { exact: true })).toHaveCount(0);
});
