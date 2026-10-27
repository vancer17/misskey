/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 协议包公开 API。
 * 作用：统一输出权威控制模型、校验器、协议寻址及交接 Schema。
 * 数据链：社区 Bootstrap、客户端传输与 BFF 对接仅依赖本索引，不读取包内实现。
 */
export { COMMUNITY_BFF_SCHEMAS } from './domain/schema.js';
export type { CommunityBffGrantRequest, CommunityBffGrant, CommunityBffExchangeRequest, CommunityBffRenewRequest, CommunityBffSessionRequest, CommunityBffSession, CommunityBffSessionView, CommunityBffStreamTicket, CommunityBffControlError } from './domain/schema.js';
export { COMMUNITY_BFF_PATHS, COMMUNITY_BFF_ENDPOINT_PATTERN, isCommunityBffEndpoint, createCommunityBffEndpoints } from './domain/endpoints.js';
export type { CommunityBffEndpoints } from './domain/endpoints.js';
export { COMMUNITY_BFF_ERROR_CODES, CommunityBffError } from './domain/errors.js';
export { parseCommunityBffError } from './adapters/error-parser.js';
export { parseCommunityBffGrantRequest, parseCommunityBffGrant, parseCommunityBffExchangeRequest, parseCommunityBffRenewRequest, parseCommunityBffSessionRequest, parseCommunityBffSession, parseCommunityBffStreamTicket, parseCommunityBffControlError, parseCommunityBffAccount, parseCommunityBffInstance } from './adapters/parsers.js';
export { createCommunityBffJsonSchema, createCommunityBffOpenApi } from './schema/openapi.js';
export type { CommunityBffSchemaDocument } from './schema/openapi.js';
export { COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS, isCommunityCredentialField } from './domain/credential-fields.js';
export { assertCommunityBffApiParameters } from './adapters/parsers.js';
