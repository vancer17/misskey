/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：包内社区持久化的 localStorage 适配。
 * 作用：隔离同源 App 数据，清理只影响本模块前缀，不修改全局 Storage 原型。
 * 数据链：原存储 API 调用 → 社区命名空间 → 浏览器存储。
 */
import type { Keys } from '@/local-storage.js';

/** 社区数据的唯一存储前缀，新包内环境不迁移原独立网页数据。 */
export const COMMUNITY_STORAGE_PREFIX: string = 'misskey-community::';

/** 从浏览器原生 Storage 派生最小公开能力，不复制持久化业务类型。 */
export type CommunityStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

/** 从既有存储键派生 JSON 适配 API，JSON 原始结果保持 unknown。 */
type CommunityLocalStorageApi = Readonly<{
	getItem: (key: Keys) => string | null;
	setItem: (key: Keys, value: string) => void;
	removeItem: (key: Keys) => void;
	getItemAsJson: (key: Keys) => unknown;
	setItemAsJson: (key: Keys, value: unknown) => void;
}>;

/** 创建只管理社区键的原生存储适配器，保留标准空值与索引行为。 */
export function createCommunityStorage(storage: CommunityStorage): CommunityStorage {
	/** 收集当前社区键，清理与枚举不接触其他 App 字段。 */
	function keys(): string[] {
		const result: string[] = [];
		for (let index: number = 0; index < storage.length; index++) {
			const key: string | null = storage.key(index);
			if (key?.startsWith(COMMUNITY_STORAGE_PREFIX)) result.push(key.slice(COMMUNITY_STORAGE_PREFIX.length));
		}
		return result;
	}

	return Object.freeze({
		/** 只统计社区所属键。 */
		get length(): number { return keys().length; },
		/** 按原生索引顺序读取社区键名，不泄漏宿主键。 */
		key(index: number): string | null { return keys()[index] ?? null; },
		/** 读取单个社区字段。 */
		getItem(key: string): string | null { return storage.getItem(COMMUNITY_STORAGE_PREFIX + key); },
		/** 写入单个社区字段。 */
		setItem(key: string, value: string): void { storage.setItem(COMMUNITY_STORAGE_PREFIX + key, value); },
		/** 删除单个社区字段。 */
		removeItem(key: string): void { storage.removeItem(COMMUNITY_STORAGE_PREFIX + key); },
		/** 清理社区所属字段，绝不调用原生全量 clear。 */
		clear(): void {
			for (const key of keys()) storage.removeItem(COMMUNITY_STORAGE_PREFIX + key);
		},
	});
}

/** 原生对象只在应用模块真正导入时取得，轻量 Bootstrap 不触及存储。 */
export const communityLocalStorage: CommunityStorage = createCommunityStorage(window.localStorage);

/** 原 Keys 从唯一权威定义派生，专用构建只替换存储地址。 */
export type { Keys } from '@/local-storage.js';

/** 保留现有消费者的公共存储方法，同时让 JSON 结果保持未知类型。 */
export const miLocalStorage: CommunityLocalStorageApi = Object.freeze({
	/** 读取权威键对应的社区值。 */
	getItem(key: Keys): string | null { return communityLocalStorage.getItem(key); },
	/** 写入权威键对应的社区值。 */
	setItem(key: Keys, value: string): void { communityLocalStorage.setItem(key, value); },
	/** 删除权威键对应的社区值。 */
	removeItem(key: Keys): void { communityLocalStorage.removeItem(key); },
	/** JSON 解析只交付未知值，由既有消费者承担其业务校验。 */
	getItemAsJson(key: Keys): unknown {
		const value: string | null = communityLocalStorage.getItem(key);
		return value === null ? undefined : JSON.parse(value) as unknown;
	},
	/** 序列化输入而不派生或复制业务状态。 */
	setItemAsJson(key: Keys, value: unknown): void { communityLocalStorage.setItem(key, JSON.stringify(value)); },
});
