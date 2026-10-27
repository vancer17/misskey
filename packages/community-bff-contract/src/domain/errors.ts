/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 失败语义。
 * 作用：保留 Misskey 业务错误的消费结构，同时隔离认证失效与上游故障。
 * 数据链：HTTP 状态与安全错误投影 → 适配器；原始响应及凭据不进入 Error.message。
 */
import type { api } from 'misskey-js';

/** 稳定 BFF 控制错误码；普通业务 403 不等价于会话失效。 */
export const COMMUNITY_BFF_ERROR_CODES = {
	/** 会话到期，可由宿主取得新的授权后续期。 */
	sessionExpired: 'COMMUNITY_SESSION_EXPIRED',
	/** 会话撤销，当前业务身份必须失效。 */
	sessionRevoked: 'COMMUNITY_SESSION_REVOKED',
	/** 授权已失效或已消费，不可重放。 */
	grantInvalid: 'COMMUNITY_GRANT_INVALID',
	/** 授权绑定账户变化，必须新建社区文档。 */
	identityChanged: 'COMMUNITY_IDENTITY_CHANGED',
	/** 当前授权不具备操作权限，不触发全局退出。 */
	forbidden: 'COMMUNITY_FORBIDDEN',
	/** BFF 请求限流，写操作不得自动重放。 */
	rateLimited: 'COMMUNITY_RATE_LIMITED',
	/** 上游不可用，保留会话身份。 */
	upstreamUnavailable: 'COMMUNITY_UPSTREAM_UNAVAILABLE',
	/** 响应不符合任何已声明的错误协议。 */
	invalidError: 'COMMUNITY_INVALID_BFF_ERROR',
} as const;

/** 传输层安全错误；仅固定 code 进入消息，业务错误字段置于显式只读投影。 */
export class CommunityBffError extends Error {
	/** 保存 HTTP 状态、固定错误码以及可供既有 UI 消费的上游业务错误。 */
	constructor(readonly status: number, readonly code: string, readonly apiError?: Readonly<api.APIError>) {
		super(code);
		this.name = 'CommunityBffError';
	}
}
