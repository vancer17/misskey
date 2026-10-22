<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 频道业务展示组件。
作用：将宿主已有的频道权威实体展示为帖子流上方的单行横幅卡片，处理局部加载、错误及横向浏览。
数据链角色：页面持有的频道分页结果与请求状态 → 只读频道横条；重试及继续分页意图经事件交回页面。
组件只保留滚动位置派生的临时 UI 状态，不取数、不复制频道事实，也不解释运行环境或交付探测结果。
-->

<template>
<section
	v-if="loading || error || channels.length > 0"
	:class="$style.root"
	:aria-label="label"
	data-testid="twitter-community-strip"
>
	<div v-if="loading" :class="$style.skeletons" role="status" :aria-label="i18n.ts.loading">
		<div v-for="position in 3" :key="position" :class="$style.skeleton" aria-hidden="true">
			<div :class="$style.banner"></div>
			<div :class="$style.skeletonName"></div>
		</div>
	</div>
	<div v-else-if="error" :class="$style.error" role="status">
		<span>{{ i18n.ts.somethingHappened }}</span>
		<button class="_button" :class="$style.retry" type="button" @click="requestRetry">{{ i18n.ts.retry }}</button>
	</div>
	<template v-else>
		<div ref="viewport" :class="[$style.viewport, { [$style.animated]: prefer.s.animation }]" tabindex="0" @scroll.passive="updateGeometry" @keydown="onKeydown">
			<MkA
				v-for="channel in channels"
				:key="channel.id"
				:class="$style.card"
				:to="`/channels/${channel.id}`"
				:title="channel.name"
				data-testid="twitter-community-card"
				@mouseenter="preloadTwitterChannelPage"
				@focus="preloadTwitterChannelPage"
				@pointerdown="preloadTwitterChannelPage"
			>
				<div :class="$style.banner">
					<img v-if="channel.bannerUrl" :class="$style.image" :src="channel.bannerUrl" alt="" loading="lazy" decoding="async" draggable="false">
					<i v-else class="ti ti-device-tv" :class="$style.placeholder" aria-hidden="true"></i>
				</div>
				<div :class="$style.name">{{ channel.name }}</div>
			</MkA>
			<button
				v-if="canFetchMore"
				class="_button"
				:class="$style.loadMore"
				type="button"
				:disabled="fetchingMore"
				@click="requestMore"
			>
				{{ fetchingMore ? i18n.ts.loading : i18n.ts.loadMore }}
			</button>
		</div>
		<div v-if="canScrollPrevious || canScrollNext" :class="$style.controls">
			<button
				class="_button"
				:class="$style.arrow"
				type="button"
				:aria-label="i18n.ts.goBack"
				:disabled="!canScrollPrevious"
				@click="scrollPrevious"
			>
				<i class="ti ti-chevron-left" :class="$style.previousIcon" aria-hidden="true"></i>
			</button>
			<button
				class="_button"
				:class="$style.arrow"
				type="button"
				:aria-label="i18n.ts.next"
				:disabled="!canScrollNext"
				@click="scrollNext"
			>
				<i class="ti ti-chevron-right" :class="$style.nextIcon" aria-hidden="true"></i>
			</button>
		</div>
	</template>
</section>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { preloadTwitterChannelPage } from '../routing/index.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

/** 频道横条的只读展示输入；实体与请求事实均由宿主页面拥有。 */
type CommunityStripProps = Readonly<{
	channels: readonly Misskey.entities.Channel[];
	label: string;
	loading: boolean;
	error: boolean;
	canFetchMore?: boolean;
	fetchingMore?: boolean;
}>;

/** 只提交请求意图，不在展示组件内执行分页或重试。 */
type CommunityStripEvents = {
	(event: 'retry'): void;
	(event: 'loadMore'): void;
};

/** 保持原频道实体引用，避免展示层持有业务副本。 */
const props: CommunityStripProps = withDefaults(defineProps<CommunityStripProps>(), {
	/** 宿主未传入游标时不展示继续分页入口。 */
	canFetchMore: false,
	/** 分页中的按钮状态由宿主请求生命周期提供。 */
	fetchingMore: false,
});
/** 向页面协调层转交请求意图。 */
const emit: CommunityStripEvents = defineEmits<CommunityStripEvents>();
/** 实际横向滚动容器，随加载及终态切换自动更新。 */
const viewport: Ref<HTMLElement | null> = ref(null);
/** 向逻辑起点滚动的入口是否可用，仅由 DOM 几何派生。 */
const canScrollPrevious: Ref<boolean> = ref(false);
/** 向逻辑终点滚动的入口是否可用，仅由 DOM 几何派生。 */
const canScrollNext: Ref<boolean> = ref(false);
/** 只观察当前容器尺寸，不参与设备探测或业务状态管理。 */
let resizeObserver: ResizeObserver | null = null;

/** 内容与视口变化后重新计算逻辑滚动边界，兼容浏览器的 RTL 负向 scrollLeft。 */
function updateGeometry(): void {
	const element: HTMLElement | null = viewport.value;
	if (element == null) {
		canScrollPrevious.value = false;
		canScrollNext.value = false;
		return;
	}
	const offset: number = Math.abs(element.scrollLeft);
	const maximum: number = element.scrollWidth - element.clientWidth;
	canScrollPrevious.value = offset > 1;
	canScrollNext.value = offset < maximum - 1;
}

/** 释放旧容器的观察器，防止加载切换及卸载后残留回调。 */
function disconnectObserver(): void {
	resizeObserver?.disconnect();
	resizeObserver = null;
}

/** 展示容器挂载时绑定尺寸观察；几何测量不产生业务事实。 */
function observeViewport(element: HTMLElement | null): void {
	disconnectObserver();
	if (element != null) {
		resizeObserver = new ResizeObserver(updateGeometry);
		resizeObserver.observe(element);
	}
	updateGeometry();
}

/** 按页面阅读方向移动大部分可见区域，动画遵从既有用户偏好。 */
function scrollByPage(direction: -1 | 1): void {
	const element: HTMLElement | null = viewport.value;
	if (element == null) return;
	const readingDirection: number = getComputedStyle(element).direction === 'rtl' ? -1 : 1;
	element.scrollBy({
		left: direction * readingDirection * element.clientWidth * 0.8,
		behavior: 'auto',
	});
}

/** 前一屏控件仅处理可用的临时滚动操作。 */
function scrollPrevious(): void {
	if (!canScrollPrevious.value) return;
	scrollByPage(-1);
}

/** 后一屏控件仅处理可用的临时滚动操作。 */
function scrollNext(): void {
	if (!canScrollNext.value) return;
	scrollByPage(1);
}

/** 横向方向键保持物理方向语义，不影响链接确认及原生垂直滚动。 */
function onKeydown(event: KeyboardEvent): void {
	const element: HTMLElement | null = viewport.value;
	if (element == null || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
	event.preventDefault();
	const isRtl: boolean = getComputedStyle(element).direction === 'rtl';
	const direction: -1 | 1 = (event.key === 'ArrowLeft') !== isRtl ? -1 : 1;
	scrollByPage(direction);
}

/** 加载失败后的重试交回页面，组件不自行改写错误状态。 */
function requestRetry(): void {
	if (!props.error || props.loading) return;
	emit('retry');
}

/** 继续分页交回已有分页器，处理期间不重复提交。 */
function requestMore(): void {
	if (!props.canFetchMore || props.fetchingMore) return;
	emit('loadMore');
}

watch(viewport, observeViewport, { flush: 'post' });
watch(
	/** 集合和末尾按钮变化只触发布局重测，不保存结果副本。 */
	(): readonly [number, boolean | undefined, boolean | undefined] => [props.channels.length, props.canFetchMore, props.fetchingMore],
	updateGeometry,
	{ flush: 'post' },
);
onBeforeUnmount(disconnectObserver);
</script>

<style lang="scss" module>
.root {
	position: relative;
	min-width: 0;
	border-bottom: solid 1px var(--twitter-border);
	background: var(--twitter-bg);
	color: var(--twitter-fg);
}

.viewport,
.skeletons {
	display: flex;
	flex-wrap: nowrap;
	gap: var(--twitter-space-4);
	padding: var(--twitter-space-4);
}

.viewport {
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scroll-padding-inline: var(--twitter-space-4);
	scrollbar-width: none;

	&::-webkit-scrollbar { display: none; }

	&:focus-visible {
		outline: solid 2px var(--twitter-accent);
		outline-offset: -2px;
	}
}

/* CSS 处理动态效果偏好，不把运维或设备探测引入业务组件。 */
.animated {
	scroll-behavior: smooth;
	@media (prefers-reduced-motion: reduce) { scroll-behavior: auto; }
}

.card,
.skeleton {
	flex: 0 0 var(--twitter-community-card-width);
	width: var(--twitter-community-card-width);
	min-width: 0;
	box-sizing: border-box;
	overflow: hidden;
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-community-card-radius);
	background: var(--twitter-panel);
}

.card {
	scroll-snap-align: start;
	color: var(--twitter-fg);

	&:hover {
		background: var(--twitter-hover);
		text-decoration: none;
	}

	&:focus-visible {
		outline: solid 2px var(--twitter-accent);
		outline-offset: 2px;
	}
}

.banner {
	display: grid;
	place-items: center;
	width: 100%;
	overflow: hidden;
	aspect-ratio: var(--twitter-community-banner-ratio);
	background: var(--twitter-skeleton-block);
}

.image {
	display: block;
	width: 100%;
	height: 100%;
	min-height: 0;
	object-fit: cover;
}

.placeholder {
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-heading);
}

.name {
	overflow: hidden;
	padding: var(--twitter-space-2);
	font-size: var(--twitter-font-size-meta);
	font-weight: 700;
	line-height: var(--twitter-community-name-line-height);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.controls {
	position: absolute;
	inset-inline: var(--twitter-space-1);
	top: 50%;
	display: flex;
	justify-content: space-between;
	pointer-events: none;
	transform: translateY(-50%);
	opacity: 0;
	transition: opacity var(--twitter-duration-fast) ease;

	.root:hover &,
	.root:focus-within & { opacity: 1; }
}

.arrow {
	display: grid;
	place-items: center;
	width: var(--twitter-touch-target);
	height: var(--twitter-touch-target);
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-panel);
	color: var(--twitter-fg);
	pointer-events: auto;

	&:disabled {
		visibility: hidden;
	}

	&:hover {
		background: var(--twitter-hover);
	}

	&:focus-visible {
		outline: solid 2px var(--twitter-accent);
		outline-offset: 2px;
	}
}

.previousIcon:dir(rtl),
.nextIcon:dir(rtl) {
	transform: rotate(180deg);
}

.error {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
}

.retry,
.loadMore {
	min-height: var(--twitter-touch-target);
	padding: var(--twitter-space-2) var(--twitter-space-3);
	color: var(--twitter-accent);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;

	&:focus-visible {
		outline: solid 2px var(--twitter-accent);
		outline-offset: -2px;
	}
}

.loadMore {
	flex: 0 0 auto;
	align-self: center;
	border-radius: var(--twitter-radius-pill);
	white-space: nowrap;
	scroll-snap-align: end;

	&:hover {
		background: var(--twitter-hover);
	}
}

.skeletons {
	overflow: hidden;
}

.skeletonName {
	height: var(--twitter-space-3);
	margin: var(--twitter-space-3) var(--twitter-space-2);
	border-radius: var(--twitter-radius-small);
	background: var(--twitter-skeleton-block);
}
</style>
