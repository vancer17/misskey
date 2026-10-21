/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 头像挂件展示范围与真实佩戴回访。
 * 数据链：隔离后端上传／佩戴回执 → 现有账户状态 → 页面头像与可见绘制区域。
 * 只检查公开 DOM 与真实接口；不生成成功业务响应，不探测或启动测试环境。
 * 截图保留为人工验收证据，不将未经确认的新截图自动宣布为视觉基线。
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { APIResponse, Locator, Page, PlaywrightTestArgs, Request, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { PreferencesProfile } from '../../src/preferences/manager.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 隔离实例签发的管理员账户；不输出凭据。 */
let account: RegisteredUser;
/** 全局异常只保存消息，避免测试成功掩盖黑屏或未处理拒绝。 */
let errors: string[];
/** 既有非对称透明素材，真实上传并经过后端媒体处理。 */
const framePng: Buffer = readFileSync(new URL('./fixtures/avatar-decoration-frame.png', import.meta.url));
/** 独立有效 PNG，确保管理换图测试得到不同内容地址。 */
const replacementPng: Buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEAZUpGGlIngcVnSU9DOfe74s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfbHAAkDETZA5AAAAAElFTkSuQmCC', 'base64');

/** 上传真实素材，返回服务端确认的资源地址。 */
async function upload(page: Page, buffer: Buffer = framePng): Promise<string> {
	const response: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: { i: account.token, file: { name: 'rendering-frame.png', mimeType: 'image/png', buffer } },
	});
	expect(response.ok()).toBe(true);
	const file: Misskey.entities.DriveFile = await response.json();
	return file.url;
}

/** 通过管理接口创建真实挂件；所有页面使用同一标识与地址。 */
async function decoration(page: Page): Promise<Misskey.entities.GetAvatarDecorationsResponse[number]> {
	return await api(BASE_URL, 'admin/avatar-decorations/create', { i: account.token, name: '展示边界验收', description: '', url: await upload(page) });
}

/** 服务端发帖用于独立帖、引用、回复和纯转发的展示角色检查。 */
async function note(input: Misskey.Endpoints['notes/create']['req']): Promise<Misskey.entities.Note> {
	const response: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { ...input, i: account.token });
	return response.createdNote;
}

/** 通过真实佩戴接口建立初始状态，不从浏览器写入领域事实。 */
async function wear(id: string, transform: Partial<Misskey.entities.MeDetailed['avatarDecorations'][number]> = {}): Promise<void> {
	await api(BASE_URL, 'i/update', { i: account.token, avatarDecorations: [{ id, angle: 0, flipH: false, offsetX: 0, offsetY: 0, ...transform }] });
}

/** 使用既有本地会话协议，后续回访只点击应用链接或浏览器后退。 */
async function open(page: Page, path: string = '/@rendering_admin'): Promise<void> {
	const me: AccountWithToken = { ...await api(BASE_URL, 'i', { i: account.token }), token: account.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 写入后端已签发的会话与界面语言。 */ (value: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(value));
		localStorage.setItem('lang', 'zh-CN');
	}, me);
	await page.goto(`${BASE_URL}${path}?ui=twitter`);
}

/** 按真实帖子标识查找当前资料列表内的顶层卡片。 */
function card(page: Page, id: string): Locator {
	return page.getByTestId('twitter-user-timeline-notes').locator(`[data-testid="twitter-note"][data-note-id="${id}"]`).first();
}

/** 断言实际图片成功解码，避免仅有空挂件节点也算成功。 */
async function loaded(avatar: Locator, url: string): Promise<void> {
	const image: Locator = avatar.locator('[data-twitter-avatar-decoration]');
	await expect(image).toHaveCount(1);
	await expect(image).toHaveAttribute('src', url);
	await expect.poll(/** 只读取浏览器图像状态。 */ async (): Promise<boolean> => image.evaluate(
		/** 成功解码须有真实尺寸。 */ (element: HTMLImageElement): boolean => element.complete && element.naturalWidth > 0,
	)).toBe(true);
}

/** 从资料页进入原有编辑、装饰入口，保持同一 SPA 和账户引用。 */
async function enterSettings(page: Page): Promise<void> {
	await page.getByTestId('twitter-profile').getByRole('button', { name: /^编辑.*资料$/ }).click();
	await page.locator('a[href="/settings/avatar-decoration"]').first().click();
	await expect(page.getByTestId('avatar-decoration-page')).toBeVisible();
}

/** 从装饰页连续回访到资料页，不整页重载或重新注入账户。 */
async function returnToProfile(page: Page): Promise<void> {
	await page.goBack();
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
}

/** 修改应用实际保存的偏好记录，重载后由既有偏好管理器读取；不改账户佩戴事实。 */
async function preferences(page: Page, values: Partial<PreferencesProfile['preferences']>): Promise<void> {
	await page.evaluate(/** 沿用当前配置身份与其他字段，只更新本项显示偏好。 */ (patch: Partial<PreferencesProfile['preferences']>): void => {
		const raw: string | null = localStorage.getItem('preferences');
		if (raw === null) throw new Error('应用尚未保存偏好配置');
		const current: PreferencesProfile = JSON.parse(raw);
		localStorage.setItem('preferences', JSON.stringify({ ...current, preferences: { ...current.preferences, ...patch } }));
	}, values);
	/** SPA 路由可能省略初始 UI query；整页载入显式保留本套件的 Twitter 展示入口。 */
	const target: URL = new URL(page.url());
	target.searchParams.set('ui', 'twitter');
	await page.goto(target.href);
	await page.locator('#splash').waitFor({ state: 'detached' });
}

/** 截图等待真实字体和有限动画结束，保留持续动效与实际布局。 */
async function capture(page: Page, path: string): Promise<void> {
	await page.locator('#splash').waitFor({ state: 'detached' });
	await page.evaluate(/** 字体就绪后再记录文字边界。 */ async (): Promise<void> => { await document.fonts.ready; });
	await expect.poll(/** 读取实际有限动画的状态，不改动画时长。 */ async (): Promise<number> => page.evaluate(
		/** 无限闪烁属于素材表现，不阻止记录真实帧。 */ (): number => document.getAnimations().filter(
			/** 仅等待入场、退出等有限动画。 */ (animation: Animation): boolean => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)) && (animation.playState === 'running' || animation.pending),
		).length,
	)).toBe(0);
	await page.screenshot({ path });
}

/** 只读几何投影用于对比正式头像和同场景预览，不回写业务状态。 */
async function geometry(avatar: Locator): Promise<readonly number[]> {
	return await avatar.evaluate(/** 相对边界剔除页面位置，只保留头像尺度和四向绘制范围。 */ (element: HTMLElement): readonly number[] => {
		const layer: HTMLElement | null = element.querySelector('[data-twitter-avatar-decoration-layer]');
		if (!layer) throw new Error('场景预览缺少真实挂件绘制层');
		const avatarBounds: DOMRect = element.getBoundingClientRect();
		const layerBounds: DOMRect = layer.getBoundingClientRect();
		return [avatarBounds.width, avatarBounds.height, layerBounds.left - avatarBounds.left, layerBounds.top - avatarBounds.top, layerBounds.right - avatarBounds.right, layerBounds.bottom - avatarBounds.bottom];
	});
}

/** 每项测试使用独立的真实后台账户和目录。 */
test.beforeEach(async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	account = await registerUser(BASE_URL, 'rendering_admin', 'rendering-test-password', true);
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	errors = [];
	page.on('pageerror', /** 不记录凭据或请求体。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.emulateMedia({ colorScheme: 'dark' });
});

/** 页面交互不得产生未处理异常。 */
test.afterEach((): void => { expect(errors).toEqual([]); });

test('真实佩戴和移除后回访资料同步，侧栏始终不显示挂件', /** UI 提交后只依赖真实账户更新和页面回访。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const item: Misskey.entities.GetAvatarDecorationsResponse[number] = await decoration(page);
	const post: Misskey.entities.Note = await note({ text: '佩戴回访头像验证' });
	await open(page);
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await enterSettings(page);
	await page.locator(`[data-testid="decoration-card"][data-decoration-id="${item.id}"]`).getByRole('button').first().click();
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await returnToProfile(page);
	await loaded(page.locator('[data-twitter-avatar-context="profile"]'), item.url);
	await loaded(card(page, post.id).locator('[data-twitter-avatar-context="note"]'), item.url);
	await expect(page.getByTestId('twitter-sidebar').locator('[data-twitter-avatar-decoration]')).toHaveCount(0);
	await enterSettings(page);
	await page.getByTestId('decoration-remove-all').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-count')).toHaveText(/^已佩戴 0 \/ \d+$/);
	await returnToProfile(page);
	await expect(page.getByTestId('twitter-profile').locator('[data-twitter-avatar-decoration]')).toHaveCount(0);
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	expect(me.avatarDecorations).toHaveLength(0);
});

test('纯转发和独立回复保留主作者，引用与上下文头像关闭', /** 展示角色不由 embedded 或 replyId 推断。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const item: Misskey.entities.GetAvatarDecorationsResponse[number] = await decoration(page);
	await wear(item.id);
	const original: Misskey.entities.Note = await note({ text: '原始主内容' });
	const renote: Misskey.entities.Note = await note({ renoteId: original.id });
	const quote: Misskey.entities.Note = await note({ text: '引用正文', renoteId: original.id });
	const reply: Misskey.entities.Note = await note({ text: '独立回复正文', replyId: original.id });
	await open(page);
	await expect(card(page, renote.id)).toBeVisible();
	const collapsed: Locator = card(page, renote.id).getByRole('button').filter({ hasText: '原始主内容' }).first();
	if (await collapsed.isVisible()) {
		await expect(collapsed.locator('[data-twitter-avatar-decoration]')).toHaveCount(0);
		await collapsed.click();
	}
	await loaded(card(page, renote.id).locator('[data-twitter-avatar-context="note"]'), item.url);
	await expect(card(page, renote.id).locator('[data-twitter-avatar-context="none"]')).toHaveCount(1);
	await expect(card(page, renote.id).locator('[data-twitter-avatar-context="none"] [data-twitter-avatar-decoration]')).toHaveCount(0);
	await loaded(card(page, quote.id).locator('[data-twitter-avatar-context="note"]'), item.url);
	await expect(card(page, quote.id).locator('[data-twitter-avatar-context="none"]')).toHaveCount(1);
	await expect(card(page, quote.id).locator('[data-twitter-avatar-context="none"] [data-twitter-avatar-decoration]')).toHaveCount(0);
	await page.locator('a[href="/@rendering_admin/replies"]').first().click();
	await loaded(page.getByTestId('twitter-user-timeline-replies').locator(`[data-note-id="${reply.id}"] [data-twitter-avatar-context="note"]`), item.url);
	await page.goto(`${BASE_URL}/notes/${reply.id}?ui=twitter`);
	await loaded(page.getByTestId('twitter-note-detail').locator('[data-twitter-avatar-context="note"]'), item.url);
	await expect(page.getByTestId('twitter-thread-note').locator('[data-twitter-avatar-context="none"]')).toHaveCount(1);
	await expect(page.getByTestId('twitter-thread-note').locator('[data-twitter-avatar-decoration]')).toHaveCount(0);
});

/** 桌面和两种窄屏均实际计算几何；明暗主题共用同一布局约束。 */
for (const width of [1440, 390, 320]) {
	test(`${width}px 主头像和帖卡只裁剪挂件且不覆盖相邻内容`, /** 真实佩戴后测量允许绘制层，不把原始大画布误当可见区域。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		const item: Misskey.entities.GetAvatarDecorationsResponse[number] = await decoration(page);
		await wear(item.id, { angle: 0.125, flipH: true, offsetX: 0.125, offsetY: -0.125 });
		const post: Misskey.entities.Note = await note({ text: '正文起点不能被头像挂件移动或覆盖' });
		await page.setViewportSize({ width, height: 1050 });
		await open(page);
		const profileAvatar: Locator = page.locator('[data-twitter-avatar-context="profile"]');
		const postAvatar: Locator = card(page, post.id).locator('[data-twitter-avatar-context="note"]');
		await loaded(profileAvatar, item.url);
		await loaded(postAvatar, item.url);
		const profileGeometry: readonly number[] = await geometry(profileAvatar);
		const noteGeometry: readonly number[] = await geometry(postAvatar);
		for (const colorScheme of ['dark', 'light'] as const) {
			await page.emulateMedia({ colorScheme });
			const profileSafe: boolean = await profileAvatar.evaluate(/** 资料挂件不能越主列或压到用户名。 */ (element: HTMLElement): boolean => {
				const layer: HTMLElement | null = element.querySelector('[data-twitter-avatar-decoration-layer]');
				const profile: HTMLElement | null = element.closest('[data-testid="twitter-profile"]');
				const heading: HTMLElement | null = profile?.querySelector('h1') ?? null;
				if (!layer || !profile || !heading) return false;
				const bounds: DOMRect = layer.getBoundingClientRect();
				const column: DOMRect = profile.getBoundingClientRect();
				return bounds.left >= column.left - 1 && bounds.right <= column.right + 1 && bounds.bottom <= heading.getBoundingClientRect().top + 1
					&& getComputedStyle(layer).overflowX === 'clip' && getComputedStyle(layer).pointerEvents === 'none'
					&& getComputedStyle(element).overflowX === 'visible';
			});
			expect(profileSafe).toBe(true);
			const postSafe: boolean = await postAvatar.evaluate(/** 帖卡保持 48px 头像和原正文起点，只允许装饰在既有留白内可见。 */ (element: HTMLElement): boolean => {
				const layer: HTMLElement | null = element.querySelector('[data-twitter-avatar-decoration-layer]');
				const post: HTMLElement | null = element.closest('[data-testid="twitter-note"]');
				const main: Element | null = element.parentElement?.nextElementSibling ?? null;
				if (!layer || !post || !main) return false;
				const bounds: DOMRect = layer.getBoundingClientRect();
				const cardBounds: DOMRect = post.getBoundingClientRect();
				const avatarBounds: DOMRect = element.getBoundingClientRect();
				const gap: number = main.getBoundingClientRect().left - avatarBounds.right;
				return Math.abs(avatarBounds.width - 48) <= 1 && Math.abs(avatarBounds.height - 48) <= 1
					&& bounds.left >= cardBounds.left - 1 && bounds.top >= cardBounds.top - 1 && bounds.right <= main.getBoundingClientRect().left - 1
					&& gap >= 9 && gap <= 13 && getComputedStyle(layer).overflowX === 'clip' && getComputedStyle(post).overflowX !== 'hidden';
			});
			expect(postSafe).toBe(true);
			const transform: { rotate: string; scale: string; translate: string } = await postAvatar.locator('[data-twitter-avatar-decoration]').evaluate(
				/** 独立变换属性保留旧画布坐标，避免组合 transform 改变应用顺序。 */
				(element: HTMLElement): { rotate: string; scale: string; translate: string } => ({ rotate: element.style.rotate, scale: element.style.scale, translate: element.style.translate }),
			);
			expect(transform).toEqual({ rotate: '45deg', scale: '-1 1', translate: '12.5% -12.5%' });
			await capture(page, info.outputPath(`rendering-${width}-${colorScheme}.png`));
		}
		await enterSettings(page);
		await page.getByTestId('decoration-adjust').click();
		const preview: Locator = page.getByTestId('decoration-draft-preview');
		await loaded(preview.locator('[data-twitter-avatar-context="note"]'), item.url);
		await expect.poll(/** 等待试戴弹窗真实入场动画结束，保持正式场景的精确几何要求。 */ async (): Promise<readonly number[]> => geometry(preview.locator('[data-twitter-avatar-context="note"]'))).toEqual(noteGeometry);
		await page.getByTestId('decoration-preview-context').selectOption('profile');
		await loaded(preview.locator('[data-twitter-avatar-context="profile"]'), item.url);
		await expect.poll(/** 切换场景后等待实际布局稳定，不禁用动画或放宽边界。 */ async (): Promise<readonly number[]> => geometry(preview.locator('[data-twitter-avatar-context="profile"]'))).toEqual(profileGeometry);
	});
}

test('隐藏偏好关闭正式挂件，显式预览仍服从静态图片偏好', /** 偏好仅改变展示，不改真实佩戴结果。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const item: Misskey.entities.GetAvatarDecorationsResponse[number] = await decoration(page);
	await wear(item.id);
	await open(page);
	await loaded(page.locator('[data-twitter-avatar-context="profile"]'), item.url);
	await preferences(page, { showAvatarDecorations: [[{}, false, {}]] });
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect(page.getByTestId('twitter-profile').locator('[data-twitter-avatar-decoration]')).toHaveCount(0);
	await enterSettings(page);
	await page.getByTestId('decoration-adjust').click();
	await loaded(page.getByTestId('decoration-draft-preview').locator('[data-twitter-avatar-context="note"]'), item.url);
	await page.getByTestId('decoration-cancel').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await preferences(page, { disableShowingAnimatedImages: [[{}, true, {}]] });
	await expect(page.getByTestId('avatar-decoration-page')).toBeVisible();
	await page.getByTestId('decoration-adjust').click();
	const image: Locator = page.getByTestId('decoration-draft-preview').locator('[data-twitter-avatar-decoration]');
	await expect(image).toHaveCount(1);
	await expect(image).not.toHaveAttribute('src', item.url);
	await expect.poll(/** 静态图片必须实际解码成功，失败消失不能冒充静态降级。 */ async (): Promise<boolean> => image.evaluate(
		/** 检查真实图片读取与关闭闪烁的最终样式。 */ (element: HTMLImageElement): boolean => element.complete && element.naturalWidth > 0 && getComputedStyle(element).animationName === 'none',
	)).toBe(true);
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	expect(me.avatarDecorations[0].id).toBe(item.id);
});

test('管理修改已佩戴素材后，同会话回访从服务端更新图片引用', /** 原挂件标识保持不变，不能仅刷新管理目录。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const item: Misskey.entities.GetAvatarDecorationsResponse[number] = await decoration(page);
	await wear(item.id);
	await note({ text: '管理素材更新回访' });
	const replacement: string = await upload(page, replacementPng);
	expect(replacement).not.toBe(item.url);
	await open(page);
	await loaded(page.locator('[data-twitter-avatar-context="profile"]'), item.url);
	await enterSettings(page);
	await page.getByTestId('decoration-manage').click();
	await page.locator(`[data-testid="decoration-manager-card"][data-decoration-id="${item.id}"]`).click();
	const url: Locator = page.getByTestId('decoration-manager-url').locator('input');
	if (!await url.isVisible()) await page.getByTestId('decoration-manager-url-toggle').locator('summary').click();
	await url.fill(replacement);
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	await page.goBack();
	await returnToProfile(page);
	await loaded(page.locator('[data-twitter-avatar-context="profile"]'), replacement);
	await expect(page.getByTestId('twitter-profile').locator(`[data-twitter-avatar-decoration][src="${item.url}"]`)).toHaveCount(0);
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	expect(me.avatarDecorations[0].id).toBe(item.id);
	expect(me.avatarDecorations[0].url).toBe(replacement);
});

test('管理换图成功但账户读取失败时可重试刷新，不能重复写入', /** 仅中断真实后续读取，保留服务端已成功提交的事实。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const item: Misskey.entities.GetAvatarDecorationsResponse[number] = await decoration(page);
	await wear(item.id);
	const replacement: string = await upload(page, replacementPng);
	await open(page);
	await loaded(page.locator('[data-twitter-avatar-context="profile"]'), item.url);
	await enterSettings(page);
	await page.getByTestId('decoration-manage').click();
	await page.locator(`[data-testid="decoration-manager-card"][data-decoration-id="${item.id}"]`).click();
	const url: Locator = page.getByTestId('decoration-manager-url').locator('input');
	if (!await url.isVisible()) await page.getByTestId('decoration-manager-url-toggle').locator('summary').click();
	await url.fill(replacement);
	let writes: number = 0;
	page.on('request', /** 只统计本次管理写入，不记录参数或凭据。 */ (request: Request): void => { if (request.url().endsWith('/api/admin/avatar-decorations/update')) writes++; });
	await page.route('**/api/i', /** 保存成功后的账户读取发生传输故障，不伪造业务内容。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-feedback')).toContainText('操作已保存，但当前佩戴图片刷新失败');
	const confirmed: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	expect(confirmed.avatarDecorations[0].url).toBe(replacement);
	await page.unroute('**/api/i');
	await page.getByTestId('decoration-manager-refresh').click();
	await expect(page.getByTestId('decoration-manager-feedback')).toHaveCount(0);
	await page.goBack();
	await returnToProfile(page);
	await loaded(page.locator('[data-twitter-avatar-context="profile"]'), replacement);
	expect(writes).toBe(1);
});
