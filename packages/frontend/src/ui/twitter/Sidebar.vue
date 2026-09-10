<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="[$style.root, { [$style.iconOnly]: iconOnly }]" :aria-label="i18n.ts._twitterUi.primaryNavigation">
	<div :class="$style.top">
		<MkA :class="$style.logo" to="/" :aria-label="instance.name ?? i18n.ts.timeline">
			<img :src="instance.iconUrl || '/favicon.ico'" alt="" :class="$style.logoIcon"/>
		</MkA>
	</div>

	<div :class="$style.items">
		<MkA
			:class="$style.item"
			:activeClass="$style.active"
			to="/"
			:aria-label="i18n.ts.timeline"
		>
			<i :class="$style.itemIcon" class="ti ti-home ti-fw"></i>
			<span :class="$style.itemText">{{ i18n.ts.timeline }}</span>
		</MkA>

		<MkA
			:class="$style.item"
			:activeClass="$style.active"
			to="/my/notifications"
			:aria-label="notificationAriaLabel"
		>
			<i :class="$style.itemIcon" class="ti ti-bell ti-fw"></i>
			<span :class="$style.itemText">{{ i18n.ts.notifications }}</span>
			<span v-if="notificationCount !== ''" :class="$style.indicator" aria-hidden="true">
				<span :class="$style.indicatorValue">{{ notificationCount }}</span>
			</span>
		</MkA>

		<MkA
			v-if="profilePath != null"
			:class="$style.item"
			:activeClass="$style.active"
			:to="profilePath"
			:aria-label="i18n.ts.profile"
		>
			<i :class="$style.itemIcon" class="ti ti-user ti-fw"></i>
			<span :class="$style.itemText">{{ i18n.ts.profile }}</span>
		</MkA>
	</div>

	<div :class="$style.bottom">
		<button
			class="_button"
			:class="$style.post"
			data-testid="open-post-form"
			type="button"
			:aria-label="i18n.ts.note"
			@click="openPostForm"
		>
			<i class="ti ti-pencil ti-fw"></i>
			<span :class="$style.postText">{{ i18n.ts.note }}</span>
		</button>

		<button
			v-if="$i != null"
			class="_button"
			:class="$style.account"
			type="button"
			:aria-label="i18n.ts.account"
			@click="openAccountMenu"
		>
			<MkAvatar :user="$i" :class="$style.avatar"/>
		</button>
	</div>
</nav>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { getAccountMenu } from '@/accounts.js';

withDefaults(defineProps<{
	iconOnly?: boolean;
}>(), {
	iconOnly: false,
});

const profilePath = computed(() => $i != null ? `/@${$i.username}` : null);
const notificationCount = computed(() => {
	if ($i == null || $i.unreadNotificationsCount === 0) return '';

	return $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount.toString();
});
const notificationAriaLabel = computed(() => notificationCount.value === ''
	? i18n.ts.notifications
	: i18n.tsx._twitterUi.notificationsWithCount({ count: notificationCount.value }));

function openPostForm() {
	os.post();
}

async function openAccountMenu(ev: PointerEvent) {
	if ($i == null) return;

	const menuItems = await getAccountMenu({
		withExtraOperation: true,
	});

	os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 12px;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	padding: 8px;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.top,
.bottom {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.items {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.logo {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 52px;
	height: 52px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.logoIcon {
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-medium);
}

.item {
	position: relative;
	display: flex;
	align-items: center;
	gap: 16px;
	min-height: 52px;
	padding: 0 16px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	font-size: 20px;
	line-height: 1;
	text-decoration: none;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover,
	&:focus-visible,
	&.active {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&.active {
		font-weight: 700;
	}
}

.itemIcon {
	flex-shrink: 0;
	font-size: 24px;
}

.itemText {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.indicator {
	position: relative;
	margin-left: auto;
	color: var(--MI_THEME-indicator);
	font-size: 11px;
	line-height: 1;
	pointer-events: none;
}

.indicatorValue {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	border-radius: var(--twitter-radius-pill);
	background: var(--MI_THEME-indicator);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 11px;
	font-weight: 700;
}

.post {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: 52px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 17px;
	font-weight: 700;
	transition:
		background-color var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-fast) var(--twitter-ease);

	&:hover,
	&:focus-visible {
		background: var(--twitter-accent-hover);
	}

	&:active {
		transform: scale(0.97);
	}
}

.postText {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.account {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 52px;
	height: 52px;
	border-radius: var(--twitter-radius-pill);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.avatar {
	width: 40px;
	height: 40px;
}

.iconOnly {
	.logo,
	.item,
	.post,
	.account {
		width: 52px;
		padding: 0;
	}

	.item,
	.post {
		justify-content: center;
		gap: 0;
	}

	.itemText,
	.postText {
		display: none;
	}

	.item {
		.indicator {
			position: absolute;
			top: 5px;
			right: 5px;
			margin-left: 0;
		}
	}
}

@media (prefers-reduced-motion: reduce) {
	.item,
	.post {
		transition: none;
	}

	.post:active {
		transform: none;
	}
}
</style>
