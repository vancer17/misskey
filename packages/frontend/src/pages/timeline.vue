<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：首页时间线页面与交互协调。
作用：保留 Misskey 的时间线来源及筛选入口；Twitter 分支将手动刷新、Shell 回顶和结果提示连接起来。
数据链：既有偏好 → 时间线查询输入；唯一查询所有者 → 只读刷新结果 → 页面提示，不复制帖子事实。
-->

<template>
<component :is="timelineComponent" ref="timelineShell" v-model:tab="src" v-bind="timelineComponentProps" @refresh="refreshTwitterTimeline">
	<div
		:class="isTwitterUi ? $style.twitterBody : ['_spacer', $style.body]"
		:style="isTwitterUi ? undefined : { '--MI_SPACER-w': '800px' }"
	>
		<MkTip v-if="!isTwitterUi && isBasicTimeline(src)" :k="`tl.${src}`" style="margin-bottom: var(--MI-margin);">
			{{ i18n.ts._timelineDescription[src] }}
		</MkTip>
		<MkPostForm
			v-if="$i != null && !isTwitterUi && prefer.r.showFixedPostForm.value"
			:class="['_panel', $style.postForm]"
			fixed
			:style="{ marginBottom: 'var(--MI-margin)' }"
		/>
		<TwitterStreamingTimeline
			v-if="isTwitterUi"
			ref="twitterTlComponent"
			:key="twitterTimelineKey"
			:class="$style.twitterTl"
			:src="(src.split(':')[0] as (BasicTimelineType | 'list'))"
			:list="src.split(':')[1]"
			:withRenotes="withRenotes"
			:withReplies="withReplies"
			:withSensitive="withSensitive"
			:onlyFiles="onlyFiles"
			:sound="true"
			@refreshStarted="onTwitterRefreshStarted"
		/>
		<MkStreamingNotesTimeline
			v-else
			ref="tlComponent"
			:key="src + withRenotes + withReplies + onlyFiles + withSensitive"
			:class="$style.tl"
			:src="(src.split(':')[0] as (BasicTimelineType | 'list'))"
			:list="src.split(':')[1]"
			:withRenotes="withRenotes"
			:withReplies="withReplies"
			:withSensitive="withSensitive"
			:onlyFiles="onlyFiles"
			:sound="true"
			variant="misskey"
		/>
	</div>
</component>
</template>

<script lang="ts" setup>
import { computed, watch, provide, useTemplateRef, ref, onMounted, onActivated, onDeactivated, onBeforeUnmount, inject } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import type { MenuItem } from '@/types/menu.js';
import type { BasicTimelineType } from '@/timelines.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';
import { antennasCache, userListsCache, favoritedChannelsCache } from '@/cache.js';
import { deviceKind } from '@/utility/device-kind.js';
import { deepMerge } from '@/utility/merge.js';
import { miLocalStorage } from '@/local-storage.js';
import { availableBasicTimelines, hasWithReplies, isAvailableBasicTimeline, isBasicTimeline, basicTimelineIconClass } from '@/timelines.js';
import { prefer } from '@/preferences.js';
import { TwitterStreamingTimeline, TwitterTimelineShell } from '@/ui/twitter/index.js';
import type { TwitterTimelineRefreshResult } from '@/ui/twitter/index.js';
import { DI } from '@/di.js';

const tlComponent = useTemplateRef('tlComponent');
const twitterTlComponent: Readonly<ShallowRef<InstanceType<typeof TwitterStreamingTimeline> | null>> = useTemplateRef('twitterTlComponent');
const timelineShell: Readonly<ShallowRef<InstanceType<typeof TwitterTimelineShell> | InstanceType<typeof PageWithHeader> | null>> = useTemplateRef('timelineShell');
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');
const timelineComponent = computed(() => isTwitterUi.value ? TwitterTimelineShell : PageWithHeader);
let timelinePageActive: boolean = true;

type TimelinePageSrc = BasicTimelineType | `list:${string}`;

const srcWhenNotSignin = ref<'local' | 'global'>(isAvailableBasicTimeline('local') ? 'local' : 'global');
const src = computed<TimelinePageSrc>({
	get: () => ($i ? store.r.tl.value.src : srcWhenNotSignin.value),
	set: (x) => saveSrc(x),
});
const withRenotes = computed<boolean>({
	get: () => store.r.tl.value.filter.withRenotes,
	set: (x) => saveTlFilter('withRenotes', x),
});

// computed内での無限ループを防ぐためのフラグ
const localSocialTLFilterSwitchStore = ref<'withReplies' | 'onlyFiles' | false>(
	store.r.tl.value.filter.withReplies ? 'withReplies' :
	store.r.tl.value.filter.onlyFiles ? 'onlyFiles' :
	false,
);

const withReplies = computed<boolean>({
	get: () => {
		if (!$i) return false;
		if (['local', 'social'].includes(src.value) && localSocialTLFilterSwitchStore.value === 'onlyFiles') {
			return false;
		} else {
			return store.r.tl.value.filter.withReplies;
		}
	},
	set: (x) => saveTlFilter('withReplies', x),
});
const onlyFiles = computed<boolean>({
	get: () => {
		if (['local', 'social'].includes(src.value) && localSocialTLFilterSwitchStore.value === 'withReplies') {
			return false;
		} else {
			return store.r.tl.value.filter.onlyFiles;
		}
	},
	set: (x) => saveTlFilter('onlyFiles', x),
});

watch([withReplies, onlyFiles], ([withRepliesTo, onlyFilesTo]) => {
	if (withRepliesTo) {
		localSocialTLFilterSwitchStore.value = 'withReplies';
	} else if (onlyFilesTo) {
		localSocialTLFilterSwitchStore.value = 'onlyFiles';
	} else {
		localSocialTLFilterSwitchStore.value = false;
	}
});

const withSensitive = computed<boolean>({
	get: () => store.r.tl.value.filter.withSensitive,
	set: (x) => saveTlFilter('withSensitive', x),
});

const twitterTimelineKey: ComputedRef<string> = computed(
	/** 来源、账户或筛选改变即重建查询所有者，避免旧响应归属新查询。 */
	(): string => `${$i?.id ?? ''}:${src.value}:${withRenotes.value}:${withReplies.value}:${onlyFiles.value}:${withSensitive.value}`,
);

/** 查询所有者先登记比较基线，再经页面驱动真实 Shell 滚动宿主回顶一次。 */
function onTwitterRefreshStarted(): void {
	if (isTwitterUi.value && timelinePageActive) timelineShell.value?.scrollToTop();
}

/** 页面仅将权威刷新结果转换为轻量提示，不通过列表或 DOM 推断新帖。 */
async function refreshTwitterTimeline(): Promise<void> {
	const currentTimeline: InstanceType<typeof TwitterStreamingTimeline> | null = twitterTlComponent.value;
	if (!isTwitterUi.value || !timelinePageActive || currentTimeline == null || currentTimeline.refreshing) return;
	const result: TwitterTimelineRefreshResult = await currentTimeline.refreshManually();
	if (!timelinePageActive || !isTwitterUi.value || currentTimeline !== twitterTlComponent.value) return;
	switch (result) {
		case 'updated':
			os.toast(i18n.ts._twitterUi.timelineUpdated);
			break;
		case 'unchanged':
			os.toast(i18n.ts._twitterUi.timelineUpToDate);
			break;
		case 'failed':
			os.toast(i18n.ts._twitterUi.timelineRefreshFailed);
			break;
		case 'cancelled':
			break;
	}
}

onActivated(
	/** 缓存页面重新激活后允许本次所有者的结果进入当前 UI。 */
	(): void => { timelinePageActive = true; },
);
onDeactivated(
	/** 页面失活即停止消费异步提示；查询撤销由业务包装层处理。 */
	(): void => { timelinePageActive = false; },
);
onBeforeUnmount(
	/** 页面销毁时关闭提示出口，防止旧 Promise 在离页后弹出反馈。 */
	(): void => { timelinePageActive = false; },
);

const showFixedPostForm = prefer.model('showFixedPostForm');

async function chooseList(ev: PointerEvent): Promise<void> {
	const lists = await userListsCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...lists.map(list => ({
			type: 'link' as const,
			text: list.name,
			to: `/timeline/list/${list.id}`,
		})),
		(lists.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link' as const,
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/my/lists',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

async function chooseAntenna(ev: PointerEvent): Promise<void> {
	const antennas = await antennasCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...antennas.map(antenna => ({
			type: 'link' as const,
			text: antenna.name,
			indicate: antenna.hasUnreadNote,
			to: `/timeline/antenna/${antenna.id}`,
		})),
		(antennas.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link' as const,
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/my/antennas',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

async function chooseChannel(ev: PointerEvent): Promise<void> {
	const channels = await favoritedChannelsCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...channels.map(channel => {
			const lastReadedAt = miLocalStorage.getItemAsJson(`channelLastReadedAt:${channel.id}`) ?? null;
			const hasUnreadNote = (lastReadedAt && channel.lastNotedAt) ? Date.parse(channel.lastNotedAt) > lastReadedAt : !!(!lastReadedAt && channel.lastNotedAt);

			return {
				type: 'link' as const,
				text: channel.name,
				indicate: hasUnreadNote,
				to: `/channels/${channel.id}`,
			};
		}),
		(channels.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link',
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/channels/new',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

function saveSrc(newSrc: TimelinePageSrc): void {
	const out = deepMerge({ src: newSrc }, store.s.tl);

	if (newSrc.startsWith('userList:')) {
		const id = newSrc.substring('userList:'.length);
		out.userList = prefer.r.pinnedUserLists.value.find(l => l.id === id) ?? null;
	}

	store.set('tl', out);
	if (['local', 'global'].includes(newSrc)) {
		srcWhenNotSignin.value = newSrc as 'local' | 'global';
	}
}

function saveTlFilter(key: keyof typeof store.s.tl.filter, newValue: boolean) {
	if (key !== 'withReplies' || $i) {
		const out = deepMerge({ filter: { [key]: newValue } }, store.s.tl);
		store.set('tl', out);
	}
}

function switchTlIfNeeded() {
	if (isBasicTimeline(src.value) && !isAvailableBasicTimeline(src.value)) {
		src.value = availableBasicTimelines()[0];
	}
}

onMounted(() => {
	switchTlIfNeeded();
});
onActivated(() => {
	switchTlIfNeeded();
});

const headerActions: ComputedRef<PageHeaderItem[]> = computed<PageHeaderItem[]>(
/** 原界面保留通用刷新操作，Twitter 页头使用带忙闲状态的独立刷新入口。 */
(): PageHeaderItem[] => {
	const items: PageHeaderItem[] = [{
		icon: 'ti ti-dots',
		text: i18n.ts.options,
		/** 操作菜单只更新既有筛选偏好，查询归属随页面 key 重新创建。 */
		handler: (ev: PointerEvent): void => {
			const menuItems: MenuItem[] = [];

			menuItems.push({
				type: 'switch',
				icon: 'ti ti-repeat',
				text: i18n.ts.showRenotes,
				ref: withRenotes,
			});

			if (isBasicTimeline(src.value) && hasWithReplies(src.value)) {
				menuItems.push({
					type: 'switch',
					icon: 'ti ti-messages',
					text: i18n.ts.showRepliesToOthersInTimeline,
					ref: withReplies,
					disabled: onlyFiles,
				});
			}

			menuItems.push({
				type: 'switch',
				icon: 'ti ti-eye-exclamation',
				text: i18n.ts.withSensitive,
				ref: withSensitive,
			}, {
				type: 'switch',
				icon: 'ti ti-photo',
				text: i18n.ts.fileAttachedOnly,
				ref: onlyFiles,
					disabled: isBasicTimeline(src.value) && hasWithReplies(src.value) ? withReplies : false,
			});

			// twitter UI 无内联发帖表单（发帖入口为侧栏按钮 / FAB），该开关仅对 default UI 有效，避免展示无效开关
			if (!isTwitterUi.value) {
				menuItems.push({
					type: 'divider',
				}, {
					type: 'switch',
					text: i18n.ts.showFixedPostForm,
					ref: showFixedPostForm,
				});
			}

			os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
		},
	}];

	if (deviceKind === 'desktop' && !isTwitterUi.value) {
		items.unshift({
			icon: 'ti ti-refresh',
			text: i18n.ts.reload,
			/** 默认界面继续调用原流式组件的公开刷新入口。 */
			handler: (): void => {
				tlComponent.value?.reloadTimeline();
			},
		});
	}

	return items;
});

const headerTabs = computed(() => [...(prefer.r.pinnedUserLists.value.map(l => ({
	key: 'list:' + l.id,
	title: l.name,
	icon: 'ti ti-star',
	iconOnly: true,
}))), ...availableBasicTimelines().map(tl => ({
	key: tl,
	title: i18n.ts._timelines[tl],
	icon: basicTimelineIconClass(tl),
	iconOnly: true,
})), {
	icon: 'ti ti-list',
	title: i18n.ts.lists,
	iconOnly: true,
	onClick: chooseList,
}, {
	icon: 'ti ti-antenna',
	title: i18n.ts.antennas,
	iconOnly: true,
	onClick: chooseAntenna,
}, {
	icon: 'ti ti-device-tv',
	title: i18n.ts.channel,
	iconOnly: true,
	onClick: chooseChannel,
}] as Tab[]);

const headerTabsWhenNotLogin = computed(() => [...availableBasicTimelines().map(tl => ({
	key: tl,
	title: i18n.ts._timelines[tl],
	icon: basicTimelineIconClass(tl),
	iconOnly: true,
}))] as Tab[]);

/** 壳组件的只读展示投影，沿用现有组件参数类型而不重复业务状态定义。 */
type TimelineComponentProps = Pick<InstanceType<typeof TwitterTimelineShell>['$props'], 'actions' | 'tabs' | 'swipable' | 'displayMyAvatar' | 'showRefresh' | 'refreshing' | 'refreshDisabled'> & Pick<InstanceType<typeof PageWithHeader>['$props'], 'canOmitTitle'>;

const timelineComponentProps: ComputedRef<TimelineComponentProps> = computed(
/** 界面分支只决定展示入口，刷新结果始终来自 Twitter 查询所有者。 */
(): TimelineComponentProps => {
	const defaultTabs: Tab[] = ($i ? headerTabs.value : headerTabsWhenNotLogin.value) as Tab[];
	const twitterTabs: Tab[] = defaultTabs.filter(
		/** Twitter 页头只展示可切换来源，额外导航动作保留在既有入口。 */
		(tab: Tab): boolean => tab.onClick == null,
	);

	return isTwitterUi.value
		? {
			actions: headerActions.value,
			tabs: twitterTabs,
			swipable: true,
			displayMyAvatar: true,
			showRefresh: deviceKind === 'desktop',
			refreshing: twitterTlComponent.value?.refreshing ?? false,
			refreshDisabled: twitterTlComponent.value?.initializing ?? true,
		}
		: {
			actions: headerActions.value,
			tabs: defaultTabs,
			swipable: true,
			displayMyAvatar: true,
			canOmitTitle: true,
		};
});

definePage(() => ({
	title: i18n.ts.timeline,
	icon: isBasicTimeline(src.value) ? basicTimelineIconClass(src.value) : 'ti ti-home',
}));
</script>

<style lang="scss" module>
.new {
	position: sticky;
	top: calc(var(--MI-stickyTop, 0px) + 16px);
	z-index: 1000;
	width: 100%;
	margin: calc(-0.675em - 8px) 0;

	&:first-child {
		margin-top: calc(-0.675em - 8px - var(--MI-margin));
	}
}

.newButton {
	display: block;
	margin: var(--MI-margin) auto 0 auto;
	padding: 8px 16px;
	border-radius: 32px;
}

.postForm {
	border-radius: var(--MI-radius);
}

.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.twitterBody,
.twitterTl {
	min-height: 100%;
	background: var(--twitter-bg);
}

.twitterTl {
	overflow: visible;
}

</style>
