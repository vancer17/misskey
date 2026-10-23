<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 频道入口的页面展示。
作用：以标题／搜索、主标签、横向频道卡片和帖子流组织内容，管理与收藏使用独立窗口。
数据链：channels.vue 持有唯一查询并调度请求 → 本组件只读呈现 → 交互事件返回页面所有者。
布局依据：X 归档的首页成员社区横条；发现仅呈现全频道帖子，颜色与主列沿用 Nitter Token。
主标签沿用 Nitter 等分空间关系，指示条随单元伸展并与时间线／搜索页保持相同内缩。
-->

<template>
<div ref="rootEl" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable" data-testid="twitter-communities">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header" data-testid="twitter-communities-header">
				<button :class="$style.iconButton" class="_button" type="button" :aria-label="i18n.ts.goBack" @click="goBack">
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<TwitterSearchField
					v-if="searchOpen"
					v-model="searchDraft"
					:class="$style.searchField"
					:autofocus="true"
					@submit="submitSearch"
					@clear="clearSearch"
				/>
				<h1 v-else :class="$style.title">{{ i18n.ts.channel }}</h1>
				<button
					v-if="!searchOpen"
					:class="$style.iconButton"
					class="_button"
					type="button"
					:aria-label="i18n.ts.search"
					data-testid="twitter-community-search"
					@click="openSearch"
				>
					<i class="ti ti-search" aria-hidden="true"></i>
				</button>
				<button v-else :class="$style.iconButton" class="_button" type="button" :aria-label="i18n.ts.close" @click="exitSearch">
					<i class="ti ti-x" aria-hidden="true"></i>
				</button>
				<button
					:class="$style.iconButton"
					class="_button"
					type="button"
					:aria-label="i18n.ts.menu"
					aria-haspopup="menu"
					:disabled="library != null"
					data-testid="twitter-community-menu"
					@click="openMenu"
				>
					<i class="ti ti-dots" aria-hidden="true"></i>
				</button>
			</header>
			<nav v-if="!searching" ref="tabList" :class="$style.tabs" role="tablist" :aria-label="i18n.ts.channel">
				<button
					v-for="item in tabs"
					:id="`twitter-communities-tab-${item.value}`"
					:key="item.value"
					:data-twitter-tab-key="item.value"
					class="_button"
					:class="[$style.tab, { [$style.activeTab]: tab === item.value }]"
					type="button"
					role="tab"
					:aria-selected="tab === item.value"
					:aria-controls="`twitter-communities-panel-${item.value}`"
					:tabindex="tab === item.value ? 0 : -1"
					@click="selectTab(item.value)"
					@keydown="onTabKeydown"
				>
					{{ item.title }}
				</button>
				<TwitterTabIndicator :activeKey="tab"/>
			</nav>
		</template>

		<div v-if="searching" :class="$style.body" data-testid="twitter-community-search-results">
			<MkPagination v-if="searchPaginator != null" :key="searchKey" :paginator="searchPaginator" :autoLoad="false" :pullToRefresh="false">
				<template #empty><TwitterPageState type="empty"/></template>
				<template #default="{ items }">
					<div :class="$style.searchResults">
						<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
					</div>
				</template>
			</MkPagination>
		</div>
		<div v-else :id="`twitter-communities-panel-${tab}`" :class="$style.body" role="tabpanel" :aria-labelledby="`twitter-communities-tab-${tab}`">
			<template v-if="tab === 'home'">
				<TwitterCommunityStrip
					:channels="followedChannelsPaginator.items.value"
					:label="i18n.ts._channel.following"
					:loading="followedChannelsPaginator.fetching.value"
					:error="followedChannelsPaginator.error.value"
					:canFetchMore="followedChannelsPaginator.canFetchOlder.value"
					:fetchingMore="followedChannelsPaginator.fetchingOlder.value"
					@retry="retryFollowedChannels"
					@loadMore="loadMoreChannels"
				/>
				<div v-if="followedChannelsEmpty" :class="$style.emptyGuide" data-testid="twitter-community-empty-following" role="status">
					<h2>{{ i18n.ts._channel.noFollowing }}</h2>
					<MkButton primary rounded @click="discover">{{ i18n.ts.explore }}</MkButton>
				</div>
				<MkNotesTimeline v-else-if="followedChannelsReady" :paginator="followedTimelinePaginator" variant="twitter" :autoLoad="false" :withControl="false"/>
			</template>
			<template v-else>
				<MkNotesTimeline :paginator="globalTimelinePaginator" variant="twitter" :autoLoad="false" :withControl="false"/>
			</template>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onDeactivated, shallowReactive, ref, useTemplateRef } from 'vue';
import type { ComputedRef, ModelRef, Ref, ShallowRef } from 'vue';
import type { ComponentProps } from 'vue-component-type-helpers';
import MkChannelPreview from '@/components/MkChannelPreview.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { TwitterCommunityLibraryDialog, TwitterCommunityStrip, TwitterPageState, TwitterSearchField, TwitterTabIndicator, useCommunityDialogPosition, useTwitterScrollPositionKeeper } from '@/ui/twitter/index.js';
import { useTwitterLayout } from '@/ui/twitter/context/index.js';
import type { TwitterCommunitiesTab, TwitterCommunityLibrary, TwitterCommunityLibraryView } from '@/ui/twitter/index.js';
import { i18n } from '@/i18n.js';
import type { Paginator } from '@/utility/paginator.js';
import * as os from '@/os.js';

/** 页面所有者提供的只读查询依赖，不创建分页器或频道实体副本。 */
type CommunitiesProps = Readonly<{
	followedTimelinePaginator: Paginator<'channels/followed-timeline'>;
	globalTimelinePaginator: Paginator<'channels/global-timeline'>;
	followedChannelsPaginator: Paginator<'channels/followed'>;
	ownedView: ComputedRef<TwitterCommunityLibraryView>;
	favoritesPaginator: Paginator<'channels/my-favorites'>;
	onSearch: (query: string) => void;
	searchPaginator: Paginator<'channels/search'> | null;
	searchKey: string;
	canCreateChannel: boolean;
}>;
/** 保持页面传入的查询实例，不建立业务状态副本。 */
const props: CommunitiesProps = defineProps<CommunitiesProps>();

/** 只将请求意图交回页面所有者，加载状态仍由原分页器提供。 */
type CommunitiesEvents = {
	(event: 'retryFollowedChannels'): void;
	(event: 'loadMoreChannels'): void;
	(event: 'retryLibrary'): void;
	(event: 'loadMoreLibrary'): void;
};
/** 按事件契约传递请求意图。 */
const emit: CommunitiesEvents = defineEmits<CommunitiesEvents>();

/** 影响请求可见性的临时 UI 状态由页面持有，供回访调度直接消费。 */
const tab: ModelRef<TwitterCommunitiesTab> = defineModel<TwitterCommunitiesTab>('tab', { required: true });
/** 搜索结果是否覆盖当前帖子区域。 */
const searching: ModelRef<boolean> = defineModel<boolean>('searching', { default: false });
/** 独立频道资料库当前打开的入口。 */
const library: ModelRef<TwitterCommunityLibrary | null> = defineModel<TwitterCommunityLibrary | null>('library', { default: null });
/** 搜索框展开状态不承担业务查询事实。 */
const searchOpen: Ref<boolean> = ref<boolean>(false);
/** 尚未提交的查询草稿。 */
const searchDraft: Ref<string> = ref<string>('');
/** 布局断点沿用 Shell 的唯一来源。 */
const { isMobile }: ReturnType<typeof useTwitterLayout> = useTwitterLayout();
/** 只向现有滚动恢复提供页面根元素。 */
const rootEl: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('rootEl');
/** 键盘切换标签后的焦点容器。 */
const tabList: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('tabList');
/** 页面只保留关闭意图入口，弹层实例由全局弹层宿主负责释放。 */
let dismissLibrary: (() => void) | null = null;
/** 主列坐标只在“我的频道”窗口存续期间测量，不进入业务查询。 */
const observeDialogCenter: ReturnType<typeof useCommunityDialogPosition> = useCommunityDialogPosition(rootEl);
/** 收藏仍沿用一次性分页器，只派生窗口需要的只读视图，不复制实体数组。 */
const favoritesView: ComputedRef<TwitterCommunityLibraryView> = computed<TwitterCommunityLibraryView>(/** 原查询事实直接映射为展示状态。 */ (): TwitterCommunityLibraryView => ({
	items: props.favoritesPaginator.items.value,
	status: props.favoritesPaginator.fetching.value ? 'loading' : props.favoritesPaginator.error.value ? 'error' : 'ready',
	hasMore: false,
}));

useTwitterScrollPositionKeeper(rootEl);

/** 空关注只能由成功完成的查询确认，错误不降级为空集合。 */
const followedChannelsEmpty: ComputedRef<boolean> = computed<boolean>(/** 读取唯一分页器事实。 */ (): boolean =>
	!props.followedChannelsPaginator.fetching.value && !props.followedChannelsPaginator.error.value && props.followedChannelsPaginator.items.value.length === 0);
/** 确认存在关注频道后，帖子区域才负责自己的加载与空态。 */
const followedChannelsReady: ComputedRef<boolean> = computed<boolean>(/** 不将首拉或错误判成可用集合。 */ (): boolean =>
	!props.followedChannelsPaginator.fetching.value && !props.followedChannelsPaginator.error.value && props.followedChannelsPaginator.items.value.length > 0);
/** 标签定义引用领域唯一导航类型。 */
type CommunityTabOption = Readonly<{ value: TwitterCommunitiesTab; title: string }>;
/** 只读标签视图从权威导航值派生。 */
const tabs: ComputedRef<readonly CommunityTabOption[]> = computed<readonly CommunityTabOption[]>(/** 本地化展示从导航值单向派生。 */ (): readonly CommunityTabOption[] => [
	{ value: 'home', title: i18n.ts.home },
	{ value: 'explore', title: i18n.ts.explore },
]);

/** 选中主标签不重新创建查询实例。 */
function selectTab(value: TwitterCommunitiesTab): void { tab.value = value; }

/** 空关注引导只改变当前页面导航。 */
function discover(): void { selectTab('explore'); }

/** 打开顶部盒内的频道搜索输入。 */
function openSearch(): void { searchOpen.value = true; }

/** 空白查询不创建结果分页器。 */
function submitSearch(query: string): void {
	if (query.trim() === '') { clearSearch(); return; }
	searching.value = true;
	props.onSearch(query.trim());
}

/** 清空输入后恢复主标签，保留已加载查询的唯一所有者。 */
function clearSearch(): void { searching.value = false; }

/** 收起搜索时同时移除草稿及结果面板。 */
function exitSearch(): void { searchDraft.value = ''; searching.value = false; searchOpen.value = false; }

/** 返回优先离开搜索模式，否则使用既有浏览器历史。 */
function goBack(): void {
	if (searchOpen.value) exitSearch();
	else window.history.back();
}

/** 菜单仅暴露真实的频道管理能力，不复制 X 的帖子排序入口。 */
function openMenu(event: MouseEvent): void {
	void os.popupMenu([{
		text: i18n.ts._channel.owned,
		icon: 'ti ti-device-tv',
		action: /** 进入独立管理窗口。 */ (): void => { openLibrary('owned'); },
	}, {
		text: i18n.ts.favorites,
		icon: 'ti ti-star',
		action: /** 进入独立收藏窗口。 */ (): void => { openLibrary('favorites'); },
	}], event.currentTarget);
}

/** 从窗口公共 props 派生可写的弹层宿主输入，业务实体仍为只读引用。 */
type LibraryPopupProps = { -readonly [Key in keyof ComponentProps<typeof TwitterCommunityLibraryDialog>]: ComponentProps<typeof TwitterCommunityLibraryDialog>[Key] };

/** 在既有全局弹层宿主打开资料库，统一覆盖层定位与关闭生命周期。 */
function openLibrary(kind: TwitterCommunityLibrary): void {
	if (library.value != null) return;
	if (kind === 'owned' && rootEl.value == null) return;
	library.value = kind;
	const popupProps: LibraryPopupProps = shallowReactive<LibraryPopupProps>({
		kind,
		view: kind === 'owned' ? props.ownedView : favoritesView,
		canCreateChannel: props.canCreateChannel,
		closing: false,
	});
	/** 关闭开始即冻结当前定位，避免离页时锚点变化影响退出动画。 */
	let stopPosition: (() => void) | null = null;
	/** 关闭先驱动基础窗口释放焦点陷阱，closed 后才撤销全局实例。 */
	const requestClose: () => void = (): void => {
		stopPosition?.();
		stopPosition = null;
		popupProps.closing = true;
	};
	if (kind === 'owned') {
		stopPosition = observeDialogCenter(/** 业务窗口仅接收原始布局坐标，锚点失效沿用关闭流程。 */ (centerX: number | undefined): void => {
			if (centerX == null) requestClose();
			else popupProps.dialogCenterX = centerX;
		});
	}
	const { dispose }: { dispose: () => void } = os.popup(TwitterCommunityLibraryDialog, popupProps, {
		close: requestClose,
		navigate: requestClose,
		closed: /** 关闭完成后清理页面可见性和全局弹层，不直接卸载打开的模态。 */ (): void => {
			stopPosition?.();
			dispose();
			library.value = null;
			dismissLibrary = null;
		},
		retry: retryLibrary,
		loadMore: loadMoreLibrary,
	});
	dismissLibrary = requestClose;
}

/** 页面离开时仍经过基础窗口关闭流程，避免残留 inert 与焦点陷阱。 */
function closeLibrary(): void { dismissLibrary?.(); }

/** 关注横条失败时请求原查询重试。 */
function retryFollowedChannels(): void { emit('retryFollowedChannels'); }

/** 横条尾部的加载操作仍交给原游标分页器。 */
function loadMoreChannels(): void { emit('loadMoreChannels'); }

/** 资料库失败时重试当前入口的原查询。 */
function retryLibrary(): void { emit('retryLibrary'); }

/** 窗口追加请求交回页面持有的所属频道查询，不由弹层重新取数。 */
function loadMoreLibrary(): void { emit('loadMoreLibrary'); }

/** 标签键盘巡游将同一目标提交给页面所有者并聚焦，避免同步读取尚未回传的 model。 */
function onTabKeydown(event: KeyboardEvent): void {
	const currentIndex: number = tabs.value.findIndex(/** 标签值来自同一导航定义。 */ (item: CommunityTabOption): boolean => item.value === tab.value);
	let nextIndex: number | null = null;
	if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.value.length;
	else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.value.length) % tabs.value.length;
	else if (event.key === 'Home') nextIndex = 0;
	else if (event.key === 'End') nextIndex = tabs.value.length - 1;
	if (nextIndex == null) return;
	event.preventDefault();
	const nextTab: TwitterCommunitiesTab = tabs.value[nextIndex].value;
	tab.value = nextTab;
	tabList.value?.querySelector<HTMLButtonElement>(`#twitter-communities-tab-${nextTab}`)?.focus();
}

onDeactivated(closeLibrary);
onBeforeUnmount(closeLibrary);
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);

	&.mobile {
		padding-bottom: calc(72px + env(safe-area-inset-bottom));
	}
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

.header {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	height: var(--twitter-header-height);
	padding: 0 var(--twitter-space-2);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	backdrop-filter: blur(12px);
}

.iconButton {
	display: grid;
	flex: 0 0 var(--twitter-touch-target);
	place-items: center;
	width: var(--twitter-touch-target);
	height: var(--twitter-touch-target);
	border-radius: var(--twitter-radius-pill);
	font-size: var(--twitter-font-size-title);

	&:hover { background: var(--twitter-hover); }
	&:focus-visible { outline: 2px solid var(--twitter-accent); outline-offset: -2px; }
}

.title {
	flex: 1;
	min-width: 0;
	margin: 0;
	padding-inline: var(--twitter-space-2);
	overflow: hidden;
	font-size: var(--twitter-font-size-heading);
	font-weight: 800;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.searchField { flex: 1; min-width: 0; }

.tabs {
	--twitter-tab-indicator-inset: var(--twitter-space-3);
	position: relative;
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.tab {
	position: relative;
	display: grid;
	place-items: center;
	min-height: var(--twitter-header-height);
	padding: 0 var(--twitter-space-3);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-content);
	font-weight: 700;

	&:hover { background: var(--twitter-hover); }
	&:focus-visible { outline: 2px solid var(--twitter-accent); outline-offset: -2px; }
}

.activeTab {
	color: var(--twitter-fg);
}

.emptyGuide {
	display: grid;
	justify-items: center;
	gap: var(--twitter-space-4);
	padding: var(--twitter-space-6) var(--twitter-space-4);
	text-align: center;

	h2 { margin: 0; font-size: var(--twitter-font-size-title); }
}

.searchResults {
	display: grid;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-4);
}
</style>
