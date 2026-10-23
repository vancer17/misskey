/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 时间线的正文呈现交接。
 * 作用：在来源切换前保存旧可见片段，原子回顶后让原 DOM 作为不可交互的短暂离场层。
 * 数据链：只读标签标识 → 当前 DOM 几何 → 离场补偿；查询、帖子集合和请求生命周期仍归原所有者。
 * 不克隆 DOM、不缓存业务实体，不为正文增加第二个横向转场。
 */
import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import type { Ref } from 'vue';
import { getScrollContainer, getStickyBottom, getStickyTop } from '@@/js/scroll.js';
import { useTwitterSourceScrollReset } from './use-twitter-scroll-host.js';

/** 单次离场仅保存 DOM 身份和展示序号，过期回调不能清理下一轮呈现。 */
type TimelineHandoff = Readonly<{
	frame: HTMLElement;
	panel: HTMLElement;
	generation: number;
}>;

/** Shell 转交给唯一 MkSwiper 转场的展示生命周期。 */
type TimelineTransitionHandlers = Readonly<{
	beforeLeave: (element: Element) => void;
	afterLeave: (element: Element) => void;
	afterEnter: (element: Element) => void;
	enterCancelled: (element: Element) => void;
	cancel: () => void;
}>;

/**
 * 将来源导航和短暂几何交接连接起来；读取原选中值，不保存第二份业务来源。
 * 动画关闭时仍立即回顶，但不保留离场展示层。
 */
export function useTwitterTimelineTransition(
	root: Readonly<Ref<HTMLElement | null | undefined>>,
	selected: Readonly<Ref<string | undefined>>,
	animated: Readonly<Ref<boolean>>,
	settleLeaving: () => void,
): TimelineTransitionHandlers {
	const resetScroll: () => boolean = useTwitterSourceScrollReset(root);
	let active: boolean = true;
	let generation: number = 0;
	let handoff: TimelineHandoff | null = null;
	let inputController: AbortController | null = null;
	const leaving: Map<HTMLElement, number> = new Map<HTMLElement, number>();

	/** 只结束面板自身的空间过渡，不影响帖子、媒体等后代动画。 */
	function finishPanel(panel: HTMLElement): void {
		for (const animation of panel.getAnimations()) animation.finish();
	}

	/** 撤销本轮临时裁切和输入订阅，不改变用户已经接管的滚动位置。 */
	function release(): void {
		const current: TimelineHandoff | null = handoff;
		handoff = null;
		inputController?.abort();
		inputController = null;
		if (current == null) return;
		current.frame.style.removeProperty('height');
		current.frame.style.removeProperty('min-height');
		current.frame.removeAttribute('data-twitter-timeline-handoff');
	}

	/** 用户输入或缓存失活结束旧展示，后续完成回调不得移动当前页面。 */
	function cancel(): void {
		generation++;
		release();
		settleLeaving();
		const frame: HTMLElement | null = root.value?.querySelector('[data-mk-swiper]') ?? null;
		if (frame != null) {
			for (const panel of frame.querySelectorAll<HTMLElement>(':scope > [data-mk-swiper-panel]:not([data-twitter-timeline-leaving])')) finishPanel(panel);
		}
	}

	/** 在 Vue 替换旧查询之前冻结当前可见片段；真实宿主只在这里回顶一次。 */
	function prepare(): void {
		if (!active || root.value == null || !root.value.isConnected) return;
		release();
		generation++;
		settleLeaving();
		const frame: HTMLElement | null = root.value.querySelector('[data-mk-swiper]');
		const panel: HTMLElement | null = frame?.querySelector(':scope > [data-mk-swiper-panel]:not([data-twitter-timeline-leaving])') ?? null;
		if (frame == null || panel == null || !animated.value) { resetScroll(); return; }
		const host: HTMLElement | null = getScrollContainer(root.value);
		const viewportTop: number = host?.getBoundingClientRect().top ?? 0;
		const viewportBottom: number = host?.getBoundingClientRect().bottom ?? window.innerHeight;
		const before: DOMRect = panel.getBoundingClientRect();
		const visibleTop: number = Math.max(frame.getBoundingClientRect().top, viewportTop + getStickyTop(panel, host));
		const height: number = Math.max(0, viewportBottom - visibleTop - getStickyBottom(panel, host));
		if (!resetScroll() || height === 0) return;
		const after: DOMRect = panel.getBoundingClientRect();
		// 个体 translate 保留纵向片段，MkSwiper 的 transform 仍独占横向动画。
		panel.style.translate = `0 ${before.top - after.top}px`;
		panel.style.position = 'absolute';
		panel.style.inset = '0 0 auto';
		panel.style.width = '100%';
		panel.style.pointerEvents = 'none';
		panel.style.overflowAnchor = 'none';
		panel.inert = true;
		panel.setAttribute('aria-hidden', 'true');
		panel.setAttribute('data-twitter-timeline-leaving', '');
		frame.style.height = `${height}px`;
		frame.style.minHeight = '0';
		frame.setAttribute('data-twitter-timeline-handoff', '');
		handoff = { frame, panel, generation };
		leaving.set(panel, generation);
		inputController = new AbortController();
		const target: HTMLElement | Window = host ?? window;
		for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
			target.addEventListener(event, cancel, { passive: true, signal: inputController.signal });
		}
	}

	/** 未经本次准备的离场也不允许继续接收指针或进入可访问性树。 */
	function beforeLeave(element: Element): void {
		if (!(element instanceof HTMLElement)) return;
		element.inert = true;
		element.setAttribute('aria-hidden', 'true');
		element.style.pointerEvents = 'none';
		element.setAttribute('data-twitter-timeline-leaving', '');
	}

	/** 只有本轮离场节点可释放当前裁切，较早动画的完成通知仅清理自身记录。 */
	function afterLeave(element: Element): void {
		if (!(element instanceof HTMLElement)) return;
		const owner: number | undefined = leaving.get(element);
		leaving.delete(element);
		if (handoff?.panel === element && owner === handoff.generation) release();
	}

	/** 进入完成可先释放裁切，避免离场取消后遗留固定高度。 */
	function afterEnter(element: Element): void {
		if (!(element instanceof HTMLElement) || handoff == null || !handoff.frame.contains(element) || leaving.has(element)) return;
		if (handoff.generation === generation) release();
	}

	/** 快速切源会取消即将离场面板的进入动画，该通知不能撤销刚建立的新交接。 */
	function enterCancelled(element: Element): void {
		if (element instanceof HTMLElement && leaving.has(element)) return;
		afterEnter(element);
	}

	watch(selected, prepare, { flush: 'pre' });
	onActivated(/** 回访允许新的来源意图，旧展示任务已经释放。 */ (): void => { active = true; });
	onDeactivated(/** 失活页面不得继续写入共享滚动宿主。 */ (): void => { active = false; cancel(); });
	onBeforeUnmount(/** 卸载时只终止展示，不延长原查询生命周期。 */ (): void => { active = false; cancel(); leaving.clear(); });
	return { beforeLeave, afterLeave, afterEnter, enterCancelled, cancel };
}
