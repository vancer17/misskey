<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
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
import { computed, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import TwitterNote from '@/ui/twitter/Note.vue';
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

type TimelineTab = 'notes' | 'replies' | 'files' | 'featured';

const tabs = [{
	key: 'notes',
	title: i18n.ts.notes,
}, {
	key: 'replies',
	title: i18n.ts.replies,
}, {
	key: 'files',
	title: i18n.ts.withFiles,
}, {
	key: 'featured',
	title: i18n.ts.featured,
}] as const satisfies ReadonlyArray<{
	key: TimelineTab;
	title: string;
}>;

const activeTab = computed<TimelineTab>(() => {
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

const paginators = {
	notes: markRaw(new Paginator('users/notes', {
		limit: 20,
		params: {
			userId: props.user.id,
			withRenotes: true,
			withReplies: false,
			withChannelNotes: true,
		},
	})),
	replies: markRaw(new Paginator('users/notes', {
		limit: 20,
		params: {
			userId: props.user.id,
			withRenotes: false,
			withReplies: true,
			withChannelNotes: false,
		},
	})),
	files: markRaw(new Paginator('users/notes', {
		limit: 20,
		params: {
			userId: props.user.id,
			withRenotes: false,
			withReplies: true,
			withChannelNotes: true,
			withFiles: true,
		},
	})),
	featured: markRaw(new Paginator('users/featured-notes', {
		limit: 20,
		params: {
			userId: props.user.id,
		},
	})),
};

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
