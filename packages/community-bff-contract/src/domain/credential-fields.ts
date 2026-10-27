/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 的凭据隔离策略。
 * 作用：统一列出不可由兼容业务请求传入的认证字段，避免不同适配器各写一份列表。
 * 数据链：权威隔离策略 → DTO校验、业务参数边界及错误安全投影。
 */

/** 业务参数禁止覆盖认证材料；grant及ticket仅允许出现在独立控制协议中。 */
export const COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS = [
	/** Misskey 原始请求凭据。 */
	'i',
	/** 旧账户或通用 token。 */
	'token',
	/** 社区短期访问凭据只能进入请求头。 */
	'accessToken',
	/** 刷新凭据保留在宿主认证后端。 */
	'refreshToken',
	/** 宿主长期凭据。 */
	'appToken',
	/** Misskey 凭据保留在 BFF。 */
	'misskeyToken',
	/** 不允许请求体覆写认证头。 */
	'authorization',
	/** 不允许请求体转送认证 cookie。 */
	'cookie',
	/** 单次授权仅用于控制请求。 */
	'grant',
	/** 流连接票据仅用于连接请求。 */
	'ticket',
	/** 密码属于宿主认证流程。 */
	'password',
	/** 阻止JSON字段覆盖对象原型入口。 */
	'__proto__',
	/** 阻止JSON字段覆盖构造器入口。 */
	'constructor',
	/** 阻止JSON字段构造原型污染载体。 */
	'prototype',
] as const;

/** 判断字段是否属于禁止转发的凭据或原型入口，大小写变化也不能绕过边界。 */
export function isCommunityCredentialField(field: string): boolean {
	/** 每项字段从单一权威常量比较，不复制凭据枚举。 */
	return COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS.some((forbidden: string): boolean => forbidden.toLowerCase() === field.toLowerCase());
}
