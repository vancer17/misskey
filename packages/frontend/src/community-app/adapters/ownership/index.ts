/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 社区账户归属适配器：把 Bootstrap 验证后的会话作用域交给原有业务状态所有者。
 * 数据链：真实会话安装 → 不透明归属 → 迟到结果拒绝；不读取凭据或本地账户缓存。
 */
import { getCommunitySessionScope } from '../../state/session/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/domain/index.js';

export type { AccountRequestOwner } from '@/accounts/ownership/domain/index.js';

/** 捕获已建立社区会话的归属，尚未认证和销毁后的实例均返回空值。 */
export function captureAccountOwnership(): AccountRequestOwner | null {
	return getCommunitySessionScope();
}

/** 原账户续期保留身份引用，换号、撤销和文档销毁立即拒绝旧身份。 */
export function ownsAccountRequest(owner: AccountRequestOwner): boolean {
	const current: AccountRequestOwner | null = getCommunitySessionScope();
	return current !== null && current.accountId === owner.accountId && current.identity === owner.identity;
}

/** 暴露只供监听边界变化的身份引用，业务调用者不得解析或序列化。 */
export function getAccountOwnershipIdentity(): object | null {
	return getCommunitySessionScope()?.identity ?? null;
}
