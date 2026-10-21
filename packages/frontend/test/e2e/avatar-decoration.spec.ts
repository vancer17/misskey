/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：头像挂件设置的真实后端与浏览器回归。
 * 数据链：隔离实例的真实账户／角色／上传／目录 → 页面交互 → 服务端回执及实际头像。
 * 不 Mock 业务响应；失败与时序场景仅中断或延迟真实传输。不读取开发账户，不检测运维环境。
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page, Locator, Response, Request, Route, APIResponse, PlaywrightTestArgs, TestInfo, ConsoleMessage } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 测试进程内的真实账户凭据，截图与日志不输出令牌。 */
let admin: RegisteredUser;
let user: AccountWithToken;
let errors: string[];
/** 自制非对称透明边框，真实上传后可观察旋转、翻转及图像加载。 */
const framePng: Buffer = readFileSync(new URL('./fixtures/avatar-decoration-frame.png', import.meta.url));

/** 创建普通账户并使用既有向导完成标记，不伪造业务字段。 */
async function createUser(): Promise<AccountWithToken> {
	const created: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'decoration_user', password: 'decoration-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: created.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return { ...await api(BASE_URL, 'i', { i: created.token }), token: created.token };
}

/** 由当前真实账户重新取得会话，普通设置使用中文界面进行验收。 */
async function open(page: Page, path: string = '/settings/avatar-decoration', account: RegisteredUser = user, ui: string = 'twitter'): Promise<void> {
	const me: AccountWithToken = { ...await api(BASE_URL, 'i', { i: account.token }), token: account.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 写入既有会话存储协议，启动认证仍访问真实后端。 */ (value: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(value));
		localStorage.setItem('lang', 'zh-CN');
	}, me);
	await page.goto(`${BASE_URL}${path}?ui=${ui}`);
	await expect(page.getByTestId('avatar-decoration-page')).toBeVisible();
}

/** 上传真实透明素材并通过管理接口创建目录条目。 */
async function addDecoration(page: Page, name: string, roleIds: string[] = [], category: string = '精选'): Promise<Misskey.entities.GetAvatarDecorationsResponse[number]> {
	const uploaded: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, { multipart: { i: admin.token, file: { name: `${name}.png`, mimeType: 'image/png', buffer: framePng } } });
	expect(uploaded.ok()).toBe(true);
	const file: Misskey.entities.DriveFile = await uploaded.json();
	return await api(BASE_URL, 'admin/avatar-decorations/create', { i: admin.token, name, description: `${name} 测试素材`, url: file.url, category, roleIdsThatCanBeUsedThisDecoration: roleIds });
}

/** 使用真实角色策略；不在页面里伪造上限或权限。 */
async function createRole(policies: Misskey.Endpoints['admin/roles/create']['req']['policies'] = {}): Promise<Misskey.entities.Role> {
	return await api(BASE_URL, 'admin/roles/create', { i: admin.token, name: '挂件验收角色', description: '', color: null, iconUrl: null, target: 'manual', condFormula: {}, isPublic: true, isModerator: false, isAdministrator: false, asBadge: false, canEditMembersByModerator: false, displayOrder: 0, policies });
}

/** 将角色真实授予测试账户。 */
async function assignRole(role: Misskey.entities.Role): Promise<void> {
	await api(BASE_URL, 'admin/roles/assign', { i: admin.token, roleId: role.id, userId: user.id });
}

/** 按稳定实体标识选中目录卡片，避免同名挂件造成歧义。 */
function card(page: Page, id: string): Locator {
	return page.getByTestId('decoration-card').filter({ has: page.locator('button') }).and(page.locator(`[data-decoration-id="${id}"]`));
}

/** 查询服务端实际佩戴结果，而非从组件草稿推断成功。 */
async function worn(): Promise<Misskey.entities.MeDetailed['avatarDecorations']> {
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: user.token });
	return me.avatarDecorations;
}

/** 从首帧捕获未处理页面异常。 */
test.beforeEach(async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	admin = await registerUser(BASE_URL, 'decoration_admin', 'decoration-admin-password', true);
	await api(BASE_URL, 'i/registry/set', { i: admin.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	user = await createUser();
	errors = [];
	page.on('pageerror', /** 不记录请求和凭据。 */ (error: Error): void => { errors.push(error.message); });
	page.on('console', /** 捕获缺键提示，不能把内部键名作为已翻译文案。 */ (message: ConsoleMessage): void => { if (/Unexpected locale key|Missing locale parameters/.test(message.text())) errors.push(message.text()); });
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.emulateMedia({ colorScheme: 'dark' });
});
/** 取消、失败与重试都不得触发全局未处理异常。 */
test.afterEach((): void => { expect(errors).toEqual([]); });

test('空目录、管理权限及窄屏展示完整中文状态', /** 真实空目录不使用伪造默认挂件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	let reads: number = 0;
	page.on('request', /** 挂载与首次激活只能发出一次目录请求。 */ (request: Request): void => { if (request.url().endsWith('/api/get-avatar-decorations')) reads++; });
	await open(page);
	await expect(page.getByTestId('decoration-empty')).toContainText('暂时还没有头像挂件');
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 0 / 1');
	await expect(page.getByTestId('decoration-manage')).toHaveCount(0);
	expect(reads).toBe(1);
	await page.screenshot({ path: info.outputPath('empty-desktop.png'), animations: 'disabled' });
	for (const width of [390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await expect(page.getByTestId('decoration-empty')).toBeVisible();
		const overflow: number = await page.getByTestId('avatar-decoration-page').evaluate(/** 实测内容宽度，不隐藏横向滚动冒充通过。 */ (element: HTMLElement): number => element.scrollWidth - element.clientWidth);
		expect(overflow).toBeLessThanOrEqual(1);
		await page.screenshot({ path: info.outputPath(`empty-${width}.png`), animations: 'disabled' });
	}
	await open(page, '/settings/avatar-decoration', admin);
	await expect(page.getByTestId('decoration-manage')).toBeVisible();
	const manager: Misskey.entities.Role = await createRole({ canManageAvatarDecorations: { useDefault: false, priority: 1, value: true } });
	await assignRole(manager);
	await open(page);
	await expect(page.getByTestId('decoration-manage')).toHaveAttribute('href', '/avatar-decorations');
});

test('原空目录从管理页返回后重新加载且不丢失导航', /** 回访实际更新目录，而不是仅检查路由标题。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await open(page, '/settings/avatar-decoration', admin);
	await expect(page.getByTestId('decoration-empty')).toBeVisible();
	await page.getByTestId('decoration-manage').click();
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '返回后出现');
	await page.goBack();
	await expect(card(page, decoration.id)).toBeVisible();
	await expect(page.getByTestId('decoration-empty')).toHaveCount(0);
});

test('分类、真实图片、键盘试戴及取消不改变账户', /** 目录是服务端数据；交互作用于局部草稿。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const first: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '星环');
	await addDecoration(page, '轻盈边框');
	await addDecoration(page, '原型名称分类', [], '__proto__');
	await open(page);
	await expect(page.getByTestId('decoration-card')).toHaveCount(3);
	await expect.poll(/** 确认实际挂件图片已成功解码，不仅检查 img 节点存在。 */ async (): Promise<boolean> => card(page, first.id).locator('img').last().evaluate((image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0)).toBe(true);
	await page.screenshot({ path: info.outputPath('catalog-desktop.png'), animations: 'disabled' });
	await card(page, first.id).getByRole('button').first().focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('decoration-editor')).toBeVisible();
	await page.getByTestId('decoration-flip').getByTestId('switch-toggle').click();
	expect(await worn()).toHaveLength(0);
	await page.screenshot({ path: info.outputPath('try-on-desktop.png'), animations: 'disabled' });
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	expect(await worn()).toHaveLength(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: info.outputPath('catalog-mobile.png'), animations: 'disabled' });
});

test('保存期间阻止重复提交和关闭，成功后头像与持久化同步', /** 延迟真实回执，覆盖原先 emit 后立即关闭的缺陷。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '确认后佩戴');
	await open(page);
	await card(page, decoration.id).getByRole('button').first().click();
	let release: () => void = /** 请求进入前为空操作。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 暂缓真实响应交付。 */ (resolve: () => void): void => { release = resolve; });
	let writes: number = 0;
	await page.route('**/api/i/update', /** 服务端真实执行，只延迟回执。 */ async (route: Route): Promise<void> => { writes++; const response: APIResponse = await route.fetch(); await gate; await route.fulfill({ response }); });
	try {
		await page.getByTestId('decoration-save').click();
		await expect(page.getByTestId('decoration-save')).toBeDisabled();
		await expect(page.getByTestId('decoration-editor')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('decoration-editor')).toBeVisible();
		expect(writes).toBe(1);
		release();
		await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
		await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 1 / 1');
		await expect(page.getByTestId('decoration-current-avatar').locator('img').last()).toHaveAttribute('src', decoration.url);
		const persisted: string[] = await page.evaluate(/** 读取持久化回执，仅返回挂件 ID。 */ (): string[] => JSON.parse(localStorage.getItem('account') ?? '{}').avatarDecorations.map((item: { id: string }): string => item.id));
		expect(persisted).toEqual([decoration.id]);
		expect((await worn())[0].id).toBe(decoration.id);
	} finally { release(); }
});

test('保存失败保留试戴参数，重试后提交真实结果', /** 只中断网络，不伪造业务错误码。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '可重试的试戴');
	await open(page);
	await card(page, decoration.id).getByRole('button').first().click();
	await page.getByTestId('decoration-flip').getByTestId('switch-toggle').click();
	await page.route('**/api/i/update', /** 第一次提交中断。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-save-error')).toContainText('保存失败');
	await expect(page.getByTestId('decoration-editor')).toBeVisible();
	expect(await worn()).toHaveLength(0);
	await page.unroute('**/api/i/update');
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	expect((await worn())[0].flipH).toBe(true);
});

test('角色限制保留预览，满额仍允许调整和移除', /** 两类禁用状态分别由真实角色与数量数据产生。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const role: Misskey.entities.Role = await createRole();
	const locked: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '限定挂件', [role.id]);
	const free: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '普通挂件');
	await api(BASE_URL, 'i/update', { i: user.token, avatarDecorations: [{ id: free.id }] });
	await open(page);
	await expect(card(page, locked.id)).toContainText('角色限定');
	await card(page, locked.id).getByRole('button').first().click();
	await expect(page.getByTestId('decoration-locked')).toBeVisible();
	await expect(page.getByTestId('decoration-save')).toBeDisabled();
	await page.getByTestId('decoration-cancel').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await card(page, free.id).getByRole('button').first().click();
	await expect(page.getByTestId('decoration-limit')).toBeVisible();
	await expect(page.getByTestId('decoration-save')).toBeDisabled();
	await page.getByTestId('decoration-cancel').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await page.getByTestId('decoration-adjust').click();
	await expect(page.getByTestId('decoration-save')).toBeEnabled();
	await page.getByTestId('decoration-editor-remove').click();
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 0 / 1');
	expect(await worn()).toHaveLength(0);
});

test('服务端过滤过期权限时不把本地草稿当作佩戴成功', /** 目录变化发生在试戴之后，回执与请求确实不同。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '权限已变');
	const role: Misskey.entities.Role = await createRole();
	await open(page);
	await card(page, decoration.id).getByRole('button').first().click();
	await api(BASE_URL, 'admin/avatar-decorations/update', { i: admin.token, id: decoration.id, roleIdsThatCanBeUsedThisDecoration: [role.id] });
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-save-error')).toContainText('服务端实际结果');
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 0 / 1');
	expect(await worn()).toHaveLength(0);
});

test('目录首拉失败仍保留已佩戴区域且可重试', /** 目录失败不能清空账户事实。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '失败时保留');
	await api(BASE_URL, 'i/update', { i: user.token, avatarDecorations: [{ id: decoration.id }] });
	await page.route('**/api/get-avatar-decorations', /** 只中断读请求。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await open(page);
	await expect(page.getByTestId('decoration-wearing-row')).toHaveCount(1);
	await expect(page.getByTestId('decoration-directory')).toContainText('无法加载头像挂件');
	await expect(page.getByTestId('decoration-empty')).toHaveCount(0);
	await page.unroute('**/api/get-avatar-decorations');
	await page.getByTestId('decoration-directory').getByRole('button', { name: '重试', exact: true }).click();
	await expect(card(page, decoration.id)).toBeVisible();
	await page.route('**/api/get-avatar-decorations', /** 刷新失败保留成功目录。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-refresh').click();
	await expect(page.getByTestId('decoration-refresh-error')).toBeVisible();
	await expect(card(page, decoration.id)).toBeVisible();
	await page.getByTestId('decoration-remove-all').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-wearing')).toHaveCount(0);
	expect(await worn()).toHaveLength(0);
});

test('重复挂件按具体位置调整，多挂件移除不影响其他项', /** 保留现有重复 ID 与顺序语义。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const role: Misskey.entities.Role = await createRole({ avatarDecorationLimit: { useDefault: false, priority: 1, value: 3 } });
	await assignRole(role);
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '重复叠加');
	await api(BASE_URL, 'i/update', { i: user.token, avatarDecorations: [{ id: decoration.id, angle: 0.1 }, { id: decoration.id, angle: 0.2, flipH: true }] });
	await open(page);
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 2 / 3');
	await page.getByTestId('decoration-adjust').nth(1).click();
	await page.getByTestId('decoration-reset').click();
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	const saved: Misskey.entities.MeDetailed['avatarDecorations'] = await worn();
	expect(saved.map(/** 只比较实际保存参数。 */ (item: Misskey.entities.MeDetailed['avatarDecorations'][number]): number | undefined => item.angle ?? 0)).toEqual([0.1, 0]);
	await page.getByTestId('decoration-remove').first().click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-wearing-row')).toHaveCount(1);
	expect((await worn())[0].angle ?? 0).toBe(0);
});

test('单张素材加载失败不影响其他卡片', /** 使用实际 404 资源，不伪造图片加载状态。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const good: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '正常素材');
	const broken: Misskey.entities.GetAvatarDecorationsResponse[number] = await api(BASE_URL, 'admin/avatar-decorations/create', { i: admin.token, name: '失效素材', description: '', url: `${BASE_URL}/static-assets/nonexistent-decoration-test.png` });
	await open(page);
	await expect(card(page, broken.id).getByTestId('decoration-image-error')).toBeVisible();
	await card(page, good.id).getByRole('button').first().click();
	await expect(page.getByTestId('decoration-save')).toBeEnabled();
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 1 / 1');
});

test('角色撤销令佩戴上限回落后可全部移除', /** 不在客户端绕过后端数量规则。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const role: Misskey.entities.Role = await createRole({ avatarDecorationLimit: { useDefault: false, priority: 1, value: 3 } });
	await assignRole(role);
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '旧上限下的叠加');
	await api(BASE_URL, 'i/update', { i: user.token, avatarDecorations: [{ id: decoration.id }, { id: decoration.id, angle: 0.1 }, { id: decoration.id, angle: 0.2 }] });
	await api(BASE_URL, 'admin/roles/unassign', { i: admin.token, roleId: role.id, userId: user.id });
	await open(page);
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 3 / 1');
	await expect(page.getByTestId('decoration-wearing')).toContainText('当前佩戴数量超过上限');
	await page.getByTestId('decoration-remove-all').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 0 / 1');
	expect(await worn()).toHaveLength(0);
});

test('默认界面同样支持试戴和真实保存', /** 业务流程不依赖 Twitter 外观开关。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '默认界面挂件');
	await open(page, '/settings/avatar-decoration', user, 'default');
	await card(page, decoration.id).getByRole('button').first().click();
	await expect(page.getByTestId('decoration-editor')).toBeVisible();
	await page.getByTestId('decoration-angle').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('decoration-angle')).toHaveValue('0.025');
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 1 / 1');
	expect((await worn())[0].angle).toBe(0.025);
	await page.screenshot({ path: info.outputPath('default-ui-saved.png'), animations: 'disabled' });
});

test('目录删除的已佩戴项不构造空实体，仍可移除', /** 删除真实目录条目后刷新，不能把旧账户记录伪装为可调整挂件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '已删除素材');
	await api(BASE_URL, 'i/update', { i: user.token, avatarDecorations: [{ id: decoration.id }] });
	await open(page);
	await expect(page.getByTestId('decoration-wearing-row')).toHaveCount(1);
	await api(BASE_URL, 'admin/avatar-decorations/delete', { i: admin.token, id: decoration.id });
	await page.getByTestId('decoration-refresh').click();
	await expect(page.getByTestId('decoration-wearing-row')).toContainText('该挂件已不可用');
	await expect(page.getByTestId('decoration-adjust')).toBeDisabled();
	await page.getByTestId('decoration-remove').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-wearing')).toHaveCount(0);
	expect(await worn()).toHaveLength(0);
});

test('佩戴上限下降后展示超限说明并可全部移除', /** 使用真实策略变化，不为减少操作绕过后端数组长度约束。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const role: Misskey.entities.Role = await createRole({ avatarDecorationLimit: { useDefault: false, priority: 1, value: 3 } });
	await assignRole(role);
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '策略变更前佩戴');
	await api(BASE_URL, 'i/update', { i: user.token, avatarDecorations: [{ id: decoration.id }, { id: decoration.id, angle: 0.1 }, { id: decoration.id, angle: 0.2 }] });
	await api(BASE_URL, 'admin/roles/update', { i: admin.token, roleId: role.id, policies: { avatarDecorationLimit: { useDefault: false, priority: 1, value: 1 } } });
	await expect.poll(/** 等待真实角色更新事件使策略读取一致。 */ async (): Promise<number> => (await api(BASE_URL, 'i', { i: user.token })).policies.avatarDecorationLimit).toBe(1);
	await open(page);
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 3 / 1');
	await expect(page.getByTestId('decoration-wearing')).toContainText('超过上限');
	await page.getByTestId('decoration-remove').first().click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-page-message')).toContainText('保存失败');
	await expect(page.getByTestId('decoration-wearing-row')).toHaveCount(3);
	await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(0);
	await page.getByTestId('decoration-remove-all').click();
	await page.getByTestId('modal-dialog-ok').click();
	await expect(page.getByTestId('decoration-count')).toHaveText('已佩戴 0 / 1');
	expect(await worn()).toHaveLength(0);
});

test('窄屏试戴支持键盘调整且变换后挂件仍在预览范围内', /** 检查真实 DOM 图像位置，保存失败提示须在固定操作区可见。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '键盘试戴');
	await open(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await card(page, decoration.id).getByRole('button').first().click();
	const angle: Locator = page.getByTestId('decoration-angle');
	await angle.focus();
	for (let index: number = 0; index < 5; index++) await page.keyboard.press('ArrowRight');
	await expect(angle).toHaveValue('0.125');
	await page.getByTestId('decoration-offset-x').focus();
	await page.keyboard.press('End');
	await page.getByTestId('decoration-offset-y').focus();
	await page.keyboard.press('Home');
	await expect(page.getByTestId('decoration-offset-x')).toHaveValue('0.25');
	await expect(page.getByTestId('decoration-offset-y')).toHaveValue('-0.25');
	expect(await worn()).toHaveLength(0);
	const stage: Locator = page.getByTestId('decoration-draft-preview');
	await stage.scrollIntoViewIfNeeded();
	const contained: boolean = await stage.evaluate(/** 坐标只用于视觉几何断言，不写回业务参数。 */ (element: HTMLElement): boolean => {
		const layer: HTMLElement | null = element.querySelector('[data-twitter-avatar-decoration-layer]');
		if (!layer) return false;
		const frame: DOMRect = element.getBoundingClientRect();
		const actual: DOMRect = layer.getBoundingClientRect();
		return getComputedStyle(layer).overflowX === 'clip' && actual.left >= frame.left - 1 && actual.top >= frame.top - 1 && actual.right <= frame.right + 1 && actual.bottom <= frame.bottom + 1;
	});
	expect(contained).toBe(true);
	await page.screenshot({ path: info.outputPath('try-on-mobile.png'), animations: 'disabled' });
	await page.route('**/api/i/update', /** 保存失败只模拟传输中断。 */ async (route: Route): Promise<void> => { await route.abort(); });
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-save-error')).toBeInViewport();
	await page.screenshot({ path: info.outputPath('save-error-mobile.png'), animations: 'disabled' });
});

test('保存后本人资料帖子头像同步挂件，侧栏保持关闭', /** 当前会话不刷新浏览器，检查共享账户数据与场景策略的实际消费。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '跨页面显示');
	const created: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: user.token, text: '挂件同步验证' });
	await open(page);
	await card(page, decoration.id).getByRole('button').first().click();
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await expect(page.getByTestId('twitter-sidebar').locator(`img[src="${decoration.url}"]`)).toHaveCount(0);
	await page.getByTestId('twitter-sidebar').locator('a[href="/@decoration_user"]').click();
	await expect(page.getByTestId('twitter-user-timeline-notes').locator(`[data-testid="twitter-note"][data-note-id="${created.createdNote.id}"] img[src="${decoration.url}"]`)).toHaveCount(1);
});

test('目录首拉响应迟到不覆盖离开后重新取得的数据', /** 真实旧响应在回访后交付，不能复写新目录。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	let release: () => void = /** 尚未截取响应时无需释放。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 持有真实服务端响应，不构造目录数据。 */ (resolve: () => void): void => { release = resolve; });
	let ready: () => void = /** 通知空目录查询已真实完成。 */ (): void => {};
	const received: Promise<void> = new Promise(/** 建立首拉完成点。 */ (resolve: () => void): void => { ready = resolve; });
	let held: boolean = false;
	await page.route('**/api/get-avatar-decorations', /** 仅延迟首拉；回访请求正常访问真实后端。 */ async (route: Route): Promise<void> => {
		if (held) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		ready();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await open(page);
		await received;
		await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
		const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '迟到响应后的新目录');
		await page.goBack();
		await expect(card(page, decoration.id)).toBeVisible();
		release();
		await page.unrouteAll({ behavior: 'wait' });
		await expect(card(page, decoration.id)).toBeVisible();
		await expect(page.getByTestId('decoration-empty')).toHaveCount(0);
	} finally { release(); }
});

/** 设备条件只用于触发既有手机抽屉，不修改产品设备判断或注入业务状态。 */
test.describe('手机抽屉', (): void => {
	test.use({
		/** 浏览器移动设备布局。 */
		isMobile: true,
		/** 真实触控事件入口。 */
		hasTouch: true,
		/** 固定手机 UA 触发现有 device-kind 的 smartphone 分支。 */
		userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
	});

	/** 竖屏、紧凑屏、亮色与打开后横屏分别验证，不把桌面缩窄视为手机抽屉。 */
	const phoneCases: readonly [string, number, number, 'dark' | 'light', boolean][] = [
		['portrait-dark', 390, 844, 'dark', false],
		['compact-dark', 320, 568, 'dark', false],
		['portrait-light', 390, 844, 'light', false],
		['landscape-dark', 390, 844, 'dark', true],
	];
	for (const [name, width, height, colorScheme, landscape] of phoneCases) {
		test(`${name}：试戴、失败提示与保存操作均可达`, /** 使用真实账号与 PNG 素材，仅中断第一次写入传输。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
			await page.setViewportSize({ width, height });
			await page.emulateMedia({ colorScheme });
			const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await addDecoration(page, '手机挂件');
			await open(page);
			await card(page, decoration.id).getByRole('button').first().tap();
			await expect(page.getByTestId('decoration-editor')).toBeVisible();
			if (landscape) await page.setViewportSize({ width: 844, height: 390 });
			await expect.poll(/** 实际手机窗口应横向铺满并贴底，证明走到了抽屉而非居中对话框。 */ async (): Promise<boolean> => page.getByTestId('decoration-editor').evaluate(
				/** 只读取公开 DOM 布局，不依赖生成 class 或修改组件状态。 */
				(element: HTMLElement): boolean => {
					const bounds: DOMRect | undefined = element.parentElement?.parentElement?.getBoundingClientRect();
					return bounds !== undefined && Math.abs(bounds.left) <= 1 && Math.abs(bounds.right - window.innerWidth) <= 1 && Math.abs(bounds.bottom - window.innerHeight) <= 1;
				},
			)).toBe(true);
			await page.screenshot({ path: info.outputPath(`${name}-initial.png`), animations: 'disabled' });
			await page.getByTestId('decoration-flip').getByTestId('switch-toggle').tap();
			expect(await worn()).toHaveLength(0);
			await page.route('**/api/i/update', /** 网络失败不构造业务响应。 */ async (route: Route): Promise<void> => { await route.abort(); });
			await page.getByTestId('decoration-save').tap();
			await expect(page.getByTestId('decoration-save-error')).toContainText('保存失败');
			await expect(page.getByTestId('decoration-save-error')).toBeInViewport();
			await expect(page.getByTestId('decoration-cancel')).toBeInViewport();
			await expect(page.getByTestId('decoration-save')).toBeInViewport();
			await page.screenshot({ path: info.outputPath(`${name}-error.png`), animations: 'disabled' });
			await page.unroute('**/api/i/update');
			await page.getByTestId('decoration-save').tap();
			await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
			const saved: Misskey.entities.MeDetailed['avatarDecorations'] = await worn();
			expect(saved).toHaveLength(1);
			expect(saved[0].id).toBe(decoration.id);
			expect(saved[0].flipH).toBe(true);
		});
	}
});
