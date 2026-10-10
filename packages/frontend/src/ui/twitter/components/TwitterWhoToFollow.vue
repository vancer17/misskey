<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section v-if="users.length > 0" :class="$style.root" :aria-label="i18n.ts.whoToFollow">
	<h2 :class="$style.heading">{{ i18n.ts.whoToFollow }}</h2>
	<article v-for="user in users" :key="user.id" :class="$style.item">
		<MkA :class="$style.identity" :to="userPage(user)" :aria-label="acct(user)">
			<MkAvatar :class="$style.avatar" :user="user"/>
			<span :class="$style.account">
				<span :class="$style.name"><MkUserName :user="user" :nowrap="true"/></span>
				<span :class="$style.acct">@{{ acct(user) }}</span>
			</span>
		</MkA>
		<MkFollowButton
			v-if="$i != null && $i.id !== user.id"
			:class="$style.follow"
			:user="user"
			variant="twitter"
			full
		/>
	</article>
</section>
<div v-else-if="isLoading" :class="$style.root" role="status" :aria-label="i18n.ts.loading">
	<h2 :class="$style.heading">{{ i18n.ts.whoToFollow }}</h2>
	<div v-for="row in RIGHT_RAIL_LIMITS.recommendedUsers" :key="row" :class="$style.skeletonRow">
		<span :class="$style.skeletonAvatar"></span>
		<div :class="$style.skeletonLines">
			<span :class="[$style.skeletonLine, $style.skeletonLineWide]"></span>
			<span :class="[$style.skeletonLine, $style.skeletonLineNarrow]"></span>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
/**
 * 文件领域：Twitter UI · 业务组件 · 右栏推荐关注卡
 *
 * 作用：呈现推荐关注用户（主源 users/recommendation，备源实例置顶用户），
 * 点击身份区跳转用户主页，关注操作复用 MkFollowButton 的 twitter 表现
 * 变体（组件内部业务逻辑不在本组件重复，代码规范补充说明 #3）。
 * 无推荐结果（主备源均空）时整卡静默收起。
 *
 * 数据链角色：use-recommended-users 组合函数（降级链取数）→ 本组件
 * （只读展示 UserDetailed 权威模型）；组件自身不持有业务状态。
 *
 * 形制来源说明：nitter 无右栏与推荐域（检索证据见 port-fidelity-audit.md
 * P-23 登记节），行形制为 X-behavior 紧凑形态（40px 头像、无 bio），
 * 与主列 UserResult（nitter 权威 48px + bio）区分，成文见 ADR-0004；
 * 不设「显示更多」入口（目标页 explore 未 Twitter 化，防止路由级泄漏回流）。
 */

import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { acct, userPage } from '@/filters/user.js';
import MkFollowButton from '@/components/MkFollowButton.vue';
import { useRecommendedUsers } from '../composables/use-recommended-users.js';
import { RIGHT_RAIL_LIMITS } from '../domain/index.js';

const { users, isLoading } = useRecommendedUsers();
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
	grid-template-columns: minmax(0, 1fr) auto;
	gap: var(--twitter-space-2);
	align-items: center;
	padding: var(--twitter-space-2) var(--twitter-space-4);
	border-top: solid 1px var(--twitter-border);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: var(--twitter-hover);
	}
}

.identity {
	display: grid;
	/* X 右栏紧凑行头像 40px（B 类 X-behavior，ADR-0004；主列用户行仍为
	   nitter 权威 48px，两者形制分属不同域） */
	grid-template-columns: 40px minmax(0, 1fr);
	gap: var(--twitter-space-2);
	align-items: center;
	min-width: 0;
	color: inherit;
	text-decoration: none;
}

.avatar {
	width: 40px;
	height: 40px;
}

.account {
	display: grid;
	gap: 1px;
	min-width: 0;
}

.name {
	overflow: hidden;
	color: var(--twitter-fg);
	/* nitter 地面真值：fullname 14px / 700（PF-2 N-5 裁决派生） */
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.acct {
	overflow: hidden;
	color: var(--twitter-secondary-fg);
	/* nitter 地面真值：username 继承 body 15px（PF-2 N-5 裁决派生） */
	font-size: var(--twitter-font-size-content);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.skeletonRow {
	display: grid;
	grid-template-columns: 40px minmax(0, 1fr);
	gap: var(--twitter-space-2);
	align-items: center;
	/* 10px 为骨架行纵向内距的 X 近似值（阶梯外例外，B 类成文 ADR-0004） */
	padding: 10px var(--twitter-space-4);
	border-top: solid 1px var(--twitter-border);
}

.skeletonAvatar,
.skeletonLine {
	background: var(--twitter-skeleton-block);
	animation: twitterWhoToFollowSkeletonPulse var(--twitter-duration-skeleton) ease-in-out infinite;
}

.skeletonAvatar {
	width: 40px;
	height: 40px;
	border-radius: var(--twitter-radius-pill);
}

.skeletonLines {
	display: grid;
	gap: var(--twitter-space-2);
}

.skeletonLine {
	height: 10px;
	border-radius: var(--twitter-radius-pill);
}

.skeletonLineWide {
	width: 60%;
}

.skeletonLineNarrow {
	width: 40%;
}

@keyframes twitterWhoToFollowSkeletonPulse {
	0% { opacity: 0.45; }
	50% { opacity: 0.85; }
	100% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
	.skeletonAvatar,
	.skeletonLine {
		animation: none;
	}
}
</style>
