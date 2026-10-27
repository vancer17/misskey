/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 协议的输入适配边界。
 * 作用：执行权威控制 Schema，拒绝附加认证字段并核对上游身份。
 * 数据链：未知网络 DTO → 校验后控制模型；业务实体完整字段仍由现行 Misskey Schema 负责。
 */
import type { entities } from 'misskey-js';
import { COMMUNITY_BFF_SCHEMAS } from '../domain/schema.js';
import { isCommunityCredentialField } from '../domain/credential-fields.js';
import { validateMeDetailed, validateMetaDetailed } from '../../built/entities.js';
import type { CommunityBffControlError, CommunityBffExchangeRequest, CommunityBffGrant, CommunityBffGrantRequest, CommunityBffRenewRequest, CommunityBffSession, CommunityBffSessionRequest, CommunityBffStreamTicket, CommunitySchema, CommunitySchemaValue } from '../domain/schema.js';

/** 只接受普通数据记录，排除数组、类实例及原型污染载体。 */
export function isCommunityRecord(input: unknown): input is Record<string, unknown> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
	const prototype: unknown = Object.getPrototypeOf(input);
	return prototype === Object.prototype || prototype === null;
}

/** 以固定错误码报告协议问题，绝不把未知输入拼入错误消息。 */
function invalidPayload(): never {
	throw new Error('COMMUNITY_INVALID_BFF_PAYLOAD');
}

/** 验证 ISO 时间的完整时区与有效日期；有效期策略由会话客户端负责。 */
function isIsoDate(input: string): boolean {
	const parts: RegExpExecArray | null = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(input);
	if (parts === null) return false;
	const year: number = Number(parts[1]);
	const month: number = Number(parts[2]);
	const day: number = Number(parts[3]);
	const leap: boolean = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const monthDays: readonly number[] = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1] && Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60 && Number.isFinite(Date.parse(input));
}

/** 限定规范 HTTPS origin，避免凭据、查询或路径混入实例身份。 */
function isCanonicalOrigin(input: string): boolean {
	try {
		const address: URL = new URL(input);
		return address.protocol === 'https:' && address.origin === input;
	} catch (_error: unknown) {
		return false;
	}
}

/** 执行当前SDK生成Schema的完整shape校验，并阻止凭据混入实体。 */
function parseEntity(input: unknown, reference: string): unknown {
	if (!isCommunityRecord(input)) return invalidPayload();
	for (const field of Object.keys(input)) {
		if (isCommunityCredentialField(field)) return invalidPayload();
	}
	if (reference.endsWith('/MeDetailed')) {
		if (!validateMeDetailed(input)) return invalidPayload();
	} else {
		if (!validateMetaDetailed(input)) return invalidPayload();
	}
	return input;
}

/** 校验账户完整shape与凭据隔离，供账户Store接收真实全量或合并更新时复用。 */
export function parseCommunityBffAccount(input: unknown): entities.MeDetailed {
	return parseEntity(input, COMMUNITY_BFF_SCHEMAS.Session.properties.me.$ref) as entities.MeDetailed;
}

/** 校验实例完整shape与凭据隔离，供实例Store原子接收真实后端更新。 */
export function parseCommunityBffInstance(input: unknown): entities.MetaDetailed {
	return parseEntity(input, COMMUNITY_BFF_SCHEMAS.Session.properties.meta.$ref) as entities.MetaDetailed;
}

/** 运行权威 Schema，返回新控制对象；不对 SDK 实体复制字段定义。 */
function parseSchemaNode(input: unknown, schema: CommunitySchema): unknown {
	if ('$ref' in schema) return parseEntity(input, schema.$ref);
	if (schema.type === 'string') {
		if (typeof input !== 'string' || (schema.minLength !== undefined && input.length < schema.minLength) || (schema.maxLength !== undefined && input.length > schema.maxLength)) return invalidPayload();
		if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(input)) return invalidPayload();
		if (schema.format === 'date-time' && !isIsoDate(input)) return invalidPayload();
		if (schema.format === 'origin' && !isCanonicalOrigin(input)) return invalidPayload();
		return input;
	}
	if (!isCommunityRecord(input)) return invalidPayload();
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(input)) {
		if (!Object.hasOwn(schema.properties, key)) return invalidPayload();
	}
	for (const key of schema.required) {
		if (!Object.hasOwn(input, key)) return invalidPayload();
	}
	for (const key of Object.keys(schema.properties)) {
		if (Object.hasOwn(input, key)) result[key] = parseSchemaNode(input[key], schema.properties[key]);
	}
	return result;
}

/** 将经过同一权威 Schema 完整控制字段校验的结果收窄为派生类型。 */
function parseControl<Schema extends CommunitySchema>(input: unknown, schema: Schema): CommunitySchemaValue<Schema> {
	return parseSchemaNode(input, schema) as CommunitySchemaValue<Schema>;
}

/** 校验宿主申请授权的控制请求，拒绝隐藏的长期凭据。 */
export function parseCommunityBffGrantRequest(input: unknown): CommunityBffGrantRequest {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.GrantRequest);
}

/** 校验宿主收到的短时单次授权响应。 */
export function parseCommunityBffGrant(input: unknown): CommunityBffGrant {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.Grant);
}

/** 校验单次授权兑换请求。 */
export function parseCommunityBffExchangeRequest(input: unknown): CommunityBffExchangeRequest {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.ExchangeRequest);
}

/** 校验同一实例、同一会话的续期请求。 */
export function parseCommunityBffRenewRequest(input: unknown): CommunityBffRenewRequest {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.RenewRequest);
}

/** 校验注销或流票据请求中的实例与会话标识。 */
export function parseCommunityBffSessionRequest(input: unknown): CommunityBffSessionRequest {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.SessionRequest);
}

/** 校验 BFF 响应并核对账户及实例权威事实，不创建替代用户。 */
export function parseCommunityBffSession(input: unknown): CommunityBffSession {
	const session: CommunityBffSession = parseControl(input, COMMUNITY_BFF_SCHEMAS.Session);
	if (session.me.id !== session.accountId || session.meta.uri !== session.canonicalInstanceUrl) return invalidPayload();
	return session;
}

/** 校验短时单次流票据，具体使用次数由真实 BFF 强制。 */
export function parseCommunityBffStreamTicket(input: unknown): CommunityBffStreamTicket {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.StreamTicket);
}

/** 校验 BFF 控制错误，附加认证字段或正文均不进入客户端错误。 */
export function parseCommunityBffControlError(input: unknown): CommunityBffControlError {
	return parseControl(input, COMMUNITY_BFF_SCHEMAS.ControlError);
}

/** 验证兼容 API 顶层参数，禁止业务参数反向覆盖 BFF 凭据或控制授权。 */
export function assertCommunityBffApiParameters(input: unknown): asserts input is Record<string, unknown> {
	if (!isCommunityRecord(input)) return invalidPayload();
	for (const field of Object.keys(input)) {
		if (isCommunityCredentialField(field)) throw new Error('COMMUNITY_FORBIDDEN_API_CREDENTIAL');
	}
}
