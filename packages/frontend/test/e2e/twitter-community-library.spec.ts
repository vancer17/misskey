/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：频道资料库的真实后端分页与弹窗布局回归。
 * 作用：验证预读游标、错误恢复、在途重复操作和两种界面的唯一查询消费。
 * 数据链：隔离实例创建真实频道 → 页面查询所有者 → DOM／传输断言；只在故障边界中断或延迟真实响应。
 */
import { devices, expect, test } from '@playwright/test';
import type { APIResponse, Locator, Page, PlaywrightTestArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 仅用于隔离实例的真实管理身份，报告不记录凭据。 */
let admin: RegisteredUser;
/** 浏览器当前用户与其 owned 集合的真实所有者。 */
let viewer: AccountWithToken;
/** 页面异常属于测试失败，不能被成功的尺寸断言掩盖。 */
let pageErrors: string[];

/** 只观察分页协议字段，不保留请求中的认证数据。 */
type OwnedRead = Readonly<Pick<Misskey.Endpoints['channels/owned']['req'], 'limit' | 'untilId'>>;
/** 几何断言必须建立在实际存在的元素上。 */
type ElementBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;
/** 视口取自浏览器公共类型，不另建运行环境模型。 */
type Viewport = NonNullable<ReturnType<Page['viewportSize']>>;

/** 为单个场景创建真实频道；排序与资格仍由后端查询决定。 */
async function createOwnedChannels(count: number): Promise<Misskey.entities.Channel[]> {
	for (let index: number = 0; index < count; index++) {
		await api(BASE_URL, 'channels/create', { i: viewer.token, name: `Owned fixture ${index}`, description: '' });
	}
	return await api(BASE_URL, 'channels/owned', { i: viewer.token, limit: 100 });
}

/** 只持有分页协议观测值，所有实际业务请求继续交给原客户端。 */
function observeOwnedReads(page: Page): OwnedRead[] {
	const reads: OwnedRead[] = [];
	page.on('request', /** 抽取无凭据的协议字段供游标断言。 */ (request: Request): void => {
		if (!request.url().endsWith('/api/channels/owned')) return;
		const body: Misskey.Endpoints['channels/owned']['req'] = request.postDataJSON();
		reads.push({ limit: body.limit, untilId: body.untilId });
	});
	return reads;
}

/** 使用现有会话格式打开真实页面，样式参数只选择存量 UI 入口。 */
async function openChannels(page: Page, viewport: Viewport = { width: 1440, height: 1000 }, ui: 'twitter' | 'default' = 'twitter'): Promise<void> {
	page.on('pageerror', /** 各浏览器上下文统一收集未处理异常。 */ (error: Error): void => { pageErrors.push(error.message); });
	await page.setViewportSize(viewport);
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 持久化真实服务端签发的会话，不替换认证请求。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, viewer);
	await page.goto(`${BASE_URL}/channels?ui=${ui}`);
	if (ui === 'twitter') await expect(page.getByTestId('twitter-communities')).toBeVisible();
}

/** 从现有头部菜单进入 owned 资料库。 */
async function openLibrary(page: Page): Promise<Locator> {
	await page.getByTestId('twitter-community-menu').click();
	await page.getByRole('menuitem', { name: /Owned$/ }).click();
	const library: Locator = page.getByTestId('twitter-community-library');
	await expect(library).toBeVisible();
	return library;
}

/** 等待基础窗口完整关闭后再进行下一次用户操作。 */
async function closeLibrary(page: Page): Promise<void> {
	await page.getByTestId('modal-window-close').click();
	await expect(page.getByTestId('twitter-community-library')).toHaveCount(0);
}

/** 已渲染链接的顺序直接体现查询所有者交付的集合。 */
async function channelLinks(rows: Locator): Promise<string[]> {
	return await rows.evaluateAll(/** 仅读取可见集合标识，不访问 Vue 私有实例。 */ (elements: (HTMLElement | SVGElement)[]): string[] => elements.map(
		/** 每个频道行保留原路由链接语义。 */ (element: HTMLElement | SVGElement): string => element.getAttribute('href') ?? '',
	));
}

/** 读取实际元素盒子，缺失时立即失败。 */
async function box(locator: Locator): Promise<ElementBox> {
	const result: ElementBox | null = await locator.boundingBox();
	expect(result).not.toBeNull();
	return result!;
}

/** 以真实频道主列为横向基准，等待布局更新及入场动效完成后校验安全边界。 */
async function expectColumnCentered(page: Page, library: Locator): Promise<void> {
	const dialog: Locator = library.locator('../..');
	const column: Locator = page.getByTestId('twitter-communities');
	await expect.poll(/** 左右栏宽度不同，不用视口中线代替频道主列中线。 */ async (): Promise<number> => {
		const bounds: ElementBox = await box(dialog);
		const main: ElementBox = await box(column);
		return Math.abs(bounds.x + bounds.width / 2 - main.x - main.width / 2);
	}).toBeLessThanOrEqual(1);
	await expect.poll(/** 内容高度变化后仍围绕可用视口垂直居中。 */ async (): Promise<number> => {
		const bounds: ElementBox = await box(dialog);
		return Math.abs(bounds.y + bounds.height / 2 - (page.viewportSize()?.height ?? 0) / 2);
	}).toBeLessThanOrEqual(1);
	const bounds: ElementBox = await box(dialog);
	const viewport: Viewport = page.viewportSize()!;
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
}

test.beforeEach(/** 测试环境由外部启动，此处只创建隔离场景数据。 */ async (): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'library_admin', 'library-admin-password', true);
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'library_viewer', password: 'library-viewer-password' });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	pageErrors = [];
});

test.afterEach(/** 真实交互不得留下脚本异常。 */ (): void => { expect(pageErrors).toEqual([]); });

for (const count of [0, 4, 10, 11, 20, 31]) {
	test(`${count} 个频道按预读结果分页且无探测性空点击`, /** 每一页都与真实服务端集合及最后展示游标对应。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const channels: Misskey.entities.Channel[] = await createOwnedChannels(count);
		const reads: OwnedRead[] = observeOwnedReads(page);
		await openChannels(page);
		expect(reads).toHaveLength(0);
		const firstRead: Promise<Response> = page.waitForResponse(/** 零条也必须由真实成功回执确认，不能把传输错误当作空集合。 */ (response: Response): boolean => response.url().endsWith('/api/channels/owned') && response.status() === 200);
		const library: Locator = await openLibrary(page);
		await firstRead;
		const rows: Locator = library.getByTestId('twitter-community-library-row');
		let shown: number = Math.min(count, 10);
		await expect(rows).toHaveCount(shown);
		await expect(library.getByTestId('twitter-community-library-loading')).toHaveCount(0);
		expect(reads).toEqual([{ limit: 11, untilId: undefined }]);
		while (shown < count) {
			const cursor: string = channels[shown - 1].id;
			await library.getByTestId('twitter-community-library-more').click();
			shown = Math.min(shown + 10, count);
			await expect(rows).toHaveCount(shown);
			expect(reads.at(-1)).toEqual({ limit: 11, untilId: cursor });
		}
		await expect(library.getByTestId('twitter-community-library-more')).toHaveCount(0);
		await expect(library.getByTestId('twitter-community-library-end')).toHaveCount(count === 0 ? 0 : 1);
		if (count === 0) await expectColumnCentered(page, library);
		await expect(library.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
		expect(await channelLinks(rows)).toEqual(channels.map(/** 服务端顺序是最终集合的比较基准。 */ (channel: Misskey.entities.Channel): string => `/channels/${channel.id}`));
		expect(reads).toHaveLength(Math.max(1, Math.ceil(count / 10)));
		await closeLibrary(page);
		const reopened: Locator = await openLibrary(page);
		await expect(reopened.getByTestId('twitter-community-library-row')).toHaveCount(count);
		await expect(reopened.getByTestId('twitter-community-library-more')).toHaveCount(0);
		expect(reads).toHaveLength(Math.max(1, Math.ceil(count / 10)));
	});
}

test('追加传输失败保留列表和游标，重试读取真实剩余频道', /** 故障只发生于传输边界，成功恢复不能使用伪造集合。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channels: Misskey.entities.Channel[] = await createOwnedChannels(11);
	const reads: OwnedRead[] = observeOwnedReads(page);
	let failed: boolean = false;
	await page.route('**/api/channels/owned', /** 只中断第一次有游标的请求。 */ async (route: Route): Promise<void> => {
		const body: Misskey.Endpoints['channels/owned']['req'] = route.request().postDataJSON();
		if (body.untilId != null && !failed) {
			failed = true;
			await route.abort();
			return;
		}
		await route.continue();
	});
	await openChannels(page);
	const library: Locator = await openLibrary(page);
	const rows: Locator = library.getByTestId('twitter-community-library-row');
	await expect(rows).toHaveCount(10);
	const before: string[] = await channelLinks(rows);
	await library.getByTestId('twitter-community-library-more').click();
	await expect(library.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
	expect(await channelLinks(rows)).toEqual(before);
	await expect(library.getByTestId('twitter-community-library-end')).toHaveCount(0);
	await library.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(rows).toHaveCount(11);
	await expect(library.getByTestId('twitter-community-library-end')).toBeVisible();
	expect(reads).toEqual([
		{ limit: 11, untilId: undefined },
		{ limit: 11, untilId: channels[9].id },
		{ limit: 11, untilId: channels[9].id },
	]);
});

test('快速重复追加只发一次请求，在途列表保持可见', /** 同一事件循环双击覆盖按钮禁用渲染前的动作守卫。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await createOwnedChannels(11);
	const reads: OwnedRead[] = observeOwnedReads(page);
	let release: () => void = /** 请求建立前不需要释放。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 暂存真实响应，制造确定的在途窗口。 */ (resolve: () => void): void => { release = resolve; });
	let captured: () => void = /** 尚未收到真实响应。 */ (): void => {};
	const started: Promise<void> = new Promise<void>(/** 真实后端已完成读取后通知测试。 */ (resolve: () => void): void => { captured = resolve; });
	await page.route('**/api/channels/owned', /** 首拉正常通过，仅延迟追加的真实响应。 */ async (route: Route): Promise<void> => {
		const body: Misskey.Endpoints['channels/owned']['req'] = route.request().postDataJSON();
		if (body.untilId == null) { await route.continue(); return; }
		const response: APIResponse = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await openChannels(page);
		const library: Locator = await openLibrary(page);
		const rows: Locator = library.getByTestId('twitter-community-library-row');
		await expect(rows).toHaveCount(10);
		const more: Locator = library.getByTestId('twitter-community-library-more');
		await more.evaluate(/** 原生点击连续提交真实用户意图，不触碰查询对象。 */ (element: HTMLElement | SVGElement): void => {
			if (!(element instanceof HTMLButtonElement)) throw new Error('Expected the library load-more button');
			element.click();
			element.click();
		});
		await started;
		await expect(more).toBeDisabled();
		await expect(rows).toHaveCount(10);
		expect(reads).toHaveLength(2);
		await closeLibrary(page);
		const reopened: Locator = await openLibrary(page);
		await expect(reopened.getByTestId('twitter-community-library-row')).toHaveCount(10);
		await expect(reopened.getByTestId('twitter-community-library-more')).toBeDisabled();
		expect(reads).toHaveLength(2);
		release();
		await expect(rows).toHaveCount(11);
		await expect(library.getByTestId('twitter-community-library-end')).toBeVisible();
		expect(reads).toHaveLength(2);
	} finally { release(); }
});

test('追加在途期间离页写入，回访等待追加后刷新首屏', /** 真实导航触发既有刷新调度，旧追加完成后不能吞掉新的回访意图。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channels: Misskey.entities.Channel[] = await createOwnedChannels(20);
	const reads: OwnedRead[] = observeOwnedReads(page);
	let release: () => void = /** 追加请求尚未建立。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 暂存写入前真实生成的追加响应。 */ (resolve: () => void): void => { release = resolve; });
	let captured: () => void = /** 真实旧响应尚未生成。 */ (): void => {};
	const started: Promise<void> = new Promise<void>(/** 保证新频道创建发生在旧追加结果生成之后。 */ (resolve: () => void): void => { captured = resolve; });
	await page.route('**/api/channels/owned', /** 首屏与刷新正常通过，仅延迟已有游标的实际结果。 */ async (route: Route): Promise<void> => {
		const body: Misskey.Endpoints['channels/owned']['req'] = route.request().postDataJSON();
		if (body.untilId == null) { await route.continue(); return; }
		const response: APIResponse = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await openChannels(page);
		let library: Locator = await openLibrary(page);
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(10);
		await library.getByTestId('twitter-community-library-more').click();
		await started;
		await closeLibrary(page);
		await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
		await expect(page).toHaveURL(/\/my\/notifications/);
		const created: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: viewer.token, name: 'Owned created while append pending', description: '' });
		const firstPage: Misskey.entities.Channel[] = await api(BASE_URL, 'channels/owned', { i: viewer.token, limit: 10 });
		await page.goBack();
		library = await openLibrary(page);
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(10);
		await expect(library.getByTestId('twitter-community-library-more')).toBeDisabled();
		expect(reads).toHaveLength(2);
		release();
		await expect(library.locator(`a[href="/channels/${created.id}"]`)).toBeVisible();
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(10);
		await expect(library.getByTestId('twitter-community-library-more')).toBeEnabled();
		expect(await channelLinks(library.getByTestId('twitter-community-library-row'))).toEqual(firstPage.map(
			/** 回访后的集合必须等于新首屏，不能混入旧追加页。 */ (channel: Misskey.entities.Channel): string => `/channels/${channel.id}`,
		));
		expect(reads).toEqual([
			{ limit: 11, untilId: undefined },
			{ limit: 11, untilId: channels[9].id },
			{ limit: 11, untilId: undefined },
		]);
	} finally { release(); }
});

test('首拉失败关闭重开保留错误，显式重试才重新请求', /** 未初始化与失败是不同事实，重开窗口不能隐式建立新集合。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await createOwnedChannels(4);
	const reads: OwnedRead[] = observeOwnedReads(page);
	let failed: boolean = false;
	let release: () => void = /** 首拉尚未进入传输层。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 暂留首拉以验证紧凑加载态，然后再注入传输故障。 */ (resolve: () => void): void => { release = resolve; });
	await page.route('**/api/channels/owned', /** 一次首拉传输故障后恢复真实接口。 */ async (route: Route): Promise<void> => {
		if (!failed) { failed = true; await gate; await route.abort(); return; }
		await route.continue();
	});
	try {
		await openChannels(page);
		let library: Locator = await openLibrary(page);
		await expect(library.getByTestId('twitter-community-library-loading')).toBeVisible();
		await expectColumnCentered(page, library);
		expect((await box(library.locator('../..'))).height).toBeLessThan(500);
		release();
		await expect(library.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
		await expectColumnCentered(page, library);
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(0);
		await expect(library.getByTestId('twitter-community-library-end')).toHaveCount(0);
		expect((await box(library.locator('../..'))).height).toBeLessThan(500);
		await closeLibrary(page);
		library = await openLibrary(page);
		await expect(library.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
		expect(reads).toHaveLength(1);
		await library.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(4);
		await expectColumnCentered(page, library);
		await expect(library.getByTestId('twitter-community-library-end')).toBeVisible();
		expect(reads).toHaveLength(2);
	} finally { release(); }
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`${colorScheme} 桌面四条频道按内容收敛且表面连续`, /** 短列表不继承原固定高度，也不产生另一块背景尾部。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
		await page.emulateMedia({ colorScheme });
		await createOwnedChannels(4);
		await openChannels(page);
		await expect(page.locator('html')).toHaveAttribute('data-color-scheme', colorScheme);
		const library: Locator = await openLibrary(page);
		const rows: Locator = library.getByTestId('twitter-community-library-row');
		await expect(rows).toHaveCount(4);
		await expectColumnCentered(page, library);
		for (let index: number = 0; index < 4; index++) await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
		const end: Locator = library.getByTestId('twitter-community-library-end');
		await expect(end).toBeInViewport({ ratio: 1 });
		const windowBox: ElementBox = await box(library.locator('../..'));
		const endBox: ElementBox = await box(end);
		const bottomGap: number = windowBox.y + windowBox.height - endBox.y - endBox.height;
		expect(windowBox.height).toBeLessThan(650);
		expect(bottomGap).toBeGreaterThanOrEqual(-1);
		expect(bottomGap).toBeLessThanOrEqual(24);
		const surfacesMatch: boolean = await library.evaluate(/** 比较业务表面与基础窗口主体的最终主题色。 */ (element: HTMLElement | SVGElement): boolean =>
			element.parentElement != null && getComputedStyle(element).backgroundColor === getComputedStyle(element.parentElement).backgroundColor);
		expect(surfacesMatch).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`owned-four-${colorScheme}.png`), animations: 'disabled' });
		await page.keyboard.press('Escape');
		await expect(library).toHaveCount(0);
		await expect(page.getByTestId('twitter-community-menu')).toBeEnabled();
	});
}

test('我的频道随主列布局变化居中，关闭与重开释放旧定位', /** 真实窗口覆盖三栏、两栏、窄桌面与同宽位置变化，定位只影响本次管理窗口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	const channels: Misskey.entities.Channel[] = await createOwnedChannels(4);
	await api(BASE_URL, 'notes/create', { i: viewer.token, channelId: channels[0].id, text: 'Column scroll fixture\n'.repeat(80) });
	await openChannels(page, { width: 1657, height: 1000 });
	let library: Locator = await openLibrary(page);
	await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(4);
	await expectColumnCentered(page, library);
	const widths: readonly number[] = [900, 501, 1440];
	for (let index: number = 0; index < widths.length; index++) {
		const width: number = widths[index];
		await page.setViewportSize({ width, height: 1000 });
		await expectColumnCentered(page, library);
	}
	const originalColumn: ElementBox = await box(page.getByTestId('twitter-communities'));
	await page.getByTestId('twitter-communities').evaluate(/** 模拟同宽过渡位移，验证结束帧也被观察而非只依赖元素尺寸。 */ (element: HTMLElement | SVGElement): void => {
		element.style.position = 'relative';
		element.style.left = '0px';
		element.style.transition = 'left 120ms linear';
		element.getBoundingClientRect();
		element.style.left = '12px';
	});
	await expect.poll(/** 确认布局实际完成移动，避免起始帧仍居中造成误通过。 */ async (): Promise<number> =>
		(await box(page.getByTestId('twitter-communities'))).x - originalColumn.x).toBeGreaterThanOrEqual(11.9);
	await expectColumnCentered(page, library);
	await page.getByTestId('twitter-communities').evaluate(/** 恢复真实页面几何后继续验证。 */ (element: HTMLElement | SVGElement): void => {
		element.style.removeProperty('position');
		element.style.removeProperty('left');
		element.style.removeProperty('transition');
	});
	await expectColumnCentered(page, library);
	await page.screenshot({ path: testInfo.outputPath('owned-main-column-centered.png'), animations: 'disabled' });
	await page.mouse.click(8, 8);
	await expect(library).toHaveCount(0);
	await page.setViewportSize({ width: 1657, height: 1000 });
	await page.getByTestId('twitter-communities').getByRole('tab', { name: 'Explore', exact: true }).click();
	await expect(page.getByTestId('twitter-note')).toHaveCount(1);
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 滚动后的主列只提供水平坐标，不以长内容中线决定弹窗纵向位置。 */ (element: HTMLElement | SVGElement): void => {
		element.scrollTo({ top: 500, behavior: 'instant' });
	});
	await expect.poll(/** 确认测试确实发生页面滚动。 */ (): Promise<number> => page.getByTestId('twitter-scroll-viewport').evaluate(
		/** 读取真实滚动宿主而不是 window.scrollY。 */ (element: HTMLElement | SVGElement): number => element.scrollTop,
	)).toBeGreaterThan(0);
	library = await openLibrary(page);
	await expectColumnCentered(page, library);
	await closeLibrary(page);
});

test('长列表限制桌面窗口高度，矮视口仍在主体内滚动', /** 上限约束保留标题和关闭入口，内容增长不撑破覆盖层。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
	await createOwnedChannels(20);
	await openChannels(page);
	const library: Locator = await openLibrary(page);
	await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(10);
	const dialog: Locator = library.locator('../..');
	const body: Locator = library.locator('..');
	await expect.poll(/** 等待入场过渡完成后确认长内容使用既有高度上限。 */ async (): Promise<number> => Math.round((await box(dialog)).height)).toBe(650);
	await expectColumnCentered(page, library);
	await library.getByTestId('twitter-community-library-more').click();
	await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(20);
	await expectColumnCentered(page, library);
	await page.setViewportSize({ width: 1440, height: 480 });
	await expectColumnCentered(page, library);
	const bounds: ElementBox = await box(dialog);
	expect(bounds.y).toBeGreaterThanOrEqual(0);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
	expect(bounds.height).toBeLessThanOrEqual(416);
	const internalOverflow: boolean = await body.evaluate(/** 几何证明滚动归属于窗口主体。 */ (element: HTMLElement | SVGElement): boolean => element.scrollHeight > element.clientHeight);
	expect(internalOverflow).toBe(true);
	await expect(page.getByTestId('modal-window-close')).toBeInViewport({ ratio: 1 });
	await page.screenshot({ path: testInfo.outputPath('owned-long-short-viewport.png'), animations: 'disabled' });
	await closeLibrary(page);
});

test.describe('真实移动设备抽屉', /** 手机身份使用现有基础窗口的 drawer 分支。 */ (): void => {
	test.use({
		userAgent: devices['iPhone 13'].userAgent,
		isMobile: devices['iPhone 13'].isMobile,
		hasTouch: devices['iPhone 13'].hasTouch,
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 1,
	});
	test('内容模式保持抽屉宽度、高度及关闭重开行为', /** 内容收敛仅影响桌面 dialog，移动尺寸规则不变。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
		await createOwnedChannels(4);
		await openChannels(page, { width: 390, height: 844 });
		const library: Locator = await openLibrary(page);
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(4);
		const drawer: Locator = library.locator('../..');
		await expect.poll(/** 抽屉完成入场过渡后宽度铺满视口。 */ async (): Promise<number> => Math.round((await box(drawer)).width)).toBe(390);
		await expect.poll(/** 抽屉底部沿用现有安全区与覆盖层定位。 */ async (): Promise<number> => {
			const bounds: ElementBox = await box(drawer);
			return Math.round(bounds.y + bounds.height);
		}).toBe(844);
		expect(Math.round((await box(drawer)).height)).toBe(814);
		await page.screenshot({ path: testInfo.outputPath('owned-mobile-drawer.png'), animations: 'disabled' });
		await closeLibrary(page);
		await expect((await openLibrary(page)).getByTestId('twitter-community-library-row')).toHaveCount(4);
	});
});

test('原界面 owned 标签也使用同一预读分页语义', /** 存量消费者不能继续维护另一套 owned 分页器。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const channels: Misskey.entities.Channel[] = await createOwnedChannels(11);
	const reads: OwnedRead[] = observeOwnedReads(page);
	await openChannels(page, { width: 1440, height: 1000 }, 'default');
	await page.getByRole('button', { name: /Owned$/ }).click();
	const owned: Locator = page.getByTestId('owned-channels');
	const rows: Locator = owned.locator('a[href^="/channels/"]:not([href="/channels/new"])');
	await expect(rows).toHaveCount(10);
	const more: Locator = owned.getByTestId('owned-channels-more');
	await more.focus();
	await expect(more).toBeFocused();
	await more.press('Enter');
	await expect(rows).toHaveCount(11);
	await expect(owned.getByTestId('owned-channels-more')).toHaveCount(0);
	await expect.poll(/** 原界面末页同样保留集合内焦点，不让按钮卸载将焦点退回页面主体。 */ (): Promise<boolean> => owned.evaluate(
		/** 焦点必须仍由当前 owned 内容范围承接。 */ (element: HTMLElement | SVGElement): boolean => element.contains(document.activeElement),
	)).toBe(true);
	expect(reads).toEqual([{ limit: 11, untilId: undefined }, { limit: 11, untilId: channels[9].id }]);
	expect(await channelLinks(rows)).toEqual(channels.map(/** 原界面展示同一服务端集合，不复制实体类型。 */ (channel: Misskey.entities.Channel): string => `/channels/${channel.id}`));
});

test('键盘加载最后一页后焦点留在弹窗内且关闭恢复页面', /** 按钮禁用和耗尽卸载不能让键盘焦点脱离当前模态。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await createOwnedChannels(11);
	await openChannels(page);
	const library: Locator = await openLibrary(page);
	await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(10);
	const dialog: Locator = library.locator('../..');
	const more: Locator = library.getByTestId('twitter-community-library-more');
	await more.focus();
	await expect(more).toBeFocused();
	await more.press('Enter');
	await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(11);
	await expect(library.getByTestId('twitter-community-library-end')).toBeVisible();
	await expect.poll(/** 最后一页完成后读取真实焦点归属，不主动替实现补焦点。 */ (): Promise<boolean> => dialog.evaluate(
		/** 模态范围包括标题控制及正文交互。 */ (element: HTMLElement | SVGElement): boolean => element.contains(document.activeElement),
	)).toBe(true);
	await page.keyboard.press('Tab');
	const focusIsUsable: boolean = await dialog.evaluate(/** Tab 应进入当前模态内仍能交互的元素。 */ (element: HTMLElement | SVGElement): boolean => {
		const focused: Element | null = document.activeElement;
		return focused instanceof HTMLElement
			&& element.contains(focused)
			&& !focused.matches(':disabled')
			&& focused.matches('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
	});
	expect(focusIsUsable).toBe(true);
	await expect(page.locator(':focus')).toBeVisible();
	await expect(page.getByTestId('modal-window-close')).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(library.getByTestId('twitter-community-library-row').last()).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.getByTestId('modal-window-close')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(library).toHaveCount(0);
	const root: Locator = page.getByTestId('twitter-communities');
	expect(await root.evaluate(/** 原页面在窗口退出后不能继续处于 inert 祖先下。 */ (element: HTMLElement | SVGElement): boolean => element.closest('[inert]') == null)).toBe(true);
	const menu: Locator = page.getByTestId('twitter-community-menu');
	await menu.focus();
	await menu.press('Enter');
	await expect(page.getByRole('menuitem', { name: /Owned$/ })).toBeVisible();
});

test('既有Drive选择窗口保持默认固定高度且关闭后继续编辑', /** 频道弹窗的内容模式不得改变未启用该能力的现存基础窗口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openChannels(page);
	const library: Locator = await openLibrary(page);
	await library.getByTestId('twitter-community-library-create').click();
	await expect(page).toHaveURL(/\/channels\/new/);
	await expect(library).toHaveCount(0);
	const editor: Locator = page.locator('._pageContainer');
	await editor.getByRole('button', { name: /Set banner/i }).click();
	await page.getByRole('menuitem', { name: /From Drive/i }).click();
	const close: Locator = page.getByTestId('modal-window-close');
	await expect(close).toBeVisible();
	const dialog: Locator = close.locator('../..');
	await expect.poll(/** 等待既有Drive窗口入场过渡后核查固定高度。 */ async (): Promise<number> => Math.round((await box(dialog)).height)).toBe(500);
	expect(Math.round((await box(dialog)).width)).toBe(800);
	const body: Locator = dialog.locator(':scope > div').nth(1);
	expect(await body.evaluate(/** 默认模式仍保留块向尺寸容器隔离。 */ (element: HTMLElement | SVGElement): string => getComputedStyle(element).containerType)).toBe('size');
	await close.click();
	await expect(close).toHaveCount(0);
	const name: Locator = editor.locator('input').first();
	await name.fill('Editable after closing Drive');
	await expect(name).toHaveValue('Editable after closing Drive');
});

test('慢追加禁用按钮时承接焦点，完成后不抢回用户已移动的焦点', /** 真实在途窗口覆盖原生 disabled 导致失焦以及完成回调抢焦点的风险。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await createOwnedChannels(11);
	let release: () => void = /** 追加尚未建立时无需释放。 */ (): void => {};
	const gate: Promise<void> = new Promise<void>(/** 延迟真实追加响应以保持按钮禁用状态。 */ (resolve: () => void): void => { release = resolve; });
	let captured: () => void = /** 实际追加结果尚未生成。 */ (): void => {};
	const started: Promise<void> = new Promise<void>(/** 后端已返回真实追加结果时通知测试检查在途焦点。 */ (resolve: () => void): void => { captured = resolve; });
	await page.route('**/api/channels/owned', /** 仅延迟真实追加结果，首拉继续通过现有客户端请求。 */ async (route: Route): Promise<void> => {
		const body: Misskey.Endpoints['channels/owned']['req'] = route.request().postDataJSON();
		if (body.untilId == null) { await route.continue(); return; }
		const response: APIResponse = await route.fetch();
		captured();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await openChannels(page);
		const library: Locator = await openLibrary(page);
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(10);
		const dialog: Locator = library.locator('../..');
		const more: Locator = library.getByTestId('twitter-community-library-more');
		await more.focus();
		await expect(more).toBeFocused();
		await more.press('Enter');
		await started;
		await expect(more).toBeDisabled();
		await expect.poll(/** 检查禁用期间的实际焦点，不由测试主动修复。 */ (): Promise<boolean> => dialog.evaluate(
			/** 稳定加载状态或其它模态元素应接住原按钮焦点。 */ (element: HTMLElement | SVGElement): boolean => element.contains(document.activeElement),
		)).toBe(true);
		await page.keyboard.press('Tab');
		const close: Locator = page.getByTestId('modal-window-close');
		await expect(close).toBeFocused();
		release();
		await expect(library.getByTestId('twitter-community-library-row')).toHaveCount(11);
		await expect(library.getByTestId('twitter-community-library-end')).toBeVisible();
		await expect(close).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(library).toHaveCount(0);
	} finally { release(); }
});
