/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：Twitter 搜索的真实后端交互回归。
 * 作用：验证权限、路由参数、原生表单隔离、分页工具条、筛选生命周期、过期请求及页头连续性。
 * 数据链：隔离实例的真实账户／角色／帖子 → 原搜索入口 → 真实 API → DOM 与逐帧观测。
 * 边界：仅延迟真实请求，不伪造业务响应；reset-db 只作用于专用测试实例。
 */
import { expect, test } from '@playwright/test';
import type { JSHandle, Locator, Page, PlaywrightTestArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { PossiblyNonNormalizedPreferencesProfile } from '../../src/preferences/manager.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 每个用例独占隔离实例中的真实管理会话。 */
let admin: RegisteredUser;
/** 普通搜索账户只持有服务端签发的账户和权限。 */
let viewer: AccountWithToken;
/** 第二个作者用于证明用户筛选没有遗留或被错误放宽。 */
let author: AccountWithToken;
/** 可撤销的真实搜索角色，用于证明权限边界。 */
let searchRole: Misskey.entities.Role;
/** 同一关键词在不同作者下对应不同实体。 */
let first: Misskey.entities.Note;
/** 自己的同关键词帖子用于验证清除用户筛选。 */
let own: Misskey.entities.Note;
/** 下一轮关键词的结果不能被上一轮迟到请求替换。 */
let latest: Misskey.entities.Note;
/** 仅收集异常消息，避免把会话信息写入验收附件。 */
let errors: string[];

/** 闸门只改变真实传输时序，不保存或替换响应内容。 */
type TransportGate = Readonly<{ reached: Promise<void>; finished: Promise<void>; release: () => void }>;
/** 每帧只读检查搜索容器，没有业务状态投影。 */
type SearchFrames = Readonly<{ frames: number; missingHeader: number; replacedHeader: number; missingTabs: number; pageFallback: number }>;
/** 浏览器中一次观测的结束动作。 */
type SearchMonitor = Readonly<{ finish: () => SearchFrames }>;
/** 网络断言只提取请求条件，禁止记录认证字段。 */
type SearchRequest = Readonly<{ query?: string; userId?: string; host?: string; origin?: string }>;
/** 工具条请求的只读证据从既有 Schema 派生，字段存在性单独证明没有发送空范围参数。 */
type NoteSearchEvidence = Readonly<{
	conditions: Partial<Pick<Misskey.Endpoints['notes/search']['req'], 'query' | 'userId' | 'host' | 'sinceId' | 'sinceDate' | 'untilDate' | 'rangeStartAt' | 'rangeEndAt'>>;
	hasRangeStartAt: boolean;
	hasRangeEndAt: boolean;
}>;

/** 从实际请求中读取白名单条件，不输出请求原文。 */
function requestConditions(request: Request): SearchRequest {
	const body: Record<string, unknown> = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
	return {
		query: typeof body.query === 'string' ? body.query : undefined,
		userId: typeof body.userId === 'string' ? body.userId : undefined,
		host: typeof body.host === 'string' ? body.host : undefined,
		origin: typeof body.origin === 'string' ? body.origin : undefined,
	};
}

/** 用户操作仍访问原后端，只提取本次验证需要的协议字段，避免失败附件输出令牌。 */
async function observeNoteSearch(page: Page, action: () => Promise<void>): Promise<NoteSearchEvidence> {
	const pending: Promise<Request> = page.waitForRequest(/** 只捕获操作后新发的首窗请求，排除已在途响应和自动分页实体游标。 */ (request: Request): boolean => {
		if (new URL(request.url()).pathname !== '/api/notes/search' || request.method() !== 'POST') return false;
		const body: Record<string, unknown> = request.postDataJSON() as Record<string, unknown>;
		return body.untilId == null && (body.sinceId == null || body.sinceId === '0');
	});
	await action();
	const request: Request = await pending;
	const response: Response | null = await request.response();
	expect(response?.ok()).toBe(true);
	const body: Record<string, unknown> = request.postDataJSON() as Record<string, unknown>;
	return {
		conditions: {
			query: typeof body.query === 'string' ? body.query : undefined,
			userId: typeof body.userId === 'string' ? body.userId : undefined,
			host: typeof body.host === 'string' ? body.host : undefined,
			sinceId: typeof body.sinceId === 'string' ? body.sinceId : undefined,
			sinceDate: typeof body.sinceDate === 'number' ? body.sinceDate : undefined,
			untilDate: typeof body.untilDate === 'number' ? body.untilDate : undefined,
			rangeStartAt: typeof body.rangeStartAt === 'number' || body.rangeStartAt === null ? body.rangeStartAt : undefined,
			rangeEndAt: typeof body.rangeEndAt === 'number' || body.rangeEndAt === null ? body.rangeEndAt : undefined,
		},
		hasRangeStartAt: Object.hasOwn(body, 'rangeStartAt'),
		hasRangeEndAt: Object.hasOwn(body, 'rangeEndAt'),
	};
}

/** Twitter 自动搜索的操作必须保留同一 URL 用户范围，并彻底省略原生时间范围字段。 */
function expectScopedToolbarRequest(evidence: NoteSearchEvidence): void {
	expect(evidence.conditions).toMatchObject({ query: '你好', userId: author.id, host: '.' });
	expect(evidence.hasRangeStartAt).toBe(false);
	expect(evidence.hasRangeEndAt).toBe(false);
}

/** 只延迟匹配条件的原请求；显式放行后仍访问真实后端。 */
async function holdTransport(page: Page, pattern: string, matches: (request: Request) => boolean = /** 默认延迟 URL 命中的请求。 */ (): boolean => true): Promise<TransportGate> {
	let release: () => void = /** 安装完成前不存在待释放任务。 */ (): void => {};
	let reached: () => void = /** 请求到达后才通知测试。 */ (): void => {};
	let finished: () => void = /** 放行完成后才结束请求观测。 */ (): void => {};
	let held: boolean = false;
	const waiting: Promise<void> = new Promise<void>(/** 保存测试的显式放行入口。 */ (resolve: () => void): void => { release = resolve; });
	const arrived: Promise<void> = new Promise<void>(/** 保存首个请求到达通知。 */ (resolve: () => void): void => { reached = resolve; });
	const completed: Promise<void> = new Promise<void>(/** 等待路由处理完成，避免测试提前结束或撤下在途 handler。 */ (resolve: () => void): void => { finished = resolve; });
	await page.route(pattern, /** 不替换协议或业务结果，只控制时序。 */ async (route: Route): Promise<void> => {
		if (!held && matches(route.request())) {
			held = true;
			reached();
			await waiting;
			await route.continue();
			finished();
			return;
		}
		await route.continue();
	});
	return { reached: arrived, finished: completed, release };
}

/** 注入产品已有的会话及偏好持久化格式，登录授权仍由后端验证。 */
async function openSearch(page: Page, query: string = '你好', extra: Readonly<Record<string, string>> = {}, stacked: boolean = false, twitter: boolean = true): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 偏好只决定出口展示，不能改变搜索领域规则。 */ (input: { account: AccountWithToken; stacked: boolean; twitter: boolean }): void => {
		const preferences: PossiblyNonNormalizedPreferencesProfile = {
			id: 'search-regression', version: '1', type: 'main', modifiedAt: Date.now(), name: 'Search regression',
			preferences: { 'experimental.stackingRouterView': [[{}, input.stacked, {}]] },
		};
		localStorage.setItem('account', JSON.stringify(input.account));
		localStorage.setItem('lang', 'en-US');
		localStorage.setItem('preferences', JSON.stringify(preferences));
		localStorage.setItem('ui', input.twitter ? 'twitter' : 'universal');
	}, { account: viewer, stacked, twitter });
	const params: URLSearchParams = new URLSearchParams({ q: query, ...extra, ui: twitter ? 'twitter' : 'default' });
	await page.goto(`${BASE_URL}/search?${params.toString()}`);
	if (twitter) await expect(page.getByTestId('twitter-search-header')).toBeVisible();
}

/** 右栏常驻输入仅从真实组件定位，不操作 Vue 内部状态。 */
function railInput(page: Page): Locator {
	return page.getByTestId('twitter-right-rail').locator('input[name="q"]');
}

/** 搜索主表单与右栏独立，临时草稿由各自原有表单管理。 */
function mainInput(page: Page): Locator {
	return page.getByTestId('twitter-search-header').last().locator('input[name="q"]');
}

/** 当前结果只按服务端实体标识断言，避免把后台缓存树混入。 */
function resultNote(page: Page, note: Misskey.entities.Note): Locator {
	return page.getByTestId('twitter-search-results').last().locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]`);
}

/** 通过用户真实键盘提交右栏表单，触发既有 SPA 导航。 */
async function submitRail(page: Page, query: string): Promise<void> {
	await railInput(page).fill(query);
	await railInput(page).press('Enter');
	await expect(mainInput(page)).toHaveValue(query.trim());
}

/** 逐帧检测主搜索容器是否被整页加载占位替换。 */
async function monitorSearch(page: Page): Promise<JSHandle<SearchMonitor>> {
	return page.getByTestId('twitter-search-header').evaluateHandle(/** 保留真实节点引用，仅收集视觉连续性。 */ (header: HTMLElement): SearchMonitor => {
		let frames: number = 0;
		let missingHeader: number = 0;
		let replacedHeader: number = 0;
		let missingTabs: number = 0;
		let pageFallback: number = 0;
		let frame: number = 0;

		/** 每个绘制边界都必须保留原搜索框与标签。 */
		function sample(): void {
			frames++;
			if (!header.isConnected) missingHeader++;
			if (document.querySelector('[data-testid="twitter-search-header"]') !== header) replacedHeader++;
			if (document.querySelector('[role="tablist"]') == null) missingTabs++;
			if (document.querySelector('[data-testid="twitter-route-loading"]') != null) pageFallback++;
			frame = requestAnimationFrame(sample);
		}

		frame = requestAnimationFrame(sample);
		return { finish: /** 结束时释放观测任务，不污染下个用例。 */ (): SearchFrames => {
			cancelAnimationFrame(frame);
			return { frames, missingHeader, replacedHeader, missingTabs, pageFallback };
		} };
	});
}

/** 同时验收过程与终态，计数作为可复查附件保存。 */
async function expectContinuous(monitor: JSHandle<SearchMonitor>, info: TestInfo): Promise<void> {
	const frames: SearchFrames = await monitor.evaluate(/** 只回传不含业务数据的观测计数。 */ (value: SearchMonitor): SearchFrames => value.finish());
	await monitor.dispose();
	await info.attach('search-continuity', { body: JSON.stringify(frames), contentType: 'application/json' });
	expect(frames.frames).toBeGreaterThan(0);
	expect(frames.missingHeader).toBe(0);
	expect(frames.replacedHeader).toBe(0);
	expect(frames.missingTabs).toBe(0);
	expect(frames.pageFallback).toBe(0);
}

test.beforeEach(/** 每个场景重建专用实例，不读取开发会话或开发数据库。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'search_admin', 'search-admin-password', true);
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, federation: 'all' });
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'search_viewer', password: 'search-viewer-password' });
	author = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'search_author', password: 'search-author-password' });
	await api(BASE_URL, 'i/update', { i: author.token, name: '你好搜索用户' });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	searchRole = await api(BASE_URL, 'admin/roles/create', {
		i: admin.token, name: 'Search regression', description: 'Private test search permission', color: null, iconUrl: null,
		target: 'manual', condFormula: {}, isPublic: false, isModerator: false, isAdministrator: false,
		asBadge: false, canEditMembersByModerator: false, displayOrder: 0,
		policies: { canSearchNotes: { useDefault: false, priority: 1, value: true } },
	});
	await api(BASE_URL, 'admin/roles/assign', { i: admin.token, roleId: searchRole.id, userId: viewer.id });
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: viewer.token });
	viewer = { ...me, token: viewer.token };
	expect(viewer.policies.canSearchNotes).toBe(true);
	first = (await api(BASE_URL, 'notes/create', { i: author.token, text: '你好：作者的一条真实搜索结果' }) as Misskey.Endpoints['notes/create']['res']).createdNote;
	own = (await api(BASE_URL, 'notes/create', { i: viewer.token, text: '你好：自己的另一条真实搜索结果' }) as Misskey.Endpoints['notes/create']['res']).createdNote;
	latest = (await api(BASE_URL, 'notes/create', { i: author.token, text: '再见：新关键词的真实搜索结果' }) as Misskey.Endpoints['notes/create']['res']).createdNote;
	errors = [];
	page.on('pageerror', /** 只保存异常消息，认证请求原文不进入输出。 */ (error: Error): void => { errors.push(error.message); });
});

test.afterEach(/** 成功展示不能掩盖未处理的异步异常。 */ (): void => { expect(errors).toEqual([]); });

for (const stacked of [false, true] as const) {
	test(`${stacked ? '叠层' : '普通'}出口首次加载用户及连续单击切换保持搜索页头`, /** 冷用户模块与热结果两条路径都经过真实原组件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await openSearch(page, '你好', {}, stacked);
		await expect(resultNote(page, first)).toBeVisible();
		const gate: TransportGate = await holdTransport(page, '**/api/users/search');
		const monitor: JSHandle<SearchMonitor> = await monitorSearch(page);
		try {
			await page.locator('[data-twitter-search-tab="user"]').click();
			await gate.reached;
			await expect(page.locator('[data-twitter-search-tab="user"]')).toHaveAttribute('aria-selected', 'true');
			await expect(mainInput(page)).toHaveValue('你好');
			await expect(railInput(page)).toHaveValue('你好');
			gate.release();
			await expect(page.getByTestId('twitter-search-results').locator('a[href="/@search_author"]').first()).toBeVisible();
			for (let round: number = 0; round < 3; round++) {
				await page.locator('[data-twitter-search-tab="note"]').click();
				await expect(page.locator('[data-twitter-search-tab="note"]')).toHaveAttribute('aria-selected', 'true');
				await expect(resultNote(page, first)).toBeVisible();
				await page.locator('[data-twitter-search-tab="user"]').click();
				await expect(page.locator('[data-twitter-search-tab="user"]')).toHaveAttribute('aria-selected', 'true');
				await expect(page.getByTestId('twitter-search-results').locator('a[href="/@search_author"]').first()).toBeVisible();
			}
			await expectContinuous(monitor, info);
			await page.screenshot({ path: info.outputPath('search-users.png'), animations: 'disabled' });
		} finally { gate.release(); }
	});
}

test('常驻搜索回车更新真实关键词与结果且不序列化空筛选', /** 由真实右栏进入搜索页，再经主表单提交下一轮条件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page, '你好');
	await expect(resultNote(page, first)).toBeVisible();
	await submitRail(page, '  再见  ');
	await expect(railInput(page)).toHaveValue('再见');
	await expect(resultNote(page, latest)).toBeVisible();
	await expect(resultNote(page, first)).toHaveCount(0);
	await mainInput(page).fill('你好');
	await mainInput(page).press('Enter');
	await expect(resultNote(page, first)).toBeVisible();
	const params: URLSearchParams = new URL(page.url()).searchParams;
	expect(params.get('q')).toBe('你好');
	expect(params.has('userId')).toBe(false);
	expect(params.has('username')).toBe(false);
	expect(params.has('host')).toBe(false);
	expect(page.url()).not.toContain('undefined');
});

test('更新关键词后迟到的真实帖子请求不能覆盖当前结果', /** 只推迟旧关键词传输，后端仍生成两轮真实搜索结果。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const gate: TransportGate = await holdTransport(page, '**/api/notes/search', /** 只持有旧关键词。 */ (request: Request): boolean => requestConditions(request).query === '你好');
	try {
		await openSearch(page);
		await gate.reached;
		await submitRail(page, '再见');
		await expect(resultNote(page, latest)).toBeVisible();
		const response: Promise<Response> = page.waitForResponse(/** 旧查询必须真实完成后再断言未覆盖。 */ (response: Response): boolean => new URL(response.url()).pathname === '/api/notes/search' && requestConditions(response.request()).query === '你好');
		gate.release();
		await gate.finished;
		await response;
		await expect(resultNote(page, latest)).toBeVisible();
		await expect(resultNote(page, first)).toHaveCount(0);
	} finally { gate.release(); }
});

test('原位更新查询时清除旧用户和 host 筛选', /** 初始用户范围和后续全站范围必须对应各自的真实结果。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page, '你好', { userId: author.id, host: '.' });
	await expect(resultNote(page, first)).toBeVisible();
	await expect(resultNote(page, own)).toHaveCount(0);
	await submitRail(page, '你好');
	await expect(resultNote(page, own)).toBeVisible();
	await expect(resultNote(page, first)).toBeVisible();
});

test('已取消的用户解析不能把旧用户筛选带入新查询', /** 用户资料解析到达前使用右栏发起无用户筛选的新搜索。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const gate: TransportGate = await holdTransport(page, '**/api/users/show');
	try {
		await openSearch(page, '你好', { username: author.username });
		await gate.reached;
		await submitRail(page, '再见');
		await expect(resultNote(page, latest)).toBeVisible();
		gate.release();
		await gate.finished;
		await expect(resultNote(page, latest)).toBeVisible();
		await expect(resultNote(page, first)).toHaveCount(0);
	} finally { gate.release(); }
});

test('用户筛选解析失败显示局部错误且不会退化为全站搜索', /** 不存在的用户由真实后端拒绝，不使用伪造错误响应。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const requests: SearchRequest[] = [];
	page.on('request', /** 只观察帖子查询的筛选白名单。 */ (request: Request): void => { if (new URL(request.url()).pathname === '/api/notes/search') requests.push(requestConditions(request)); });
	await openSearch(page, '你好', { username: 'missing_search_user' });
	await expect(page.getByTestId('twitter-search-results').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	expect(requests).toEqual([]);
	await expect(resultNote(page, first)).toHaveCount(0);
	await submitRail(page, '你好');
	await expect(resultNote(page, first)).toBeVisible();
});

test('用户来源与关键词整组更新且旧来源不泄漏到新搜索', /** 用户来源筛选由真实用户搜索 API 验证。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page, '你好', { type: 'user', origin: 'remote' });
	await expect(page.getByTestId('twitter-search-results').getByRole('heading', { name: 'There are no users', exact: true })).toBeVisible();
	const requests: SearchRequest[] = [];
	page.on('request', /** 只保留来源和关键词，不保存会话字段。 */ (request: Request): void => { if (new URL(request.url()).pathname === '/api/users/search') requests.push(requestConditions(request)); });
	await submitRail(page, '你好');
	await page.locator('[data-twitter-search-tab="user"]').click();
	await expect(page.getByTestId('twitter-search-results').locator('a[href="/@search_author"]').first()).toBeVisible();
	expect(requests.every(/** 新搜索默认范围由新路由决定。 */ (request: SearchRequest): boolean => request.origin === 'combined')).toBe(true);
});

test('返回前进、刷新与直接链接保持关键词和当前标签一致', /** 历史项来自真实右栏 push，页内标签继续使用 replace。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page);
	await expect(resultNote(page, first)).toBeVisible();
	await submitRail(page, '再见');
	await expect(resultNote(page, latest)).toBeVisible();
	await page.locator('[data-twitter-search-tab="user"]').click();
	await expect(page.locator('[data-twitter-search-tab="user"]')).toHaveAttribute('aria-selected', 'true');
	await page.goBack();
	await expect(mainInput(page)).toHaveValue('你好');
	await expect(page.locator('[data-twitter-search-tab="note"]')).toHaveAttribute('aria-selected', 'true');
	await page.goForward();
	await expect(mainInput(page)).toHaveValue('再见');
	await expect(page.locator('[data-twitter-search-tab="user"]')).toHaveAttribute('aria-selected', 'true');
	await page.reload();
	await expect(mainInput(page)).toHaveValue('再见');
	await expect(railInput(page)).toHaveValue('再见');
	await expect(page.locator('[data-twitter-search-tab="user"]')).toHaveAttribute('aria-selected', 'true');
});

test('没有帖子搜索权限时用户搜索仍能正常命中', /** 后端撤销角色后刷新真实账户快照，前端不可绕过授权。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await api(BASE_URL, 'admin/roles/unassign', { i: admin.token, roleId: searchRole.id, userId: viewer.id });
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: viewer.token });
	viewer = { ...me, token: viewer.token };
	expect(viewer.policies.canSearchNotes).toBe(false);
	const requests: SearchRequest[] = [];
	page.on('request', /** 授权关闭时不得启动帖子分页器。 */ (request: Request): void => { if (new URL(request.url()).pathname === '/api/notes/search') requests.push(requestConditions(request)); });
	await openSearch(page);
	await expect(page.getByText('Note search is unavailable.', { exact: true })).toBeVisible();
	await page.locator('[data-twitter-search-tab="user"]').click();
	await expect(page.getByTestId('twitter-search-results').locator('a[href="/@search_author"]').first()).toBeVisible();
	expect(requests).toEqual([]);
});

test('窄屏搜索键盘切换保持单次动作及页头连续性', /** 移动端无右栏时仍使用相同受控标签和查询生命周期。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openSearch(page);
	await expect(resultNote(page, first)).toBeVisible();
	const monitor: JSHandle<SearchMonitor> = await monitorSearch(page);
	await page.locator('[data-twitter-search-tab="note"]').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('[data-twitter-search-tab="user"]')).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('[data-twitter-search-tab="user"]')).toBeFocused();
	await page.keyboard.press('Home');
	await expect(page.locator('[data-twitter-search-tab="note"]')).toHaveAttribute('aria-selected', 'true');
	await expect(resultNote(page, first)).toBeVisible();
	await expectContinuous(monitor, info);
	await page.screenshot({ path: info.outputPath('search-mobile.png'), animations: 'disabled' });
});

test('默认 Misskey 搜索界面仍支持手动查询和标签切换', /** 稳定路由实例不能破坏原有基础界面的搜索方式。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page, '你好', {}, false, false);
	await expect(page.getByTestId('twitter-search-header')).toHaveCount(0);
	const form: Locator = page.getByTestId('search-note-form');
	await expect(form).toBeVisible();
	await expect(form.getByText('Options', { exact: true })).toBeVisible();
	await expect(form.locator('input[type="datetime-local"]')).toHaveCount(2);
	await expect(form.locator('input[type="radio"]').first()).toBeAttached();
	await expect(form.getByRole('checkbox').first()).toBeVisible();
	const search: Locator = form.locator('input[type="search"]');
	await expect(search).toHaveValue('你好');
	await form.locator('input[type="datetime-local"]').first().fill('2000-01-01T00:00');
	await form.locator('input[type="datetime-local"]').last().fill('2099-01-01T00:00');
	const evidence: NoteSearchEvidence = await observeNoteSearch(page, /** 默认页面依然通过原手动提交按钮创建结果查询。 */ async (): Promise<void> => { await form.getByRole('button', { name: 'Search', exact: true }).click(); });
	expect(evidence.hasRangeStartAt).toBe(true);
	expect(evidence.hasRangeEndAt).toBe(true);
	expect(evidence.conditions.rangeStartAt).toBeGreaterThan(0);
	expect(evidence.conditions.rangeEndAt).toBeGreaterThan(evidence.conditions.rangeStartAt ?? 0);
	await expect(page.getByText(first.text ?? '', { exact: true })).toBeVisible();
	await form.locator('input[type="datetime-local"]').first().fill('2098-01-01T00:00');
	const futureTimestamp: number = await page.evaluate(/** 使用浏览器原生本地时间语义核对序列化值。 */ (): number => new Date('2098-01-01T00:00').getTime());
	const future: NoteSearchEvidence = await observeNoteSearch(page, /** 未来窗口必须由真实后端排除当前夹具，证明手动范围仍然生效。 */ async (): Promise<void> => { await form.getByRole('button', { name: 'Search', exact: true }).click(); });
	expect(future.conditions.rangeStartAt).toBe(futureTimestamp);
	await expect(page.getByText(first.text ?? '', { exact: true })).toHaveCount(0);
	await expect(page.getByText('No notes', { exact: true })).toBeVisible();
	await form.locator('input[type="datetime-local"]').first().fill('');
	await form.locator('input[type="datetime-local"]').last().fill('');
	await observeNoteSearch(page, /** 清除范围并重新手动提交后恢复同一真实帖子。 */ async (): Promise<void> => { await form.getByRole('button', { name: 'Search', exact: true }).click(); });
	await expect(page.getByText(first.text ?? '', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: /Users/ }).click();
	await page.locator('input[type="search"]').first().press('Enter');
	await expect(page.locator('a[href="/@search_author"]').filter({ visible: true }).first()).toBeVisible();
	await page.locator('a[href="/search"]').filter({ visible: true }).first().click();
	await expect(page.locator('input[type="search"]').first()).toHaveValue('');
	await expect(page.getByText('Options', { exact: true })).toBeVisible();
});

test('Twitter 仅挂载分页工具条且排序日历刷新始终保留 URL 用户范围', /** 真实 SQL 搜索证明协议与用户筛选没有被展示收起逻辑改写，不扩展其他搜索引擎排序规则。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const initial: NoteSearchEvidence = await observeNoteSearch(page, /** 自动模式仍使用已提交路由启动真实查询。 */ async (): Promise<void> => { await openSearch(page, '你好', { userId: author.id, host: '.' }); });
	expectScopedToolbarRequest(initial);
	await expect(resultNote(page, first)).toBeVisible();
	await expect(resultNote(page, own)).toHaveCount(0);
	await expect(page.getByTestId('search-note-form')).toHaveCount(0);
	await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
	await expect(page.getByText('Options', { exact: true })).toHaveCount(0);
	const results: Locator = page.getByTestId('twitter-search-results');
	const order: Locator = results.locator('[tabindex="0"]').filter({ has: page.locator('.ti-arrows-sort') });
	const calendar: Locator = results.getByRole('button').filter({ has: page.locator('.ti-calendar-clock') });
	const refresh: Locator = results.getByRole('button').filter({ has: page.locator('.ti-refresh') });
	await expect(order).toBeVisible();
	await expect(calendar).toBeVisible();
	await expect(refresh).toBeVisible();
	const opened: NoteSearchEvidence = await observeNoteSearch(page, /** 默认从新到旧按既有 untilDate 游标重查。 */ async (): Promise<void> => { await calendar.click(); });
	expectScopedToolbarRequest(opened);
	expect(opened.conditions.untilDate).toBeGreaterThan(0);
	expect(opened.conditions.sinceDate).toBeUndefined();
	const date: Locator = results.locator('input[type="date"]');
	await expect(date).toBeVisible();
	const until: NoteSearchEvidence = await observeNoteSearch(page, /** 日期编辑沿用原生 date 控件及分页器日期转换。 */ async (): Promise<void> => { await date.fill('2099-01-01'); });
	expectScopedToolbarRequest(until);
	expect(until.conditions.untilDate).toBe(Date.parse('2099-01-01'));
	const closed: NoteSearchEvidence = await observeNoteSearch(page, /** 关闭日历撤回日期游标，不重建原生范围表单。 */ async (): Promise<void> => { await calendar.click(); });
	expectScopedToolbarRequest(closed);
	expect(closed.conditions.untilDate).toBeUndefined();
	expect(closed.conditions.sinceDate).toBeUndefined();
	await expect(date).toHaveCount(0);
	await order.click();
	const oldest: NoteSearchEvidence = await observeNoteSearch(page, /** 只验证原有 oldest 触发 sinceId=0 的分页契约。 */ async (): Promise<void> => { await page.getByRole('menuitem', { name: /Oldest First$/ }).click(); });
	expectScopedToolbarRequest(oldest);
	expect(oldest.conditions.sinceId).toBe('0');
	await expect(order).toContainText('Oldest First');
	const sinceOpened: NoteSearchEvidence = await observeNoteSearch(page, /** 从旧到新开启日历时使用同一分页器的 sinceDate。 */ async (): Promise<void> => { await calendar.click(); });
	expectScopedToolbarRequest(sinceOpened);
	expect(sinceOpened.conditions.sinceDate).toBeGreaterThan(0);
	expect(sinceOpened.conditions.untilDate).toBeUndefined();
	const since: NoteSearchEvidence = await observeNoteSearch(page, /** 修改日期不能清空已确认的实体和主机筛选。 */ async (): Promise<void> => { await date.fill('2000-01-01'); });
	expectScopedToolbarRequest(since);
	expect(since.conditions.sinceDate).toBe(Date.parse('2000-01-01'));
	const sinceClosed: NoteSearchEvidence = await observeNoteSearch(page, /** 再次关闭日历恢复无日期的原排序请求。 */ async (): Promise<void> => { await calendar.click(); });
	expectScopedToolbarRequest(sinceClosed);
	expect(sinceClosed.conditions.sinceDate).toBeUndefined();
	expect(sinceClosed.conditions.untilDate).toBeUndefined();
	expect(sinceClosed.conditions.sinceId).toBe('0');
	const refreshed: NoteSearchEvidence = await observeNoteSearch(page, /** 刷新只重新执行原查询，不恢复已移除的隐藏表单参数。 */ async (): Promise<void> => { await refresh.click(); });
	expectScopedToolbarRequest(refreshed);
	expect(refreshed.conditions.sinceId).toBe('0');
	await expect(resultNote(page, first)).toBeVisible();
	await expect(resultNote(page, own)).toHaveCount(0);
});

test('用户名与点号本地主机通过既有接口正确解析用户', /** users/show 使用缺省本地主机，notes/search 保留点号本地约定。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page, '你好', { username: author.username, host: '.' });
	await expect(resultNote(page, first)).toBeVisible();
	await expect(resultNote(page, own)).toHaveCount(0);
});

test('话题入口仅属于帖子标签且普通与叠层用户搜索保留真实简介链接', /** 同一真实关键词经过切换、直达与历史恢复；仅界面快捷入口受标签约束，不改写用户内容。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await api(BASE_URL, 'i/update', { i: author.token, name: '#test 搜索用户', description: '真实用户简介中的 #test 链接必须保留。' });
	const created: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: author.token, text: '#test 真实话题帖子' });
	const tagged: Misskey.entities.Note = created.createdNote;
	for (const stacked of [false, true] as const) {
		await openSearch(page, '#test', {}, stacked);
		await expect(resultNote(page, tagged)).toBeVisible();
		const hint: Locator = page.getByTestId('twitter-search-results').last().getByRole('button', { name: 'このハッシュタグを見る #test', exact: true });
		await expect(hint).toBeVisible();
		const containerClass: string = await hint.evaluate(/** 从真实入口获取现有容器类，不要求产品增加测试专用结构。 */ (element: HTMLElement): string => element.parentElement?.classList[0] ?? '');
		expect(containerClass).not.toBe('');

		/** 用户列表必须保留真实简介的话题链接，同时移除整个快捷入口容器。 */
		async function expectUserResults(): Promise<Locator> {
			const results: Locator = page.getByTestId('twitter-search-results').last();
			const user: Locator = results.locator('article').filter({ has: page.locator('a[href="/@search_author"]') }).first();
			await expect(page.locator('[data-twitter-search-tab="user"]').last()).toHaveAttribute('aria-selected', 'true');
			await expect(user).toContainText('真实用户简介中的');
			await expect(user.getByRole('link', { name: '#test', exact: true })).toBeVisible();
			await expect(results.getByRole('button', { name: 'このハッシュタグを見る #test', exact: true })).toHaveCount(0);
			await expect(results.locator(`.${containerClass}`)).toHaveCount(0);
			return user;
		}

		for (let round: number = 0; round < 2; round++) {
			await page.locator('[data-twitter-search-tab="user"]').last().click();
			await expectUserResults();
			await page.locator('[data-twitter-search-tab="user"]').last().focus();
			await page.keyboard.press('Home');
			await expect(hint).toBeVisible();
			await expect(resultNote(page, tagged)).toBeVisible();
			await page.locator('[data-twitter-search-tab="note"]').last().focus();
			await page.keyboard.press('ArrowRight');
			await expectUserResults();
			await page.locator('[data-twitter-search-tab="note"]').last().click();
			await expect(hint).toBeVisible();
		}
		await openSearch(page, '#test', { type: 'user' }, stacked);
		await expectUserResults();
		await page.reload();
		const user: Locator = await expectUserResults();
		await user.getByRole('link', { name: '#test', exact: true }).click();
		await expect(page).toHaveURL(/\/tags\/test/);
		await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${tagged.id}"]`).last()).toBeVisible();
		await page.goBack();
		await expectUserResults();
		await user.locator('a[href="/@search_author"]').first().click();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		await submitRail(page, '#test');
		await expect(page.getByTestId('twitter-search-results').last().getByRole('button', { name: 'このハッシュタグを見る #test', exact: true })).toBeVisible();
		await page.locator('[data-twitter-search-tab="user"]').last().click();
		await expectUserResults();
		await page.goBack();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		await page.goBack();
		await expectUserResults();
		await page.goForward();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		await page.goForward();
		await expectUserResults();
		await mainInput(page).fill('@search_author');
		await mainInput(page).press('Enter');
		await expect(page.getByTestId('twitter-search-results').last().getByRole('button', { name: 'このユーザーを見る @search_author', exact: true })).toBeVisible();
		const uri: string = 'https://example.com/hashtag-intent-regression';
		await mainInput(page).fill(uri);
		await mainInput(page).press('Enter');
		await expect(page.locator('[data-twitter-search-tab="user"]').last()).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('twitter-search-results').last().getByRole('button', { name: `このURLを照会する ${uri}`, exact: true })).toBeVisible();
	}
});

for (const type of ['note', 'user'] as const) {
	test(`默认界面同为 ${type} 的外部新查询在手动提交前清除旧结果`, /** 真实内容中的站内链接触发同类型的新路由，不能保留上一轮结果。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const label: string = `下一轮${type}搜索`;
		const link: string = `[${label}](${BASE_URL}/search?q=${encodeURIComponent('再见')}&type=${type})`;
		if (type === 'note') {
			await api(BASE_URL, 'notes/create', { i: author.token, text: `你好 ${link}`, localOnly: true });
		} else {
			await api(BASE_URL, 'i/update', { i: author.token, description: link });
		}
		await openSearch(page, '你好', { type }, false, false);
		const input: Locator = page.locator('input[type="search"]').first();
		await input.press('Enter');
		await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
		await page.getByRole('link', { name: label, exact: true }).click();
		await expect(input).toHaveValue('再见');
		await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
		await expect(page.getByText(first.text ?? '', { exact: true })).toHaveCount(0);
		await input.press('Enter');
		if (type === 'note') await expect(page.getByText(latest.text ?? '', { exact: true })).toBeVisible();
		else await expect(page.getByText('There are no users', { exact: true })).toBeVisible();
	});
}

test('叠层不同搜索卡片拥有独立标识、键盘焦点及返回上下文', /** 离开旧搜索再进入新搜索，不把两个卡片合并或把焦点交给背景。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openSearch(page, '你好', {}, true);
	await expect(resultNote(page, first)).toBeVisible();
	await resultNote(page, first).locator('a[href="/@search_author"]').first().click();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await submitRail(page, '再见');
	await expect(resultNote(page, latest)).toBeVisible();
	await expect(page.getByTestId('twitter-search-header')).toHaveCount(2);
	const noteTab: Locator = page.locator('[data-twitter-search-tab="note"]').last();
	const userTab: Locator = page.locator('[data-twitter-search-tab="user"]').last();
	await noteTab.focus();
	await page.keyboard.press('ArrowRight');
	await expect(userTab).toBeFocused();
	await expect(userTab).toHaveAttribute('aria-selected', 'true');
	const identifiers: string[] = await page.locator('[data-twitter-search-tab]').evaluateAll(/** 真实多实例 DOM 不得重复引用同一个 ARIA 标识。 */ (elements: HTMLElement[]): string[] => elements.map(/** 只读取展示标识。 */ (element: HTMLElement): string => element.id));
	expect(new Set(identifiers).size).toBe(identifiers.length);
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await page.goBack();
	await expect(page.getByTestId('twitter-search-header')).toHaveCount(1);
	await expect(mainInput(page)).toHaveValue('你好');
	await expect(resultNote(page, first)).toBeVisible();
});

test('叠层背景搜索的迟到 URL 解析不能抢走当前页面导航', /** 解析真实本地帖子 AP 标识，延迟原响应后离开搜索页。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const uri: string = `https://${new URL(BASE_URL).host}/notes/${first.id}`;
	const gate: TransportGate = await holdTransport(page, '**/api/ap/show');
	try {
		await openSearch(page, '你好', {}, true);
		await page.getByTestId('twitter-sidebar').locator('a[href="/@search_viewer"]').click();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		await submitRail(page, uri);
		await page.getByTestId('twitter-search-results').last().locator('button').filter({ has: page.locator('.ti-external-link') }).click();
		await gate.reached;
		// 原 AP 等待弹层会阻止页内点击；浏览器返回仍是可用的真实导航入口。
		await page.goBack();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		const response: Promise<Response> = page.waitForResponse(/** 等待真实解析结束，再检查当前路由。 */ (response: Response): boolean => new URL(response.url()).pathname === '/api/ap/show');
		gate.release();
		await gate.finished;
		const resolved: Response = await response;
		expect(resolved.ok()).toBe(true);
		await expect(page).toHaveURL(new RegExp(`/@search_viewer$`));
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
	} finally { gate.release(); }
});
