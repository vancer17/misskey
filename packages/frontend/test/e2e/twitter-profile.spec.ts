/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 用户资料的真实后端浏览器回归。
 * 作用：验证保存、缓存回访、嵌套路由、身份显示与简介标签导航。
 * 数据链：隔离实例真实账号／资料／帖子 → 页面查询与用户操作 → 结果与可见状态；不读取开发账户。
 * 延迟／中断只作用于真实传输，不伪造领域响应。
 */
import { test, expect } from '@playwright/test';
import type { ElementHandle, FileChooser, Locator, Page, PlaywrightTestArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 测试创建的账户凭据只在测试进程中使用，不写入报告。 */
let admin: RegisteredUser;
let user: AccountWithToken;
/** 固定 PNG 输入，实际经过上传、文件处理、资料更新 API。 */
const avatarBefore: Buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEAZUpCOlIngcVnSU9DOu8/4s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfaKsAgCd1InHAAAAAElFTkSuQmCC', 'base64');
const avatarAfter: Buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEAZUpGGlIngcVnSU9DOfe74s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfbHAAkDETZA5AAAAAElFTkSuQmCC', 'base64');

test.beforeEach(/** 各场景重建隔离测试资料，不检测或更改开发环境。 */ async (): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'profile_admin', 'profile-admin-test-password', true);
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, name: 'Profile Regression', emailRequiredForSignup: false });
	user = await createUser('profile_user');
});

/** 创建真实后端账户并关闭与本次测试无关的初次使用向导。 */
async function createUser(username: string): Promise<AccountWithToken> {
	const account: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username, password: 'profile-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return account;
}

/** 捕获首条页面异常，不能只在黑屏之后开始记录。 */
function errorsIn(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', /** 错误消息不含请求凭据。 */ (error: Error): void => { errors.push(error.message); });
	return errors;
}

/** 使用服务端签发的真实会话缓存，启动时仍经过现有认证检查。 */
async function seedSession(page: Page, account: AccountWithToken): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 只写现有持久化协议，不伪造账户字段。 */ (account: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(account));
		localStorage.setItem('lang', 'en-US');
	}, account);
}

/** 首次进入资料页，之后的回访使用原生历史或页面链接，不整页重载。 */
async function openProfile(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 1050 });
	await seedSession(page, user);
	await page.goto(`${BASE_URL}/@${user.username}?ui=twitter`);
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect(page.getByTestId('twitter-user-timeline-notes')).toBeVisible();
}

/** 用户资料页的实际编辑入口。 */
async function editProfile(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await expect(page.getByTestId('profile-name').locator('input')).toBeVisible();
}

/** 设置页退出后等待资料树恢复，不只验证侧栏仍存在。 */
async function backToProfile(page: Page): Promise<void> {
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
}

/** 调用真实发帖 API，为页面回归建立确定内容。 */
async function createNote(account: AccountWithToken, text: string, extra: Partial<Misskey.Endpoints['notes/create']['req']> = {}): Promise<Misskey.entities.Note> {
	const result: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text, ...extra });
	return result.createdNote;
}

/** 只选择普通帖主体，排除同一 ID 置顶显示产生的第二个副本。 */
function noteCards(page: Page, id: string): Locator {
	return page.locator(`[data-testid="twitter-user-timeline-notes"] [data-testid="twitter-note"][data-note-id="${id}"]`);
}

/** 上传初始文件，使用真实驱动文件返回值。 */
async function upload(page: Page, account: AccountWithToken, buffer: Buffer, name: string): Promise<Misskey.entities.DriveFile> {
	const response = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: { i: account.token, file: { name, mimeType: 'image/png', buffer } },
	});
	expect(response.ok()).toBe(true);
	return await response.json();
}

/** 通过文件选择和原有裁剪确认，完整执行页面保存。 */
async function changeAvatar(page: Page): Promise<Misskey.entities.MeDetailed> {
	await page.getByTestId('profile-change-avatar').click();
	const chooser: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: /Upload/ }).click();
	await (await chooser).setFiles({ name: 'avatar-after.png', mimeType: 'image/png', buffer: avatarAfter });
	await page.getByTestId('modal-dialog-cancel').click();
	const response: Promise<Response> = page.waitForResponse(/** 只等待真实资料写入成功。 */ (response: Response): boolean => response.url().endsWith('/api/i/update') && response.status() === 200);
	await page.getByRole('button', { name: /Upload$/ }).click();
	return await (await response).json();
}

/** 手动保存控件提交后等待服务端回执。 */
async function saveName(page: Page, name: string): Promise<void> {
	// 真实点击等待成功弹层释放焦点；fill 本身不等待遮挡消失。
	await page.getByTestId('profile-name').locator('input').click();
	await page.getByTestId('profile-name').locator('input').fill(name);
	const saved: Promise<Response> = page.waitForResponse(/** 资料请求回执是完成依据。 */ (response: Response): boolean => response.url().endsWith('/api/i/update') && response.status() === 200);
	await page.getByTestId('profile-name').getByRole('button', { name: /Save$/ }).click();
	await saved;
}

test('反复编辑与返回保持中心路由可用且保留未保存输入', /** 覆盖原黑屏序列及缓存编辑草稿。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	await openProfile(page);
	await editProfile(page);
	await page.getByTestId('profile-name').locator('input').fill('unsaved draft');
	await backToProfile(page);
	await editProfile(page);
	await expect(page.getByTestId('profile-name').locator('input')).toHaveValue('unsaved draft');
	for (let i: number = 0; i < 3; i++) { await backToProfile(page); await editProfile(page); }
	await backToProfile(page);
	for (const path of ['/', '/my/notifications', '/channels', `/@${user.username}`]) {
		await page.getByTestId('twitter-sidebar').locator(`a[href="${path}"]`).last().click();
		await expect(page.locator('._pageContainer')).not.toBeEmpty();
		await expect(page.locator('._pageContainer')).toContainText(/.+/);
	}
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	expect(errors).toEqual([]);
});

test('头像与昵称首次回访同步普通帖置顶帖及引用转发身份', /** 稳定帖子实例与其他作者必须同时正确。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const first: Misskey.entities.DriveFile = await upload(page, user, avatarBefore, 'avatar-before.png');
	await api(BASE_URL, 'i/update', { i: user.token, avatarId: first.id, name: 'Before Name' });
	user = { ...await api(BASE_URL, 'i', { i: user.token }), token: user.token };
	const pinned: Misskey.entities.Note = await createNote(user, 'pinned own note');
	await api(BASE_URL, 'i/pin', { i: user.token, noteId: pinned.id });
	const other: AccountWithToken = await createUser('profile_other');
	const theirNote: Misskey.entities.Note = await createNote(other, 'other author original');
	await createNote(user, 'own quote', { renoteId: theirNote.id });
	await api(BASE_URL, 'notes/create', { i: user.token, renoteId: theirNote.id });
	await openProfile(page);
	await expect(noteCards(page, pinned.id)).toHaveCount(2);
	const originalPinned: ElementHandle<HTMLElement | SVGElement> | null = await noteCards(page, pinned.id).first().elementHandle();
	if (originalPinned == null) throw new Error('Pinned card was not mounted');
	// 保存后阻断列表重取，证明本人身份更新不以新帖子响应或列表重建为前提。
	await editProfile(page);
	await page.route('**/api/users/notes', /** 故障只在传输层，不替换响应。 */ async (route: Route): Promise<void> => { await route.abort(); });
	const saved: Misskey.entities.MeDetailed = await changeAvatar(page);
	expect(saved.avatarId).not.toBe(first.id);
	expect(saved.avatarUrl).not.toBe(user.avatarUrl);
	await saveName(page, 'After Name');
	await backToProfile(page);
	await expect(page.getByTestId('twitter-profile').locator('h1')).toHaveText('After Name');
	const pinnedCard: Locator = noteCards(page, pinned.id).first();
	await expect(pinnedCard.locator('img').first()).toHaveAttribute('src', saved.avatarUrl);
	await expect(pinnedCard).toContainText('After Name');
	expect(await originalPinned.evaluate(/** 原置顶节点仍被恢复，而不是依靠 key 重建。 */ (element: HTMLElement | SVGElement): boolean => element.isConnected)).toBe(true);
	await page.unroute('**/api/users/notes');
	// 恢复网络并再次回访，使普通帖、引用及转发主体也接受同样的身份断言。
	await editProfile(page); await backToProfile(page);
	await expect(noteCards(page, pinned.id)).toHaveCount(2);
	for (const card of await noteCards(page, pinned.id).all()) {
		await expect(card.locator('img').first()).toHaveAttribute('src', saved.avatarUrl);
		await expect(card).toContainText('After Name');
	}
	const ownAvatars: Locator = page.getByTestId('twitter-user-timeline-notes').locator(`[title="${user.username}"] img`);
	expect(await ownAvatars.count()).toBeGreaterThan(1);
	for (const img of await ownAvatars.all()) await expect(img).toHaveAttribute('src', saved.avatarUrl);
	const otherAvatars: Locator = page.getByTestId('twitter-user-timeline-notes').locator(`[title="${other.username}"] img`);
	expect(await otherAvatars.count()).toBeGreaterThan(0);
	for (const img of await otherAvatars.all()) await expect(img).not.toHaveAttribute('src', saved.avatarUrl);
	await expect.poll(/** 图像实际加载完成，不能只检查 src 字符串。 */ async (): Promise<boolean> => pinnedCard.locator('img').first().evaluate(
		/** 检查浏览器已解码的资源。 */ (image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0,
	)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('profile-after-desktop.png'), animations: 'disabled' });
	await editProfile(page);
	await page.screenshot({ path: testInfo.outputPath('editor-revisited-desktop.png'), animations: 'disabled' });
	await backToProfile(page);
	await page.setViewportSize({ width: 390, height: 1000 });
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('profile-after-mobile.png'), animations: 'disabled' });
	expect(errors).toEqual([]);
});

test('晚挂载且原为空的列表在第一次回访刷新', /** 不能再把首次 activated 当作首次挂载，也不能跳过空列表。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	await page.route('**/api/users/show', /** 延迟真实后端响应以产生晚挂载子树。 */ async (route: Route): Promise<void> => {
		await new Promise<void>(/** 控制网络时序，不伪造业务内容。 */ (resolve: () => void): void => { setTimeout(resolve, 500); });
		await route.continue();
	});
	await openProfile(page);
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	await editProfile(page);
	const note: Misskey.entities.Note = await createNote(user, 'first note while away');
	await backToProfile(page);
	await expect(noteCards(page, note.id)).toBeVisible();
	expect(errors).toEqual([]);
});

for (const width of [390, 1440]) {
	test(`设置首页与嵌套子页在 ${width}px 正常返回`, /** 覆盖设置根路径，无子路由时不提前挂载子页。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const errors: string[] = errorsIn(page);
		await page.setViewportSize({ width, height: 1000 });
		await seedSession(page, user);
		await page.goto(`${BASE_URL}/settings?ui=twitter`);
		// 设置菜单依中心栏实际宽度决定；桌面外窗不代表菜单超过 600px。
		await page.locator('a[href="/settings/profile"]').first().click();
		await expect(page.getByTestId('profile-name')).toBeVisible();
		await page.locator('a[href="/settings/avatar-decoration"]').click();
		await expect(page).toHaveURL(/settings\/avatar-decoration/);
		await page.goBack();
		await expect(page.getByTestId('profile-name')).toBeVisible();
		await page.goForward();
		await expect(page).toHaveURL(/settings\/avatar-decoration/);
		await page.goBack();
		await expect(page.getByTestId('profile-name')).toBeVisible();
		expect(errors).toEqual([]);
	});
}

test('默认 UI 的设置子页保持可用', /** 修复不得要求切换 Twitter 或修改共享组件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	await seedSession(page, user);
	await page.goto(`${BASE_URL}/settings/profile`);
	await expect(page.getByTestId('profile-name')).toBeVisible();
	await page.locator('a[href="/settings/avatar-decoration"]').click();
	await page.goBack();
	await expect(page.getByTestId('profile-name')).toBeVisible();
	await expect(page.getByTestId('twitter-root')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('标签导航：个人简介中文标签进入帖子结果且支持返回和 Enter', /** 真实标签查询决定成员，鼠标与键盘共用既有链接导航。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const tag: string = '资料导航';
	const tagPath: string = `/tags/${encodeURIComponent(tag)}`;
	await api(BASE_URL, 'i/update', { i: user.token, description: `Profile bio #${tag}` });
	const matching: Misskey.entities.Note = await createNote(user, `Matching note #${tag}`);
	const unrelated: Misskey.entities.Note = await createNote(user, 'Unrelated profile note');
	await openProfile(page);
	const bioTag: Locator = page.getByTestId('twitter-profile').locator(`a[href="${tagPath}"]`).first();
	await bioTag.click();
	await expect(page).toHaveURL(`${BASE_URL}${tagPath}`);
	await expect(page.getByRole('heading', { name: `#${tag}`, exact: true })).toBeVisible();
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${matching.id}"]`)).toHaveCount(1);
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${unrelated.id}"]`)).toHaveCount(0);
	await backToProfile(page);
	await bioTag.focus();
	await bioTag.press('Enter');
	await expect(page).toHaveURL(`${BASE_URL}${tagPath}`);
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${matching.id}"]`)).toBeVisible();
	expect(errors).toEqual([]);
});

test('标签导航：只有简介包含标签时显示帖子空态', /** 用户标签索引不能作为帖子结果或用户卡片混入标签时间线。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const tag: string = 'profile_bio_only';
	const tagPath: string = `/tags/${encodeURIComponent(tag)}`;
	await api(BASE_URL, 'i/update', { i: user.token, description: `Bio without tagged notes #${tag}` });
	await createNote(user, 'Ordinary note without the bio tag');
	await openProfile(page);
	await page.getByTestId('twitter-profile').locator(`a[href="${tagPath}"]`).click();
	await expect(page).toHaveURL(`${BASE_URL}${tagPath}`);
	await expect(page.getByRole('heading', { name: 'No notes', exact: true })).toBeVisible();
	await expect(page.getByTestId('twitter-note')).toHaveCount(0);
	await expect(page.locator(`a[href="/@${user.username}"]`).filter({ hasText: user.username })).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('标签导航：搜索及关注和粉丝共享用户行都进入帖子结果', /** 三个真实列表复用同一业务行，不能留下简介用户标签入口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const other: AccountWithToken = await createUser('profile_tagged');
	const tag: string = 'shared_profile_tag';
	const tagPath: string = `/tags/${encodeURIComponent(tag)}`;
	await api(BASE_URL, 'i/update', { i: other.token, description: `Shared result bio #${tag}` });
	await api(BASE_URL, 'following/create', { i: user.token, userId: other.id });
	await api(BASE_URL, 'following/create', { i: other.token, userId: user.id });
	const matching: Misskey.entities.Note = await createNote(other, `Shared result matching note #${tag}`);
	await openProfile(page);
	const relationPages: readonly string[] = ['following', 'followers'];
	for (let index: number = 0; index < relationPages.length; index++) {
		const relation: string = relationPages[index];
		await page.getByTestId('twitter-profile').locator(`a[href="/@${user.username}/${relation}"]`).click();
		const result: Locator = page.locator('article').filter({ has: page.locator(`a[href="/@${other.username}"]`) });
		await expect(result).toHaveCount(1);
		await result.locator(`a[href="${tagPath}"]`).click();
		await expect(page).toHaveURL(`${BASE_URL}${tagPath}`);
		await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${matching.id}"]`)).toBeVisible();
		await page.goBack();
		await expect(result).toBeVisible();
		await backToProfile(page);
	}
	await page.goto(`${BASE_URL}/search?ui=twitter&type=user&q=${encodeURIComponent(other.username)}`);
	const searchResult: Locator = page.getByRole('tabpanel').locator('article').filter({ has: page.locator(`a[href="/@${other.username}"]`) });
	await expect(searchResult).toHaveCount(1);
	await searchResult.locator(`a[href="${tagPath}"]`).click();
	await expect(page).toHaveURL(`${BASE_URL}${tagPath}`);
	await expect(page.locator(`[data-testid="twitter-note"][data-note-id="${matching.id}"]`)).toBeVisible();
	expect(errors).toEqual([]);
});

test('标签导航：默认 UI 简介保留用户标签结果', /** 默认界面继续使用基础 MFM 的用户标签语义，不受 Twitter 业务调用影响。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const tag: string = 'default_profile_tag';
	const tagPath: string = `/user-tags/${encodeURIComponent(tag)}`;
	await api(BASE_URL, 'i/update', { i: user.token, description: `Default UI bio #${tag}` });
	await seedSession(page, user);
	await page.goto(`${BASE_URL}/@${user.username}`);
	await page.locator('.description').locator(`a[href="${tagPath}"]`).click();
	await expect(page).toHaveURL(`${BASE_URL}${tagPath}`);
	await expect(page.locator(`a[href="/@${user.username}"]`).filter({ hasText: user.username })).toBeVisible();
	await expect(page.getByTestId('twitter-root')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('回访后隐藏面板按需刷新且不重复初始化', /** v-show 隐藏面板不会再次挂载，刷新仍需消费对应意图。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const calls: Array<Misskey.Endpoints['users/notes']['req']> = [];
	page.on('request', /** 仅记录去掉凭据的分页参数类别。 */ (request: Request): void => {
		if (!request.url().endsWith('/api/users/notes')) return;
		const data: Misskey.Endpoints['users/notes']['req'] = request.postDataJSON();
		if (data.untilId || data.sinceId) return;
		calls.push({ userId: data.userId, withFiles: data.withFiles, withReplies: data.withReplies });
	});
	await openProfile(page);
	await expect(page.getByTestId('twitter-user-timeline-notes')).toContainText('No notes');
	await expect.poll(/** 四面板中三项使用 users/notes 首拉，热门使用另一端点。 */ (): number => calls.length).toBe(3);
	const file: Misskey.entities.DriveFile = await upload(page, user, avatarAfter, 'timeline-image.png');
	await editProfile(page);
	const note: Misskey.entities.Note = await createNote(user, 'new file while away', { fileIds: [file.id] });
	await backToProfile(page);
	await expect(noteCards(page, note.id)).toBeVisible();
	expect(calls.filter(/** 附件面板尚未被显示，不预刷新。 */ (call: Misskey.Endpoints['users/notes']['req']): boolean => call.withFiles === true)).toHaveLength(1);
	await page.locator(`a[href="/@${user.username}/files"]`).click();
	await expect(page.getByTestId('twitter-user-timeline-files')).toContainText('new file while away');
	await expect.poll(/** 只补一次已挂载附件面板的刷新。 */ (): number => calls.filter(
		/** 区分附件面板与普通帖请求。 */ (call: Misskey.Endpoints['users/notes']['req']): boolean => call.withFiles === true,
	).length).toBe(2);
	await page.locator(`a[href="/@${user.username}/notes"]`).first().click();
	await page.locator(`a[href="/@${user.username}/files"]`).click();
	await expect(page.getByTestId('twitter-user-timeline-files')).toContainText('new file while away');
	expect(calls.filter(/** 相同刷新意图只消费一次。 */ (call: Misskey.Endpoints['users/notes']['req']): boolean => call.withFiles === true)).toHaveLength(2);
	expect(errors).toEqual([]);
});

test('真实名称校验失败不提交草稿且下一次保存仍成功', /** 通过真实后端禁止词规则拒绝，不伪造错误响应。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, prohibitedWordsForNameOfUser: ['blocked_label'] });
	await openProfile(page);
	await editProfile(page);
	await page.getByTestId('profile-name').locator('input').fill('blocked_label');
	const rejected: Promise<Response> = page.waitForResponse(/** 等待真实接口拒绝写入。 */ (response: Response): boolean => response.url().endsWith('/api/i/update') && response.status() >= 400);
	await page.getByTestId('profile-name').getByRole('button', { name: /Save$/ }).click();
	await rejected;
	await page.getByTestId('modal-dialog-ok').click();
	await backToProfile(page);
	await expect(page.getByTestId('twitter-profile').locator('h1')).toHaveText(user.username);
	const unchanged: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: user.token });
	expect(unchanged.name).toBeNull();
	await editProfile(page);
	await saveName(page, 'Allowed Name');
	await backToProfile(page);
	await expect(page.getByTestId('twitter-profile').locator('h1')).toHaveText('Allowed Name');
	expect(errors).toEqual([]);
});

test('旧账户迟到响应不能覆盖已切换的用户主页', /** 延迟真实资料响应，用户切换仍由原路由及 API 完成。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const other: AccountWithToken = await createUser('profile_other');
	const original: Misskey.entities.Note = await createNote(other, 'link to other profile');
	await createNote(user, 'quote with author link', { renoteId: original.id });
	await openProfile(page);
	await expect(page.getByTestId('twitter-profile').locator(`a[href="/@${other.username}"]`).first()).toBeVisible();
	await editProfile(page);
	let delayed: boolean = false;
	let completed: boolean = false;
	await page.route('**/api/users/show', /** 不改写响应，仅让旧账户回访请求延后完成。 */ async (route: Route): Promise<void> => {
		const data: Misskey.Endpoints['users/show']['req'] = route.request().postDataJSON();
		if ('username' in data && data.username === user.username) {
			delayed = true;
			await new Promise<void>(/** 制造新旧请求乱序的传输窗口。 */ (resolve: () => void): void => { setTimeout(resolve, 1200); });
			await route.continue();
			completed = true;
		} else {
			await route.continue();
		}
	});
	await backToProfile(page);
	await expect.poll(/** 确认旧用户请求已处于在途状态再切换。 */ (): boolean => delayed).toBe(true);
	await page.getByTestId('twitter-profile').locator(`a[href="/@${other.username}"]`).first().click();
	await expect(page.getByTestId('twitter-profile').locator('h1')).toHaveText(other.username);
	await expect.poll(/** 等待旧请求处理完成而非提前断言。 */ (): boolean => completed).toBe(true);
	await expect(page.getByTestId('twitter-profile').locator('h1')).toHaveText(other.username);
	await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('首拉在途时回访不会并发初始化且完成后消费刷新意图', /** 把生命周期回访放入真实列表请求占用窗口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const errors: string[] = errorsIn(page);
	const gate: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	let notesCalls: number = 0;
	await page.route('**/api/users/notes', /** 仅延迟首个普通帖请求，不替换后端返回内容。 */ async (route: Route): Promise<void> => {
		const data: Misskey.Endpoints['users/notes']['req'] = route.request().postDataJSON();
		if (!data.withReplies && !data.withFiles && !data.untilId && !data.sinceId) {
			notesCalls += 1;
			if (notesCalls === 1) await gate.promise;
		}
		await route.continue();
	});
	try {
		await openProfile(page);
		await expect.poll(/** 普通帖首拉确实处于在途状态。 */ (): number => notesCalls).toBe(1);
		await editProfile(page);
		const note: Misskey.entities.Note = await createNote(user, 'created during initial request');
		await backToProfile(page);
		expect(notesCalls).toBe(1);
		gate.resolve();
		await expect(noteCards(page, note.id)).toBeVisible();
		await expect.poll(/** 首拉结束后只追加一次已排队的回访刷新。 */ (): number => notesCalls).toBe(2);
		await expect(noteCards(page, note.id)).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		gate.resolve();
	}
});
