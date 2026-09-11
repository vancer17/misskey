<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" class="_pageScrollable" :class="$style.root">
	<MkStickyContainer>
		<template #header>
			<TwitterNotificationsHeader
				v-model:tab="tabModel"
				:tabs="tabs"
				:actions="actions"
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
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import MkSwiper from '@/components/MkSwiper.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';
import { prefer } from '@/preferences.js';
import TwitterNotificationsHeader from './NotificationsHeader.vue';

withDefaults(defineProps<{
	tabs: Tab[];
	actions?: PageHeaderItem[];
	swipable?: boolean;
}>(), {
	actions: () => [],
	swipable: true,
});

const tabModel = defineModel<string>('tab');
const rootEl = useTemplateRef('rootEl');

useScrollPositionKeeper(rootEl);
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
