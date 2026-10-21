<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 用户时间线页签。
作用：使用既有分页器加载帖子，以局部停用与待刷新标记协调回访和隐藏面板。
数据链：用户标识 → Paginator → 帖子组件；身份展示更新不依赖列表重载。
-->

<template>
<div :class="{ [$style.mobile]: isMobile }">
	<nav :class="$style.tabs" :aria-label="i18n.ts.timeline">
		<MkA
			v-for="tab in tabs"
			:key="tab.key"
			:class="$style.tab"
			:to="userPage(props.user, tab.key)"
			:aria-current="activeTab === tab.key ? 'page' : undefined"
		>
			<span :class="$style.tabTitle">{{ tab.title }}</span>
		</MkA>
	</nav>

	<div
		v-for="tab in tabs"
		v-show="activeTab === tab.key"
		:key="tab.key"
		:class="$style.timelinePane"
		:data-testid="`twitter-user-timeline-${tab.key}`"
	>
		<div v-if="tab.key === 'notes' && user.pinnedNotes.length > 0" :class="$style.pinned">
			<TwitterNote
				v-for="note in user.pinnedNotes"
				:key="note.id"
				:note="note"
				decorationContext="note"
				:pinned="true"
				:withHardMute="true"
			/>
		</div>

		<MkNotesTimeline
			:key="user.id + ':' + tab.key"
			:class="$style.timeline"
			:paginator="paginators[tab.key]"
			:noGap="true"
			:pullToRefresh="false"
			:variant="'twitter'"
		>
			<template #empty>
				<TwitterPageState type="empty" :title="i18n.ts.noNotes"/>
			</template>
		</MkNotesTimeline>
	</div>
</div>
</template>

<script lang="ts" setup>
import { useGlobalEvent } from '@/events.js';
import { computed, markRaw, onActivated, onDeactivated, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { ComputedRef } from 'vue';
import type { IPaginator } from '@/utility/paginator.js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import { TwitterNote } from '@/ui/twitter/index.js';
import TwitterPageState from '@/ui/twitter/components/TwitterPageState.vue';
import { useTwitterLayout } from '@/ui/twitter/index.js';
import { Paginator } from '@/utility/paginator.js';
import { userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	user: Misskey.entities.UserDetailed;
	page?: string;
}>(), {
	page: 'notes',
});

/** Twitter 布局状态（移动端 class 驱动，ADR-0001 决策 4）。 */
const { isMobile } = useTwitterLayout();

/** 本页既有展示标签的联合，不定义新的领域状态。 */
type TimelineTab = 'notes' | 'replies' | 'files' | 'featured';

/** 标签文案与路由段，仅用于本页展示。 */
const tabs: ReadonlyArray<{ key: TimelineTab; title: string }> = [{
	/** 用户帖子标签。 */
	key: 'notes',
	title: i18n.ts.notes,
}, {
	/** 回复标签。 */
	key: 'replies',
	title: i18n.ts.replies,
}, {
	/** 带附件的帖子标签。 */
	key: 'files',
	title: i18n.ts.withFiles,
}, {
	/** 热门帖子标签。 */
	key: 'featured',
	title: i18n.ts.featured,
}] as const satisfies ReadonlyArray<{
	key: TimelineTab;
	title: string;
}>;

/** 由路由页签派生当前面板。 */
const activeTab: ComputedRef<TimelineTab> = computed(
	/** home 与 notes 共用帖子面板。 */
	(): TimelineTab => {
	switch (props.page) {
		case 'replies':
		case 'files':
		case 'featured':
			return props.page;
		case 'home':
		case 'notes':
		default:
			return 'notes';
	}
});

/** 首次初始化由既有 MkPagination 负责，不额外创建列表副本。 */
const paginators: Record<TimelineTab, IPaginator<Misskey.entities.Note>> = {
	/** notes 面板的既有分页器。 */
	notes: markRaw(new Paginator('users/notes', {
		limit: 20,
		params: {
			userId: props.user.id,
			withRenotes: true,
			withReplies: false,
			withChannelNotes: true,
		},
	})),
	/** replies 面板的既有分页器。 */
	replies: markRaw(new Paginator('users/notes', {
		limit: 20,
		params: {
			userId: props.user.id,
			withRenotes: false,
			withReplies: true,
			withChannelNotes: false,
		},
	})),
	/** files 面板的既有分页器。 */
	files: markRaw(new Paginator('users/notes', {
		limit: 20,
		params: {
			userId: props.user.id,
			withRenotes: false,
			// users/notes 不支持同时开启 withFiles 与 withReplies。
			withReplies: false,
			withChannelNotes: true,
			withFiles: true,
		},
	})),
	/** featured 面板的既有分页器。 */
	featured: markRaw(new Paginator('users/featured-notes', {
		limit: 20,
		params: {
			userId: props.user.id,
		},
	})),
};

/** 待消费的 UI 刷新意图；不作为业务数据成功/失败的第二份事实。 */
const pendingTabs: Set<TimelineTab> = new Set();
/** 本组件发起的刷新占用，避免与首拉、翻页、标签切换并发 init。 */
const refreshingTabs: Set<TimelineTab> = new Set();
/** 晚挂载子组件默认可见，实际停用后暂停调度。 */
let active: boolean = true;

/** 使用分页器公开状态判断占用，不以条目数量推断是否加载过。 */
function isBusy(paginator: IPaginator): boolean {
	return paginator.fetching.value || paginator.fetchingOlder.value || paginator.fetchingNewer.value;
}

/** 每次消费一个活动面板刷新意图，错误与手动重试仍归既有分页器。 */
async function refreshActiveTab(): Promise<void> {
	const tab: TimelineTab = activeTab.value;
	const paginator: IPaginator = paginators[tab];
	if (!active || !pendingTabs.has(tab) || refreshingTabs.has(tab) || isBusy(paginator)) return;
	pendingTabs.delete(tab);
	refreshingTabs.add(tab);
	try {
		await paginator.reload();
	} finally {
		refreshingTabs.delete(tab);
	}
	// 新的回访可能在请求期间排队；错误不被视为成功，也不形成自动重试循环。
	if (!paginator.error.value) void refreshActiveTab();
}

onDeactivated(
	/** 标记所有已挂载面板；隐藏面板留待真正显示时刷新。 */
	(): void => {
		active = false;
		for (const tab of tabs) pendingTabs.add(tab.key);
	},
);
onActivated(
	/** 不跳过首次 activated；没有实际停用标记时自然无额外请求。 */
	async (): Promise<void> => { active = true; await refreshActiveTab(); },
);
watch(activeTab,
	/** v-show 不重新挂载；消费待刷新意图，或重试用户重新访问的错误面板。 */
	async (tab: TimelineTab): Promise<void> => {
		if (paginators[tab].error.value) pendingTabs.add(tab);
		await refreshActiveTab();
	},
);
watch(
	/** 初始加载或翻页结束后处理回访期间排队的请求。 */
	(): boolean => isBusy(paginators[activeTab.value]),
	async (busy: boolean): Promise<void> => {
		if (!busy && !paginators[activeTab.value].error.value) await refreshActiveTab();
	},
);

/** 同一用户集合失效后复用现有调度；每个标签仍由后端决定成员与排序。 */
function invalidatePostedUser(note: Misskey.entities.Note): void {
	if (note.userId !== props.user.id) return;
	for (const tab of tabs) pendingTabs.add(tab.key);
	void refreshActiveTab();
}

useGlobalEvent('notePosted', invalidatePostedUser);

</script>

<style lang="scss" module>
.tabs {
	position: sticky;
	/* 与上方 TwitterHome 返回头同高对齐（PF-1 S-2/S-3 权威 token，评审修复遗留 53px 孤值） */
	top: var(--twitter-header-height);
	z-index: 9;
	display: flex;
	height: 48px;
	background: color-mix(in srgb, var(--twitter-bg) 90%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.tab {
	position: relative;
	display: flex;
	flex: 1 1 0;
	align-items: center;
	justify-content: center;
	min-width: 0;
	height: 100%;
	padding: 0 10px;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	font-weight: 700;
	line-height: 1;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&::after {
		content: "";
		position: absolute;
		right: 12px;
		bottom: 0;
		left: 12px;
		height: 4px;
		border-radius: var(--twitter-radius-pill) var(--twitter-radius-pill) 0 0;
		background: var(--twitter-accent);
		opacity: 0;
		transform: scaleX(0.4);
		transition:
			opacity var(--twitter-duration-fast) ease,
			transform var(--twitter-duration-normal) var(--twitter-ease);
	}

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 6%, transparent);
		color: var(--twitter-fg);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}

	&[aria-current="page"] {
		color: var(--twitter-fg);

		&::after {
			opacity: 1;
			transform: scaleX(1);
		}
	}
}

.tabTitle {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.pinned {
	border-bottom: solid 1px var(--twitter-border);
}

.timelinePane {
	min-height: 50vh;
}

.timeline {
	min-height: 50vh;
}

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.mobile {
	.tabs {
		height: 46px;
	}

	.tab {
		padding: 0 var(--twitter-space-2);
		font-size: var(--twitter-font-size-meta);
	}
}

@media (prefers-reduced-motion: reduce) {
	.tab,
	.tab::after {
		transition: none;
	}
}
</style>
