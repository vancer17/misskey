/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 账户状态：从 Bootstrap 已验证的本地会话建立既有响应式账户单例，供页面和 Store 只读消费。 */

import { reactive } from 'vue';
import type { AccountWithToken } from '@/accounts/index.js';
import { miLocalStorage } from '@/local-storage.js';

// TODO: 他のタブと永続化されたstateを同期

const accountData = miLocalStorage.getItem('account');

// TODO: 外部からはreadonlyに
export const $i = accountData ? reactive(JSON.parse(accountData) as AccountWithToken) : null;

export const iAmModerator = $i != null && ($i.isAdmin === true || $i.isModerator === true);
export const iAmAdmin = $i != null && $i.isAdmin;

export function ensureSignin() {
	if ($i == null) throw new Error('signin required');
	return $i;
}

export let notesCount = $i == null ? 0 : $i.notesCount;
/** 从现有独立站账户计数读取展示投影，供共享发帖组件与嵌入适配保持相同调用契约。 */
export function getNotesCount(): number {
	return notesCount;
}
export function incNotesCount() {
	notesCount++;
}

if (_DEV_) {
	(window as any).$i = $i;
}
