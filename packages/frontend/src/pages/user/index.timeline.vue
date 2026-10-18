<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：原用户时间线页面。
作用：原数据所有者处理写入与回访，不移动基础组件内部逻辑。
数据链：确认信号 → 原查询 → 当前实体／分页集合；无环境探测。
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
import { useGlobalEvent } from '@/events.js';
import { useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { inject, ref, computed, markRaw } from 'vue';
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

/** 原 UI 列表使用既有分页器；非空、空结果与在途请求采用同一规则。 */
const invalidateNotes: () => void = useTwitterPaginatorRefresh(/** 普通帖子数据源。 */ (): typeof notesPaginator => notesPaginator,
	/** 保持原 v-if 分支归属。 */ (): boolean => tab.value !== 'featured');
useTwitterPaginatorRefresh(/** 热门仍仅在回访重取，不因发帖保证上榜。 */ (): typeof featuredPaginator => featuredPaginator,
	/** 已显示的热门面板。 */ (): boolean => tab.value === 'featured');
useGlobalEvent('notePosted', /** 发布者必须属于当前主页。 */ (note: Misskey.entities.Note): void => { if (note.userId === props.user.id) invalidateNotes(); });
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
