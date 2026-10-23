/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：本人成就与账户通知状态的真实后端集成回归。
 * 作用：证明申领、缓存回访、已读确认与账户角标在多轮操作后收敛到服务端事实。
 * 数据链：隔离后端签发账户 → 真实写入与查询 → 原路由交互 → 页面和持久化账户只读观测。
 * 传输延迟或中断只控制真实请求的交付，不替换接口业务结果；会话凭据不写入报告。
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page, PlaywrightTestArgs, Request, Response, Route } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 用例仅使用服务端申领协议中的既有名称，不复制目录。 */
type AchievementName = Misskey.Endpoints['i/claim-achievement']['req']['name'];
/** 测试初始化参数只控制已有 UI 与设备偏好。 */
type SessionOptions = Readonly<{ realtime: boolean; ui?: 'twitter' | 'default' }>;
/** 每个隔离场景的真实账户，仅留在测试进程内。 */
let account: AccountWithToken;
/** 创建本场景其他真实账户所需的隔离管理员，不写入浏览器或报告。 */
let administrator: RegisteredUser;
/** 启动起收集未处理异常，正常传输失败应被业务动作处理。 */
let errors: string[];

test.beforeEach(/** 只重置专用测试端口，不使用开发账户。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	administrator = await registerUser(BASE_URL, 'sync_admin', 'sync-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: administrator.token, username: 'sync_user', password: 'sync-user-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	errors = [];
	page.on('pageerror', /** 只采集异常消息，不序列化请求或账户。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(/** 失败分支也不得留下全局未处理拒绝。 */ (): void => { expect(errors).toEqual([]); });

/** 真实后端申领是页面之外的新业务事实来源。 */
async function claim(name: AchievementName): Promise<void> {
	await api(BASE_URL, 'i/claim-achievement', { i: account.token, name });
}

/** 查询不会标记已读的账户接口，独立核对服务端剩余计数。 */
async function serverUnread(): Promise<number> {
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	return me.unreadNotificationsCount;
}

/** 遵循真实 IndexedDB 协议设置设备偏好，避免把 localStorage 误当 Pizzax。 */
async function seed(page: Page, options: SessionOptions): Promise<void> {
	const session: AccountWithToken = { ...await api(BASE_URL, 'i', { i: account.token }), token: account.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 只准备浏览器持久化输入，账户验证继续经过原 Bootstrap。 */ async ({ session, options }: { session: AccountWithToken; options: SessionOptions }): Promise<void> => {
		localStorage.setItem('account', JSON.stringify(session));
		localStorage.setItem('lang', 'en-US');
		localStorage.setItem('ui', options.ui ?? 'twitter');
		await new Promise<void>(/** IndexedDB 事务完成后再导航，保证设备模式真正生效。 */ (resolve: () => void, reject: (error: Error) => void): void => {
			const request: IDBOpenDBRequest = indexedDB.open('keyval-store');
			request.onupgradeneeded = /** 仅创建原存储协议要求的 object store。 */ (): void => {
				if (!request.result.objectStoreNames.contains('keyval')) request.result.createObjectStore('keyval');
			};
			request.onerror = /** 设备偏好准备失败时中止用例。 */ (): void => { reject(new Error('IndexedDB open failed')); };
			request.onsuccess = /** 不保存完整设备状态，避免将其他会话字段写入产物。 */ (): void => {
				const database: IDBDatabase = request.result;
				const transaction: IDBTransaction = database.transaction('keyval', 'readwrite');
				transaction.objectStore('keyval').put({ realtimeMode: options.realtime }, 'pizzax::base');
				transaction.oncomplete = /** 确认持久化后释放数据库连接。 */ (): void => { database.close(); resolve(); };
				transaction.onerror = /** 只抛出固定错误，不输出数据库内容。 */ (): void => { database.close(); reject(new Error('IndexedDB seed failed')); };
			};
		});
	}, { session, options });
}

/** 当前真正可见的主导航在桌面和移动布局中都消费同一账户状态。 */
function notificationLink(page: Page): Locator {
	return page.locator('nav:visible a[href="/my/notifications"]').first();
}

/** 稳定条目身份来自原目录名称，不使用本地化标题决定业务状态。 */
function achievement(page: Page, name: AchievementName): Locator {
	return page.getByTestId('achievements').locator(`[data-achievement-name="${name}"]`);
}

/** 只观测账户通知字段，禁止将整个持久化会话交给断言或日志。 */
async function clientUnread(page: Page): Promise<number> {
	return page.evaluate(/** 与现有账户更新持久化路径核对，不创建第二份状态。 */ (): number => {
		const value: unknown = JSON.parse(localStorage.getItem('account') ?? 'null');
		return value != null && typeof value === 'object' && 'unreadNotificationsCount' in value && typeof value.unreadNotificationsCount === 'number' ? value.unreadNotificationsCount : -1;
	});
}

/** 服务端、账户和可见角标共同构成验收，不只检查 URL 或单个标签。 */
async function expectUnread(page: Page, count: number): Promise<void> {
	await expect.poll(serverUnread).toBe(count);
	await expect.poll(/** 账户写入后才会持久化新快照。 */ (): Promise<number> => clientUnread(page)).toBe(count);
	await expect(notificationLink(page).locator('span[aria-hidden="true"]')).toHaveCount(count === 0 ? 0 : 1);
}

/** 控制浏览器可见性输入，不改变业务响应或服务端事实。 */
async function visibility(page: Page, state: DocumentVisibilityState): Promise<void> {
	await page.evaluate(/** 触发与真实前后台切换相同的 visibilitychange 输入。 */ (value: DocumentVisibilityState): void => {
		Object.defineProperty(document, 'visibilityState', { configurable: true, value });
		document.dispatchEvent(new Event('visibilitychange'));
	}, state);
}

for (const realtime of [false, true] as const) {
	test(`${realtime ? '实时' : '轮询'}模式缓存回访更新新成就并同步桌面移动角标`, /** 使用相同裸路径命中原缓存实例，避免 query 差异造成假通过。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		test.setTimeout(90_000);
		await claim('notes1');
		await seed(page, { realtime });
		let queries: number = 0;
		let documents: number = 0;
		page.on('request', /** 只统计目标查询，不读取包含凭据的请求体。 */ (request: Request): void => { if (new URL(request.url()).pathname === '/api/users/achievements') queries++; });
		page.on('request', /** 路由回访必须保留原文档，不能靠完整重载获得新列表。 */ (request: Request): void => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
		await page.goto(`${BASE_URL}/my/achievements`);
		await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
		await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'true');
		expect(queries).toBe(1);
		await expectUnread(page, 1);
		await notificationLink(page).click();
		await expect(page.getByTestId('twitter-notifications')).toBeVisible();
		await expectUnread(page, 0);
		await claim('viewAchievements3min');
		const card: Locator = page.locator('a[data-notification-type="achievementEarned"]').filter({ hasText: 'Likes Achievements' });
		await expect(card).toBeVisible({ timeout: 30_000 });
		expect(queries).toBe(1);
		await card.click();
		await expect(page).toHaveURL(`${BASE_URL}/my/achievements`);
		await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'false');
		expect(queries).toBeGreaterThan(1);
		expect(documents).toBe(1);
		await expectUnread(page, 0);
		await page.setViewportSize({ width: 390, height: 900 });
		await expectUnread(page, 0);
	});

	test(`${realtime ? '实时' : '轮询'}模式当前页真实申领成功立即解锁`, /** 非实时模式同样必须依靠成功信号更新，不能等待重连或整页刷新。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		await seed(page, { realtime });
		await page.clock.install();
		await page.goto(`${BASE_URL}/my/achievements`);
		await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'true');
		const completed: Promise<Response> = page.waitForResponse(/** 只认真实三分钟申领的成功回执。 */ (response: Response): boolean => response.url().endsWith('/api/i/claim-achievement') && response.ok() && response.request().postDataJSON()?.name === 'viewAchievements3min');
		await page.clock.fastForward(181_000);
		await page.clock.runFor(1_000);
		await completed;
		await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'false');
		const source: Misskey.entities.UsersAchievementsResponse = await api(BASE_URL, 'users/achievements', { userId: account.id });
		expect(source.some(/** 服务端必须保留相同业务事实。 */ (item: Misskey.entities.UsersAchievementsResponse[number]): boolean => item.name === 'viewAchievements3min')).toBe(true);
	});
}

test('成就查询失败保留原列表，恢复前台后重新确认', /** 失败发生在真实查询传输层，不伪造空集合或错误业务数据。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await claim('notes1');
	await seed(page, { realtime: false });
	await page.goto(`${BASE_URL}/my/achievements`);
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
	await visibility(page, 'hidden');
	await claim('viewAchievements3min');
	await page.route('**/api/users/achievements', /** 请求中断不能覆盖最后成功列表。 */ async (route: Route): Promise<void> => { await route.abort('failed'); });
	const failed: Promise<Request> = page.waitForEvent('requestfailed', { predicate: /** 只等待本次成就请求失败。 */ (request: Request): boolean => request.url().endsWith('/api/users/achievements') });
	await visibility(page, 'visible');
	await failed;
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
	await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'true');
	await page.unroute('**/api/users/achievements');
	await visibility(page, 'hidden');
	await visibility(page, 'visible');
	await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'false');
});

test('已读写入失败保留角标，恢复可见后与真实服务端对账', /** 同时中断既有自动已读查询与显式已读，避免其他成功路径掩盖失败。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await claim('notes1');
	await seed(page, { realtime: false });
	await page.route(/\/api\/i\/notifications(?:-grouped)?(?:\?|$)/, /** 保持尚未读取的真实服务端状态。 */ async (route: Route): Promise<void> => { await route.abort('failed'); });
	await page.route('**/api/notifications/mark-all-as-read', /** 已读失败必须由调用方处理，不乐观清零。 */ async (route: Route): Promise<void> => { await route.abort('failed'); });
	await page.goto(`${BASE_URL}/my/notifications`);
	await expect(page.getByTestId('twitter-notifications')).toBeVisible();
	await expectUnread(page, 1);
	await page.unroute('**/api/notifications/mark-all-as-read');
	await page.unroute(/\/api\/i\/notifications(?:-grouped)?(?:\?|$)/);
	await visibility(page, 'hidden');
	await visibility(page, 'visible');
	await expectUnread(page, 0);
});

test('既有三个 HTTP 已读入口在返回后即可读取已确认水位', /** 每次产生新的真实通知，紧接成功响应读取账户，验证服务端完成边界。 */ async (): Promise<void> => {
	await claim('notes1');
	await expect.poll(serverUnread).toBe(1);
	await api(BASE_URL, 'notifications/mark-all-as-read', { i: account.token });
	expect(await serverUnread()).toBe(0);
	await claim('login3');
	await expect.poll(serverUnread).toBe(1);
	await api(BASE_URL, 'i/notifications', { i: account.token, limit: 20 });
	expect(await serverUnread()).toBe(0);
	await claim('markedAsCat');
	await expect.poll(serverUnread).toBe(1);
	await api(BASE_URL, 'i/notifications-grouped', { i: account.token, limit: 20 });
	expect(await serverUnread()).toBe(0);
});

test('旧成就查询交付期间发生申领，完成后仍展示最新服务端事实', /** 延迟真实旧响应，证明在途成功意图不会被请求完成清掉。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await claim('notes1');
	await seed(page, { realtime: false });
	await page.goto(`${BASE_URL}/my/achievements`);
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
	let release: () => void = /** 路由尚未捕获响应前无需释放资源。 */ (): void => {};
	let captured: () => void = /** Promise 初始化时替换为实际通知函数。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 延迟交付，不修改后端返回的实际内容。 */ (resolve: () => void): void => { release = resolve; });
	const ready: Promise<void> = new Promise<void>(/** 显式等待旧查询读取完成，避免依赖固定睡眠。 */ (resolve: () => void): void => { captured = resolve; });
	let hold: boolean = true;
	await page.route('**/api/users/achievements', /** 仅延迟第一份真实旧快照，后续查询正常交付。 */ async (route: Route): Promise<void> => {
		if (!hold) { await route.continue(); return; }
		hold = false;
		const response: Awaited<ReturnType<Route['fetch']>> = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await visibility(page, 'hidden');
		await visibility(page, 'visible');
		await ready;
		const completed: Promise<Response> = page.waitForResponse(/** 申领必须实际成功，才能产生下一轮刷新意图。 */ (response: Response): boolean => response.url().endsWith('/api/i/claim-achievement') && response.ok() && response.request().postDataJSON()?.name === 'clickedClickHere');
		await achievement(page, 'clickedClickHere').click();
		await completed;
		release();
		await expect(achievement(page, 'clickedClickHere')).toHaveAttribute('data-achievement-locked', 'false');
		await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
	} finally {
		release();
		await page.unroute('**/api/users/achievements');
	}
});

test('旧账户快照延迟交付后仍保留新通知的真实剩余计数', /** 使用真实实时事件使旧查询失效，验证计数既不清零也不重复加一。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await seed(page, { realtime: true });
	await page.goto(`${BASE_URL}/my/achievements`);
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'true');
	// 原全局通知弹层会在前台自动已读；后台接收才能建立真正尚未读取的新通知。
	await visibility(page, 'hidden');
	let release: () => void = /** 尚无被延迟响应时的释放操作为空。 */ (): void => {};
	let captured: () => void = /** 初始化后由真实响应捕获调用。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 保存本次实际账户快照的交付闸门。 */ (resolve: () => void): void => { release = resolve; });
	const ready: Promise<void> = new Promise<void>(/** 后端完成查询后才创建下一条通知。 */ (resolve: () => void): void => { captured = resolve; });
	let hold: boolean = true;
	await page.route('**/api/i', /** 保留原响应，避免制造虚构的未读业务数据。 */ async (route: Route): Promise<void> => {
		if (!hold) { await route.continue(); return; }
		hold = false;
		const response: Awaited<ReturnType<Route['fetch']>> = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await claim('notes1');
		await ready;
		await claim('login3');
		await expect.poll(serverUnread).toBe(2);
		release();
		await expectUnread(page, 2);
		// 后端第二条未读事件可能比包含它的 HTTP 快照晚到；最终仍应恰为两条。
		await expect.poll(/** 服务端与账户计数持续按同一口径观察。 */ async (): Promise<boolean> => await clientUnread(page) === await serverUnread()).toBe(true);
	} finally {
		release();
		await page.unroute('**/api/i');
	}
});

test('切换持久化会话后旧账户响应不得覆盖新账户', /** 重现换号写入凭据到重载之间的窗口，两账户均由真实后端签发。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const other: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: administrator.token, username: 'sync_other', password: 'sync-other-test-password' });
	const nextSession: AccountWithToken = { ...await api(BASE_URL, 'i', { i: other.token }), token: other.token };
	await seed(page, { realtime: true });
	await page.goto(`${BASE_URL}/my/achievements`);
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'true');
	let release: () => void = /** 未捕获旧响应前无需清理。 */ (): void => {};
	let captured: () => void = /** 真实账户查询完成时通知测试继续。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 延迟旧响应交付，服务端数据保持真实。 */ (resolve: () => void): void => { release = resolve; });
	const ready: Promise<void> = new Promise<void>(/** 凭据切换发生在已发出旧请求之后。 */ (resolve: () => void): void => { captured = resolve; });
	let hold: boolean = true;
	await page.route('**/api/i', /** 只延迟当前旧账户的一次查询。 */ async (route: Route): Promise<void> => {
		if (!hold) { await route.continue(); return; }
		hold = false;
		const response: Awaited<ReturnType<Route['fetch']>> = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await claim('notes1');
		await ready;
		await page.evaluate(/** 使用原账户切换持久化协议，不修改 Store 或伪造成就。 */ (session: AccountWithToken): void => { localStorage.setItem('account', JSON.stringify(session)); }, nextSession);
		const delivered: Promise<Response> = page.waitForResponse(/** 等到真正迟到的旧账户响应完成交付。 */ (response: Response): boolean => new URL(response.url()).pathname === '/api/i');
		release();
		await delivered;
		expect(await clientUnread(page)).toBe(0);
		const currentId: string | null = await page.evaluate(/** 仅观测不含凭据的账户标识。 */ (): string | null => {
			const value: unknown = JSON.parse(localStorage.getItem('account') ?? 'null');
			return value != null && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null;
		});
		expect(currentId).toBe(other.id);
		await page.unroute('**/api/i');
		await page.reload();
		await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'true');
		await expectUnread(page, 0);
	} finally {
		release();
		await page.unroute('**/api/i');
	}
});
