<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI · 频道详情页（P-26 / ADR-0005 D7，/channels/:channelId 页面变体，Communities IA）

作用：消费页面层（channel.vue）查询 store 的只读状态与业务回调，呈现
X Communities 社区页——社区头（banner + 名称 + 统计 + Join / 收藏动作行）+
按关注态派生的 tab 集合：已关注 = ホーム / みつける / 情報 / 検索（默认ホーム），
未关注 = みつける / 情報 / 検索（join-gate：默认みつける，Join 后落ホーム）。

数据链角色：查询 store（频道资料 / 热门集合，单向传入）→
本组件（壳与社区头呈现）；tab 选择与搜索输入为临时 UI 状态；关系校正规则只归 domain。
O-3 裁决延伸：不渲染内联发帖表单，发帖入口 = 头部 pencil（os.post 带 channel 上下文）。
布局真值：社区头映射 nitter views/community.nim + profile/card.scss（banner 3:1、
卡身 12px、fullname 16px/700、控件入流不叠压 U-7 先例）；join-gate 与 Home / Explore
命名为 X-behavior（B 类登记 CH-11）；时间线消费既有 twitter 变体。
-->

<template>
<div ref="rootEl" data-testid="twitter-channel" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable">
	<MkStickyContainer>
		<template #header>
			<header data-testid="twitter-channel-header" :class="$style.header">
				<button
					:class="$style.back"
					class="_button"
					type="button"
					:aria-label="i18n.ts.goBack"
					@click="goBack"
				>
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<h1 :class="$style.title">{{ channel?.name ?? i18n.ts.channel }}</h1>
				<div :class="$style.actions">
					<button
						v-for="(action, index) in actions"
						:key="index"
						:class="[$style.action, { [$style.highlighted]: action.highlighted }]"
						class="_button"
						type="button"
						:aria-label="action.text"
						@click="action.handler"
					>
						<i :class="action.icon" aria-hidden="true"></i>
					</button>
				</div>
			</header>

			<nav v-if="channel != null" :class="$style.tabs" role="tablist" :aria-label="i18n.ts.channel">
				<button
					v-for="item in tabs"
					:id="`twitter-channel-tab-${item.value}`"
					:key="item.value"
					class="_button"
					:class="[$style.tab, { [$style.activeTab]: tab === item.value }]"
					type="button"
					role="tab"
					:aria-selected="tab === item.value"
					:aria-controls="`twitter-channel-panel-${item.value}`"
					:tabindex="tab === item.value ? 0 : -1"
					@click="tab = item.value"
					@keydown="onTabKeydown"
				>
					{{ item.title }}
				</button>
			</nav>
			<div v-else-if="state.status === 'idle' || state.status === 'loading'" :class="$style.loadingTabs" aria-hidden="true"><span v-for="placeholder in 3" :key="placeholder" :class="$style.skeletonLine"></span></div>
		</template>

		<div
			:id="`twitter-channel-panel-${tab}`"
			:class="$style.body"
			role="tabpanel"
			:aria-labelledby="channel != null && tab != null ? `twitter-channel-tab-${tab}` : undefined"
		>
			<div v-if="channel == null && (state.status === 'idle' || state.status === 'loading')" data-testid="twitter-channel-loading" role="status" :aria-label="i18n.ts.loading">
				<div :class="[$style.banner, $style.skeletonBlock]"></div>
				<div :class="$style.identityCard">
					<div :class="[$style.skeletonLine, $style.skeletonName]"></div>
					<div :class="$style.skeletonLine"></div>
					<div :class="[$style.skeletonLine, $style.skeletonDescription]"></div>
					<div :class="[$style.actionRow, $style.skeletonActions]"><span :class="$style.skeletonBlock"></span><span :class="$style.skeletonBlock"></span></div>
				</div>
				<TwitterPageSkeleton variant="timeline"/>
			</div>
			<TwitterPageState v-else-if="channel == null" data-testid="twitter-channel-error" :type="state.status === 'notFound' ? 'notFound' : 'error'" @retry="emit('retry')"/>
			<template v-else>
				<div v-if="state.status === 'error'" :class="$style.refreshStatus" role="status">{{ i18n.ts.error }} <button class="_textButton" type="button" @click="emit('retry')">{{ i18n.ts.retry }}</button></div>
				<!-- 社区头：nitter profile/card 真值 + Join / 收藏动作行入流（U-7：无控件叠压） -->
				<div :class="$style.banner" :style="bannerStyle">
					<div :class="$style.bannerStatus">
						<div>
							<i class="ti ti-users ti-fw"></i>
							<I18n :src="i18n.ts._channel.usersCount" tag="span" style="margin-left: 4px;">
								<template #n><b>{{ channel.usersCount }}</b></template>
							</I18n>
						</div>
						<div>
							<i class="ti ti-pencil ti-fw"></i>
							<I18n :src="i18n.ts._channel.notesCount" tag="span" style="margin-left: 4px;">
								<template #n><b>{{ channel.notesCount }}</b></template>
							</I18n>
						</div>
					</div>
					<div v-if="channel.isSensitive" :class="$style.sensitiveChip">{{ i18n.ts.sensitive }}</div>
				</div>

				<section :class="$style.identityCard">
					<h2 :class="$style.name">{{ channel.name }}</h2>
					<div v-if="channel.description" :class="$style.description">
						<Mfm :text="channel.description" :isNote="false"/>
					</div>
					<div :class="$style.actionRow">
						<MkButton
							v-if="!channel.isFollowing"
							primary
							rounded
							:class="$style.joinButton"
							@click="props.onJoin()"
							><i class="ti ti-plus" aria-hidden="true"></i> {{ i18n.ts.follow }}</MkButton>
						<MkButton
							v-else
							rounded
							:class="$style.joinButton"
							@click="props.onLeave()"
							><i class="ti ti-minus" aria-hidden="true"></i> {{ i18n.ts.unfollow }}</MkButton>
						<MkButton
							v-if="favorited"
							v-tooltip="i18n.ts.unfavorite"
							asLike
							rounded
							primary
							@click="props.onUnfavorite()"
						><i class="ti ti-star"></i></MkButton>
						<MkButton
							v-else
							v-tooltip="i18n.ts.favorite"
							asLike
							rounded
							@click="props.onFavorite()"
						><i class="ti ti-star"></i></MkButton>
					</div>
				</section>
			</template>

			<div v-if="channel != null && tab === 'home'">
				<MkInfo v-if="channel.isArchived" warn>{{ i18n.ts.thisChannelArchived }}</MkInfo>

				<section v-if="channel.pinnedNotes && channel.pinnedNotes.length > 0" :class="$style.pinnedSection">
					<div :class="$style.pinnedHeader"><i class="ti ti-pin ti-fw"></i> {{ i18n.ts.pinnedNotes }}</div>
					<div :class="$style.pinnedList">
						<TwitterNote v-for="note in channel.pinnedNotes" :key="note.id" :note="note" :pinned="true"/>
					</div>
				</section>

				<MkStreamingNotesTimeline :key="channelId" src="channel" :channel="channelId" variant="twitter"/>
			</div>
			<div v-else-if="channel != null && tab === 'explore'">
				<!-- Communities 流不带控制条（A-1：X 参照无排序/控制组件，CH-12 登记） -->
				<TwitterChannelFeatured
					data-testid="twitter-channel-featured"
					:state="featuredState"
					:refresher="props.featuredRefresher"
					@more="emit('featuredMore')"
					@retry="emit('featuredRetry')"
					@refresh="emit('featuredRefresh')"
				/>
			</div>
			<div v-else-if="tab === 'about' && channel != null">
				<section :class="$style.aboutCard">
					<div :class="$style.aboutRow">
						<i class="ti ti-users ti-fw"></i>
						<I18n :src="i18n.ts._channel.usersCount" tag="span">
							<template #n><b>{{ channel.usersCount }}</b></template>
						</I18n>
					</div>
					<div :class="$style.aboutRow">
						<i class="ti ti-pencil ti-fw"></i>
						<I18n :src="i18n.ts._channel.notesCount" tag="span">
							<template #n><b>{{ channel.notesCount }}</b></template>
						</I18n>
					</div>
					<div v-if="$i != null && $i.id === channel.userId" :class="$style.aboutRow">
						<i class="ti ti-user-star ti-fw"></i>
						<span>{{ i18n.ts.youAreAdmin }}</span>
					</div>
					<div v-if="channel.description" :class="$style.description">
						<Mfm :text="channel.description" :isNote="false"/>
					</div>
				</section>
			</div>
			<div v-else-if="channel != null && tab === 'search'">
				<div v-if="notesSearchAvailable" :class="$style.searchForm">
					<MkInput v-model="searchQuery" @enter="submit">
						<template #label>{{ i18n.ts.search }}</template>
						<template #prefix><i class="ti ti-search"></i></template>
					</MkInput>
					<MkButton primary rounded @click="submit">{{ i18n.ts.search }}</MkButton>
				</div>
				<div v-else :class="$style.searchUnavailable">
					<MkInfo warn>{{ i18n.ts.notesSearchNotAvailable }}</MkInfo>
				</div>
				<MkNotesTimeline v-if="notesSearchAvailable && searchPaginator != null" :key="searchKey" :paginator="searchPaginator" variant="twitter" :withControl="false"/>
			</div>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import type { ComputedRef, CSSProperties, Ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { getChannelCommunityTabs, TwitterChannelFeatured, TwitterNote, TwitterPageSkeleton, TwitterPageState } from '@/ui/twitter/index.js';
import { useTwitterLayout } from '@/ui/twitter/context/index.js';
import type { ChannelCommunityTab, ChannelDetailState, ChannelFeaturedState } from '@/ui/twitter/index.js';
import { useTwitterScrollPositionKeeper } from '@/ui/twitter/index.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import type { Paginator } from '@/utility/paginator.js';

/** 只读消费权威查询状态；全部业务变更交还页面动作。 */
const props = defineProps<{
	/** 路由参数中的频道 ID（流式时间线 :key 重建用）。 */
	channelId: string;
	/** 唯一频道查询状态，区分首拉、刷新和终态。 */
	state: ChannelDetailState;
	/** みつける集合的唯一查询状态，刷新时继续呈现已确认内容。 */
	featuredState: ChannelFeaturedState;
	/** 下拉刷新等待实际请求完成，业务仍由查询所有者处理。 */
	featuredRefresher: () => Promise<void>;
	/** 站内全文搜索是否可用（検索 tab 门控，能力探测留页面层）。 */
	notesSearchAvailable: boolean;
	/** 频道内搜索结果数据源（null = 尚未搜索）。 */
	searchPaginator: Paginator<'notes/search'> | null;
	/** 搜索结果重渲染 key。 */
	searchKey: string;
	/** 头部动作（发帖预填 / copyUrl / mute / edit；业务 handler 留在页面层，规范第 12 条）。 */
	actions: PageHeaderItem[];
	/** Join 回调（关注频道并回填实体，join-gate 落ホーム的数据源）。 */
	onJoin: () => void;
	/** Leave 回调（取关并回填实体）。 */
	onLeave: () => void;
	/** 收藏回调。 */
	onFavorite: () => void;
	/** 取消收藏回调。 */
	onUnfavorite: () => void;
	/** 频道内搜索回调（paginator 创建业务留在页面层）。 */
	onSearch: (query: string) => void;
}>();

/** 当前选中 tab（页面层 v-model 双向绑定；初始值由页面层按关注态设定）。 */
const tab = defineModel<ChannelCommunityTab | null>('tab', { required: true });
/** 组件事件只表达重试或集合查询意图，不直接修改业务状态。 */
const emit = defineEmits<{ (ev: 'retry' | 'featuredMore' | 'featuredRetry' | 'featuredRefresh'): void }>();
/** 实体与收藏视图均从唯一状态派生，不保存可写副本。 */
const channel: ComputedRef<Misskey.entities.Channel | null> = computed(/** 原实体透传。 */ (): Misskey.entities.Channel | null => props.state.channel);
const favorited: ComputedRef<boolean> = computed(/** 收藏关系只影响收藏控件。 */ (): boolean => channel.value?.isFavorited ?? false);

const { isMobile } = useTwitterLayout();
const rootEl: Readonly<Ref<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('rootEl');

/** 保留详情页滚动位置（返回导航后恢复）。 */
useTwitterScrollPositionKeeper(rootEl);

/** 标签文案为权威标签的展示映射，合法集合只由 domain 按确认关注关系派生。 */
function tabTitle(value: ChannelCommunityTab): string {
	switch (value) {
		case 'home': return i18n.ts.home;
		case 'explore': return i18n.ts.explore;
		case 'about': return i18n.ts.about;
		case 'search': return i18n.ts.search;
	}
}

/** 未确认频道时不构造业务标签，也不将未知关注关系当作未关注。 */
const tabs: ComputedRef<ReadonlyArray<{ value: ChannelCommunityTab; title: string }>> = computed(/** 只为合法标签附加展示文案。 */ (): ReadonlyArray<{ value: ChannelCommunityTab; title: string }> => getChannelCommunityTabs(channel.value).map(/** 标签标题只用于显示。 */ (value: ChannelCommunityTab): { value: ChannelCommunityTab; title: string } => ({ value, title: tabTitle(value) })));

/** banner 样式由唯一实体单向派生，无 banner 时复用面板背景。 */
const bannerStyle: ComputedRef<CSSProperties | undefined> = computed(/** 仅输出样式，不改变实体。 */ (): CSSProperties | undefined => channel.value?.bannerUrl == null ? undefined : { backgroundImage: `url(${channel.value.bannerUrl})` });

/** 搜索词草稿（组件临时 UI 状态，提交后才回传页面层）。 */
const searchQuery: Ref<string> = ref<string>('');

/** 提交搜索：转发页面层回调（业务 funnel 单点，规范第 12 条）。 */
function submit(): void {
	props.onSearch(searchQuery.value.trim());
}

/** tab 键盘巡游（左右 / Home / End；与 TwitterSearch 同构的 roving tabindex）。 */
function onTabKeydown(ev: KeyboardEvent): void {
	const currentIndex: number = tabs.value.findIndex(/** 寻找当前临时选择。 */ (item: { value: ChannelCommunityTab; title: string }): boolean => item.value === tab.value);
	let nextIndex: number | null = null;
	if (tabs.value.length === 0) return;

	if (ev.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.value.length;
	else if (ev.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.value.length) % tabs.value.length;
	else if (ev.key === 'Home') nextIndex = 0;
	else if (ev.key === 'End') nextIndex = tabs.value.length - 1;

	if (nextIndex == null) return;

	ev.preventDefault();
	tab.value = tabs.value[nextIndex].value;
}

/** 返回上一页（与 TwitterTag / TwitterCommunities 一致的返回行为）。 */
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
	 * 底部留白与既有页面一致，避免末行被 FAB 遮挡 */
	&.mobile {
		padding-bottom: calc(72px + env(safe-area-inset-bottom));
	}
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

/* 紧凑返回头：X-behavior 现代表现层（与 TwitterTag 头部同构） */
.header {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr) minmax(72px, auto);
	align-items: center;
	height: var(--twitter-header-height);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.back,
.action {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
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

.back {
	margin-left: var(--twitter-space-2);
}

.title {
	min-width: 0;
	margin: 0;
	padding: 0 var(--twitter-space-2);
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-emphasis);
	font-weight: 800;
	line-height: 1.2;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	display: flex;
	gap: var(--twitter-space-1);
	justify-content: flex-end;
	padding-right: var(--twitter-space-2);
}

.highlighted {
	color: var(--twitter-accent);
}

/* tab 行：与 TwitterCommunities / TwitterSearch 同构（下划线 active） */
.tabs {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(88px, 1fr);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.tab {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 50px;
	padding: 0 12px;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-content);
	font-weight: 700;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&::after {
		content: "";
		position: absolute;
		right: 12px;
		bottom: 0;
		left: 12px;
		height: 4px;
		border-radius: var(--twitter-radius-pill) var(--twitter-radius-pill) 0 0;
		background: var(--twitter-accent);
		opacity: 0;
		transform: scaleX(0.4);
		transition:
			opacity var(--twitter-duration-fast) ease,
			transform var(--twitter-duration-normal) var(--twitter-ease);
	}

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
		color: var(--twitter-fg);
	}
}

.activeTab {
	color: var(--twitter-fg);

	&::after {
		opacity: 1;
		transform: scaleX(1);
	}
}

/* 社区头 banner：nitter profile/_base.scss 真值 3:1（600px 主列 → 200px，与 U-4 的 X 上限一致）；
 * 状态 chip 叠加沿用图上信息深底白字家族 token（tooltip 家族） */
.banner {
	position: relative;
	aspect-ratio: 3 / 1;
	max-height: 200px;
	background-color: var(--twitter-panel);
	background-position: center;
	background-size: cover;
}

.bannerStatus {
	position: absolute;
	z-index: 1;
	bottom: 16px;
	right: 16px;
	display: flex;
	gap: 12px;
	padding: 8px 12px;
	font-size: var(--twitter-font-size-caption);
	background: var(--twitter-tooltip-bg);
	border-radius: var(--twitter-radius-small);
	color: var(--twitter-tooltip-fg);
}

.sensitiveChip {
	position: absolute;
	z-index: 1;
	bottom: 16px;
	left: 16px;
	padding: 4px 7px;
	background: var(--twitter-tooltip-bg);
	color: var(--twitter-warning);
	border-radius: var(--twitter-radius-small);
	font-weight: bold;
	font-size: var(--twitter-font-size-caption);
}

/* 社区身份卡：nitter profile/card.scss 真值——卡身 12px、fullname 16px/700、
 * bio 15px 行高 1.3（N-3）、控件入流不叠压（U-7 先例） */
.identityCard {
	display: grid;
	gap: var(--twitter-space-2);
	padding: var(--twitter-space-3);
	background: var(--twitter-panel);
	border-bottom: solid 1px var(--twitter-border);
}

.name {
	margin: 0;
	overflow-wrap: anywhere;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-emphasis);
	font-weight: 700;
	line-height: 1.2;
}

.description {
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-content);
	/* nitter 地面真值：body / tweet-content 行高 1.3（PF-2 N-3 裁决：对齐） */
	line-height: 1.3;
}

.actionRow {
	display: flex;
	gap: var(--twitter-space-2);
}

.joinButton {
	min-width: 96px;
}

/* ホーム：置顶帖区（TwitterNote 复用，hairline 行） */
.pinnedSection {
	border-bottom: solid 1px var(--twitter-border);
}

.pinnedHeader {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	padding: var(--twitter-space-2) var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
	font-weight: 700;
}

.pinnedList {
	display: grid;
}

/* 情報（About）：统计行 + 描述 */
.aboutCard {
	display: grid;
	gap: var(--twitter-space-2);
	padding: var(--twitter-space-3) var(--twitter-space-4);
}

.aboutRow {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-2);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
}

.searchForm {
	display: grid;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-bottom: solid 1px var(--twitter-border);
}

.searchUnavailable {
	padding: var(--twitter-space-3) var(--twitter-space-4);
}
/* 频道请求阶段使用与真实社区头相同的 banner 和 identityCard 布局。 */
.loadingTabs {
	display: flex;
	align-items: center;
	justify-content: space-around;
	height: 50px;
	border-bottom: solid 1px var(--twitter-border);

	.skeletonLine { width: 48px; }
}

.skeletonBlock,
.skeletonLine {
	background: var(--twitter-skeleton-block);
}

.skeletonLine {
	height: 10px;
	border-radius: var(--twitter-radius-pill);
}

.skeletonName { width: 40%; height: 20px; }
.skeletonDescription { width: 70%; }
.skeletonActions {
	min-height: 38px;

	span {
		width: 96px;
		border-radius: var(--twitter-radius-pill);
	}
}

.refreshStatus {
	padding: var(--twitter-space-2) var(--twitter-space-4);
	font-size: var(--twitter-font-size-meta);
	color: var(--twitter-secondary-fg);
}

</style>
