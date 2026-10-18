<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header>
		<MkTab
			v-model="tab"
			:tabs="[
				{ key: 'featured', label: i18n.ts.featured },
				{ key: 'notes', label: i18n.ts.notes },
				{ key: 'all', label: i18n.ts.all },
				{ key: 'files', label: i18n.ts.withFiles },
			]"
			:class="$style.tab"
		>
		</MkTab>
	</template>
	<MkNotesTimeline v-if="tab === 'featured'" :noGap="true" :paginator="featuredPaginator" :pullToRefresh="false" :variant="timelineVariant" :class="$style.tl"/>
	<MkNotesTimeline v-else :noGap="true" :paginator="notesPaginator" :pullToRefresh="false" :variant="timelineVariant" :class="$style.tl"/>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { inject, ref, computed, markRaw, onActivated } from 'vue';
import * as Misskey from 'misskey-js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkTab from '@/components/MkTab.vue';
import { DI } from '@/di.js';
import { i18n } from '@/i18n.js';
import { Paginator } from '@/utility/paginator.js';

const props = defineProps<{
	user: Misskey.entities.UserDetailed;
}>();

const uiStyle = inject(DI.uiStyle, ref('default'));
const timelineVariant = computed(() => uiStyle.value === 'twitter' ? 'twitter' : 'misskey');

const tab = ref<'featured' | 'notes' | 'all' | 'files'>('all');

const featuredPaginator = markRaw(new Paginator('users/featured-notes', {
	limit: 10,
	params: {
		userId: props.user.id,
	},
}));

const notesPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	computedParams: computed(() => ({
		userId: props.user.id,
		withRenotes: tab.value === 'all',
		withReplies: tab.value === 'all',
		withChannelNotes: tab.value === 'all',
		withFiles: tab.value === 'files',
	})),
}));

/** KeepAlive 首次激活跳过标志（挂载期已完成首拉，防止双拉）。 */
let skipNextActivation = true;

/** 回访刷新（K-04：用户新帖后回访时间线不陈旧；按 tab 定向重载，仅有条目时执行）。 */
onActivated(() => {
	if (skipNextActivation) {
		skipNextActivation = false;
		return;
	}
	const paginator = tab.value === 'featured' ? featuredPaginator : notesPaginator;
	if (paginator.items.value.length > 0) void paginator.reload();
});
</script>

<style lang="scss" module>
.tab {
	padding: calc(var(--MI-margin) / 2) 0;
	background: var(--MI_THEME-bg);
}

.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}
</style>
