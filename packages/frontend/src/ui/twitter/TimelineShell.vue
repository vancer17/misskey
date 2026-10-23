<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 时间线页面壳。
作用：保留原时间线交互与吸顶头，主出口的位置恢复委托 Shell；独立窗口沿用既有容器。
数据链：当前页面 DOM → 滚动宿主与锚点；不读写帖子事实。
-->

<template>
<div ref="rootEl" class="_pageScrollable" :class="$style.root" data-testid="twitter-timeline">
	<MkStickyContainer>
		<template #header>
			<TwitterTimelineHeader
				v-model:tab="tabModel"
				:tabs="tabs"
				:actions="actions"
				:displayMyAvatar="displayMyAvatar"
				:showRefresh="showRefresh"
				:refreshing="refreshing"
				:refreshDisabled="refreshDisabled"
				@tabReselected="scrollToTop"
				@refresh="emit('refresh')"
			/>
		</template>

		<MkSwiper
			v-if="swipable && tabs.length > 1"
			ref="bodySwiper"
			v-model:tab="tabModel"
			:animationEnabled="bodyAnimationEnabled"
			:class="$style.body"
			:tabs="tabs"
			@beforeLeave="bodyTransition.beforeLeave"
			@afterLeave="bodyTransition.afterLeave"
			@leaveCancelled="bodyTransition.afterLeave"
			@afterEnter="bodyTransition.afterEnter"
			@enterCancelled="bodyTransition.enterCancelled"
		>
			<slot></slot>
		</MkSwiper>
		<div v-else :class="$style.body">
			<slot></slot>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import type { ComputedRef, ModelRef, ShallowRef } from 'vue';
import { prefersReducedMotion } from '@@/js/config.js';
import { scrollInContainer } from '@@/js/scroll.js';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import MkSwiper from '@/components/MkSwiper.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import { useTwitterScrollPositionKeeper } from '@/ui/twitter/composables/use-twitter-scroll-host.js';
import { useRouter } from '@/router.js';
import { prefer } from '@/preferences.js';
import TwitterTimelineHeader from './TimelineHeader.vue';
import { useTwitterTimelineTransition } from './composables/use-twitter-timeline-transition.js';

/** 页面壳转交页头的展示参数，不复制查询状态或刷新结果。 */
type TimelineShellProps = {
	tabs: Tab[];
	actions?: PageHeaderItem[];
	swipable?: boolean;
	displayMyAvatar?: boolean;
	showRefresh?: boolean;
	refreshing?: boolean;
	refreshDisabled?: boolean;
};

withDefaults(defineProps<TimelineShellProps>(), {
	/** 未指定操作时保留空页头操作集合。 */
	actions: (): PageHeaderItem[] => [],
	swipable: true,
	displayMyAvatar: false,
	showRefresh: false,
	refreshing: false,
	refreshDisabled: false,
});

/** 刷新仅作为用户意图转交页面，由页面协调查询与滚动。 */
const emit = defineEmits<{
	(ev: 'refresh'): void;
}>();

/** 页头与原查询所有者共用的来源标识，不建立正文选中副本。 */
const tabModel: ModelRef<string | undefined> = defineModel<string>('tab');
/** 只测量当前页面 DOM，不接管其他缓存页的滚动。 */
const rootEl: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('rootEl');
/** 只访问基础转场公开的离场结算，不操作 Vue 内部状态或直接删除节点。 */
const bodySwiper: Readonly<ShallowRef<InstanceType<typeof MkSwiper> | null>> = useTemplateRef<InstanceType<typeof MkSwiper>>('bodySwiper');
/** 点击动画独立于手势设置，遵循现有动画偏好。 */
const bodyAnimationEnabled: ComputedRef<boolean> = computed(/** 关闭动画或减少动态效果时直接交接。 */ (): boolean => prefer.s.animation && !prefersReducedMotion);
/** 几何交接不保存列表或请求状态，正文横移仍只有 MkSwiper 一个所有者。 */
const bodyTransition: ReturnType<typeof useTwitterTimelineTransition> = useTwitterTimelineTransition(rootEl, tabModel, bodyAnimationEnabled, settleLeaving);

/** 下一轮来源提交前由原转场所有者结束旧离场，最多保留一旧一新两个面板。 */
function settleLeaving(): void {
	bodySwiper.value?.finishLeaving();
}

useTwitterScrollPositionKeeper(rootEl);

const router = useRouter();

router.useListener('same',
	/** 仅仍挂载在活动文档中的时间线响应重选。 */
	(): void => { scrollToTop(); },
);

/** 通过现有工具滚回所属宿主顶部，停用缓存不影响当前页面。 */
function scrollToTop(): void {
	if (rootEl.value != null && rootEl.value.isConnected) {
		scrollInContainer(rootEl.value, {
			top: 0,
			behavior: prefersReducedMotion ? 'auto' : 'smooth',
		});
	}
}

defineExpose({
	scrollToTop,
});
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
}

.body {
	--MI-swiper-duration: var(--twitter-duration-normal);
	--MI-swiper-ease: var(--twitter-ease);
	--MI-swiper-gap: 0px;
	--twitter-timeline-loading-min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	position: relative;
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

@media (prefers-reduced-motion: reduce) {
	.body { --MI-swiper-duration: 0ms; }
}
</style>
