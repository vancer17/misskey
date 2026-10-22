/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 发帖表单的工具栏展示协调。
 * 作用：从表单与工具轨道的实际尺寸派生极窄布局和滚动导航，保持所有原始工具可达。
 * 数据链：宿主 DOM 几何 → 只读临时 UI 状态 → 工具栏导航；不读取或修改发帖业务事实。
 */
import { onScopeDispose, readonly, ref, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { TWITTER_LAYOUT_BREAKPOINTS } from '../domain/layout.js';

/** 为当前 Twitter 表单建立局部尺寸观察及键盘导航，默认界面不安装观察器。 */
export function useTwitterComposerToolbar(
	enabled: Readonly<Ref<boolean>>,
	form: Readonly<ShallowRef<HTMLElement | null>>,
	viewport: Readonly<ShallowRef<HTMLElement | null>>,
	track: Readonly<ShallowRef<HTMLElement | null>>,
	previousButton: Readonly<ShallowRef<HTMLButtonElement | null>>,
	nextButton: Readonly<ShallowRef<HTMLButtonElement | null>>,
): {
	isVeryNarrow: Readonly<Ref<boolean>>;
	canScrollPrevious: Readonly<Ref<boolean>>;
	canScrollNext: Readonly<Ref<boolean>>;
	updateGeometry: () => void;
	scrollPrevious: () => void;
	scrollNext: () => void;
	onFocusin: (event: FocusEvent) => void;
	onKeydown: (event: KeyboardEvent) => void;
} {
	/** 极窄模式只由表单容器宽度派生，不与视口或设备类型混用。 */
	const isVeryNarrow: Ref<boolean> = ref(false);
	/** 逻辑起点前仍有工具时允许向前浏览。 */
	const canScrollPrevious: Ref<boolean> = ref(false);
	/** 逻辑终点后仍有工具时允许向后浏览。 */
	const canScrollNext: Ref<boolean> = ref(false);
	/** 观察当前表单和工具轨道，随组件生命周期释放。 */
	let observer: ResizeObserver | null = null;

	/** 同步局部几何，容忍滚动位置的亚像素舍入。 */
	function updateGeometry(): void {
		const element: HTMLElement | null = viewport.value;
		isVeryNarrow.value = enabled.value && form.value != null && form.value.clientWidth < TWITTER_LAYOUT_BREAKPOINTS.composerNarrow;
		if (!enabled.value || element == null) {
			canScrollPrevious.value = false;
			canScrollNext.value = false;
			return;
		}
		const offset: number = Math.abs(element.scrollLeft);
		const maximum: number = element.scrollWidth - element.clientWidth;
		const previous: boolean = offset > 1;
		const next: boolean = offset < maximum - 1;
		if (canScrollPrevious.value && !previous && window.document.activeElement === previousButton.value) focusBoundary(false);
		if (canScrollNext.value && !next && window.document.activeElement === nextButton.value) focusBoundary(true);
		canScrollPrevious.value = previous;
		canScrollNext.value = next;
	}

	/** 导航箭头即将隐藏时交接给实际工具，防止键盘焦点回落到页面根节点。 */
	function focusBoundary(atEnd: boolean): void {
		const buttons: NodeListOf<HTMLButtonElement> | undefined = track.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
		const target: HTMLButtonElement | undefined = buttons?.[atEnd ? buttons.length - 1 : 0];
		target?.focus({ preventScroll: true });
	}

	/** 释放旧节点的观察，防止界面变体切换后继续回调。 */
	function disconnect(): void {
		observer?.disconnect();
		observer = null;
	}

	/** 工具增减和容器变宽均由实际轨道尺寸触发，无需维护业务按钮副本。 */
	function observe(): void {
		disconnect();
		if (enabled.value && form.value != null && viewport.value != null && track.value != null) {
			observer = new ResizeObserver(updateGeometry);
			observer.observe(form.value);
			observer.observe(viewport.value);
			observer.observe(track.value);
		}
		updateGeometry();
	}

	/** 按阅读方向浏览一段可见工具；动画由 CSS 用户偏好控制。 */
	function scrollByPage(direction: -1 | 1): void {
		const element: HTMLElement | null = viewport.value;
		if (element == null) return;
		const readingDirection: number = getComputedStyle(element).direction === 'rtl' ? -1 : 1;
		element.scrollBy({ left: direction * readingDirection * element.clientWidth * 0.8, behavior: 'auto' });
	}

	/** 向前导航只改变滚动位置，不触发任何发帖动作。 */
	function scrollPrevious(): void {
		if (canScrollPrevious.value) scrollByPage(-1);
	}

	/** 向后导航保持原工具按钮的真实事件锚点。 */
	function scrollNext(): void {
		if (canScrollNext.value) scrollByPage(1);
	}

	/** Tab 或方向键聚焦工具后，将目标及其焦点留白滚入局部可见区域。 */
	function onFocusin(event: FocusEvent): void {
		const target: EventTarget | null = event.target;
		if (target instanceof HTMLElement && track.value?.contains(target)) {
			target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
		}
	}

	/** 方向键仅在工具栏内移动焦点，不截获正文输入或弹层键盘行为。 */
	function onKeydown(event: KeyboardEvent): void {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		const target: EventTarget | null = event.target;
		const element: HTMLElement | null = viewport.value;
		if (!(target instanceof HTMLElement) || element == null || track.value == null) return;
		const buttons: HTMLButtonElement[] = Array.from(track.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
		const current: HTMLButtonElement | null = target.closest('button');
		const index: number = current == null ? -1 : buttons.indexOf(current);
		if (index < 0) return;
		const isRtl: boolean = getComputedStyle(element).direction === 'rtl';
		const step: number = (event.key === 'ArrowLeft') !== isRtl ? -1 : 1;
		const nextIndex: number = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + step;
		const next: HTMLButtonElement | undefined = buttons[nextIndex];
		event.preventDefault();
		next?.focus({ preventScroll: true });
	}

	watch(
		/** 只跟踪界面启用与实际节点替换，不订阅可见性或发布内容。 */
		(): readonly [boolean, HTMLElement | null, HTMLElement | null, HTMLElement | null] => [enabled.value, form.value, viewport.value, track.value],
		observe,
		{ immediate: true, flush: 'post' },
	);
	onScopeDispose(disconnect);

	return { isVeryNarrow: readonly(isVeryNarrow), canScrollPrevious: readonly(canScrollPrevious), canScrollNext: readonly(canScrollNext), updateGeometry, scrollPrevious, scrollNext, onFocusin, onKeydown };
}
