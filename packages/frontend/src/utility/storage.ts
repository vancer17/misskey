/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readonly, ref } from 'vue';
import type { Ref } from 'vue';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';

export const storagePersistenceSupported = window.isSecureContext && 'storage' in navigator;
const storagePersisted = ref(false);

export async function getStoragePersistenceStatusRef() {
	if (storagePersistenceSupported) {
		storagePersisted.value = await navigator.storage.persisted().catch(() => false);
	}

	return readonly(storagePersisted);
}

/**
 * 共享存储持久化状态 ref 的同步获取（后台异步初始化）。
 *
 * 为同步 setup 调用方返回共享只读 ref，初始值后台拉取后回填。
 * 此接口不负责路由缓存恢复；enableStoragePersistence 的后续变更
 * 亦经同一共享 ref 生效。
 */
export function getStoragePersistenceSharedRefSync(): Readonly<Ref<boolean>> {
	if (storagePersistenceSupported) {
		void navigator.storage.persisted().catch(() => false).then((persisted) => {
			storagePersisted.value = persisted;
		});
	}

	return readonly(storagePersisted);
}

export async function enableStoragePersistence() {
	if (!storagePersistenceSupported) return;
	try {
		const persisted = await navigator.storage.persist();
		if (persisted) {
			storagePersisted.value = true;
		} else {
			os.alert({
				type: 'error',
				text: i18n.ts.somethingHappened,
			});
		}
	}	catch (err) {
		os.alert({
			type: 'error',
			text: i18n.ts.somethingHappened,
		});
	}
}

export function skipStoragePersistence() {
	store.set('showStoragePersistenceSuggestion', false);
}
