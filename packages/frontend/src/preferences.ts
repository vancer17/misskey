/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：偏好设置 · 会话实例。
 * 作用：装配偏好存储、跨标签页同步与定期备份；备份操作按需加载界面依赖。
 */

import { BroadcastChannel } from 'broadcast-channel';
import { createVisibilityAwareInterval } from '@@/js/interval.js';
import type { StorageProvider } from '@/preferences/manager.js';
import { miLocalStorage } from '@/local-storage.js';
import { isSameScope, PreferencesManager } from '@/preferences/manager.js';
import { store } from '@/store.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { TAB_ID } from '@/tab-id.js';

// クラウド同期用グループ名
const syncGroup = 'default';

const io: StorageProvider = {
	load: () => {
		const savedProfileRaw = miLocalStorage.getItem('preferences');
		if (savedProfileRaw == null) {
			return null;
		} else {
			return JSON.parse(savedProfileRaw);
		}
	},

	save: (ctx) => {
		miLocalStorage.setItem('preferences', JSON.stringify(ctx.profile));
	},

	cloudGet: async (ctx) => {
		// TODO: この取得方法だとアカウントが変わると保存場所も変わってしまうので改修する
		// 例えば複数アカウントある場合でも設定値を保存するための「プライマリアカウント」を設定できるようにするとか
		try {
			const cloudData = await misskeyApi('i/registry/get', {
				scope: ['client', 'preferences', 'sync'],
				key: syncGroup + ':' + ctx.key,
			}) as [any, any][];
			const target = cloudData.find(([scope]) => isSameScope(scope, ctx.scope));
			if (target == null) return null;
			return {
				value: target[1],
			};
		} catch (err: any) {
			if (err.code === 'NO_SUCH_KEY') { // TODO: いちいちエラーキャッチするのは面倒なのでキーが無くてもエラーにならない maybe-get のようなエンドポイントをバックエンドに実装する
				return null;
			} else {
				throw err;
			}
		}
	},

	cloudSet: async (ctx) => {
		let cloudData: [any, any][] = [];
		try {
			cloudData = await misskeyApi('i/registry/get', {
				scope: ['client', 'preferences', 'sync'],
				key: syncGroup + ':' + ctx.key,
			}) as [any, any][];
		} catch (err: any) {
			if (err.code === 'NO_SUCH_KEY') { // TODO: いちいちエラーキャッチするのは面倒なのでキーが無くてもエラーにならない maybe-get のようなエンドポイントをバックエンドに実装する
				cloudData = [];
			} else {
				throw err;
			}
		}

		const i = cloudData.findIndex(([scope]) => isSameScope(scope, ctx.scope));

		if (i === -1) {
			cloudData.push([ctx.scope, ctx.value]);
		} else {
			cloudData[i] = [ctx.scope, ctx.value];
		}

		await misskeyApi('i/registry/set', {
			scope: ['client', 'preferences', 'sync'],
			key: syncGroup + ':' + ctx.key,
			value: cloudData,
		});
	},

	cloudGetBulk: async (ctx) => {
		// TODO: 値の取得を1つのリクエストで済ませたい(バックエンド側でAPIの新設が必要)
		const fetchings = ctx.needs.map(need => io.cloudGet(need).then(res => [need.key, res] as const));
		const cloudDatas = await Promise.all(fetchings);

		const res = {} as Partial<Record<string, any>>;
		for (const cloudData of cloudDatas) {
			if (cloudData[1] != null) {
				res[cloudData[0]] = cloudData[1].value;
			}
		}

		return res;
	},
};

export const prefer = new PreferencesManager(io, $i);

//#region タブ間同期
let latestPreferencesUpdate: {
	tabId: string;
	timestamp: number;
} | null = null;

const preferencesChannel = new BroadcastChannel<{
	type: 'preferencesUpdate';
	tabId: string;
	timestamp: number;
}>('preferences');

prefer.on('committed', () => {
	latestPreferencesUpdate = {
		tabId: TAB_ID,
		timestamp: Date.now(),
	};
	preferencesChannel.postMessage({
		type: 'preferencesUpdate',
		tabId: TAB_ID,
		timestamp: latestPreferencesUpdate.timestamp,
	});
});

preferencesChannel.addEventListener('message', (msg) => {
	if (msg.type === 'preferencesUpdate') {
		if (msg.tabId === TAB_ID) return;
		if (latestPreferencesUpdate != null) {
			if (msg.timestamp <= latestPreferencesUpdate.timestamp) return;
		}
		prefer.reloadProfile();
		if (_DEV_) console.log('prefer:received update from other tab');
		latestPreferencesUpdate = {
			tabId: msg.tabId,
			timestamp: msg.timestamp,
		};
	}
});
//#endregion

//#region 定期クラウドバックアップ
let latestBackupAt: number = 0;

/** 执行备份时才加载工具模块，避免初始化偏好实例时进入界面依赖。 */
async function cloudBackup(): Promise<void> {
	const backupModule: typeof import('@/preferences/utility.js') = await import('@/preferences/utility.js');
	await backupModule.cloudBackup();
}

/** 仅在登录、自动备份开启且偏好已有更新时提交备份。 */
function backupModifiedPreferences(): void {
	if ($i == null) return;
	if (!store.s.enablePreferencesAutoCloudBackup) return;
	if (prefer.profile.modifiedAt <= latestBackupAt) return;

	cloudBackup().then(
		/** 备份成功后更新检查时间，失败时保留下一次备份机会。 */
		(): void => {
			latestBackupAt = Date.now();
		},
	);
}

// documentが非表示の間は実行されない (同期されていない古い値がバックアップされるのを防ぐ意味もある)
createVisibilityAwareInterval(backupModifiedPreferences, 1000 * 60 * 3);
//#endregion

/** 开发模式下提供的偏好调试入口，备份与定时任务共用按需加载实现。 */
type PreferencesDebugWindow = Window & {
	prefer?: PreferencesManager;
	cloudBackup?: typeof cloudBackup;
};

if (_DEV_) {
	const debugWindow: PreferencesDebugWindow = window;
	debugWindow.prefer = prefer;
	debugWindow.cloudBackup = cloudBackup;
}
