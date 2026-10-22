<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI 基础加载呈现。
作用：使用既有布局 Token 呈现列表、帖子详情和用户资料骨架。
数据链：页面请求状态与公开骨架变体 → 占位几何；不保存或推断业务实体。
-->

<template>
<div :class="[$style.root, $style[`variant_${variant}`], { [$style.mobile]: isMobile }]" role="status" :aria-label="i18n.ts.loading">
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

import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useTwitterLayout } from '@/ui/twitter/index.js';
import type { TwitterLayoutState, TwitterPageSkeletonVariant } from '@/ui/twitter/index.js';
import { i18n } from '@/i18n.js';

/** 页面只传入公开骨架变体，尺寸继续由既有布局状态和 Token 派生。 */
const props: Readonly<{ variant: TwitterPageSkeletonVariant }> = defineProps<{
	/** 骨架形态变体（domain 权威类型）。 */
	variant: TwitterPageSkeletonVariant;
}>();

/** 复用 Shell 布局裁定，为资料骨架匹配真实资料的响应式头像。 */
const { isMobile }: TwitterLayoutState = useTwitterLayout();

/** 按变体解析渲染行数，骨架不建立列表业务状态。 */
const rows: ComputedRef<number> = computed(/** 通知密度与帖子密度分别保留既有行数。 */ (): number => props.variant === 'notifications' ? 6 : 4);
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
	border-bottom: solid 1px var(--twitter-border);

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

.variant_profile {
	--profileAvatarSize: var(--twitter-avatar-profile-size);
	--profileAvatarOverlap: 44px;

	&.mobile {
		--profileAvatarSize: var(--twitter-avatar-profile-mobile-size);
		--profileAvatarOverlap: 32px;
	}
}

.profileBanner {
	aspect-ratio: 3 / 1;
	max-height: 200px;
	width: 100%;
}

.profileAvatar {
	width: var(--profileAvatarSize);
	height: var(--profileAvatarSize);
	margin: calc(-1 * var(--profileAvatarOverlap)) 0 0 16px;
	border: solid var(--twitter-avatar-profile-border-width) var(--twitter-bg);
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
	border-top: solid 1px var(--twitter-border);

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
