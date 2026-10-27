/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 账户请求归属协议测试：只验证存量原站凭据输入到不透明身份的映射。
 * 不使用 Mock 证明认证、换号业务或真实后端隔离；真实会话行为另由集成验收覆盖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAccountOwnership, getAccountOwnershipIdentity, ownsAccountRequest } from '@/accounts/ownership/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/index.js';

/** 最小认证协议输入，仅提供适配器实际读取的字段。 */
type OwnershipFixture = Readonly<{ id: string; token: string }>;

/** 认证模块替身只模拟输入引用，不创建应用账户或业务状态。 */
const fixture: { current: OwnershipFixture | null } = vi.hoisted(
	/** 在账户模块加载前安装协议输入。 */ (): { current: OwnershipFixture | null } => ({ current: null }),
);

vi.mock('@/i.js', /** 由用例控制原站认证来源，避免导入真实账户启动链。 */ (): { readonly $i: OwnershipFixture | null } => ({
	/** 返回本例的认证协议输入。 */
	get $i(): OwnershipFixture | null { return fixture.current; },
}));

beforeEach(/** 清空原站映射输入，使每例身份来源独立。 */ (): void => {
	fixture.current = null;
	window.localStorage.removeItem('account');
	captureAccountOwnership();
});

/** 安装同一份内存与已存凭据协议样例，不执行登录行为。 */
function installCredentialInput(token: string): void {
	fixture.current = Object.freeze({ id: 'adapter-account', token });
	window.localStorage.setItem('account', JSON.stringify(fixture.current));
}

/** 明确要求适配器已经从有效输入签发归属，避免测试断言掩盖空值。 */
function captureRequiredOwner(): AccountRequestOwner {
	const owner: AccountRequestOwner | null = captureAccountOwnership();
	if (owner === null) throw new Error('MISSING_TEST_OWNER');
	return owner;
}

describe('原站账户请求归属映射', /** 所有样例仅证明适配器映射边界。 */ (): void => {
	it('缺少输入或两份输入不一致时不签发身份', /** 不能借用新账户凭据推进旧账户请求。 */ (): void => {
		expect(captureAccountOwnership()).toBeNull();
		installCredentialInput('credential-input-one');
		window.localStorage.setItem('account', JSON.stringify({ id: 'adapter-account', token: 'credential-input-other' }));
		expect(captureAccountOwnership()).toBeNull();
		expect(getAccountOwnershipIdentity()).toBeNull();
	});

	it('相同凭据只签发同一引用，不把凭据交给业务层', /** 请求只消费账户标识和不透明身份。 */ (): void => {
		installCredentialInput('credential-input-one');
		const owner: AccountRequestOwner = captureRequiredOwner();
		expect(captureAccountOwnership()).toBe(owner);
		expect(Object.keys(owner)).toEqual(['accountId', 'identity']);
		expect(getAccountOwnershipIdentity()).toBe(owner.identity);
		expect(ownsAccountRequest(owner)).toBe(true);
		expect(Object.isFrozen(owner)).toBe(true);
		expect(/** 身份不能被 JSON 写入存储或桥接消息。 */ (): string | undefined => JSON.stringify(owner)).toThrow('ACCOUNT_IDENTITY_NOT_SERIALIZABLE');
	});

	it('同账户的新凭据和输入失效均拒绝旧归属', /** 只按引用比较身份，不解释凭据内容。 */ (): void => {
		installCredentialInput('credential-input-one');
		const oldOwner: AccountRequestOwner = captureRequiredOwner();
		installCredentialInput('credential-input-two');
		const nextOwner: AccountRequestOwner = captureRequiredOwner();
		expect(nextOwner.accountId).toBe(oldOwner.accountId);
		expect(nextOwner.identity).not.toBe(oldOwner.identity);
		expect(ownsAccountRequest(oldOwner)).toBe(false);
		window.localStorage.removeItem('account');
		expect(ownsAccountRequest(nextOwner)).toBe(false);
	});
});
