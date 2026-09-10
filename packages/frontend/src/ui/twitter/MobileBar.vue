<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="$style.root" :aria-label="i18n.ts._twitterUi.primaryNavigation">
	<MkA
		:class="$style.item"
		:activeClass="$style.active"
		to="/"
		:aria-label="i18n.ts.timeline"
	>
		<i class="ti ti-home ti-fw" aria-hidden="true"></i>
	</MkA>

	<MkA
		:class="$style.item"
		:activeClass="$style.active"
		to="/search"
		:aria-label="i18n.ts.search"
	>
		<i class="ti ti-search ti-fw" aria-hidden="true"></i>
	</MkA>

	<MkA
		:class="$style.item"
		:activeClass="$style.active"
		to="/my/notifications"
		:aria-label="notificationAriaLabel"
	>
		<i class="ti ti-bell ti-fw" aria-hidden="true"></i>
		<span v-if="notificationCount !== ''" :class="$style.indicator" aria-hidden="true"></span>
	</MkA>

	<MkA
		v-if="profilePath != null"
		:class="$style.item"
		:activeClass="$style.active"
		:to="profilePath"
		:aria-label="i18n.ts.profile"
	>
		<i class="ti ti-user ti-fw" aria-hidden="true"></i>
	</MkA>
</nav>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

const profilePath = computed(() => $i != null ? `/@${$i.username}` : null);
const notificationCount = computed(() => {
	if ($i == null || $i.unreadNotificationsCount === 0) return '';

	return $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount.toString();
});
const notificationAriaLabel = computed(() => notificationCount.value === ''
	? i18n.ts.notifications
	: i18n.tsx._twitterUi.notificationsWithCount({ count: notificationCount.value }));

onMounted(() => {
	window.document.body.style.setProperty('--MI-minBottomSpacing', 'var(--MI-minBottomSpacingMobile)');
});

onBeforeUnmount(() => {
	window.document.body.style.setProperty('--MI-minBottomSpacing', '0px');
});
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	height: 56px;
	padding-bottom: env(safe-area-inset-bottom, 0px);
	background: var(--twitter-bg);
	border-top: solid 0.5px var(--twitter-border);
}

.item {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 48px;
	font-size: 22px;
	color: var(--twitter-fg);
	text-decoration: none;

	&.active {
		color: var(--twitter-accent);
	}
}

.indicator {
	position: absolute;
	top: 10px;
	right: calc(50% - 22px);
	width: 8px;
	height: 8px;
	border-radius: var(--twitter-radius-pill);
	background: var(--MI_THEME-indicator);
}
</style>
