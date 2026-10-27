/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 原站账户归属适配器：将既有内存账户和持久化凭据映射为不透明请求身份。
 * 凭据仅在本适配器私有变量中参与一致性校验，业务层不再携带或比较 token。
 * 社区专用构建通过固定编译映射使用自己的会话适配器，不读取原站存储。
 */
import { $i } from '@/i.js';
import { parseAccountCredentials } from '@/accounts/index.js';
import type { AccountCredentials } from '@/accounts/index.js';
import { miLocalStorage } from '@/local-storage.js';
import type { AccountRequestOwner } from './domain/index.js';

export type { AccountRequestOwner } from './domain/index.js';

/** 仅保留最后验证成功的凭据，以判断原站同账户重新登录的归属边界。 */
let credentials: AccountCredentials | null = null;
/** 不透明身份的唯一原站实例，不复制任何账户业务事实。 */
let owner: AccountRequestOwner | null = null;

/** 捕获当前认证归属；内存与持久化账户不一致时拒绝签发请求身份。 */
export function captureAccountOwnership(): AccountRequestOwner | null {
	const saved: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	if ($i === null || saved?.id !== $i.id || saved.token !== $i.token) {
		credentials = null;
		owner = null;
		return null;
	}
	if (credentials?.id !== $i.id || credentials.token !== $i.token || owner === null) {
		credentials = Object.freeze({ id: $i.id, token: $i.token });
		const identity: object = Object.freeze({
			/** 身份只按引用比较，禁止把内部归属写入持久化或桥接消息。 */
			toJSON(): never { throw new TypeError('ACCOUNT_IDENTITY_NOT_SERIALIZABLE'); },
		});
		owner = Object.freeze({ accountId: $i.id, identity });
	}
	return owner;
}

/** 检查捕获身份仍由当前认证账户拥有；同账户换凭据也会拒绝旧请求。 */
export function ownsAccountRequest(requestOwner: AccountRequestOwner): boolean {
	const current: AccountRequestOwner | null = captureAccountOwnership();
	return current !== null && current.accountId === requestOwner.accountId && current.identity === requestOwner.identity;
}

/** 提供可观察但不可解析的身份引用，用于释放账户边界上的 UI 监听。 */
export function getAccountOwnershipIdentity(): object | null {
	return captureAccountOwnership()?.identity ?? null;
}
