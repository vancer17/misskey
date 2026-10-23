/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter Shell 滚动协调：一个原生主视口，多条路由各自持有有限的 UI 位置记录。
 * 数据链：有效主路由 → 当前内容几何 → 位置/锚点 → 回访恢复；不保存业务实体或环境探测。
 * 独立页面窗口和真实存量 StackingRouterView 不接管主视口，继续使用原位置保存器。
 */
import { inject, nextTick, onBeforeUnmount, provide, watch } from 'vue';
import type { ComputedRef, InjectionKey, Ref } from 'vue';
import { prefersReducedMotion } from '@@/js/config.js';
import { scrollInContainer } from '@@/js/scroll.js';
import { useRouter } from '@/router.js';
import type { Router } from '@/router.js';
import type { PathResolvedResult } from '@/lib/nirax.js';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';

/** 纯展示位置，锚点只保存 DOM 标识和相对距离，不包含帖子或用户模型。 */
type ScrollPosition = Readonly<{
	top: number;
	anchor: string | null;
	offset: number;
}>;

/** 当前 Shell 的注入上下文；只读宿主引用，不暴露位置表或路由写入能力。 */
type TwitterScrollContext = Readonly<{
	router: Router;
	enabled: ComputedRef<boolean>;
	resetForSource: (root: HTMLElement) => boolean;
}>;

/** 只属于 Twitter 模块的布局注入标识，不污染共享组件 DI。 */
const scrollContextKey: InjectionKey<TwitterScrollContext> = Symbol('twitter-scroll-host');
/** UI 位置表有界，浏览多用户时不无限保留历史；不持久化。 */
const MAX_SCROLL_POSITIONS: number = 50;
/** 真实独立窗口的既有 keeper 提供可取消操作；弱引用不额外持有缓存页面。 */
const fallbackRestoreCancels: WeakMap<object, () => void> = new WeakMap<object, () => void>();

/** 从既有导航地址派生位置键；ui 是入口风格参数，不区分同一页面的位置。 */
function positionKey(fullPath: string): string {
	const url: URL = new URL(fullPath, window.location.origin);
	url.searchParams.delete('ui');
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * 为主 Shell 建立滚动恢复和背景交互边界。
 * 路由同步阶段采集旧几何，DOM 提交后恢复新页面；延迟内容变化由元素观察驱动，不轮询 readiness。
 */
export function provideTwitterScrollHost(
	viewport: Ref<HTMLElement | null>,
	content: Ref<HTMLElement | null>,
	shell: Ref<HTMLElement | null>,
	router: Router,
	enabled: ComputedRef<boolean>,
): void {
	provide(scrollContextKey, { router, enabled, resetForSource });
	const positions: Map<string, ScrollPosition> = new Map();
	let currentKey: string = positionKey(router.getCurrentFullPath());
	let restoring: ScrollPosition | null = null;
	let frame: number | null = null;
	let disposed: boolean = false;
	let navigating: boolean = false;

	/** 用户明确接管滚动后不再由迟到的图片/列表恢复任务移动页面。 */
	function cancelRestore(): void {
		restoring = null;
		if (frame != null) cancelAnimationFrame(frame);
		frame = null;
		viewport.value?.style.removeProperty('overflow-anchor');
	}

	/** 当前活动内容切换来源时，先撤销旧路由恢复再立即回顶，不向消费者暴露宿主或位置表。 */
	function resetForSource(root: HTMLElement): boolean {
		const host: HTMLElement | null = viewport.value;
		if (disposed || !enabled.value || host == null || !root.isConnected || !content.value?.contains(root) || root.getClientRects().length === 0) return false;
		cancelRestore();
		host.scrollTo({ top: 0, behavior: 'instant' });
		return true;
	}

	/** 在旧页面仍处于文档内时采集；优先保留当前可见列表锚点。 */
	function capture(): ScrollPosition | null {
		const host: HTMLElement | null = viewport.value;
		const page: HTMLElement | null = content.value;
		if (host == null || page == null || !enabled.value) return null;
		const bounds: DOMRect = host.getBoundingClientRect();
		let anchor: string | null = null;
		let offset: number = 0;
		for (const item of page.querySelectorAll<HTMLElement>('[data-scroll-anchor]')) {
			// 离场 DOM 仅供绘制，不能反向成为新来源的路由恢复锚点。
			if (item.closest('[data-twitter-timeline-leaving]') != null) continue;
			const rect: DOMRect = item.getBoundingClientRect();
			if (rect.height === 0 || rect.bottom <= bounds.top || rect.top > bounds.top + host.clientHeight / 2) continue;
			anchor = item.dataset.scrollAnchor ?? null;
			offset = rect.top - bounds.top;
		}
		return { top: host.scrollTop, anchor, offset };
	}

	/** 仅应用仍属于当前导航的恢复；高度不足时等待后续内容尺寸变化。 */
	function restore(): void {
		frame = null;
		const host: HTMLElement | null = viewport.value;
		const page: HTMLElement | null = content.value;
		if (disposed || !enabled.value || host == null || page == null || restoring == null || navigating) return;
		const item: HTMLElement | null = restoring.anchor == null ? null
			: page.querySelector<HTMLElement>(`[data-scroll-anchor="${CSS.escape(restoring.anchor)}"]`);
		const target: number = item != null && item.getBoundingClientRect().height > 0
			? host.scrollTop + item.getBoundingClientRect().top - host.getBoundingClientRect().top - restoring.offset
			: restoring.top;
		host.style.overflowAnchor = 'none';
		host.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
	}

	/** 合并同一帧的内容与尺寸变化，不用固定延迟猜测接口或图片完成。 */
	function scheduleRestore(): void {
		if (!disposed && restoring != null && frame == null) frame = requestAnimationFrame(restore);
	}

	watch(router.currentRef,
		/** 同地址通知保留位置与待恢复任务；实际导航在 Vue 替换旧子树前保存旧几何。 */
		async (route: PathResolvedResult, previousRoute: PathResolvedResult): Promise<void> => {
			if (route._parsedRoute.fullPath === previousRoute._parsedRoute.fullPath) return;
			const nextKey: string = positionKey(router.getCurrentFullPath());
			if (nextKey === currentKey) {
				// 入口的 ?ui 参数被普通导航去除时，仍是当前页重选，不继承旧位置。
				cancelRestore();
				if (enabled.value) viewport.value?.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'instant' : 'smooth' });
				return;
			}
			const previous: ScrollPosition | null = restoring ?? capture();
			if (previous != null) {
				positions.delete(currentKey);
				positions.set(currentKey, previous);
				if (positions.size > MAX_SCROLL_POSITIONS) {
					const oldest: string | undefined = positions.keys().next().value;
					if (oldest != null) positions.delete(oldest);
				}
			}
			cancelRestore();
			currentKey = nextKey;
			navigating = true;
			restoring = positions.get(nextKey) ?? null;
			await nextTick();
			if (disposed || currentKey !== nextKey) return;
			navigating = false;
			if (!enabled.value) return;
			if (restoring == null) viewport.value?.scrollTo({ top: 0, behavior: 'instant' });
			else scheduleRestore();
		},
		{ flush: 'sync' },
	);

	router.useListener('same',
		/** 主导航重选只由活动 Shell 回顶，停用的页面壳不争抢宿主。 */
		(): void => {
			if (!enabled.value) return;
			cancelRestore();
			viewport.value?.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'instant' : 'smooth' });
		},
	);

	watch(viewport,
		/** 原生滚动仍交给浏览器；仅在真实用户输入时撤销待恢复位置。 */
		(host: HTMLElement | null, _old: HTMLElement | null, cleanup: (fn: () => void) => void): void => {
			if (host == null) return;
			const controller: AbortController = new AbortController();
			for (const event of ['wheel', 'touchstart', 'pointerdown']) host.addEventListener(event, cancelRestore, { passive: true, signal: controller.signal });
			host.addEventListener('keydown',
				/** 导航键、输入与焦点移动表示用户已接管页面位置。 */
				(): void => { cancelRestore(); },
				{ signal: controller.signal },
			);
			cleanup(/** 更换视口或卸载时移除原生监听。 */ (): void => { controller.abort(); });
		},
		{ flush: 'post' },
	);

	watch(content,
		/** 对当前内容树观察异步插入和高度，不读取或复制业务加载状态。 */
		(page: HTMLElement | null, _old: HTMLElement | null, cleanup: (fn: () => void) => void): void => {
			if (page == null) return;
			const resize: ResizeObserver = new ResizeObserver(scheduleRestore);
			const mutation: MutationObserver = new MutationObserver(scheduleRestore);
			resize.observe(page);
			mutation.observe(page, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
			cleanup(/** 页面出口销毁后不保留 DOM 观察器。 */ (): void => { resize.disconnect(); mutation.disconnect(); });
		},
		{ flush: 'post' },
	);

	watch(shell,
		/** 利用已有模态背景的呈现状态锁定背景交互，悬浮提示不带模态背景因此不锁定。 */
		(root: HTMLElement | null, _old: HTMLElement | null, cleanup: (fn: () => void) => void): void => {
			if (root == null) return;
			const modalRoot: HTMLElement = root;

			/** inert 不改变 overflow，弹层期间新挂载的滚动消费者仍能发现同一个宿主。 */
			function syncModalLock(): void {
				const host: HTMLElement | null = viewport.value;
				if (host == null) return;
				host.inert = Array.from(modalRoot.querySelectorAll<HTMLElement>('._modalBg')).some(
					/** 仅在视口外且实际显示的背景代表模态交互边界。 */
					(background: HTMLElement): boolean => !host.contains(background) && background.getClientRects().length > 0
						&& background.parentElement?.style.pointerEvents !== 'none',
				);
			}

			const observer: MutationObserver = new MutationObserver(
				/** 内容内部样式变化不需要重新扫描弹层。 */
				(records: MutationRecord[]): void => {
					if (records.some(/** 排除主视口内的普通内容变化。 */ (record: MutationRecord): boolean => !viewport.value?.contains(record.target))) syncModalLock();
				},
			);
			observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
			syncModalLock();
			cleanup(/** Shell 卸载或切换后撤销本模块的背景约束。 */ (): void => { observer.disconnect(); if (viewport.value) viewport.value.inert = false; });
		},
		{ flush: 'post' },
	);

	onBeforeUnmount(
		/** 主宿主销毁后取消下一帧任务与位置表，绝不跨 UI 保留滚动副作用。 */
		(): void => { disposed = true; cancelRestore(); positions.clear(); },
	);
}

/**
 * Twitter 页面壳在主出口中由 Shell 统一恢复；独立页面窗口、样本及叠层保持原位置保存器。
 * 不把多个 KeepAlive 页面的原 keeper 都接到同一个 scrollTop 上。
 */
export function useTwitterScrollPositionKeeper(root: Ref<HTMLElement | null | undefined>): void {
	const context: TwitterScrollContext | null = inject(scrollContextKey, null);
	const router: Router = useRouter();
	if (context == null || context.router !== router || !context.enabled.value) {
		fallbackRestoreCancels.set(root, useScrollPositionKeeper(root).cancelPendingRestore);
	}
}

/**
 * 为来源切换提供原子的 UI 回顶操作；主出口取消恢复，真实独立窗口继续使用自己的滚动宿主。
 * 返回值仅表示当前活动 DOM 是否接纳操作，不参与业务决策。
 */
export function useTwitterSourceScrollReset(root: Readonly<Ref<HTMLElement | null | undefined>>): () => boolean {
	const context: TwitterScrollContext | null = inject(scrollContextKey, null);
	const router: Router = useRouter();
	return /** 只允许当前仍在文档中的页面改变所属宿主。 */ (): boolean => {
		const element: HTMLElement | null | undefined = root.value;
		if (element == null || !element.isConnected || element.getClientRects().length === 0) return false;
		if (context != null && context.router === router && context.enabled.value) return context.resetForSource(element);
		fallbackRestoreCancels.get(root)?.();
		scrollInContainer(element, { top: 0, behavior: 'instant' });
		return true;
	};
}
