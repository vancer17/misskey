/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 契约交付 Schema。
 * 作用：从权威控制 Schema 生成 OpenAPI，避免文档另行复制控制字段。
 * 数据链：domain Schema → OpenAPI/JSON Schema；外部业务实体引用配套 Misskey schema。
 */
import { COMMUNITY_BFF_ENDPOINT_PATTERN, COMMUNITY_BFF_PATHS } from '../domain/endpoints.js';
import { COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS } from '../domain/credential-fields.js';
import { COMMUNITY_BFF_SCHEMAS } from '../domain/schema.js';

/** 交付文档为只读 JSON 数据，不额外抽象业务实现。 */
export type CommunityBffSchemaDocument = Readonly<Record<string, unknown>>;

/** 构造控制 Schema 的统一局部引用，字段定义始终从 domain 获得。 */
function schemaReference(name: keyof typeof COMMUNITY_BFF_SCHEMAS): Readonly<{ $ref: string }> {
	return { $ref: `#/components/schemas/${name}` };
}

/** 声明每个社区认证请求必须携带的实例归属头。 */
function instanceHeader(): CommunityBffSchemaDocument {
	return { name: 'X-Community-Instance-Id', in: 'header', required: true, schema: COMMUNITY_BFF_SCHEMAS.Session.properties.instanceId, description: '必须等于 grant/session 绑定的实例；BFF 不得仅信任此头授权。' };
}

/** 生成所有控制请求共用的错误响应定义。 */
function errorResponses(): CommunityBffSchemaDocument {
	return {
		default: {
			description: 'BFF 自身错误使用 COMMUNITY_* envelope；Misskey 业务错误保留上游字段，普通403不撤销会话。',
			content: { 'application/json': { schema: { oneOf: [schemaReference('ControlError'), { $ref: 'misskey.openapi.json#/components/schemas/Error' }] } } },
		},
	};
}

/** 生成固定控制操作，不把控制字段重新手写到 OpenAPI 中。 */
function controlOperation(operationId: string, request: keyof typeof COMMUNITY_BFF_SCHEMAS, response: keyof typeof COMMUNITY_BFF_SCHEMAS | null, security: 'hostAuth' | 'communityBearer' | null): CommunityBffSchemaDocument {
	return {
		post: {
			operationId,
			parameters: [instanceHeader()],
			security: security === null ? [] : [{ [security]: [] }],
			requestBody: { required: true, content: { 'application/json': { schema: schemaReference(request) } } },
			responses: {
				...(response === null ? { '204': { description: '已撤销；无响应正文。' } } : { '200': { description: '已校验的控制响应。', content: { 'application/json': { schema: schemaReference(response) } } } }),
				...errorResponses(),
			},
		},
	};
}

/** 输出独立 JSON Schema；跨文件实体引用与配套 Misskey OpenAPI 一同交付。 */
export function createCommunityBffJsonSchema(): CommunityBffSchemaDocument {
	return {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		$id: 'community-bff.schema.json',
		$defs: COMMUNITY_BFF_SCHEMAS,
	};
}

/** 输出 v1 接口协议；会话、写操作重试及 WebSocket 语义作为同版约束交付。 */
export function createCommunityBffOpenApi(): CommunityBffSchemaDocument {
	return {
		openapi: '3.1.0',
		info: { title: 'Misskey Community BFF', version: '1.0.0', description: 'BFF 保管 Misskey 凭据；社区仅持短期访问凭据。hostAuth 使用既有 App 认证，由 BFF 部署方明确其具体方案。' },
		servers: [{ url: '/community/v1' }],
		paths: {
			[`/${COMMUNITY_BFF_PATHS.grant}`]: controlOperation('createCommunityGrant', 'GrantRequest', 'Grant', 'hostAuth'),
			[`/${COMMUNITY_BFF_PATHS.exchange}`]: controlOperation('exchangeCommunitySession', 'ExchangeRequest', 'Session', null),
			[`/${COMMUNITY_BFF_PATHS.renew}`]: controlOperation('renewCommunitySession', 'RenewRequest', 'Session', null),
			[`/${COMMUNITY_BFF_PATHS.revoke}`]: controlOperation('revokeCommunitySession', 'SessionRequest', null, 'communityBearer'),
			[`/${COMMUNITY_BFF_PATHS.streamTicket}`]: controlOperation('createCommunityStreamTicket', 'SessionRequest', 'StreamTicket', 'communityBearer'),
			[`/${COMMUNITY_BFF_PATHS.api}/{endpoint}`]: {
				parameters: [instanceHeader(), { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', pattern: COMMUNITY_BFF_ENDPOINT_PATTERN }, description: 'Misskey 逻辑 endpoint，允许多段路径；BFF 必须按实际社区接口清单授权，禁止任意上游代理。' }],
				post: {
					operationId: 'postMisskeyCommunityApi', security: [{ communityBearer: [] }],
					requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', not: { anyOf: COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS.map(/** 从权威禁止字段生成 Schema，不复制凭据策略。 */ (field: string): Readonly<{ required: readonly string[] }> => ({ required: [field] })) } }, 'x-misskey-operation-schema': { document: 'misskey.openapi.json', path: '/{endpoint}', method: 'post', note: '将实际endpoint映射到配套OpenAPI路径键，消费该操作的requestBody及responses；不是泛型请求体的授权。' } } } },
					responses: { '200': { description: '原始 Misskey JSON，禁止附加一层data/result。', content: { 'application/json': { schema: {} } } }, '204': { description: '原始 Misskey 无正文成功。' }, ...errorResponses() },
				},
				get: { operationId: 'getMisskeyCommunityApi', security: [{ communityBearer: [] }], description: '仅对现有 SDK 允许的 GET endpoint 开放；保留 SDK 查询序列化，禁止携带i。具体参数及响应引用配套 Misskey OpenAPI。', responses: { '200': { description: '原始 Misskey JSON。' }, '204': { description: '无响应正文。' }, ...errorResponses() } },
			},
			[`/${COMMUNITY_BFF_PATHS.upload}`]: {
				post: {
					operationId: 'uploadCommunityFile', security: [{ communityBearer: [] }], parameters: [instanceHeader()],
					requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, folderId: { type: 'string' }, name: { type: 'string' }, comment: { type: 'string' }, isSensitive: { type: 'string', enum: ['true', 'false'] }, force: { type: 'string', enum: ['true', 'false'] } }, additionalProperties: false } } } },
					responses: { '200': { description: '原始 Misskey DriveFile。', content: { 'application/json': { schema: { $ref: 'misskey.openapi.json#/components/schemas/DriveFile' } } } }, ...errorResponses() },
				},
			},
			[`/${COMMUNITY_BFF_PATHS.urlPreview}`]: {
				get: { operationId: 'getCommunityUrlPreview', security: [{ communityBearer: [] }], parameters: [instanceHeader(), { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' } }, { name: 'lang', in: 'query', schema: { type: 'string' } }], description: '返回现有链接预览组件所需原始结构；BFF 强制外部URL访问策略，拒绝本地地址、私网地址与重定向绕过。', responses: { '200': { description: '现行 Misskey /url 预览响应。' }, ...errorResponses() } },
			},
			[`/${COMMUNITY_BFF_PATHS.stream}`]: {
				get: { operationId: 'connectCommunityStream', parameters: [{ name: 'ticket', in: 'query', required: true, schema: COMMUNITY_BFF_SCHEMAS.StreamTicket.properties.ticket }], security: [], description: 'WSS升级。票据单次消费且过期即拒绝；不得把accessToken放在URL。真实上游绑定完成后才通知连接可用；频道帧复用misskey-js Channels/StreamEvents。', responses: { '101': { description: '已绑定真实上游的 WebSocket。' }, ...errorResponses() }, 'x-websocket': true },
			},
		},
		components: {
			schemas: COMMUNITY_BFF_SCHEMAS,
			securitySchemes: { communityBearer: { type: 'http', scheme: 'bearer', description: '社区专用短期访问凭据。' }, hostAuth: { type: 'http', scheme: 'bearer', description: '宿主现有认证的逻辑占位；部署方须适配实际App认证，不得由社区索取长期App凭据。' } },
		},
		'x-community-rules': {
			grant: '单次、短时、绑定instanceId与宿主账户。BFF持久化App账户到Misskey账户的唯一映射。',
			renew: '新单次grant是续期授权依据，不发送或依赖旧Bearer；不得让通用Bearer到期中间件阻止续期。sessionId/instanceId仅用于绑定验证，原accountId/canonicalInstanceUrl保持不变，身份改变返回COMMUNITY_IDENTITY_CHANGED，已撤销会话不可恢复。',
			retry: '写操作遇到不确定结果不得自动重放；客户端只合并并发续期，不重试原写请求。',
			cors: '允许准确宿主Origin；预检允许Authorization、Content-Type、X-Community-Instance-Id，禁止通配凭据来源。',
			credentials: 'BFF拒绝客户端API/multipart中的i，且不向社区返回Misskey/App长期凭据。',
			logging: '日志必须隐去Authorization、grant、ticket、访问凭据以及流URL中的票据。',
			errorStatus: '401+COMMUNITY_SESSION_EXPIRED/REVOKED才处理会话失效；COMMUNITY_IDENTITY_CHANGED使用409要求新实例。普通403/5xx即使携带相同码也不得隐式注销。',
			upstreamSchemas: '配套Misskey OpenAPI保留所有现行操作以提供权威参数/响应Schema；所含操作不构成BFF授权清单。部署方必须另行审定社区endpoint/channel清单。',
		},
	};
}
