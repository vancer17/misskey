/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区 Bootstrap 与真实客户端之间的协议适配测试。
 * 作用：以 Schema 派生样本及受控网络响应检查来源、兑换、取消和作用域归属映射。
 * 数据链：受控宿主 grant → 实际 BFF 客户端 → Bootstrap 只读状态与唯一会话作用域。
 * Mock 仅证明协议与适配，不证明真实登录、账户隔离、翻转就绪或社区业务验收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_BFF_ERROR_CODES } from 'community-bff-contract';
import { createCommunityEntityProtocolFixture } from '../../../community-bff-contract/test/index.js';
import { createCommunityBootstrapApi, requireCommunityApplication, requireCommunityBffClient } from '@/community-app/bootstrap/index.js';
import type { CommunityBootstrapApi, CommunityBootSnapshot, CommunityHostDependencies, CommunityHostSessionPort } from '@/community-app/bootstrap/index.js';
import type { CommunityBffClient } from '@/community-app/adapters/bff/index.js';
import { getCommunityAccount, getCommunitySessionScope } from '@/community-app/state/session/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/domain/index.js';

/** 单例只记录测试创建的控制边界，清理始终通过其公开实例所有者完成。 */
type BootstrapFixture = Readonly<{
	api: CommunityBootstrapApi;
	parent: Window;
	instanceId: string;
	states: CommunityBootSnapshot[];
}>;

/** 本例持有的边界按创建顺序登记，确保失败场景也能定向释放。 */
const fixtures: BootstrapFixture[] = [];

/** 创建公开 Bootstrap 参数，不包含账户、凭据或业务实体。 */
function dependencies(instanceId: string): CommunityHostDependencies {
	return Object.freeze({
		instanceId,
		hostOrigin: 'https://app.protocol.test',
		assetBase: 'https://app.protocol.test/nested/community/',
		canonicalInstanceUrl: 'https://community.protocol.test',
		bffBaseUrl: 'https://bff.protocol.test/community/v1/',
		language: 'zh-CN',
	});
}

/** 提供仅含启动器实际读取字段的窗口边界，并登记公开清理入口。 */
function fixture(instanceId: string = 'bootstrap-protocol-1', configure: boolean = true): BootstrapFixture {
	const parent: Window = {} as Window;
	const own: Window = { location: { origin: 'https://app.protocol.test', href: 'https://app.protocol.test/nested/community/index.html' } } as Window;
	const states: CommunityBootSnapshot[] = [];
	const api: CommunityBootstrapApi = createCommunityBootstrapApi(parent, own, /** 仅记录协议状态，不驱动业务或发送 READY。 */ (state: CommunityBootSnapshot): void => { states.push(state); });
	const result: BootstrapFixture = Object.freeze({ api, parent, instanceId, states });
	fixtures.push(result);
	if (configure) api.configure(dependencies(instanceId), parent);
	return result;
}

/** 从现行 SDK Schema 派生完整实体，样本只供协议校验而不作为生产认证来源。 */
function sessionPayload(instanceId: string): Readonly<Record<string, unknown>> {
	const me: Record<string, unknown> = createCommunityEntityProtocolFixture('MeDetailed');
	const meta: Record<string, unknown> = createCommunityEntityProtocolFixture('MetaDetailed');
	me.id = 'protocol-account-1';
	me.username = 'protocol-user';
	meta.uri = 'https://community.protocol.test';
	return {
		instanceId,
		sessionId: 'protocol-session-1',
		accountId: me.id,
		canonicalInstanceUrl: meta.uri,
		accessToken: 'protocol-short-credential',
		expiresAt: '2099-01-01T00:00:00.000Z',
		me,
		meta,
	};
}

/** 保留原生响应解释，网络替身仅提供确定的协议输入。 */
function response(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 创建可观察的宿主授权能力，不提供长期 App 或 Misskey 凭据。 */
function grantPort(): CommunityHostSessionPort {
	return { getGrant: vi.fn<CommunityHostSessionPort['getGrant']>().mockResolvedValue('protocol-single-grant') };
}

/** 让已完成的协议 Promise 清理当前微任务轮次，观察迟到结果不会恢复实例。 */
async function flushProtocolTurn(): Promise<void> {
	await new Promise<void>(/** 当前事件循环轮次结束后再检查释放状态。 */ (resolve: () => void): void => { setTimeout(resolve, 0); });
}

afterEach(/** 通过实例所有者释放作用域，最后恢复网络全局，避免跨例泄漏。 */ (): void => {
	try {
		for (const current of [...fixtures].reverse()) {
			if (current.api.getState().phase === 'DISPOSED') continue;
			if (current.api.getState().instanceId === null) current.api.configure(dependencies(current.instanceId), current.parent);
			current.api.dispose(current.instanceId);
		}
	} finally {
		fixtures.length = 0;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	}
});

describe('community BFF Bootstrap protocol boundary', /** 不把受控授权与网络响应当作业务集成证明。 */ (): void => {
	it('rejects source, configuration and session-port input before any network request', /** 无效控制输入不能调用授权能力或兑换接口。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', network);
		const current: BootstrapFixture = fixture('bootstrap-invalid-input', false);
		const port: CommunityHostSessionPort = grantPort();
		expect(/** 其他窗口不能配置边界。 */ (): unknown => current.api.configure(dependencies(current.instanceId), {} as Window)).toThrow('COMMUNITY_INVALID_HOST_WINDOW');
		expect(/** 错误资源目录不能取得配置所有权。 */ (): unknown => current.api.configure({ ...dependencies(current.instanceId), assetBase: 'https://app.protocol.test/wrong/' }, current.parent)).toThrow('COMMUNITY_INVALID_ASSET_BASE');
		await expect(current.api.start(port, current.parent)).rejects.toThrow('COMMUNITY_CONFIGURATION_REQUIRED');
		current.api.configure(dependencies(current.instanceId), current.parent);
		await expect(current.api.start(port, {} as Window)).rejects.toThrow('COMMUNITY_INVALID_HOST_WINDOW');
		await expect(current.api.start({ getGrant: 'invalid' } as unknown as CommunityHostSessionPort, current.parent)).rejects.toThrow('COMMUNITY_INVALID_SESSION_PORT');
		expect(/** 订阅控制权也归当前真实父窗口。 */ (): unknown => current.api.subscribe(/** 拒绝前不安装观察者。 */ (): void => {}, {} as Window)).toThrow('COMMUNITY_INVALID_HOST_WINDOW');
		expect(port.getGrant).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
	});

	it('maps one shared exchange to a credential-free established state and keeps the application gate', /** 兑换成功仅代表协议建立，不代表业务挂载或翻转就绪。 */ async (): Promise<void> => {
		const current: BootstrapFixture = fixture();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionPayload(current.instanceId)));
		vi.stubGlobal('fetch', network);
		const port: CommunityHostSessionPort = grantPort();
		const observed: CommunityBootSnapshot[] = [];
		const unsubscribe: () => void = current.api.subscribe(/** 消费冻结状态，不持有会话 DTO。 */ (state: CommunityBootSnapshot): void => { observed.push(state); }, current.parent);
		try {
			const results: CommunityBootSnapshot[] = await Promise.all([current.api.start(port, current.parent), current.api.start(port, current.parent)]);
			expect(results[0]).toEqual({ phase: 'SESSION_ESTABLISHED', instanceId: current.instanceId, errorCode: 'COMMUNITY_APPLICATION_ADAPTER_REQUIRED', language: 'zh-CN' });
			expect(results[1]).toBe(results[0]);
			expect(observed.map(/** 只检查启动协议阶段，不派生业务事实。 */ (state: CommunityBootSnapshot): string => state.phase)).toEqual(['SESSION_REQUIRED', 'ESTABLISHING_SESSION', 'SESSION_ESTABLISHED']);
			expect(observed.every(/** 观察者不能写入启动快照。 */ (state: CommunityBootSnapshot): boolean => Object.isFrozen(state))).toBe(true);
			expect(port.getGrant).toHaveBeenCalledOnce();
			expect(network).toHaveBeenCalledOnce();
			expect(network.mock.calls[0][0]).toBe('https://bff.protocol.test/community/v1/session/exchange');
			expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ instanceId: current.instanceId, grant: 'protocol-single-grant' });
			expect(getCommunitySessionScope()?.accountId).toBe('protocol-account-1');
			expect(getCommunityAccount()?.id).toBe('protocol-account-1');
			expect(requireCommunityBffClient().getSession()).not.toHaveProperty('accessToken');
			expect(JSON.stringify(current.api.getState())).not.toContain('protocol-short-credential');
			expect(requireCommunityApplication).toThrow('COMMUNITY_APPLICATION_ADAPTER_REQUIRED');
		} finally { unsubscribe(); }
	});

	it('shares the pending exchange when a subscriber synchronously reenters start', /** 状态观察者同步重入只能等待既有任务，不能产生第二份授权或客户端。 */ async (): Promise<void> => {
		const current: BootstrapFixture = fixture();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionPayload(current.instanceId)));
		vi.stubGlobal('fetch', network);
		const port: CommunityHostSessionPort = grantPort();
		const reentrant: { pending: Promise<CommunityBootSnapshot> | null } = { pending: null };
		const unsubscribe: () => void = current.api.subscribe(/** 同步状态发布期间再次进入公开启动 API。 */ (state: CommunityBootSnapshot): void => {
			if (state.phase === 'ESTABLISHING_SESSION' && reentrant.pending === null) reentrant.pending = current.api.start(port, current.parent);
		}, current.parent);
		try {
			const result: CommunityBootSnapshot = await current.api.start(port, current.parent);
			if (reentrant.pending === null) throw new Error('MISSING_REENTRANT_PROTOCOL_CALL');
			expect(await reentrant.pending).toBe(result);
			expect(result.phase).toBe('SESSION_ESTABLISHED');
			expect(port.getGrant).toHaveBeenCalledOnce();
			expect(network).toHaveBeenCalledOnce();
			expect(current.states.filter(/** 观察者不得再次发布建立中阶段。 */ (state: CommunityBootSnapshot): boolean => state.phase === 'ESTABLISHING_SESSION')).toHaveLength(1);
		} finally { unsubscribe(); }
	});

	it('disposes before the scheduled exchange starts without changing the cancellation reason', /** 启动微任务尚未运行时释放也不得被误报为缺少配置。 */ async (): Promise<void> => {
		const current: BootstrapFixture = fixture();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', network);
		const port: CommunityHostSessionPort = grantPort();
		const outcome: Promise<PromiseSettledResult<CommunityBootSnapshot>[]> = Promise.allSettled([current.api.start(port, current.parent)]);
		current.api.dispose(current.instanceId);
		expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: { message: 'COMMUNITY_INSTANCE_DISPOSED' } });
		expect(port.getGrant).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
		expect(current.api.getState().phase).toBe('DISPOSED');
	});

	it.each(['grant', 'network'] as const)('disposes immediately while awaiting %s and rejects a late result', /** 外部能力即使忽略取消，也不得重新安装已释放实例。 */ async (stage: 'grant' | 'network'): Promise<void> => {
		const current: BootstrapFixture = fixture();
		const delayedGrant: PromiseWithResolvers<string> = Promise.withResolvers<string>();
		const delayedResponse: PromiseWithResolvers<Response> = Promise.withResolvers<Response>();
		const signals: { grant: AbortSignal | null; exchange: AbortSignal | null } = { grant: null, exchange: null };
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockImplementation(/** 有意忽略取消以验证适配器边界。 */ (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			signals.exchange = init?.signal ?? null;
			return delayedResponse.promise;
		});
		vi.stubGlobal('fetch', network);
		const port: CommunityHostSessionPort = {
			getGrant: vi.fn<CommunityHostSessionPort['getGrant']>().mockImplementation(/** 暂停指定外部阶段，不执行任何业务行为。 */ (request: Parameters<CommunityHostSessionPort['getGrant']>[0]): Promise<string> => {
				signals.grant = request.signal;
				return stage === 'grant' ? delayedGrant.promise : Promise.resolve('protocol-single-grant');
			}),
		};
		const pending: Promise<CommunityBootSnapshot> = current.api.start(port, current.parent);
		const outcome: Promise<PromiseSettledResult<CommunityBootSnapshot>[]> = Promise.allSettled([pending]);
		await vi.waitFor(/** 确认待取消外部阶段真实启动。 */ (): void => { expect(stage === 'grant' ? port.getGrant : network).toHaveBeenCalledOnce(); });
		current.api.dispose(current.instanceId);
		expect(signals.grant?.aborted).toBe(true);
		if (stage === 'network') expect(signals.exchange?.aborted).toBe(true);
		expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: { message: 'COMMUNITY_INSTANCE_DISPOSED' } });
		delayedGrant.resolve('late-protocol-grant');
		delayedResponse.resolve(response(sessionPayload(current.instanceId)));
		await flushProtocolTurn();
		expect(current.api.getState().phase).toBe('DISPOSED');
		expect(current.states.some(/** 销毁后不允许出现认证完成映射。 */ (state: CommunityBootSnapshot): boolean => state.phase === 'SESSION_ESTABLISHED')).toBe(false);
		expect(getCommunitySessionScope()).toBeNull();
		expect(requireCommunityBffClient).toThrow('COMMUNITY_SESSION_REQUIRED');
		if (stage === 'grant') expect(network).not.toHaveBeenCalled();
	});

	it.each(['grant', 'exchange'] as const)('allows retry after a pre-establishment %s transport failure', /** 尚未建立权威作用域的外部故障不会永久占用该文档身份。 */ async (stage: 'grant' | 'exchange'): Promise<void> => {
		const current: BootstrapFixture = fixture();
		const failure: TypeError = new TypeError('Protocol network unavailable');
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>();
		if (stage === 'exchange') network.mockRejectedValueOnce(failure);
		network.mockResolvedValue(response(sessionPayload(current.instanceId)));
		vi.stubGlobal('fetch', network);
		const getGrant: ReturnType<typeof vi.fn<CommunityHostSessionPort['getGrant']>> = vi.fn<CommunityHostSessionPort['getGrant']>();
		if (stage === 'grant') getGrant.mockRejectedValueOnce(failure);
		getGrant.mockResolvedValue('protocol-single-grant');
		const port: CommunityHostSessionPort = { getGrant };
		await expect(current.api.start(port, current.parent)).rejects.toThrow('Protocol network unavailable');
		expect(current.api.getState().phase).toBe('FAILED');
		expect(getCommunitySessionScope()).toBeNull();
		expect((await current.api.start(port, current.parent)).phase).toBe('SESSION_ESTABLISHED');
		expect(getGrant).toHaveBeenCalledTimes(2);
		expect(network).toHaveBeenCalledTimes(stage === 'exchange' ? 2 : 1);
	});

	it('requires a new realm after an established session is revoked', /** 这里只检查控制错误到启动门槛的映射，不证明真实撤销业务。 */ async (): Promise<void> => {
		const current: BootstrapFixture = fixture();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionPayload(current.instanceId))).mockResolvedValueOnce(response({ error: { code: COMMUNITY_BFF_ERROR_CODES.sessionRevoked } }, 401));
		vi.stubGlobal('fetch', network);
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const port: CommunityHostSessionPort = { ...grantPort(), notifyAuthRequired: notify };
		await current.api.start(port, current.parent);
		await expect(requireCommunityBffClient().request('notes/show', { noteId: 'protocol-note' })).rejects.toHaveProperty('code', COMMUNITY_BFF_ERROR_CODES.sessionRevoked);
		expect(current.api.getState().phase).toBe('SESSION_REQUIRED');
		expect(getCommunitySessionScope()).toBeNull();
		expect(notify).toHaveBeenCalledExactlyOnceWith(COMMUNITY_BFF_ERROR_CODES.sessionRevoked);
		await expect(current.api.start(port, current.parent)).rejects.toThrow('COMMUNITY_REALM_REBUILD_REQUIRED');
		expect(network).toHaveBeenCalledTimes(2);
	});

	it('keeps the installed scope when another factory tries to start or dispose', /** 第二个控制工厂没有第一实例的会话写入或清理权限。 */ async (): Promise<void> => {
		const first: BootstrapFixture = fixture('bootstrap-owner-one');
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionPayload(first.instanceId)));
		vi.stubGlobal('fetch', network);
		await first.api.start(grantPort(), first.parent);
		const owner: AccountRequestOwner | null = getCommunitySessionScope();
		const client: CommunityBffClient = requireCommunityBffClient();
		const second: BootstrapFixture = fixture('bootstrap-owner-two');
		const port: CommunityHostSessionPort = grantPort();
		await expect(second.api.start(port, second.parent)).rejects.toThrow('COMMUNITY_REALM_REBUILD_REQUIRED');
		expect(port.getGrant).not.toHaveBeenCalled();
		second.api.dispose(second.instanceId);
		expect(getCommunitySessionScope()).toBe(owner);
		expect(requireCommunityBffClient()).toBe(client);
		expect(first.api.getState().phase).toBe('SESSION_ESTABLISHED');
		expect(network).toHaveBeenCalledOnce();
	});

	it('does not clear the owner scope after a competing factory receives a late exchange', /** 两个控制边界的协议响应竞争不能让失败方取得清理权限。 */ async (): Promise<void> => {
		const first: BootstrapFixture = fixture('bootstrap-competing-one');
		const second: BootstrapFixture = fixture('bootstrap-competing-two');
		const firstResponse: PromiseWithResolvers<Response> = Promise.withResolvers<Response>();
		const secondResponse: PromiseWithResolvers<Response> = Promise.withResolvers<Response>();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockImplementation(/** 按序列化实例标识分配响应，不依赖两个异步工厂的调用顺序。 */ (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const body: unknown = JSON.parse(String(init?.body)) as unknown;
			if (typeof body !== 'object' || body === null || !('instanceId' in body)) throw new Error('MISSING_PROTOCOL_INSTANCE');
			if (body.instanceId === first.instanceId) return firstResponse.promise;
			if (body.instanceId === second.instanceId) return secondResponse.promise;
			throw new Error('UNKNOWN_PROTOCOL_INSTANCE');
		});
		vi.stubGlobal('fetch', network);
		const firstPending: Promise<CommunityBootSnapshot> = first.api.start(grantPort(), first.parent);
		const secondPending: Promise<CommunityBootSnapshot> = second.api.start(grantPort(), second.parent);
		const outcomes: Promise<PromiseSettledResult<CommunityBootSnapshot>[]> = Promise.allSettled([firstPending, secondPending]);
		await vi.waitFor(/** 两个工厂都已进入传输，避免只覆盖早期重复启动拒绝。 */ (): void => { expect(network).toHaveBeenCalledTimes(2); });
		firstResponse.resolve(response(sessionPayload(first.instanceId)));
		await firstPending;
		const owner: AccountRequestOwner | null = getCommunitySessionScope();
		const client: CommunityBffClient = requireCommunityBffClient();
		secondResponse.resolve(response(sessionPayload(second.instanceId)));
		expect((await outcomes)[1]).toMatchObject({ status: 'rejected', reason: { message: 'COMMUNITY_REALM_REBUILD_REQUIRED' } });
		second.api.dispose(second.instanceId);
		expect(getCommunitySessionScope()).toBe(owner);
		expect(requireCommunityBffClient()).toBe(client);
		expect(first.api.getState().phase).toBe('SESSION_ESTABLISHED');
	});
});
