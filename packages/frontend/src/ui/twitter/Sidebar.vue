<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI · 桌面主导航。
作用：呈现页面入口、未读提示与紧凑账户操作，入口交互意图仅预热目标页面代码。
数据链：账户事实 → 导航展示；聚焦或指针意图 → 代码缓存，不请求或复制业务数据。
布局：整行链接承接点击，内容胶囊承接视觉反馈；完整侧栏发帖按钮占内宽的九成。
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
			<span :class="$style.itemContent">
				<i :class="$style.itemIcon" class="ti ti-home ti-fw"></i>
				<span :class="$style.itemText">{{ i18n.ts.timeline }}</span>
			</span>
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
			<span :class="$style.itemContent">
				<i :class="$style.itemIcon" class="ti ti-bell ti-fw"></i>
				<span :class="$style.itemText">{{ i18n.ts.notifications }}</span>
				<span v-if="notificationCount !== ''" :class="$style.indicator" aria-hidden="true">
					<span :class="$style.indicatorValue">{{ notificationCount }}</span>
				</span>
			</span>
		</MkA>

		<MkA
			v-if="$i != null && $i.policies.chatAvailability !== 'unavailable'"
			:class="$style.item"
			:activeClass="$style.active"
			to="/chat"
			:aria-label="chatAriaLabel"
			data-testid="twitter-messages-nav"
		>
			<span :class="$style.itemContent">
				<i :class="$style.itemIcon" class="ti ti-messages ti-fw" aria-hidden="true"></i>
				<span :class="$style.itemText">{{ i18n.ts.directMessage_short }}</span>
				<span v-if="$i.hasUnreadChatMessages" :class="$style.chatUnread" aria-hidden="true"></span>
			</span>
		</MkA>

		<!-- 频道入口（P-25 可达性补全）：对齐 X Communities 侧栏项（位于 Profile 前）；
			X 对未加入任何 Community 的用户收纳入口，此处按 Misskey 频道为核心功能常驻显示
			（已记录偏离，见 port-fidelity-audit CH-10）。 -->
		<MkA
			:class="$style.item"
			:activeClass="$style.active"
			to="/channels"
			:aria-label="i18n.ts.channel"
		>
			<span :class="$style.itemContent">
				<i :class="$style.itemIcon" class="ti ti-device-tv ti-fw"></i>
				<span :class="$style.itemText">{{ i18n.ts.channel }}</span>
			</span>
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
			<span :class="$style.itemContent">
				<i :class="$style.itemIcon" class="ti ti-user ti-fw"></i>
				<span :class="$style.itemText">{{ i18n.ts.profile }}</span>
			</span>
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
			<TwitterAvatar decorationContext="none" :user="$i" :class="$style.avatar"/>
		</button>
	</div>
</nav>
</template>

<script lang="ts" setup>
import TwitterAvatar from './components/TwitterAvatar.vue';
import { preloadTwitterNotificationsPage, preloadTwitterUserPage } from './routing/index.js';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
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

/** 导航只投影账户服务端的未读布尔值，不从有限会话列表伪造未读数量。 */
const chatAriaLabel: ComputedRef<string> = computed(/** 未读提示提供可访问名称，点状徽标保持纯装饰。 */ (): string => $i?.hasUnreadChatMessages
	? `${i18n.ts.directMessage_short} (${i18n.ts.unread})` : i18n.ts.directMessage_short);

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
	gap: var(--twitter-space-3);
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	padding: var(--twitter-space-2);
	overflow-y: auto;
	overscroll-behavior: contain;
}

.top,
.bottom {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: var(--twitter-space-2);
}

.items {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: var(--twitter-space-1);
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
	width: 100%;
	min-width: 0;
	min-height: 52px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-heading);
	line-height: 1;
	text-decoration: none;

	&:hover,
	&:focus-visible,
	&.active {
		.itemContent {
			background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
		}
	}

	&.active {
		font-weight: 700;
	}
}

/** 内容胶囊按图标、标签和徽标收缩，整行链接继续承担导航点击。 */
.itemContent {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-4);
	width: fit-content;
	max-width: 100%;
	min-width: 0;
	min-height: 52px;
	box-sizing: border-box;
	padding: 0 var(--twitter-space-4);
	border-radius: var(--twitter-radius-pill);
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;
}

.itemIcon {
	flex-shrink: 0;
	font-size: var(--twitter-font-size-display);
}

.itemText {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.indicator {
	position: relative;
	flex-shrink: 0;
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

.chatUnread {
	flex-shrink: 0;
	width: var(--twitter-space-2);
	height: var(--twitter-space-2);
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
}

.post {
	display: flex;
	align-self: flex-start;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-2);
	width: 90%;
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
	.itemContent,
	.post,
	.account {
		width: 52px;
		padding: 0;
	}

	.itemContent,
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
	.itemContent,
	.post {
		transition: none;
	}

	.post:active {
		transform: none;
	}
}
</style>
