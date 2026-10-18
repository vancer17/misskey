<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：保留的收藏页。
作用：在原命令成功后更新原数据源，回访仍保留当前显示上下文。
数据链：命令确认 → 原分页器／实体 → 只读组件；不写入第二份业务事实。
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkPagination :paginator="paginator">
			<template #empty><MkResult type="empty" :text="i18n.ts.noNotes"/></template>

			<template #default="{ items }">
				<MkNote v-for="item in items" :key="item.id" :note="item.note" :class="$style.note"/>
			</template>
		</MkPagination>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { useGlobalEvent } from '@/events.js';
import { useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { markRaw } from 'vue';
import MkPagination from '@/components/MkPagination.vue';
import MkNote from '@/components/MkNote.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

const paginator = markRaw(new Paginator('i/favorites', {
	limit: 10,
}));

/** 收藏列表成功写入与回访共用原分页器；从空列表开始也会更新。 */
const invalidateFavorites: () => void = useTwitterPaginatorRefresh(/** 原收藏查询。 */ (): typeof paginator => paginator);
useGlobalEvent('noteFavoritesChanged', invalidateFavorites);

definePage(() => ({
	title: i18n.ts.favorites,
	icon: 'ti ti-star',
}));
</script>

<style lang="scss" module>
.note {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}
</style>
