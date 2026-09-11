<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component
	:is="pageComponent"
	v-model:tab="tab"
	:actions="headerActions"
	:tabs="headerTabs"
	:swipable="true"
>
	<div
		:class="isTwitterUi ? $style.twitterBody : ['_spacer', $style.body]"
		:style="isTwitterUi ? undefined : { '--MI_SPACER-w': '800px' }"
	>
		<div v-if="tab === 'all'">
			<MkStreamingNotificationsTimeline
				ref="notificationsTimeline"
				:class="isTwitterUi ? $style.twitterNotifications : $style.notifications"
				:excludeTypes="excludeTypes"
				:variant="isTwitterUi ? 'twitter' : 'misskey'"
				:initialUnreadCount="initialUnreadCount"
			/>
		</div>
		<div v-else-if="tab === 'mentions'">
			<MkNotesTimeline
				:class="{ [$style.twitterNotifications]: isTwitterUi }"
				:paginator="mentionsPaginator"
				:variant="isTwitterUi ? 'twitter' : 'misskey'"
			/>
		</div>
		<div v-else-if="tab === 'directNotes'">
			<MkNotesTimeline
				:class="{ [$style.twitterNotifications]: isTwitterUi }"
				:paginator="directNotesPaginator"
				:variant="isTwitterUi ? 'twitter' : 'misskey'"
			/>
		</div>
	</div>
</component>
</template>

<script lang="ts" setup>
import { computed, inject, markRaw, ref, useTemplateRef } from 'vue';
import { notificationTypes } from 'misskey-js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkStreamingNotificationsTimeline from '@/components/MkStreamingNotificationsTimeline.vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';
import { definePage } from '@/page.js';
import TwitterNotificationsShell from '@/ui/twitter/NotificationsShell.vue';
import { Paginator } from '@/utility/paginator.js';

const tab = ref('all');
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');
const pageComponent = computed(() => isTwitterUi.value ? TwitterNotificationsShell : PageWithHeader);
const initialUnreadCount = $i?.unreadNotificationsCount ?? 0;
const notificationsTimeline = useTemplateRef('notificationsTimeline');
const includeTypes = ref<string[] | null>(null);
const excludeTypes = computed(() => includeTypes.value ? notificationTypes.filter(t => !includeTypes.value!.includes(t)) : null);

const mentionsPaginator = markRaw(new Paginator('notes/mentions', {
	limit: 10,
}));

const directNotesPaginator = markRaw(new Paginator('notes/mentions', {
	limit: 10,
	params: {
		visibility: 'specified',
	},
}));

function setFilter(ev: PointerEvent) {
	const typeItems = notificationTypes.map(t => ({
		text: i18n.ts._notification._types[t],
		active: (includeTypes.value && includeTypes.value.includes(t)) ?? false,
		action: () => {
			includeTypes.value = [t];
		},
	}));
	const items = includeTypes.value != null ? [{
		icon: 'ti ti-x',
		text: i18n.ts.clear,
		action: () => {
			includeTypes.value = null;
		},
	}, { type: 'divider' as const }, ...typeItems] : typeItems;
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

async function markAllAsRead() {
	await os.apiWithDialog('notifications/mark-all-as-read', {});
	notificationsTimeline.value?.clearUnreadMarkers();
}

const headerActions = computed<PageHeaderItem[]>(() => ([tab.value === 'all' ? {
	text: i18n.ts.filter,
	icon: 'ti ti-filter',
	highlighted: includeTypes.value != null,
	handler: setFilter,
} : undefined, tab.value === 'all' ? {
	text: i18n.ts.markAllAsRead,
	icon: 'ti ti-check',
	handler: () => {
		void markAllAsRead();
	},
} : undefined] as (PageHeaderItem | undefined)[]).filter(x => x !== undefined));

const headerTabs = computed(() => [{
	key: 'all',
	title: i18n.ts.all,
	icon: 'ti ti-point',
}, {
	key: 'mentions',
	title: i18n.ts.mentions,
	icon: 'ti ti-at',
}, {
	key: 'directNotes',
	title: i18n.ts.directNotes,
	icon: 'ti ti-mail',
}]);

definePage(() => ({
	title: i18n.ts.notifications,
	icon: 'ti ti-bell',
}));
</script>

<style module lang="scss">
.body {
	min-width: 0;
}

.notifications {
	border-radius: var(--MI-radius);
	overflow: clip;
}

.twitterBody {
	min-height: 100%;
	background: var(--twitter-bg);
}

.twitterNotifications {
	border-radius: 0;
	overflow: clip;
}
</style>
