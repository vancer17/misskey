/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：头像挂件管理页与管理编辑器的真实后端回归。
 * 数据链：隔离实例的真实账户／角色／图片 → 弹窗上传或选择素材 → 管理新增、编辑、删除 → 服务端目录与设置页回访。
 * 成功业务响应全部来自后端；失败与竞态场景仅中断或延迟真实传输。
 * 测试不检测或启动运维环境，不读取开发账户；截图是本次验收证据，不自动建立视觉基线。
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { APIResponse, ConsoleMessage, FileChooser, Locator, Page, PlaywrightTestArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 隔离实例中签发的真实管理员凭据，不写入截图或日志。 */
let admin: RegisteredUser;
/** 页面异常与缺失文案提示统一作为回归失败。 */
let errors: string[];
/** 复用已存在的透明挂件素材，上传及图像读取都访问真实后端。 */
const framePng: Buffer = readFileSync(new URL('./fixtures/avatar-decoration-frame.png', import.meta.url));

/** 沿用账户持久化协议登录，页面启动仍读取真实账户资料。 */
async function open(page: Page, path: string = '/avatar-decorations', ui: string = 'twitter'): Promise<void> {
	const me: AccountWithToken = { ...await api(BASE_URL, 'i', { i: admin.token }), token: admin.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 只注入已签发凭据和界面语言，不伪造业务事实。 */ (value: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(value));
		localStorage.setItem('lang', 'zh-CN');
	}, me);
	await page.goto(`${BASE_URL}${path}?ui=${ui}`);
}

/** 上传真实 PNG，返回后端生成的图片地址供表单填写。 */
async function uploadFrame(page: Page): Promise<string> {
	const uploaded: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: { i: admin.token, file: { name: 'manager-frame.png', mimeType: 'image/png', buffer: framePng } },
	});
	expect(uploaded.ok()).toBe(true);
	const file: Misskey.entities.DriveFile = await uploaded.json();
	return file.url;
}

/** 操作真实上传按钮和文件选择器，返回服务端生成的素材实体，不绕过弹窗上传链。 */
async function uploadFrameThroughEditor(page: Page, name: string = 'manager-editor-frame.png'): Promise<Misskey.entities.DriveFile> {
	const choosing: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByTestId('decoration-manager-upload').click();
	const chooser: FileChooser = await choosing;
	const uploading: Promise<Response> = page.waitForResponse(/** 仅等待本次浏览器发出的真实素材上传回执。 */ (response: Response): boolean => response.url().endsWith('/api/drive/files/create') && response.request().method() === 'POST');
	await chooser.setFiles({ name, mimeType: 'image/png', buffer: framePng });
	const uploaded: Response = await uploading;
	expect(uploaded.ok()).toBe(true);
	const file: Misskey.entities.DriveFile = await uploaded.json();
	await expect(page.getByTestId('decoration-manager-material-status')).toContainText('素材已上传');
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	return file;
}

/** 只读管理目录，断言依据服务端回执而非组件中的表单草稿。 */
async function directory(): Promise<Misskey.entities.AdminAvatarDecorationsListResponse> {
	return await api(BASE_URL, 'admin/avatar-decorations/list', { i: admin.token });
}

/** 建立可被挂件选中的真实公开手动角色。 */
async function createRole(): Promise<Misskey.entities.Role> {
	return await api(BASE_URL, 'admin/roles/create', {
		i: admin.token, name: '管理验收角色', description: '', color: null, iconUrl: null,
		target: 'manual', condFormula: {}, isPublic: true, isModerator: false, isAdministrator: false,
		asBadge: false, canEditMembersByModerator: false, displayOrder: 0, policies: {},
	});
}

/** 按实体标识定位可键盘操作的管理卡片，避免同名条目造成歧义。 */
function card(page: Page, id: string): Locator {
	return page.getByTestId('decoration-manager-card').and(page.locator(`[data-decoration-id="${id}"]`));
}

/** 通过真实输入框填写说明字段，素材仍由所选输入路径提供。 */
async function fillDetails(page: Page, name: string, category: string = '管理验收'): Promise<void> {
	await page.getByTestId('decoration-manager-name').locator('input').fill(name);
	await page.getByTestId('decoration-manager-category').locator('input').fill(category);
	await page.getByTestId('decoration-manager-description').locator('textarea').fill(`${name} 的透明边框`);
}

/** 使用辅助图片地址路径填写草稿，展开实际控件而不修改组件状态。 */
async function fillDraft(page: Page, name: string, url: string, category: string = '管理验收'): Promise<void> {
	const input: Locator = page.getByTestId('decoration-manager-url').locator('input');
	if (!await input.isVisible()) await page.getByTestId('decoration-manager-url-toggle').locator('summary').click();
	await input.fill(url);
	await fillDetails(page, name, category);
}

/** 挂件自身的两张图片必须经浏览器成功解码，不能以用户头像代替预览成功。 */
async function expectPreviewLoaded(page: Page, url: string): Promise<void> {
	await expect.poll(/** 只查询真实 DOM 的图片载入状态，不写入组件或伪造图像。 */ async (): Promise<boolean> => page.getByTestId('decoration-manager-preview').locator('img').evaluateAll(
		/** 用真实上传地址区分挂件与管理员头像，核对亮暗两个预览。 */
		(images: HTMLImageElement[], expectedUrl: string): boolean => {
			const decorations: HTMLImageElement[] = images.filter(/** 原始地址对应正在编辑的同一图片草稿。 */ (image: HTMLImageElement): boolean => image.getAttribute('src') === expectedUrl);
			return decorations.length === 2 && decorations.every(/** 只有实际解码出尺寸才表示图片可见。 */ (image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0);
		}, url,
	)).toBe(true);
}

/** 截图前等待实际启动遮罩退出、字体就绪及有限动画完成，保持页面原有表现。 */
async function captureScreenshot(page: Page, path: string): Promise<void> {
	await page.locator('#splash').waitFor({ state: 'detached' });
	await page.evaluate(/** 等待实际字体加载完成，不改变字体或注入样式。 */ async (): Promise<void> => { await document.fonts.ready; });
	await expect.poll(/** 实时核对动画状态，避免持有折叠区域已结束但未交付的 finished Promise。 */ async (): Promise<number> => page.evaluate(
		/** 只读取浏览器当前的有限动画，持续循环动画保持原样。 */
		(): number => document.getAnimations().filter(/** 入场、退出及按钮波纹均按实际运行状态等待结束。 */ (animation: Animation): boolean => {
			const endTime: number = Number(animation.effect?.getComputedTiming().endTime);
			return Number.isFinite(endTime) && (animation.playState === 'running' || animation.pending);
		}).length,
	), { message: '截图前有限动画应已结束或被取消' }).toBe(0);
	await page.screenshot({ path });
}

/** 实测滚动区和固定操作区的关系，同时确认既有全局滚动条样式继续生效。 */
async function expectEditorLayout(page: Page, drawer: boolean): Promise<void> {
	await page.getByTestId('decoration-manager-editor').evaluate(/** 等待实际观察到的有限入场动画结束，不修改时长、禁用动画或放宽布局容差。 */ async (element: HTMLElement): Promise<void> => {
		const animations: Animation[] = [];
		let ancestor: HTMLElement | null = element;
		while (ancestor !== null) {
			for (const animation of ancestor.getAnimations()) {
				const endTime: number = Number(animation.effect?.getComputedTiming().endTime);
				if (Number.isFinite(endTime) && (animation.playState === 'running' || animation.pending)) animations.push(animation);
			}
			ancestor = ancestor.parentElement;
		}
		await Promise.allSettled(animations.map(/** 动画完成或被浏览器取消都结束本次已观察到的运动。 */ (animation: Animation): Promise<Animation> => animation.finished));
	});
	const footer: Locator = page.getByTestId('decoration-manager-footer');
	const previewColors: string[] = await page.getByTestId('decoration-manager-preview').locator('section').evaluateAll(/** 验证双背景在当前主题中实际不同，而非仅有亮暗标签。 */ (elements: HTMLElement[]): string[] => elements.map(/** 读取浏览器最终颜色，包括 light-dark 与 color-scheme 的解析结果。 */ (element: HTMLElement): string => getComputedStyle(element).backgroundColor));
	expect(previewColors).toHaveLength(2);
	expect(new Set(previewColors).size).toBe(2);
	await expect(page.getByTestId('decoration-manager-save')).toBeInViewport();
	await expect(page.getByTestId('decoration-manager-cancel')).toBeInViewport();
	const originalBottom: number = await footer.evaluate(/** 记录正文滚动前的操作区位置。 */ (element: HTMLElement): number => element.getBoundingClientRect().bottom);
	await page.getByTestId('decoration-manager-roles').scrollIntoViewIfNeeded();
	const geometry: { footerOverflowX: number; footerOverflowY: number; bodyOverflowX: number; bodyScrolls: boolean; sameScrollbar: boolean; thinScrollbar: boolean; footerBottom: number; fitsViewport: boolean; isDrawer: boolean } = await footer.evaluate(
		/** 仅查询公开 DOM 与 computed style，不依赖生成类名或私有实例。 */
		(element: HTMLElement): { footerOverflowX: number; footerOverflowY: number; bodyOverflowX: number; bodyScrolls: boolean; sameScrollbar: boolean; thinScrollbar: boolean; footerBottom: number; fitsViewport: boolean; isDrawer: boolean } => {
			const footerHost: HTMLElement | null = element.parentElement;
			const root: HTMLElement | null = footerHost?.parentElement ?? null;
			const body: HTMLElement | null = root?.querySelector<HTMLElement>('[data-testid="decoration-manager-editor"]')?.parentElement ?? null;
			const bounds: DOMRect | undefined = root?.getBoundingClientRect();
			const bodyStyle: CSSStyleDeclaration | null = body ? getComputedStyle(body) : null;
			return {
				footerOverflowX: footerHost ? footerHost.scrollWidth - footerHost.clientWidth : Infinity,
				footerOverflowY: footerHost ? footerHost.scrollHeight - footerHost.clientHeight : Infinity,
				bodyOverflowX: body ? body.scrollWidth - body.clientWidth : Infinity,
				bodyScrolls: body !== null && body.scrollHeight > body.clientHeight && bodyStyle?.overflowY === 'auto',
				sameScrollbar: bodyStyle?.scrollbarColor === getComputedStyle(document.documentElement).scrollbarColor,
				thinScrollbar: bodyStyle?.scrollbarWidth === 'thin',
				footerBottom: element.getBoundingClientRect().bottom,
				fitsViewport: bounds !== undefined && bounds.left >= -1 && bounds.top >= -1 && bounds.right <= window.innerWidth + 1 && bounds.bottom <= window.innerHeight + 1,
				isDrawer: bounds !== undefined && Math.abs(bounds.left) <= 1 && Math.abs(bounds.right - window.innerWidth) <= 1 && Math.abs(bounds.bottom - window.innerHeight) <= 1,
			};
		},
	);
	expect(geometry.footerOverflowX).toBeLessThanOrEqual(1);
	expect(geometry.footerOverflowY).toBeLessThanOrEqual(1);
	expect(geometry.bodyOverflowX).toBeLessThanOrEqual(1);
	expect(geometry.bodyScrolls).toBe(true);
	expect(geometry.sameScrollbar).toBe(true);
	expect(geometry.thinScrollbar).toBe(true);
	expect(Math.abs(geometry.footerBottom - originalBottom)).toBeLessThanOrEqual(1);
	expect(geometry.fitsViewport).toBe(true);
	expect(geometry.isDrawer).toBe(drawer);
	await expect(page.getByTestId('decoration-manager-save')).toBeInViewport();
	await expect(page.getByTestId('decoration-manager-cancel')).toBeInViewport();
}

/** 每个场景使用新建的真实隔离实例账户，复用后端提供的向导完成标记。 */
test.beforeEach(async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	errors = [];
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'decor_manager_admin', 'decoration-manager-test-password', true);
	await api(BASE_URL, 'i/registry/set', { i: admin.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	page.on('pageerror', /** 保存异常文本，避免日志包含请求凭据。 */ (error: Error): void => { errors.push(error.message); });
	page.on('console', /** 缺键及参数错误不得被当成已经翻译的文案。 */ (message: ConsoleMessage): void => {
		if (/Unexpected locale key|Missing locale parameters/.test(message.text())) errors.push(message.text());
	});
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.emulateMedia({ colorScheme: 'dark' });
});

/** 网络失败和取消都必须被业务界面接住，不能泄漏为全局异常。 */
test.afterEach((): void => { expect(errors).toEqual([]); });

test('空目录的中文管理入口可键盘打开，取消不写入', /** 真实空目录同时覆盖页面背景和窄屏横向布局。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	let writes: number = 0;
	page.on('request', /** 只统计管理写操作，不把目录读取计入提交。 */ (request: Request): void => {
		if (/\/api\/admin\/avatar-decorations\/(create|update|delete)$/.test(request.url())) writes++;
	});
	await open(page);
	await expect(page.getByTestId('avatar-decoration-manager')).toBeVisible();
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	await expect(page.getByTestId('decoration-manager-add')).toContainText('添加');
	await captureScreenshot(page, info.outputPath('manager-empty-desktop-dark.png'));
	await page.getByTestId('decoration-manager-add').focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('decoration-manager-editor')).toBeVisible();
	await expect(page.getByText('New decoration', { exact: true })).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-upload')).toHaveText('上传素材');
	await expect(page.getByTestId('decoration-manager-upload')).toBeInViewport();
	await expect(page.getByTestId('decoration-manager-preview-title')).toHaveText('佩戴效果预览');
	await expect(page.getByTestId('decoration-manager-preview-empty')).toContainText('尚未选择挂件素材');
	await expect(page.getByTestId('decoration-manager-preview')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toBeHidden();
	await expect(page.getByTestId('decoration-manager-save')).toBeDisabled();
	await captureScreenshot(page, info.outputPath('manager-editor-material-empty.png'));
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	await page.getByTestId('decoration-manager-add').click();
	await page.getByTestId('decoration-manager-name').locator('input').fill('取消的草稿');
	await page.getByTestId('decoration-manager-cancel').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect(await directory()).toEqual([]);
	expect(writes).toBe(0);
	for (const width of [390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
		const overflow: number = await page.getByTestId('avatar-decoration-manager').evaluate(/** 不能靠裁切内容掩盖横向溢出。 */ (element: HTMLElement): number => element.scrollWidth - element.clientWidth);
		expect(overflow).toBeLessThanOrEqual(1);
		await captureScreenshot(page, info.outputPath(`manager-empty-${width}.png`));
	}
});

test('设置进入管理后实际新增、编辑、删除，并在返回时刷新目录', /** 全流程通过管理表单提交，角色、分类与描述均由服务端回执核验。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	let creates: number = 0;
	page.on('request', /** 素材准备不能暗中创建挂件，只有明确保存才产生创建请求。 */ (request: Request): void => { if (request.url().endsWith('/api/admin/avatar-decorations/create')) creates++; });
	const role: Misskey.entities.Role = await createRole();
	await open(page, '/settings/avatar-decoration');
	await expect(page.getByTestId('decoration-empty')).toBeVisible();
	await page.getByTestId('decoration-manage').click();
	await expect(page.getByTestId('avatar-decoration-manager')).toBeVisible();
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	await page.getByTestId('decoration-manager-add').click();
	const uploaded: Misskey.entities.DriveFile = await uploadFrameThroughEditor(page);
	const url: string = uploaded.url;
	await expectPreviewLoaded(page, url);
	await expect(page.getByTestId('decoration-manager-preview').getByText('浅色背景预览', { exact: true })).toBeVisible();
	await expect(page.getByTestId('decoration-manager-preview').getByText('深色背景预览', { exact: true })).toBeVisible();
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toBeHidden();
	expect(await directory()).toEqual([]);
	expect(creates).toBe(0);
	await fillDetails(page, '管理新增星环', '精选');
	await page.getByTestId('decoration-manager-role-add').click();
	await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(1);
	const roleDialog: Locator = page.getByTestId('modal-dialog-ok').locator('..').locator('..');
	const roleSelect: Locator = roleDialog.locator('[tabindex="0"]');
	await roleSelect.focus();
	await page.keyboard.press('Space');
	await page.getByText(role.name, { exact: true }).click();
	await expect(roleSelect).toContainText(role.name);
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-role-row')).toHaveAttribute('data-role-id', role.id);
	await expectEditorLayout(page, false);
	await page.getByTestId('decoration-manager-preview').scrollIntoViewIfNeeded();
	await expectPreviewLoaded(page, url);
	await captureScreenshot(page, info.outputPath('manager-editor-desktop-dark.png'));
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	const createdDirectory: Misskey.entities.AdminAvatarDecorationsListResponse = await directory();
	expect(createdDirectory).toHaveLength(1);
	expect(creates).toBe(1);
	const created: Misskey.entities.AdminAvatarDecorationsListResponse[number] = createdDirectory[0];
	expect(created).toMatchObject({ name: '管理新增星环', url, category: '精选', description: '管理新增星环 的透明边框', roleIdsThatCanBeUsedThisDecoration: [role.id] });
	await expect(card(page, created.id)).toContainText('管理新增星环');
	await captureScreenshot(page, info.outputPath('manager-directory-desktop-dark.png'));
	await page.goBack();
	await expect(page.getByTestId('decoration-card').and(page.locator(`[data-decoration-id="${created.id}"]`))).toContainText('管理新增星环');
	await page.getByTestId('decoration-manage').click();
	await card(page, created.id).focus();
	await page.keyboard.press('Enter');
	await fillDraft(page, '管理编辑星环', url, '编辑后分类');
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect((await directory())[0]).toMatchObject({ id: created.id, name: '管理编辑星环', category: '编辑后分类', roleIdsThatCanBeUsedThisDecoration: [role.id] });
	await page.goBack();
	await expect(page.getByTestId('decoration-card').and(page.locator(`[data-decoration-id="${created.id}"]`))).toContainText('管理编辑星环');
	await page.getByTestId('decoration-manage').click();
	await card(page, created.id).click();
	await page.getByTestId('decoration-manager-delete').click();
	await page.getByTestId('modal-dialog-cancel').click();
	await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-editor')).toBeVisible();
	expect(await directory()).toHaveLength(1);
	await page.getByTestId('decoration-manager-delete').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect(await directory()).toEqual([]);
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	await page.goBack();
	await expect(page.getByTestId('decoration-empty')).toBeVisible();
});

test('素材选择取消和非图片文件不改变草稿，取消添加保留已上传素材', /** 本地选择器和网盘取消都回到同一草稿，素材与挂件创建具有独立生命周期。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	let uploads: number = 0;
	page.on('request', /** 非图片与空选择不得产生额外上传请求。 */ (request: Request): void => { if (request.url().endsWith('/api/drive/files/create')) uploads++; });
	await open(page);
	await page.getByTestId('decoration-manager-add').click();
	const uploaded: Misskey.entities.DriveFile = await uploadFrameThroughEditor(page);
	await fillDetails(page, '取消前保留的草稿', '保留分类');
	const choosing: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByTestId('decoration-manager-upload').click();
	const chooser: FileChooser = await choosing;
	await chooser.setFiles([]);
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	await expect(page.getByTestId('decoration-manager-material-error')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(uploaded.url);
	const choosingInvalid: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByTestId('decoration-manager-upload').click();
	const invalidChooser: FileChooser = await choosingInvalid;
	await invalidChooser.setFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
	await expect(page.getByTestId('decoration-manager-material-error')).toContainText('图片');
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	await expect(page.getByTestId('decoration-manager-file-input')).toHaveValue('');
	expect(uploads).toBe(1);
	await page.getByTestId('decoration-manager-drive').click();
	await expect(page.getByTestId('decoration-manager-upload')).toBeDisabled();
	await expect(page.getByText('选择文件', { exact: true })).toBeVisible();
	await page.mouse.click(8, 8);
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	await expect(page.getByText('选择文件', { exact: true })).toHaveCount(0);
	await page.getByTestId('decoration-manager-url-toggle').locator('summary').click();
	await page.getByTestId('decoration-manager-url').locator('input').fill('');
	await expect(page.getByTestId('decoration-manager-preview-empty')).toBeVisible();
	await page.getByTestId('decoration-manager-drive').click();
	await page.locator('[draggable="true"]').filter({ has: page.getByText(uploaded.name, { exact: true }) }).click();
	await page.getByRole('button', { name: '完成' }).click();
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	await expect(page.getByTestId('decoration-manager-material-status')).toContainText('已选择网盘素材');
	expect(uploads).toBe(1);
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(uploaded.url);
	await expect(page.getByTestId('decoration-manager-name').locator('input')).toHaveValue('取消前保留的草稿');
	await expect(page.getByTestId('decoration-manager-category').locator('input')).toHaveValue('保留分类');
	await expectPreviewLoaded(page, uploaded.url);
	await page.getByTestId('decoration-manager-cancel').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect(await directory()).toEqual([]);
	const retained: Misskey.entities.DriveFile = await api(BASE_URL, 'drive/files/show', { i: admin.token, fileId: uploaded.id });
	expect(retained.url).toBe(uploaded.url);
});

test('更换素材断网后保留原图，同文件重试及保存重试不重复上传', /** 上传和更新分别破坏一次真实传输，成功回执与最终实体均由真实后端提供。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const originalUrl: string = await uploadFrame(page);
	const original: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await api(BASE_URL, 'admin/avatar-decorations/create', { i: admin.token, name: '原挂件', description: '', url: originalUrl });
	let uploads: number = 0;
	page.on('request', /** 保存重试不得重新上传已经存在的素材。 */ (request: Request): void => { if (request.url().endsWith('/api/drive/files/create')) uploads++; });
	await open(page);
	await card(page, original.id).click();
	await fillDetails(page, '更换后保存的挂件', '保留编辑分类');
	await page.route('**/api/drive/files/create', /** 只中断浏览器上传链，验证传输失败会结束忙碌状态。 */ async (route: Route): Promise<void> => { await route.abort(); });
	const choosing: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByTestId('decoration-manager-upload').click();
	const chooser: FileChooser = await choosing;
	await chooser.setFiles({ name: 'manager-retry-frame.png', mimeType: 'image/png', buffer: framePng });
	await expect(page.getByTestId('decoration-manager-material-error')).toContainText('素材上传失败');
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	await expect(page.getByTestId('decoration-manager-save')).toBeEnabled();
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(originalUrl);
	await expect(page.getByTestId('decoration-manager-name').locator('input')).toHaveValue('更换后保存的挂件');
	await expect(page.getByTestId('decoration-manager-category').locator('input')).toHaveValue('保留编辑分类');
	await expectPreviewLoaded(page, originalUrl);
	expect((await directory())[0]).toMatchObject({ id: original.id, name: '原挂件', url: originalUrl });
	await page.unroute('**/api/drive/files/create');
	const replacement: Misskey.entities.DriveFile = await uploadFrameThroughEditor(page, 'manager-retry-frame.png');
	await expectPreviewLoaded(page, replacement.url);
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(replacement.url);
	expect(uploads).toBe(2);
	await page.route('**/api/admin/avatar-decorations/update', /** 保存失败不撤销已成功的素材上传。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-save-error')).toContainText('保存失败');
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(replacement.url);
	expect(uploads).toBe(2);
	await page.unroute('**/api/admin/avatar-decorations/update');
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect((await directory())[0]).toMatchObject({ id: original.id, name: '更换后保存的挂件', url: replacement.url, category: '保留编辑分类' });
	expect(uploads).toBe(2);
});

test('上传回执未交付时可以取消，迟到结果不覆盖原素材', /** 只延迟真实上传响应，主动取消不得变成错误提示或清空原草稿。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const originalUrl: string = await uploadFrame(page);
	await open(page);
	await page.getByTestId('decoration-manager-add').click();
	await fillDraft(page, '上传取消后仍可保存', originalUrl);
	let release: () => void = /** 尚未持有回执时没有需要释放的响应。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 保留真实上传回执直到用户取消本次传输。 */ (resolve: () => void): void => { release = resolve; });
	let ready: () => void = /** 通知真实后端已经接受本次素材。 */ (): void => {};
	const received: Promise<void> = new Promise(/** 确保取消发生在回执尚未交付时。 */ (resolve: () => void): void => { ready = resolve; });
	await page.route('**/api/drive/files/create', /** 不伪造上传成功，已被浏览器取消的请求不再交付回执。 */ async (route: Route): Promise<void> => {
		const response: APIResponse = await route.fetch();
		ready();
		await gate;
		if (route.request().failure() === null) {
			await route.fulfill({ response });
		} else {
			await route.abort();
		}
	});
	try {
		const choosing: Promise<FileChooser> = page.waitForEvent('filechooser');
		await page.getByTestId('decoration-manager-upload').click();
		const chooser: FileChooser = await choosing;
		await chooser.setFiles({ name: 'manager-canceled-frame.png', mimeType: 'image/png', buffer: framePng });
		await received;
		await expect(page.getByTestId('decoration-manager-save')).toBeDisabled();
		await expect(page.getByTestId('decoration-manager-upload')).toBeDisabled();
		await expect(page.getByTestId('decoration-manager-drive')).toBeDisabled();
		const canceled: Promise<Request> = page.waitForEvent('requestfailed', { predicate: /** 等待真实 XHR 中止后再释放所持回执。 */ (request: Request): boolean => request.url().endsWith('/api/drive/files/create') });
		await page.getByTestId('decoration-manager-upload-cancel').click();
		await canceled;
		await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
		await expect(page.getByTestId('decoration-manager-material-error')).toHaveCount(0);
		await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(originalUrl);
		release();
		await page.unrouteAll({ behavior: 'wait' });
		await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(originalUrl);
		await expectPreviewLoaded(page, originalUrl);
		await page.getByTestId('decoration-manager-save').click();
		await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
		expect((await directory())[0]).toMatchObject({ name: '上传取消后仍可保存', url: originalUrl });
	} finally { release(); }
});

test('写入回执到达前阻止重复提交、ESC 与背景关闭', /** 后端已经执行真实创建，仅延迟回执以覆盖 busy 边界。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const url: string = await uploadFrame(page);
	await open(page);
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	await page.getByTestId('decoration-manager-add').click();
	await fillDraft(page, '仅创建一次', url);
	let release: () => void = /** 捕获请求前没有待释放响应。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 控制真实回执到达窗口。 */ (resolve: () => void): void => { release = resolve; });
	let ready: () => void = /** 通知真实写入已完成。 */ (): void => {};
	const received: Promise<void> = new Promise(/** 重复操作发生在回执仍未交付时。 */ (resolve: () => void): void => { ready = resolve; });
	let writes: number = 0;
	await page.route('**/api/admin/avatar-decorations/create', /** 不伪造成功响应，只延后真实响应的交付。 */ async (route: Route): Promise<void> => {
		writes++;
		const response: APIResponse = await route.fetch();
		ready();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await page.getByTestId('decoration-manager-save').click();
		await received;
		await expect(page.getByTestId('decoration-manager-save')).toBeDisabled();
		await expect(page.getByTestId('decoration-manager-cancel')).toBeDisabled();
		const point: { x: number; y: number } = await page.getByTestId('decoration-manager-save').evaluate(/** 重复点击真实屏幕坐标，不调用组件方法。 */ (element: HTMLElement): { x: number; y: number } => {
			const bounds: DOMRect = element.getBoundingClientRect();
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		});
		await page.mouse.dblclick(point.x, point.y);
		await page.keyboard.press('Escape');
		await page.mouse.click(8, 8);
		await expect(page.getByTestId('decoration-manager-editor')).toBeVisible();
		await expect(page.getByTestId('modal-window-close')).toHaveCount(0);
		expect(writes).toBe(1);
		expect(await directory()).toHaveLength(1);
		release();
		await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
		await expect(page.getByTestId('decoration-manager-card')).toHaveCount(1);
		expect(writes).toBe(1);
	} finally { release(); }
});

test('写入或删除失败保留草稿和目录，重试提交真实结果', /** 只中断网络传输，验证业务错误在编辑器内可见且可恢复。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const url: string = await uploadFrame(page);
	await open(page);
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	await page.getByTestId('decoration-manager-add').click();
	await page.route(url, /** 只阻断真实上传图片的传输，触发浏览器图片错误。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await fillDraft(page, '失败后保留的草稿', url, '不丢失分类');
	await expect(page.getByTestId('decoration-manager-image-error')).toBeVisible();
	await expect(page.getByTestId('decoration-manager-name').locator('input')).toHaveValue('失败后保留的草稿');
	await page.unroute(url);
	await page.getByTestId('decoration-manager-image-error').getByRole('button').click();
	await expect(page.getByTestId('decoration-manager-image-error')).toHaveCount(0);
	await expectPreviewLoaded(page, url);
	await expect(page.getByTestId('decoration-manager-name').locator('input')).toHaveValue('失败后保留的草稿');
	await expect(page.getByTestId('decoration-manager-category').locator('input')).toHaveValue('不丢失分类');
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(url);
	await expect(page.getByTestId('decoration-manager-description').locator('textarea')).toHaveValue('失败后保留的草稿 的透明边框');
	expect(await directory()).toEqual([]);
	await page.route('**/api/admin/avatar-decorations/create', /** 首次提交无法到达后端。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-save-error')).toContainText('保存失败');
	await expect(page.getByTestId('decoration-manager-name').locator('input')).toHaveValue('失败后保留的草稿');
	await expect(page.getByTestId('decoration-manager-category').locator('input')).toHaveValue('不丢失分类');
	await expect(page.getByTestId('decoration-manager-url').locator('input')).toHaveValue(url);
	expect(await directory()).toEqual([]);
	await expectEditorLayout(page, false);
	await captureScreenshot(page, info.outputPath('manager-write-error-desktop.png'));
	await page.unroute('**/api/admin/avatar-decorations/create');
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	const created: Misskey.entities.AdminAvatarDecorationsListResponse[number] = (await directory())[0];
	await card(page, created.id).click();
	await page.route('**/api/admin/avatar-decorations/delete', /** 删除失败不得提前删除目录或关闭编辑器。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-delete').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-manager-save-error')).toContainText('删除失败');
	await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-editor')).toBeVisible();
	expect(await directory()).toHaveLength(1);
	await page.unroute('**/api/admin/avatar-decorations/delete');
	await page.getByTestId('decoration-manager-delete').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect(await directory()).toEqual([]);
});

test('写入成功但刷新失败明确提示已保存，并以重读恢复权威目录', /** 创建不重复提交；无实体回执的更新不能把表单冒充后端实体。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const url: string = await uploadFrame(page);
	await open(page);
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	let creates: number = 0;
	page.on('request', /** 记录真实创建次数，证明刷新失败不重新提交。 */ (request: Request): void => { if (request.url().endsWith('/api/admin/avatar-decorations/create')) creates++; });
	await page.getByTestId('decoration-manager-add').click();
	await fillDraft(page, '写入已经成功', url);
	await page.route('**/api/admin/avatar-decorations/list', /** 只破坏写入后的目录读取。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-feedback')).toContainText('刷新失败');
	const confirmed: Misskey.entities.AdminAvatarDecorationsListResponse = await directory();
	expect(confirmed).toHaveLength(1);
	expect(creates).toBe(1);
	await page.unroute('**/api/admin/avatar-decorations/list');
	await page.getByTestId('decoration-manager-refresh').click();
	await expect(card(page, confirmed[0].id)).toContainText('写入已经成功');
	await card(page, confirmed[0].id).click();
	await page.getByTestId('decoration-manager-name').locator('input').fill('更新也已经成功');
	await page.route('**/api/admin/avatar-decorations/list', /** 更新接口没有实体回执，读取失败时必须保留旧目录事实。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	await expect(page.getByTestId('decoration-manager-feedback')).toContainText('刷新失败');
	expect((await directory())[0].name).toBe('更新也已经成功');
	await expect(card(page, confirmed[0].id)).toContainText('写入已经成功');
	await expect(card(page, confirmed[0].id)).not.toContainText('更新也已经成功');
	await page.unroute('**/api/admin/avatar-decorations/list');
	await page.getByTestId('decoration-manager-refresh').click();
	await expect(card(page, confirmed[0].id)).toContainText('更新也已经成功');
	expect(creates).toBe(1);
});

test('首读错误可重试，后续刷新失败保留已有目录', /** 初次错误、真正空目录和刷新错误具有可区分的状态。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.route('**/api/admin/avatar-decorations/list', /** 首拉失败不伪造成空目录成功。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await open(page);
	await expect(page.getByTestId('decoration-manager-error')).toBeVisible();
	await expect(page.getByTestId('decoration-manager-empty')).toHaveCount(0);
	await page.unroute('**/api/admin/avatar-decorations/list');
	await page.getByTestId('decoration-manager-refresh').click();
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	const url: string = await uploadFrame(page);
	const existing: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await api(BASE_URL, 'admin/avatar-decorations/create', { i: admin.token, name: '保留已知目录', description: '', url });
	await page.getByTestId('decoration-manager-refresh').click();
	await expect(card(page, existing.id)).toBeVisible();
	await page.route('**/api/admin/avatar-decorations/list', /** 已有结果的刷新失败不能清空目录。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-manager-refresh').click();
	await expect(page.getByTestId('decoration-manager-refresh-error')).toContainText('刷新失败');
	await expect(card(page, existing.id)).toBeVisible();
	await expect(page.getByTestId('decoration-manager-empty')).toHaveCount(0);
});

test('首次目录未返回时创建失败仍恢复目录状态', /** 写入使首拉失效后，失败恢复不能留下既无加载又无错误的空白区域。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const url: string = await uploadFrame(page);
	let release: () => void = /** 旧目录尚未捕获时无需释放。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 延迟真实首次空目录响应。 */ (resolve: () => void): void => { release = resolve; });
	let ready: () => void = /** 通知初次查询已经在真实后端完成。 */ (): void => {};
	const captured: Promise<void> = new Promise(/** 创建必须发生在首拉仍被持有的时段。 */ (resolve: () => void): void => { ready = resolve; });
	let held: boolean = false;
	await page.route('**/api/admin/avatar-decorations/list', /** 恢复读取访问真实后端，只有首次空响应被延迟。 */ async (route: Route): Promise<void> => {
		if (held) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		expect(await response.json()).toEqual([]);
		ready();
		await gate;
		await route.fulfill({ response });
	});
	await page.route('**/api/admin/avatar-decorations/create', /** 中断写入，触发被取消首拉的恢复分支。 */ async (route: Route): Promise<void> => { await route.abort(); });
	try {
		await open(page);
		await expect(page.getByTestId('avatar-decoration-manager')).toBeVisible();
		await captured;
		await page.getByTestId('decoration-manager-add').click();
		await fillDraft(page, '首拉期间失败的草稿', url);
		await page.getByTestId('decoration-manager-save').click();
		await expect(page.getByTestId('decoration-manager-save-error')).toContainText('保存失败');
		await expect(page.getByTestId('decoration-manager-name').locator('input')).toHaveValue('首拉期间失败的草稿');
		await page.getByTestId('decoration-manager-cancel').click();
		await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
		release();
		await page.unrouteAll({ behavior: 'wait' });
		await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
		expect(await directory()).toEqual([]);
	} finally { release(); }
});

test('回访后迟到的旧空目录响应不能覆盖新目录', /** 保留首个真实空响应，在路由离开及真实新增后再交付。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	let release: () => void = /** 捕获响应前无需释放。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 固定旧响应迟到的交付时机。 */ (resolve: () => void): void => { release = resolve; });
	let ready: () => void = /** 通知后端已查询出空目录。 */ (): void => {};
	const captured: Promise<void> = new Promise(/** 新增数据必须发生在旧查询完成之后。 */ (resolve: () => void): void => { ready = resolve; });
	let held: boolean = false;
	await page.route('**/api/admin/avatar-decorations/list', /** 首次响应延迟，其余读取直接访问后端。 */ async (route: Route): Promise<void> => {
		if (held) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		expect(await response.json()).toEqual([]);
		ready();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await open(page);
		await expect(page.getByTestId('avatar-decoration-manager')).toBeVisible();
		await captured;
		await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
		const url: string = await uploadFrame(page);
		const created: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await api(BASE_URL, 'admin/avatar-decorations/create', { i: admin.token, name: '回访的新挂件', description: '', url });
		await page.goBack();
		await expect(card(page, created.id)).toBeVisible();
		release();
		await page.unrouteAll({ behavior: 'wait' });
		await expect(card(page, created.id)).toBeVisible();
		await expect(page.getByTestId('decoration-manager-empty')).toHaveCount(0);
	} finally { release(); }
});

test('默认界面与管理员别名路由复用编辑器，角色加载失败不丢失选择', /** 角色元数据读取失败时，保存必须保留服务端原有角色 ID。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const role: Misskey.entities.Role = await createRole();
	const url: string = await uploadFrame(page);
	const existing: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await api(BASE_URL, 'admin/avatar-decorations/create', {
		i: admin.token, name: '保留角色的挂件', description: '', url, roleIdsThatCanBeUsedThisDecoration: [role.id],
	});
	await open(page, '/admin/avatar-decorations', 'default');
	await expect(card(page, existing.id)).toBeVisible();
	await page.route('**/api/admin/roles/list', /** 不伪造角色资料，只让元数据传输失败。 */ async (route: Route): Promise<void> => { await route.abort(); });
	const failedLookup: Promise<Request> = page.waitForEvent('requestfailed', { predicate: /** 等待实际角色读取失败后再提交。 */ (request: Request): boolean => request.url().endsWith('/api/admin/roles/list') });
	await card(page, existing.id).click();
	await failedLookup;
	await expect(page.getByTestId('decoration-manager-role-row')).toHaveAttribute('data-role-id', role.id);
	await page.getByTestId('decoration-manager-name').locator('input').fill('角色查询失败后仍可保存');
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	expect((await directory())[0]).toMatchObject({ id: existing.id, name: '角色查询失败后仍可保存', roleIdsThatCanBeUsedThisDecoration: [role.id] });
	await page.unroute('**/api/admin/roles/list');
	await captureScreenshot(page, info.outputPath('manager-default-ui-alias.png'));
	await open(page, '/avatar-decorations', 'default');
	await expect(card(page, existing.id)).toContainText('角色查询失败后仍可保存');
});

test('桌面亮色编辑器沿用全局滚动条且操作区不随正文滚动', /** 图像来自真实上传，亮色对照不建立自动通过的新基线。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await page.emulateMedia({ colorScheme: 'light' });
	const url: string = await uploadFrame(page);
	await open(page);
	await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
	await captureScreenshot(page, info.outputPath('manager-empty-desktop-light.png'));
	await page.getByTestId('decoration-manager-add').click();
	await fillDraft(page, '亮色管理预览', url);
	await expectEditorLayout(page, false);
	await page.getByTestId('decoration-manager-preview').scrollIntoViewIfNeeded();
	await expectPreviewLoaded(page, url);
	await captureScreenshot(page, info.outputPath('manager-editor-desktop-light.png'));
	await page.getByTestId('decoration-manager-cancel').click();
	expect(await directory()).toEqual([]);
});

/** 真正的移动设备上下文触发现有抽屉行为，不把桌面缩窄当作手机模式。 */
test.describe('手机管理抽屉', (): void => {
	test.use({
		/** Chromium 移动布局上下文。 */
		isMobile: true,
		/** 使用触控输入覆盖移动操作按钮。 */
		hasTouch: true,
		/** 沿用仓库手机测试的设备识别入口。 */
		userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
	});
	/** 竖屏、紧凑屏、亮色与打开后横屏分别检查实际操作区。 */
	const cases: readonly [string, number, number, 'dark' | 'light', boolean][] = [
		['portrait-dark', 390, 844, 'dark', false],
		['compact-dark', 320, 568, 'dark', false],
		['portrait-light', 390, 844, 'light', false],
		['landscape-dark', 390, 844, 'dark', true],
	];
	for (const [name, width, height, colorScheme, landscape] of cases) {
		test(`${name}：新增、失败反馈与重试均可达`, /** 保留真实失败草稿，再通过同一按钮提交到后端。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
			await page.setViewportSize({ width, height });
			await page.emulateMedia({ colorScheme });
			const url: string = await uploadFrame(page);
			await open(page);
			await expect(page.getByTestId('decoration-manager-empty')).toBeVisible();
			await page.getByTestId('decoration-manager-add').tap();
			await fillDraft(page, '手机管理挂件', url);
			if (landscape) await page.setViewportSize({ width: 844, height: 390 });
			await expectEditorLayout(page, true);
			await page.getByTestId('decoration-manager-preview').scrollIntoViewIfNeeded();
			await expectPreviewLoaded(page, url);
			await captureScreenshot(page, info.outputPath(`manager-${name}-initial.png`));
			await page.route('**/api/admin/avatar-decorations/create', /** 首次提交仅模拟传输中断。 */ async (route: Route): Promise<void> => { await route.abort(); });
			await page.getByTestId('decoration-manager-save').tap();
			await expect(page.getByTestId('decoration-manager-save-error')).toContainText('保存失败');
			await expect(page.getByTestId('decoration-manager-save-error')).toBeInViewport();
			await expectEditorLayout(page, true);
			expect(await directory()).toEqual([]);
			await captureScreenshot(page, info.outputPath(`manager-${name}-error.png`));
			await page.unroute('**/api/admin/avatar-decorations/create');
			await page.getByTestId('decoration-manager-save').tap();
			await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
			const saved: Misskey.entities.AdminAvatarDecorationsListResponse = await directory();
			expect(saved).toHaveLength(1);
			expect(saved[0]).toMatchObject({ name: '手机管理挂件', url });
			await card(page, saved[0].id).tap();
			await expectEditorLayout(page, true);
			await expect(page.getByTestId('decoration-manager-delete')).toBeInViewport();
			await page.getByTestId('decoration-manager-preview').scrollIntoViewIfNeeded();
			await expectPreviewLoaded(page, url);
			await captureScreenshot(page, info.outputPath(`manager-${name}-edit.png`));
			await page.getByTestId('decoration-manager-cancel').tap();
			await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
			expect(await directory()).toHaveLength(1);
		});
	}
});
