<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, $style[`variant_${variant}`]]" role="status" :aria-label="i18n.ts.loading">
	<!-- 列表形态：时间线 / 通知（行结构随 variant 变化） -->
	<template v-if="variant === 'timeline' || variant === 'notifications'">
		<div v-for="row in rows" :key="row" :class="$style.row">
			<div :class="$style.avatar"></div>
			<div :class="$style.lines">
				<div :class="[$style.line, $style.short]"></div>
				<div :class="$style.line"></div>
				<div v-if="variant === 'timeline'" :class="[$style.line, $style.medium]"></div>
			</div>
		</div>
	</template>

	<!-- 帖子详情形态：头部行 + 正文行 + 操作栏 -->
	<template v-else-if="variant === 'detail'">
		<div :class="$style.detailHeader">
			<div :class="$style.avatar"></div>
			<div :class="$style.lines">
				<div :class="[$style.line, $style.short]"></div>
				<div :class="[$style.line, $style.medium]"></div>
			</div>
		</div>
		<div :class="$style.detailBody">
			<div :class="$style.line"></div>
			<div :class="$style.line"></div>
			<div :class="[$style.line, $style.medium]"></div>
		</div>
		<div :class="$style.detailActions">
			<div v-for="action in 4" :key="action" :class="$style.actionCircle"></div>
		</div>
	</template>

	<!-- 用户主页形态：banner + 大头像 + 身份行 + tabs -->
	<template v-else>
		<div :class="$style.profileBanner"></div>
		<div :class="$style.profileAvatar"></div>
		<div :class="$style.profileIdentity">
			<div :class="[$style.line, $style.short]"></div>
			<div :class="[$style.line, $style.medium]"></div>
			<div :class="[$style.line, $style.medium]"></div>
		</div>
		<div :class="$style.profileTabs">
			<div v-for="tab in 4" :key="tab" :class="[$style.tab, tab === 1 ? $style.tabActive : '']"></div>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
/**
 * 文件领域：Twitter UI · 基础组件 · 页面加载骨架屏
 *
 * 作用：以与内容同构的骨架块统一呈现必做页面的 loading 态（X-behavior），
 * 只接收 domain 权威变体类型，不含业务逻辑（规范组件层 #1）。
 *
 * 数据链角色：页面取数 fetching 状态 → 本组件（加载态呈现）；
 * 收敛并替代原 TimelineState 时代的 MkLoading 转圈与 NotificationSkeleton。
 */

import { computed } from 'vue';
import type { TwitterPageSkeletonVariant } from '@/ui/twitter/domain/page-state.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	/** 骨架形态变体（domain 权威类型）。 */
	variant: TwitterPageSkeletonVariant;
}>();

/** 按变体解析渲染行数（列表形态固定行数，非列表形态不适用）。 */
const rows = computed<number>(() => props.variant === 'notifications' ? 6 : 4);
</script>

<style lang="scss" module>
.root {
	background: var(--twitter-bg);
}

.row {
	display: grid;
	grid-template-columns: 48px minmax(0, 1fr);
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-bottom: solid 0.5px var(--twitter-border);

	&:last-child {
		border-bottom: none;
	}
}

.variant_notifications .row {
	grid-template-columns: 32px minmax(0, 1fr);
	padding: 18px 16px;
}

.avatar,
.line,
.actionCircle,
.profileBanner,
.profileAvatar,
.profileTabs .tab {
	background: var(--twitter-skeleton-block);
}

.avatar,
.line,
.actionCircle,
.profileAvatar,
.profileTabs .tab {
	animation: twitterPageSkeletonPulse var(--twitter-duration-skeleton) ease-in-out infinite;
}

.avatar {
	width: 48px;
	height: 48px;
	border-radius: var(--twitter-radius-pill);
}

.variant_notifications .avatar {
	width: 32px;
	height: 32px;
}

.lines {
	display: grid;
	gap: 10px;
	align-content: center;
}

.line {
	height: 10px;
	border-radius: var(--twitter-radius-pill);
}

.short {
	width: 40%;
}

.medium {
	width: 70%;
}

.detailHeader {
	display: grid;
	grid-template-columns: 48px minmax(0, 1fr);
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-4) var(--twitter-space-4) 0;
}

.detailBody {
	display: grid;
	gap: 10px;
	padding: var(--twitter-space-4);
}

.detailActions {
	display: flex;
	justify-content: space-between;
	max-width: 440px;
	margin: 0 auto;
	padding: 8px 40px 20px;
	box-sizing: border-box;
}

.actionCircle {
	width: 36px;
	height: 36px;
	border-radius: var(--twitter-radius-pill);
}

.profileBanner {
	height: 150px;
}

.profileAvatar {
	width: 80px;
	height: 80px;
	margin: -32px 0 0 16px;
	border: solid 4px var(--twitter-bg);
	border-radius: var(--twitter-radius-pill);
	box-sizing: border-box;
}

.profileIdentity {
	display: grid;
	gap: 10px;
	padding: var(--twitter-space-3) var(--twitter-space-4);
}

.profileTabs {
	display: flex;
	gap: var(--twitter-space-6);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-top: solid 0.5px var(--twitter-border);

	.tab {
		height: 8px;
		width: 48px;
		border-radius: var(--twitter-radius-pill);
	}

	.tabActive {
		width: 56px;
	}
}

@keyframes twitterPageSkeletonPulse {
	0% { opacity: 0.45; }
	50% { opacity: 0.85; }
	100% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
	.avatar,
	.line,
	.actionCircle,
	.profileAvatar,
	.profileTabs .tab {
		animation: none;
	}
}
</style>
