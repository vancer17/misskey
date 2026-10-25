<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 移动主导航。
作用：呈现稳定的页面入口与未读提示，交互意图仅提前加载目标页面代码。
数据链：账户事实 → 导航展示；聚焦或触控意图 → 代码缓存，不请求业务数据。
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
		@mouseenter="preloadTwitterNotificationsPage"
		@focus="preloadTwitterNotificationsPage"
		@pointerdown="preloadTwitterNotificationsPage"
	>
		<i class="ti ti-bell ti-fw" aria-hidden="true"></i>
		<span v-if="notificationCount !== ''" :class="$style.indicator" aria-hidden="true"></span>
	</MkA>

	<MkA
		v-if="$i != null && $i.policies.chatAvailability !== 'unavailable'"
		:class="$style.item"
		:activeClass="$style.active"
		to="/chat"
		:aria-label="chatAriaLabel"
		data-testid="twitter-messages-nav"
	>
		<i class="ti ti-messages ti-fw" aria-hidden="true"></i>
		<span v-if="$i.hasUnreadChatMessages" :class="$style.indicator" aria-hidden="true"></span>
	</MkA>

	<MkA
		v-if="profilePath != null"
		:class="$style.item"
		:activeClass="$style.active"
		:to="profilePath"
		:aria-label="i18n.ts.profile"
		@mouseenter="preloadTwitterUserPage"
		@focus="preloadTwitterUserPage"
		@pointerdown="preloadTwitterUserPage"
	>
		<i class="ti ti-user ti-fw" aria-hidden="true"></i>
	</MkA>
</nav>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type { ComputedRef } from 'vue';
import { preloadTwitterNotificationsPage, preloadTwitterUserPage } from './routing/index.js';
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

/** 账号未读事实统一来自既有账户状态，聊天内容不参与导航判定。 */
const chatAriaLabel: ComputedRef<string> = computed(/** 点状未读使用文字名称向辅助技术说明。 */ (): string => $i?.hasUnreadChatMessages
	? `${i18n.ts.directMessage_short} (${i18n.ts.unread})` : i18n.ts.directMessage_short);

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
	grid-auto-flow: column;
	grid-auto-columns: minmax(0, 1fr);
	height: var(--twitter-bottom-bar-height);
	padding-right: env(safe-area-inset-right, 0px);
	padding-left: env(safe-area-inset-left, 0px);
	padding-bottom: env(safe-area-inset-bottom, 0px);
	background: var(--twitter-bg);
	border-top: solid 1px var(--twitter-border);
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
