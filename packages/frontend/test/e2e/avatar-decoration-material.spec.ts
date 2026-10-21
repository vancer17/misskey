/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：头像挂件静态素材校准的真实后端验收。
 * 数据链：管理页选择原图 → Cropper 校准草稿 → 透明 PNG 真实上传 → 目录保存／佩戴 → 资料页回访。
 * 像素证据读取后端实际资源，校验透明度、非正方形补边与已知色块坐标；不伪造成功业务响应。
 * 测试仅连接已准备好的隔离实例；截图及差异图是审阅证据，不自动批准视觉基线。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { APIResponse, FileChooser, Locator, Page, PlaywrightTestArgs, Request, Response, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { PreferencesProfile } from '../../src/preferences/manager.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 隔离后端签发的管理员身份，不输出凭据。 */
let account: RegisteredUser;
/** 页面未处理错误不得被上传或像素断言的成功掩盖。 */
let errors: string[];
/** 1024×768 原图包含绿色圆环、红色实心锚点和蓝色半透明锚点。 */
const materialPng: Buffer = readFileSync(new URL('./fixtures/avatar-decoration/calibration-non-square.png', import.meta.url));
/** 两帧 APNG 使用 PNG MIME，防止仅凭 MIME 将动画静默展平。 */
const animatedPng: Buffer = readFileSync(new URL('./fixtures/avatar-decoration/calibration-animated.png', import.meta.url));

/** 浏览器解码实际后端文件后形成的只读像素证据，不作为业务事实。 */
type PixelEvidence = Readonly<{
	width: number;
	height: number;
	corner: readonly number[];
	center: readonly number[];
	topRing: readonly number[];
	leftRing: readonly number[];
	redMarker: readonly number[];
	blueMarker: readonly number[];
	foreignPixels: number;
}>;

/** 登录只写入真实签发会话，页面启动和后续状态均访问后端。 */
async function visit(page: Page, path: string = '/avatar-decorations'): Promise<void> {
	const me: AccountWithToken = { ...await api(BASE_URL, 'i', { i: account.token }), token: account.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 保存现有会话协议和界面语言，不创建业务状态副本。 */ (value: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(value));
		localStorage.setItem('lang', 'zh-CN');
	}, me);
	await page.goto(`${BASE_URL}${path}?ui=twitter`);
}

/** 读取未保存的唯一 URL 草稿；隐藏输入框仍可只读查询。 */
async function materialUrl(page: Page): Promise<string> {
	return await page.getByTestId('decoration-manager-url').locator('input').inputValue();
}

/** 通过现有文件选择按钮上传原图，等待真实上传回执更新 URL 草稿。 */
async function chooseMaterial(page: Page, buffer: Buffer = materialPng): Promise<Misskey.entities.DriveFile> {
	const choosing: Promise<FileChooser> = page.waitForEvent('filechooser');
	await page.getByTestId('decoration-manager-upload').click();
	const chooser: FileChooser = await choosing;
	const uploading: Promise<Response> = page.waitForResponse(
		/** 原始素材上传与派生图上传使用同一真实接口。 */
		(response: Response): boolean => response.url().endsWith('/api/drive/files/create') && response.request().method() === 'POST',
	);
	await chooser.setFiles({ name: 'calibration-source.png', mimeType: 'image/png', buffer });
	const response: Response = await uploading;
	expect(response.ok()).toBe(true);
	const file: Misskey.entities.DriveFile = await response.json();
	await expect.poll(/** 草稿必须采用上传回执，不能依赖临时对象地址。 */ async (): Promise<string> => materialUrl(page)).toBe(file.url);
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	return file;
}

/** 打开真实新增编辑器并准备已上传素材，不提前创建目录条目。 */
async function prepare(page: Page, buffer: Buffer = materialPng): Promise<Misskey.entities.DriveFile> {
	await visit(page);
	await page.getByTestId('decoration-manager-add').click();
	await expect(page.getByTestId('decoration-manager-editor')).toBeVisible();
	return await chooseMaterial(page, buffer);
}

/** 进入专用校准弹窗；确认按钮可用说明图片已解码且 Cropper 已准备。 */
async function calibrate(page: Page): Promise<void> {
	await page.getByTestId('decoration-manager-calibrate').click();
	await expect(page.getByTestId('decoration-calibration')).toBeVisible();
	await expect(page.getByTestId('decoration-calibration-apply')).toBeEnabled();
}

/** 确认校准仅上传派生 PNG，目录保存仍须由父编辑器显式提交。 */
async function applyCalibration(page: Page): Promise<Misskey.entities.DriveFile> {
	const uploading: Promise<Response> = page.waitForResponse(
		/** 接收真实媒体服务回执，不拦截成功业务结果。 */
		(response: Response): boolean => response.url().endsWith('/api/drive/files/create') && response.request().method() === 'POST',
	);
	await page.getByTestId('decoration-calibration-apply').click();
	const response: Response = await uploading;
	expect(response.ok()).toBe(true);
	const derived: Misskey.entities.DriveFile = await response.json();
	await expect(page.getByTestId('decoration-calibration')).toHaveCount(0);
	await expect.poll(/** 成功回执才允许替换管理草稿地址。 */ async (): Promise<string> => materialUrl(page)).toBe(derived.url);
	return derived;
}

/** 从后端下载最终资源，并在浏览器解码；采样坐标由独立 fixture 定义。 */
async function pixels(page: Page, url: string, dx: number = 0, dy: number = 0, scale: number = 1): Promise<PixelEvidence> {
	const response: APIResponse = await page.request.get(url);
	expect(response.ok()).toBe(true);
	const data: Buffer = await response.body();
	expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	return await page.evaluate(
		/** 临时画布只解码下载文件，不能替代被测页面导出或写入账户。 */
		async (input: { source: string; dx: number; dy: number; scale: number }): Promise<PixelEvidence> => {
			const image: HTMLImageElement = new Image();
			image.src = input.source;
			await image.decode();
			const canvas: HTMLCanvasElement = document.createElement('canvas');
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
			if (context === null) throw new Error('无法读取真实 PNG 像素');
			context.drawImage(image, 0, 0);
			const data: Uint8ClampedArray = context.getImageData(0, 0, canvas.width, canvas.height).data;
			/** 色块保留原始颜色；半透明边缘允许浏览器预乘精度产生的小误差。 */
			const colors: readonly (readonly number[])[] = [[32, 210, 80], [240, 32, 32], [40, 100, 240]];
			let foreignPixels: number = 0;
			for (let index: number = 0; index < data.length; index += 4) {
				if (data[index + 3] < 16) continue;
				const tolerance: number = Math.max(4, Math.ceil(255 / data[index + 3]));
				const matched: boolean = colors.some(
					/** 非素材色素说明头像、棋盘或参考线被错误烘焙。 */
					(color: readonly number[]): boolean => Math.abs(data[index] - color[0]) <= tolerance && Math.abs(data[index + 1] - color[1]) <= tolerance && Math.abs(data[index + 2] - color[2]) <= tolerance,
				);
				if (!matched) foreignPixels++;
			}

			/** 相对原图中心等比变换后加透明补边，坐标依据独立测试素材定义。 */
			function sample(x: number, y: number): readonly number[] {
				return Array.from(context!.getImageData(Math.round(x), Math.round(y), 1, 1).data);
			}

			return {
				width: canvas.width,
				height: canvas.height,
				corner: sample(0, 0),
				center: sample(512 + input.dx, 512 + input.dy),
				topRing: sample(512 + input.dx, 512 - 256 * input.scale + input.dy),
				leftRing: sample(512 - 256 * input.scale + input.dx, 512 + input.dy),
				redMarker: sample(512 - 422 * input.scale + input.dx, 512 - 294 * input.scale + input.dy),
				blueMarker: sample(512 + 398 * input.scale + input.dx, 512 + 286 * input.scale + input.dy),
				foreignPixels,
			};
		},
		{ source: `data:image/png;base64,${data.toString('base64')}`, dx, dy, scale },
	);
}

/** 不依赖 DOM 尺寸证明输出透明度、参考层排除和横纵等比坐标。 */
function expectMaterial(evidence: PixelEvidence): void {
	expect([evidence.width, evidence.height]).toEqual([1024, 1024]);
	expect(evidence.corner[3]).toBe(0);
	expect(evidence.center[3]).toBe(0);
	expect(evidence.topRing).toEqual([32, 210, 80, 255]);
	expect(evidence.leftRing).toEqual([32, 210, 80, 255]);
	expect(evidence.redMarker).toEqual([240, 32, 32, 255]);
	expect(evidence.blueMarker[3]).toBeGreaterThanOrEqual(127);
	expect(evidence.blueMarker[3]).toBeLessThanOrEqual(129);
	expect(evidence.foreignPixels).toBe(0);
}

/** 读取真实目录而非编辑器草稿，用于判断显式保存和取消边界。 */
async function directory(): Promise<Misskey.entities.AdminAvatarDecorationsListResponse> {
	return await api(BASE_URL, 'admin/avatar-decorations/list', { i: account.token });
}

/** 保存新增目录条目，返回实际后端实体。 */
async function saveNew(page: Page): Promise<Misskey.entities.AdminAvatarDecorationsListResponse[number]> {
	await page.getByTestId('decoration-manager-name').locator('input').fill('校准验收圆环');
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	const items: Misskey.entities.AdminAvatarDecorationsListResponse = await directory();
	const item: Misskey.entities.AdminAvatarDecorationsListResponse[number] | undefined = items.find(
		/** 名称仅筛选本测试刚创建的真实隔离目录。 */
		(value: Misskey.entities.AdminAvatarDecorationsListResponse[number]): boolean => value.name === '校准验收圆环',
	);
	if (item === undefined) throw new Error('目录保存未返回新增挂件');
	return item;
}

/** 从真实资料页通过既有链接进入装饰设置与管理页。 */
async function enterManager(page: Page): Promise<void> {
	await page.getByTestId('twitter-profile').getByRole('button', { name: /^编辑.*资料$/ }).click();
	await page.locator('a[href="/settings/avatar-decoration"]').first().click();
	await expect(page.getByTestId('avatar-decoration-page')).toBeVisible();
	await page.getByTestId('decoration-manage').click();
	await expect(page.getByTestId('avatar-decoration-manager')).toBeVisible();
}

/** 读取实际头像图像状态，空图片节点不算回访成功。 */
async function expectWorn(avatar: Locator, url: string): Promise<void> {
	const image: Locator = avatar.locator('[data-twitter-avatar-decoration]');
	await expect(image).toHaveCount(1);
	await expect(image).toHaveAttribute('src', url);
	await expect.poll(/** 浏览器应已成功解码后端资源。 */ async (): Promise<boolean> => image.evaluate(
		/** 保留正式组件的图片加载机制。 */ (element: HTMLImageElement): boolean => element.complete && element.naturalWidth > 0,
	)).toBe(true);
}

/** 记录头像前后图与像素差异，不把新结果写成未经确认的快照基线。 */
async function attachVisualDiff(page: Page, before: Buffer, after: Buffer, info: TestInfo): Promise<void> {
	const encoded: string = await page.evaluate(
		/** 比较同一固定头像区域的真实截图，不修改被测组件。 */
		async (input: { before: string; after: string }): Promise<string> => {
			const first: HTMLImageElement = new Image();
			const second: HTMLImageElement = new Image();
			first.src = input.before;
			second.src = input.after;
			await Promise.all([first.decode(), second.decode()]);
			if (first.naturalWidth !== second.naturalWidth || first.naturalHeight !== second.naturalHeight) throw new Error('头像截图尺寸发生变化');
			const canvas: HTMLCanvasElement = document.createElement('canvas');
			canvas.width = first.naturalWidth;
			canvas.height = first.naturalHeight;
			const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
			if (context === null) throw new Error('无法生成审阅差异图');
			context.drawImage(first, 0, 0);
			const original: Uint8ClampedArray = context.getImageData(0, 0, canvas.width, canvas.height).data;
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(second, 0, 0);
			const difference: ImageData = context.getImageData(0, 0, canvas.width, canvas.height);
			for (let index: number = 0; index < difference.data.length; index += 4) {
				difference.data[index] = Math.abs(difference.data[index] - original[index]);
				difference.data[index + 1] = Math.abs(difference.data[index + 1] - original[index + 1]);
				difference.data[index + 2] = Math.abs(difference.data[index + 2] - original[index + 2]);
				difference.data[index + 3] = 255;
			}
			context.putImageData(difference, 0, 0);
			return canvas.toDataURL('image/png').split(',')[1];
		},
		{ before: `data:image/png;base64,${before.toString('base64')}`, after: `data:image/png;base64,${after.toString('base64')}` },
	);
	const diff: Buffer = Buffer.from(encoded, 'base64');
	writeFileSync(info.outputPath('avatar-material-before.png'), before);
	writeFileSync(info.outputPath('avatar-material-after.png'), after);
	writeFileSync(info.outputPath('avatar-material-diff.png'), diff);
	await info.attach('校准前头像', { body: before, contentType: 'image/png' });
	await info.attach('校准后头像（待人工确认）', { body: after, contentType: 'image/png' });
	await info.attach('头像像素差异', { body: diff, contentType: 'image/png' });
}

/** 每项使用独立真实管理员及隔离数据库；本测试不探测或启动运行环境。 */
test.beforeEach(async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	errors = [];
	await resetState(BASE_URL);
	account = await registerUser(BASE_URL, 'material_admin', 'material-test-password', true);
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	page.on('pageerror', /** 只记录错误文本，不保存账户请求体。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 1050 });
	await page.emulateMedia({ colorScheme: 'dark' });
});

/** 网络失败和取消都必须被交互层接住。 */
test.afterEach((): void => { expect(errors).toEqual([]); });

test('非正方形静态素材导出真实透明 PNG，头像与辅助线不进入制品', /** 像素断言验证完整资源链，目录仍须显式保存。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.DriveFile = await prepare(page);
	await calibrate(page);
	await expect(page.getByTestId('decoration-calibration-scale')).toHaveValue('100');
	await page.getByTestId('decoration-calibration-x').fill('32');
	await page.getByTestId('decoration-calibration-y').fill('-16');
	await page.getByTestId('decoration-calibration-reset').click();
	await expect(page.getByTestId('decoration-calibration-x')).toHaveValue('0');
	await expect(page.getByTestId('decoration-calibration-y')).toHaveValue('0');
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	expect(derived.url).not.toBe(original.url);
	expect(derived.type).toBe('image/png');
	expectMaterial(await pixels(page, derived.url));
	expect(await directory()).toHaveLength(0);
});

test('校准缩放和像素位移在非正方形原图上保持等比补边', /** 两个独立方向的色块验证控件到导出坐标映射。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await prepare(page);
	await calibrate(page);
	await page.getByTestId('decoration-calibration-scale').fill('80');
	await page.getByTestId('decoration-calibration-x').fill('32');
	await page.getByTestId('decoration-calibration-y').fill('-16');
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	expectMaterial(await pixels(page, derived.url, 32, -16, 0.8));
});

test('取消校准保留原素材并且不上传派生图或保存目录', /** 监听真实写请求，不能以组件关闭代替无副作用证明。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.DriveFile = await prepare(page);
	let uploads: number = 0;
	page.on('request', /** 原图已上传，仅统计本轮校准之后的写入。 */ (request: Request): void => { if (request.url().endsWith('/api/drive/files/create')) uploads++; });
	await calibrate(page);
	await page.getByTestId('decoration-calibration-scale').fill('80');
	await page.getByTestId('decoration-calibration-cancel').click();
	await expect(page.getByTestId('decoration-calibration')).toHaveCount(0);
	expect(await materialUrl(page)).toBe(original.url);
	expect(uploads).toBe(0);
	expect(await directory()).toHaveLength(0);
	await calibrate(page);
	await expect(page.getByTestId('decoration-calibration-scale')).toHaveValue('100');
	await page.getByTestId('decoration-calibration-cancel').click();
});

test('PNG MIME 的多帧素材拒绝校准但保留原生保存路径', /** 真实上传 APNG，禁止以浏览器首帧替换动图。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.DriveFile = await prepare(page, animatedPng);
	let uploads: number = 0;
	page.on('request', /** 原素材读取不计入上传数量。 */ (request: Request): void => { if (request.url().endsWith('/api/drive/files/create')) uploads++; });
	await page.getByTestId('decoration-manager-calibrate').click();
	await expect(page.getByTestId('decoration-calibration-error')).toBeVisible();
	await expect(page.getByTestId('decoration-calibration-apply')).toBeDisabled();
	await page.getByTestId('decoration-calibration-cancel').click();
	expect(await materialUrl(page)).toBe(original.url);
	expect(uploads).toBe(0);
	const saved: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await saveNew(page);
	expect(saved.url).toBe(original.url);
});

test('派生图片上传失败保留原 URL 与校准草稿，重试采用真实回执', /** 故障只中断真实上传，成功响应始终由后端生成。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const original: Misskey.entities.DriveFile = await prepare(page);
	await calibrate(page);
	await page.getByTestId('decoration-calibration-x').fill('32');
	let failed: boolean = false;
	await page.route('**/api/drive/files/create', /** 第一笔派生上传中断，后续按原请求访问真实媒体服务。 */ async (route: Route): Promise<void> => {
		if (!failed) { failed = true; await route.abort('failed'); } else await route.continue();
	});
	await page.getByTestId('decoration-calibration-apply').click();
	await expect(page.getByTestId('decoration-calibration-error')).toBeVisible();
	await expect(page.getByTestId('decoration-calibration-apply')).toBeEnabled();
	await expect(page.getByTestId('decoration-calibration-x')).toHaveValue('32');
	expect(await materialUrl(page)).toBe(original.url);
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	expectMaterial(await pixels(page, derived.url, 32));
	expect(await directory()).toHaveLength(0);
});

test('校准后真实新增、细调佩戴和 SPA 回访仅采用后端账户回执', /** 管理、佩戴、资料和帖卡组成真实跨页业务闭环。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const post: Misskey.entities.NotesCreateResponse = await api(BASE_URL, 'notes/create', { i: account.token, text: '校准素材真实回访' });
	await visit(page, '/@material_admin');
	await enterManager(page);
	await page.getByTestId('decoration-manager-add').click();
	await chooseMaterial(page);
	await calibrate(page);
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	const saved: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await saveNew(page);
	expect(saved.url).toBe(derived.url);
	await page.goBack();
	await expect(page.getByTestId('avatar-decoration-page')).toBeVisible();
	await page.locator(`[data-testid="decoration-card"][data-decoration-id="${saved.id}"]`).getByRole('button').first().click();
	await page.getByTestId('decoration-offset-x-number').fill('0.001');
	await page.getByTestId('decoration-offset-x-number').press('Tab');
	await page.getByTestId('decoration-save').click();
	await expect(page.getByTestId('decoration-editor')).toHaveCount(0);
	await page.goBack();
	await page.goBack();
	const profile: Locator = page.locator('[data-twitter-avatar-context="profile"]');
	await expectWorn(profile, derived.url);
	await expectWorn(page.locator(`[data-testid="twitter-note"][data-note-id="${post.createdNote.id}"] [data-twitter-avatar-context="note"]`).first(), derived.url);
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	expect(me.avatarDecorations).toHaveLength(1);
	expect(me.avatarDecorations[0]).toMatchObject({ id: saved.id, url: derived.url, offsetX: 0.001 });
	await page.reload();
	await expectWorn(profile, derived.url);
});

test('替换已佩戴素材保持挂件 ID，并留下前后视觉差异供审阅', /** 同会话管理更新后从账户回执刷新，不用表单 URL 伪造佩戴事实。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	const uploading: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, { multipart: { i: account.token, file: { name: 'existing-material.png', mimeType: 'image/png', buffer: materialPng } } });
	expect(uploading.ok()).toBe(true);
	const original: Misskey.entities.DriveFile = await uploading.json();
	const item: Misskey.entities.AdminAvatarDecorationsCreateResponse = await api(BASE_URL, 'admin/avatar-decorations/create', { i: account.token, name: '已有校准素材', description: '', url: original.url });
	await api(BASE_URL, 'i/update', { i: account.token, avatarDecorations: [{ id: item.id, angle: 0, flipH: false, offsetX: 0, offsetY: 0 }] });
	await visit(page, '/@material_admin');
	const profile: Locator = page.locator('[data-twitter-avatar-context="profile"]');
	await expectWorn(profile, original.url);
	const before: Buffer = await profile.screenshot();
	await enterManager(page);
	await page.locator(`[data-testid="decoration-manager-card"][data-decoration-id="${item.id}"]`).click();
	await calibrate(page);
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-editor')).toHaveCount(0);
	await page.goBack();
	await page.goBack();
	await page.goBack();
	await expectWorn(profile, derived.url);
	const after: Buffer = await profile.screenshot();
	await attachVisualDiff(page, before, after, info);
	const me: Misskey.entities.MeDetailed = await api(BASE_URL, 'i', { i: account.token });
	expect(me.avatarDecorations[0]).toMatchObject({ id: item.id, url: derived.url });
	expectMaterial(await pixels(page, derived.url));
});

test('地址读取失败保留草稿，网盘重选后静态偏好仍能预览并校准', /** 三种入口共享原图读取，失败不扩大代理能力或上传首帧。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const uploading: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, { multipart: { i: account.token, file: { name: 'drive-calibration-source.png', mimeType: 'image/png', buffer: materialPng } } });
	expect(uploading.ok()).toBe(true);
	const original: Misskey.entities.DriveFile = await uploading.json();
	await visit(page);
	await expect.poll(/** 既有偏好管理器完成首次持久化后再设置展示偏好。 */ async (): Promise<boolean> => page.evaluate(
		/** 只读本地展示配置，不读取账户事实。 */ (): boolean => localStorage.getItem('preferences') !== null,
	)).toBe(true);
	await page.evaluate(/** 沿用实际偏好存储格式，静态图片偏好不得把本地 PNG 预览送去服务端代理。 */ (): void => {
		const raw: string | null = localStorage.getItem('preferences');
		if (raw === null) throw new Error('应用尚未保存偏好配置');
		const current: PreferencesProfile = JSON.parse(raw);
		localStorage.setItem('preferences', JSON.stringify({ ...current, preferences: { ...current.preferences, disableShowingAnimatedImages: [[{}, true, {}]] } }));
	});
	await page.reload();
	await page.getByTestId('decoration-manager-add').click();
	await page.getByTestId('decoration-manager-url-toggle').locator('summary').click();
	await page.getByTestId('decoration-manager-url').locator('input').fill(original.url);
	let uploads: number = 0;
	page.on('request', /** 素材重选和读取失败不得产生派生文件。 */ (request: Request): void => { if (request.url().endsWith('/api/drive/files/create')) uploads++; });
	await page.route(original.url, /** 只中断原图网络读取，不伪造可读取的资源或成功回执。 */ async (route: Route): Promise<void> => { await route.abort('failed'); });
	await page.getByTestId('decoration-manager-calibrate').click();
	await expect(page.getByTestId('decoration-calibration-error')).toBeVisible();
	await expect(page.getByTestId('decoration-calibration-apply')).toBeDisabled();
	await page.getByTestId('decoration-calibration-cancel').click();
	expect(await materialUrl(page)).toBe(original.url);
	expect(uploads).toBe(0);
	await page.unroute(original.url);
	await page.getByTestId('decoration-manager-url').locator('input').fill('');
	await page.getByTestId('decoration-manager-drive').click();
	await page.locator('[draggable="true"]').filter({ has: page.getByText(original.name, { exact: true }) }).click();
	await page.getByRole('button', { name: '完成' }).click();
	await expect(page.getByTestId('decoration-manager-upload')).toBeEnabled();
	expect(await materialUrl(page)).toBe(original.url);
	await calibrate(page);
	const preview: Locator = page.getByTestId('decoration-calibration-preview').locator('[data-twitter-avatar-decoration]');
	await expect(preview).toHaveCount(2);
	await expect.poll(/** 静态偏好下两种正式场景必须真实解码本地 PNG 预览。 */ async (): Promise<boolean> => preview.evaluateAll(
		/** 正式预览可直读已知静态 Blob，不允许依赖媒体代理降级。 */
		(images: HTMLImageElement[]): boolean => images.every(
			/** 不把加载失败后留下的节点视为成功。 */
			(image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0 && image.getAttribute('src')?.startsWith('blob:') === true,
		),
	)).toBe(true);
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	expect(uploads).toBe(1);
	expectMaterial(await pixels(page, derived.url));
});

test('派生图已上传而目录保存失败时保留新 URL，重试不重新上传', /** 网盘制品与目录提交是两个独立真实写入，失败不得伪装成整体回滚。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await prepare(page);
	let uploads: number = 0;
	page.on('request', /** 原图准备完成后只计数派生图上传。 */ (request: Request): void => { if (request.url().endsWith('/api/drive/files/create')) uploads++; });
	await calibrate(page);
	const derived: Misskey.entities.DriveFile = await applyCalibration(page);
	await page.getByTestId('decoration-manager-name').locator('input').fill('校准验收圆环');
	let failed: boolean = false;
	await page.route('**/api/admin/avatar-decorations/create', /** 仅第一笔目录创建中断，重试仍由真实后端处理。 */ async (route: Route): Promise<void> => {
		if (!failed) { failed = true; await route.abort('failed'); } else await route.continue();
	});
	await page.getByTestId('decoration-manager-save').click();
	await expect(page.getByTestId('decoration-manager-save-error')).toBeVisible();
	await expect(page.getByTestId('decoration-manager-save')).toBeEnabled();
	expect(await materialUrl(page)).toBe(derived.url);
	expect(await directory()).toHaveLength(0);
	const retained: Misskey.entities.DriveFile = await api(BASE_URL, 'drive/files/show', { i: account.token, fileId: derived.id });
	expect(retained.url).toBe(derived.url);
	const saved: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await saveNew(page);
	expect(saved.url).toBe(derived.url);
	expect(uploads).toBe(1);
});

/** 校准弹窗只读布局证据，用于窄屏可达性和尺寸断言。 */
type CalibrationLayout = Readonly<{
	contentOverflow: number;
	bodyOverflow: number;
	footerOverflow: number;
	bodyScrolls: boolean;
	footerBottom: number;
	withinViewport: boolean;
}>;

/** 从真实组件层级读取正文和固定操作区，不依赖编译后的 CSS 类名。 */
async function calibrationLayout(page: Page): Promise<CalibrationLayout> {
	return await page.getByTestId('decoration-calibration').evaluate(
		/** 模态窗口的正文与操作区是同级元素，滚动仅发生于正文。 */
		(element: HTMLElement): CalibrationLayout => {
			const body: HTMLElement | null = element.parentElement;
			const host: HTMLElement | null = body?.parentElement ?? null;
			const footer: Element | null = host?.lastElementChild ?? null;
			if (body === null || host === null || !(footer instanceof HTMLElement)) throw new Error('校准窗口缺少独立正文或操作区');
			const bounds: DOMRect = host.getBoundingClientRect();
			return {
				contentOverflow: element.scrollWidth - element.clientWidth,
				bodyOverflow: body.scrollWidth - body.clientWidth,
				footerOverflow: footer.scrollWidth - footer.clientWidth,
				bodyScrolls: body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto',
				footerBottom: footer.getBoundingClientRect().bottom,
				withinViewport: bounds.left >= -1 && bounds.top >= -1 && bounds.right <= window.innerWidth + 1 && bounds.bottom <= window.innerHeight + 1,
			};
		},
	);
}

/** 截图和几何断言等待真实字体与有限动画，不禁用被测动效。 */
async function waitForLayout(page: Page): Promise<void> {
	await page.evaluate(/** 字体布局由浏览器实际就绪状态决定。 */ async (): Promise<void> => { await document.fonts.ready; });
	await expect.poll(/** 动画完成后再读取抽屉或弹窗的最终可见边界。 */ async (): Promise<number> => page.evaluate(
		/** 无限素材动效不影响此次静态样例布局等待。 */
		(): number => document.getAnimations().filter(
			/** 仅等待已开始的有限过渡、按钮反馈和模态动画。 */
			(animation: Animation): boolean => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)) && (animation.playState === 'running' || animation.pending),
		).length,
	)).toBe(0);
}

/** 六个场景覆盖桌面、常规手机与最窄手机的明暗主题，不扩展业务协议。 */
const layoutWidths: readonly number[] = [1440, 390, 320];
/** 主题只影响展示环境，同一 PNG、控件和目录协议用于两种背景。 */
const layoutThemes: readonly ('light' | 'dark')[] = ['light', 'dark'];
for (let widthIndex: number = 0; widthIndex < layoutWidths.length; widthIndex++) {
	const width: number = layoutWidths[widthIndex];
	for (let themeIndex: number = 0; themeIndex < layoutThemes.length; themeIndex++) {
		const theme: 'light' | 'dark' = layoutThemes[themeIndex];
		test(`校准弹窗布局 ${width}px-${theme}：无横向溢出且操作与正式预览可达`, /** 真实上传原图后只操作校准草稿，截图不建立自动认可的视觉基线。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
			await page.setViewportSize({ width, height: width === 1440 ? 1050 : width === 390 ? 844 : 568 });
			await page.emulateMedia({ colorScheme: theme });
			const original: Misskey.entities.DriveFile = await prepare(page);
			await calibrate(page);
			await waitForLayout(page);
			const apply: Locator = page.getByTestId('decoration-calibration-apply');
			const cancel: Locator = page.getByTestId('decoration-calibration-cancel');
			await expect(apply).toBeInViewport();
			await expect(cancel).toBeInViewport();
			const before: CalibrationLayout = await calibrationLayout(page);
			expect(before.contentOverflow).toBeLessThanOrEqual(1);
			expect(before.bodyOverflow).toBeLessThanOrEqual(1);
			expect(before.footerOverflow).toBeLessThanOrEqual(1);
			expect(before.bodyScrolls).toBe(true);
			expect(before.withinViewport).toBe(true);
			await page.screenshot({ path: info.outputPath(`calibration-${width}-${theme}-canvas.png`) });
			const scale: Locator = page.getByTestId('decoration-calibration-scale');
			const horizontal: Locator = page.getByTestId('decoration-calibration-x');
			const vertical: Locator = page.getByTestId('decoration-calibration-y');
			await horizontal.scrollIntoViewIfNeeded();
			await horizontal.fill('32');
			await horizontal.press('Tab');
			await vertical.fill('-16');
			await vertical.press('Tab');
			await scale.fill('80');
			await scale.press('Tab');
			await expect(horizontal).toHaveValue('32');
			await expect(vertical).toHaveValue('-16');
			await expect(scale).toHaveValue('80');
			if (width === 1440 && theme === 'light') {
				await scale.fill('0');
				await scale.press('Tab');
				await expect(scale).toHaveValue('80');
				await scale.fill('');
				await scale.press('Tab');
				await expect(scale).toHaveValue('80');
				await horizontal.fill('');
				await horizontal.press('Tab');
				await expect(horizontal).toHaveValue('32');
				await scale.fill('1');
				await scale.press('Tab');
				await expect(scale).toHaveValue('1');
				await scale.fill('800');
				await scale.press('Tab');
				await expect(scale).toHaveValue('800');
			}
			await page.getByTestId('decoration-calibration-reset').click();
			await expect(scale).toHaveValue('100');
			await expect(horizontal).toHaveValue('0');
			await expect(vertical).toHaveValue('0');
			const previews: Locator = page.getByTestId('decoration-calibration-preview');
			await expect(previews.locator('[data-twitter-avatar-decoration]')).toHaveCount(2);
			await expect.poll(/** 正式帖子和资料预览必须解码已知静态的导出图。 */ async (): Promise<boolean> => previews.locator('[data-twitter-avatar-decoration]').evaluateAll(
				/** 不把空节点或已失败图片当成视觉验收。 */
				(images: HTMLImageElement[]): boolean => images.every(
					/** 真实图片解码由浏览器确认。 */
					(image: HTMLImageElement): boolean => image.complete && image.naturalWidth === 1024 && image.naturalHeight === 1024,
				),
			)).toBe(true);
			const sizes: number[] = await previews.locator('[data-twitter-avatar-context]').evaluateAll(
				/** 扣除资料头像边框，测量正式组件实际内容尺寸。 */
				(elements: HTMLElement[]): number[] => elements.map(
					/** 两种预览沿用正式场景 Token，不以预览容器宽度缩小。 */
					(element: HTMLElement): number => element.getBoundingClientRect().width - Number.parseFloat(getComputedStyle(element).borderLeftWidth) - Number.parseFloat(getComputedStyle(element).borderRightWidth),
				),
			);
			expect(sizes).toEqual([48, width === 1440 ? 112 : 80]);
			await previews.scrollIntoViewIfNeeded();
			await waitForLayout(page);
			await expect(apply).toBeInViewport();
			await expect(cancel).toBeInViewport();
			const after: CalibrationLayout = await calibrationLayout(page);
			expect(after.contentOverflow).toBeLessThanOrEqual(1);
			expect(after.bodyOverflow).toBeLessThanOrEqual(1);
			expect(after.footerOverflow).toBeLessThanOrEqual(1);
			expect(Math.abs(after.footerBottom - before.footerBottom)).toBeLessThanOrEqual(1);
			expect(after.withinViewport).toBe(true);
			writeFileSync(info.outputPath(`calibration-${width}-${theme}-geometry.json`), JSON.stringify({ before, after, sizes }, null, 2));
			await page.screenshot({ path: info.outputPath(`calibration-${width}-${theme}-previews.png`) });
			await cancel.click();
			await expect(page.getByTestId('decoration-calibration')).toHaveCount(0);
			expect(await materialUrl(page)).toBe(original.url);
			expect(await directory()).toHaveLength(0);
		});
	}
}
