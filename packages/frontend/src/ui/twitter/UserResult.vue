<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article :class="$style.root">
	<MkA :class="$style.identity" :to="userPage(user)" :aria-label="acct(user)">
		<MkAvatar :class="$style.avatar" :user="user" indicator/>
		<span :class="$style.account">
			<span :class="$style.nameRow">
				<span :class="$style.name"><MkUserName :user="user" :nowrap="true"/></span>
				<i v-if="user.isBot" :class="$style.badge" class="ti ti-robot" aria-hidden="true"></i>
			</span>
			<span :class="$style.acct">@{{ acct(user) }}</span>
		</span>
	</MkA>

	<div :class="$style.body">
			<div v-if="user.description" :class="$style.description">
				<Mfm :text="user.description" :isNote="false" :author="user"/>
		</div>
		<p v-else :class="$style.emptyDescription">{{ i18n.ts.noAccountDescription }}</p>
	</div>

	<MkFollowButton
		v-if="$i != null && $i.id !== user.id"
		:class="$style.follow"
		:user="user"
		variant="twitter"
	/>
</article>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import MkFollowButton from '@/components/MkFollowButton.vue';
import { acct, userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

defineProps<{
	user: Misskey.entities.UserDetailed;
}>();
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 4px 12px;
	align-items: start;
	min-height: 60px;
	padding: 12px 16px;
	border-bottom: solid 0.5px var(--twitter-border);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
	}

	&:has(.identity:hover) {
		background: color-mix(in srgb, var(--twitter-fg) 6%, transparent);
	}
}

.identity {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr);
	gap: 12px;
	align-items: center;
	min-width: 0;
	color: inherit;
	text-decoration: none;
}

.avatar {
	width: 44px;
	height: 44px;
}

.account {
	display: grid;
	gap: 1px;
	min-width: 0;
}

.nameRow {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
}

.name {
	overflow: hidden;
	color: var(--twitter-fg);
	font-weight: 700;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.badge {
	flex-shrink: 0;
	color: var(--twitter-secondary-fg);
}

.acct {
	overflow: hidden;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.body {
	grid-column: 1;
	min-width: 0;
	color: var(--twitter-fg);
	font-size: 14px;
	line-height: 1.4;
}

.description {
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
}

.emptyDescription {
	margin: 0;
	color: var(--twitter-secondary-fg);
}

.follow {
	grid-column: 2;
	grid-row: 1;
}

@media (max-width: 500px) {
	.root {
		grid-template-columns: minmax(0, 1fr);
		padding: 12px;
	}

	.identity {
		grid-template-columns: 40px minmax(0, 1fr);
	}

	.avatar {
		width: 40px;
		height: 40px;
	}

	.follow {
		grid-column: 1;
		grid-row: auto;
		justify-self: end;
	}
}
</style>
