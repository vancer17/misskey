/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 控制协议单测。
 * 作用：证明 Schema、参数序列化边界与错误映射；不伪装真实会话或领域集成验收。
 * 数据链：未知协议样本 → 解析及交接文档结构断言。
 */
import { describe, expect, it } from 'vitest';
import { COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS, COMMUNITY_BFF_SCHEMAS, assertCommunityBffApiParameters, createCommunityBffEndpoints, createCommunityBffJsonSchema, createCommunityBffOpenApi, parseCommunityBffError, parseCommunityBffExchangeRequest, parseCommunityBffGrantRequest, parseCommunityBffRenewRequest, parseCommunityBffSession, parseCommunityBffStreamTicket } from '../src/index.js';
import type { CommunityBffEndpoints, CommunityBffError, CommunityBffSchemaDocument, CommunityBffSession } from '../src/index.js';
import { createCommunityEntityProtocolFixture } from './entity-fixture.js';

/** 从当前SDK Schema构造完整结构的协议样本，不作为真实业务用户或会话。 */
function sessionPayload(): Record<string, unknown> {
	const me: Record<string, unknown> = createCommunityEntityProtocolFixture('MeDetailed');
	const meta: Record<string, unknown> = createCommunityEntityProtocolFixture('MetaDetailed');
	me.id = 'account-1';
	meta.uri = 'https://social.example';
	return {
		sessionId: 'session-1', instanceId: 'instance-1', accountId: 'account-1', canonicalInstanceUrl: 'https://social.example', accessToken: 'short-secret', expiresAt: '2026-10-27T12:00:00.000Z',
		me, meta,
	};
}

describe('strict control DTOs', /** 检查控制 Schema 驱动的请求与响应边界。 */ (): void => {
	it('accepts exchange and same-session renewal fields', /** 同一字段权威同时供类型、运行校验及交接文档消费。 */ (): void => {
		expect(parseCommunityBffGrantRequest({ instanceId: 'instance-1' })).toEqual({ instanceId: 'instance-1' });
		expect(parseCommunityBffGrantRequest({ instanceId: 'instance-1', sessionId: 'session-1' })).toEqual({ instanceId: 'instance-1', sessionId: 'session-1' });
		expect(parseCommunityBffExchangeRequest({ instanceId: 'instance-1', grant: 'single-use' })).toEqual({ instanceId: 'instance-1', grant: 'single-use' });
		expect(parseCommunityBffRenewRequest({ instanceId: 'instance-1', sessionId: 'session-1', grant: 'new-single-use' })).toEqual({ instanceId: 'instance-1', sessionId: 'session-1', grant: 'new-single-use' });
	});

	it('rejects extra credential fields and absent required values', /** 附加字段与未定义字段不能隐式变成授权输入。 */ (): void => {
		expect(/** 验证原始Misskey凭据拒绝路径。 */ (): unknown => parseCommunityBffExchangeRequest({ instanceId: 'instance-1', grant: 'single-use', i: 'long-secret' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(/** 验证必填实例缺失。 */ (): unknown => parseCommunityBffGrantRequest({ sessionId: 'session-1' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(/** 验证控制授权不能夹带空白。 */ (): unknown => parseCommunityBffExchangeRequest({ instanceId: 'instance-1', grant: 'line\nbreak' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
	});

	it('rejects array, class and inherited fields', /** 只允许普通数据记录，不消费对象原型作为控制事实。 */ (): void => {
		expect(/** 验证数组不能当作DTO。 */ (): unknown => parseCommunityBffGrantRequest([])).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(/** 验证类实例不能当作DTO。 */ (): unknown => parseCommunityBffGrantRequest(new Date())).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		const inherited: unknown = Object.create({ instanceId: 'instance-1' });
		expect(/** 验证继承字段不能成为身份。 */ (): unknown => parseCommunityBffGrantRequest(inherited)).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
	});

	it('returns SDK identity from the validated session', /** 成功仅表示协议及身份关联校验，不证明上游业务行为。 */ (): void => {
		const session: CommunityBffSession = parseCommunityBffSession(sessionPayload());
		expect(session.me.id).toBe(session.accountId);
		expect(session.meta.uri).toBe(session.canonicalInstanceUrl);
	});

	it('rejects account and canonical-instance mismatches', /** 上游实体不能反向替换BFF声明的会话身份。 */ (): void => {
		expect(/** 验证账户归属不一致。 */ (): unknown => parseCommunityBffSession({ ...sessionPayload(), accountId: 'other-account' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(/** 验证实例归属不一致。 */ (): unknown => parseCommunityBffSession({ ...sessionPayload(), canonicalInstanceUrl: 'https://other.example' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
	});

	it('rejects credentials embedded inside upstream account data', /** SDK账户实体不是长期凭据传输通道。 */ (): void => {
		for (const field of COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS) {
			const payload: Record<string, unknown> = sessionPayload();
			payload.me = { ...(payload.me as Record<string, unknown>), [field]: 'long-secret' };
			expect(/** 对权威禁止字段逐项验证账户边界。 */ (): unknown => parseCommunityBffSession(payload)).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		}
	});

	it('rejects malformed entity and noncanonical origins', /** 最小实体检查阻止空对象被标记为真实账户。 */ (): void => {
		expect(/** 验证账户必须满足最小启动字段。 */ (): unknown => parseCommunityBffSession({ ...sessionPayload(), me: {} })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(/** 验证实例必须是origin而非URL路径。 */ (): unknown => parseCommunityBffSession({ ...sessionPayload(), canonicalInstanceUrl: 'https://social.example/' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
	});

	it('rejects missing nested required fields without mutating upstream data', /** 完整shape校验不补默认值、不删除字段、不转换类型。 */ (): void => {
		const missing: Record<string, unknown> = sessionPayload();
		const me: Record<string, unknown> = missing.me as Record<string, unknown>;
		delete me.policies;
		expect(/** 必填领域字段缺失不能启动业务。 */ (): unknown => parseCommunityBffSession(missing)).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		const wrongType: Record<string, unknown> = sessionPayload();
		const nestedMe: Record<string, unknown> = wrongType.me as Record<string, unknown>;
		const policies: Record<string, unknown> = nestedMe.policies as Record<string, unknown>;
		policies.canPublicNote = 'true';
		expect(/** 嵌套字段错型不能依赖隐式转换。 */ (): unknown => parseCommunityBffSession(wrongType)).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(policies.canPublicNote).toBe('true');
	});

	it('validates calendar dates rather than only parsable timestamps', /** 不允许日期归一化把非法时间变为可用会话。 */ (): void => {
		expect(/** 验证二月越界日期。 */ (): unknown => parseCommunityBffSession({ ...sessionPayload(), expiresAt: '2026-02-31T12:00:00Z' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(/** 验证必须携带时区。 */ (): unknown => parseCommunityBffSession({ ...sessionPayload(), expiresAt: '2026-10-27T12:00:00' })).toThrow('COMMUNITY_INVALID_BFF_PAYLOAD');
		expect(parseCommunityBffStreamTicket({ ticket: 'one-time', expiresAt: '2028-02-29T12:00:00+08:00' }).ticket).toBe('one-time');
	});
});

describe('request and error boundaries', /** 检查兼容请求不会携带认证材料，错误不会保留原始正文。 */ (): void => {
	it('uses one credential policy for all API parameters', /** 顶层业务参数不能覆盖BFF认证；普通业务字段原样保留。 */ (): void => {
		const parameters: unknown = { text: 'example', visibility: 'public' };
		assertCommunityBffApiParameters(parameters);
		expect(parameters).toEqual({ text: 'example', visibility: 'public' });
		for (const field of COMMUNITY_BFF_FORBIDDEN_API_PARAMETERS) {
			expect(/** 验证参数中的权威禁止字段。 */ (): void => assertCommunityBffApiParameters({ [field]: 'secret' })).toThrow('COMMUNITY_FORBIDDEN_API_CREDENTIAL');
		}
		expect(/** 验证大小写不能绕过隔离。 */ (): void => assertCommunityBffApiParameters({ Authorization: 'secret' })).toThrow('COMMUNITY_FORBIDDEN_API_CREDENTIAL');
	});

	it('preserves business errors and removes credential-shaped info fields', /** 错误仅是安全投影，普通403不会被重命名为会话失效。 */ (): void => {
		const error: CommunityBffError = parseCommunityBffError(403, { error: { code: 'ACCESS_DENIED', id: 'upstream-error', message: 'Permission denied', kind: 'client', info: { operation: 'chat', token: 'never-forward', nested: { accessToken: 'never-forward', allowed: true } } }, rawSecret: 'never-forward' });
		expect(error.status).toBe(403);
		expect(error.message).toBe('ACCESS_DENIED');
		expect(error.apiError).toEqual({ code: 'ACCESS_DENIED', id: 'upstream-error', message: 'Permission denied', kind: 'client', info: { operation: 'chat', nested: { allowed: true } } });
		expect(JSON.stringify(error)).not.toContain('never-forward');
	});

	it('accepts strict control errors and rejects uncontrolled bodies', /** BFF认证控制码与上游业务错误独立，不保存额外正文。 */ (): void => {
		expect(parseCommunityBffError(401, { error: { code: 'COMMUNITY_SESSION_EXPIRED' } }).code).toBe('COMMUNITY_SESSION_EXPIRED');
		expect(parseCommunityBffError(401, { error: { code: 'COMMUNITY_SESSION_EXPIRED', token: 'secret' } }).code).toBe('COMMUNITY_INVALID_BFF_ERROR');
		expect(parseCommunityBffError(502, '<html>proxy secret</html>').message).toBe('COMMUNITY_INVALID_BFF_ERROR');
		expect(parseCommunityBffError(403, { error: { id: 'permission-error', code: 'PERMISSION_DENIED', message: 'Permission denied', kind: 'permission' } }).apiError?.kind).toBe('permission');
	});
});

describe('endpoint and schema delivery', /** 检查协议寻址与交付Schema单向派生。 */ (): void => {
	it('creates frozen same-origin endpoints including WSS', /** 所有端点由同一已验证HTTPS基目录派生。 */ (): void => {
		const endpoints: CommunityBffEndpoints = createCommunityBffEndpoints('https://bff.example/prefix/community/v1');
		expect(Object.isFrozen(endpoints)).toBe(true);
		expect(endpoints.exchange).toBe('https://bff.example/prefix/community/v1/session/exchange');
		expect(endpoints.apiBase).toBe('https://bff.example/prefix/community/v1/api');
		expect(endpoints.stream).toBe('wss://bff.example/prefix/community/v1/stream');
	});

	it('rejects insecure, credential-bearing and unversioned bases', /** 禁止把认证内容或错误协议藏进传输地址。 */ (): void => {
		const bases: readonly string[] = ['http://bff.example/community/v1/', 'https://user:secret@bff.example/community/v1/', 'https://bff.example/community/v1/?token=secret', 'https://bff.example/community/v1/#secret', 'https://bff.example/api/'];
		for (const base of bases) {
			expect(/** 对不可信基址逐项验证。 */ (): unknown => createCommunityBffEndpoints(base)).toThrow('COMMUNITY_INVALID_BFF_BASE');
		}
	});

	it('derives both schema artifacts from the authoritative DTO schemas', /** 无第二份控制字段清单需要测试保持一致。 */ (): void => {
		const document: CommunityBffSchemaDocument = createCommunityBffOpenApi();
		const components: Record<string, unknown> = document.components as Record<string, unknown>;
		expect(components.schemas).toBe(COMMUNITY_BFF_SCHEMAS);
		expect(createCommunityBffJsonSchema().$defs).toBe(COMMUNITY_BFF_SCHEMAS);
		expect(JSON.stringify(document)).toContain('misskey.openapi.json#/components/schemas/MeDetailed');
		expect(JSON.stringify(document)).toContain('X-Community-Instance-Id');
	});
});
