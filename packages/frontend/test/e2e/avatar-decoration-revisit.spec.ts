/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：头像挂件目录离开／回访时的真实传输回归。
 * 作用：验证已取消的旧空目录响应不覆盖回访后新增的真实挂件。
 * 数据链：隔离后端 → 延迟首次真实响应 → 路由离开／新增目录 → 回访与迟到交付。
 * 不探测环境，不构造成功业务响应，不使用开发实例账户。
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { PlaywrightTestArgs, Route, APIResponse, Page } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 使用现有持久化格式建立真实会话，账户字段全部来自后端。 */
async function openSettings(page: Page, account: RegisteredUser): Promise<void> {
	const me: AccountWithToken = { ...await api(BASE_URL, 'i', { i: account.token }), token: account.token };
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 仅注入已签发凭据和语言偏好。 */ (value: AccountWithToken): void => { localStorage.setItem('account', JSON.stringify(value)); localStorage.setItem('lang', 'zh-CN'); }, me);
	await page.goto(`${BASE_URL}/settings/avatar-decoration?ui=twitter`);
	await expect(page.getByTestId('avatar-decoration-page')).toBeVisible();
}

test('回访完成后迟到的旧空目录不能覆盖新目录', /** 用真实后端响应证明取消与完成边界。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const account: RegisteredUser = await registerUser(BASE_URL, 'decor_revisit_admin', 'decoration-revisit-test-password', true);
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	const errors: string[] = [];
	page.on('pageerror', /** 保存异常描述，不输出请求凭据。 */ (error: Error): void => { errors.push(error.message); });
	let release: () => void = /** 捕获前无待释放响应。 */ (): void => {};
	const gate: Promise<void> = new Promise(/** 固定真实旧响应交付窗口。 */ (resolve: () => void): void => { release = resolve; });
	let ready: () => void = /** 通知真实查询完成。 */ (): void => {};
	const captured: Promise<void> = new Promise(/** 新增目录发生在旧响应生成之后。 */ (resolve: () => void): void => { ready = resolve; });
	let held: boolean = false;
	await page.route('**/api/get-avatar-decorations', /** 只暂缓首次真实响应，后续读取直接访问后端。 */ async (route: Route): Promise<void> => {
		if (held) { await route.continue(); return; }
		held = true;
		const response: APIResponse = await route.fetch();
		expect(await response.json()).toEqual([]);
		ready();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await openSettings(page, account);
		await captured;
		await page.getByTestId('twitter-sidebar').locator('a[href="/my/notifications"]').click();
		const uploaded: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, { multipart: { i: account.token, file: { name: 'revisit-frame.png', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/avatar-decoration-frame.png', import.meta.url)) } } });
		expect(uploaded.ok()).toBe(true);
		const file: Misskey.entities.DriveFile = await uploaded.json();
		const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] = await api(BASE_URL, 'admin/avatar-decorations/create', { i: account.token, name: '回访新挂件', description: '', url: file.url });
		await page.goBack();
		await expect(page.locator(`[data-testid="decoration-card"][data-decoration-id="${decoration.id}"]`)).toBeVisible();
		release();
		await page.unrouteAll({ behavior: 'wait' });
		await expect(page.locator(`[data-testid="decoration-card"][data-decoration-id="${decoration.id}"]`)).toBeVisible();
		await expect(page.getByTestId('decoration-empty')).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally { release(); }
});
