/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 频道入口的真实后端交互与布局回归。
 * 作用：验证关注空态、频道横条、头部搜索和独立管理弹窗的可见边界。
 * 数据链：隔离实例真实账号／频道／帖子 → 页面查询所有者 → 浏览器布局和交互；不 Mock 业务响应。
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page, PlaywrightTestArgs, Request, Response, Route } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 测试进程内的真实管理员身份，仅用于隔离实例初始化。 */
let admin: RegisteredUser;
/** 浏览器消费的真实普通账号。 */
let viewer: AccountWithToken;
/** 频道内容作者，与浏览器账号区分以验证真实聚合查询。 */
let author: AccountWithToken;
/** 从页面首帧收集未处理异常，不能以布局断言掩盖渲染失败。 */
let pageErrors: string[];

/** Playwright 布局结果的非空派生，只用于几何断言。 */
type ElementBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/** 创建真实账号并关闭首次设置向导，使测试进入目标页面。 */
async function createUser(username: string): Promise<AccountWithToken> {
	const user: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username, password: 'communities-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: user.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return user;
}

/** 在真实后端建立频道及可选初始帖子，返回服务端权威实体。 */
async function createChannel(name: string, withNote: boolean = true): Promise<Misskey.entities.Channel> {
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: admin.token, name, description: '' });
	if (withNote) await api(BASE_URL, 'notes/create', { i: author.token, channelId: channel.id, text: `Post in ${name}` });
	return channel;
}

/** 使用现有认证持久化格式进入页面，启动认证仍由真实后端完成。 */
async function open(page: Page, width: number = 1440): Promise<Locator> {
	await page.setViewportSize({ width, height: 1000 });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 测试只写入现有客户端会话格式。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, viewer);
	await page.goto(`${BASE_URL}/channels?ui=twitter`);
	const root: Locator = page.getByTestId('twitter-communities');
	await expect(root).toBeVisible();
	return root;
}

/** 获取实际可见盒子，缺失时直接报告目标未渲染。 */
async function box(locator: Locator): Promise<ElementBox> {
	const result: ElementBox | null = await locator.boundingBox();
	expect(result).not.toBeNull();
	return result!;
}

/** 从既有头部菜单进入业务弹窗，避免依赖旧的流后折叠区。 */
async function openLibrary(page: Page, name: string): Promise<Locator> {
	await page.getByTestId('twitter-community-menu').click();
	await page.getByRole('menuitem', { name: new RegExp(`${name}$`) }).click();
	const library: Locator = page.getByTestId('twitter-community-library');
	await expect(library).toBeVisible();
	return library;
}

test.beforeEach(/** 所有重置均指向外部启动的独立测试实例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'communities_admin', 'communities-admin-password', true);
	viewer = await createUser('communities_viewer');
	author = await createUser('communities_author');
	pageErrors = [];
	page.on('pageerror', /** 记录脚本异常而不输出账号凭据。 */ (error: Error): void => { pageErrors.push(error.message); });
});

test.afterEach(/** 每次完整交互都必须没有未处理页面异常。 */ (): void => { expect(pageErrors).toEqual([]); });

test('零关注首页只呈现单一引导，发现不混入管理和收藏', /** 真实空集合与有内容的发现流分别验证。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await createChannel('Explore channel');
	const root: Locator = await open(page);
	await expect(root.getByTestId('twitter-community-empty-following')).toBeVisible();
	await expect(root.getByTestId('twitter-community-empty-following')).toHaveCount(1);
	await expect(root.getByText('No notes', { exact: true })).toHaveCount(0);
	await expect(root.getByText('None', { exact: true })).toHaveCount(0);
	await expect(root.getByTestId('twitter-community-strip')).toHaveCount(0);
	await root.getByRole('button', { name: 'Explore', exact: true }).click();
	await expect(root.getByTestId('twitter-community-card').filter({ hasText: channel.name })).toHaveCount(1);
	await expect(root.getByTestId('twitter-note')).toContainText('Post in Explore channel');
	await expect(page.getByTestId('twitter-community-library')).toHaveCount(0);
	await expect(root.locator('a[href="/channels/new"]')).toHaveCount(0);
});

for (const width of [1440, 390]) {
	test(`${width}px 关注频道单行横排且帖子位于横条下方`, /** 通过真实频道集合确认响应式几何边界。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		for (let index: number = 0; index < 4; index++) {
			const channel: Misskey.entities.Channel = await createChannel(`Followed ${index}`);
			await api(BASE_URL, 'channels/follow', { i: viewer.token, channelId: channel.id });
		}
		const root: Locator = await open(page, width);
		const strip: Locator = root.getByTestId('twitter-community-strip');
		const cards: Locator = strip.getByTestId('twitter-community-card');
		await expect(cards).toHaveCount(4);
		await expect(strip.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
		await expect(root.getByTestId('twitter-note')).toHaveCount(4);
		const first: ElementBox = await box(cards.nth(0));
		const second: ElementBox = await box(cards.nth(1));
		const stripBox: ElementBox = await box(strip);
		const noteBox: ElementBox = await box(root.getByTestId('twitter-note').first());
		expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
		expect(second.x).toBeGreaterThan(first.x + first.width);
		expect(first.width).toBe(132);
		expect(first.height).toBeLessThan(100);
		expect(noteBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height - 1);
		const horizontalOverflow: number = await page.evaluate(/** 横滑仅存在于频道横条，不能撑宽整页。 */ (): number => document.documentElement.scrollWidth - window.innerWidth);
		expect(horizontalOverflow).toBeLessThanOrEqual(1);
		if (width === 390) {
			const next: Locator = strip.getByRole('button', { name: 'Next', exact: true });
			await expect(next).toBeVisible();
			await next.click();
			await expect(cards.last()).toBeInViewport({ ratio: 1 });
		}
	});
}

test('头部搜索框留在标题盒内且同参重复搜索真正完成', /** 搜索结果必须来自真实接口，重复提交不留下永久加载。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await createChannel('RepeatSearch', false);
	const root: Locator = await open(page, 390);
	const header: Locator = root.getByTestId('twitter-communities-header');
	await root.getByTestId('twitter-community-search').click();
	const input: Locator = header.getByRole('searchbox');
	await expect(input).toBeFocused();
	const headerBox: ElementBox = await box(header);
	const inputBox: ElementBox = await box(input);
	expect(inputBox.y).toBeGreaterThanOrEqual(headerBox.y);
	expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
	await input.fill(channel.name);
	for (let index: number = 0; index < 2; index++) {
		const response: Promise<Response> = page.waitForResponse(/** 每轮都等待真实检索回执。 */ (result: Response): boolean => result.url().endsWith('/api/channels/search') && result.status() === 200);
		await input.press('Enter');
		await response;
		await expect(root.locator(`a[href="/channels/${channel.id}"]`)).toHaveCount(1);
	}
	await header.getByRole('search').getByRole('button').click();
	await expect(root.getByRole('tab', { name: 'Home', exact: true })).toBeVisible();
});

test('关注请求失败显示局部重试，成功重试后读取真实频道', /** 只注入传输故障，不能把失败解释成零关注或伪造重试结果。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await createChannel('Retry followed');
	await api(BASE_URL, 'channels/follow', { i: viewer.token, channelId: channel.id });
	let failed: boolean = false;
	await page.route('**/api/channels/followed', /** 首次仅中断传输，后续请求全部交给真实后端。 */ async (route: Route): Promise<void> => {
		if (!failed) {
			failed = true;
			await route.abort();
			return;
		}
		await route.continue();
	});
	const root: Locator = await open(page);
	const strip: Locator = root.getByTestId('twitter-community-strip');
	await expect(strip.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	await expect(root.getByTestId('twitter-community-empty-following')).toHaveCount(0);
	await expect(root.getByText('No notes', { exact: true })).toHaveCount(0);
	const retried: Promise<Response> = page.waitForResponse(/** 成功重试必须得到真实关注接口回执。 */ (response: Response): boolean => response.url().endsWith('/api/channels/followed') && response.status() === 200);
	await strip.getByRole('button', { name: 'Retry', exact: true }).click();
	await retried;
	await expect(strip.getByTestId('twitter-community-card')).toHaveCount(1);
	await expect(root.getByTestId('twitter-note')).toContainText('Post in Retry followed');
});

test('离页关注及取关后回访更新原缓存首页和单一空态', /** 通过真实业务接口变更存量关系，验证缓存回访的查询所有者恢复事实。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await createChannel('Changed while away');
	const root: Locator = await open(page);
	await expect(root.getByTestId('twitter-community-empty-following')).toBeVisible();
	const notifications: Locator = page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]');
	await notifications.click();
	await expect(page).toHaveURL(/\/my\/notifications/);
	await api(BASE_URL, 'channels/follow', { i: viewer.token, channelId: channel.id });
	await page.goBack();
	await expect(root.getByTestId('twitter-community-card')).toHaveCount(1);
	await expect(root.getByTestId('twitter-note')).toContainText('Post in Changed while away');
	await expect(root.getByTestId('twitter-community-empty-following')).toHaveCount(0);
	await notifications.click();
	await expect(page).toHaveURL(/\/my\/notifications/);
	await api(BASE_URL, 'channels/unfollow', { i: viewer.token, channelId: channel.id });
	await page.goBack();
	await expect(root.getByTestId('twitter-community-empty-following')).toHaveCount(1);
	await expect(root.getByTestId('twitter-community-card')).toHaveCount(0);
	await expect(root.getByTestId('twitter-note')).toHaveCount(0);
	await expect(root.getByText('No notes', { exact: true })).toHaveCount(0);
});

test('独立管理与收藏弹窗按需读取，关闭后主流保持原位', /** 管理实体不进入发现帖子容器，也不预取不可见业务面板。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: viewer.token, name: 'Owned channel', description: '' });
	await api(BASE_URL, 'notes/create', { i: author.token, channelId: channel.id, text: 'Owned channel post' });
	await api(BASE_URL, 'channels/favorite', { i: viewer.token, channelId: channel.id });
	const reads: Record<string, number> = {};
	page.on('request', /** 只计数请求类别，不记录令牌与原始请求体。 */ (request: Request): void => {
		const endpoint: string = new URL(request.url()).pathname;
		reads[endpoint] = (reads[endpoint] ?? 0) + 1;
	});
	const root: Locator = await open(page);
	await expect(root.getByTestId('twitter-community-empty-following')).toBeVisible();
	expect(reads['/api/channels/owned'] ?? 0).toBe(0);
	expect(reads['/api/channels/my-favorites'] ?? 0).toBe(0);
	await root.getByRole('tab', { name: 'Explore', exact: true }).click();
	await expect(root.getByTestId('twitter-note')).toHaveCount(1);
	const owned: Locator = await openLibrary(page, 'Owned');
	await expect(owned.locator(`a[href="/channels/${channel.id}"]`)).toBeVisible();
	await expect(owned.locator('a[href="/channels/new"]')).toBeVisible();
	expect(reads['/api/channels/owned']).toBe(1);
	await page.getByTestId('modal-window-close').click();
	const favorites: Locator = await openLibrary(page, 'Favorites');
	await expect(favorites.locator(`a[href="/channels/${channel.id}"]`)).toBeVisible();
	expect(reads['/api/channels/my-favorites']).toBe(1);
	await page.getByTestId('modal-window-close').click();
	await expect(root.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(root.getByTestId('twitter-community-card')).toHaveCount(1);
	await expect(root.getByTestId('twitter-note')).toHaveCount(1);
	const reopened: Locator = await openLibrary(page, 'Owned');
	await reopened.locator(`a[href="/channels/${channel.id}"]`).click();
	await expect(page.getByTestId('twitter-community-library')).toHaveCount(0);
	await expect(page.locator('._pageContainer').getByRole('heading', { name: channel.name, exact: true }).first()).toBeVisible();
	await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
	await expect(page).toHaveURL(/\/my\/notifications/);
});

test('超过二十个关注频道可横向加载后续页且首拉只发生一次', /** 真实多页集合证明横条尾部加载能力，不以内存造数替代分页。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	for (let index: number = 0; index < 24; index++) {
		const channel: Misskey.entities.Channel = await createChannel(`Paged ${index}`, index === 0);
		await api(BASE_URL, 'channels/follow', { i: viewer.token, channelId: channel.id });
	}
	let followedReads: number = 0;
	page.on('request', /** 分页请求保留真实序列化字段，只统计读取次数。 */ (request: Request): void => {
		if (request.url().endsWith('/api/channels/followed')) followedReads++;
	});
	const root: Locator = await open(page, 390);
	const cards: Locator = root.getByTestId('twitter-community-card');
	await expect.poll(/** 沿用宿主首拉上限，不把请求配置中的每页上限当作首拉数量。 */ (): Promise<number> => cards.count()).toBeGreaterThan(0);
	expect(await cards.count()).toBeLessThan(24);
	expect(followedReads).toBe(1);
	const loadMore: Locator = root.getByRole('button', { name: 'Load more', exact: true });
	await loadMore.scrollIntoViewIfNeeded();
	await loadMore.click();
	await expect(root.getByTestId('twitter-community-card')).toHaveCount(24);
	expect(followedReads).toBe(2);
	await root.getByRole('tab', { name: 'Explore', exact: true }).click();
	await expect(root.getByTestId('twitter-note')).toHaveCount(1);
	await root.getByRole('tab', { name: 'Home', exact: true }).click();
	await expect(root.getByTestId('twitter-community-card')).toHaveCount(24);
	expect(followedReads).toBe(2);
});
