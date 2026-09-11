<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
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
				<TwitterTimelineState/>
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
import TwitterTimelineState from '@/ui/twitter/TimelineState.vue';
import { Paginator } from '@/utility/paginator.js';
import { userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	user: Misskey.entities.UserDetailed;
	page?: string;
}>(), {
	page: 'notes',
});

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
	top: 53px;
	z-index: 9;
	display: flex;
	height: 48px;
	background: color-mix(in srgb, var(--twitter-bg) 90%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
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
	border-bottom: solid 0.5px var(--twitter-border);
}

.timelinePane {
	min-height: 50vh;
}

.timeline {
	min-height: 50vh;
}

@media (max-width: 500px) {
	.tabs {
		height: 46px;
	}

	.tab {
		padding: 0 8px;
		font-size: 13px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.tab,
	.tab::after {
		transition: none;
	}
}
</style>
