/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通知接口适配器：显式使用请求所属会话，复用原已读及账户接口，不解释 UI 或运行环境。 */
import type * as Misskey from 'misskey-js';
import { ownsAccountRequest } from '@/accounts/ownership/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 等待已有全局已读水位接口实际完成，供随后账户查询使用。 */
export async function acknowledgeNotifications(owner: AccountRequestOwner): Promise<void> {
	if (!ownsAccountRequest(owner)) throw new Error('ACCOUNT_CHANGED');
	await misskeyApi('notifications/mark-all-as-read', {});
	if (!ownsAccountRequest(owner)) throw new Error('ACCOUNT_CHANGED');
}

/** 查询同一会话的权威账户快照；由状态层筛选允许提交的未读字段。 */
export async function requestNotificationsAccount(owner: AccountRequestOwner): Promise<Misskey.entities.MeDetailed> {
	if (!ownsAccountRequest(owner)) throw new Error('ACCOUNT_CHANGED');
	const account: Misskey.entities.MeDetailed = await misskeyApi('i', {});
	if (!ownsAccountRequest(owner)) throw new Error('ACCOUNT_CHANGED');
	return account;
}
