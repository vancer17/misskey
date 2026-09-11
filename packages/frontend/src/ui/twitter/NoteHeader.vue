<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div :class="$style.identity">
		<MkA
			v-if="!mock"
			v-user-preview="note.user.id"
			:class="$style.name"
			:to="userPage(note.user)"
		>
			<MkUserName :user="note.user"/>
		</MkA>
		<span v-else :class="$style.name"><MkUserName :user="note.user"/></span>

		<span v-if="note.user.isBot" :class="$style.bot">bot</span>
		<span
			v-for="(role, index) in note.user.badgeRoles"
			:key="index"
			v-tooltip="role.name"
			:class="$style.badgeRole"
		>
			<img v-if="role.iconUrl" :src="role.iconUrl" :alt="role.name">
		</span>
	</div>

	<div :class="$style.meta">
		<span :class="$style.username"><MkAcct :user="note.user"/></span>
		<span aria-hidden="true">·</span>
		<MkA v-if="!mock" :to="notePage(note)"><MkTime :time="note.createdAt"/></MkA>
		<span v-else><MkTime :time="note.createdAt"/></span>

		<span
			v-if="note.visibility !== 'public'"
			:class="$style.visibility"
			:title="i18n.ts._visibility[note.visibility]"
		>
			<i v-if="note.visibility === 'home'" class="ti ti-home"></i>
			<i v-else-if="note.visibility === 'followers'" class="ti ti-lock"></i>
			<i v-else-if="note.visibility === 'specified'" class="ti ti-mail"></i>
		</span>
		<span
			v-if="note.localOnly"
			:class="$style.visibility"
			:title="i18n.ts._visibility['disableFederation']"
		>
			<i class="ti ti-rocket-off"></i>
		</span>
	</div>

	<div v-if="$slots.menu" :class="$style.menu">
		<slot name="menu"></slot>
	</div>
</header>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';

defineProps<{
	note: Misskey.entities.Note;
	mock?: boolean;
}>();
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	margin-bottom: 2px;
	line-height: 1.25;
}

.identity {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	flex-shrink: 1;
}

.name {
	min-width: 0;
	overflow: hidden;
	font-weight: 700;
	color: var(--twitter-fg);
	text-decoration: none;
	text-overflow: ellipsis;
	white-space: nowrap;

	&:hover {
		text-decoration: underline;
	}
}

.bot {
	flex-shrink: 0;
	padding: 0 4px;
	border: solid 0.5px var(--twitter-border);
	border-radius: var(--twitter-radius-small);
	color: var(--twitter-secondary-fg);
	font-size: 11px;
	line-height: 16px;
}

.badgeRole {
	display: inline-flex;
	align-items: center;
	flex-shrink: 0;
	height: 16px;

	img {
		height: 14px;
	}
}

.meta {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	white-space: nowrap;
}

.username {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.visibility {
	display: inline-flex;
	color: var(--twitter-secondary-fg);
}

.menu {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	margin-left: auto;
}
</style>
