<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkAvatar :class="$style.avatar" :user="note.user" :link="!mock" :preview="!mock"/>
	<i :class="['ti ti-repeat', $style.icon]" aria-hidden="true"></i>
	<I18n :src="i18n.ts.renotedBy" tag="span" :class="$style.text">
		<template #user>
			<MkA
				v-if="!mock"
				v-user-preview="note.userId"
				:class="$style.user"
				:to="userPage(note.user)"
			>
				<MkUserName :user="note.user"/>
			</MkA>
			<span v-else :class="$style.user"><MkUserName :user="note.user"/></span>
		</template>
	</I18n>

	<div v-if="$slots.menu" :class="$style.menu">
		<slot name="menu"></slot>
	</div>
</div>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
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
	gap: 8px;
	min-width: 0;
	padding: 10px 16px 0 calc(16px + 16px);
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	font-weight: 700;
	line-height: 20px;

	@media (max-width: 500px) {
		padding-right: 12px;
		padding-left: calc(12px + 16px);
	}
}

.avatar {
	width: 20px;
	height: 20px;
}

.icon {
	flex-shrink: 0;
	color: var(--twitter-secondary-fg);
}

.text {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.user {
	color: var(--twitter-fg);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.menu {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	margin-left: auto;
}
</style>
