<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 首页流式时间线的业务包装。
作用：将保留内容的查询所有者注入原流式组件，并把手动刷新与页头滚动协调连接起来。
数据链：页面查询参数 → 原流式组件的接口映射 → 唯一分页所有者；刷新结果只读返回页面。
边界：不请求原始 API、不复制帖子集合，也不根据 DOM 或滚动结果判断业务更新。
-->

<template>
<TwitterTimelineLoadBoundary :pending="initializing">
	<MkStreamingNotesTimeline
		ref="timeline"
		v-bind="props"
		variant="twitter"
		:paginatorFactory="createPaginator"
	>
		<template #loading></template>
	</MkStreamingNotesTimeline>
</TwitterTimelineLoadBoundary>
</template>

<script lang="ts" setup>
import { computed, markRaw, onBeforeUnmount, onDeactivated, shallowRef, useTemplateRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import type { BasicTimelineType } from '@/timelines.js';
import type { IPaginator, PaginatorCompatibleEndpointPaths, PaginatorCompatibleEndpoints, PaginatorFactory, PaginatorOptions } from '@/utility/paginator.js';
import { TwitterTimelineLoadBoundary, TwitterTimelinePaginator } from '../index.js';
import type { TwitterTimelineRefreshController, TwitterTimelineRefreshResult } from '../index.js';

/** 首页查询的只读输入，接口与分页参数仍由既有流式组件映射。 */
type TwitterStreamingTimelineProps = {
	src: BasicTimelineType | 'list';
	list?: string;
	withRenotes?: boolean;
	withReplies?: boolean;
	withSensitive?: boolean;
	onlyFiles?: boolean;
	sound?: boolean;
};

const props: Readonly<TwitterStreamingTimelineProps> = defineProps<TwitterStreamingTimelineProps>();
const timeline: Readonly<ShallowRef<InstanceType<typeof MkStreamingNotesTimeline> | null>> = useTemplateRef('timeline');
const controller: ShallowRef<TwitterTimelineRefreshController | null> = shallowRef(null);

/** 基线已由查询所有者记录，页面此时可以回顶并释放既有新帖队列。 */
const emit = defineEmits<{
	(ev: 'refreshStarted'): void;
}>();

/** 注入点仅构造当前查询所有者，所有接口来源继续复用流式组件映射。 */
const createPaginator: PaginatorFactory = <Endpoint extends PaginatorCompatibleEndpointPaths>(
	endpoint: Endpoint,
	options: PaginatorOptions<Endpoint>,
): IPaginator<PaginatorCompatibleEndpoints[Endpoint]['res'][number]> => {
	const owner: TwitterTimelinePaginator<Endpoint> = markRaw(new TwitterTimelinePaginator(endpoint, options));
	controller.value = owner;
	return owner;
};

const refreshing: ComputedRef<boolean> = computed(
	/** 展示直接派生查询所有者的手动刷新状态，不维护本地业务副本。 */
	(): boolean => controller.value?.refreshing.value ?? false,
);
const initializing: ComputedRef<boolean> = computed(
	/** 只有初始窗口尚未就绪时禁用页头入口，分页中仍允许合并手动意图。 */
	(): boolean => controller.value?.initializing.value ?? true,
);

/** 页面显式刷新经过原公开入口，以保留广告计数等流式组件既有副作用。 */
async function refreshManually(): Promise<TwitterTimelineRefreshResult> {
	const currentTimeline: InstanceType<typeof MkStreamingNotesTimeline> | null = timeline.value;
	const currentController: TwitterTimelineRefreshController | null = controller.value;
	if (currentTimeline == null || currentController == null) return 'cancelled';
	return currentController.runManualRefresh(
		/** 组件只执行既有重载入口，实际结果与内容提交归查询所有者。 */
		(): Promise<void> => currentTimeline.reloadTimeline(),
		/** 基线登记完成后再通知页面回顶，避免队列释放污染比较基线。 */
		(): void => { emit('refreshStarted'); },
	);
}

onDeactivated(
	/** 缓存页面失活时撤销未完成手动意图，迟到响应不产生页面反馈。 */
	(): void => { controller.value?.cancelManualRefresh(); },
);
onBeforeUnmount(
	/** 来源与筛选条件通过页面 key 重建，销毁旧实例即撤销旧请求归属。 */
	(): void => { controller.value?.dispose(); },
);

defineExpose({
	refreshManually,
	refreshing,
	initializing,
});
</script>
