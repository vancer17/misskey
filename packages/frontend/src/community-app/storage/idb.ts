/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区专属 IndexedDB 适配。
 * 作用：使用独立库和 store，失败原样传播；不清理宿主或默认 idb-keyval 库，不新增兼容路径。
 * 数据链：原缓存 API → 专属持久化；缓存结果不充当业务授权事实。
 */
import { clear as clearIdb, createStore, del as deleteIdb, get as getIdb, set as setIdb } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';
const database: UseStore = createStore('MisskeyCommunityClient', 'community-cache');

/** 从社区专属缓存读取值，失败交给原消费者处理。 */
export async function get<T = unknown>(key: string): Promise<T | undefined> {
	return await getIdb<T>(key, database);
}

/** 将缓存写入专属库，不修改 App 原有缓存。 */
export async function set(key: string, value: unknown): Promise<void> {
	await setIdb(key, value, database);
}

/** 删除社区 IDB 中的指定缓存。 */
export async function del(key: string): Promise<void> {
	await deleteIdb(key, database);
}

/** 清理社区缓存，不触及宿主、默认库或全部 localStorage。 */
export async function clear(): Promise<void> {
	await clearIdb(database);
}
