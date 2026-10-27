/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：本地社区 Bootstrap 的依赖交接与启动状态。
 * 作用：接收当前父窗口的一次性装配与授权能力，建立真实 BFF 会话并保留应用挂载门槛。
 * 数据链：App 装配 → BFF 校验 → 唯一账户状态；凭据留在传输闭包，不发送业务或翻转 ACK。
 */
import { COMMUNITY_SUPPORTED_LANGUAGES } from './artifact/index.js';
import { createCommunityBffEndpoints, parseCommunityBffGrantRequest, CommunityBffError } from 'community-bff-contract';
import type { CommunitySupportedLanguage } from './artifact/index.js';
import type { CommunityBffSessionView } from 'community-bff-contract';
import type { CommunityBffClient, CommunityHostSessionPort } from '../adapters/bff/index.js';

/** Bootstrap 自身的启动阶段；不表示社区业务、后端或实时连接就绪。 */
export type CommunityBootPhase = 'WAITING_HOST' | 'SESSION_REQUIRED' | 'ESTABLISHING_SESSION' | 'SESSION_ESTABLISHED' | 'FAILED' | 'DISPOSED';

/** 描述宿主交付的基础地址，不包含凭据、用户模型或运维探测结果。 */
export type CommunityHostDependencies = Readonly<{
	instanceId: string;
	hostOrigin: string;
	assetBase: string;
	canonicalInstanceUrl: string;
	bffBaseUrl: string;
	language: CommunitySupportedLanguage;
}>;

/** 向装配层暴露 Bootstrap 进度，不提供可修改的内部状态。 */
export type CommunityBootSnapshot = Readonly<{
	phase: CommunityBootPhase;
	instanceId: string | null;
	errorCode: string | null;
	language: CommunityHostDependencies['language'] | null;
}>;

/** 由当前嵌入窗口提供的配置接缝，不取代既有双面容器的消息协议。 */
export type CommunityBootstrapApi = Readonly<{
	/** 配置一次当前实例的冻结地址与语言。 */
	configure: (input: unknown, source: Window) => CommunityBootSnapshot;
	/** 使用宿主授权能力建立 BFF 会话，不据此声明业务已挂载。 */
	start: (port: CommunityHostSessionPort, source: Window) => Promise<CommunityBootSnapshot>;
	/** 观察冻结启动状态，返回仅解除本次订阅的函数。 */
	subscribe: (listener: (state: CommunityBootSnapshot) => void, source: Window) => () => void;
	/** 读取当前启动状态，不返回账户或凭据。 */
	getState: () => CommunityBootSnapshot;
	/** 同步撤销当前实例租约并释放传输，宿主随后销毁文档。 */
	dispose: (instanceId: string) => void;
}>;

/** 当前文档唯一安装的传输实例；仅 Bootstrap 与编译期适配器可以消费。 */
let installed: Readonly<{
	dependencies: CommunityHostDependencies;
	client: CommunityBffClient;
	/** 由所属 Bootstrap 撤销该文档实例的全部租约。 */
	dispose: () => void;
}> | null = null;

/** 将未知输入收窄为普通字段记录，只用于 Bootstrap 参数校验。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 验证无凭据、无片段的绝对地址，避免将认证值藏入 URL。 */
function parseAddress(value: unknown, allowedProtocols: readonly string[]): URL {
	if (typeof value !== 'string') throw new Error('COMMUNITY_INVALID_DEPENDENCIES');
	const address: URL = new URL(value);
	if (!allowedProtocols.includes(address.protocol) || address.username !== '' || address.password !== '' || address.hash !== '' || address.search !== '') {
		throw new Error('COMMUNITY_INVALID_DEPENDENCIES');
	}
	return address;
}

/** 校验本期包内 H5/Android 的固定同源参数，不接受空来源或任意通配来源。 */
export function parseCommunityHostDependencies(input: unknown, expectedOrigin: string, expectedAssetBase: string): CommunityHostDependencies {
	if (!isRecord(input) || expectedOrigin === 'null') throw new Error('COMMUNITY_INVALID_DEPENDENCIES');
	const keys: readonly string[] = ['instanceId', 'hostOrigin', 'assetBase', 'canonicalInstanceUrl', 'bffBaseUrl', 'language'];
	if (Object.keys(input).some(/** 未声明字段不能引入旧地址或认证能力。 */ (key: string): boolean => !keys.includes(key))) throw new Error('COMMUNITY_INVALID_DEPENDENCIES');
	const identity: ReturnType<typeof parseCommunityBffGrantRequest> = parseCommunityBffGrantRequest({ instanceId: input.instanceId });
	if (input.hostOrigin !== expectedOrigin) throw new Error('COMMUNITY_INVALID_HOST_ORIGIN');
	if (typeof input.language !== 'string' || !(COMMUNITY_SUPPORTED_LANGUAGES as readonly string[]).includes(input.language)) throw new Error('COMMUNITY_UNSUPPORTED_LANGUAGE');
	const asset: URL = parseAddress(input.assetBase, ['https:', 'http:']);
	if (asset.origin !== expectedOrigin || !asset.pathname.endsWith('/')) throw new Error('COMMUNITY_INVALID_ASSET_BASE');
	if (asset.href !== expectedAssetBase) throw new Error('COMMUNITY_INVALID_ASSET_BASE');
	const canonical: URL = parseAddress(input.canonicalInstanceUrl, ['https:']);
	if (canonical.pathname !== '/') throw new Error('COMMUNITY_INVALID_CANONICAL_ORIGIN');
	const bff: URL = parseAddress(input.bffBaseUrl, ['https:']);
	createCommunityBffEndpoints(bff.href);
	return Object.freeze({
		instanceId: identity.instanceId,
		hostOrigin: expectedOrigin,
		assetBase: asset.href,
		canonicalInstanceUrl: canonical.origin,
		bffBaseUrl: bff.href.endsWith('/') ? bff.href : bff.href + '/',
		language: input.language as CommunitySupportedLanguage,
	});
}

/** 创建独立实例的启动边界，所有权只属于实际父窗口且不触及业务模块。 */
export function createCommunityBootstrapApi(parentWindow: Window, ownWindow: Window, onState: (state: CommunityBootSnapshot) => void): CommunityBootstrapApi {
	let dependencies: CommunityHostDependencies | null = null;
	let disposed: boolean = false;
	let client: CommunityBffClient | null = null;
	let pending: Promise<CommunityBootSnapshot> | null = null;
	let clearSession: (() => void) | null = null;
	const listeners: Set<(state: CommunityBootSnapshot) => void> = new Set();
	let state: CommunityBootSnapshot = Object.freeze({ phase: 'WAITING_HOST', instanceId: null, errorCode: null, language: null });
	let configuredId: string | null = null;
	let everEstablished: boolean = false;

	/** 校验控制权，不把同源其他窗口或顶层自身认作真实宿主。 */
	function assertSource(source: Window): void {
		if (source !== parentWindow || parentWindow === ownWindow) throw new Error('COMMUNITY_INVALID_HOST_WINDOW');
		if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
	}

	/** 发布冻结快照；回调只用于启动状态展示，不执行业务决策。 */
	function publish(phase: CommunityBootPhase, errorCode: string | null): CommunityBootSnapshot {
		state = Object.freeze({ phase, instanceId: dependencies?.instanceId ?? null, errorCode, language: dependencies?.language ?? null });
		try { onState(state); } catch { /* 展示回调不拥有认证事实或启动状态的写入权。 */ }
		for (const listener of listeners) {
			try { listener(state); } catch { /* 观察者失败不得反向改变会话建立结果。 */ }
		}
		return state;
	}

	/** 接受一次合法装配；尚未提供宿主授权能力时停在会话依赖状态。 */
	function configure(input: unknown, source: Window): CommunityBootSnapshot {
		assertSource(source);
		if (dependencies !== null) throw new Error('COMMUNITY_INSTANCE_ALREADY_CONFIGURED');
		try {
			dependencies = parseCommunityHostDependencies(input, ownWindow.location.origin, new URL('./', ownWindow.location.href).href);
			configuredId = dependencies.instanceId;
			return publish('SESSION_REQUIRED', 'COMMUNITY_HOST_SESSION_REQUIRED');
		} catch (error: unknown) {
			publish('FAILED', error instanceof Error ? error.message : 'COMMUNITY_INVALID_DEPENDENCIES');
			throw error;
		}
	}

	/** 真实会话安装后仍保留应用初始化门槛，宿主不能用此结果推进翻转业务 ACK。 */
	async function establish(port: CommunityHostSessionPort): Promise<CommunityBootSnapshot> {
		if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
		if (dependencies === null) throw new Error('COMMUNITY_CONFIGURATION_REQUIRED');
		const frozenDependencies: CommunityHostDependencies = dependencies;
		publish('ESTABLISHING_SESSION', null);
		try {
			const [{ createCommunityBffClient }, stateModule]: [typeof import('../adapters/bff/index.js'), typeof import('../state/session/index.js')] = await Promise.all([
				import('../adapters/bff/index.js'),
				import('../state/session/index.js'),
			]);
			if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
			clearSession = stateModule.invalidateCommunitySession;
			const ownedClient: CommunityBffClient = createCommunityBffClient({
				...frozenDependencies,
				sessionPort: port,
				/** 回调只接收已剔除凭据的校验后投影，旧实例不得再次安装状态。 */
				onSession(session: CommunityBffSessionView): void {
					if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
					if (installed !== null && installed.client !== ownedClient) throw new Error('COMMUNITY_REALM_REBUILD_REQUIRED');
					stateModule.installCommunitySession(session);
					everEstablished = true;
					installed = Object.freeze({
						dependencies: frozenDependencies,
						client: ownedClient,
						/** 退出沿用实例所有者的释放流程，不建立第二份状态机。 */
						dispose: (): void => { dispose(frozenDependencies.instanceId); },
					});
					publish('SESSION_ESTABLISHED', 'COMMUNITY_APPLICATION_ADAPTER_REQUIRED');
				},
				/** 只有权威会话失效才清除业务归属；离线与普通权限错误由客户端保留。 */
				onSessionRequired(code: string): void {
					if (installed?.client === ownedClient) {
						stateModule.invalidateCommunitySession();
						installed = null;
					}
					if (!disposed) publish('SESSION_REQUIRED', code);
				},
			});
			client = ownedClient;
			await ownedClient.start();
			if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
			return state;
		} catch (error: unknown) {
			if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
			if (state.phase !== 'SESSION_REQUIRED') publish('FAILED', error instanceof CommunityBffError ? error.code : 'COMMUNITY_SESSION_ESTABLISHMENT_FAILED');
			throw error;
		}
	}

	/** 只捕获当前宿主的授权方法，重复启动共享同一任务，不临时接管宿主登录。 */
	async function start(port: CommunityHostSessionPort, source: Window): Promise<CommunityBootSnapshot> {
		assertSource(source);
		if (dependencies === null) throw new Error('COMMUNITY_CONFIGURATION_REQUIRED');
		if (!isRecord(port) || typeof port.getGrant !== 'function' || (port.notifyAuthRequired !== undefined && typeof port.notifyAuthRequired !== 'function')) throw new Error('COMMUNITY_INVALID_SESSION_PORT');
		if (state.phase === 'SESSION_ESTABLISHED' && client?.getSession() != null) return state;
		if (everEstablished || (installed !== null && installed.client !== client)) throw new Error('COMMUNITY_REALM_REBUILD_REQUIRED');
		if (pending !== null) return await pending;
		if (client !== null) {
			client.dispose();
			if (installed?.client === client) {
				clearSession?.();
				installed = null;
			}
		}
		const getGrant: CommunityHostSessionPort['getGrant'] = port.getGrant.bind(port);
		const notify: CommunityHostSessionPort['notifyAuthRequired'] = port.notifyAuthRequired?.bind(port);
		const frozenPort: CommunityHostSessionPort = Object.freeze({ getGrant, notifyAuthRequired: notify });
		pending = Promise.resolve().then(/** 先发布共享任务再运行状态回调，重入启动不能开启第二次兑换。 */ (): Promise<CommunityBootSnapshot> => establish(frozenPort));
		try { return await pending; } finally { pending = null; }
	}

	/** 启动观察与控制分离，取消订阅不销毁社区或其他观察者。 */
	function subscribe(listener: (snapshot: CommunityBootSnapshot) => void, source: Window): () => void {
		assertSource(source);
		if (typeof listener !== 'function') throw new Error('COMMUNITY_INVALID_SUBSCRIBER');
		listeners.add(listener);
		try { listener(state); } catch { /* 订阅者不拥有启动状态写入权。 */ }
		return /** 只移除当前监听，不改变会话和其他订阅。 */ (): void => { listeners.delete(listener); };
	}

	/** 返回当前冻结状态，不把部署参数或潜在凭据暴露为业务事实。 */
	function getState(): CommunityBootSnapshot {
		return state;
	}

	/** 仅当前实例可释放其启动边界，旧实例不能重置新实例。 */
	function dispose(instanceId: string): void {
		if (configuredId !== instanceId) throw new Error('COMMUNITY_STALE_INSTANCE');
		if (disposed) return;
		disposed = true;
		client?.dispose();
		if (installed?.client === client) {
			clearSession?.();
			installed = null;
		}
		dependencies = null;
		publish('DISPOSED', 'COMMUNITY_INSTANCE_DISPOSED');
		listeners.clear();
	}

	return Object.freeze({ configure, start, subscribe, getState, dispose });
}

/** 只向编译期传输适配器交付当前有效实例，不暴露凭据读取能力。 */
export function requireCommunityBffClient(): CommunityBffClient {
	if (installed === null || installed.client.getSession() === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	return installed.client;
}

/** 在真实会话安装后提供冻结运行依赖，业务层不得导入此 Bootstrap 接缝。 */
export function requireCommunitySession(): CommunityHostDependencies {
	requireCommunityBffClient();
	if (installed === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	return installed.dependencies;
}

/** 契约适配交付不伪装为完整业务初始化；后续挂载实现须替换本门槛并证明真实生命周期。 */
export function requireCommunityApplication(): never {
	throw new Error('COMMUNITY_APPLICATION_ADAPTER_REQUIRED');
}

/** 撤销仅属于社区的短会话；远端失败仍释放本地实例，但不伪装远端已成功退出。 */
export async function revokeCommunitySession(): Promise<void> {
	const current: NonNullable<typeof installed> | null = installed;
	if (current === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	try { await current.client.revoke(); } finally { current.dispose(); }
}
