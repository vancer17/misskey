/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 会话恢复集成回归：使用真实测试后端签发及撤销凭据，保留浏览器坏缓存验证恢复。
 * 仅网络中断用传输层故障注入；不伪造账户有效、无效或业务操作的后端结果。
 */
import { test, expect } from '@playwright/test';
import type { APIResponse, Page, PlaywrightTestArgs, Request, Route } from '@playwright/test';
import { api, registerUser, resetState, signIn } from './shared.js';
import { BASE_URL } from './utils.js';
import type { RegisteredUser } from './shared.js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { store } from '../../src/store.js';

/** 测试只读使用现有 Store 的持久化字段类型，不另建业务账户类型。 */
type DeviceState = Partial<typeof store.s>;

/** 测试账户夹具；账户数据和凭据均由真实后端生成。 */
type TestAccount = Readonly<{ account: AccountWithToken; password: string }>;

let admin: RegisteredUser;
let nextUser: number = 0;

/** 在浏览器原有 keyval 存储中读取或合并测试夹具，模拟真实存量浏览器数据。 */
async function deviceStateInBrowser(patch?: DeviceState): Promise<DeviceState> {
	return new Promise<DeviceState>(
		/** 使用单事务完成夹具读写，等待提交后才继续浏览器导航。 */
		(resolve: (value: DeviceState) => void, reject: (error: unknown) => void): void => {
			const opening: IDBOpenDBRequest = indexedDB.open('keyval-store', 1);
			/** 初次访问时创建 idb-keyval 的既有对象存储。 */
			opening.onupgradeneeded = (): void => { opening.result.createObjectStore('keyval'); };
			/** 数据库无法打开时直接令测试失败，不假定已保存夹具。 */
			opening.onerror = (): void => reject(opening.error);
			/** 在同一事务内合并补丁，保留未触及的设备设置。 */
			opening.onsuccess = (): void => {
				const db: IDBDatabase = opening.result;
				const transaction: IDBTransaction = db.transaction('keyval', patch === undefined ? 'readonly' : 'readwrite');
				const objects: IDBObjectStore = transaction.objectStore('keyval');
				const reading: IDBRequest<DeviceState | undefined> = objects.get('pizzax::base');
				let result: DeviceState = {};
				/** 读取已保存状态并按需写入最小夹具差异。 */
				reading.onsuccess = (): void => {
					result = { ...reading.result, ...patch };
					if (patch !== undefined) objects.put(result, 'pizzax::base');
				};
				/** 只有事务提交后才返回夹具状态。 */
				transaction.oncomplete = (): void => { db.close(); resolve(result); };
				/** 明确传播存储失败，避免把夹具准备失败算成业务通过。 */
				transaction.onabort = (): void => { db.close(); reject(transaction.error); };
			};
		},
	);
}

/** 创建真实本地账户，并提前完成远端账户向导配置以隔离本次回归。 */
async function createAccount(): Promise<TestAccount> {
	nextUser += 1;
	const password: string = 'session-regression-password';
	const account: AccountWithToken = await api(BASE_URL, 'admin/accounts/create', {
		i: admin.token, username: `session_user_${nextUser}`, password,
	});
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	return { account, password };
}

/** 在无应用副作用的同源页面保存完整真实会话，不在每次刷新时重新注入坏缓存。 */
async function seedAccount(page: Page, account: AccountWithToken): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(
		/** 仅写入本次回归所需的存量账户与无关设置标记。 */
		(value: AccountWithToken): void => {
			localStorage.setItem('account', JSON.stringify(value));
			localStorage.setItem('lang', 'en-US');
			localStorage.setItem('session-regression-marker', 'keep-me');
		},
		account,
	);
}

/** 经真实后端撤销夹具凭据，并确认旧凭据已被拒绝；浏览器存储保持不动。 */
async function revokeAccount(user: TestAccount): Promise<void> {
	await api(BASE_URL, 'i/regenerate-token', { i: user.account.token, password: user.password });
	await expect.poll(
		/** 等待真实后端缓存失效传播，不在业务代码中引入探测或固定等待。 */
		async (): Promise<number> => {
			const response: Response = await fetch(`${BASE_URL}/api/i`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: user.account.token }),
			});
			return response.status;
		},
	).toBe(401);
}

/** 收集所有实际页面异常；本回归不屏蔽认证或 Promise 错误。 */
function collectPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror',
		/** 只记录错误消息，不采集含凭据的请求 URL 或请求体。 */
		(error: Error): void => { errors.push(error.message); },
	);
	return errors;
}

/** 验证应用真实挂载且没有进入启动错误页，不能仅凭 HTTP 200 判断成功。 */
async function expectMounted(page: Page): Promise<void> {
	await expect(page.locator('#misskey_app')).toBeVisible({ timeout: 45_000 });
	await expect(page.locator('#errorInfo')).toHaveCount(0);
	await expect(page.locator('#session-retry')).toHaveCount(0);
}

/** 读取当前缓存的权威账户身份，不将测试夹具赋回正在运行的组件状态。 */
async function cachedAccount(page: Page): Promise<AccountWithToken | null> {
	return page.evaluate(
		/** JSON 仅用于检查浏览器持久化结果。 */
		(): AccountWithToken | null => {
			const raw: string | null = localStorage.getItem('account');
			return raw === null ? null : JSON.parse(raw) as AccountWithToken;
		},
	);
}

test.beforeAll(
	/** 使用既有固定测试入口重置隔离测试实例，不读取开发环境配置。 */
	async (): Promise<void> => {
		await resetState(BASE_URL);
		admin = await registerUser(BASE_URL, 'session_admin', 'session-admin-password', true);
	},
);

test('匿名访问不额外验证账户',
	/** 无缓存是基准场景，账户验证请求应为零。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const errors: string[] = collectPageErrors(page);
		let accountRequests: number = 0;
		page.on('request',
			/** 只计数明确账户端点，不读取敏感载荷。 */
			(request: Request): void => { if (new URL(request.url()).pathname === '/api/i') accountRequests += 1; },
		);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		expect(accountRequests).toBe(0);
		expect(errors).toEqual([]);
	},
);

test('有效缓存只验证一次且正常启动',
	/** 隔离连接后的业务对账，验证启动认证边界只读取一次有效账户。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		/** 使用既有设备偏好隔离实时未读对账；实时恢复由消息集成回归另行验证。 */
		await page.evaluate(deviceStateInBrowser, { realtimeMode: false });
		let accountRequests: number = 0;
		page.on('request',
			/** 统计本次页面启动的账户验证请求。 */
			(request: Request): void => { if (new URL(request.url()).pathname === '/api/i') accountRequests += 1; },
		);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		expect((await cachedAccount(page))?.token).toBe(user.account.token);
		expect(accountRequests).toBe(1);
		expect(errors).toEqual([]);
	},
);

test('保留真实失效缓存自动恢复并保留其他账户和设备设置',
	/** 开启云备份也不能让失效会话恢复依赖云端写入成功。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const other: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		const host: string = new URL(BASE_URL).host;
		await page.evaluate(deviceStateInBrowser, {
			accountTokens: { [`${host}/${user.account.id}`]: user.account.token, [`${host}/${other.account.id}`]: other.account.token },
			accountInfos: { [`${host}/${user.account.id}`]: user.account, [`${host}/${other.account.id}`]: other.account },
			enablePreferencesAutoCloudBackup: true,
		});
		await revokeAccount(user);
		expect((await cachedAccount(page))?.token).toBe(user.account.token);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		expect(await cachedAccount(page)).toBeNull();
		const device: DeviceState = await page.evaluate(deviceStateInBrowser, undefined);
		expect(device.accountTokens?.[`${host}/${user.account.id}`]).toBeUndefined();
		expect(device.accountInfos?.[`${host}/${user.account.id}`]).toBeUndefined();
		expect(device.accountTokens?.[`${host}/${other.account.id}`]).toBe(other.account.token);
		expect(device.enablePreferencesAutoCloudBackup).toBe(true);
		expect(await page.evaluate(/** 读取无关设置，验证恢复没有扩大清理范围。 */ (): string | null => localStorage.getItem('session-regression-marker'))).toBe('keep-me');
		await page.screenshot({ path: test.info().outputPath('recovered-with-stale-cache.png'), fullPage: true });
		expect(errors).toEqual([]);
	},
);

test('失效恢复后同一账户可以重新登录并更新保存凭据',
	/** 真实登录交互证明旧账户快捷记录不会再次带回已撤销的 token。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		await revokeAccount(user);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		await page.getByTestId('modal-dialog-ok').click();
		await signIn(page, BASE_URL, user.account.username, user.password);
		await expect.poll(/** 等待真实登录完成后的缓存提交。 */ async (): Promise<string | undefined> => (await cachedAccount(page))?.id).toBe(user.account.id);
		const renewed: AccountWithToken | null = await cachedAccount(page);
		expect(renewed?.token).not.toBe(user.account.token);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		const device: DeviceState = await page.evaluate(deviceStateInBrowser, undefined);
		expect(device.accountTokens?.[`${new URL(BASE_URL).host}/${user.account.id}`]).toBe(renewed?.token);
		expect(errors).toEqual([]);
	},
);

test('账户验证网络中断保留凭据并支持重试',
	/** 仅中断传输；重试后的认证结果由真实后端提供。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		await page.route('**/api/i',
			/** 模拟浏览器无法连接，不伪造任何账户协议结果。 */
			async (route: Route): Promise<void> => { await route.abort('connectionfailed'); },
		);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expect(page.locator('#session-retry')).toBeVisible();
		expect((await cachedAccount(page))?.token).toBe(user.account.token);
		await page.unroute('**/api/i');
		await page.locator('#session-retry button').click();
		await expectMounted(page);
		expect((await cachedAccount(page))?.id).toBe(user.account.id);
		expect(errors).toEqual([]);
	},
);

test('远端配置中断不悬挂加载且不打开账户向导',
	/** 账户验证真实成功，配置传输失败应保留本地配置并完成页面启动。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		await page.route('**/api/i/registry/get-all',
			/** 在账户验证之后中断配置请求，覆盖独立 loaded 失败出口。 */
			async (route: Route): Promise<void> => { await route.abort('connectionfailed'); },
		);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		await expect(page.getByTestId('user-setup-dialog')).toHaveCount(0);
		expect((await cachedAccount(page))?.token).toBe(user.account.token);
		expect(errors).toEqual([]);
	},
);

test('账户验证成功后立即撤销仍可从配置认证失败恢复',
	/** 在两个真实请求之间撤销凭据，覆盖启动前验证无法消除的时间竞态。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		let revocation: Promise<void> | undefined;
		await page.route('**/api/i/registry/get-all',
			/** 只延迟真实配置请求，不改写后端认证响应。 */
			async (route: Route): Promise<void> => {
				revocation ??= revokeAccount(user);
				await revocation;
				await route.continue();
			},
		);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		expect(await cachedAccount(page)).toBeNull();
		expect(errors).toEqual([]);
	},
);

test('损坏的当前账户缓存不会清除无关设置',
	/** 本地格式错误只处理对应账户记录，不扩大为全站清理。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const errors: string[] = collectPageErrors(page);
		await page.goto(`${BASE_URL}/robots.txt`);
		await page.evaluate(
			/** 构造损坏持久化数据而不是伪造服务器账户事实。 */
			(): void => {
				localStorage.setItem('account', '{broken');
				localStorage.setItem('session-regression-marker', 'keep-me');
			},
		);
		await page.goto(`${BASE_URL}/?ui=twitter`);
		await expectMounted(page);
		expect(await cachedAccount(page)).toBeNull();
		expect(await page.evaluate(/** 读取无关设置，验证恢复没有扩大清理范围。 */ (): string | null => localStorage.getItem('session-regression-marker'))).toBe('keep-me');
		expect(errors).toEqual([]);
	},
);

test('旧请求迟到的真实认证失败不会清除另一标签页的新会话',
	/** 延迟真实后端的失败响应，验证恢复前的凭据归属比较。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const oldUser: TestAccount = await createAccount();
		const newUser: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, oldUser.account);
		await revokeAccount(oldUser);
		const responseReady: PromiseWithResolvers<void> = Promise.withResolvers<void>();
		const releaseResponse: PromiseWithResolvers<void> = Promise.withResolvers<void>();
		await page.route('**/api/i',
			/** 转发真实请求，只控制失败响应的到达时刻，不生成模拟业务响应。 */
			async (route: Route): Promise<void> => {
				const payload: unknown = route.request().postDataJSON();
				if (typeof payload === 'object' && payload !== null && 'i' in payload && payload.i === oldUser.account.token) {
					const response: APIResponse = await route.fetch();
					expect(response.status()).toBe(401);
					responseReady.resolve();
					await releaseResponse.promise;
					await route.fulfill({ response });
				} else {
					await route.continue();
				}
			},
		);
		await page.goto(`${BASE_URL}/?ui=twitter`, { waitUntil: 'domcontentloaded' });
		await responseReady.promise;
		const otherPage: Page = await page.context().newPage();
		await seedAccount(otherPage, newUser.account);
		releaseResponse.resolve();
		await expectMounted(page);
		expect((await cachedAccount(page))?.id).toBe(newUser.account.id);
		expect((await cachedAccount(page))?.token).toBe(newUser.account.token);
		expect(errors).toEqual([]);
		await otherPage.close();
	},
);

test('分享子启动入口也能恢复失效缓存',
	/** 覆盖 subBoot 的真实入口，避免只修复主页启动。 */
	async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		const user: TestAccount = await createAccount();
		const errors: string[] = collectPageErrors(page);
		await seedAccount(page, user.account);
		await revokeAccount(user);
		await page.goto(`${BASE_URL}/share?text=session-regression`);
		await expectMounted(page);
		expect(await cachedAccount(page)).toBeNull();
		expect(new URL(page.url()).pathname).toBe('/share');
		expect(errors).toEqual([]);
	},
);
