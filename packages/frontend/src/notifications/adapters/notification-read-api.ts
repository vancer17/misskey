/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通知接口适配器：显式使用请求所属会话，复用原已读及账户接口，不解释 UI 或运行环境。 */
import type * as Misskey from 'misskey-js';
import type { AccountCredentials } from '@/accounts/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 等待已有全局已读水位接口实际完成，供随后账户查询使用。 */
export async function acknowledgeNotifications(credentials: AccountCredentials): Promise<void> {
	await misskeyApi('notifications/mark-all-as-read', {}, credentials.token);
}

/** 查询同一会话的权威账户快照；由状态层筛选允许提交的未读字段。 */
export async function requestNotificationsAccount(credentials: AccountCredentials): Promise<Misskey.entities.MeDetailed> {
	return await misskeyApi('i', {}, credentials.token);
}
