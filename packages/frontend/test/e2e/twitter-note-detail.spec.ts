/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 帖子详情与回复线程的真实后端端到端验收。
 * 作用：验证卡片入口、交互豁免、回复分页、内联发布及查询交错时序。
 * 数据链：独立测试实例 → 真实账户和帖子 → 浏览器交互 → 服务端确认与 DOM。
 * 传输闸门仅延迟或中断真实请求，不伪造帖子、计数或分页业务响应。
 */
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import type { APIResponse, Locator, Page, PlaywrightTestArgs, Response, Route } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 只在测试进程中保存独立实例签发的账户凭据。 */
let admin: RegisteredUser;
let account: AccountWithToken;
let author: AccountWithToken;
let pageErrors: string[];

/** 真实分页请求闸门；仅控制传输时序，不保存应用业务状态。 */
type ReplyTransportGate = {
	/** 服务端已经返回被持有的真实结果。 */
	started: Promise<void>;
	/** 被持有的响应已发送回浏览器。 */
	finished: Promise<void>;
	/** 允许响应继续传送。 */
	release: () => void;
};

/** 使用既有管理接口创建真实普通账号并跳过无关的首次设置界面。 */
async function createUser(username: string): Promise<AccountWithToken> {
	const user: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username, password: 'note-detail-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: user.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return user;
}

/** 创建真实场景初始数据，页面发布本身仍通过浏览器完成。 */
async function createNote(user: AccountWithToken, text: string, extra: Partial<Misskey.Endpoints['notes/create']['req']> = {}): Promise<Misskey.entities.Note> {
	const result: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: user.token, text, ...extra });
	return result.createdNote;
}

/** 顺序生成跨页回复，使最旧游标与同层排序拥有确定的真实服务端顺序。 */
async function createReplies(parentId: string, count: number, prefix: string): Promise<Misskey.entities.Note[]> {
	const replies: Misskey.entities.Note[] = [];
	for (let index: number = 0; index < count; index++) {
		replies.push(await createNote(author, `${prefix} ${index}`, { replyId: parentId }));
	}
	return replies;
}

/** 启动真实认证会话；账户缓存只使用服务端已经签发的数据。 */
async function open(page: Page, path: string): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 使用既有会话持久化格式，不伪造认证回执。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, account);
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=twitter`);
	await expect(page.getByTestId('twitter-sidebar')).toBeVisible();
}

/** 上传真实图片夹具，让媒体豁免检查经过既有云盘与附件渲染链路。 */
async function uploadImage(page: Page): Promise<Misskey.entities.DriveFile> {
	const response: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: {
			i: author.token,
			file: {
				name: 'detail-navigation.png',
				mimeType: 'image/png',
				buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGMQqjhCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJ6eOEwZZrsqAAAAAElFTkSuQmCC', 'base64'),
			},
		},
	});
	expect(response.ok()).toBe(true);
	return await response.json();
}

/** 定位列表中的实体卡片，保留纯转发外壳与实际目标之间的区别。 */
function card(page: Page, noteId: string): Locator {
	return page.locator(`[data-testid="twitter-note"][data-note-id="${noteId}"]:visible`).first();
}

/** 定位回复线程内的唯一实体，不将子回复数混作直接回复数。 */
function thread(page: Page, noteId: string): Locator {
	return page.locator(`[data-testid="twitter-thread-note"][data-note-id="${noteId}"]`);
}

/** 断言实际导航目标，允许既有详情页的可选 tab 与查询参数。 */
async function expectNoteUrl(page: Page, noteId: string): Promise<void> {
	await expect(page).toHaveURL(new RegExp(`/notes/${noteId}(?:[/?#]|$)`));
	await expect(page.getByTestId('twitter-note-detail')).toBeVisible();
}

/** 在常驻内联表单发布，并确认真实服务端回执及表单清空。 */
async function submitInline(page: Page, text: string): Promise<Misskey.entities.Note> {
	const composer: Locator = page.getByTestId('twitter-reply-composer');
	await composer.getByTestId('post-form-text').fill(text);
	const posted: Promise<Response> = page.waitForResponse(/** 只接受真实创建成功回执。 */ (response: Response): boolean => response.url().endsWith('/api/notes/create') && response.ok());
	await composer.getByTestId('post-form-submit').click();
	const result: Misskey.Endpoints['notes/create']['res'] = await (await posted).json();
	await expect(composer.getByTestId('post-form-text')).toHaveValue('');
	await expect(composer).toBeVisible();
	return result.createdNote;
}

/** 持有指定父帖的一次真实回复响应，以验证刷新与路由取消时序。 */
async function holdReplies(page: Page, parentId: string, continuation: boolean): Promise<ReplyTransportGate> {
	let release: () => void = /** 请求尚未进入时无需释放。 */ (): void => {};
	let signalStarted: () => void = /** 请求开始信号初始化。 */ (): void => {};
	let signalFinished: () => void = /** 请求完成信号初始化。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 建立传输释放闸门。 */ (resolve: () => void): void => { release = resolve; });
	const started: Promise<void> = new Promise<void>(/** 服务端实际完成后再启动交错操作。 */ (resolve: () => void): void => { signalStarted = resolve; });
	const finished: Promise<void> = new Promise<void>(/** 浏览器收到旧响应后才能检查其隔离效果。 */ (resolve: () => void): void => { signalFinished = resolve; });
	let held: boolean = false;
	await page.route('**/api/notes/replies', /** 只延迟目标请求，其余请求直接交给真实后端。 */ async (route: Route): Promise<void> => {
		const request: Misskey.Endpoints['notes/replies']['req'] = route.request().postDataJSON();
		if (held || request.noteId !== parentId || Boolean(request.untilId) !== continuation) {
			await route.continue();
			return;
		}
		held = true;
		const response: APIResponse = await route.fetch();
		signalStarted();
		await gate;
		try {
			await route.fulfill({ response });
		} finally {
			signalFinished();
		}
	});
	return {
		/** 被持有请求的真实后端响应已经就绪。 */
		started,
		/** 响应已交回浏览器。 */
		finished,
		/** 释放传输闸门。 */
		release,
	};
}

test.setTimeout(120_000);

test.beforeEach(/** 每个场景只重置专属测试实例，不访问开发实例数据。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'detail_admin', 'note-detail-admin-password', true);
	account = await createUser('detail_user');
	author = await createUser('detail_author');
	pageErrors = [];
	page.on('pageerror', /** 收集浏览器未处理异常作为真实交互的附加断言。 */ (error: Error): void => { pageErrors.push(error.message); });
});

test.afterEach(/** 场景完成后检查未处理异常，不以截图替代行为验证。 */ (): void => {
	expect(pageErrors).toEqual([]);
});

test('列表正文、时间戳和纯转发都进入实际帖子详情', /** 验证列表到详情的原始缺陷及转发外壳目标。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.Note = await createNote(author, 'detail ordinary body');
	const envelope: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, renoteId: original.id });
	await open(page, '/@detail_author');
	await card(page, original.id).getByText('detail ordinary body', { exact: true }).click();
	await expectNoteUrl(page, original.id);
	await page.goBack();
	const permalink: Locator = card(page, original.id).locator(`a[href="/notes/${original.id}"]`).first();
	await permalink.click();
	await expectNoteUrl(page, original.id);
	await page.goto(`${BASE_URL}/@detail_user?ui=twitter`);
	await card(page, envelope.createdNote.id).getByRole('button', { name: /detail ordinary body/ }).click();
	await expect(page).toHaveURL(/\/@detail_user(?:[/?#]|$)/);
	await card(page, original.id).getByText('detail ordinary body', { exact: true }).click();
	await expectNoteUrl(page, original.id);
});

test('引用内层、引用正文和回复线程各自导航到所属实体', /** 嵌套点击只导航一次，子线程提供自身 Enter 入口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.Note = await createNote(author, 'quoted original body');
	const quote: Misskey.entities.Note = await createNote(account, 'outer quote body', { renoteId: original.id });
	const reply: Misskey.entities.Note = await createNote(account, 'thread reply body', { replyId: original.id });
	await open(page, '/@detail_user');
	await card(page, quote.id).getByText('quoted original body', { exact: true }).click();
	await expectNoteUrl(page, original.id);
	await page.goBack();
	await card(page, quote.id).getByText('outer quote body', { exact: true }).click();
	await expectNoteUrl(page, quote.id);
	await page.goto(`${BASE_URL}/notes/${original.id}?ui=twitter`);
	await thread(page, reply.id).focus();
	await page.keyboard.press('Enter');
	await expectNoteUrl(page, reply.id);
});

test('媒体、表情、链接、操作按钮和文字拖选不会被父卡片导航接管', /** 真实指针与键盘交互保留嵌套控件的既有语义。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const attachment: Misskey.entities.DriveFile = await uploadImage(page);
	const note: Misskey.entities.Note = await createNote(author, 'selectable ordinary sentence @detail_user 🙂', { fileIds: [attachment.id] });
	await open(page, '/@detail_author');
	const item: Locator = card(page, note.id);
	await item.locator('a[href="/@detail_user"]').first().click();
	await expect(page).toHaveURL(/\/@detail_user(?:[/?#]|$)/);
	await page.goBack();
	const emoji: Locator = item.locator('img[alt="🙂"], span[alt="🙂"]').first();
	await expect(emoji).toBeVisible();
	await emoji.click();
	await expect(page).toHaveURL(/\/@detail_author(?:[/?#]|$)/);
	const emojiMenu: Locator = page.getByRole('menu');
	await expect(emojiMenu).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(emojiMenu).toBeHidden();
	const profileUrl: string = page.url();
	await item.locator('[data-twitter-note-interactive] img').first().click();
	const lightbox: Locator = page.locator('div:has(> ._modalBg)').filter({ has: page.getByText(attachment.name, { exact: true }) });
	await expect(page).toHaveURL(`${profileUrl}#pswp`);
	await expect(lightbox).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(lightbox).toHaveCount(0);
	await expect(page).toHaveURL(profileUrl);
	await item.getByTestId('twitter-note-actions').getByRole('button', { name: 'Reply', exact: true }).click();
	const popupText: Locator = page.locator('[data-testid="post-form-text"]:not([data-testid="twitter-reply-composer"] *)');
	await expect(popupText).toBeVisible();
	await expect(page).toHaveURL(profileUrl);
	await page.keyboard.press('Escape');
	await expect(popupText).toBeHidden();
	const body: Locator = item.getByText('selectable ordinary sentence', { exact: false }).last();
	const bounds: { x: number; y: number; width: number; height: number } | null = await body.boundingBox();
	expect(bounds).not.toBeNull();
	if (bounds == null) throw new Error('真实正文未提供可拖选的布局区域');
	await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + Math.min(bounds.width - 2, 180), bounds.y + bounds.height / 2, { steps: 12 });
	await page.mouse.up();
	const selected: string = await page.evaluate(/** 读取浏览器真实选区以证明拖选实际发生。 */ (): string => window.getSelection()?.toString() ?? '');
	expect(selected.length).toBeGreaterThan(0);
	await expect(page).toHaveURL(/\/@detail_author(?:[/?#]|$)/);
});

test('修饰点击与中键新开帖子且时间戳支持键盘永久链接', /** 验证新标签语义及原页面不被改写。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const note: Misskey.entities.Note = await createNote(author, 'modified navigation body');
	await open(page, '/@detail_author');
	const body: Locator = card(page, note.id).getByText('modified navigation body', { exact: true });
	const controlPopup: Promise<Page> = page.context().waitForEvent('page');
	await body.click({ modifiers: ['Control'] });
	const controlled: Page = await controlPopup;
	controlled.on('pageerror', /** 新标签采用既有默认 UI，但仍不得出现未处理异常。 */ (error: Error): void => { pageErrors.push(error.message); });
	await expect(controlled).toHaveURL(`${BASE_URL}/notes/${note.id}`);
	await expect(controlled.getByText('modified navigation body', { exact: true }).filter({ visible: true }).first()).toBeVisible();
	await controlled.close();
	await expect(page).toHaveURL(/\/@detail_author(?:[/?#]|$)/);
	const middlePopup: Promise<Page> = page.context().waitForEvent('page');
	await body.click({ button: 'middle' });
	const middle: Page = await middlePopup;
	middle.on('pageerror', /** 中键新标签同样纳入真实页面异常断言。 */ (error: Error): void => { pageErrors.push(error.message); });
	await expect(middle).toHaveURL(`${BASE_URL}/notes/${note.id}`);
	await expect(middle.getByText('modified navigation body', { exact: true }).filter({ visible: true }).first()).toBeVisible();
	await middle.close();
	await expect(page).toHaveURL(/\/@detail_author(?:[/?#]|$)/);
	await card(page, note.id).locator(`a[href="/notes/${note.id}"]`).first().focus();
	await page.keyboard.press('Enter');
	await expectNoteUrl(page, note.id);
	const detail: Locator = page.getByTestId('twitter-note-detail');
	const inlineText: Locator = page.getByTestId('twitter-reply-composer').getByTestId('post-form-text');
	const replyButton: Locator = detail.getByTestId('twitter-note-actions').first().getByRole('button', { name: 'Reply', exact: true });
	await replyButton.focus();
	await expect(replyButton).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(inlineText).toBeFocused();
	const mainArticle: Locator = detail.locator('article[tabindex="0"]').first();
	await mainArticle.focus();
	await expect(mainArticle).toBeFocused();
	await page.keyboard.press('r');
	await expect(inlineText).toBeFocused();
});

test('直接回复跨三十条及子回复跨十条均可分页且引用不混入', /** 所有条目来自真实后端，用 ID 验证范围、完整性和去重。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(author, 'paginated root');
	const replies: Misskey.entities.Note[] = await createReplies(parent.id, 32, 'direct reply');
	const branch: Misskey.entities.Note = replies[replies.length - 1];
	const children: Misskey.entities.Note[] = await createReplies(branch.id, 12, 'nested reply');
	const quote: Misskey.entities.Note = await createNote(account, 'quote must not appear as direct reply', { renoteId: parent.id });
	await open(page, `/notes/${parent.id}`);
	const area: Locator = page.getByTestId('twitter-note-replies');
	await expect(thread(page, replies[31].id)).toBeVisible();
	await expect(thread(page, replies[0].id)).toHaveCount(0);
	await area.getByRole('button', { name: 'Load more', exact: true }).last().click();
	for (const reply of replies) await expect(thread(page, reply.id)).toHaveCount(1);
	await expect(thread(page, quote.id)).toHaveCount(0);
	await expect(area).not.toContainText('quote must not appear as direct reply');
	await thread(page, branch.id).getByRole('button', { name: /Show replies/ }).click();
	await expect(thread(page, children[11].id)).toBeVisible();
	await expect(thread(page, children[0].id)).toHaveCount(0);
	await thread(page, branch.id).getByRole('button', { name: 'Load more', exact: true }).click();
	for (const child of children) await expect(thread(page, child.id)).toHaveCount(1);
});

test('内联发布失败保留输入、重试成功清空并刷新真实回复计数', /** 操作栏聚焦常驻表单，真实写入回执驱动列表与父帖查询。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(author, 'inline reply parent');
	await open(page, `/notes/${parent.id}`);
	const composer: Locator = page.getByTestId('twitter-reply-composer');
	const actions: Locator = page.getByTestId('twitter-note-detail').getByTestId('twitter-note-actions').first();
	await actions.getByRole('button', { name: 'Reply', exact: true }).click();
	await expect(composer.getByTestId('post-form-text')).toBeFocused();
	await composer.getByTestId('post-form-text').fill('preserved inline reply');
	await page.route('**/api/notes/create', /** 仅中断真实传输，验证失败时的草稿保留。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await composer.getByTestId('post-form-submit').click();
	await expect(page.getByTestId('modal-dialog-ok')).toBeVisible();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(composer.getByTestId('post-form-text')).toHaveValue('preserved inline reply');
	await expect(actions).toHaveAttribute('data-replies-count', '0');
	await page.unroute('**/api/notes/create');
	const created: Misskey.entities.Note = await submitInline(page, 'preserved inline reply');
	expect(created.replyId).toBe(parent.id);
	await expect(thread(page, created.id)).toBeVisible();
	await expect(actions).toHaveAttribute('data-replies-count', '1');
	const confirmed: Misskey.entities.Note = await api(BASE_URL, 'notes/show', { i: account.token, noteId: parent.id });
	expect(confirmed.repliesCount).toBe(1);
});

test('切换帖子及返回时按回复目标隔离草稿', /** 使用站内链接与历史导航覆盖路由复用，成功后仅清空已发送目标。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const second: Misskey.entities.Note = await createNote(author, 'draft second parent');
	const first: Misskey.entities.Note = await createNote(author, `draft first parent ${BASE_URL}/notes/${second.id}`);
	await open(page, `/notes/${first.id}`);
	const composer: Locator = page.getByTestId('twitter-reply-composer');
	await composer.getByTestId('post-form-text').fill('first target draft');
	await page.getByTestId('twitter-note-detail').locator(`a[href="${BASE_URL}/notes/${second.id}"], a[href="/notes/${second.id}"]`).first().click();
	await expectNoteUrl(page, second.id);
	await expect(composer.getByTestId('post-form-text')).toHaveValue('@detail_author ');
	await composer.getByTestId('post-form-text').fill('second target draft');
	await page.goBack();
	await expectNoteUrl(page, first.id);
	await expect(composer.getByTestId('post-form-text')).toHaveValue('first target draft');
	await page.goForward();
	await expectNoteUrl(page, second.id);
	await expect(composer.getByTestId('post-form-text')).toHaveValue('second target draft');
	await submitInline(page, 'second target draft');
	await page.goBack();
	await expect(composer.getByTestId('post-form-text')).toHaveValue('first target draft');
	await page.goForward();
	await expectNoteUrl(page, second.id);
	await expect(composer.getByTestId('post-form-text')).toHaveValue('');
});

test('加载更多在途期间发布后保留已读窗口且没有漏项或重复', /** 真实旧分页响应晚于创建回执，最终窗口由后端重新确认。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(author, 'concurrent pagination parent');
	const replies: Misskey.entities.Note[] = await createReplies(parent.id, 31, 'existing reply');
	await open(page, `/notes/${parent.id}`);
	await expect(thread(page, replies[30].id)).toBeVisible();
	const gate: ReplyTransportGate = await holdReplies(page, parent.id, true);
	try {
		await page.getByTestId('twitter-note-replies').getByRole('button', { name: 'Load more', exact: true }).last().click();
		await gate.started;
		const created: Misskey.entities.Note = await submitInline(page, 'reply during pending page');
		gate.release();
		await gate.finished;
		await expect(thread(page, created.id)).toHaveCount(1);
		for (const reply of replies) await expect(thread(page, reply.id)).toHaveCount(1);
		await expect(page.getByTestId('twitter-note-detail').getByTestId('twitter-note-actions').first()).toHaveAttribute('data-replies-count', '32');
	} finally {
		gate.release();
	}
});

test('换帖后晚到的旧回复响应不能污染新帖', /** 持有 A 的真实首屏响应，站内进入 B 后再释放并验证查询归属。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const second: Misskey.entities.Note = await createNote(author, 'new parent after route switch');
	const first: Misskey.entities.Note = await createNote(author, `old parent before route switch ${BASE_URL}/notes/${second.id}`);
	const firstReply: Misskey.entities.Note = await createNote(author, 'old parent child', { replyId: first.id });
	const secondReply: Misskey.entities.Note = await createNote(author, 'new parent child', { replyId: second.id });
	const gate: ReplyTransportGate = await holdReplies(page, first.id, false);
	try {
		await open(page, `/notes/${first.id}`);
		await gate.started;
		await page.getByTestId('twitter-note-detail').locator(`a[href="${BASE_URL}/notes/${second.id}"], a[href="/notes/${second.id}"]`).first().click();
		await expectNoteUrl(page, second.id);
		await expect(thread(page, secondReply.id)).toBeVisible();
		gate.release();
		await gate.finished;
		await expect(thread(page, firstReply.id)).toHaveCount(0);
		await expect(thread(page, secondReply.id)).toHaveCount(1);
		await expect(page.getByTestId('twitter-note-replies')).not.toContainText('old parent child');
	} finally {
		gate.release();
	}
});

test('回复下一页传输失败保留当前窗口并使用原游标重试', /** 真实翻页故障只影响局部状态，不丢失已读回复或提前推进游标。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const parent: Misskey.entities.Note = await createNote(author, 'retry paginated replies parent');
	const replies: Misskey.entities.Note[] = await createReplies(parent.id, 31, 'reply retained after failure');
	await open(page, `/notes/${parent.id}`);
	const area: Locator = page.getByTestId('twitter-note-replies');
	await expect(thread(page, replies[30].id)).toBeVisible();
	await expect(thread(page, replies[0].id)).toHaveCount(0);
	const cursors: string[] = [];
	let failed: boolean = false;
	await page.route('**/api/notes/replies', /** 仅中断目标父帖首次续页传输，重试必须继续访问真实后端。 */ async (route: Route): Promise<void> => {
		const request: Misskey.Endpoints['notes/replies']['req'] = route.request().postDataJSON();
		if (request.noteId !== parent.id || !request.untilId) {
			await route.continue();
			return;
		}
		cursors.push(request.untilId);
		if (!failed) {
			failed = true;
			await route.abort();
			return;
		}
		await route.continue();
	});
	await area.getByRole('button', { name: 'Load more', exact: true }).last().click();
	const retry: Locator = area.getByRole('button', { name: 'Retry', exact: true });
	await expect(retry).toBeVisible();
	expect(cursors).toHaveLength(1);
	for (const reply of replies.slice(1)) await expect(thread(page, reply.id)).toHaveCount(1);
	await expect(thread(page, replies[0].id)).toHaveCount(0);
	await retry.click();
	for (const reply of replies) await expect(thread(page, reply.id)).toHaveCount(1);
	await expect(retry).toBeHidden();
	expect(cursors).toHaveLength(2);
	expect(cursors[1]).toBe(cursors[0]);
});

test('列表卡片自身的 Enter 与 V 保持内容警告展开收起语义', /** 根快捷键只处理自身焦点，不借修复内部链接改变既有 CW 行为。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const bodyText: string = 'short body protected by content warning';
	const note: Misskey.entities.Note = await createNote(author, bodyText, { cw: 'short content warning' });
	await open(page, '/@detail_author');
	const item: Locator = card(page, note.id);
	const body: Locator = item.getByText(bodyText, { exact: true });
	await expect(item).toBeVisible();
	await expect(body).toBeHidden();
	await item.focus();
	await page.keyboard.press('Enter');
	await expect(body).toBeVisible();
	await expect(page).toHaveURL(/\/@detail_author(?:[/?#]|$)/);
	await item.focus();
	await page.keyboard.press('v');
	await expect(body).toBeHidden();
	await expect(page).toHaveURL(/\/@detail_author(?:[/?#]|$)/);
});
