/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 已确认写入后显示一致性的真实后端回归。
 * 作用：真实账号／API／浏览器交互验证原地发布、子线程、名单、空集合及失败时序。
 * 数据链：独立测试实例 → 原命令 → 既有查询 → DOM；不 Mock 业务响应，不探测环境。
 */
import { test, expect } from '@playwright/test';
import type { APIResponse, Locator, Page, PlaywrightTestArgs, Response, Route, Request } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 仅存测试进程内的凭据，报告不包含会话缓存。 */
let admin: RegisteredUser;
let account: AccountWithToken;
let other: AccountWithToken;
let pageErrors: string[];

/** 通过既有测试管理接口创建普通账号。 */
async function createUser(username: string): Promise<AccountWithToken> {
	const user: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username, password: 'freshness-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: user.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return user;
}

/** 为场景创建真实初始内容；成功后的 UI 断言不以此替代页面发布。 */
async function createNote(user: AccountWithToken, text: string, extra: Partial<Misskey.Endpoints['notes/create']['req']> = {}): Promise<Misskey.entities.Note> {
	const result: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: user.token, text, ...extra });
	return result.createdNote;
}

/** 只使用服务端签发的账户缓存，启动认证仍访问真实服务端。 */
async function open(page: Page, path: string): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 现有会话持久化格式。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, account);
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=twitter`);
	await expect(page.getByTestId('twitter-sidebar')).toBeVisible();
}

/** 唯一发帖表单内的真实提交，返回服务端回执而非自己构造的帖子。 */
async function submit(page: Page, text: string): Promise<Misskey.entities.Note> {
	await page.getByTestId('post-form-text').fill(text);
	const receipt: Promise<Response> = page.waitForResponse(/** 真实发帖完成点。 */ (response: Response): boolean => response.url().endsWith('/api/notes/create') && response.status() === 200);
	await page.getByTestId('post-form-submit').click();
	const created: Misskey.Endpoints['notes/create']['res'] = await (await receipt).json();
	await expect(page.getByTestId('post-form-text')).toBeHidden();
	return created.createdNote;
}

/** 桌面常驻侧栏入口，不能通过 API 发帖替代。 */
async function publish(page: Page, text: string): Promise<Misskey.entities.Note> {
	await page.getByTestId('twitter-sidebar').getByTestId('open-post-form').click();
	return submit(page, text);
}

/** 选择个人主页的普通帖子，允许置顶副本另行计数。 */
function profileNote(page: Page, id: string): Locator {
	return page.getByTestId('twitter-user-timeline-notes').locator(`[data-testid="twitter-note"][data-note-id="${id}"]`);
}

/** 只记录读请求类别，不输出账户令牌或原始请求体。 */
function countProfileReads(page: Page): () => number {
	let count: number = 0;
	page.on('request', /** 排除其他用户和历史翻页请求。 */ (request: Request): void => {
		if (!request.url().endsWith('/api/users/notes')) return;
		const data: Misskey.Endpoints['users/notes']['req'] = request.postDataJSON();
		if (data.userId === account.id && !data.withFiles && !data.withReplies && !data.sinceId && !data.untilId) count++;
	});
	return /** 返回脱敏的计数。 */ (): number => count;
}

test.beforeEach(/** 此测试仅运行在外部启动脚本建立的独立实例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'fresh_admin', 'fresh-admin-test-password', true);
	account = await createUser('fresh_user');
	other = await createUser('fresh_other');
	pageErrors = [];
	page.on('pageerror', /** 从首帧记录异常，不能隐藏渲染失败。 */ (error: Error): void => { pageErrors.push(error.message); });
});
test.afterEach(/** 正常交互不得出现未处理的页面错误。 */ (): void => { expect(pageErrors).toEqual([]); });

test('原空个人主页侧栏发布后原地出现新帖并更新总数', /** 核心人工报告场景。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const reads: () => number = countProfileReads(page);
	await open(page, '/@fresh_user');
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	const before: number = reads();
	const initialUrl: string = page.url();
	const note: Misskey.entities.Note = await publish(page, 'first own-page post');
	await expect(profileNote(page, note.id)).toHaveCount(1);
	await expect(page.getByTestId('twitter-profile-note-count')).toContainText('1');
	expect(page.url()).toBe(initialUrl);
	expect(reads()).toBe(before + 1);
	await page.screenshot({ path: 'test/e2e/artifacts/freshness-profile-post.png', animations: 'disabled' });
});

test('取消及传输失败不产生成功刷新，失败后可继续发布', /** 不把 os.post 完成当作成功。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const reads: () => number = countProfileReads(page);
	await open(page, '/@fresh_user');
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	const before: number = reads();
	await page.getByTestId('twitter-sidebar').getByTestId('open-post-form').click();
	await expect(page.getByTestId('post-form-text')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('post-form-text')).toBeHidden();
	expect(reads()).toBe(before);
	await page.route('**/api/notes/create', /** 只模拟传输故障，不伪造领域响应。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('twitter-sidebar').getByTestId('open-post-form').click();
	await page.getByTestId('post-form-text').fill('retry after transport failure');
	await page.getByTestId('post-form-submit').click();
	await expect(page.getByTestId('modal-dialog-ok')).toBeVisible();
	await page.getByTestId('modal-dialog-ok').click();
	expect(reads()).toBe(before);
	await page.unroute('**/api/notes/create');
	const note: Misskey.entities.Note = await submit(page, 'successful retry');
	await expect(profileNote(page, note.id)).toHaveCount(1);
});

test('旧首拉响应在发帖后返回仍会消费一次排队刷新', /** 实际查询响应延后交付，不能用 Mock 假设时序正确。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	let release: () => void = /** 挂接前不释放。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 暂缓交付真实响应。 */ (resolve: () => void): void => { release = resolve; });
	let captured: () => void = /** 挂接前没有响应。 */ (): void => {};
	const oldResponse: Promise<void> = new Promise<void>(/** 先确认旧查询已完成。 */ (resolve: () => void): void => { captured = resolve; });
	let held: boolean = false;
	const reads: () => number = countProfileReads(page);
	await page.route('**/api/users/notes', /** 只延迟首个普通帖子首拉，其内容仍为真实后端结果。 */ async (route: Route): Promise<void> => {
		const request: Misskey.Endpoints['users/notes']['req'] = route.request().postDataJSON();
		if (held || request.withReplies || request.withFiles) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await open(page, '/@fresh_user');
		await oldResponse;
		const note: Misskey.entities.Note = await publish(page, 'created during initial fetch');
		expect(reads()).toBe(1);
		release();
		await expect(profileNote(page, note.id)).toHaveCount(1);
		expect(reads()).toBe(2);
	} finally { release(); }
});

test('隐藏资料标签在显示时消费发布意图且不重复初始化', /** v-show 面板没有重新挂载。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/@fresh_user');
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	const note: Misskey.entities.Note = await publish(page, 'new data for cached tabs');
	await expect(profileNote(page, note.id)).toHaveCount(1);
	await page.locator('a[href="/@fresh_user/replies"]').click();
	await expect(page.getByTestId('twitter-user-timeline-replies')).toContainText('new data for cached tabs');
});

test('回复详情主帖后回复列表与计数原地更新', /** 主帖查询与回复集合分别断言。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(other, 'reply parent');
	await open(page, `/notes/${parent.id}`);
	const detail: Locator = page.getByTestId('twitter-note-detail');
	await expect(detail).toBeVisible();
	await detail.getByTestId('twitter-note-actions').first().getByRole('button', { name: 'Reply', exact: true }).click();
	const reply: Misskey.entities.Note = await submit(page, 'direct fresh reply');
	await expect(page.locator(`[data-testid="twitter-thread-note"][data-note-id="${reply.id}"]`)).toBeVisible();
	await expect(detail.getByTestId('twitter-note-actions').first()).toHaveAttribute('data-replies-count', '1');
});

test('对子回复继续回复只展开相关节点并更新计数', /** 已展开节点保留，未关联线程不全量加载。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(other, 'thread parent');
	const child: Misskey.entities.Note = await createNote(other, 'child target', { replyId: parent.id });
	await open(page, `/notes/${parent.id}`);
	const row: Locator = page.locator(`[data-testid="twitter-thread-note"][data-note-id="${child.id}"]`);
	await row.getByRole('button', { name: 'Reply', exact: true }).click();
	const reply: Misskey.entities.Note = await submit(page, 'grandchild fresh reply');
	await expect(row.locator(`[data-note-id="${reply.id}"]`)).toBeVisible();
	await expect(row.getByTestId('twitter-note-actions').first()).toHaveAttribute('data-replies-count', '1');
});

test('转发成功后当前统计与转发者名单一致', /** 既有转发菜单使用真实创建接口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const note: Misskey.entities.Note = await createNote(other, 'renote target');
	await open(page, `/notes/${note.id}/renotes`);
	const detail: Locator = page.getByTestId('twitter-note-detail');
	await detail.getByTestId('twitter-note-actions').first().getByRole('button', { name: 'Renote', exact: true }).click();
	await page.getByRole('menuitem', { name: /Renote$/ }).click();
	await expect(detail.getByTestId('twitter-note-actions').first()).toHaveAttribute('data-renote-count', '1');
	await expect(detail.locator('a[href="/@fresh_user"]')).toBeVisible();
});

test('同一反应类型新增参与者后名单更新', /** 不能只监听反应类型名称或依赖切换标签。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const note: Misskey.entities.Note = await createNote(account, 'like target', { reactionAcceptance: 'likeOnly' });
	await api(BASE_URL, 'notes/reactions/create', { i: other.token, noteId: note.id, reaction: '❤️' });
	await open(page, `/notes/${note.id}/reactions`);
	const detail: Locator = page.getByTestId('twitter-note-detail');
	await expect(detail.locator('a[href="/@fresh_other"]')).toBeVisible();
	await detail.getByTestId('twitter-note-actions').first().getByRole('button', { name: 'Like', exact: true }).click();
	await expect(detail.locator('a[href="/@fresh_user"]')).toHaveCount(2);
});

test('全局发帖入口更新原空标签页', /** 不经过标签页私有 post 回调也必须生效。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/tags/freshness');
	await expect(page.locator('._pageContainer')).toContainText('No notes');
	const note: Misskey.entities.Note = await publish(page, '#freshness tag via global composer');
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]`)).toBeVisible();
});

test('当前主页置顶和取消置顶后不需导航', /** 置顶不是发帖，使用自身成功信号更新实体。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const note: Misskey.entities.Note = await createNote(account, 'pin target');
	await open(page, '/@fresh_user');
	await profileNote(page, note.id).getByTestId('twitter-note-actions').getByRole('button', { name: /^More!?$/ }).click();
	await page.getByRole('menuitem', { name: /Pin to profile$/ }).click();
	await expect(profileNote(page, note.id)).toHaveCount(2);
	await profileNote(page, note.id).first().getByTestId('twitter-note-actions').getByRole('button', { name: /^More!?$/ }).click();
	await page.getByRole('menuitem', { name: /Unpin from profile$/ }).click();
	await expect(profileNote(page, note.id)).toHaveCount(1);
});

test('本人关注列表取关后成员和头部数量同步', /** 按钮局部更新不能代替集合和实体更新。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await api(BASE_URL, 'following/create', { i: account.token, userId: other.id });
	await open(page, '/@fresh_user/following');
	const body: Locator = page.locator('._pageContainer');
	await expect(body).toContainText('1 Following');
	await body.locator('article').getByRole('button').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(body).toContainText('0 Following');
	await expect(body.locator('article')).toHaveCount(0);
});

test('提及标签接收另一用户新帖且无需切换标签', /** 服务端 mention 事件不是本地 notePosted。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/my/notifications');
	await page.getByRole('button', { name: 'Mentions', exact: true }).click();
	await expect(page.locator('._pageContainer')).toContainText('No notes');
	const note: Misskey.entities.Note = await createNote(other, '@fresh_user incoming mention');
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]`)).toBeVisible();
});

test('查看其他用户主页时自己普通发帖不刷新其集合', /** 成功通知不能广播成所有列表重载。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	let reads: number = 0;
	page.on('request', /** 仅计入目标用户普通集合。 */ (request: Request): void => {
		if (!request.url().endsWith('/api/users/notes')) return;
		const data: Misskey.Endpoints['users/notes']['req'] = request.postDataJSON();
		if (data.userId === other.id) reads++;
	});
	await open(page, '/@fresh_other');
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	await expect.poll(/** 等待所有 v-show 标签首拉完成。 */ (): number => reads).toBe(3);
	const before: number = reads;
	await publish(page, 'unrelated own note');
	expect(reads).toBe(before);
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
});

test('相同帖的置顶与列表副本共享计数读取', /** 同键多消费者不能倍增确认请求。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(account, 'shared counter parent');
	await api(BASE_URL, 'i/pin', { i: account.token, noteId: parent.id });
	let reads: number = 0;
	page.on('request', /** 仅记录被回复原帖的单帖读取次数。 */ (request: Request): void => {
		if (!request.url().endsWith('/api/notes/show')) return;
		const data: Misskey.Endpoints['notes/show']['req'] = request.postDataJSON();
		if (data.noteId === parent.id) reads++;
	});
	await open(page, '/@fresh_user');
	await expect(profileNote(page, parent.id)).toHaveCount(2);
	await profileNote(page, parent.id).first().getByTestId('twitter-note-actions').getByRole('button', { name: 'Reply', exact: true }).click();
	await submit(page, 'reply to duplicated parent');
	await expect(profileNote(page, parent.id)).toHaveCount(2);
	for (const row of await profileNote(page, parent.id).all()) {
		await expect(row.getByTestId('twitter-note-actions')).toHaveAttribute('data-replies-count', '1');
	}
	expect(reads).toBe(1);
});

test('详情回访重新确认原空回复集合', /** 页面主帖刷新不能替代回复子集合刷新。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(other, 'empty replies on revisit');
	await open(page, `/notes/${parent.id}`);
	await expect(page.getByTestId('twitter-note-detail')).toContainText('No notes');
	await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
	const child: Misskey.entities.Note = await createNote(other, 'reply while away', { replyId: parent.id });
	await page.goBack();
	await expect(page.locator(`[data-testid="twitter-thread-note"][data-note-id="${child.id}"]`)).toBeVisible();
	await expect(page.getByTestId('twitter-note-detail').getByTestId('twitter-note-actions').first()).toHaveAttribute('data-replies-count', '1');
});

test('指定可见标签接收真实定向新帖', /** 复用原 directs 流式过滤，不显示普通提及。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/my/notifications');
	await page.getByRole('button', { name: 'Direct notes', exact: true }).click();
	await expect(page.locator('._pageContainer')).toContainText('No notes');
	const plain: Misskey.entities.Note = await createNote(other, '@fresh_user ordinary mention');
	const direct: Misskey.entities.Note = await createNote(other, '@fresh_user direct message', { visibility: 'specified', visibleUserIds: [account.id] });
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${direct.id}"]`)).toBeVisible();
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${plain.id}"]`)).toHaveCount(0);
});

test('频道发帖更新实体统计且不重载既有流', /** 实时帖子与频道总数分别断言。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: account.token, name: 'Counter channel', description: '' });
	await api(BASE_URL, 'channels/follow', { i: account.token, channelId: channel.id });
	await open(page, `/channels/${channel.id}`);
	const body: Locator = page.locator('._pageContainer');
	await expect(body).toContainText('Counter channel');
	await body.getByRole('button', { name: 'Post to channel', exact: true }).click();
	await submit(page, 'channel post updates stats');
	await expect(body).toContainText('channel post updates stats');
	await expect(body).toContainText('1 Notes');
});

test('社区管理列表在创建后回访更新原空集合', /** 真实创建流程后保留 Explore 缓存并刷新 owned。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/channels');
	await page.getByRole('tab', { name: 'Explore', exact: true }).click();
	await page.locator('a[href="/channels/new"]').click();
	await page.locator('._pageContainer input').first().fill('Created from cached communities');
	await page.locator('._pageContainer').getByRole('button', { name: /Create$/ }).click();
	await expect(page.locator('._pageContainer')).toContainText('Created from cached communities');
	// 返回原始完整路由键，不能用新路径实例冒充 KeepAlive 回访。
	await page.goBack();
	await page.goBack();
	await expect(page.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('._pageContainer')).toContainText('Created from cached communities');
});

test('收藏频道后缓存社区收藏区回访更新', /** 菜单缓存失效不等于 favorites 分页器失效。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: account.token, name: 'Favorite in community', description: '' });
	await open(page, '/channels');
	await page.getByRole('tab', { name: 'Explore', exact: true }).click();
	await page.locator(`._pageContainer a[href="/channels/${channel.id}"]`).first().click();
	await page.locator('._pageContainer button[class*="asLike"]').click();
	await page.goBack();
	await expect(page.locator(`._pageContainer a[href="/channels/${channel.id}"]`)).toHaveCount(2);
});

test('解除屏蔽成功后当前设置集合移除原关系', /** 不将 userId 误作分页关系 id。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await api(BASE_URL, 'mute/create', { i: account.token, userId: other.id });
	await open(page, '/settings/mute-block');
	const body: Locator = page.locator('._pageContainer');
	await body.getByRole('button', { name: /Muted users/ }).last().click();
	await expect(body.locator('a[href="/@fresh_other"]')).toBeVisible();
	await body.locator('button[class*="-remove"]').click();
	await page.getByRole('menuitem', { name: /Unmute$/ }).click();
	await expect(body.locator('a[href="/@fresh_other"]')).toHaveCount(0);
});

test('移动端悬浮发帖按钮同样更新个人主页', /** 同一成功链路不依赖桌面侧栏。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/@fresh_user');
	await page.setViewportSize({ width: 390, height: 1000 });
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	await page.getByTestId('open-post-form').filter({ visible: true }).click();
	const note: Misskey.entities.Note = await submit(page, 'mobile immediate publish');
	await expect(profileNote(page, note.id)).toHaveCount(1);
	await expect(page.getByTestId('twitter-profile-note-count')).toContainText('1');
});

test('连续发布发生在刷新期间时不会丢失第二次更新', /** 延迟真实查询响应，证明意图在完成前不被清除。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/@fresh_user');
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	let release: () => void = /** 挂接前没有请求。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 只延迟真实传输。 */ (resolve: () => void): void => { release = resolve; });
	let captured: () => void = /** 首次刷新捕获通知。 */ (): void => {};
	const firstRefresh: Promise<void> = new Promise<void>(/** 等待旧结果已经生成。 */ (resolve: () => void): void => { captured = resolve; });
	let held: boolean = false;
	await page.route('**/api/users/notes', /** 延迟普通面板首次刷新，后续请求正常访问真实后端。 */ async (route: Route): Promise<void> => {
		const data: Misskey.Endpoints['users/notes']['req'] = route.request().postDataJSON();
		if (held || data.withReplies || data.withFiles) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		const first: Misskey.entities.Note = await publish(page, 'first consecutive publish');
		await firstRefresh;
		const second: Misskey.entities.Note = await publish(page, 'second consecutive publish');
		release();
		await expect(profileNote(page, first.id)).toHaveCount(1);
		await expect(profileNote(page, second.id)).toHaveCount(1);
		await expect(page.getByTestId('twitter-profile-note-count')).toContainText('2');
	} finally { release(); }
});

test('删除已显示回复后父计数与子集合同步', /** 删除信号只有 ID，使用已挂载关系定位实际父帖。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(other, 'delete reply parent');
	const child: Misskey.entities.Note = await createNote(account, 'delete this reply', { replyId: parent.id });
	await open(page, `/notes/${parent.id}`);
	const row: Locator = page.locator(`[data-testid="twitter-thread-note"][data-note-id="${child.id}"]`);
	await row.getByTestId('twitter-note-actions').getByRole('button', { name: /^More!?$/ }).click();
	await page.getByRole('menuitem', { name: /(?:^|\s)Delete$/ }).click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(row).toHaveCount(0);
	await expect(page.getByTestId('twitter-note-detail').getByTestId('twitter-note-actions').first()).toHaveAttribute('data-replies-count', '0');
});

test('纯转发详情回复归属原帖而非转发外壳', /** 显示 ID 与发布外壳 ID 不能混用。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.Note = await createNote(other, 'original behind renote');
	const envelope: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, renoteId: original.id });
	await open(page, `/notes/${envelope.createdNote.id}`);
	const detail: Locator = page.getByTestId('twitter-note-detail');
	await detail.getByTestId('twitter-note-actions').first().getByRole('button', { name: 'Reply', exact: true }).click();
	const reply: Misskey.entities.Note = await submit(page, 'reply to actual original');
	expect(reply.replyId).toBe(original.id);
	await expect(page.locator(`[data-testid="twitter-thread-note"][data-note-id="${reply.id}"]`)).toBeVisible();
});

test('保留收藏页取消收藏后原地移除条目', /** 不触碰基础帖子组件内部逻辑，原命令成功通知集合。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const note: Misskey.entities.Note = await createNote(other, 'remove favorite locally');
	await api(BASE_URL, 'notes/favorites/create', { i: account.token, noteId: note.id });
	await open(page, '/my/favorites');
	const body: Locator = page.locator('._pageContainer');
	await expect(body).toContainText('remove favorite locally');
	await body.locator('article').getByRole('button').last().click();
	await page.getByRole('menuitem', { name: /Remove from favorites$/ }).click();
	await expect(body).not.toContainText('remove favorite locally');
});

test('Clip 编辑成功后当前实体回填而不只是失效菜单缓存', /** 原 Clip 保存与查询组成真实闭环。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const clip: Misskey.entities.Clip = await api(BASE_URL, 'clips/create', { i: account.token, name: 'Before clip', description: 'before description', isPublic: true });
	await open(page, `/clips/${clip.id}`);
	await page.locator('._pageContainer').getByRole('button').first().click();
	await page.getByRole('textbox').filter({ visible: true }).first().fill('After clip');
	await page.getByRole('button', { name: /Done/ }).click();
	await expect(page.locator('._pageContainer')).toContainText('After clip');
});

test('非实时模式相同总数的反应名单变化仍会更新', /** 更换参与者后总数与类型均不变，不能仅靠计数 watch。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const replacement: AccountWithToken = await createUser('fresh_replacement');
	const note: Misskey.entities.Note = await createNote(account, 'polling people target', { reactionAcceptance: 'likeOnly' });
	await api(BASE_URL, 'notes/reactions/create', { i: other.token, noteId: note.id, reaction: '❤️' });
	await open(page, `/notes/${note.id}/reactions`);
	await page.evaluate(/** 使用真实已有偏好入口选择非实时模式，不替换业务响应。 */ async (): Promise<void> => {
		const modulePath: string = '/vite/src/store.ts';
		const module: typeof import('../../src/store.js') = await import(modulePath);
		module.store.set('realtimeMode', false);
	});
	await page.reload();
	const detail: Locator = page.getByTestId('twitter-note-detail');
	await expect(detail.locator('a[href="/@fresh_other"]')).toBeVisible();
	await api(BASE_URL, 'notes/reactions/delete', { i: other.token, noteId: note.id });
	await api(BASE_URL, 'notes/reactions/create', { i: replacement.token, noteId: note.id, reaction: '❤️' });
	await expect(detail.locator('a[href="/@fresh_replacement"]')).toBeVisible({ timeout: 30000 });
	await expect(detail.locator('a[href="/@fresh_other"]')).toHaveCount(0);
});

test('撤销转发外壳后重新确认原帖计数而不本地减一', /** 显示计数遵循后端口径，不假定等于当前名单长度。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await api(BASE_URL, 'following/create', { i: account.token, userId: other.id });
	const original: Misskey.entities.Note = await createNote(other, 'original remains after unrenote');
	const envelope: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, renoteId: original.id });
	await open(page, '/');
	const originalCard: Locator = page.locator(`[data-testid="twitter-note"][data-note-id="${original.id}"]`);
	const envelopeCard: Locator = page.locator(`[data-testid="twitter-note"][data-note-id="${envelope.createdNote.id}"]`);
	await expect(originalCard.first()).toBeVisible();
	let queries: number = 0;
	page.on('request', /** 只读统计确认是否真正发起，不记录凭据。 */ (request: Request): void => {
		if (!request.url().endsWith('/api/notes/show')) return;
		const data: Misskey.Endpoints['notes/show']['req'] = request.postDataJSON();
		if (data.noteId === original.id) queries++;
	});
	await envelopeCard.locator('button[class*="-contextButton"]').first().click();
	await page.getByRole('menuitem', { name: /Remove renote/ }).click();
	await expect(envelopeCard).toHaveCount(0);
	await expect.poll(/** 删除外壳后必须重新确认实际原帖。 */ (): number => queries).toBeGreaterThan(0);
	const confirmed: Misskey.entities.Note = await api(BASE_URL, 'notes/show', { i: account.token, noteId: original.id });
	await expect(originalCard.getByTestId('twitter-note-actions').first()).toHaveAttribute('data-renote-count', String(confirmed.renoteCount));
});

test('创建成功回执之后立即读到已提交的本地统计', /** 用户、回复、转发、频道和投票不等待后台异步副作用。 */ async (): Promise<void> => {
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: account.token, name: 'Atomic summary', description: '' });
	const parent: Misskey.entities.Note = await createNote(other, 'atomic parent');
	await createNote(account, 'atomic child and quote with poll', { replyId: parent.id, renoteId: parent.id, channelId: channel.id, poll: { choices: ['one', 'two'] } });
	// 回复发生在频道外时后端按既有规则调整作用域，单独在频道发布核查频道统计。
	const channelNote: Misskey.entities.Note = await createNote(account, 'atomic channel poll', { channelId: channel.id, poll: { choices: ['one', 'two'] } });
	const author: Misskey.entities.UserDetailed = await api(BASE_URL, 'users/show', { i: account.token, userId: account.id });
	const updatedParent: Misskey.entities.Note = await api(BASE_URL, 'notes/show', { i: account.token, noteId: parent.id });
	const updatedChannel: Misskey.entities.Channel = await api(BASE_URL, 'channels/show', { i: account.token, channelId: channel.id });
	expect(author.notesCount).toBe(2);
	expect(updatedParent.repliesCount).toBe(1);
	expect(updatedParent.renoteCount).toBe(1);
	expect(updatedChannel.notesCount).toBe(1);
	expect(updatedChannel.usersCount).toBe(1);
	expect(channelNote.poll?.choices).toHaveLength(2);
	// 本人转发仍不计入原有转发累计字段，不因提交时序修复改变业务规则。
	await api(BASE_URL, 'notes/create', { i: other.token, renoteId: parent.id });
	const afterSelf: Misskey.entities.Note = await api(BASE_URL, 'notes/show', { i: account.token, noteId: parent.id });
	expect(afterSelf.renoteCount).toBe(1);
});

test('资料刷新被离开取消后再次回访仍消费新意图', /** 上一次请求失败不能阻塞其后产生的真实回访刷新。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/@fresh_user');
	await expect(page.getByTestId('twitter-profile-note-count')).toContainText('0');
	let release: () => void = /** 无请求时不释放。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 延迟真实传输以制造路由取消窗口。 */ (resolve: () => void): void => { release = resolve; });
	let captured: () => void = /** 查询已完成提示。 */ (): void => {};
	const started: Promise<void> = new Promise<void>(/** 等待当前请求进入窗口。 */ (resolve: () => void): void => { captured = resolve; });
	let held: boolean = false;
	await page.route('**/api/users/show', /** 只持有一次真实资料响应。 */ async (route: Route): Promise<void> => {
		if (held) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await publish(page, 'cancelled metadata refresh');
		await started;
		await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
		release();
		await page.goBack();
		await expect(page.getByTestId('twitter-profile-note-count')).toContainText('1');
	} finally { release(); }
});


test('计数查询失败后仍消费其在途期间发生的第二次真实回复', /** 失败不能吞掉后续成功写入；没有新意图时也不自动重试。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(other, 'counter failure parent');
	await open(page, `/notes/${parent.id}`);
	const actions: Locator = page.getByTestId('twitter-note-detail').getByTestId('twitter-note-actions').first();
	await expect(actions).toHaveAttribute('data-replies-count', '0');
	let release: () => void = /** 尚未建立请求窗口时为空操作。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 保留失败请求的在途窗口。 */ (resolve: () => void): void => { release = resolve; });
	let signalStarted: () => void = /** 等待首个计数确认请求。 */ (): void => {};
	const started: Promise<void> = new Promise<void>(/** 请求真正进入传输层后再继续第二次发布。 */ (resolve: () => void): void => { signalStarted = resolve; });
	let requests: number = 0;
	await page.route('**/api/notes/show', /** 只中断第一次父帖计数请求；之后全部请求交给真实后端。 */ async (route: Route): Promise<void> => {
		const request: Misskey.Endpoints['notes/show']['req'] = route.request().postDataJSON();
		if (request.noteId !== parent.id) { await route.continue(); return; }
		requests++;
		if (requests !== 1) { await route.continue(); return; }
		signalStarted();
		await gate;
		await route.abort();
	});
	try {
		await actions.getByRole('button', { name: 'Reply', exact: true }).click();
		const first: Misskey.entities.Note = await submit(page, 'first reply before counter failure');
		await started;
		await actions.getByRole('button', { name: 'Reply', exact: true }).click();
		const second: Misskey.entities.Note = await submit(page, 'second reply during pending counter');
		expect(requests).toBe(1);
		release();
		await expect(actions).toHaveAttribute('data-replies-count', '2');
		await expect(page.locator(`[data-testid="twitter-thread-note"][data-note-id="${first.id}"]`)).toBeVisible();
		await expect(page.locator(`[data-testid="twitter-thread-note"][data-note-id="${second.id}"]`)).toBeVisible();
		expect(requests).toBe(2);
	} finally { release(); }
});

test('并发频道回复与引用成功后本地统计无丢失或重复累加', /** 多作者并发真实事务，同时确认帖子、父帖、频道、参与者和投票。 */ async (): Promise<void> => {
	const writer: AccountWithToken = await createUser('fresh_writer');
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: account.token, name: 'Concurrent counters', description: '' });
	const parent: Misskey.entities.Note = await createNote(other, 'concurrent channel parent', { channelId: channel.id });
	const created: Misskey.entities.Note[] = await Promise.all(Array.from({ length: 6 }, /** 保留原业务规则，由两个普通账户真实并发创建。 */ (_value: unknown, index: number): Promise<Misskey.entities.Note> => createNote(
		index % 2 === 0 ? account : writer,
		`concurrent child ${index}`,
		{ replyId: parent.id, renoteId: parent.id, channelId: channel.id, ...(index === 0 ? { poll: { choices: ['one', 'two'] } } : {}) },
	)));
	expect(new Set(created.map(/** 帖子 ID 必须各自唯一。 */ (note: Misskey.entities.Note): string => note.id)).size).toBe(6);
	const author: Misskey.entities.UserDetailed = await api(BASE_URL, 'users/show', { i: account.token, userId: account.id });
	const otherWriter: Misskey.entities.UserDetailed = await api(BASE_URL, 'users/show', { i: account.token, userId: writer.id });
	const updatedParent: Misskey.entities.Note = await api(BASE_URL, 'notes/show', { i: account.token, noteId: parent.id });
	const updatedChannel: Misskey.entities.Channel = await api(BASE_URL, 'channels/show', { i: account.token, channelId: channel.id });
	expect(author.notesCount).toBe(3);
	expect(otherWriter.notesCount).toBe(3);
	expect(updatedParent.repliesCount).toBe(6);
	expect(updatedParent.renoteCount).toBe(6);
	expect(updatedChannel.notesCount).toBe(7);
	expect(updatedChannel.usersCount).toBe(3);
	expect(created[0].poll?.choices).toHaveLength(2);
});


test('真实置顶上限拒绝不产生刷新或未处理异常且之后可重试', /** 成功通知的 Promise 分支不得把已经提示的 API 拒绝变成全局错误。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	const pinned: Misskey.entities.Note[] = [];
	expect(me.policies.pinLimit).toBeGreaterThan(0);
	for (let index: number = 0; index < me.policies.pinLimit; index++) {
		const note: Misskey.entities.Note = await createNote(account, `existing pin ${index}`);
		await api(BASE_URL, 'i/pin', { i: account.token, noteId: note.id });
		pinned.push(note);
	}
	const target: Misskey.entities.Note = await createNote(account, 'pin beyond real limit');
	const reads: () => number = countProfileReads(page);
	await open(page, '/@fresh_user');
	await expect(profileNote(page, target.id)).toHaveCount(1);
	const before: number = reads();
	await profileNote(page, target.id).getByTestId('twitter-note-actions').getByRole('button', { name: /^More!?$/ }).click();
	const denied: Promise<Response> = page.waitForResponse(/** 确认真实服务端业务拒绝，不伪造错误响应。 */ (response: Response): boolean => response.url().endsWith('/api/i/pin') && response.status() === 400);
	await page.getByRole('menuitem', { name: /Pin to profile$/ }).click();
	const failure: { error: { code: string } } = await (await denied).json();
	expect(failure.error.code).toBe('PIN_LIMIT_EXCEEDED');
	await expect(page.getByTestId('modal-dialog-ok')).toBeVisible();
	await page.getByTestId('modal-dialog-ok').click();
	expect(reads()).toBe(before);
	expect(pageErrors).toEqual([]);
	await expect(profileNote(page, target.id)).toHaveCount(1);
	await api(BASE_URL, 'i/unpin', { i: account.token, noteId: pinned[0].id });
	await profileNote(page, target.id).getByTestId('twitter-note-actions').getByRole('button', { name: /^More!?$/ }).click();
	await page.getByRole('menuitem', { name: /Pin to profile$/ }).click();
	await expect(profileNote(page, target.id)).toHaveCount(2);
});
