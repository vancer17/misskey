/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：本地社区 Bootstrap 的依赖交接与启动状态。
 * 作用：只接收当前父窗口的一次性装配参数；尚无 BFF 会话适配时始终拒绝业务启动。
 * 数据链：App 装配参数 → 冻结依赖与只读状态；不读取存储、不创建用户、不发送桥接 ACK。
 */
import { COMMUNITY_SUPPORTED_LANGUAGES } from './artifact.js';
import type { CommunitySupportedLanguage } from './artifact.js';

/** Bootstrap 自身的启动阶段；不表示社区业务、后端或实时连接就绪。 */
export type CommunityBootPhase = 'WAITING_HOST' | 'SESSION_REQUIRED' | 'FAILED';

/** 描述宿主交付的基础地址，不包含凭据、用户模型或运维探测结果。 */
export type CommunityHostDependencies = Readonly<{
	instanceId: string;
	hostOrigin: string;
	assetBase: string;
	canonicalInstanceUrl: string;
	apiBase: string;
	wsBase: string;
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
	configure: (input: unknown, source: Window) => CommunityBootSnapshot;
	getState: () => CommunityBootSnapshot;
	dispose: (instanceId: string) => void;
}>;

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
	if (typeof input.instanceId !== 'string' || input.instanceId.length === 0 || input.instanceId.length > 128) throw new Error('COMMUNITY_INVALID_INSTANCE');
	if (input.hostOrigin !== expectedOrigin) throw new Error('COMMUNITY_INVALID_HOST_ORIGIN');
	if (typeof input.language !== 'string' || !(COMMUNITY_SUPPORTED_LANGUAGES as readonly string[]).includes(input.language)) throw new Error('COMMUNITY_UNSUPPORTED_LANGUAGE');
	const asset: URL = parseAddress(input.assetBase, ['https:', 'http:']);
	if (asset.origin !== expectedOrigin || !asset.pathname.endsWith('/')) throw new Error('COMMUNITY_INVALID_ASSET_BASE');
	if (asset.href !== expectedAssetBase) throw new Error('COMMUNITY_INVALID_ASSET_BASE');
	const canonical: URL = parseAddress(input.canonicalInstanceUrl, ['https:']);
	if (canonical.pathname !== '/') throw new Error('COMMUNITY_INVALID_CANONICAL_ORIGIN');
	const api: URL = parseAddress(input.apiBase, ['https:']);
	const websocket: URL = parseAddress(input.wsBase, ['wss:']);
	return Object.freeze({
		instanceId: input.instanceId,
		hostOrigin: expectedOrigin,
		assetBase: asset.href,
		canonicalInstanceUrl: canonical.origin,
		apiBase: api.href.replace(/\/$/, ''),
		wsBase: websocket.href.replace(/\/$/, ''),
		language: input.language as CommunitySupportedLanguage,
	});
}

/** 创建独立实例的启动边界，所有权只属于实际父窗口且不触及业务模块。 */
export function createCommunityBootstrapApi(parentWindow: Window, ownWindow: Window, onState: (state: CommunityBootSnapshot) => void): CommunityBootstrapApi {
	let dependencies: CommunityHostDependencies | null = null;
	let disposed: boolean = false;
	let state: CommunityBootSnapshot = Object.freeze({ phase: 'WAITING_HOST', instanceId: null, errorCode: null, language: null });

	/** 发布冻结快照；回调只用于启动状态展示，不执行业务决策。 */
	function publish(phase: CommunityBootPhase, errorCode: string | null): CommunityBootSnapshot {
		state = Object.freeze({ phase, instanceId: dependencies?.instanceId ?? null, errorCode, language: dependencies?.language ?? null });
		onState(state);
		return state;
	}

	/** 接受一次合法装配；缺少真实 BFF 会话实现时明确停在认证依赖状态。 */
	function configure(input: unknown, source: Window): CommunityBootSnapshot {
		if (disposed) throw new Error('COMMUNITY_INSTANCE_DISPOSED');
		if (source !== parentWindow || parentWindow === ownWindow) throw new Error('COMMUNITY_INVALID_HOST_WINDOW');
		if (dependencies !== null) throw new Error('COMMUNITY_INSTANCE_ALREADY_CONFIGURED');
		try {
			dependencies = parseCommunityHostDependencies(input, ownWindow.location.origin, new URL('./', ownWindow.location.href).href);
			return publish('SESSION_REQUIRED', 'COMMUNITY_BFF_ADAPTER_REQUIRED');
		} catch (error: unknown) {
			publish('FAILED', error instanceof Error ? error.message : 'COMMUNITY_INVALID_DEPENDENCIES');
			throw error;
		}
	}

	/** 返回当前冻结状态，不把部署参数或潜在凭据暴露为业务事实。 */
	function getState(): CommunityBootSnapshot {
		return state;
	}

	/** 仅当前实例可释放其启动边界，旧实例不能重置新实例。 */
	function dispose(instanceId: string): void {
		if (dependencies?.instanceId !== instanceId) throw new Error('COMMUNITY_STALE_INSTANCE');
		disposed = true;
		dependencies = null;
		publish('FAILED', 'COMMUNITY_INSTANCE_DISPOSED');
	}

	return Object.freeze({ configure, getState, dispose });
}

/** 在 P2 提供真实会话和传输装配之前阻止账户根及其副作用运行。 */
export function requireCommunitySession(): never {
	throw new Error('COMMUNITY_BFF_ADAPTER_REQUIRED');
}
