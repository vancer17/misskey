<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 标签栏的纯展示动效。
作用：在既有标签容器内绘制唯一指示条，根据当前标签的实际几何连续横移。
数据链：宿主的只读选中标识 → DOM 标签锚点 → 临时位置与宽度；不保存业务状态、触发查询或改变导航。
宿主保留自身布局与语义，并提供 data-twitter-tab-key 及局部内缩 CSS 变量；指示条统一仅圆上角。
-->

<template>
<span
	ref="indicator"
	:class="[$style.indicator, { [$style.animated]: prefer.s.animation }]"
	aria-hidden="true"
	data-testid="twitter-tab-indicator"
></span>
</template>

<script lang="ts" setup>
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, useTemplateRef, watch } from 'vue';
import type { ShallowRef } from 'vue';
import { prefersReducedMotion } from '@@/js/config.js';
import { prefer } from '@/preferences.js';

/** 宿主选中值的只读展示投影，不另建标签类型或选中状态副本。 */
type TabIndicatorProps = Readonly<{
	activeKey: string | null;
}>;

/** 仅消费选中标识，标签定义与所有操作继续归宿主所有。 */
const props: TabIndicatorProps = defineProps<TabIndicatorProps>();
/** 唯一绘制元素，其直接父元素是既有定位／滚动容器。 */
const indicator: Readonly<ShallowRef<HTMLSpanElement | null>> = useTemplateRef<HTMLSpanElement>('indicator');
/** 当前活动容器，仅用于所属页面的局部几何观察。 */
let container: HTMLElement | null = null;
/** 已观察的标签节点，用于识别结构变化而非复制标签业务定义。 */
let observedTabs: HTMLElement[] = [];
/** 容器及标签的尺寸观察器，不观察指示条自身以避免尺寸反馈循环。 */
let resizeObserver: ResizeObserver | null = null;
/** 标签节点替换和文案更新的局部观察器。 */
let mutationObserver: MutationObserver | null = null;
/** 同一帧只安排一次读写，后续切换使用最新输入。 */
let frame: number | null = null;
/** 待执行任务是否允许动画；任何布局失效都优先要求静态校准。 */
let pendingMotion: boolean | null = null;
/** 有效起点只在当前挂载／激活周期内成立。 */
let measured: boolean = false;
/** 缓存停用后不再读写所属页面的 DOM。 */
let active: boolean = false;

/** 收集同一容器的直接标签节点，不依赖 CSS Modules 类名或业务实体。 */
function getTabs(): HTMLElement[] {
	return Array.from(container?.children ?? []).filter(
		/** 只读取宿主明确声明的展示锚点，排除指示条自身。 */
		(element: Element): element is HTMLElement => element instanceof HTMLElement && element.hasAttribute('data-twitter-tab-key'),
	);
}

/** 结构改变时重新绑定尺寸观察，并令当前定位使用无动画校准。 */
function syncObservedTabs(tabs: HTMLElement[]): boolean {
	const changed: boolean = tabs.length !== observedTabs.length || tabs.some(
		/** 节点身份改变意味着旧几何不再对应同一排标签。 */
		(tab: HTMLElement, index: number): boolean => tab !== observedTabs[index],
	);
	if (!changed) return false;
	for (const tab of observedTabs) resizeObserver?.unobserve(tab);
	observedTabs = tabs;
	for (const tab of observedTabs) resizeObserver?.observe(tab);
	return true;
}

/** 仅在标签超出横向视口时滚动该标签栏，不接管 Shell 的纵向滚动。 */
function revealTab(tabRect: DOMRect, containerRect: DOMRect, allowMotion: boolean): void {
	if (container == null || container.scrollWidth <= container.clientWidth) return;
	// 快速切回仍可见的标签时也取消旧目标，避免旧平滑滚动随后将新选中项移出视口。
	container.scrollTo({ left: container.scrollLeft, behavior: 'instant' });
	const left: number = containerRect.left + container.clientLeft;
	const right: number = left + container.clientWidth;
	const delta: number = tabRect.left < left ? tabRect.left - left : tabRect.right > right ? tabRect.right - right : 0;
	if (delta === 0) return;
	container.scrollBy({ left: delta, behavior: allowMotion && prefer.s.animation && !prefersReducedMotion ? 'smooth' : 'instant' });
}

/** 测量最新选中锚点并一次性提交几何；结构或尺寸失效时不从旧位置飞入。 */
function renderIndicator(allowMotion: boolean): void {
	const element: HTMLSpanElement | null = indicator.value;
	if (!active || element == null || container == null || !container.isConnected) return;
	const tabs: HTMLElement[] = getTabs();
	const structureChanged: boolean = syncObservedTabs(tabs);
	const selected: HTMLElement | undefined = tabs.find(
		/** 原始 key 只用于 DOM 匹配，不解析其业务含义。 */
		(tab: HTMLElement): boolean => tab.dataset.twitterTabKey === props.activeKey,
	);
	const containerRect: DOMRect = container.getBoundingClientRect();
	if (selected == null || containerRect.width === 0 || containerRect.height === 0) {
		element.style.visibility = 'hidden';
		measured = false;
		return;
	}
	const tabRect: DOMRect = selected.getBoundingClientRect();
	if (tabRect.width === 0 || tabRect.height === 0) {
		element.style.visibility = 'hidden';
		measured = false;
		return;
	}
	const inset: number = Number.parseFloat(getComputedStyle(element).getPropertyValue('--twitter-tab-indicator-inset'));
	const x: number = tabRect.left - containerRect.left - container.clientLeft + container.scrollLeft + inset;
	const width: number = Math.max(0, tabRect.width - inset * 2);
	const animate: boolean = allowMotion && measured && !structureChanged;
	const reveal: boolean = allowMotion || !measured || structureChanged;
	element.toggleAttribute('data-snap', !animate);
	element.style.transform = `translateX(${x}px)`;
	element.style.width = `${width}px`;
	element.style.visibility = 'visible';
	measured = true;
	if (reveal) revealTab(tabRect, containerRect, animate);
}

/** 合并同帧任务；布局失效的静态校准优先于选中切换的动画请求。 */
function scheduleRender(allowMotion: boolean): void {
	if (!active) return;
	pendingMotion = pendingMotion == null ? allowMotion : pendingMotion && allowMotion;
	if (frame != null) return;
	frame = requestAnimationFrame(
		/** DOM 已提交后测量，连续切换只消费本帧最新选中值。 */
		(): void => {
			frame = null;
			const animate: boolean = pendingMotion === true;
			pendingMotion = null;
			renderIndicator(animate);
		},
	);
}

/** 布局、字体或标签结构变更只更新展示坐标，不播放导航转场。 */
function onGeometryChanged(): void { scheduleRender(false); }

/** 挂载与缓存激活共用同一观察生命周期，首个位置直接落在当前标签。 */
function start(): void {
	if (active) return;
	container = indicator.value?.parentElement ?? null;
	if (container == null) return;
	active = true;
	resizeObserver = new ResizeObserver(onGeometryChanged);
	resizeObserver.observe(container);
	mutationObserver = new MutationObserver(onGeometryChanged);
	mutationObserver.observe(container, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: ['data-twitter-tab-key'],
	});
	window.document.fonts.addEventListener('loadingdone', onGeometryChanged);
	void window.document.fonts.ready.then(onGeometryChanged);
	scheduleRender(false);
}

/** 停用或卸载时释放全部局部观察与待绘制任务，缓存回访重新建立有效起点。 */
function stop(): void {
	active = false;
	resizeObserver?.disconnect();
	resizeObserver = null;
	mutationObserver?.disconnect();
	mutationObserver = null;
	window.document.fonts.removeEventListener('loadingdone', onGeometryChanged);
	if (frame != null) cancelAnimationFrame(frame);
	frame = null;
	pendingMotion = null;
	observedTabs = [];
	container = null;
	measured = false;
	if (indicator.value != null) indicator.value.style.visibility = 'hidden';
}

watch(
	/** DOM 更新后的选中值是动画的唯一输入，不在点击处理器中抢先推断。 */
	(): string | null => props.activeKey,
	/** 已有有效几何时平滑转向最新标签。 */
	(): void => { scheduleRender(true); },
	{ flush: 'post' },
);
onMounted(start);
onActivated(start);
onDeactivated(stop);
onBeforeUnmount(stop);
</script>

<style lang="scss" module>
.indicator {
	position: absolute;
	left: 0;
	bottom: 0;
	width: 0;
	height: 4px;
	border-radius: var(--twitter-radius-pill) var(--twitter-radius-pill) 0 0;
	background: var(--twitter-accent);
	visibility: hidden;
	pointer-events: none;

	&.animated:not([data-snap]) {
		transition:
			transform var(--twitter-duration-normal) var(--twitter-ease),
			width var(--twitter-duration-normal) var(--twitter-ease);
	}
}

@media (prefers-reduced-motion: reduce) {
	.indicator.animated:not([data-snap]) { transition: none; }
}
</style>
