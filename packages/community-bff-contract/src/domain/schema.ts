/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 控制协议的权威 Schema。
 * 作用：控制 DTO 的类型、运行校验及交接 Schema 均从本文件单向派生。
 * 数据链：宿主授权 → BFF 社区短会话；Misskey 业务实体继续引用 SDK 权威模型。
 */
import type { entities } from 'misskey-js';

/** JSON Schema 的字符串节点；长度与格式同时用于运行校验。 */
export type CommunityStringSchema = Readonly<{ type: 'string'; minLength?: number; maxLength?: number; format?: 'date-time' | 'origin'; pattern?: string }>;

/** 对现行 Misskey OpenAPI 实体的引用，不复制业务字段。 */
export type CommunityEntitySchema = Readonly<{ $ref: 'misskey.openapi.json#/components/schemas/MeDetailed' | 'misskey.openapi.json#/components/schemas/MetaDetailed' }>;

/** 严格控制对象；未声明的字段不进入认证链。 */
export type CommunityObjectSchema = Readonly<{ type: 'object'; additionalProperties: false; properties: Readonly<Record<string, CommunitySchema>>; required: readonly string[] }>;

/** 控制协议允许的 Schema 节点联合。 */
export type CommunitySchema = CommunityStringSchema | CommunityEntitySchema | CommunityObjectSchema;

/** 从权威 Schema 推导控制 DTO，外部实体引用始终保留 SDK 类型。 */
export type CommunitySchemaValue<Schema extends CommunitySchema> = Schema extends { $ref: 'misskey.openapi.json#/components/schemas/MeDetailed' } ? entities.MeDetailed
	: Schema extends { $ref: 'misskey.openapi.json#/components/schemas/MetaDetailed' } ? entities.MetaDetailed
		: Schema extends { type: 'string' } ? string
			: Schema extends { type: 'object'; properties: infer Properties extends Readonly<Record<string, CommunitySchema>>; required: readonly (infer Required extends string)[] }
				? { [Key in keyof Properties as Key extends Required ? Key : never]: CommunitySchemaValue<Properties[Key]> } & { [Key in keyof Properties as Key extends Required ? never : Key]?: CommunitySchemaValue<Properties[Key]> }
				: never;

/** 不可解析的实例、会话及账户标识；禁止用作凭据或业务实体替代。 */
const identifierSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._~-]+$' } as const satisfies CommunityStringSchema;

/** 单次授权与短期访问凭据均作为无空白、不透明字符串传输。 */
const credentialSchema = { type: 'string', minLength: 1, maxLength: 8192, pattern: '^[\\x21-\\x7E]+$' } as const satisfies CommunityStringSchema;

/** 服务端时间采用带时区的 ISO 字符串，客户端不从其推导用户身份。 */
const expiresAtSchema = { type: 'string', format: 'date-time' } as const satisfies CommunityStringSchema;

/** 权威控制 DTO；各对象禁止附加字段，防止混入旧 token 或接口参数。 */
export const COMMUNITY_BFF_SCHEMAS = {
	/** 宿主凭现有 App 认证申请授权；续期时附当前会话标识。 */
	GrantRequest: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 当前装配实例标识。 */
			instanceId: identifierSchema,
			/** 可选的待续期社区会话标识。 */
			sessionId: identifierSchema,
		}, required: ['instanceId'],
	},
	/** BFF 返回宿主转交的一次性授权，不包含 App 或 Misskey 长期凭据。 */
	Grant: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 社区单次兑换授权。 */
			grant: credentialSchema,
			/** 授权失效时间。 */
			expiresAt: expiresAtSchema,
		}, required: ['grant', 'expiresAt'],
	},
	/** 社区使用宿主授权兑换真实 BFF 会话。 */
	ExchangeRequest: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 当前装配实例标识。 */
			instanceId: identifierSchema,
			/** 宿主提供的单次授权。 */
			grant: credentialSchema,
		}, required: ['instanceId', 'grant'],
	},
	/** 同一会话续期；BFF 必须拒绝以其他账户替换原身份。 */
	RenewRequest: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 当前装配实例标识。 */
			instanceId: identifierSchema,
			/** 已建立的社区会话标识。 */
			sessionId: identifierSchema,
			/** 宿主重新申请的单次授权。 */
			grant: credentialSchema,
		}, required: ['instanceId', 'sessionId', 'grant'],
	},
	/** 注销或流票据请求只引用当前实例与会话。 */
	SessionRequest: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 当前装配实例标识。 */
			instanceId: identifierSchema,
			/** 当前会话标识。 */
			sessionId: identifierSchema,
		}, required: ['instanceId', 'sessionId'],
	},
	/** 真实会话响应；访问凭据只能由传输层闭包持有。 */
	Session: {
		type: 'object', additionalProperties: false,
		properties: {
			/** BFF 签发的社区会话标识。 */
			sessionId: identifierSchema,
			/** 授权绑定的装配实例标识。 */
			instanceId: identifierSchema,
			/** Misskey 权威账户标识。 */
			accountId: identifierSchema,
			/** 上游实例规范 origin。 */
			canonicalInstanceUrl: { type: 'string', format: 'origin' },
			/** 社区专用短期 Bearer 凭据，不是 Misskey token。 */
			accessToken: credentialSchema,
			/** 短会话失效时间。 */
			expiresAt: expiresAtSchema,
			/** 真实上游账户，字段定义由 SDK 及其 OpenAPI 所有。 */
			me: { $ref: 'misskey.openapi.json#/components/schemas/MeDetailed' },
			/** 真实上游实例，字段定义由 SDK 及其 OpenAPI 所有。 */
			meta: { $ref: 'misskey.openapi.json#/components/schemas/MetaDetailed' },
		}, required: ['sessionId', 'instanceId', 'accountId', 'canonicalInstanceUrl', 'accessToken', 'expiresAt', 'me', 'meta'],
	},
	/** 每次连接单独领取一次性票据，禁止复用长会话凭据作为 URL 参数。 */
	StreamTicket: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 服务端单次消费的流连接票据。 */
			ticket: credentialSchema,
			/** 票据失效时间。 */
			expiresAt: expiresAtSchema,
		}, required: ['ticket', 'expiresAt'],
	},
	/** BFF 自身控制错误只提供稳定错误码，不回显认证输入。 */
	ControlError: {
		type: 'object', additionalProperties: false,
		properties: {
			/** 固定错误 envelope。 */
			error: {
				type: 'object', additionalProperties: false,
				properties: {
					/** COMMUNITY 前缀区分上游业务错误。 */
					code: { type: 'string', minLength: 11, maxLength: 128, pattern: '^COMMUNITY_[A-Z0-9_]+$' },
				}, required: ['code'],
			},
		}, required: ['error'],
	},
} as const satisfies Readonly<Record<string, CommunityObjectSchema>>;

/** 宿主申请单次授权的权威请求类型。 */
export type CommunityBffGrantRequest = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.GrantRequest>;
/** 宿主授权的权威响应类型。 */
export type CommunityBffGrant = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.Grant>;
/** 单次授权兑换请求类型。 */
export type CommunityBffExchangeRequest = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.ExchangeRequest>;
/** 同身份续期请求类型。 */
export type CommunityBffRenewRequest = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.RenewRequest>;
/** 已建立会话的标识请求类型。 */
export type CommunityBffSessionRequest = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.SessionRequest>;
/** BFF 会话权威响应类型；仅传输边界可接触访问凭据。 */
export type CommunityBffSession = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.Session>;
/** 给 Bootstrap 的会话只读投影，不暴露访问凭据。 */
export type CommunityBffSessionView = Readonly<Omit<CommunityBffSession, 'accessToken'>>;
/** 单次流连接票据权威响应类型。 */
export type CommunityBffStreamTicket = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.StreamTicket>;
/** BFF 自身错误的权威控制 envelope。 */
export type CommunityBffControlError = CommunitySchemaValue<typeof COMMUNITY_BFF_SCHEMAS.ControlError>;
