/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：P1 制品验收专用的浏览器启动审计。
 * 作用：在真实页面执行前观察并阻止未接入业务能力的意外副作用。
 * 数据链：测试哨兵 → 原生能力观察 → CLI 断言；该文件不进入社区生产构建。
 * 必须独立编译成浏览器脚本，避免 Node TSX 的函数命名辅助代码跨序列化边界。
 */
import type { CommunityBootstrapApi } from '../../src/community-app/bootstrap/index.js';

/** 对照宿主真实常见键，值仅为测试哨兵，不能用作账户或凭据。 */
export const HOST_SENTINELS: Readonly<Record<string, string>> = Object.freeze({
	/** 宿主令牌键，仅用来验证社区没有读取或清除宿主状态。 */
	TOKEN: 'community-verifier-host-token-sentinel',
	/** 宿主用户标识键，不代表真实用户。 */
	UID: 'community-verifier-host-uid-sentinel',
	/** 旧站账户键，用来证明无会话入口不会恢复历史缓存。 */
	account: 'community-verifier-legacy-account-sentinel',
});

/** 记录单个存储操作，测试只观察，不读取真实宿主信息。 */
type StorageAccess = Readonly<{ operation: string; key: string | null }>;

/** 浏览器上下文中的启动副作用记录，不参与社区运行决策。 */
export type StartupAudit = {
	storageAccesses: StorageAccess[];
	webSocketUrls: string[];
	serviceWorkerUrls: string[];
	databaseNames: string[];
	broadcastNames: string[];
	readSentinels: () => Readonly<Record<string, string | null>>;
};

/** 验收页面的局部窗口扩展，不建立另一份运行时协议。 */
export type VerificationWindow = Window & {
	__COMMUNITY_VERIFY_AUDIT__?: StartupAudit;
	__MISSKEY_COMMUNITY_BOOTSTRAP__?: CommunityBootstrapApi;
};

/** 安装仅供验收使用的审计，不给生产文档注入兼容逻辑或模拟用户。 */
export function installCommunityStartupAudit(sentinels: Readonly<Record<string, string>>): void {
	const target: VerificationWindow = window as VerificationWindow;
	const originalGet: typeof Storage.prototype.getItem = Storage.prototype.getItem;
	const originalSet: typeof Storage.prototype.setItem = Storage.prototype.setItem;
	const originalRemove: typeof Storage.prototype.removeItem = Storage.prototype.removeItem;
	const originalClear: typeof Storage.prototype.clear = Storage.prototype.clear;
	for (const [key, value] of Object.entries(sentinels)) originalSet.call(window.localStorage, key, value);
	const audit: StartupAudit = {
		storageAccesses: [], webSocketUrls: [], serviceWorkerUrls: [], databaseNames: [], broadcastNames: [],
		/** 绕过审计包装读取既有哨兵，验证脚本自身不伪造被测访问记录。 */
		readSentinels: (): Readonly<Record<string, string | null>> => Object.fromEntries(Object.keys(sentinels).map(
			/** 只读取已知测试键，不接触真实会话。 */
			(key: string): [string, string | null] => [key, originalGet.call(window.localStorage, key)],
		)),
	};
	target.__COMMUNITY_VERIFY_AUDIT__ = audit;
	/** 观察任何存储读取，特别是旧账户缓存恢复。 */
	Storage.prototype.getItem = function getItem(this: Storage, key: string): string | null {
		audit.storageAccesses.push({ operation: 'getItem', key });
		return originalGet.call(this, key);
	};
	/** 观察写入后仍保持原生行为，以便发现真实宿主键变化。 */
	Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string): void {
		audit.storageAccesses.push({ operation: 'setItem', key });
		originalSet.call(this, key, value);
	};
	/** 观察定向删除，避免退出路径触及宿主存储。 */
	Storage.prototype.removeItem = function removeItem(this: Storage, key: string): void {
		audit.storageAccesses.push({ operation: 'removeItem', key });
		originalRemove.call(this, key);
	};
	/** 观察全量清空；哨兵检查将同时证实该动作的后果。 */
	Storage.prototype.clear = function clear(this: Storage): void {
		audit.storageAccesses.push({ operation: 'clear', key: null });
		originalClear.call(this);
	};
	window.WebSocket = new Proxy(window.WebSocket, {
		/** 记录意外连接并立即失败，不为未接入业务建立伪连接。 */
		construct(_target: typeof WebSocket, argumentsList: unknown[]): never {
			audit.webSocketUrls.push(String(argumentsList[0]));
			throw new Error('COMMUNITY_VERIFY_UNEXPECTED_WEBSOCKET');
		},
	});
	if ('serviceWorker' in navigator) {
		/** 阻止任何根或子作用域 SW 注册，保留完整的 URL 证据。 */
		navigator.serviceWorker.register = (scriptURL: string | URL, _options?: RegistrationOptions): Promise<ServiceWorkerRegistration> => {
			audit.serviceWorkerUrls.push(String(scriptURL));
			return Promise.reject(new Error('COMMUNITY_VERIFY_UNEXPECTED_SERVICE_WORKER'));
		};
	}
	/** 无会话启动不得初始化业务数据库。 */
	window.indexedDB.open = (databaseName: string, _version?: number): IDBOpenDBRequest => {
		audit.databaseNames.push(databaseName);
		throw new Error('COMMUNITY_VERIFY_UNEXPECTED_DATABASE');
	};
	window.BroadcastChannel = new Proxy(window.BroadcastChannel, {
		/** 记录意外频道，避免测试接入同源 App 的真实频道。 */
		construct(_target: typeof BroadcastChannel, argumentsList: unknown[]): never {
			audit.broadcastNames.push(String(argumentsList[0]));
			throw new Error('COMMUNITY_VERIFY_UNEXPECTED_BROADCAST');
		},
	});
}
