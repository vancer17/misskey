<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="note == null" :class="[$style.root, $style.deleted]">
	{{ i18n.ts.deletedNote }}
</div>
<article v-else :class="$style.root" :aria-label="i18n.ts.quote">
	<header :class="$style.header">
		<MkAvatar :class="$style.avatar" :user="note.user" link preview/>
		<MkA
			v-user-preview="note.user.id"
			:class="$style.name"
			:to="userPage(note.user)"
		>
			<MkUserName :user="note.user"/>
		</MkA>
		<span :class="$style.username"><MkAcct :user="note.user"/></span>
		<span aria-hidden="true">·</span>
		<MkTime :time="note.createdAt"/>
	</header>

	<div v-if="note.cw != null" :class="$style.cw">
		<Mfm v-if="note.cw !== ''" :text="note.cw" :author="note.user" :nyaize="'respect'" :emojiUrls="note.emojis"/>
		<MkA :class="$style.showMore" :to="notePage(note)">{{ i18n.ts.showMore }}</MkA>
	</div>
	<div v-else :class="$style.body">
		<Mfm
			v-if="note.text"
			:text="note.text"
			:author="note.user"
			:nyaize="'respect'"
			:emojiUrls="note.emojis"
		/>
		<div v-if="note.files?.length" :class="$style.meta">
			<i class="ti ti-photo" aria-hidden="true"></i>{{ i18n.ts.files }}
		</div>
		<div v-if="note.poll" :class="$style.meta">
			<i class="ti ti-chart-bar" aria-hidden="true"></i>{{ i18n.ts.poll }}
		</div>
		<div v-if="note.renoteId" :class="$style.meta">
			<i class="ti ti-quote" aria-hidden="true"></i>
			<MkA v-if="note.renote" :to="notePage(note.renote)">{{ i18n.ts.quote }}</MkA>
			<span v-else>{{ i18n.ts.deletedNote }}</span>
		</div>
	</div>
</article>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';

defineProps<{
	note: Misskey.entities.Note | null;
}>();
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	margin-top: 10px;
	padding: 10px 12px;
	border: solid 0.5px var(--twitter-border);
	border-radius: var(--twitter-radius-large);
	color: var(--twitter-fg);
	font-size: 14px;
	line-height: 1.4;
	overflow: clip;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
	}
}

.deleted {
	color: var(--twitter-secondary-fg);
	text-align: center;
}

.header {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	margin-bottom: 4px;
	color: var(--twitter-secondary-fg);
	white-space: nowrap;
}

.avatar {
	width: 20px;
	height: 20px;
}

.name {
	min-width: 0;
	overflow: hidden;
	font-weight: 700;
	color: var(--twitter-fg);
	text-decoration: none;
	text-overflow: ellipsis;

	&:hover {
		text-decoration: underline;
	}
}

.username {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.cw,
.body {
	min-width: 0;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.cw {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
}

.body {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 5;
}

.showMore {
	flex-shrink: 0;
	color: var(--twitter-accent);
	font-weight: 700;
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.meta {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-top: 6px;
	color: var(--twitter-secondary-fg);

	a {
		color: var(--twitter-accent);
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}
}
</style>
