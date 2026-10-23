/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：本人成就页面生命周期适配。
 * 作用：把可见页面、缓存回访与原实时通知转换为 Store 的刷新意图，不持有成就列表。
 * 数据链：Vue／document／既有 main 频道 → Store 动作；非实时模式不创建 WebSocket。
 */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue';
import type { IChannelConnection, Channels, entities } from 'misskey-js';
import { ownAchievementsStore } from '../store/own-achievements.js';
import { $i } from '@/i.js';
import { store } from '@/store.js';
import { useStream } from '@/stream.js';

/** 业务容器唯一连接入口；事件载荷只触发查询，不能决定解锁事实。 */
export function useOwnAchievementsLifecycle(): void {
	let routeActive: boolean = false;
	let release: (() => void) | null = null;
	let connection: IChannelConnection<Channels['main']> | null = null;

	/** 成就通知只定向失效当前账户，普通通知不刷新列表。 */
	function onNotification(notification: entities.Notification): void {
		if (notification.type === 'achievementEarned' && $i != null) ownAchievementsStore.invalidate($i.id);
	}

	/** 仅可见且使用实时模式的消费者引用既有 main 频道。 */
	function syncConnection(): void {
		if (release != null && store.s.realtimeMode && connection == null) {
			connection = useStream().useChannel('main');
			connection.on('notification', onNotification);
		} else if ((release == null || !store.s.realtimeMode) && connection != null) {
			connection.dispose();
			connection = null;
		}
	}

	/** 视图可见性只影响调度；恢复可见时重新确认权威列表。 */
	function syncVisibility(): void {
		if (routeActive && window.document.visibilityState === 'visible') {
			release ??= ownAchievementsStore.activate();
		} else {
			release?.();
			release = null;
		}
		syncConnection();
	}

	/** 挂载与缓存首次 activated 幂等，保证首次只有一次查询。 */
	function activate(): void { routeActive = true; syncVisibility(); }

	/** 实际离页撤销可见租约，不清空全局已确认结果。 */
	function deactivate(): void { routeActive = false; syncVisibility(); }

	onMounted(/** 注册浏览器可见性并开始首次消费。 */ (): void => {
		window.document.addEventListener('visibilitychange', syncVisibility);
		activate();
	});
	onActivated(activate);
	onDeactivated(deactivate);
	onBeforeUnmount(/** 销毁容器时释放自身资源，不关闭全局流。 */ (): void => {
		deactivate();
		window.document.removeEventListener('visibilitychange', syncVisibility);
	});
	watch(store.r.realtimeMode, syncConnection);
}
