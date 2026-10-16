/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 匿名入口真实集成回归：固定隔离测试实例，验证入口／内容 Shell 互斥及原认证流程。
 * 不模拟认证或实例业务响应；截图只作为待审阅候选，不自动批准新视觉基线。
 */
import { test, expect } from '@playwright/test';
import type { Locator, Page, PlaywrightTestArgs, Request, Route } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState, locateMkInput, acceptSignupRules, ADMIN_SETUP_PASSWORD } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

let admin: RegisteredUser;

/** 记录页面错误而不是拦截或屏蔽，保证旧错误页不会被测试漏过。 */
function watchErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', /** 仅保存脱敏错误消息。 */ (error: Error): void => { errors.push(error.message); });
	return errors;
}

/** 入口不得仅用 CSS 隐藏业务组件；这些节点必须从 DOM 中缺席。 */
async function expectNoBusinessShell(page: Page): Promise<void> {
	await expect(page.getByTestId('twitter-sidebar')).toHaveCount(0);
	await expect(page.getByTestId('twitter-right-rail')).toHaveCount(0);
	await expect(page.getByTestId('twitter-mobile-bar')).toHaveCount(0);
	await expect(page.getByTestId('open-post-form')).toHaveCount(0);
	await expect(page.locator('a[href="/my/notifications"]')).toHaveCount(0);
	await expect(page.locator('#errorInfo')).toHaveCount(0);
}

/** 新匿名入口是独立布局；不接受“应用容器可见”作为完整通过条件。 */
async function expectEntry(page: Page): Promise<void> {
	await expect(page.getByTestId('twitter-welcome')).toBeVisible();
	await expect(page.getByTestId('twitter-entry-layout')).toBeVisible();
	await expect(page.getByTestId('twitter-content-layout')).toHaveCount(0);
	await expect(page.getByTestId('instance-setup')).toHaveCount(0);
	await expect(page.getByTestId('signin')).toHaveCount(1);
	await expect(page.getByTestId('signup')).toHaveCount(1);
	await expectNoBusinessShell(page);
}

/** 用真实后端创建账户并关闭向导提示，隔离本次布局断言。 */
async function createUser(): Promise<AccountWithToken> {
	const user: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', {
		i: admin.token, username: 'entry_user', password: 'entry-regression-password',
	});
	await api(BASE_URL, 'i/registry/set', { i: user.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return user;
}

/** 保存真实后端账户到既有缓存，模拟访问时已有会话；不构造业务状态副本。 */
async function seedSession(page: Page, user: AccountWithToken): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(
		/** 只写入现有账户持久化契约，认证仍由启动链调用真实后端验证。 */
		(account: AccountWithToken): void => { localStorage.setItem('account', JSON.stringify(account)); },
		user,
	);
}

test('首次安装仍进入独立管理员初始化向导',
	/** 未配置实例不能落入普通登录入口或业务 Shell。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		await resetState(BASE_URL);
		const errors: string[] = watchErrors(page);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expect(page.getByTestId('admin-username')).toBeVisible();
		await expect(page.getByTestId('twitter-entry-layout')).toBeVisible();
		await expect(page.getByTestId('twitter-welcome')).toHaveCount(0);
		await expectNoBusinessShell(page);
		await locateMkInput(page, 'admin-initial-password').fill(ADMIN_SETUP_PASSWORD);
		await locateMkInput(page, 'admin-username').fill('first_admin');
		await locateMkInput(page, 'admin-password').fill('first-admin-password');
		await page.getByTestId('admin-ok').click();
		await expect(page.getByTestId('next')).toBeVisible();
		expect(errors).toEqual([]);
	},
);

test.describe('已配置实例的匿名边界',
	/** 各场景独立重置测试实例，不读取开发配置或污染开发数据库。 */
	(): void => {
		test.beforeEach(
			/** 用真实后台策略开启邀请码注册，覆盖受限注册而不是伪造入口状态。 */
			async (): Promise<void> => {
				await resetState(BASE_URL);
				admin = await registerUser(BASE_URL, 'entry_admin', 'entry-admin-password', true);
				await api(BASE_URL, 'admin/update-meta', {
					i: admin.token, name: 'Entry Regression', disableRegistration: true, emailRequiredForSignup: false,
				});
			},
		);

		test('未选择 Twitter 时保持原访客 UI',
			/** 不改变默认 rollout 或将其他 UI 强制切换为 Twitter。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				await page.goto(`${BASE_URL}/`);
				await expect(page.getByTestId('signin')).toBeVisible();
				await expect(page.getByTestId('twitter-root')).toHaveCount(0);
				await expect(page.getByTestId('twitter-welcome')).toHaveCount(0);
			},
		);

		test('同页调整视口和关闭认证弹层保持单一入口',
			/** 断点监听与全局宿主在路由／弹窗切换期间仍工作，没有重复挂载。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				await page.setViewportSize({ width: 1440, height: 900 });
				await page.goto(`${BASE_URL}/?ui=twitter`);
				await expectEntry(page);
				await page.setViewportSize({ width: 390, height: 480 });
				await expect(page.getByTestId('twitter-entry-brand')).toHaveCount(0);
				await page.getByTestId('signin').click();
				await expect(page.getByTestId('signin-username')).toBeVisible();
				await page.locator('button').filter({ has: page.locator('i.ti-x') }).click();
				await expect(page.getByTestId('signin-username')).toHaveCount(0);
				await expect(page.getByTestId('signin')).toBeEnabled();
				await page.setViewportSize({ width: 1440, height: 900 });
				await expect(page.getByTestId('twitter-entry-brand')).toBeVisible();
				await expectEntry(page);
			},
		);

		test('匿名首页不触发旧仪表盘和业务右栏的数据请求',
			/** 网络断言识别隐藏但仍挂载的业务组件，不限于肉眼不可见。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				await page.setViewportSize({ width: 1440, height: 900 });
				const errors: string[] = watchErrors(page);
				const requests: string[] = [];
				page.on('request', /** 仅记录路径，不保存请求中的登录凭据。 */ (request: Request): void => { requests.push(new URL(request.url()).pathname); });
				await page.goto(`${BASE_URL}/?ui=twitter`);
				await expectEntry(page);
				await expect(page.getByTestId('twitter-invitation-notice')).toBeVisible();
				const entryBox: Awaited<ReturnType<Locator['boundingBox']>> = await page.getByTestId('twitter-welcome').boundingBox();
				const footerBox: Awaited<ReturnType<Locator['boundingBox']>> = await page.getByTestId('twitter-welcome').locator('footer').boundingBox();
				expect(entryBox?.height).toBeGreaterThanOrEqual(899);
				expect((footerBox?.y ?? 0) + (footerBox?.height ?? 0)).toBeGreaterThanOrEqual(899);
				await expect(page.getByTestId('twitter-entry-brand').locator('img')).toHaveJSProperty('naturalWidth', 512);
				await page.screenshot({ path: test.info().outputPath('anonymous-desktop-light.png') });
				for (const endpoint of ['stats', 'hashtags/trend', 'users/recommendation', 'pinned-users', 'federation/instances', 'notes/local-timeline']) {
					expect(requests).not.toContain(`/api/${endpoint}`);
				}
				expect(errors).toEqual([]);
			},
		);

		for (const width of [390, 511, 512, 640, 767, 768, 1440]) {
			test(`匿名入口宽度 ${width} 无横向溢出且选择正确结构`,
				/** 直接测量浏览器布局与节点存在性，断点附近也不得出现业务移动导航。 */
				async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(`${BASE_URL}/?ui=twitter`);
					await expectEntry(page);
					await expect(page.getByTestId('twitter-entry-brand')).toHaveCount(width >= 768 ? 1 : 0);
					const overflow: boolean = await page.evaluate(
						/** 检查入口及其滚动宿主，不能仅检查被 overflow:clip 掩盖的 body。 */
						(): boolean => [...document.querySelectorAll<HTMLElement>('[data-testid="twitter-entry-layout"], [data-testid="twitter-welcome"], [data-testid="twitter-entry-panel"]')].some(
							/** 内容宽度超过视口／自身可用宽度时判为回归。 */
							(element: HTMLElement): boolean => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > innerWidth + 1,
						),
					);
					expect(overflow).toBe(false);
					await page.screenshot({ path: test.info().outputPath(`anonymous-${width}.png`) });
				},
			);
		}

		test('匿名内容路由可访问并可返回独立入口',
			/** 公开用户和帖子保留浏览权限，但不借业务侧栏提供登录专属动作。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				const user: AccountWithToken = await createUser();
				const note: Misskey.entities.NotesCreateResponse = await api(BASE_URL, 'notes/create', { i: user.token, text: 'public entry regression' });
				const errors: string[] = watchErrors(page);
				await page.goto(`${BASE_URL}/notes/${note.createdNote.id}?ui=twitter`);
				await expect(page.getByText('public entry regression').first()).toBeVisible();
				await expect(page.getByTestId('twitter-guest-header')).toBeVisible();
				await expectNoBusinessShell(page);
				await page.goto(`${BASE_URL}/@${user.username}?ui=twitter`);
				await expect(page.getByTestId('twitter-guest-header')).toBeVisible();
				await expect(page.getByTestId('twitter-entry-layout')).toHaveCount(0);
				await page.getByTestId('twitter-guest-header').locator('a').first().click();
				await expectEntry(page);
				await page.goBack();
				await expect(page.getByTestId('twitter-guest-header')).toBeVisible();
				await expectNoBusinessShell(page);
				expect(errors).toEqual([]);
			},
		);

		test('入口登录复用原流程并进入原业务 Shell',
			/** 真实输入用户名和密码，验证全局弹层宿主与身份重建未退化。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				await createUser();
				await page.setViewportSize({ width: 1440, height: 900 });
				const errors: string[] = watchErrors(page);
				await page.goto(`${BASE_URL}/?ui=twitter`);
				await expectEntry(page);
				await page.getByTestId('signin').click();
				await locateMkInput(page, 'signin-username').fill('entry_user');
				await page.keyboard.press('Enter');
				await locateMkInput(page, 'signin-password').fill('entry-regression-password');
				await page.keyboard.press('Enter');
				await expect(page.getByTestId('twitter-sidebar')).toBeVisible();
				await expect(page.getByTestId('twitter-right-rail')).toBeVisible();
				await expect(page.getByTestId('twitter-welcome')).toHaveCount(0);
				await page.setViewportSize({ width: 390, height: 844 });
				await expect(page.getByTestId('twitter-mobile-bar')).toBeVisible();
				await expect(page.getByTestId('open-post-form')).toBeVisible();
				expect(errors).toEqual([]);
			},
		);

		test('邀请码注册保留规则确认和真实账户创建',
			/** 页面不虚构第三方登录或绕过邀请码；按钮进入原注册对话框。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				const codes: Misskey.entities.InviteCode[] = await api(BASE_URL, 'admin/invite/create', { i: admin.token, count: 1 });
				await page.goto(`${BASE_URL}/?ui=twitter`);
				await expectEntry(page);
				await page.getByTestId('signup').click();
				await acceptSignupRules(page);
				await expect(page.getByTestId('signup-invitation-code')).toBeVisible();
				await locateMkInput(page, 'signup-username').fill('entry_signup');
				await locateMkInput(page, 'signup-password').fill('entry-signup-password');
				await locateMkInput(page, 'signup-password-retype').fill('entry-signup-password');
				await expect(page.getByTestId('signup-submit')).toBeDisabled();
				await locateMkInput(page, 'signup-invitation-code').fill(codes[0].code);
				await page.getByTestId('signup-submit').click();
				await expect(page.getByTestId('twitter-content-layout')).toBeVisible();
				await expect(page.getByTestId('twitter-welcome')).toHaveCount(0);
				const username: string | null = await page.evaluate(
					/** 检查原登录模块已持久化真实注册结果。 */
					(): string | null => {
						const raw: string | null = localStorage.getItem('account');
						return raw === null ? null : (JSON.parse(raw) as AccountWithToken).username;
					},
				);
				expect(username).toBe('entry_signup');
			},
		);

		test('失效缓存恢复后进入新匿名入口而不是混合 Shell',
			/** 后端实际撤销 token，浏览器保留旧缓存直到修复代码自行恢复。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				const user: AccountWithToken = await createUser();
				const errors: string[] = watchErrors(page);
				await seedSession(page, user);
				await api(BASE_URL, 'i/regenerate-token', { i: user.token, password: 'entry-regression-password' });
				await page.goto(`${BASE_URL}/?ui=twitter`);
				await expectEntry(page);
				await page.getByTestId('modal-dialog-ok').click();
				await expectEntry(page);
				expect(errors).toEqual([]);
			},
		);

		test('实例信息获取失败可重试且不先挂载业务外壳',
			/** 只注入网络故障，重试后实例状态来自真实后端。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				await page.route('**/api/meta', /** 中断传输，不伪造实例配置。 */ async (route: Route): Promise<void> => { await route.abort('connectionfailed'); });
				await page.goto(`${BASE_URL}/?ui=twitter`);
				await expect(page.getByRole('alert')).toBeVisible();
				await expectNoBusinessShell(page);
				await page.unroute('**/api/meta');
				await page.getByRole('button', { name: 'Retry', exact: true }).click();
				await expectEntry(page);
			},
		);

		test('明暗与中文视图仅输出待审阅视觉候选',
			/** 固定字号环境与视口，保存真实布局截图，不自动固化新实现为正确基线。 */
			async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
				await page.goto(`${BASE_URL}/robots.txt`);
				await page.evaluate(/** 指定测试语言，不改变业务实例。 */ (): void => { localStorage.setItem('lang', 'zh-CN'); });
				for (const width of [1440, 390]) {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(`${BASE_URL}/?ui=twitter`);
					await expectEntry(page);
					for (const mode of ['light', 'dark'] as const) {
						await page.evaluate(/** 明确选择 CSS 明暗介质，单独验证入口 token 范围。 */ (value: string): void => { document.documentElement.style.colorScheme = value; }, mode);
						await page.screenshot({ path: test.info().outputPath(`anonymous-zh-${width}-${mode}.png`) });
					}
				}
			},
		);
	},
);
