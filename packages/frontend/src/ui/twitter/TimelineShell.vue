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
<div ref="rootEl" class="_pageScrollable" :class="$style.root">
	<MkStickyContainer>
		<template #header>
			<TwitterTimelineHeader
				v-model:tab="tabModel"
				:tabs="tabs"
				:actions="actions"
				:displayMyAvatar="displayMyAvatar"
				@tabReselected="scrollToTop"
			/>
		</template>

		<MkSwiper
			v-if="swipable && prefer.r.enableHorizontalSwipe.value && tabs.length > 1"
			v-model:tab="tabModel"
			:class="$style.body"
			:tabs="tabs"
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
import { useTemplateRef } from 'vue';
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

withDefaults(defineProps<{
	tabs: Tab[];
	actions?: PageHeaderItem[];
	swipable?: boolean;
	displayMyAvatar?: boolean;
}>(), {
	actions: () => [],
	swipable: true,
	displayMyAvatar: false,
});

const tabModel = defineModel<string>('tab');
const rootEl = useTemplateRef('rootEl');

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
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}
</style>
