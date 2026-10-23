<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：通知与提及页面。
作用：协调已确认写入与缓存回访，复用原查询及基础组件，不复制业务状态。
数据链：成功通知／回访 → 页面数据所有者 → 只读显示；不解释环境探测。
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
			<MkStreamingNotesTimeline
				:class="{ [$style.twitterNotifications]: isTwitterUi }"
				src="mentions"
				:variant="isTwitterUi ? 'twitter' : 'misskey'"
			/>
		</div>
		<div v-else-if="tab === 'directNotes'">
			<MkStreamingNotesTimeline
				:class="{ [$style.twitterNotifications]: isTwitterUi }"
				src="directs"
				:variant="isTwitterUi ? 'twitter' : 'misskey'"
			/>
		</div>
	</div>
</component>
</template>

<script lang="ts" setup>
import { computed, inject, ref, useTemplateRef } from 'vue';
import type { Component, ComputedRef, Ref, ShallowRef } from 'vue';
import { notificationTypes } from 'misskey-js';
import type { PageHeaderItem } from '@/types/page-header.js';
import type { MenuItem } from '@/types/menu.js';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import MkStreamingNotificationsTimeline from '@/components/MkStreamingNotificationsTimeline.vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';
import { definePage } from '@/page.js';
import TwitterNotificationsShell from '@/ui/twitter/NotificationsShell.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import { confirmNotificationsRead, useNotificationsRead } from '@/notifications/index.js';

const tab: Ref<string> = ref('all');
const uiStyle: Ref<string> = inject(DI.uiStyle, ref('default'));
const isTwitterUi: ComputedRef<boolean> = computed(/** UI 选择只改变页面壳，不改变通知已读语义。 */ (): boolean => uiStyle.value === 'twitter');
const pageComponent: ComputedRef<Component> = computed(/** 在两种展示壳之间选择，数据继续由同一页面持有。 */ (): Component => isTwitterUi.value ? TwitterNotificationsShell : PageWithHeader);
const initialUnreadCount: number = $i?.unreadNotificationsCount ?? 0;
const notificationsTimeline: Readonly<ShallowRef<InstanceType<typeof MkStreamingNotificationsTimeline> | null>> = useTemplateRef('notificationsTimeline');
const includeTypes: Ref<string[] | null> = ref(null);
const excludeTypes: ComputedRef<Array<(typeof notificationTypes)[number]> | null> = computed(/** 从过滤选择派生原通知查询参数，不保存实体副本。 */ (): Array<(typeof notificationTypes)[number]> | null => includeTypes.value ? notificationTypes.filter(/** 保留没有被用户选择排除的通知种类。 */ (type: (typeof notificationTypes)[number]): boolean => !includeTypes.value!.includes(type)) : null);

useNotificationsRead(/** 提及和私信面板不产生全部通知已读动作。 */ (): boolean => tab.value === 'all');

/** 将原通知类型过滤操作传入菜单，过滤条件仅用于查询参数。 */
function setFilter(ev: PointerEvent): void {
	const typeItems: MenuItem[] = notificationTypes.map(/** 为每个既有通知种类创建菜单动作。 */ (t: (typeof notificationTypes)[number]): MenuItem => ({
		text: i18n.ts._notification._types[t],
		active: (includeTypes.value && includeTypes.value.includes(t)) ?? false,
		action: /** 提交单种过滤选择，不在菜单保存通知状态。 */ (): void => {
			includeTypes.value = [t];
		},
	}));
	const items: MenuItem[] = includeTypes.value != null ? [{
		icon: 'ti ti-x',
		text: i18n.ts.clear,
		action: /** 清除过滤参数，恢复原通知查询范围。 */ (): void => {
			includeTypes.value = null;
		},
	}, { type: 'divider' as const }, ...typeItems] : typeItems;
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

/** 手动已读成功并完成账户对账后清除局部标记；失败保留旧展示并使用既有错误弹窗。 */
async function markAllAsRead(): Promise<void> {
	const confirmed: boolean = await confirmNotificationsRead();
	if (confirmed) {
		notificationsTimeline.value?.clearUnreadMarkers();
	} else {
		await os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	}
}

const headerActions: ComputedRef<PageHeaderItem[]> = computed(/** 将当前面板允许的动作交给原页面头，不直接改业务状态。 */ (): PageHeaderItem[] => ([tab.value === 'all' ? {
	text: i18n.ts.filter,
	icon: 'ti ti-filter',
	highlighted: includeTypes.value != null,
	handler: setFilter,
} : undefined, tab.value === 'all' ? {
	text: i18n.ts.markAllAsRead,
	icon: 'ti ti-check',
	handler: /** 用户明确点击后提交已读动作，完成错误处理后结束。 */ (): void => {
		void markAllAsRead();
	},
} : undefined] as (PageHeaderItem | undefined)[]).filter(/** 排除其他面板不支持的头部动作。 */ (item: PageHeaderItem | undefined): item is PageHeaderItem => item !== undefined));

const headerTabs: ComputedRef<Tab[]> = computed(/** 沿用三类通知面板的路由内 UI 选择。 */ (): Tab[] => [{
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

definePage(/** 页面元信息与通知实体状态独立。 */ (): { title: string; icon: string } => ({
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
