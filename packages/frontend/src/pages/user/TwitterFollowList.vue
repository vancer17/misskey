<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI · 用户关注关系列表页（P-12 正在关注 / P-13 关注者共享视图）

作用：消费页面层（following.vue / followers.vue）取得的用户实体与错误，
呈现紧凑返回头、Following / Followers 双 tab 与分页用户行列表，
关闭泄漏审计 A1 / A2 的路由级旧样式泄漏。

数据链角色：页面取数（users/show）→ 本组件（页面变体呈现）；
Paginator（users/following | users/followers 分页）→ TwitterUserResult（用户行）。
布局尺度地面真值：nitter renderUserList（views/profile.nim）与 timeline.scss
（timeline-container 600px、tab 下划线、行间 hairline、行内边距 12px）。
-->

<template>
<div v-if="user" ref="rootEl" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header">
				<div :class="$style.headerTop">
					<button
						:class="$style.back"
						class="_button"
						type="button"
						:aria-label="i18n.ts.goBack"
						@click="goBack"
					>
						<i class="ti ti-arrow-left" aria-hidden="true"></i>
					</button>
					<div :class="$style.headerMeta">
						<div :class="$style.headerName">
							<MkUserName :user="user" :nowrap="true"/>
						</div>
						<div :class="$style.headerCount">{{ headerCountLabel }}</div>
					</div>
				</div>

				<nav :class="$style.tabs" :aria-label="i18n.ts.user">
					<MkA
						:class="[$style.tab, { [$style.active]: type === 'following' }]"
						:to="userPage(user, 'following')"
						:aria-current="type === 'following' ? 'page' : undefined"
					>
						<span :class="$style.tabTitle">{{ i18n.ts.following }}</span>
					</MkA>
					<MkA
						:class="[$style.tab, { [$style.active]: type === 'followers' }]"
						:to="userPage(user, 'followers')"
						:aria-current="type === 'followers' ? 'page' : undefined"
					>
						<span :class="$style.tabTitle">{{ i18n.ts.followers }}</span>
					</MkA>
				</nav>
			</header>
		</template>

		<div :class="$style.body">
			<MkPagination :paginator="paginator">
				<template #empty>
					<TwitterPageState type="empty" :title="i18n.ts.noUsers"/>
				</template>
				<template #default="{ items }">
					<TwitterUserResult
						v-for="item in items"
						:key="item.id"
						:user="extractUser(item)"
					/>
				</template>
			</MkPagination>
		</div>
	</MkStickyContainer>
</div>
<TwitterPageState v-else-if="error" :type="errorStateType" @retry="emit('retry')"/>
<TwitterPageSkeleton v-else variant="timeline"/>
</template>

<script lang="ts" setup>
import { computed, markRaw, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import MkPagination from '@/components/MkPagination.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import {
	TwitterPageState,
	TwitterPageSkeleton,
	TwitterUserResult,
	twitterUserErrorStateType,
	useTwitterLayout,
} from '@/ui/twitter/index.js';
import type { TwitterPageStateType } from '@/ui/twitter/index.js';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';
import number from '@/filters/number.js';
import { userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';
import { Paginator } from '@/utility/paginator.js';

/** 关注关系列表类型：路由级固定（following = P-12，followers = P-13），实例生命周期内不变。 */
type TwitterFollowListType = 'following' | 'followers';

const props = defineProps<{
	/** 目标用户（页面层 users/show 权威实体；null 表示取数中）。 */
	user: Misskey.entities.UserDetailed | null;
	/** 列表类型：决定分页端点、行投影字段与 active tab。 */
	type: TwitterFollowListType;
	/** 页面层取用户错误（unknown：错误对象形态不由呈现层解释）。 */
	error?: unknown;
}>();

const emit = defineEmits<{
	/** 终态重试：转发至页面层重新执行 users/show。 */
	(ev: 'retry'): void;
}>();

const { isMobile } = useTwitterLayout();
const rootEl = useTemplateRef<HTMLDivElement>('rootEl');

/** 保留列表滚动位置（返回导航 / tab 互切后恢复）。 */
useScrollPositionKeeper(rootEl);

/**
 * 分页器：按列表类型绑定唯一端点（不创建未消费实例，规范第 9 条）；
 * userId 经 computedParams 随用户实体响应式重置。
 */
const paginator: Paginator<'users/following'> | Paginator<'users/followers'> = props.type === 'following'
	? markRaw(new Paginator<'users/following'>('users/following', {
		limit: 20,
		computedParams: computed(() => ({ userId: props.user?.id ?? '' })),
	}))
	: markRaw(new Paginator<'users/followers'>('users/followers', {
		limit: 20,
		computedParams: computed(() => ({ userId: props.user?.id ?? '' })),
	}));

/**
 * 将关注关系分页项单向投影为用户行模型（不回写、不复制业务状态）。
 *
 * @param item users/following | users/followers 分页项（同一 Following 形态）
 * @returns following 取 followee，followers 取 follower（服务端保证随行返回）
 */
function extractUser(item: Misskey.entities.Following): Misskey.entities.UserDetailedNotMe {
	return props.type === 'following' ? item.followee! : item.follower!;
}

/** 头部计数文案：由列表类型与用户实体单向派生。 */
const headerCountLabel = computed<string>(() => {
	if (props.user == null) return '';

	return props.type === 'following'
		? `${number(props.user.followingCount)} ${i18n.ts.following}`
		: `${number(props.user.followersCount)} ${i18n.ts.followers}`;
});

/** 终态派生：用户不存在 → notFound（不可重试），其余 → error（可重试）。权威派生见 domain/user-state.ts。 */
const errorStateType = computed<TwitterPageStateType>(() => twitterUserErrorStateType(props.error));

/** 返回上一页（与 TwitterHome / NotificationsHeader 一致的返回行为）。 */
function goBack(): void {
	window.history.back();
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);

	/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4）；
	 * 底部留白与 TwitterHome 一致，避免列表末行被 FAB 遮挡 */
	&.mobile {
		padding-bottom: calc(72px + env(safe-area-inset-bottom));
	}
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

/* 紧凑返回头：X-behavior 现代表现层（nitter 此页无返回头，属已记录偏离） */
.header {
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.headerTop {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr);
	align-items: center;
	height: var(--twitter-header-height);
}

.back {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	margin-left: var(--twitter-space-2);
	border-radius: var(--twitter-radius-pill);
	font-size: 17px;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.headerMeta {
	min-width: 0;
	padding-right: var(--twitter-space-2);
}

.headerName {
	overflow: hidden;
	font-size: var(--twitter-font-size-emphasis);
	font-weight: 800;
	line-height: 1.25;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.headerCount {
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
}

/* 双 tab：nitter .tab / .tab-item 地面真值（等分、居中、active 下划线强调） */
.tabs {
	display: flex;
	height: 50px;
	min-width: 0;
}

.tab {
	position: relative;
	display: flex;
	flex: 1 1 0;
	align-items: center;
	justify-content: center;
	min-width: 72px;
	height: 100%;
	padding: 0 var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	text-decoration: none;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&::after {
		content: "";
		position: absolute;
		right: var(--twitter-space-4);
		bottom: 0;
		left: var(--twitter-space-4);
		height: 4px;
		border-radius: var(--twitter-radius-pill) var(--twitter-radius-pill) 0 0;
		background: var(--twitter-accent);
		opacity: 0;
		transform: scaleX(0.4);
		transition:
			opacity var(--twitter-duration-fast) ease,
			transform var(--twitter-duration-normal) var(--twitter-ease);
	}

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 6%, transparent);
		color: var(--twitter-fg);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}

	&.active {
		color: var(--twitter-fg);

		&::after {
			opacity: 1;
			transform: scaleX(1);
		}
	}
}

.tabTitle {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
