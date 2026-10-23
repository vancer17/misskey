/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 成就页的真实后端浏览器回归。
 * 作用：验证通知入口、既有成就目录、隐藏申领、停留计时、页面回访及响应式表现。
 * 数据链：隔离实例真实账号／成就／通知 → 页面导航与原组件交互 → 服务端事实和浏览器可见结果。
 * 测试仅推进浏览器时钟和操作真实接口，不伪造 API 响应，也不读取开发账户。
 */
import { test, expect } from '@playwright/test';
import type { Locator, Page, PlaywrightTestArgs, Response, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 成就名称直接派生自真实申领接口，不在测试中复制目录枚举。 */
type AchievementName = Misskey.Endpoints['i/claim-achievement']['req']['name'];
/** 几何读数只用于检查浏览器布局，不持有业务事实。 */
type ElementBox = Readonly<{ x: number; y: number; width: number; height: number }>;
/** 仅当前隔离场景使用的真实账户凭据，不写入报告。 */
let account: AccountWithToken;
/** 从启动首帧开始收集执行异常，不屏蔽页面错误。 */
let errors: string[];

test.beforeEach(/** 每个场景只重置固定端口的隔离测试实例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'achievement_admin', 'achievement-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'achievement_user', password: 'achievement-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	errors = [];
	page.on('pageerror', /** 仅保留异常消息，避免将请求凭据写入产物。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(/** 导航与交互不得产生未处理的脚本异常。 */ (): void => { expect(errors).toEqual([]); });

/** 真实申领同时产生后端成就事实及对应通知。 */
async function claim(name: AchievementName): Promise<void> {
	await api(BASE_URL, 'i/claim-achievement', { i: account.token, name });
}

/** 读取服务端权威成就事实，独立于客户端缓存与渲染时序。 */
async function earned(): Promise<Misskey.entities.UsersAchievementsResponse> {
	return await api(BASE_URL, 'users/achievements', { userId: account.id });
}

/** 原请求体仅用于匹配协议名称，先收窄未知 JSON，再判断真实回执。 */
function isClaimResponse(response: Response, name: AchievementName): boolean {
	if (!response.url().endsWith('/api/i/claim-achievement') || !response.ok()) return false;
	const body: unknown = response.request().postDataJSON();
	return typeof body === 'object' && body != null && 'name' in body && body.name === name;
}

/** 使用刚从后端取得的会话启动前端，避免过期成就字段影响客户端去重。 */
async function seedSession(page: Page): Promise<void> {
	const session: AccountWithToken = { ...await api(BASE_URL, 'i', { i: account.token }), token: account.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 遵循既有账户持久化协议，认证仍由真实启动链处理。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, session);
}

/** 只执行首次整页导航，后续跨页使用原链接或浏览器历史。 */
async function openAchievements(page: Page): Promise<Locator> {
	await seedSession(page);
	await page.goto(`${BASE_URL}/my/achievements?ui=twitter`);
	const shell: Locator = page.getByTestId('twitter-achievements');
	await expect(shell).toBeVisible();
	await expect(shell.locator('[data-achievement-name]').first()).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	return shell;
}

/** 选择既有成就条目，锁定与解锁共用服务端定义的名称。 */
function achievement(page: Page, name: AchievementName): Locator {
	return page.getByTestId('achievements').locator(`[data-achievement-name="${name}"]`);
}

/** 只读取实际主滚动宿主，避免将窗口滚动位置误作主列位置。 */
async function scrollTop(page: Page): Promise<number> {
	return page.getByTestId('twitter-scroll-viewport').evaluate(/** 原生宿主位置是页面恢复的观测值。 */ (element: HTMLElement): number => element.scrollTop);
}

/** 原生滚动操作只改变 UI 位置，不改写业务或路由状态。 */
async function scrollTo(page: Page, top: number): Promise<void> {
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 使用真实滚动 API 进入目录中部。 */ (element: HTMLElement, position: number): void => { element.scrollTo({ top: position, behavior: 'instant' }); }, top);
	await expect.poll(/** 等待浏览器提交位置后再执行路由操作。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - top)).toBeLessThan(2);
}

/** 读取实际渲染盒子，缺失时直接报告断言对象未挂载。 */
async function box(locator: Locator): Promise<ElementBox> {
	const result: ElementBox | null = await locator.boundingBox();
	expect(result).not.toBeNull();
	return result!;
}

test('成就通知点击与 Enter 均进入 Twitter 成就页并呈现真实目录', /** 入口、字段和既有目录顺序共同验证，而不只检查 URL。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	// 故意逆序申领，目录不得退化为申领时间倒序。
	await claim('markedAsCat');
	await claim('login3');
	await claim('notes1');
	const source: Misskey.entities.UsersAchievementsResponse = await earned();
	await seedSession(page);
	await page.goto(`${BASE_URL}/my/notifications?ui=twitter`);
	const notification: Locator = page.locator('a[data-notification-type="achievementEarned"]').filter({ hasText: 'just setting up my msky' });
	await expect(notification).toHaveAttribute('href', '/my/achievements');
	await notification.click();
	await expect(page).toHaveURL(`${BASE_URL}/my/achievements`);
	await expect(page.getByTestId('twitter-achievements')).toBeVisible();
	const names: string[] = await page.getByTestId('achievements').locator('[data-achievement-locked="false"]').evaluateAll(
		/** 读出可见条目顺序，不从响应构造第二套展示集合。 */ (elements: HTMLElement[]): string[] => elements.map(
			/** 名称只作为稳定身份读取。 */ (element: HTMLElement): string => element.dataset.achievementName ?? '',
		),
	);
	expect(names).toEqual(['notes1', 'login3', 'markedAsCat']);
	const note: Locator = achievement(page, 'notes1');
	await expect(note.getByTestId('achievement-title')).toHaveText('just setting up my msky');
	await expect(note.getByTestId('achievement-description')).toHaveText('Post your first note');
	const unlocked: Misskey.entities.UsersAchievementsResponse[number] | undefined = source.find(/** 日期必须来自本场景真实服务端事实。 */ (item: Misskey.entities.UsersAchievementsResponse[number]): boolean => item.name === 'notes1');
	expect(unlocked).toBeDefined();
	const date: string = await page.evaluate(/** 日期遵循原组件的浏览器本地时区格式。 */ (timestamp: number): string => {
		const value: Date = new Date(timestamp);
		return `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()}`;
	}, unlocked!.unlockedAt);
	await expect(note.getByTestId('achievement-time')).toHaveText(date);
	await page.getByTestId('twitter-achievements-header').getByRole('button').click();
	await expect(page).toHaveURL(/\/my\/notifications/);
	await notification.focus();
	await notification.press('Enter');
	await expect(page.getByTestId('twitter-achievements')).toBeVisible();
	await expect(note).toHaveAttribute('data-achievement-locked', 'false');
});

test('直接访问刷新及历史回访保持页面可用并恢复主列位置', /** 验证缓存页面与当前主滚动所有者协调，不只证明 Shell 仍存在。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await claim('notes1');
	const shell: Locator = await openAchievements(page);
	await page.reload();
	await expect(shell).toBeVisible();
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await scrollTo(page, 600);
	await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
	await expect(page).toHaveURL(/\/my\/notifications/);
	await page.goBack();
	await expect(shell).toBeVisible();
	await expect.poll(/** 缓存回访应恢复该成就页自己的原生位置。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - 600)).toBeLessThan(5);
	await expect(achievement(page, 'notes1')).toHaveAttribute('data-achievement-locked', 'false');
});

test('锁定占位的隐藏点击成就成功后直接更新当前条目', /** 同时核对真实申领与当前页面，不靠整页刷新补齐展示。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openAchievements(page);
	const locked: Locator = achievement(page, 'clickedClickHere');
	await expect(locked).toHaveAttribute('data-achievement-locked', 'true');
	await expect(locked.getByTestId('achievement-title')).toHaveText('???');
	await expect(locked.getByTestId('achievement-description')).toHaveText('???');
	const claimed: Promise<Response> = page.waitForResponse(/** 只等待该隐藏成就的真实写入回执。 */ (response: Response): boolean => isClaimResponse(response, 'clickedClickHere'));
	await locked.click();
	await claimed;
	await expect.poll(/** 独立核对服务端事实，避免只证明客户端自行解锁。 */ async (): Promise<number> => (await earned()).filter(
		/** 后端应只保留一条已申领记录。 */ (item: Misskey.entities.UsersAchievementsResponse[number]): boolean => item.name === 'clickedClickHere',
	).length).toBe(1);
	await expect(achievement(page, 'clickedClickHere')).toHaveAttribute('data-achievement-locked', 'false');
	await expect(achievement(page, 'clickedClickHere').getByTestId('achievement-title')).toHaveText('Click here');
});

test('三分钟申领计时在离页后清理并在回访后重新计时', /** 仅推进浏览器时间，真实申领请求及后端存储保持完整。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await seedSession(page);
	await page.clock.install();
	await page.goto(`${BASE_URL}/my/achievements?ui=twitter`);
	await expect(page.getByTestId('twitter-achievements')).toBeVisible();
	await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'true');
	await page.clock.fastForward(170_000);
	await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
	await expect(page).toHaveURL(/\/my\/notifications/);
	await page.clock.fastForward(20_000);
	expect((await earned()).some(/** 离页跨过原截止时间后，成就仍未申领。 */ (item: Misskey.entities.UsersAchievementsResponse[number]): boolean => item.name === 'viewAchievements3min')).toBe(false);
	await page.goBack();
	await expect(page.getByTestId('twitter-achievements')).toBeVisible();
	await page.clock.fastForward(179_000);
	expect((await earned()).some(/** 回访需要新的完整停留时间，不能沿用离页前剩余秒数。 */ (item: Misskey.entities.UsersAchievementsResponse[number]): boolean => item.name === 'viewAchievements3min')).toBe(false);
	const claimed: Promise<Response> = page.waitForResponse(/** 服务端成功回执证明原计时动作仍能申领。 */ (response: Response): boolean => isClaimResponse(response, 'viewAchievements3min'));
	await page.clock.fastForward(2_000);
	await page.clock.runFor(1_000);
	await claimed;
	expect((await earned()).some(/** 最终结果来自真实服务端，而非客户端目录副本。 */ (item: Misskey.entities.UsersAchievementsResponse[number]): boolean => item.name === 'viewAchievements3min')).toBe(true);
	await expect(achievement(page, 'viewAchievements3min')).toHaveAttribute('data-achievement-locked', 'false');
});

test('默认界面的本人成就与其他用户展示保留原组件语义', /** Twitter 变体不能改变默认网格、锁定目录或其他用户的隐藏说明。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await claim('notes1');
	await seedSession(page);
	await page.goto(`${BASE_URL}/my/achievements`);
	await expect(page.getByTestId('achievements')).toBeVisible();
	await expect(page.getByTestId('twitter-root')).toHaveCount(0);
	await expect(page.getByTestId('twitter-achievements')).toHaveCount(0);
	await expect(achievement(page, 'notes1').getByTestId('achievement-description')).toHaveText('Post your first note');
	await expect(achievement(page, 'notes10')).toHaveAttribute('data-achievement-locked', 'true');
	const ownRow: ElementBox = await box(achievement(page, 'notes1'));
	expect(ownRow.width).toBeLessThanOrEqual(381);
	await page.evaluate(/** 退出测试浏览器会话，后端账号与已申领成就事实保持不变。 */ (): void => { localStorage.removeItem('account'); });
	await page.goto(`${BASE_URL}/@${account.username}/achievements`);
	await expect(achievement(page, 'notes1')).toBeVisible();
	await expect(achievement(page, 'notes1').getByTestId('achievement-description')).toHaveText('???');
	await expect(page.getByTestId('achievements').locator('[data-achievement-locked="true"]')).toHaveCount(0);
	await expect(page.getByTestId('twitter-achievements')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
	test(`${scheme} 主题在桌面及 390/320px 保持紧凑单列且无横向溢出`, /** 使用实际主题、字体和徽章检查新表现，截图供视觉审阅。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, testInfo: TestInfo): Promise<void> => {
		await claim('notes1');
		await claim('login3');
		await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
		const shell: Locator = await openAchievements(page);
		await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme);
		await page.evaluate(/** 等待真实字体完成排版后再读取几何。 */ async (): Promise<void> => { await document.fonts.ready; });
		await expect.poll(/** 真实徽章资源完成解码后再采集截图。 */ (): Promise<boolean> => shell.locator('img').evaluateAll(
			/** 锁定占位不含图片，只检查实际存在的成就资源。 */ (images: HTMLImageElement[]): boolean => images.every(
				/** 加载成功必须同时有解码尺寸。 */ (image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0,
			),
		)).toBe(true);
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			const first: ElementBox = await box(achievement(page, 'notes1'));
			const second: ElementBox = await box(achievement(page, 'login3'));
			const container: ElementBox = await box(shell);
			expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(first.width - container.width)).toBeLessThanOrEqual(1);
			expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
			const overflow: number = await page.evaluate(/** 目录换行不能撑宽页面根节点。 */ (): number => document.documentElement.scrollWidth - window.innerWidth);
			expect(overflow).toBeLessThanOrEqual(1);
			const rowOverflow: number = await achievement(page, 'notes1').evaluate(/** 逐条内容不得突破自己的布局盒子。 */ (element: HTMLElement): number => element.scrollWidth - element.clientWidth);
			expect(rowOverflow).toBeLessThanOrEqual(1);
			const radius: string = await achievement(page, 'notes1').evaluate(/** 单列条目取消原独立面板的大圆角。 */ (element: HTMLElement): string => getComputedStyle(element).borderRadius);
			expect(radius).toBe('0px');
			await page.screenshot({ path: testInfo.outputPath(`achievements-${scheme}-${width}.png`), animations: 'disabled' });
			if (width < 500) {
				const maximum: number = await page.getByTestId('twitter-scroll-viewport').evaluate(/** 原生可滚动范围来自当前布局，不复制 Shell 的尺寸常量。 */ (element: HTMLElement): number => element.scrollHeight - element.clientHeight);
				await scrollTo(page, maximum);
				const last: Locator = shell.locator('[data-achievement-name]').last();
				await expect(last).toBeInViewport({ ratio: 1 });
				const lastBox: ElementBox = await box(last);
				const fabBox: ElementBox = await box(page.getByTestId('open-post-form'));
				expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(fabBox.y + 1);
				await scrollTo(page, 0);
			}
		}
	});
}
