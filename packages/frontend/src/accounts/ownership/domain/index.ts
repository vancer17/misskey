/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 账户领域：异步请求的唯一归属类型。
 * 数据链：认证适配器签发不透明身份 → 业务动作捕获归属 → 提交前校验；
 * 身份只按引用比较，不包含凭据、环境配置或可序列化的认证事实。
 */

/** 账户标识与不可解析身份的只读组合；相同账户重新建立会话时必须获得不同身份。 */
export type AccountRequestOwner = Readonly<{
	accountId: string;
	identity: object;
}>;
