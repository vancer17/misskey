/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 频道窗口的展示定位。
 * 作用：在窗口存续期间测量频道主列中心，响应尺寸及布局属性变化，并释放短期观察器。
 * 数据链：页面根元素的实际布局 → 视口 CSS 横坐标 → 全局弹窗的纯布局参数。
 * 仅保存 DOM 和帧调度信息；不读取频道实体，不建立 Store、路由或领域事实。
 */
import { onScopeDispose } from 'vue';
import type { ShallowRef } from 'vue';

/** 接收当前主列中心；锚点退出文档时通知调用方结束对应窗口。 */
type DialogCenterListener = (centerX: number | undefined) => void;

/** 为页面提供按窗口生命周期开启的定位观察，关闭函数幂等。 */
export function useCommunityDialogPosition(
	anchor: Readonly<ShallowRef<HTMLElement | null>>,
): (onCenter: DialogCenterListener) => () => void {
	/** 同一频道页面仅有一个管理窗口，保留其当前释放入口。 */
	let stopCurrent: (() => void) | null = null;

	/** 首次同步交付坐标，后续 DOM 变化在同一动画帧内合并。 */
	function observeCenter(onCenter: DialogCenterListener): () => void {
		stopCurrent?.();
		const controller: AbortController = new AbortController();
		let frame: number | null = null;
		let stopped: boolean = false;

		/** getBoundingClientRect 与基础模态参数共用视口 CSS 坐标。 */
		function measure(): void {
			frame = null;
			if (stopped) return;
			const element: HTMLElement | null = anchor.value;
			if (element == null || !element.isConnected) { onCenter(undefined); return; }
			const rect: DOMRect = element.getBoundingClientRect();
			onCenter(rect.width > 0 ? rect.left + rect.width / 2 : undefined);
		}

		/** 观察器和原生事件共享一次布局读取，不使用持续轮询。 */
		function schedule(): void {
			if (!stopped && frame == null) frame = requestAnimationFrame(measure);
		}

		const resize: ResizeObserver = new ResizeObserver(/** 尺寸变化后重新读取位置。 */ (): void => { schedule(); });
		const mutation: MutationObserver = new MutationObserver(/** 祖先布局类变化也可能只改变主列位置。 */ (): void => { schedule(); });
		let element: HTMLElement | null = anchor.value;
		while (element != null) {
			resize.observe(element);
			mutation.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
			element = element.parentElement;
		}
		window.addEventListener('resize', schedule, { passive: true, signal: controller.signal });
		window.addEventListener('scroll', schedule, { passive: true, capture: true, signal: controller.signal });
		// 同宽位移的结束帧可能没有尺寸变化，过渡完成或中止后重新确认几何。
		window.addEventListener('transitionend', schedule, { passive: true, capture: true, signal: controller.signal });
		window.addEventListener('transitioncancel', schedule, { passive: true, capture: true, signal: controller.signal });
		window.addEventListener('animationend', schedule, { passive: true, capture: true, signal: controller.signal });
		window.addEventListener('animationcancel', schedule, { passive: true, capture: true, signal: controller.signal });
		window.visualViewport?.addEventListener('resize', schedule, { passive: true, signal: controller.signal });
		window.visualViewport?.addEventListener('scroll', schedule, { passive: true, signal: controller.signal });

		/** 关闭或页面销毁后不再读取旧锚点，退出动画保留最后坐标。 */
		function stop(): void {
			if (stopped) return;
			stopped = true;
			controller.abort();
			resize.disconnect();
			mutation.disconnect();
			if (frame != null) cancelAnimationFrame(frame);
			frame = null;
			if (stopCurrent === stop) stopCurrent = null;
		}

		stopCurrent = stop;
		measure();
		return stop;
	}

	onScopeDispose(/** 页面释放兜底清理尚未关闭的窗口观察器。 */ (): void => { stopCurrent?.(); });
	return observeCenter;
}
