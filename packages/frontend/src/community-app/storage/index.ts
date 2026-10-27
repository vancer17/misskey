/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 社区存储公共入口：提供命名空间和原生存储适配，不导出缓存内部实现。 */
export { COMMUNITY_STORAGE_PREFIX, communityLocalStorage, createCommunityStorage, miLocalStorage } from './local-storage.js';
export type { CommunityStorage, Keys } from './local-storage.js';
