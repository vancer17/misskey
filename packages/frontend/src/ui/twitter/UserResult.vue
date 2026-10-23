<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 紧凑身份展示。
作用：保留原头像交互，将紧凑头像明确接入不显示挂件的展示场景。
数据链：既有用户投影 → Twitter 头像包装 → 无装饰身份展示，不改写用户事实。
-->

<template>
<article :class="[$style.root, { [$style.mobile]: isMobile }]">
	<MkA :class="$style.identity" :to="userPage(user)" :aria-label="acct(user)">
		<TwitterAvatar decorationContext="none" :class="$style.avatar" :user="user" indicator/>
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
				<!-- 使用 MFM 既有标签导航参数，使 Twitter 用户简介中的标签进入帖子结果页。 -->
				<Mfm :text="user.description" :isNote="true" :author="user"/>
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
import TwitterAvatar from './components/TwitterAvatar.vue';
import * as Misskey from 'misskey-js';
import MkFollowButton from '@/components/MkFollowButton.vue';
import { acct, userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile } = useTwitterLayout();

defineProps<{
	user: Misskey.entities.UserDetailed;
}>();
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: var(--twitter-space-1) var(--twitter-space-3);
	align-items: start;
	/* nitter 地面真值：timeline-item 内距 12px 四向一致（N-2）+ profile-result min-height 54px（PF-2 U-5 裁决：对齐） */
	min-height: 54px;
	padding: var(--twitter-space-3);
	border-bottom: solid 1px var(--twitter-border);
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
	/* nitter 地面真值：用户行头像 _bigger 48×48（tweet/_base.scss .tweet-avatar） */
	grid-template-columns: 48px minmax(0, 1fr);
	gap: var(--twitter-space-3);
	align-items: center;
	min-width: 0;
	color: inherit;
	text-decoration: none;
}

.avatar {
	width: 48px;
	height: 48px;
}

.account {
	display: grid;
	gap: 1px;
	min-width: 0;
}

.nameRow {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	min-width: 0;
}

.name {
	overflow: hidden;
	color: var(--twitter-fg);
	/* nitter 地面真值：fullname 14px / 700（PF-2 N-5 裁决：对齐） */
	font-size: var(--twitter-font-size-body);
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
	/* nitter 地面真值：username 继承 body 15px（PF-2 N-5 裁决：对齐） */
	font-size: var(--twitter-font-size-content);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.body {
	grid-column: 1;
	min-width: 0;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-body);
	/* nitter 地面真值：行高 1.3（PF-2 N-3 裁决：对齐） */
	line-height: 1.3;
}

.description {
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	/* nitter 地面真值：行高 1.3（PF-2 N-3 裁决：对齐） */
	line-height: 1.3;
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

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.root.mobile {
	grid-template-columns: minmax(0, 1fr);
	padding: var(--twitter-space-3);

	.identity {
		/* nitter 无移动端头像收缩（PF-2 N-9 裁决：对齐 48px） */
		grid-template-columns: 48px minmax(0, 1fr);
	}

	.avatar {
		width: 48px;
		height: 48px;
	}

	.follow {
		grid-column: 1;
		grid-row: auto;
		justify-self: end;
	}
}
</style>
