/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 发帖编辑器的真实后端端到端验收。
 * 作用：验证受众策略与工具栏几何隔离、输入焦点、窄容器可达性和原有发布权限语义。
 * 数据链：专用测试实例与真实账号 → 浏览器操作共享表单 → 创建请求及服务端确认帖子。
 * 布局测量只读取浏览器结果，不伪造 API 响应，也不访问开发实例或真实用户账号。
 */
import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, CDPSession, Locator, Page, PlaywrightTestArgs, Response } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { TWITTER_LAYOUT_BREAKPOINTS } from '../../src/ui/twitter/domain/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 保存专用测试实例的临时管理员，不导出凭据。 */
let admin: RegisteredUser;
/** 当前浏览器登录的真实合成账号。 */
let account: AccountWithToken;
/** 用于指定收件人和非公开回复的另一真实合成账号。 */
let recipient: AccountWithToken;
/** 浏览器未处理异常，作为每个场景的独立验收条件。 */
let pageErrors: string[];

/** 四种现有权限的场景输入，仅引用 SDK 权威类型，不定义第二套业务枚举。 */
const visibilityScenarios: ReadonlyArray<Readonly<{
	visibility: Misskey.entities.Note['visibility'];
	label: string;
}>> = [
	{ visibility: 'public', label: '公开' },
	{ visibility: 'home', label: '首页' },
	{ visibility: 'followers', label: '仅关注者' },
	{ visibility: 'specified', label: '指定用户' },
];

/** DOM 几何的只读测量投影，不参与应用业务决策。 */
type ToolbarGeometry = Readonly<{
	width: number;
	toolsTop: number;
	submitTop: number;
}>;

/** 真实创建请求与后端确认结果，字段类型直接派生自既有 API。 */
type SubmittedNote = Readonly<{
	request: Misskey.Endpoints['notes/create']['req'];
	note: Misskey.entities.Note;
}>;

/** 创建真实普通账号并沿用现有 registry 跳过首次设置。 */
async function createAccount(username: string): Promise<AccountWithToken> {
	const user: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username, password: 'composer-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: user.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return user;
}

/** 使用服务器签发的账号建立测试会话，中文覆盖较长的可见性标签。 */
async function visitComposerHost(page: Page, path: string = '/', ui: 'twitter' | 'default' = 'twitter', width: number = 1440, height: number = 1000): Promise<void> {
	page.setDefaultTimeout(15_000);
	await page.setViewportSize({ width, height });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 按既有持久化格式装入真实测试账号。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'zh-CN');
	}, account);
	await page.goto(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}ui=${ui}`);
	await expect(page.getByTestId('open-post-form').filter({ visible: true }).first()).toBeVisible();
}

/** 打开全局发帖弹窗，避免误选详情页常驻的内联表单。 */
async function openComposer(page: Page): Promise<Locator> {
	await page.getByTestId('open-post-form').filter({ visible: true }).first().click();
	const composer: Locator = page.locator('[data-testid="twitter-composer"]:not([data-testid="twitter-reply-composer"] *)').last();
	await expect(composer.getByTestId('post-form-text')).toBeVisible();
	return composer;
}

/** 通过原有权限选择器提交选择，等待真实菜单关闭。 */
async function chooseVisibility(page: Page, composer: Locator, label: string): Promise<void> {
	await composer.getByRole('button', { name: '可见性', exact: true }).click();
	const option: Locator = page.locator('button[data-index]').filter({ hasText: label }).last();
	await option.click();
	await expect(option).toBeHidden();
}

/** 只读比较工具栏与提交按钮，不从文案反推业务状态。 */
async function toolbarGeometry(composer: Locator): Promise<ToolbarGeometry> {
	const tools: Locator = composer.getByTestId('twitter-composer-tools-scroll');
	const submit: Locator = composer.getByTestId('post-form-submit');
	const geometry: Omit<ToolbarGeometry, 'submitTop'> = await tools.evaluate(/** 读取浏览器真实滚动区域。 */ (element: HTMLElement): Omit<ToolbarGeometry, 'submitTop'> => ({
		width: element.getBoundingClientRect().width,
		toolsTop: element.getBoundingClientRect().top,
	}));
	const submitTop: number = await submit.evaluate(/** 提交入口保持所在行的几何依据。 */ (element: HTMLElement): number => element.getBoundingClientRect().top);
	return { ...geometry, submitTop };
}

/** 在真实用户选择器中指定收件人，保留原有 mention 与收件人写入路径。 */
async function selectRecipient(page: Page, composer: Locator): Promise<void> {
	await composer.getByRole('button', { name: '添加', exact: true }).click();
	const dialog: Locator = page.getByText('选择用户', { exact: true }).locator('xpath=../..');
	await dialog.locator('input').first().fill(recipient.username);
	await dialog.getByText(`@${recipient.username}`, { exact: true }).click();
	await dialog.getByRole('button', { name: /完成/ }).click();
	await expect(dialog).toBeHidden();
	await expect(composer.getByText(`@${recipient.username}`, { exact: true })).toBeVisible();
}

/** 经浏览器发布，并再次查询真实后端确认请求中的权限字段已落地。 */
async function submitNote(page: Page, composer: Locator, text: string): Promise<SubmittedNote> {
	await composer.getByTestId('post-form-text').fill(text);
	const pending: Promise<Response> = page.waitForResponse(/** 只接收真实创建接口的成功回执。 */ (response: Response): boolean => response.url().endsWith('/api/notes/create') && response.ok());
	await composer.getByTestId('post-form-submit').click();
	const response: Response = await pending;
	const request: Misskey.Endpoints['notes/create']['req'] = response.request().postDataJSON();
	const result: Misskey.Endpoints['notes/create']['res'] = await response.json();
	const note: Misskey.entities.Note = await api(BASE_URL, 'notes/show', { i: account.token, noteId: result.createdNote.id });
	return { request, note };
}

/** 在真实手机抽屉上下文中滚动原生宿主，不用程序设置 scrollTop 证明用户可达性。 */
async function scrollComposer(page: Page, composer: Locator, towardEnd: boolean): Promise<void> {
	const bounds: Awaited<ReturnType<Locator['boundingBox']>> = await composer.boundingBox();
	if (bounds == null) throw new Error('手机发帖宿主未提供可交互区域');
	await page.mouse.move(bounds.x + 24, bounds.y + Math.min(bounds.height / 2, 200));
	await page.mouse.wheel(0, towardEnd ? 1600 : -1600);
	await expect.poll(/** 确认用户滚轮确实抵达宿主的目标边界。 */ async (): Promise<boolean> => composer.evaluate(/** 只读确认滚动结果，不通过脚本修改位置。 */ (element: HTMLElement, atEnd: boolean): boolean => atEnd ? Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) <= 1 : element.scrollTop <= 1, towardEnd)).toBe(true);
}

/** 用真实触点序列拖动手机抽屉；短帧间隔用于生成手势，不代替条件等待。 */
async function touchScrollComposer(page: Page, composer: Locator, towardEnd: boolean): Promise<void> {
	const bounds: Awaited<ReturnType<Locator['boundingBox']>> = await composer.boundingBox();
	if (bounds == null) throw new Error('手机发帖宿主未提供可触摸区域');
	const client: CDPSession = await page.context().newCDPSession(page);
	const top: number = bounds.y + 72;
	const bottom: number = bounds.y + bounds.height - 48;
	const start: number = towardEnd ? bottom : top;
	const end: number = towardEnd ? top : bottom;
	try {
		for (let gesture: number = 0; gesture < 8; gesture++) {
			const reached: boolean = await composer.evaluate(/** 当前几何决定是否还需要一组触摸拖动。 */ (element: HTMLElement, atEnd: boolean): boolean => atEnd ? Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) <= 1 : element.scrollTop <= 1, towardEnd);
			if (reached) break;
			await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 24, y: start, id: 1 }] });
			for (let frame: number = 1; frame <= 20; frame++) {
				await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 24, y: start + (end - start) * frame / 20, id: 1 }] });
				await page.waitForTimeout(20);
			}
			await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		}
		await expect.poll(/** 触摸输入必须实际到达边界，不能只证明发出了事件。 */ async (): Promise<boolean> => composer.evaluate(/** 只读宿主最终滚动结果。 */ (element: HTMLElement, atEnd: boolean): boolean => atEnd ? Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) <= 1 : element.scrollTop <= 1, towardEnd)).toBe(true);
	} finally {
		await client.detach();
	}
}

test.setTimeout(120_000);

test.beforeEach(/** 每次只重置专用测试服务，保证独立权限夹具。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'composer_admin', 'composer-admin-password', true);
	account = await createAccount('composer_user');
	recipient = await createAccount('composer_peer');
	await api(BASE_URL, 'following/create', { i: account.token, userId: recipient.id });
	pageErrors = [];
	page.on('pageerror', /** 收集实际浏览器异常，测试结束统一检查。 */ (error: Error): void => { pageErrors.push(error.message); });
});

test.afterEach(/** 不能以布局断言掩盖组件生命周期中的未处理异常。 */ (): void => {
	expect(pageErrors).toEqual([]);
});

test('四种可见性保持工具轨道宽度并显示必要收件人', /** 复现中文四字策略挤压工具栏的问题。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await visitComposerHost(page);
	const composer: Locator = await openComposer(page);
	await expect(composer.getByTestId('twitter-composer-policy')).toBeVisible();
	await chooseVisibility(page, composer, '公开');
	const initial: ToolbarGeometry = await toolbarGeometry(composer);
	for (const text of ['', '少量正文']) {
		await composer.getByTestId('post-form-text').fill(text);
		for (const scenario of visibilityScenarios) {
			await chooseVisibility(page, composer, scenario.label);
			const current: ToolbarGeometry = await toolbarGeometry(composer);
			expect(Math.abs(current.width - initial.width)).toBeLessThanOrEqual(1);
			expect(Math.abs(current.toolsTop - current.submitTop)).toBeLessThanOrEqual(6);
			await expect(composer.getByText('收件人', { exact: true })).toHaveCount(scenario.visibility === 'specified' ? 1 : 0);
			await expect(composer.getByRole('button', { name: '仅限本地', exact: true })).toHaveCount(scenario.visibility === 'specified' ? 0 : 1);
		}
	}
	await selectRecipient(page, composer);
});

test('正文注解话题的鼠标编辑无品牌框且键盘仍有焦点提示', /** 编辑控件焦点不改变高度，也不取消按钮的键盘可达性。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await visitComposerHost(page);
	const composer: Locator = await openComposer(page);
	await composer.getByRole('button', { name: '隐藏内容', exact: true }).click();
	await composer.getByRole('button', { name: '话题标签', exact: true }).click();
	const fields: readonly Locator[] = [composer.getByTestId('post-form-text'), composer.getByRole('textbox', { name: '注解', exact: true }), composer.getByRole('textbox', { name: '话题标签', exact: true })];
	const foregrounds: Set<string> = new Set<string>();
	for (const scheme of ['light', 'dark'] as const) {
		await page.evaluate(/** 固定实际 color-scheme，验证 Twitter Token 的明暗解析。 */ (value: 'light' | 'dark'): void => { document.documentElement.style.colorScheme = value; }, scheme);
		foregrounds.add(await fields[0].evaluate(/** 采集最终文字颜色，不能只验证 Token 声明本身。 */ (element: HTMLElement): string => getComputedStyle(element).color));
		for (const field of fields) {
			await field.click();
			await field.pressSequentially('输入');
			await expect(field).toBeFocused();
			const pointerOutline: string = await field.evaluate(/** 鼠标编辑不产生原先的蓝色矩形。 */ (element: HTMLElement): string => getComputedStyle(element).outlineStyle);
			expect(pointerOutline).toBe('none');
			await field.press('Tab');
			await page.keyboard.press('Shift+Tab');
			await expect(field).toBeFocused();
			const caret: { color: string; enabled: boolean } = await field.evaluate(/** 编辑器以可见插入符保留无边框的键盘编辑焦点。 */ (element: HTMLInputElement | HTMLTextAreaElement): { color: string; enabled: boolean } => ({
				color: getComputedStyle(element).caretColor,
				enabled: !element.disabled && !element.readOnly,
			}));
			expect(caret.color).not.toBe('transparent');
			expect(caret.color).not.toBe('rgba(0, 0, 0, 0)');
			expect(caret.enabled).toBe(true);
			await field.pressSequentially('键盘');
		}
	}
	expect(foregrounds.size).toBe(2);
	const editorLine: { content: string; opacity: string } = await composer.getByTestId('post-form-text').evaluate(/** 正文外层不再绘制项目自行添加的品牌底线。 */ (element: HTMLElement): { content: string; opacity: string } => {
		const style: CSSStyleDeclaration = getComputedStyle(element.parentElement!, '::after');
		return { content: style.content, opacity: style.opacity };
	});
	expect(editorLine.content === 'none' || editorLine.opacity === '0').toBe(true);
	const submit: Locator = composer.getByTestId('post-form-submit');
	await submit.focus();
	await expect(submit).toBeFocused();
	expect(await submit.evaluate(/** 按钮继续使用既有可见键盘焦点轮廓。 */ (element: HTMLElement): string => getComputedStyle(element).outlineStyle)).not.toBe('none');
});

test('窄容器仍可导航全部工具且键盘聚焦只移动内部轨道', /** 覆盖旧 500px 换行区间与更窄容器的真实浏览器几何。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await visitComposerHost(page);
	const composer: Locator = await openComposer(page);
	for (const width of [600, 570, 501, 500, 390, 320, 310]) {
		await page.setViewportSize({ width, height: 1000 });
		await expect(composer.getByTestId('post-form-submit')).toBeVisible();
		await expect.poll(/** 按表单自身宽度切换极窄分组，不复用旧 500px 断点。 */ async (): Promise<boolean> => composer.evaluate(/** 测量容器与两组入口的真实垂直关系。 */ (element: HTMLElement, threshold: number): boolean => {
			const tools: HTMLElement | null = element.querySelector('[data-testid="twitter-composer-tools-scroll"]');
			const submit: HTMLElement | null = element.querySelector('[data-testid="post-form-submit"]');
			if (tools == null || submit == null) return false;
			const difference: number = Math.abs(tools.getBoundingClientRect().top - submit.getBoundingClientRect().top);
			return element.clientWidth < threshold ? difference > 20 : difference <= 6;
		}, TWITTER_LAYOUT_BREAKPOINTS.composerNarrow)).toBe(true);
		const overflow: number = await page.evaluate(/** 页面本身不承担工具栏横向溢出。 */ (): number => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(1);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	for (const width of [319, 320, 321]) {
		await composer.evaluate(/** 对实际表单施加局部宿主宽度，不把视口宽度当作表单宽度。 */ (element: HTMLElement, value: number): void => { element.style.width = `${value}px`; }, width);
		await expect.poll(/** 明确验证断点两侧的真实容器尺寸。 */ async (): Promise<number> => composer.evaluate(/** 读取实际布局宽度。 */ (element: HTMLElement): number => element.clientWidth)).toBe(width);
		await expect.poll(/** 极窄时纵向分组，边界及其上方维持横向分组。 */ async (): Promise<boolean> => {
			const geometry: ToolbarGeometry = await toolbarGeometry(composer);
			const difference: number = Math.abs(geometry.toolsTop - geometry.submitTop);
			return width < TWITTER_LAYOUT_BREAKPOINTS.composerNarrow ? difference > 20 : difference <= 6;
		}).toBe(true);
	}
	await composer.evaluate(/** 恢复原宿主宽度，后续用真实窄视口检查导航。 */ (element: HTMLElement): void => { element.style.removeProperty('width'); });
	await page.setViewportSize({ width: 390, height: 1000 });
	const scrollport: Locator = composer.getByTestId('twitter-composer-tools-scroll');
	const next: Locator = composer.getByTestId('twitter-composer-tools-next');
	await expect(next).toBeEnabled();
	await next.click();
	await expect.poll(/** 导航箭头确实移动内部工具轨道。 */ async (): Promise<number> => scrollport.evaluate(/** 读取局部滚动位移。 */ (element: HTMLElement): number => Math.abs(element.scrollLeft))).toBeGreaterThan(0);
	await scrollport.evaluate(/** 从起点检查键盘激活箭头到末端的焦点交接。 */ (element: HTMLElement): void => { element.scrollTo({ left: 0, behavior: 'instant' }); });
	await expect(next).toBeVisible();
	for (let index: number = 0; index < 12 && await next.isVisible(); index++) {
		await next.focus();
		await next.press('Enter');
	}
	await expect(next).toBeHidden();
	const lastTool: Locator = composer.getByTestId('twitter-composer-tools-track').getByRole('button').last();
	await expect(lastTool).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(lastTool).not.toBeFocused();
	expect(await page.evaluate(/** 隐藏导航箭头不得令焦点掉回页面根节点。 */ (): boolean => document.activeElement === document.body)).toBe(false);
	const previous: Locator = composer.getByTestId('twitter-composer-tools-previous');
	for (let index: number = 0; index < 12 && await previous.isVisible(); index++) {
		await previous.focus();
		await previous.press('Enter');
	}
	await expect(previous).toBeHidden();
	await expect(composer.getByTestId('twitter-composer-tools-track').getByRole('button').first()).toBeFocused();
	const pageScroll: number = await page.evaluate(/** 保存页面滚动基准，避免 focusin 误滚整个弹窗或页面。 */ (): number => window.scrollY);
	await lastTool.focus();
	await expect(lastTool).toBeFocused();
	await expect.poll(/** 焦点工具完整进入局部可见区域。 */ async (): Promise<boolean> => lastTool.evaluate(/** 比较按钮与轨道视口实际边界。 */ (element: HTMLElement): boolean => {
		const viewport: HTMLElement | null = element.closest('[data-testid="twitter-composer-tools-scroll"]');
		if (viewport == null) return false;
		const child: DOMRect = element.getBoundingClientRect();
		const bounds: DOMRect = viewport.getBoundingClientRect();
		return child.left >= bounds.left - 1 && child.right <= bounds.right + 1;
	})).toBe(true);
	const tools: Locator[] = await composer.getByTestId('twitter-composer-tools-track').getByRole('button').all();
	for (const tool of tools) {
		await tool.focus();
		await expect.poll(/** 每个工具都能完整露出并接受指针命中，不被导航箭头覆盖。 */ async (): Promise<boolean> => tool.evaluate(/** 实际命中测试不触发上传或其他不相关业务操作。 */ (element: HTMLElement): boolean => {
			const bounds: DOMRect = element.getBoundingClientRect();
			const hit: Element | null = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
			return hit != null && element.contains(hit);
		})).toBe(true);
	}
	expect(await page.evaluate(/** 页级滚动位置保持不变。 */ (): number => window.scrollY)).toBe(pageScroll);
});

test('短高移动弹窗的长正文投票和收件人仍允许滚动发布', /** 必要内容可增长，但关闭和发布入口不能被真实手机抽屉裁剪。 */ async ({ browser }: { browser: Browser }): Promise<void> => {
	const context: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 480 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
	try {
		const page: Page = await context.newPage();
		page.on('pageerror', /** 手机上下文的异常也纳入同一真实验收。 */ (error: Error): void => { pageErrors.push(error.message); });
		await visitComposerHost(page, '/', 'twitter', 390, 480);
		const composer: Locator = await openComposer(page);
		await chooseVisibility(page, composer, '指定用户');
		await selectRecipient(page, composer);
		await composer.getByRole('button', { name: '投票', exact: true }).click();
		await composer.getByPlaceholder('选项1', { exact: true }).fill('第一项');
		await composer.getByPlaceholder('选项2', { exact: true }).fill('第二项');
		const text: string = '短高移动弹窗滚动核查。\n'.repeat(24);
		await composer.getByTestId('post-form-text').fill(text);
		const host: { height: number; viewportHeight: number; overflowY: string; scrollHeight: number; clientHeight: number } = await composer.evaluate(/** 记录真实抽屉几何，防止仅发布可见而顶部关闭被裁剪。 */ (element: HTMLElement): { height: number; viewportHeight: number; overflowY: string; scrollHeight: number; clientHeight: number } => ({
			height: element.getBoundingClientRect().height,
			viewportHeight: window.innerHeight,
			overflowY: getComputedStyle(element).overflowY,
			scrollHeight: element.scrollHeight,
			clientHeight: element.clientHeight,
		}));
		expect(host.height).toBeLessThanOrEqual(host.viewportHeight);
		expect(host.overflowY).toBe('auto');
		expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
		await test.info().attach('drawer-geometry.json', { body: JSON.stringify(host), contentType: 'application/json' });
		const cancel: Locator = composer.getByRole('button', { name: '取消', exact: true });
		await scrollComposer(page, composer, false);
		await expect(cancel).toBeInViewport({ ratio: 1 });
		await page.screenshot({ path: test.info().outputPath('mobile-close-visible.png') });
		await scrollComposer(page, composer, true);
		await expect(composer.getByTestId('post-form-submit')).toBeInViewport({ ratio: 1 });
		await page.screenshot({ path: test.info().outputPath('mobile-submit-visible.png') });
		const submitted: SubmittedNote = await submitNote(page, composer, text);
		expect(submitted.request.visibility).toBe('specified');
		expect(submitted.note.visibleUserIds).toContain(recipient.id);
		expect(submitted.note.poll?.choices).toHaveLength(2);
		await expect(composer).toBeHidden();
		const reopened: Locator = await openComposer(page);
		await reopened.getByTestId('post-form-text').fill(text);
		await reopened.getByRole('button', { name: '投票', exact: true }).click();
		await scrollComposer(page, reopened, true);
		await touchScrollComposer(page, reopened, false);
		await touchScrollComposer(page, reopened, true);
		await expect(reopened.getByTestId('post-form-submit')).toBeInViewport({ ratio: 1 });
		await touchScrollComposer(page, reopened, false);
		const closeButton: Locator = reopened.getByRole('button', { name: '取消', exact: true });
		await expect(closeButton).toBeInViewport({ ratio: 1 });
		await page.screenshot({ path: test.info().outputPath('mobile-touch-close-visible.png') });
		await closeButton.tap();
		await expect(reopened).toBeHidden();
	} finally {
		await context.close();
	}
});

test('四种策略经真实发布保留权限与指定收件人', /** 以真实请求和 notes/show 确认展示改造没有改写发布协议。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await visitComposerHost(page);
	for (const scenario of visibilityScenarios) {
		const composer: Locator = await openComposer(page);
		await chooseVisibility(page, composer, scenario.label);
		if (scenario.visibility === 'specified') await selectRecipient(page, composer);
		const submitted: SubmittedNote = await submitNote(page, composer, `composer ${scenario.visibility}`);
		expect(submitted.request.visibility).toBe(scenario.visibility);
		expect(submitted.note.visibility).toBe(scenario.visibility);
		if (scenario.visibility === 'specified') {
			expect(submitted.request.localOnly).toBe(false);
			expect(submitted.request.visibleUserIds).toContain(recipient.id);
			expect(submitted.note.visibleUserIds).toContain(recipient.id);
		} else {
			expect(submitted.request.visibleUserIds).toBeUndefined();
		}
		await expect(composer).toBeHidden();
	}
});

test('非公开回复继承范围且频道回复沿用公开仅本地规则', /** 常驻内联表单和频道场景必须复用同一业务实现。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: recipient.token, text: 'followers parent', visibility: 'followers' });
	await visitComposerHost(page, `/notes/${original.createdNote.id}`);
	const inline: Locator = page.getByTestId('twitter-reply-composer');
	await expect(inline.getByTestId('twitter-composer-policy')).toContainText('仅关注者');
	const reply: SubmittedNote = await submitNote(page, inline, 'followers inline reply');
	expect(reply.request.replyId).toBe(original.createdNote.id);
	expect(reply.request.visibility).toBe('followers');
	expect(reply.note.visibility).toBe('followers');
	const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: account.token, name: 'composer channel', description: 'Isolated composer test channel.', color: '#8754a1' });
	const channelParent: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, channelId: channel.id, text: 'channel parent' });
	await page.goto(`${BASE_URL}/notes/${channelParent.createdNote.id}?ui=twitter`);
	await expect(inline.getByRole('button', { name: '可见性', exact: true })).toHaveCount(0);
	await expect(inline.getByRole('button', { name: '仅限本地', exact: true })).toBeDisabled();
	const channelReply: SubmittedNote = await submitNote(page, inline, 'channel inline reply');
	expect(channelReply.request.channelId).toBe(channel.id);
	expect(channelReply.request.replyId).toBe(channelParent.createdNote.id);
	expect(channelReply.request.visibility).toBe('public');
	expect(channelReply.request.localOnly).toBe(true);
	expect(channelReply.note.channelId).toBe(channel.id);
});

test('默认界面继续使用原表单与真实发布流程', /** Twitter 局部样式和展示组件不扩散到原生模板。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await visitComposerHost(page, '/', 'default');
	await page.getByTestId('open-post-form').filter({ visible: true }).first().click();
	const text: Locator = page.getByTestId('post-form-text').filter({ visible: true }).last();
	await expect(text).toBeVisible();
	await expect(page.getByTestId('twitter-composer-policy')).toHaveCount(0);
	await expect(page.getByTestId('twitter-composer-toolbar')).toHaveCount(0);
	await text.fill('default composer remains functional');
	const pending: Promise<Response> = page.waitForResponse(/** 默认表单也必须收到真实创建成功回执。 */ (response: Response): boolean => response.url().endsWith('/api/notes/create') && response.ok());
	await page.getByTestId('post-form-submit').filter({ visible: true }).last().click();
	const response: Response = await pending;
	const result: Misskey.Endpoints['notes/create']['res'] = await response.json();
	expect(result.createdNote.text).toBe('default composer remains functional');
	await expect(text).toBeHidden();
});
