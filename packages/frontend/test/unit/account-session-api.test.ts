/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 账户适配器单元测试：仅证明请求序列化、响应及错误映射、本地缓存解析。
 * 会话恢复与真实登录行为由 session-recovery.spec.ts 的真实后端测试证明。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { AccountRequestError, getAccountErrorCode, getInvalidSessionReason, parseAccountCredentials, requestAccount } from '@/accounts/index.js';

afterEach(
	/** 恢复协议替身，避免影响其他单元测试。 */
	(): void => { vi.restoreAllMocks(); },
);

describe('账户协议边界',
	/** 本组不执行或声称证明领域会话恢复。 */
	(): void => {
		it('显式序列化 token 并返回权威账户响应',
			/** 检查调用方凭据未被隐藏的全局账户覆盖。 */
			async (): Promise<void> => {
				const fetchSpy: MockInstance<typeof window.fetch> = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({
					id: 'protocol-user', username: 'protocol', isAdmin: false, policies: {},
				}), { status: 200 }));
				const account: Awaited<ReturnType<typeof requestAccount>> = await requestAccount('protocol-fixture-token');
				expect(account.id).toBe('protocol-user');
				expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/i'), expect.objectContaining({
					method: 'POST', body: JSON.stringify({ i: 'protocol-fixture-token' }), credentials: 'omit', cache: 'no-store',
				}));
			},
		);
		it('仅明确 401 认证失败映射为 revoked',
			/** 保留状态码与协议错误码的组合约束。 */
			(): void => {
				const error: AccountRequestError = new AccountRequestError(401, { id: 'fixture', code: 'AUTHENTICATION_FAILED', message: 'invalid token' });
				expect(getInvalidSessionReason(error)).toBe('revoked');
				expect(getAccountErrorCode(error)).toBe('AUTHENTICATION_FAILED');
			},
		);
		it('5xx 即使含认证错误文本也不认定凭据失效',
			/** 网关或服务故障不能变成注销依据。 */
			(): void => {
				const error: AccountRequestError = new AccountRequestError(503, { id: 'fixture', code: 'AUTHENTICATION_FAILED', message: 'upstream failed' });
				expect(getInvalidSessionReason(error)).toBeNull();
			},
		);
		it('403 权限不足与暂停账户不映射为凭据撤销',
			/** 不扩大既有错误类型的业务含义。 */
			(): void => {
				for (const code of ['PERMISSION_DENIED', 'SUSPENDED', 'CREDENTIAL_REQUIRED']) {
					expect(getInvalidSessionReason(new AccountRequestError(403, { id: 'fixture', code, message: code }))).toBeNull();
				}
			},
		);
		it('账户删除保持独立错误语义',
			/** 将明确的删除协议映射为单独的恢复原因。 */
			(): void => {
				expect(getInvalidSessionReason(new AccountRequestError(400, { id: 'fixture', code: 'USER_IS_DELETED', message: 'deleted' }))).toBe('deleted');
			},
		);
		it('现有 misskeyApi 错误可以复用同一分类入口',
			/** 仅适配当前真实存在的错误出口，不新增兼容协议。 */
			(): void => {
				expect(getInvalidSessionReason({ id: 'fixture', code: 'AUTHENTICATION_FAILED', message: 'invalid' })).toBe('revoked');
				expect(getInvalidSessionReason(new TypeError('Failed to fetch'))).toBeNull();
				expect(getInvalidSessionReason({ message: 'Authentication failed' })).toBeNull();
			},
		);
		it('拒绝无法解析或缺少关键字段的成功响应',
			/** 适配器不将不完整协议响应直接交给账户消费方。 */
			async (): Promise<void> => {
				vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
				await expect(requestAccount('protocol-fixture-token')).rejects.toThrow('Invalid account response');
			},
		);
		it('失败响应保留状态且不暴露请求凭据',
			/** 验证适配器输出，不使用模拟错误证明真实会话行为。 */
			async (): Promise<void> => {
				vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: {
					id: 'fixture', code: 'AUTHENTICATION_FAILED', message: 'invalid',
				} }), { status: 401 }));
				await expect(requestAccount('protocol-fixture-token')).rejects.toMatchObject({ status: 401, apiError: { code: 'AUTHENTICATION_FAILED' } });
			},
		);
		it('损坏缓存只产生空凭据投影',
			/** 缓存解析只检查身份与凭据，不从视图字段推断业务权限。 */
			(): void => {
				expect(parseAccountCredentials('{broken')).toBeNull();
				expect(parseAccountCredentials('{"id":"user","token":""}')).toBeNull();
				expect(parseAccountCredentials('null')).toBeNull();
				expect(parseAccountCredentials('{"id":"user","token":"fixture","isAdmin":true}')).toEqual({ id: 'user', token: 'fixture' });
			},
		);
	},
);
