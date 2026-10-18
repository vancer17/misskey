/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 主滚动真实后端回归：窗口边缘几何、原生滚动、路由位置恢复和模态交互。
 * 只使用隔离测试实例；网络延迟保留真实响应，布局数据来自实际 DOM，不探测运维状态。
 */
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Locator, Page, PlaywrightTestArgs, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 保留浏览器原生滚动条，以占位式滚动条核查主列宽度。 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar'] } });

/** 真实服务端签发的测试账户，不保存到产物或日志。 */
let account: AccountWithToken;
/** 记录浏览器执行异常；不屏蔽路由/渲染异常。 */
let errors: string[];

test.beforeEach(/** 建立独立资料和足够长的真实帖子流。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'scroll_admin', 'scroll-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'scroll_user', password: 'scroll-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	for (let index: number = 0; index < 28; index++) {
		await api(BASE_URL, 'notes/create', {
			i: account.token,
			text: `Scroll note ${index}\n${'Stable real backend content for scroll geometry.\n'.repeat(3)}`,
		});
	}
	errors = [];
	page.on('pageerror', /** 仅记录错误消息。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 使用原账户持久化契约，认证仍由真实启动链验证。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, account);
});

test.afterEach(/** 从首帧开始记录的执行错误必须为空。 */ (): void => { expect(errors).toEqual([]); });

/** 首次导航之后仅通过原链接和历史操作回访。 */
async function openProfile(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/@${account.username}?ui=twitter`);
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect(page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').first()).toBeVisible();
}

/** 当前主滚动宿主的唯一定位点。 */
function viewport(page: Page): Locator {
	return page.getByTestId('twitter-scroll-viewport');
}

/** 读取原生元素位置，不使用 window.scrollY 作为主位置的替代。 */
async function scrollTop(page: Page): Promise<number> {
	return viewport(page).evaluate(/** 浏览器真实滚动位置。 */ (element: HTMLElement): number => element.scrollTop);
}

/** 在真实页面滚动，不改写业务组件状态。 */
async function scrollTo(page: Page, top: number): Promise<void> {
	await viewport(page).evaluate(/** 原生滚动 API。 */ (element: HTMLElement, position: number): void => { element.scrollTo({ top: position, behavior: 'instant' }); }, top);
	await expect.poll(/** 等待浏览器位置生效。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - top)).toBeLessThan(2);
}

/** 校验所有标准页面根没有自己的纵向滚动容器。 */
async function expectSingleMainScroll(page: Page): Promise<void> {
	const containers: string[] = await page.locator('[data-twitter-route-outlet]').evaluate(
		/** 局部控件不在这组标准页面壳选择器中。 */ (outlet: HTMLElement): string[] => [outlet, ...outlet.querySelectorAll<HTMLElement>('._pageScrollable')]
			.filter(/** 只检查实际可见的主页面壳。 */ (node: HTMLElement): boolean => node.getBoundingClientRect().height > 0)
			.map(/** 返回布局属性而不是业务内容。 */ (node: HTMLElement): string => getComputedStyle(node).overflowY),
	);
	expect(containers.length).toBeGreaterThan(0);
	expect(containers.every(/** 标准页面根不能抢占主滚动。 */ (overflow: string): boolean => overflow === 'visible')).toBe(true);
}

/** 本用例的 DOM 几何记录，不构造用户或帖子模型。 */
type ScrollGeometry = Readonly<{
	viewportRight: number;
	windowWidth: number;
	horizontalOverflow: number;
	innerGutter: number;
	mainRight: number;
	profileRight: number;
	windowY: number;
	nativeGutter: number;
}>;

test('全宽原生视口消除中间栏滚动条占位并保持吸顶', /** 几何、滚轮与键盘一起证明滚动归属。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openProfile(page);
	await expectSingleMainScroll(page);
	const measurements: ScrollGeometry = await viewport(page).evaluate(/** 测量右缘、横向溢出和文档位置。 */ (host: HTMLElement): ScrollGeometry => {
		const main: HTMLElement = host.querySelector('main')!;
		const profile: HTMLElement = host.querySelector('[data-testid="twitter-profile"]')!;
		return { viewportRight: host.getBoundingClientRect().right, windowWidth: innerWidth, horizontalOverflow: host.scrollWidth - host.clientWidth,
			innerGutter: profile.offsetWidth - profile.clientWidth, mainRight: main.getBoundingClientRect().right, profileRight: profile.getBoundingClientRect().right,
			windowY: scrollY, nativeGutter: host.offsetWidth - host.clientWidth };
	});
	expect(Math.abs(measurements.viewportRight - measurements.windowWidth)).toBeLessThan(1);
	expect(measurements.horizontalOverflow).toBeLessThanOrEqual(1);
	expect(measurements.innerGutter).toBe(0);
	expect(measurements.nativeGutter).toBeGreaterThan(0);
	expect(Math.abs(measurements.mainRight - measurements.profileRight)).toBeLessThanOrEqual(1);
	expect(measurements.windowY).toBe(0);
	await writeFile(info.outputPath('native-scroll-geometry.json'), JSON.stringify(measurements, null, 2));
	await page.screenshot({ path: info.outputPath('profile-top.png'), animations: 'disabled' });
	await page.mouse.move(700, 600);
	await page.mouse.wheel(0, 650);
	await expect.poll(/** 原生滚轮只改变主视口。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(400);
	expect(await page.getByTestId('twitter-profile').evaluate(/** 页面根不再自己滚动。 */ (node: HTMLElement): number => node.scrollTop)).toBe(0);
	const headerTop: number = await page.getByTestId('twitter-profile').locator(':scope > header').evaluate(/** 吸顶头相对主视口。 */ (header: HTMLElement): number => header.getBoundingClientRect().top);
	expect(headerTop).toBeLessThanOrEqual(2);
	expect(headerTop).toBeGreaterThanOrEqual(0);
	await page.screenshot({ path: info.outputPath('profile-scrolled.png'), animations: 'disabled' });
	await viewport(page).focus();
	const before: number = await scrollTop(page);
	await page.keyboard.press('PageDown');
	await expect.poll(/** 主视口支持原生键盘滚动。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(before + 100);
});

test('资料与帖子详情返回后恢复原锚点而不是继承下一页位置', /** 真实回访包含列表重取和异步 DOM 替换。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	const card: Locator = page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').nth(7);
	await card.scrollIntoViewIfNeeded();
	const id: string | null = await card.getAttribute('data-note-id');
	if (id == null) throw new Error('Expected a real note identifier');
	const saved: number = await scrollTop(page);
	const offset: number = await card.evaluate(/** 保存可见节点的位置。 */ (node: HTMLElement): number => node.getBoundingClientRect().top);
	await card.locator(`a[href="/notes/${id}"]`).first().click();
	await expect(page).toHaveURL(new RegExp(`/notes/${id}`));
	await expectSingleMainScroll(page);
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect.poll(/** 真实 users/notes 回填后恢复原位置。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - saved)).toBeLessThan(5);
	await expect.poll(/** 内容锚点也应一致。 */ async (): Promise<number> => Math.abs(await page.locator(`[data-note-id="${id}"]`).first().evaluate((node: HTMLElement): number => node.getBoundingClientRect().top) - offset)).toBeLessThan(5);
});

test('编辑页保留独立滚动位置和未保存输入', /** 多个缓存页共享一个宿主仍分别保存位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openProfile(page);
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await page.getByTestId('profile-name').locator('input').fill('scroll draft');
	await scrollTo(page, 400);
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await expect.poll(/** 返回的是编辑页自己的位置。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - 400)).toBeLessThan(5);
	await expect(page.getByTestId('profile-name').locator('input')).toHaveValue('scroll draft');
	await expectSingleMainScroll(page);
	await page.screenshot({ path: info.outputPath('editor-restored.png'), animations: 'disabled' });
});

test('模态框打开时背景不可滚动并在关闭后恢复交互', /** 不改动共享弹层实现，背景宿主仍可被滚动工具发现。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	await scrollTo(page, 600);
	await page.getByTestId('open-post-form').click();
	await expect(page.getByTestId('post-form-text')).toBeVisible();
	await expect(viewport(page)).toHaveAttribute('inert', '');
	const saved: number = await scrollTop(page);
	await page.mouse.move(40, 400);
	await page.mouse.wheel(0, 600);
	await page.keyboard.press('PageDown');
	expect(await scrollTop(page)).toBe(saved);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('post-form-text')).toHaveCount(0);
	await expect(viewport(page)).not.toHaveAttribute('inert', '');
	await page.mouse.move(700, 600); await page.mouse.wheel(0, 400);
	await expect.poll(/** 弹层关闭后恢复原生滚动。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(saved + 100);
});

test('移动底栏独立于长内容且保留视口右缘滚动', /** 断点消费现有布局状态，不复制前端断点实现。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openProfile(page);
	await scrollTo(page, 700);
	await expectSingleMainScroll(page);
	const bar: Locator = page.getByTestId('twitter-mobile-bar');
	const bottom: number = await bar.evaluate(/** 常驻栏位于窗口底部，不落到页面末尾。 */ (node: HTMLElement): number => node.getBoundingClientRect().bottom);
	expect(bottom).toBe(844);
	await expect(page.getByTestId('open-post-form')).toBeVisible();
	expect(await viewport(page).evaluate(/** 主内容不横向溢出。 */ (node: HTMLElement): number => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('profile-mobile-scrolled.png'), animations: 'disabled' });
});

test('异步回访恢复遇到用户滚动后不再强行拉回旧位置', /** 只延迟真实请求，用户输入可以取消待恢复位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	const card: Locator = page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').nth(7);
	await card.scrollIntoViewIfNeeded();
	await card.locator('a[href^="/notes/"]').first().click();
	const gate: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	await page.route('**/api/users/notes', /** 请求保持真实，只控制回访时序。 */ async (route: Route): Promise<void> => { await gate.promise; await route.continue(); });
	try {
		await page.goBack();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		await page.mouse.move(700, 300); await page.mouse.wheel(0, -2000);
		await expect.poll(/** 用户选择回到顶部。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
		gate.resolve();
		await expect(page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').first()).toBeVisible();
		await expect.poll(/** 内容回来后不强制恢复到之前的中部。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
	} finally { gate.resolve(); }
});

/** 设置测试浏览器已有偏好，使用真实偏好模块，不生成第二套运行时配置。 */
async function setViewPreference(page: Page, key: 'showTitlebar' | 'experimental.stackingRouterView', value: boolean): Promise<void> {
	await page.evaluate(/** 调用现有客户端偏好 API，限定这两个已存在的 UI 选项。 */ async (input: { key: 'showTitlebar' | 'experimental.stackingRouterView'; value: boolean }): Promise<void> => {
		const modulePath: string | undefined = performance.getEntriesByType('resource').map(/** 使用应用实际加载的模块 URL，避免 Vite 时间戳产生第二个单例。 */ (entry: PerformanceEntry): string => entry.name).find(/** 定位原偏好模块而不是自行创建状态。 */ (name: string): boolean => new URL(name).pathname === '/vite/src/preferences.ts');
		if (modulePath == null) throw new Error('Preferences module was not loaded');
		const module: typeof import('../../src/preferences.js') = await import(modulePath);
		module.prefer.commit(input.key, input.value);
	}, { key, value });
}

test('时间线原生分页与新帖排队回顶在带标题栏时保持有效', /** 验证共享组件实际绑定的滚动坐标，而不是仅看条的位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.goto(`${BASE_URL}/?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').first()).toBeVisible();
	await setViewPreference(page, 'showTitlebar', true);
	await expect.poll(/** 标题栏确实进入布局。 */ async (): Promise<number> => viewport(page).evaluate((node: HTMLElement): number => node.getBoundingClientRect().top)).toBeGreaterThan(0);
	expect(await viewport(page).evaluate(/** 局部原点不受应用标题栏影响。 */ (node: HTMLElement): number => node.offsetTop)).toBe(0);
	await expectSingleMainScroll(page);
	await scrollTo(page, 900);
	const created: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text: 'queued while reading older notes' });
	await expect(page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').filter({ hasText: 'queued while reading older notes' })).toHaveCount(0);
	await expect(page.locator('button').filter({ has: page.locator('i.ti-circle-arrow-up') }).first()).toBeAttached();
	await page.getByTestId('twitter-sidebar').getByRole('link', { name: 'Timeline', exact: true }).last().click();
	await expect.poll(/** 主导航重选通过同一宿主回顶。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
	await expect(page.locator(`[data-twitter-route-outlet] [data-note-id="${created.createdNote.id}"]`)).toBeVisible();
	// 滚动到底部触发真实分页，不能只移动一个装饰性的滚动条。
	await viewport(page).evaluate(/** 原生滚动到已加载部分的底部。 */ (node: HTMLElement): void => { node.scrollTop = node.scrollHeight; });
	await expect.poll(/** 列表条目来自下一页真实 API 响应。 */ async (): Promise<number> => page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').count()).toBeGreaterThan(20);
});

test('通知社区搜索和标签页共享主出口且不残留内部滚动', /** 可达主页面按实际路由挂载，不更改其业务数据。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	for (const path of ['/my/notifications', '/channels']) {
		await page.getByTestId('twitter-sidebar').locator(`a[href="${path}"]`).click();
		await expect(page.locator('[data-twitter-route-outlet] ._pageScrollable')).toBeVisible();
		await expectSingleMainScroll(page);
	}
	await page.goto(`${BASE_URL}/search?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet] ._pageScrollable').first()).toBeVisible();
	await expectSingleMainScroll(page);
	await page.goto(`${BASE_URL}/tags/scroll?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet] ._pageScrollable')).toBeVisible();
	await expectSingleMainScroll(page);
});

test('独立页面窗口保留自己的滚动边界且不改变主页面位置', /** 页面窗口是实际存量容器，不受主出口 CSS 或位置表接管。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	await scrollTo(page, 500);
	await page.getByTestId('twitter-profile').locator(':scope > header').click({ button: 'right', position: { x: 220, y: 25 } });
	await page.getByRole('menuitem', { name: /Open in window/ }).click();
	await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toHaveCount(2);
	await page.getByRole('button', { name: 'Edit profile', exact: true }).last().click();
	await expect(page.getByTestId('profile-name')).toBeVisible();
	const inner: Locator = page.locator('._pageScrollable').filter({ has: page.getByTestId('profile-name') });
	expect(await inner.evaluate(/** 窗口内部依然是元素滚动，而非 visible 自然流。 */ (node: HTMLElement): string => getComputedStyle(node).overflowY)).toBe('scroll');
	await inner.evaluate(/** 滚动独立窗口，不应连带主视口。 */ (node: HTMLElement): void => { node.scrollTop = 300; });
	expect(await scrollTop(page)).toBe(500);
});

test('既有叠层偏好不被静默重写且仍可进入退出设置', /** 绝对定位叠层仍是有界容器，不能被普通页面自然高度规则破坏。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	await setViewPreference(page, 'experimental.stackingRouterView', true);
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect(page.locator('[data-twitter-route-outlet]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await expect(page.getByTestId('profile-name')).toBeVisible();
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	expect(await viewport(page).evaluate(/** 叠层兼容边界保持有界，不把背景卡片撑成无限长页面。 */ (node: HTMLElement): string => getComputedStyle(node).overflowY)).toBe('clip');
});
