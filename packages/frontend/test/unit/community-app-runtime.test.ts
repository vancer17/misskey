/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区 Bootstrap 与存储适配的协议测试。
 * 作用：证明装配来源、实例归属、资源目录和存储命名空间；不证明真实 BFF 业务行为。
 * 数据链：受控输入 → 公共适配 API → 冻结状态或明确错误。
 */
import { describe, expect, it } from 'vitest';
import { createCommunityBootstrapApi, requireCommunitySession } from '@/community-app/bootstrap/index.js';
import type { CommunityBootstrapApi, CommunityHostDependencies } from '@/community-app/bootstrap/index.js';
import { COMMUNITY_STORAGE_PREFIX, createCommunityStorage } from '@/community-app/storage/index.js';
import type { CommunityStorage } from '@/community-app/storage/index.js';

/** 创建仅包含 Bootstrap 读取地址的独立窗口替身，不提供业务 API。 */
function ownWindow(): Window {
	return { location: { origin: 'https://app.example', href: 'https://app.example/nested/community/index.html' } } as Window;
}

/** 提供合法的地址装配输入，不包含凭据或用户。 */
function dependencies(): CommunityHostDependencies {
	return Object.freeze({
		instanceId: 'community-instance-1',
		hostOrigin: 'https://app.example',
		assetBase: 'https://app.example/nested/community/',
		canonicalInstanceUrl: 'https://community.example',
		apiBase: 'https://bff.example/community/v1/api',
		wsBase: 'wss://bff.example/community/v1/stream',
		language: 'zh-CN',
	});
}

/** 记录状态发布并创建父子窗口受控边界。 */
function bootstrap(parentWindow: Window, currentWindow: Window): CommunityBootstrapApi {
	return createCommunityBootstrapApi(parentWindow, currentWindow, /** 协议测试不注册任何业务副作用。 */ (): void => {});
}

describe('community app bootstrap boundary', /** 验证本地装配控制协议，不假装存在 BFF。 */ (): void => {
	it('starts frozen and does not assert any readiness', /** 初始等待不产生业务就绪标记。 */ (): void => {
		const api: CommunityBootstrapApi = bootstrap({} as Window, ownWindow());
		expect(Object.isFrozen(api)).toBe(true);
		expect(Object.isFrozen(api.getState())).toBe(true);
		expect(api.getState()).toEqual({ phase: 'WAITING_HOST', instanceId: null, errorCode: null, language: null });
		expect(requireCommunitySession).toThrow('COMMUNITY_BFF_ADAPTER_REQUIRED');
	});

	it('accepts only the current parent and remains session-required', /** 合法交接不等于业务或桥接就绪。 */ (): void => {
		const parentWindow: Window = {} as Window;
		const api: CommunityBootstrapApi = bootstrap(parentWindow, ownWindow());
		expect(api.configure(dependencies(), parentWindow)).toEqual({ phase: 'SESSION_REQUIRED', instanceId: 'community-instance-1', errorCode: 'COMMUNITY_BFF_ADAPTER_REQUIRED', language: 'zh-CN' });
	});

	it('rejects another window without changing current state', /** 其他窗口不能驱动本实例。 */ (): void => {
		const api: CommunityBootstrapApi = bootstrap({} as Window, ownWindow());
		expect(/** 提交伪造来源窗口。 */ (): unknown => api.configure(dependencies(), {} as Window)).toThrow('COMMUNITY_INVALID_HOST_WINDOW');
		expect(api.getState().phase).toBe('WAITING_HOST');
	});

	it('rejects top-level use', /** 独立打开的文档不能把自己当成宿主。 */ (): void => {
		const currentWindow: Window = ownWindow();
		const api: CommunityBootstrapApi = bootstrap(currentWindow, currentWindow);
		expect(/** 使用顶层窗口尝试交接。 */ (): unknown => api.configure(dependencies(), currentWindow)).toThrow('COMMUNITY_INVALID_HOST_WINDOW');
	});

	it('rejects invalid host origin with an explicit failure', /** 非确切来源不得装配。 */ (): void => {
		const parentWindow: Window = {} as Window;
		const api: CommunityBootstrapApi = bootstrap(parentWindow, ownWindow());
		expect(/** 使用通配来源尝试交接。 */ (): unknown => api.configure({ ...dependencies(), hostOrigin: '*' }, parentWindow)).toThrow('COMMUNITY_INVALID_HOST_ORIGIN');
		expect(api.getState().phase).toBe('FAILED');
	});

	it('binds assets to the actual nested document directory', /** 同源其他目录也不是本制品入口。 */ (): void => {
		const parentWindow: Window = {} as Window;
		const api: CommunityBootstrapApi = bootstrap(parentWindow, ownWindow());
		expect(/** 使用同源错误目录尝试交接。 */ (): unknown => api.configure({ ...dependencies(), assetBase: 'https://app.example/other/' }, parentWindow)).toThrow('COMMUNITY_INVALID_ASSET_BASE');
	});

	it('rejects credentials in service addresses', /** URL 不承载秘密或授权查询字段。 */ (): void => {
		const parentWindow: Window = {} as Window;
		const api: CommunityBootstrapApi = bootstrap(parentWindow, ownWindow());
		expect(/** 使用带凭据地址尝试交接。 */ (): unknown => api.configure({ ...dependencies(), apiBase: 'https://secret@bff.example/api' }, parentWindow)).toThrow('COMMUNITY_INVALID_DEPENDENCIES');
	});

	it('does not rebind a configured instance', /** 新旧实例不能共享同一个已绑定边界。 */ (): void => {
		const parentWindow: Window = {} as Window;
		const api: CommunityBootstrapApi = bootstrap(parentWindow, ownWindow());
		api.configure(dependencies(), parentWindow);
		expect(/** 尝试替换当前实例。 */ (): unknown => api.configure({ ...dependencies(), instanceId: 'community-instance-2' }, parentWindow)).toThrow('COMMUNITY_INSTANCE_ALREADY_CONFIGURED');
		expect(api.getState().instanceId).toBe('community-instance-1');
	});

	it('rejects stale disposal and permanently closes the owner instance', /** 旧实例无法释放当前资源，释放后不能复活。 */ (): void => {
		const parentWindow: Window = {} as Window;
		const api: CommunityBootstrapApi = bootstrap(parentWindow, ownWindow());
		api.configure(dependencies(), parentWindow);
		expect(/** 旧实例发起释放。 */ (): void => api.dispose('old-instance')).toThrow('COMMUNITY_STALE_INSTANCE');
		api.dispose('community-instance-1');
		expect(api.getState().errorCode).toBe('COMMUNITY_INSTANCE_DISPOSED');
		expect(/** 释放后尝试重新配置。 */ (): unknown => api.configure(dependencies(), parentWindow)).toThrow('COMMUNITY_INSTANCE_DISPOSED');
	});
});

describe('community storage boundary', /** 仅验证命名空间映射，不证明领域行为。 */ (): void => {
	it('enumerates and clears only community keys', /** 清理不能影响同源宿主会话。 */ (): void => {
		const values: Map<string, string> = new Map<string, string>();
		const backing: CommunityStorage = {
			/** 提供独立测试存储的真实长度。 */
			get length(): number { return values.size; },
			/** 按稳定插入顺序提供索引。 */
			key(index: number): string | null { return [...values.keys()][index] ?? null; },
			/** 模拟原生读取空值。 */
			getItem(key: string): string | null { return values.get(key) ?? null; },
			/** 保存输入值。 */
			setItem(key: string, value: string): void { values.set(key, value); },
			/** 删除指定值。 */
			removeItem(key: string): void { values.delete(key); },
			/** 原生全量清理能力不应被社区适配器调用。 */
			clear(): void { throw new Error('GLOBAL_STORAGE_CLEAR_FORBIDDEN'); },
		};
		const storage: CommunityStorage = createCommunityStorage(backing);
		backing.setItem('host-session-for-community-test', 'host-secret');
		storage.setItem('community-test-key', 'community-value');
		expect(backing.getItem(COMMUNITY_STORAGE_PREFIX + 'community-test-key')).toBe('community-value');
		expect(storage.getItem('host-session-for-community-test')).toBeNull();
		expect(storage.length).toBeGreaterThanOrEqual(1);
		storage.clear();
		expect(backing.getItem('host-session-for-community-test')).toBe('host-secret');
		expect(storage.length).toBe(0);
		backing.removeItem('host-session-for-community-test');
	});
});
