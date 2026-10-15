/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 账户领域：复用 Misskey 的权威账户模型，定义本地会话所附加的凭据。
 * 本文件不加载存储、界面或网络模块；启动入口与既有账户模块共用这些类型。
 */
import type * as Misskey from 'misskey-js';

/** 后端账户模型与本地凭据的唯一组合类型，不复制后端账户字段。 */
export type AccountWithToken = Misskey.entities.MeDetailed & { token: string };

/** 从权威会话派生的只读凭据快照，用于识别请求归属及防止旧失败删除新会话。 */
export type AccountCredentials = Readonly<Pick<AccountWithToken, 'id' | 'token'>>;

/** 后端明确否定会话的原因；网络失败与账户暂停不属于可删除凭据的结果。 */
export type InvalidSessionReason = 'revoked' | 'deleted';

/** 本次启动已确认失效的会话；仅在恢复调用链上传递，不持久化第二份账户状态。 */
export type InvalidSession = Readonly<{
	credentials: AccountCredentials;
	reason: InvalidSessionReason;
}>;
