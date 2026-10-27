/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 社区请求归属适配测试：只证明 Bootstrap 会话作用域到公共归属 API 的映射。
 * 不创建账户、凭据或后端状态，不以受控身份引用证明真实认证、换号或业务隔离。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRequestOwner } from '@/accounts/ownership/domain/index.js';
import { captureAccountOwnership, getAccountOwnershipIdentity, ownsAccountRequest } from '@/community-app/adapters/ownership/index.js';

/** 受控来源只交付归属引用，避免把会话 DTO 搬入业务适配器。 */
const fixture: { scope: AccountRequestOwner | null } = vi.hoisted(
	/** 在被测公开适配器加载前提供会话作用域来源。 */ (): { scope: AccountRequestOwner | null } => ({ scope: null }),
);

vi.mock('@/community-app/state/session/index.js', /** 替换状态所有者公开读取方法，不构造会话实现。 */ (): { getCommunitySessionScope: () => AccountRequestOwner | null } => ({
	/** 原样交付本例的权威作用域输入。 */
	getCommunitySessionScope: (): AccountRequestOwner | null => fixture.scope,
}));

beforeEach(/** 每例从无作用域开始，不保留跨例身份。 */ (): void => { fixture.scope = null; });

describe('社区账户请求归属映射', /** 仅校验身份引用映射，不运行社区业务。 */ (): void => {
	it('无会话时不签发身份', /** Bootstrap 未安装作用域时保持明确未认证边界。 */ (): void => {
		expect(captureAccountOwnership()).toBeNull();
		expect(getAccountOwnershipIdentity()).toBeNull();
	});

	it('交付原有权威作用域，拒绝账户或身份不同的输入', /** 不复制账户状态或生成第二个身份。 */ (): void => {
		const scope: AccountRequestOwner = Object.freeze({ accountId: 'adapter-account', identity: Object.freeze({}) });
		fixture.scope = scope;
		expect(captureAccountOwnership()).toBe(scope);
		expect(getAccountOwnershipIdentity()).toBe(scope.identity);
		expect(ownsAccountRequest(scope)).toBe(true);
		expect(ownsAccountRequest({ ...scope, accountId: 'other-account' })).toBe(false);
		expect(ownsAccountRequest({ ...scope, identity: Object.freeze({}) })).toBe(false);
	});

	it('来源失效后拒绝原作用域', /** 旧引用只能用于比较，不能恢复已撤销作用域。 */ (): void => {
		const scope: AccountRequestOwner = Object.freeze({ accountId: 'adapter-account', identity: Object.freeze({}) });
		fixture.scope = scope;
		fixture.scope = null;
		expect(ownsAccountRequest(scope)).toBe(false);
	});
});
