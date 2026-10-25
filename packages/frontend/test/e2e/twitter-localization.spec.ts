/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：Twitter 中文补充资源的真实后端浏览器回归。
 * 作用：覆盖搜索意图、右栏、频道空态、无障碍计数和定时发布文案，并检查语言隔离及窄屏几何。
 * 数据链：隔离实例的真实账户／帖子／通知 → 原页面与实时流 → 国际化装配 → 可见文字和可访问名称。
 * 边界：不伪造业务响应、不注入组件状态；仅使用专用测试实例，用户生成的日文正文保持原样。
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page, PlaywrightTestArgs, TestInfo } from '@playwright/test';
import type { Language } from 'i18n';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 专用实例管理员仅负责创建真实验收数据，不把令牌写入附件。 */
let admin: RegisteredUser;
/** 浏览器使用的真实登录账户及服务端权限。 */
let viewer: AccountWithToken;
/** 独立作者产生真实趋势、通知和时间线事件。 */
let author: AccountWithToken;
/** 日文正文证明界面翻译不会改写用户生成内容。 */
let japaneseNote: Misskey.entities.Note;
/** 未处理的浏览器异常必须与文字验收一同通过。 */
let errors: string[];

/** 服务端创建帖子后返回 SDK 权威模型，不手写帖子事实。 */
async function createNote(account: AccountWithToken, text: string): Promise<Misskey.entities.Note> {
	const response: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text });
	return response.createdNote;
}

/** 从服务端重新获取权限和未读数，浏览器不持有测试构造的业务状态。 */
async function refreshViewer(): Promise<void> {
	const current: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: viewer.token });
	viewer = { ...current, token: viewer.token };
}

/** 沿用真实账户与语言偏好的既有引导格式，不直接调用页面内部方法。 */
async function visit(page: Page, path: string, language: Language = 'zh-CN', width: number = 1440, scheme: 'dark' | 'light' = 'dark'): Promise<void> {
	await page.setViewportSize({ width, height: 1000 });
	await page.emulateMedia({ colorScheme: scheme });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 持久化只承载服务端会话和用户语言选择。 */ (input: Readonly<{ account: AccountWithToken; language: Language }>): void => {
		localStorage.setItem('account', JSON.stringify(input.account));
		localStorage.setItem('lang', input.language);
	}, { account: viewer, language });
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=twitter`);
	await expect(page.getByTestId('twitter-scroll-viewport')).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await page.evaluate(/** 按选定色系解析 Twitter 的 light-dark Token，不改变业务状态。 */ (value: 'dark' | 'light'): void => { document.documentElement.style.colorScheme = value; }, scheme);
	await page.evaluate(/** 字体完成加载后再比较中文布局。 */ async (): Promise<void> => { await document.fonts.ready; });
}

/** 当前搜索页仅使用公开表单交互，不读取 Vue 私有状态。 */
function searchInput(page: Page): Locator {
	return page.getByTestId('twitter-search-header').locator('input[name="q"]');
}

/** 新关键词经真实回车提交，保留当前路由和请求生命周期。 */
async function search(page: Page, query: string): Promise<void> {
	await searchInput(page).fill(query);
	await searchInput(page).press('Enter');
	await expect(searchInput(page)).toHaveValue(query);
}

/** 系统控件分别验收文字和名称，避免用户日文正文导致无关失败。 */
async function expectChineseControl(control: Locator, text: string): Promise<void> {
	await expect(control).toBeVisible();
	await expect(control).toHaveAccessibleName(text);
	expect(await control.innerText()).not.toMatch(/[\u3040-\u30ff]/u);
}

/** 页面几何以实际视口为准，不能因中文变长产生横向页面滚动。 */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	const overflow: number = await page.evaluate(/** 测量最终布局而不是源码中的宽度声明。 */ (): number => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(1);
}

/** 中文自动搜索只展示原分页工具条，原生范围表单不应以折叠或窄屏隐藏方式残留。 */
async function expectCompactSearchControls(page: Page): Promise<void> {
	await expect(page.getByTestId('search-note-form')).toHaveCount(0);
	await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
	await expect(page.getByText('选项', { exact: true })).toHaveCount(0);
	const results: Locator = page.getByTestId('twitter-search-results');
	await expect(results.getByText('从新到旧', { exact: true })).toBeVisible();
	await expect(results.getByRole('button').filter({ has: page.locator('.ti-calendar-clock') })).toBeInViewport({ ratio: 1 });
	await expect(results.getByRole('button').filter({ has: page.locator('.ti-refresh') })).toBeInViewport({ ratio: 1 });
}

/** 保存当前场景截图，业务内容均来自本用例的合成账户。 */
async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
	const path: string = info.outputPath(`${name}.png`);
	await page.screenshot({ path, animations: 'disabled' });
	await info.attach(name, { path, contentType: 'image/png' });
}

/** 通过全局编辑器原菜单打开定时弹窗，仍使用后端提供的定时权限。 */
async function openSchedule(page: Page): Promise<Locator> {
	await page.getByTestId('open-post-form').filter({ visible: true }).first().click();
	const composer: Locator = page.locator('[data-testid="twitter-composer"]:not([data-testid="twitter-reply-composer"] *)').last();
	await expect(composer.getByTestId('post-form-text')).toBeVisible();
	const more: Locator = composer.getByRole('button', { name: '其他', exact: true });
	await more.scrollIntoViewIfNeeded();
	await more.click();
	await page.getByRole('menuitem', { name: /定时发布/ }).click();
	const dialog: Locator = page.locator('section[aria-labelledby="twitter-schedule-post-title"]');
	await expect(dialog).toBeVisible();
	return dialog;
}

test.setTimeout(120_000);

test.beforeEach(/** 仅重置已启动的 61812 隔离实例，开发数据不参与验收。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'locale_admin', 'locale-admin-test-password', true);
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'locale_viewer', password: 'locale-viewer-test-password' });
	author = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'locale_author', password: 'locale-author-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, pinnedUsers: ['locale_author'] });
	const role: Misskey.entities.Role = await api(BASE_URL, 'admin/roles/create', {
		i: admin.token, name: 'Locale regression', description: 'Private real-backend localization fixture', color: null, iconUrl: null,
		target: 'manual', condFormula: {}, isPublic: false, isModerator: false, isAdministrator: false,
		asBadge: false, canEditMembersByModerator: false, displayOrder: 0,
		policies: { canSearchNotes: { useDefault: false, priority: 1, value: true } },
	});
	await api(BASE_URL, 'admin/roles/assign', { i: admin.token, roleId: role.id, userId: viewer.id });
	await api(BASE_URL, 'notifications/mark-all-as-read', { i: viewer.token });
	japaneseNote = await createNote(author, '日本語の投稿はそのまま残す #test');
	await refreshViewer();
	errors = [];
	page.on('pageerror', /** 只记录异常消息，不输出请求或认证内容。 */ (error: Error): void => { errors.push(error.message); });
});

test.afterEach(/** 中文呈现成功不能掩盖真实交互中的异步异常。 */ (): void => { expect(errors).toEqual([]); });

test('中文搜索三种快捷意图、右栏与主导航保持中文且不翻译用户正文', /** 真实标签导航和用户入口验证补充资源确实进入生产装配链。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await visit(page, '/search?q=%23test');
	await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeVisible();
	const rail: Locator = page.getByTestId('twitter-right-rail');
	await expect(rail.getByRole('heading', { name: '趋势', exact: true })).toBeVisible();
	await expect(rail.getByRole('heading', { name: '推荐关注', exact: true })).toBeVisible();
	const hashtag: Locator = page.getByRole('button', { name: '查看此话题标签 #test', exact: true });
	await expectChineseControl(hashtag, '查看此话题标签 #test');
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${japaneseNote.id}"]`)).toContainText('日本語の投稿はそのまま残す');
	await expectCompactSearchControls(page);
	await expectNoHorizontalOverflow(page);
	await capture(page, info, 'zh-search-desktop-dark');
	await hashtag.click();
	await expect(page).toHaveURL(/\/tags\/test/);
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${japaneseNote.id}"]`)).toContainText('日本語の投稿はそのまま残す');
	await page.goto(`${BASE_URL}/search?q=%40locale_author&ui=twitter`);
	await expectChineseControl(page.getByRole('button', { name: '查看此用户 @locale_author', exact: true }), '查看此用户 @locale_author');
	await page.getByRole('button', { name: '查看此用户 @locale_author', exact: true }).click();
	await expect(page).toHaveURL(/\/@locale_author/);
	/** URL 提示沿用现有 HTTPS 入口约定；本例不触发外部 AP 查询。 */
	const lookupUrl: string = `https://example.com/notes/${japaneseNote.id}`;
	await page.goto(`${BASE_URL}/search?q=${encodeURIComponent(lookupUrl)}&ui=twitter`);
	await expectChineseControl(page.getByRole('button', { name: `查询此链接 ${lookupUrl}`, exact: true }), `查询此链接 ${lookupUrl}`);
});

test('窄屏中文搜索意图与频道空态不溢出', /** 两个窄宽度覆盖长标签换行；空态必须来自真实未关注账户。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await api(BASE_URL, 'i/update', { i: author.token, name: '#test 中文用户', description: '用户简介里的 #test 链接保持原样。' });
	for (const width of [390, 320] as const) {
		await visit(page, '/search?q=%23test', 'zh-CN', width, 'light');
		await expectChineseControl(page.getByRole('button', { name: '查看此话题标签 #test', exact: true }), '查看此话题标签 #test');
		await expectCompactSearchControls(page);
		await expectNoHorizontalOverflow(page);
		await capture(page, info, `zh-search-mobile-${width}-light`);
		await page.getByRole('tab', { name: '用户', exact: true }).click();
		const results: Locator = page.getByTestId('twitter-search-results');
		const user: Locator = results.locator('article').filter({ has: page.locator('a[href="/@locale_author"]') }).first();
		await expect(user.getByRole('link', { name: '#test', exact: true })).toBeVisible();
		await expect(results.getByRole('button', { name: '查看此话题标签 #test', exact: true })).toHaveCount(0);
		await expectNoHorizontalOverflow(page);
		await capture(page, info, `zh-search-mobile-${width}-users-light`);
		await page.getByRole('tab', { name: '帖子', exact: true }).click();
		await expectChineseControl(page.getByRole('button', { name: '查看此话题标签 #test', exact: true }), '查看此话题标签 #test');
		await expectCompactSearchControls(page);
	}
	await page.goto(`${BASE_URL}/channels?ui=twitter`);
	await expect(page.getByTestId('twitter-community-empty-following').getByRole('heading', { name: '你还没有关注的频道', exact: true })).toBeVisible();
	await expectNoHorizontalOverflow(page);
	await capture(page, info, 'zh-channel-empty-320-light');
});

test('定时发布的日期时间、月份名称和过去时间提示在窄屏保持中文', /** 通过原日历选择过去日期，验证可见字段和无障碍名称以及禁用规则。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	for (const width of [390, 320] as const) {
		await visit(page, '/search?q=%23test', 'zh-CN', width, width === 390 ? 'dark' : 'light');
		const dialog: Locator = await openSchedule(page);
		await expect(dialog.getByRole('heading', { name: '日期', exact: true })).toBeVisible();
		await expect(dialog.getByRole('heading', { name: '时间', exact: true })).toBeVisible();
		const previous: Locator = dialog.getByRole('button', { name: '上个月', exact: true });
		const next: Locator = dialog.getByRole('button', { name: '下个月', exact: true });
		await expectChineseControl(previous, '上个月');
		await expectChineseControl(next, '下个月');
		await next.click();
		await previous.click();
		await previous.click();
		await dialog.getByRole('gridcell').filter({ hasText: /^1$/ }).click();
		await expect(dialog.getByText('请选择晚于当前时间的日期和时间', { exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: '定时发布', exact: true })).toBeDisabled();
		await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport({ ratio: 1 });
		await expect(previous).toBeInViewport({ ratio: 1 });
		await expect(next).toBeInViewport({ ratio: 1 });
		await expectNoHorizontalOverflow(page);
		await capture(page, info, `zh-schedule-${width}`);
		await dialog.getByRole('button', { name: '取消', exact: true }).click();
	}
});

test('真实未读通知数量在桌面和移动导航使用中文可访问名称', /** 实际反应通知经过后端落库后读取数量，不注入账户计数。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const note: Misskey.entities.Note = await createNote(viewer, '真实通知目标');
	/** 提前完成首次发帖成就，避免启动时的既有成就弹出层把目标反应通知一并标读。 */
	await api(BASE_URL, 'i/claim-achievement', { i: viewer.token, name: 'notes1' });
	await expect.poll(/** 等待真实异步成就通知落库，不把申领回执当成通知已写入。 */ async (): Promise<boolean> => {
		const notifications: Misskey.entities.Notification[] = await api(BASE_URL, 'i/notifications', { i: viewer.token, markAsRead: false, limit: 100 });
		return notifications.some(/** 只确认本次首次发帖成就，不依赖其他通知数量。 */ (notification: Misskey.entities.Notification): boolean => notification.type === 'achievementEarned' && notification.achievement === 'notes1');
	}).toBe(true);
	await api(BASE_URL, 'notifications/mark-all-as-read', { i: viewer.token });
	await api(BASE_URL, 'notes/reactions/create', { i: author.token, noteId: note.id, reaction: '❤️' });
	await expect.poll(/** 后端异步通知必须真实写入账户状态。 */ async (): Promise<number> => {
		await refreshViewer();
		return viewer.unreadNotificationsCount;
	}).toBeGreaterThan(0);
	for (const width of [1440, 390] as const) {
		await refreshViewer();
		await visit(page, '/search?q=%23test', 'zh-CN', width);
		const navigation: Locator = page.getByRole('navigation', { name: '主导航', exact: true });
		await expect(navigation).toBeVisible();
		const notification: Locator = navigation.locator('a[href="/my/notifications"]');
		await expect(notification).toBeVisible();
		await expect.poll(/** 其他通知可能晚于反应到达；始终比对当下服务端数量而非初次会话快照。 */ async (): Promise<boolean> => {
			const current: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: viewer.token });
			return current.unreadNotificationsCount > 0 && await notification.getAttribute('aria-label') === `通知（${current.unreadNotificationsCount} 条未读）`;
		}).toBe(true);
		await expectNoHorizontalOverflow(page);
		await capture(page, info, `zh-notification-count-${width}`);
	}
});

test('真实实时流的新帖队列使用中文数量并能释放到时间线', /** 在原滚动容器阅读旧帖时创建服务端新帖，不能以 Mock 证明队列文案。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await api(BASE_URL, 'following/create', { i: viewer.token, userId: author.id });
	for (let index: number = 0; index < 20; index++) await createNote(viewer, `中文时间线旧帖 ${index}\n${'足够长的正文用于真实滚动。\n'.repeat(4)}`);
	await refreshViewer();
	await visit(page, '/');
	await expect(page.getByTestId('twitter-timeline').getByTestId('twitter-note').first()).toBeVisible();
	const viewport: Locator = page.getByTestId('twitter-scroll-viewport');
	await viewport.evaluate(/** 滚动只产生原组件既有的排队语义，不修改队列。 */ (element: HTMLElement): void => { element.scrollTo({ top: 850, behavior: 'instant' }); });
	await expect.poll(/** 实际离开顶部之后才发布下一条帖子。 */ async (): Promise<number> => viewport.evaluate(/** 读取当前容器位置。 */ (element: HTMLElement): number => element.scrollTop)).toBeGreaterThan(800);
	const incoming: Misskey.entities.Note = await createNote(author, '真正到达的新帖子');
	const notice: Locator = page.getByRole('button', { name: '新帖子（1 条）', exact: true });
	await expectChineseControl(notice, '新帖子（1 条）');
	await capture(page, info, 'zh-new-post-count');
	await notice.click();
	await expect(page.getByTestId('twitter-timeline').locator(`[data-testid="twitter-note"][data-note-id="${incoming.id}"]`)).toBeVisible();
	await expect(notice).toBeHidden();
});

test('日文与英文会话保留原语言及既有回退链而不泄漏中文补充', /** 英文缺失的 fork 键仍按项目既有规则回退日文，完整英文键保持英文。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	for (const language of ['ja-JP', 'en-US'] as const) {
		await visit(page, '/search?q=%23test', language);
		await expect(page.locator('[data-twitter-search-tab="note"]')).toHaveText(language === 'ja-JP' ? 'ノート' : 'Notes');
		await expect(page.getByRole('navigation', { name: '主要ナビゲーション', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'このハッシュタグを見る #test', exact: true })).toBeVisible();
		await expect(page.getByText('查看此话题标签', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: '推荐关注', exact: true })).toHaveCount(0);
		await capture(page, info, `${language}-search-isolation`);
		await search(page, '@locale_author');
		await expect(page.getByRole('button', { name: 'このユーザーを見る @locale_author', exact: true })).toBeVisible();
	}
});
