/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter Bootstrap 自动捐助提示的真实浏览器回归。
 * 作用：验证全新浏览器登录、最终 UI 选择和既有捐助偏好的边界。
 * 数据链：隔离实例真实账户 → 原生登录或真实会话恢复 → 根 UI 挂载 → 弹窗及持久化结果。
 * 边界：仅重置 localhost:61812 测试实例；只前移浏览器日期满足旧提示条件，不伪造业务响应或修改账户事实。
 */
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState, signIn } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 管理者只负责当前隔离实例的真实账户夹具。 */
let admin: RegisteredUser;
/** 所有 UI 对照均使用同一位服务端签发的普通账户。 */
let viewer: AccountWithToken;
/** 普通账户经正式登录页提交的测试密码。 */
const password: string = 'donation-regression-password';
/** 只收集页面异常文本，不输出凭据、请求体或完整账户。 */
let errors: string[];

/** 通过既有传输调用真实后端，响应类型从生成的接口 Schema 派生。 */
async function realApi<E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(account: RegisteredUser, endpoint: E, params: P): Promise<Misskey.api.SwitchCaseResponseType<E, P>> {
	return await api(BASE_URL, endpoint, { ...params, i: account.token }) as Misskey.api.SwitchCaseResponseType<E, P>;
}

/** 监听主页面和独立无痕上下文的未处理异常，不采集认证数据。 */
function observeErrors(page: Page): void {
	page.on('pageerror', /** 只保存无请求上下文的异常消息。 */ (error: Error): void => { errors.push(error.message); });
}

/** 只在同源静态页面准备已有浏览器格式，日期前移不能替代真实认证。 */
async function preparePage(page: Page, savedUi: string, account?: AccountWithToken): Promise<void> {
	await page.clock.setFixedTime(new Date(new Date(viewer.createdAt).getTime() + 4 * 24 * 60 * 60 * 1000));
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 保存 UI 与语言；需要恢复会话的用例仅使用真实后端签发的快照。 */ (input: { savedUi: string; account?: AccountWithToken }): void => {
		localStorage.setItem('ui', input.savedUi);
		localStorage.setItem('lang', 'en-US');
		if (input.account) localStorage.setItem('account', JSON.stringify(input.account));
	}, { savedUi, account });
}

/** 使用用户可见标题识别原弹窗，避免测试绑定样式类或实现文件。 */
function donationPrompt(page: Page): Locator {
	return page.getByText('Have you taken a liking to Misskey?', { exact: true });
}

/** 完成实际根 UI 和异步启动资源加载后再检查提示，防止提前断言产生假阳性。 */
async function expectReady(page: Page, twitter: boolean): Promise<void> {
	await expect(page.locator('#misskey_app')).toBeVisible();
	if (twitter) await expect(page.getByTestId('twitter-root')).toBeVisible();
	else await expect(page.getByTestId('twitter-root')).toHaveCount(0);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('#errorInfo')).toHaveCount(0);
	await expect(page.getByTestId('user-setup-dialog')).toHaveCount(0);
}

/** 只读取原有捐助持久化键，验证产品没有把展示策略写成用户选择。 */
async function donationPreferences(page: Page): Promise<readonly (string | null)[]> {
	return await page.evaluate(/** 浏览器存储观测只用于验收，不进入产品业务状态。 */ (): readonly (string | null)[] => [localStorage.getItem('neverShowDonationInfo'), localStorage.getItem('latestDonationInfoShownAt')]);
}

/** 创建独立浏览器存储并通过正式表单登录，模拟重新开启无痕窗口。 */
async function loginInFreshContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
	const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
	const page: Page = await context.newPage();
	observeErrors(page);
	try {
		await preparePage(page, 'twitter');
		expect(await donationPreferences(page)).toEqual([null, null]);
		await signIn(page, BASE_URL, viewer.username, password);
		await expectReady(page, true);
		await expect.poll(/** 登录完成后身份必须由正式流程保存，不能预注入账户代替登录。 */ async (): Promise<string | undefined> => page.evaluate(/** 只提取账户标识，凭据不进入断言或测试输出。 */ (): string | undefined => {
			const raw: string | null = localStorage.getItem('account');
			return raw === null ? undefined : (JSON.parse(raw) as AccountWithToken).id;
		})).toBe(viewer.id);
		return { context, page };
	} catch (error: unknown) {
		await context.close();
		throw error;
	}
}

test.beforeEach(/** 每个用例独占专用测试数据库，普通账户与引导状态均由真实接口创建。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	if (BASE_URL !== 'http://localhost:61812') throw new Error('Donation regression requires the isolated localhost:61812 instance');
	errors = [];
	observeErrors(page);
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'donation_admin', 'donation-admin-password', true);
	const created: Misskey.Endpoints['admin/accounts/create']['res'] = await realApi(admin, 'admin/accounts/create', { username: 'donation_viewer', password });
	await realApi(created, 'i/registry/set', { scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	viewer = { ...await realApi(created, 'i', {}), token: created.token };
	await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(/** 任何页面未处理异常都使本次端到端回归失败。 */ (): void => {
	expect(errors).toEqual([]);
});

test('全新无痕上下文真实登录、刷新和重新登录均不出现捐助提示', /** 登录与再次开启无痕窗口都不依赖旧窗口的本地抑制标记。 */ async ({ browser }: Pick<PlaywrightWorkerArgs, 'browser'>): Promise<void> => {
	const first: { context: BrowserContext; page: Page } = await loginInFreshContext(browser);
	try {
		await expect(donationPrompt(first.page)).toHaveCount(0);
		expect(await donationPreferences(first.page)).toEqual([null, null]);
		await first.page.reload();
		await expectReady(first.page, true);
		await expect(donationPrompt(first.page)).toHaveCount(0);
		expect(await donationPreferences(first.page)).toEqual([null, null]);
	} finally {
		await first.context.close();
	}
	const second: { context: BrowserContext; page: Page } = await loginInFreshContext(browser);
	try {
		await expect(donationPrompt(second.page)).toHaveCount(0);
		expect(await donationPreferences(second.page)).toEqual([null, null]);
	} finally {
		await second.context.close();
	}
});

test('query 选择 Twitter 时覆盖保存的原生 UI，同账户原生入口仍按旧条件弹出', /** 正向对照证明账户年龄和空提醒记录确实满足原触发条件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await preparePage(page, 'universal', viewer);
	await page.goto(`${BASE_URL}/?ui=twitter`);
	await expectReady(page, true);
	await expect(donationPrompt(page)).toHaveCount(0);
	expect(await donationPreferences(page)).toEqual([null, null]);
	await page.screenshot({ path: test.info().outputPath('twitter-without-donation-prompt.png'), fullPage: true });
	await page.goto(`${BASE_URL}/`);
	await expectReady(page, false);
	await expect(donationPrompt(page)).toBeVisible();
	expect(await donationPreferences(page)).toEqual([null, null]);
	await page.screenshot({ path: test.info().outputPath('native-donation-prompt-positive-control.png'), fullPage: true });
	await page.getByRole('button', { name: 'Maybe later', exact: true }).click();
	await expect(donationPrompt(page)).toHaveCount(0);
	const preferences: readonly (string | null)[] = await donationPreferences(page);
	expect(preferences[0]).toBeNull();
	expect(preferences[1]).not.toBeNull();
});

test('query 选择原生 UI 时覆盖保存的 Twitter UI 并保留原弹窗', /** 以实际选择的根 UI 为准，保存值不能错误抑制原生入口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await preparePage(page, 'twitter', viewer);
	await page.goto(`${BASE_URL}/?ui=default`);
	await expectReady(page, false);
	await expect(donationPrompt(page)).toBeVisible();
	expect(await donationPreferences(page)).toEqual([null, null]);
});

test('Twitter 抑制策略不改写用户已有捐助偏好，原生 UI 继续尊重不再显示', /** 策略切换只改变自动创建入口，不能替用户写入或清除原提醒选择。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await preparePage(page, 'twitter', viewer);
	const previousShownAt: string = String(new Date(viewer.createdAt).getTime() - 31 * 24 * 60 * 60 * 1000);
	await page.evaluate(/** 模拟真实已有的两个持久化字段，而非增加产品配置。 */ (timestamp: string): void => {
		localStorage.setItem('neverShowDonationInfo', 'true');
		localStorage.setItem('latestDonationInfoShownAt', timestamp);
	}, previousShownAt);
	await page.goto(`${BASE_URL}/`);
	await expectReady(page, true);
	await expect(donationPrompt(page)).toHaveCount(0);
	expect(await donationPreferences(page)).toEqual(['true', previousShownAt]);
	await page.goto(`${BASE_URL}/?ui=default`);
	await expectReady(page, false);
	await expect(donationPrompt(page)).toHaveCount(0);
	expect(await donationPreferences(page)).toEqual(['true', previousShownAt]);
});
