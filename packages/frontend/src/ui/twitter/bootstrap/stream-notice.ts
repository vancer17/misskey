/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI 启动层的实时连接提示协调。
 * 作用：观察既有 Stream、账户和展示偏好，在前台持续断线后展示可关闭的提示。
 * 数据链：共享 Stream 的当前连接事实 → 可见性宽限 → 只读临时 UI 状态。
 * 本模块不创建额外连接、不恢复业务数据，也不向领域、组件或 Store 暴露环境探测结果。
 */
import { readonly, ref, watch } from 'vue';
import type { Ref, WatchStopHandle } from 'vue';
import type { IStream } from 'misskey-js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import { useStream } from '@/stream.js';

/** 前台持续断线的展示宽限；恢复连接或进入后台时取消，不作为运行时配置。 */
const RECONNECT_NOTICE_GRACE_MS: number = 3000;

/** Shell 持有的提示租约；仅暴露展示状态、当前断线轮次关闭和幂等清理。 */
export type TwitterStreamNoticeController = Readonly<{
	visible: Readonly<Ref<boolean>>;
	dismiss: () => void;
	dispose: () => void;
}>;

/** 将共享连接事实单向派生为 Twitter Shell 的临时提示，不接管重连或业务对账。 */
export function createTwitterStreamNotice(): TwitterStreamNoticeController {
	const visible: Ref<boolean> = ref(false);
	let stream: IStream | null = null;
	let timer: number | null = null;
	let timerGeneration: number = 0;
	let dismissed: boolean = false;
	let suspended: boolean = false;
	let disposed: boolean = false;

	/** 只在登录账户、实时模式和 quiet 展示偏好共同成立时观察现有连接。 */
	function isEnabled(): boolean {
		return $i != null && store.s.realtimeMode && prefer.s.serverDisconnectedBehavior === 'quiet';
	}

	/** 作废旧宽限回调，避免页面恢复时已排队的旧任务重新显示提示。 */
	function cancelTimer(): void {
		timerGeneration++;
		if (timer != null) window.clearTimeout(timer);
		timer = null;
	}

	/** 在宽限结束时重读事实；不使用计时开始时的连接或页面状态快照。 */
	function onGraceElapsed(generation: number): void {
		if (disposed || generation !== timerGeneration) return;
		timer = null;
		if (stream?.state === 'reconnecting' && isEnabled() && !suspended && window.document.visibilityState === 'visible' && !dismissed) {
			visible.value = true;
		} else {
			syncPresentation();
		}
	}

	/** 根据 SDK 的权威状态更新展示，后台切换仅影响宽限和提示。 */
	function syncPresentation(): void {
		if (disposed) return;
		const state: IStream['state'] | undefined = stream?.state;
		if (state === 'connected') dismissed = false;
		if (state !== 'reconnecting' || !isEnabled() || suspended || window.document.visibilityState !== 'visible' || dismissed) {
			cancelTimer();
			visible.value = false;
			return;
		}
		if (visible.value || timer != null) return;
		const generation: number = ++timerGeneration;
		timer = window.setTimeout(/** 回调世代仅隔离已取消的展示任务。 */ (): void => {
			onGraceElapsed(generation);
		}, RECONNECT_NOTICE_GRACE_MS);
	}

	/** 释放本观察者的监听，不关闭共享连接或改变原有业务消费者。 */
	function detachStream(): void {
		if (stream == null) return;
		stream.off('_connected_', syncPresentation);
		stream.off('_disconnected_', syncPresentation);
		stream = null;
	}

	/** 偏好变化时切换提示观察；关闭门控结束本次观察，重新启用后读取当前连接事实。 */
	function syncSubscription(): void {
		if (disposed) return;
		if (isEnabled()) {
			if (stream == null) {
				stream = useStream();
				stream.on('_connected_', syncPresentation);
				stream.on('_disconnected_', syncPresentation);
			}
		} else {
			detachStream();
			// 停止观察期间可能已经恢复并再次断线，旧关闭标记不能推断新一轮连接事实。
			dismissed = false;
		}
		syncPresentation();
	}

	/** 账户边界释放旧观察和关闭标记；不将一个账户的 UI 选择传给另一个账户。 */
	function onAccountChanged(): void {
		cancelTimer();
		visible.value = false;
		dismissed = false;
		detachStream();
		syncSubscription();
	}

	/** 页面隐藏时取消宽限，恢复可见时从当前连接重新计算前台宽限。 */
	function onVisibilityChange(): void {
		syncPresentation();
	}

	/** 页面进入缓存或卸载时只收起展示，业务恢复仍由既有所有者负责。 */
	function onPageHide(): void {
		suspended = true;
		syncPresentation();
	}

	/** 页面从缓存恢复后重读连接状态，不主动触发业务请求。 */
	function onPageShow(): void {
		suspended = false;
		syncSubscription();
	}

	/** 关闭当前观察期间的连续断线提示；页面隐藏不重置，连接恢复或观察门控关闭才结束轮次。 */
	function dismiss(): void {
		if (disposed) return;
		dismissed = stream?.state === 'reconnecting';
		cancelTimer();
		visible.value = false;
	}

	const stopAccount: WatchStopHandle = watch([
		/** 只读取现有账户标识，以识别观察者的所有权边界。 */ (): string | null => $i?.id ?? null,
		/** 令牌变化代表现有登录会话变化，不解析凭证内容。 */ (): string | null => $i?.token ?? null,
	], onAccountChanged, { flush: 'sync' });
	const stopRealtime: WatchStopHandle = watch(
		/** 实时模式只决定是否观察，不创建独立运行模式。 */ (): boolean => store.s.realtimeMode,
		syncSubscription,
		{ flush: 'sync' },
	);
	const stopPreference: WatchStopHandle = watch(
		/** 沿用原偏好类型，reload 与 dialog 继续交给原启动逻辑。 */ (): typeof prefer.s.serverDisconnectedBehavior => prefer.s.serverDisconnectedBehavior,
		syncSubscription,
		{ flush: 'sync' },
	);

	window.document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('pagehide', onPageHide);
	window.addEventListener('pageshow', onPageShow);
	syncSubscription();

	/** Shell 卸载时幂等释放全部监听、watcher 和宽限任务。 */
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		stopAccount();
		stopRealtime();
		stopPreference();
		detachStream();
		cancelTimer();
		visible.value = false;
		window.document.removeEventListener('visibilitychange', onVisibilityChange);
		window.removeEventListener('pagehide', onPageHide);
		window.removeEventListener('pageshow', onPageShow);
	}

	return Object.freeze({ visible: readonly(visible), dismiss, dispose });
}
