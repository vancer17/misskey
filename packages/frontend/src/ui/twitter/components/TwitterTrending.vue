<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section v-if="items.length > 0" :class="$style.root" :aria-label="i18n.ts.trending">
	<h2 :class="$style.heading">{{ i18n.ts.trending }}</h2>
	<MkA
		v-for="item in items"
		:key="item.tag"
		:class="$style.item"
		:to="`/tags/${encodeURIComponent(item.tag)}`"
	>
		<span :class="$style.tag">#{{ item.tag }}</span>
		<span :class="$style.count">{{ i18n.tsx.nUsers({ n: number(item.usersCount) }) }}</span>
	</MkA>
</section>
<div v-else-if="isLoading" :class="$style.root" role="status" :aria-label="i18n.ts.loading">
	<h2 :class="$style.heading">{{ i18n.ts.trending }}</h2>
	<div v-for="row in RIGHT_RAIL_LIMITS.trendingTags" :key="row" :class="$style.skeletonRow">
		<span :class="[$style.skeletonLine, $style.skeletonLineWide]"></span>
		<span :class="[$style.skeletonLine, $style.skeletonLineNarrow]"></span>
	</div>
</div>
</template>

<script lang="ts" setup>
/**
 * 文件领域：Twitter UI · 业务组件 · 右栏趋势卡
 *
 * 作用：呈现实例热门 hashtag（Top N），点击条目跳转 hashtag 结果页
 * （/tags/:tag，P-15 已 Twitter 化）；无趋势或取数失败时整卡静默收起，
 * 不占用右栏空间。
 *
 * 数据链角色：use-trending-tags 组合函数（取数 + 单向投影）→ 本组件
 * （只读展示）；组件自身不持有业务状态（代码规范组件层 #2 / #3）。
 *
 * 形制来源说明：nitter 无右栏与趋势域（检索证据见 port-fidelity-audit.md
 * P-23 登记节），卡片形制为 X-behavior，成文见 ADR-0004；不设
 * 「显示更多」入口（目标页 explore 未 Twitter 化，防止路由级泄漏回流）。
 */

import { i18n } from '@/i18n.js';
import number from '@/filters/number.js';
import { useTrendingTags } from '../composables/use-trending-tags.js';
import { RIGHT_RAIL_LIMITS } from '../domain/index.js';

const { items, isLoading } = useTrendingTags();
</script>

<style lang="scss" module>
.root {
	overflow: hidden;
	/* X 右栏卡形制：panel 底 + 16px 圆角（B 类 X-behavior，ADR-0004） */
	border-radius: var(--twitter-radius-large);
	background: var(--twitter-panel);
}

.heading {
	margin: 0;
	padding: var(--twitter-space-3) var(--twitter-space-4);
	color: var(--twitter-fg);
	/* X 右栏卡标题取 heading 档（20px，B 类成文 ADR-0004） */
	font-size: var(--twitter-font-size-heading);
	font-weight: 700;
}

.item {
	display: grid;
	gap: 2px;
	padding: var(--twitter-space-2) var(--twitter-space-4);
	border-top: solid 1px var(--twitter-border);
	text-decoration: none;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: var(--twitter-hover);
	}
}

.tag {
	color: var(--twitter-fg);
	/* 与主列条目主文字同族：content 档 15px / 700（N-5 裁决派生） */
	font-size: var(--twitter-font-size-content);
	font-weight: 700;
	overflow-wrap: anywhere;
}

.count {
	color: var(--twitter-secondary-fg);
	/* 次要文字 meta 档（nitter: 13px 档） */
	font-size: var(--twitter-font-size-meta);
}

.skeletonRow {
	display: grid;
	gap: var(--twitter-space-2);
	/* 10px 为骨架行纵向内距的 X 近似值（阶梯外例外，B 类成文 ADR-0004） */
	padding: 10px var(--twitter-space-4);
	border-top: solid 1px var(--twitter-border);
}

.skeletonLine {
	height: 10px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-skeleton-block);
	animation: twitterTrendingSkeletonPulse var(--twitter-duration-skeleton) ease-in-out infinite;
}

.skeletonLineWide {
	width: 55%;
}

.skeletonLineNarrow {
	width: 35%;
}

@keyframes twitterTrendingSkeletonPulse {
	0% { opacity: 0.45; }
	50% { opacity: 0.85; }
	100% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
	.skeletonLine {
		animation: none;
	}
}
</style>
