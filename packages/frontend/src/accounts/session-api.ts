/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 账户协议适配器：显式凭据 → /api/i → Misskey 权威账户模型或可识别错误。
 * 不导入 $i、Store、弹窗或运行环境探测，供启动前验证和既有登录流程共同使用。
 */
import type * as Misskey from 'misskey-js';
import type { AccountCredentials, InvalidSessionReason } from './domain/session.js';

/** 从 misskey-js 的权威 API 错误派生只读协议视图，不保存响应中的任意附加数据。 */
type AccountApiError = Readonly<Pick<Misskey.api.APIError, 'id' | 'code' | 'message'>>;

/** 账户验证的网络等待上限；到期只终止请求，不认定凭据失效。 */
const ACCOUNT_REQUEST_TIMEOUT_MS: number = 10_000;

/** 保留 HTTP 状态与经过校验的协议错误，避免将网关故障等同于无效登录。 */
export class AccountRequestError extends Error {
	/** 将已校验的后端失败封装为适配器输出，不携带请求 token。 */
	constructor(public readonly status: number, public readonly apiError: AccountApiError) {
		super(apiError.message);
		this.name = 'AccountRequestError';
	}
}

/** 将不可信 JSON 收窄为对象，供协议及本地缓存边界校验使用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验后端错误的最小协议字段，不凭错误文本推断会话有效性。 */
function isAccountApiError(value: unknown): value is AccountApiError {
	return isRecord(value) && typeof value.id === 'string' && typeof value.code === 'string' && typeof value.message === 'string';
}

/** 读取本地账户的凭据投影；损坏缓存不进入领域账户或网络请求。 */
export function parseAccountCredentials(raw: string | null): AccountCredentials | null {
	if (raw === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
	if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.token !== 'string' || value.token.length === 0) return null;
	return Object.freeze({ id: value.id, token: value.token });
}

/** 提取脱敏错误码，同时兼容现有 misskeyApi 的原始错误出口，不复制其实现。 */
export function getAccountErrorCode(error: unknown): string | null {
	const value: unknown = error instanceof AccountRequestError ? error.apiError : error;
	return isAccountApiError(value) ? value.code : null;
}

/** 仅把后端明确否定凭据或账户的结果映射为失效；5xx、403 权限不足等保留会话。 */
export function getInvalidSessionReason(error: unknown): InvalidSessionReason | null {
	if (error instanceof AccountRequestError && (error.status < 400 || error.status >= 500)) return null;
	const code: string | null = getAccountErrorCode(error);
	if (code === 'AUTHENTICATION_FAILED' && (!(error instanceof AccountRequestError) || error.status === 401)) return 'revoked';
	if (code === 'USER_IS_DELETED') return 'deleted';
	return null;
}

/**
 * 验证指定凭据并返回现有后端账户模型；不读取当前账户，也不修改浏览器状态。
 * 响应校验位于适配器边界，业务调用方只消费映射后的账户及错误。
 */
export async function requestAccount(token: string): Promise<Misskey.entities.MeDetailed> {
	const controller: AbortController = new AbortController();
	const timeout: number = window.setTimeout(
		/** 限制网络请求时长，调用方将取消视为可重试而非注销证据。 */
		(): void => controller.abort(),
		ACCOUNT_REQUEST_TIMEOUT_MS,
	);
	try {
		const response: Response = await window.fetch(`${window.location.origin}/api/i`, {
			method: 'POST',
			body: JSON.stringify({ i: token }),
			headers: { 'Content-Type': 'application/json' },
			credentials: 'omit',
			cache: 'no-store',
			signal: controller.signal,
		});
		const body: unknown = await response.json();
		if (!response.ok) {
			if (isRecord(body) && isAccountApiError(body.error)) {
				throw new AccountRequestError(response.status, {
					id: body.error.id,
					code: body.error.code,
					message: body.error.message,
				});
			}
			throw new Error(`Account request failed (${response.status})`);
		}
		if (!isRecord(body) || typeof body.id !== 'string' || typeof body.username !== 'string' || typeof body.isAdmin !== 'boolean' || !isRecord(body.policies)) {
			throw new Error('Invalid account response');
		}
		return body as Misskey.entities.MeDetailed;
	} finally {
		window.clearTimeout(timeout);
	}
}
