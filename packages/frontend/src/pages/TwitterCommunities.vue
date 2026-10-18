<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI · 频道主页（P-26 / ADR-0005，/channels 页面变体，Communities IA，Full 等级）

作用：消费页面层（channels.vue）持有的频道分页器与搜索回调，呈现
Communities 信息架构——常驻频道搜索 + 双 tab：
  · ホーム（Home）：顶部已关注频道横条 + 已关注频道帖子聚合流（channels/followed-timeline）；
  · みつける（Explore）：注目频道条 + 管理 / 收藏折叠区 + 全频道帖子聚合流（channels/global-timeline）。
搜索提交后结果面板替换内容区（X Communities 常驻搜索行为），清空即退出。

数据链角色：页面层（paginator / 搜索业务，单向传入）→ 本组件（壳与呈现）；
tab 与搜索词草稿为组件临时 UI 状态（规范第 12 条）。
布局真值：IA 与常驻搜索为 X-behavior（nitter 无 Communities 域，检索证据见
port-fidelity-audit 第九节）；返回头 / tab 行 / 时间线复用既有 twitter 变体。
-->

<template>
<div ref="rootEl" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header">
				<button
					:class="$style.back"
					class="_button"
					type="button"
					:aria-label="i18n.ts.goBack"
					@click="goBack"
				>
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<h1 :class="$style.title">{{ i18n.ts.channel }}</h1>
			</header>

			<div :class="$style.searchRow">
				<TwitterSearchField
					v-model="searchDraft"
					:class="$style.searchField"
					@submit="submitSearch"
					@clear="exitSearch"
				/>
			</div>

			<nav v-if="!searching" :class="$style.tabs" role="tablist" :aria-label="i18n.ts.channel">
				<button
					v-for="item in tabs"
					:id="`twitter-communities-tab-${item.value}`"
					:key="item.value"
					class="_button"
					:class="[$style.tab, { [$style.activeTab]: tab === item.value }]"
					type="button"
					role="tab"
					:aria-selected="tab === item.value"
					:aria-controls="`twitter-communities-panel-${item.value}`"
					:tabindex="tab === item.value ? 0 : -1"
					@click="tab = item.value"
					@keydown="onTabKeydown"
				>
					{{ item.title }}
				</button>
			</nav>
		</template>

		<!-- 搜索结果面板：替换内容区（X 常驻搜索行为） -->
		<div v-if="searching" :class="$style.body">
			<div :class="$style.searchResultHeader">
				<span>{{ i18n.ts.searchResult }}</span>
				<button
					class="_button"
					type="button"
					:class="$style.searchResultClose"
					:aria-label="i18n.ts.close"
					@click="exitSearch"
				>
					<i class="ti ti-x" aria-hidden="true"></i>
				</button>
			</div>
			<div v-if="searchPaginator != null" :class="$style.searchResultBody">
				<MkChannelList :key="searchKey" :paginator="searchPaginator"/>
			</div>
		</div>

		<div
			v-else
			:id="`twitter-communities-panel-${tab}`"
			:class="$style.body"
			role="tabpanel"
			:aria-labelledby="`twitter-communities-panel-${tab}`"
		>
			<template v-if="tab === 'home'">
				<!-- 已关注频道圆形标识行（A-3）：X Communities joined 行为；空关注时
				     MkPagination 空态被 #empty 覆写为无内容，由引导卡接管 -->
				<MkPagination :paginator="followedChannelsPaginator">
					<template #empty></template>
					<template #default="{ items }">
						<div v-if="items.length > 0" :class="$style.channelStrip" role="list">
							<MkA
								v-for="channel in items"
								:key="channel.id"
								:class="$style.channelItem"
								:to="`/channels/${channel.id}`"
								role="listitem"
							>
								<span :class="$style.channelAvatar" :style="channelAvatarStyle(channel)"></span>
								<span :class="$style.channelAvatarName">{{ channel.name }}</span>
							</MkA>
						</div>
					</template>
				</MkPagination>

				<!-- 空关注引导卡（A-3）：X 冷启动为推荐流，此处简化为 CTA
				     （不复用 featured paginator——同实例双处挂载会引入切 tab 重拉），偏离登记 CH-12 -->
				<div v-if="followedChannelsEmpty" :class="$style.emptyGuide">
					<div :class="$style.emptyGuideText">{{ i18n.ts._channel.noFollowing }}</div>
					<MkButton primary rounded @click="tab = 'explore'">{{ i18n.ts.explore }}</MkButton>
				</div>

				<!-- Communities 流不带控制条（A-1：X 参照无排序/控制组件，CH-12 登记） -->
				<MkNotesTimeline :paginator="followedTimelinePaginator" variant="twitter" :withControl="false"/>
			</template>

			<template v-else-if="tab === 'explore'">
				<!-- 注目频道卡片网格（A-2）：对齐 X Discover 双列卡片形态；
				     MkChannelPreview twitter 变体已映射 tweet/card.scss 真值 -->
				<MkPagination :paginator="featuredPaginator">
					<template #empty></template>
					<template #default="{ items }">
						<div v-if="items.length > 0" :class="$style.sectionHeader">{{ i18n.ts._channel.featured }}</div>
						<div :class="$style.featuredGrid">
							<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
						</div>
					</template>
				</MkPagination>

				<!-- Communities 流不带控制条（A-1） -->
				<MkNotesTimeline :paginator="globalTimelinePaginator" variant="twitter" :withControl="false"/>

				<!-- 管理 / 收藏折叠区（A-4：Misskey 能力安置，移至流后降低视觉权重，CH-12 登记） -->
				<div :class="$style.manageSection">
					<MkFoldableSection>
						<template #header>{{ i18n.ts._channel.owned }}</template>
						<div :class="$style.manageBody">
							<div v-if="canCreateChannel" :class="$style.createRow">
								<MkButton type="routerLink" primary rounded to="/channels/new"><i class="ti ti-plus"></i> {{ i18n.ts.createNew }}</MkButton>
							</div>
							<MkPagination v-slot="{ items }" :paginator="ownedPaginator">
								<div :class="$style.manageGrid">
									<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
								</div>
							</MkPagination>
						</div>
					</MkFoldableSection>
					<MkFoldableSection>
						<template #header>{{ i18n.ts.favorites }}</template>
						<div :class="$style.manageBody">
							<MkPagination v-slot="{ items }" :paginator="favoritesPaginator">
								<div :class="$style.manageGrid">
									<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
								</div>
							</MkPagination>
						</div>
					</MkFoldableSection>
				</div>
			</template>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkChannelPreview from '@/components/MkChannelPreview.vue';
import MkChannelList from '@/components/MkChannelList.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { TwitterSearchField, useTwitterLayout } from '@/ui/twitter/index.js';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';
import { i18n } from '@/i18n.js';
import type { Paginator } from '@/utility/paginator.js';

/** 频道主页 tab 值（X Communities IA：Home / Explore；ADR-0005 D1）。 */
type CommunitiesTab = 'home' | 'explore';

const props = defineProps<{
	/** Home 聚合流数据源（channels/followed-timeline，页面层持有）。 */
	followedTimelinePaginator: Paginator<'channels/followed-timeline'>;
	/** Explore 聚合流数据源（channels/global-timeline，页面层持有）。 */
	globalTimelinePaginator: Paginator<'channels/global-timeline'>;
	/** 已关注频道横条数据源（channels/followed，页面层持有）。 */
	followedChannelsPaginator: Paginator<'channels/followed'>;
	/** 注目频道条数据源（channels/featured，页面层持有）。 */
	featuredPaginator: Paginator<'channels/featured'>;
	/** 管理折叠区数据源（channels/owned，页面层持有）。 */
	ownedPaginator: Paginator<'channels/owned'>;
	/** 收藏折叠区数据源（channels/my-favorites，页面层持有）。 */
	favoritesPaginator: Paginator<'channels/my-favorites'>;
	/** 搜索提交回调（paginator 创建业务留在页面层，规范第 12 条）。 */
	onSearch: (query: string) => void;
	/** 搜索结果数据源（null = 尚未执行搜索）。 */
	searchPaginator: Paginator<'channels/search'> | null;
	/** 搜索结果重渲染 key。 */
	searchKey: string;
	/** 当前用户是否可创建频道（管理折叠区创建按钮）。 */
	canCreateChannel: boolean;
}>();

/** 当前选中 tab（页面层 v-model 双向绑定；KeepAlive 回访定向刷新依赖页面层持有）。 */
const tab = defineModel<string>('tab');

const { isMobile } = useTwitterLayout();
const rootEl = useTemplateRef<HTMLDivElement>('rootEl');

/** 保留列表滚动位置（返回导航后恢复）。 */
useScrollPositionKeeper(rootEl);

/** Home 空关注判定（A-3 引导卡渲染条件：拉取完成且无条目）。 */
const followedChannelsEmpty = computed(() =>
	!props.followedChannelsPaginator.fetching.value
	&& props.followedChannelsPaginator.items.value.length === 0);

/**
 * 圆形标识背景样式：banner cover，无 banner 回退频道色（X joined 行形态，CH-12 登记）。
 *
 * @param channel 已关注频道实体
 */
function channelAvatarStyle(channel: Misskey.entities.Channel): { backgroundImage?: string; backgroundColor?: string } {
	if (channel.bannerUrl != null) {
		return { backgroundImage: `url(${channel.bannerUrl})` };
	}
	return { backgroundColor: channel.color };
}

/** tab 定义（X Communities 命名：ホーム / みつける，均复用既有 locale key）。 */
const tabs = computed(() => [
	{ value: 'home', title: i18n.ts.home },
	{ value: 'explore', title: i18n.ts.explore },
] satisfies Array<{ value: CommunitiesTab; title: string }>);

/** 搜索词草稿（组件临时 UI 状态，提交后才回传页面层）。 */
const searchDraft = ref('');

/** 搜索结果面板开关（true 时内容区替换为结果面板，X 常驻搜索行为）。 */
const searching = ref(false);

/** 提交搜索：进入结果面板并转发页面层回调（K-14 守卫在页面层）。 */
function submitSearch(query: string): void {
	searching.value = true;
	props.onSearch(query);
}

/** 退出搜索结果面板（清空草稿；不销毁结果 paginator，便于再次进入刷新）。 */
function exitSearch(): void {
	searching.value = false;
}

/** tab 键盘巡游（左右 / Home / End；与 TwitterSearch 同构的 roving tabindex）。 */
function onTabKeydown(ev: KeyboardEvent): void {
	const currentIndex = tabs.value.findIndex(item => item.value === tab.value);
	let nextIndex: number | null = null;

	if (ev.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.value.length;
	else if (ev.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.value.length) % tabs.value.length;
	else if (ev.key === 'Home') nextIndex = 0;
	else if (ev.key === 'End') nextIndex = tabs.value.length - 1;

	if (nextIndex == null) return;

	ev.preventDefault();
	tab.value = tabs.value[nextIndex].value;
}

/** 返回上一页（与 TwitterTag / TwitterChannel 一致的返回行为）。 */
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
	grid-template-columns: 44px minmax(0, 1fr);
	align-items: center;
	height: var(--twitter-header-height);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
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

/* 常驻搜索条：nitter general.scss search-bar 真值（紧凑条 / radius 4px，PF-2 H-1 裁决） */
.searchRow {
	display: flex;
	padding: var(--twitter-space-2) var(--twitter-space-4);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.searchField {
	flex: 1;
	min-width: 0;
}

/* tab 行：与既有页面同构（下划线 active，50px 行高） */
.tabs {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
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

/* 已关注频道横条：X Communities joined 行为——圆形标识（banner 缩略，无 banner 回退频道色）
 * + 名称下置（CH-12 登记；nitter 无对应物，X-behavior 来源） */
.channelStrip {
	display: flex;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-2) var(--twitter-space-4);
	overflow-x: auto;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		display: none;
	}
}

.channelItem {
	display: flex;
	flex-direction: column;
	align-items: center;
	flex-shrink: 0;
	gap: var(--twitter-space-1);
	width: 72px;
	text-decoration: none;
}

.channelAvatar {
	width: 56px;
	height: 56px;
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-radius-pill);
	background-color: var(--twitter-panel);
	background-position: center;
	background-size: cover;

	.channelItem:hover &,
	.channelItem:focus-visible & {
		border-color: var(--twitter-secondary-fg);
	}
}

.channelAvatarName {
	max-width: 72px;
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-caption);
	text-align: center;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* 空关注引导卡（A-3）：X 冷启动推荐流的简化 CTA 形态（CH-12 登记偏离） */
.emptyGuide {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--twitter-space-3);
	margin: var(--twitter-space-4);
	padding: var(--twitter-space-6) var(--twitter-space-4);
	border: dashed 1px var(--twitter-border);
	border-radius: var(--twitter-radius-embed);
	background: var(--twitter-panel);
}

.emptyGuideText {
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
}

/* 注目频道卡片网格（A-2）：X Discover 双列卡片形态（600px 主列内约 2×~270px）；
 * 移动端沿用 MkChannelPreview 自带 ≤550/500px 收缩 */
.featuredGrid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-2) var(--twitter-space-4) 0;
}

.sectionHeader {
	padding: var(--twitter-space-2) var(--twitter-space-4) 0;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
	font-weight: 700;
}

/* 管理 / 收藏折叠区（A-4）：P-25 旧列表能力的收敛安置（ADR-0005 D3），
 * 位于流之后 → 边线取上缘分隔 */
.manageSection {
	display: grid;
	padding: var(--twitter-space-2) var(--twitter-space-4);
	gap: var(--twitter-space-2);
	border-top: solid 1px var(--twitter-border);
}

.manageBody {
	display: grid;
	gap: var(--twitter-space-3);
	padding-top: var(--twitter-space-2);
}

.manageGrid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
	gap: var(--twitter-space-3);
}

.createRow {
	display: flex;
}

/* 搜索结果面板 */
.searchResultHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: var(--twitter-space-2) var(--twitter-space-4);
	border-bottom: solid 1px var(--twitter-border);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
	font-weight: 700;
}

.searchResultClose {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.searchResultBody {
	padding: var(--twitter-space-3);
}
</style>
