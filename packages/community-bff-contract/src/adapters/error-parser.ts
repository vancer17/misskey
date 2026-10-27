/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 错误响应适配。
 * 作用：把未知 envelope 映射为控制错误或 Misskey 错误的安全投影。
 * 数据链：网络原始失败 → 固定错误语义；不持有或回显认证请求。
 */
import type { api } from 'misskey-js';
import { COMMUNITY_BFF_ERROR_CODES, CommunityBffError } from '../domain/errors.js';
import { isCommunityCredentialField } from '../domain/credential-fields.js';
import { isCommunityRecord, parseCommunityBffControlError } from './parsers.js';

/** 递归投影业务 info，仅保留 JSON 值并移除常见凭据字段。 */
function safeInfo(input: unknown, depth: number = 0): unknown {
	if (depth > 8) return null;
	if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string') return input;
	if (Array.isArray(input)) {
		/** 数组仅逐项递归，不把运行对象带入业务错误。 */
		return input.map((item: unknown): unknown => safeInfo(item, depth + 1));
	}
	if (!isCommunityRecord(input)) return null;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(input)) {
		if (isCommunityCredentialField(key)) continue;
		result[key] = safeInfo(input[key], depth + 1);
	}
	return result;
}

/** 解析固定错误 envelope；不保留整个响应、不把原始错误正文拼入消息。 */
export function parseCommunityBffError(status: number, input: unknown): CommunityBffError {
	if (!isCommunityRecord(input) || !isCommunityRecord(input.error)) return new CommunityBffError(status, COMMUNITY_BFF_ERROR_CODES.invalidError);
	const error: Record<string, unknown> = input.error;
	if (typeof error.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)) return new CommunityBffError(status, COMMUNITY_BFF_ERROR_CODES.invalidError);
	if (error.code.startsWith('COMMUNITY_')) {
		try {
			return new CommunityBffError(status, parseCommunityBffControlError(input).error.code);
		} catch (_error: unknown) {
			return new CommunityBffError(status, COMMUNITY_BFF_ERROR_CODES.invalidError);
		}
	}
	if (typeof error.id !== 'string' || typeof error.message !== 'string' || (error.kind !== 'client' && error.kind !== 'server' && error.kind !== 'permission')) return new CommunityBffError(status, COMMUNITY_BFF_ERROR_CODES.invalidError);
	const info: unknown = safeInfo(error.info);
	const upstream: Readonly<api.APIError> = Object.freeze({ id: error.id, code: error.code, message: error.message, kind: error.kind, info: isCommunityRecord(info) ? info : {} });
	return new CommunityBffError(status, error.code, upstream);
}
