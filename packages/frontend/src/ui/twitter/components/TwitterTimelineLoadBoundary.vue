<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 首页时间线的纯展示加载交接。
作用：对初始加载反馈做延显，并在骨架和真实结果之间连续改变透明度，避免快请求的骨架闪现。
数据链：查询所有者派生的 pending → 局部骨架可见性 → 展示交接；真实列表始终挂载并立即请求。
边界：不保存帖子、错误或空态，不延迟请求，不规定最短加载时长，也不等待横移结束提交结果。
-->

<template>
<div
	:class="[$style.root, { [$style.pending]: pending, [$style.animated]: prefer.s.animation }]"
	:aria-busy="pending"
	:data-pending="pending"
	data-twitter-timeline-load-boundary
	data-testid="twitter-timeline-load-boundary"
>
	<div
		:class="[$style.content, { [$style.contentVisible]: !pending }]"
		:inert="pending"
		:aria-hidden="pending"
		data-twitter-timeline-content
		data-testid="twitter-timeline-content"
	>
		<slot></slot>
	</div>
	<div
		:class="[$style.skeleton, { [$style.skeletonVisible]: skeletonVisible }]"
		:aria-hidden="!skeletonVisible"
		data-twitter-timeline-skeleton
		data-testid="twitter-timeline-loading-overlay"
	>
		<TwitterPageSkeleton variant="timeline"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { TWITTER_MOTION_DURATIONS } from '../context/index.js';
import TwitterPageSkeleton from './TwitterPageSkeleton.vue';
import { prefer } from '@/preferences.js';

/** 业务加载事实只由外部输入，本组件不另建查询或结果状态。 */
type TimelineLoadBoundaryProps = Readonly<{
	pending: boolean;
}>;

/** 读取真实查询所有者派生的初始加载标记。 */
const props: TimelineLoadBoundaryProps = defineProps<TimelineLoadBoundaryProps>();
/** 唯一局部可变状态仅决定反馈是否已超过延显阈值。 */
const skeletonVisible: Ref<boolean> = ref(false);
/** 延显任务属于当前挂载／激活周期，停止后不得更新缓存页面。 */
let skeletonTimer: number | null = null;
/** 防止 mounted 与 activated 在首次进入时重复启动同一任务。 */
let active: boolean = false;

/** 结束旧延显任务；不取消或推迟真实列表的请求。 */
function clearSkeletonTimer(): void {
	if (skeletonTimer == null) return;
	window.clearTimeout(skeletonTimer);
	skeletonTimer = null;
}

/** 反馈延显只影响骨架透明度，快响应直接取消待显示任务。 */
function syncPending(): void {
	clearSkeletonTimer();
	skeletonVisible.value = false;
	if (!active || !props.pending) return;
	skeletonTimer = window.setTimeout(
		/** 当前加载仍未结束时开始淡入，不强制最短停留时间。 */
		(): void => {
			skeletonTimer = null;
			if (active && props.pending) skeletonVisible.value = true;
		},
		TWITTER_MOTION_DURATIONS.fast,
	);
}

/** 激活时根据当前权威输入重新建立展示周期，不复用旧计时器。 */
function start(): void {
	if (active) return;
	active = true;
	syncPending();
}

/** 缓存停用和卸载共享清理入口，旧任务不能影响回访或新查询。 */
function stop(): void {
	active = false;
	clearSkeletonTimer();
	skeletonVisible.value = false;
}

watch(
	/** 加载事实只读投影，不从列表 DOM 推断请求是否完成。 */
	(): boolean => props.pending,
	syncPending,
	{ flush: 'sync' },
);
onMounted(start);
onActivated(start);
onDeactivated(stop);
onBeforeUnmount(stop);
</script>

<style lang="scss" module>
.root {
	position: relative;
	background: var(--twitter-bg);
}

.pending {
	min-height: var(--twitter-timeline-loading-min-height, calc(100dvh - var(--MI-stickyTop, 0px)));
}

.content {
	opacity: 0;

	&.contentVisible {
		opacity: 1;
	}
}

.skeleton {
	position: absolute;
	inset: 0;
	overflow: hidden;
	background: var(--twitter-bg);
	opacity: 0;
	pointer-events: none;

	&.skeletonVisible {
		opacity: 1;
	}
}

.animated .content,
.animated .skeleton {
	transition: opacity var(--twitter-duration-fast) var(--twitter-ease);
}

.root:not(.animated) .skeleton * {
	animation: none;
}

@media (prefers-reduced-motion: reduce) {
	.animated .content,
	.animated .skeleton {
		transition: none;
	}
}
</style>
