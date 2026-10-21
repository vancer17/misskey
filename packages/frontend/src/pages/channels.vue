<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：社区与频道集合。
作用：协调已确认写入与缓存回访，复用原查询及基础组件，不复制业务状态。
数据链：成功通知／回访 → 页面数据所有者 → 只读显示；不解释环境探测。
-->

<template>
<TwitterCommunities
	v-if="isTwitterUi"
	v-model:tab="twitterTab"
	v-model:searching="twitterSearching"
	v-model:library="twitterLibrary"
	:followedTimelinePaginator="followedTimelinePaginator"
	:globalTimelinePaginator="globalTimelinePaginator"
	:followedChannelsPaginator="followedChannelsPaginator"
	:ownedView="ownedChannels.view"
	:favoritesPaginator="favoritesPaginator"
	:onSearch="searchFromCommunitiesBar"
	:searchPaginator="channelPaginator"
	:searchKey="key"
	:canCreateChannel="$i != null && $i.policies.canCreateChannel"
	@retryFollowedChannels="retryFollowedChannels"
	@loadMoreChannels="loadMoreChannels"
	@retryLibrary="retryLibrary"
	@loadMoreLibrary="loadMoreOwnedChannels"
/>
<PageWithHeader v-else v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div class="_spacer" style="--MI_SPACER-w: 1200px;">
		<div v-if="tab === 'search'" :class="$style.searchRoot">
			<div class="_gaps">
				<MkInput v-model="searchQuery" :large="true" :autofocus="true" type="search" @enter="search">
					<template #prefix><i class="ti ti-search"></i></template>
				</MkInput>
				<MkRadios
					v-model="searchType"
					:options="[
						{ value: 'nameAndDescription', label: i18n.ts._channel.nameAndDescription },
						{ value: 'nameOnly', label: i18n.ts._channel.nameOnly },
					]"
					@update:modelValue="search()"
				>
				</MkRadios>
				<MkButton large primary gradate rounded @click="search">{{ i18n.ts.search }}</MkButton>
			</div>

			<MkFoldableSection v-if="channelPaginator">
				<template #header>{{ i18n.ts.searchResult }}</template>
				<MkChannelList :key="key" :paginator="channelPaginator"/>
			</MkFoldableSection>
		</div>
		<div v-if="tab === 'featured'">
			<MkPagination v-slot="{items}" :paginator="featuredPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
		<div v-else-if="tab === 'favorites'">
			<MkPagination v-slot="{items}" :paginator="favoritesPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
		<div v-else-if="tab === 'following'">
			<MkPagination v-slot="{items}" :paginator="followingPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
		<div v-else-if="tab === 'owned'" ref="ownedRoot" class="_gaps" data-testid="owned-channels" tabindex="-1" :aria-busy="ownedView.status === 'loading'">
			<MkButton v-if="$i?.policies.canCreateChannel" type="routerLink" primary rounded to="/channels/new"><i class="ti ti-plus"></i> {{ i18n.ts.createNew }}</MkButton>
			<MkLoading v-if="ownedView.status === 'loading' && ownedView.items.length === 0"/>
			<div v-if="ownedView.items.length > 0" :class="$style.root">
				<MkChannelPreview v-for="channel in ownedView.items" :key="channel.id" :channel="channel" data-community-library-item/>
			</div>
			<div v-if="ownedView.status !== 'loading' || ownedView.items.length > 0" :class="$style.ownedStatus" role="status" aria-live="polite" data-community-library-status tabindex="-1">
				<template v-if="ownedView.status === 'error'">
					<p>{{ i18n.ts.somethingHappened }}</p>
					<MkButton data-community-library-action @click="retryOwnedChannels">{{ i18n.ts.retry }}</MkButton>
				</template>
				<p v-else-if="ownedView.items.length === 0">{{ i18n.ts._channel.noOwned }}</p>
				<MkButton v-else-if="ownedView.hasMore || ownedView.status === 'loading'" :disabled="ownedView.status === 'loading'" data-testid="owned-channels-more" data-community-library-action @click="loadMoreOwnedChannels">
					{{ ownedView.status === 'loading' ? i18n.ts.loading : i18n.ts.loadMore }}
				</MkButton>
				<p v-else>{{ i18n.ts._channel.allShown }}</p>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import type { Component, ComputedRef, Ref, ShallowRef } from 'vue';
import { createOwnedChannelsQuery, useChannelLibraryFocus, useTwitterPaginatorRefresh, useTwitterRefresh } from '@/ui/twitter/index.js';
import type { OwnedChannelsQuery, TwitterCommunitiesTab, TwitterCommunityLibrary, TwitterCommunityLibraryView } from '@/ui/twitter/index.js';
import { computed, defineAsyncComponent, inject, markRaw, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { Endpoints } from 'misskey-js';
import MkChannelPreview from '@/components/MkChannelPreview.vue';
import MkChannelList from '@/components/MkChannelList.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkInput from '@/components/MkInput.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkButton from '@/components/MkButton.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';
import { Paginator } from '@/utility/paginator.js';
import type { IPaginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';

/** Twitter UI 页面变体（Communities IA，ADR-0005；异步加载，default UI 不承担其分包成本）。 */
const TwitterCommunities = defineAsyncComponent(/** 按需加载 Twitter 页面展示，不将查询所有权移入组件。 */ (): Promise<{ default: Component }> => import('./TwitterCommunities.vue'));

const router = useRouter();

/** 频道搜索类型（权威单源：misskey-js endpoints Schema 派生；req.type 为可选字段，剔除 undefined）。 */
type SearchType = NonNullable<Endpoints['channels/search']['req']['type']>;

const props = defineProps<{
	query: string;
	type?: SearchType;
}>();

const key = ref('');
/** legacy 五 tab 状态（default UI 分支专用）。 */
const tab = ref('featured');
/** 主标签只保存导航意图，取数与回访均引用同一领域类型。 */
const twitterTab: Ref<TwitterCommunitiesTab> = ref<TwitterCommunitiesTab>('home');
/** 搜索结果覆盖主内容时，后台集合不主动刷新。 */
const twitterSearching: Ref<boolean> = ref<boolean>(false);
/** 管理／收藏窗口为临时 UI 状态，实体归页面唯一查询所有者。 */
const twitterLibrary: Ref<TwitterCommunityLibrary | null> = ref<TwitterCommunityLibrary | null>(null);
/** 缓存页真正停用时不触发首拉或后台取数。 */
const pageActive: Ref<boolean> = ref<boolean>(true);
const searchQuery = ref('');
const searchType = ref<SearchType>('nameAndDescription');

/** 搜索结果分页器（null = 尚未执行搜索；Twitter 变体经 prop 消费）。 */
const channelPaginator: ShallowRef<Paginator<'channels/search'> | null> = shallowRef<Paginator<'channels/search'> | null>(null);

/** 当前 UI 样式（由 Twitter Shell 注入；非 Twitter 场景回退 'default'）。 */
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');

onMounted(() => {
	searchQuery.value = props.query ?? '';
	searchType.value = props.type ?? 'nameAndDescription';
});

const featuredPaginator = markRaw(new Paginator('channels/featured', {
	limit: 10,
	noPaging: true,
}));
const favoritesPaginator = markRaw(new Paginator('channels/my-favorites', {
	limit: 100,
	noPaging: true,
}));
const followingPaginator = markRaw(new Paginator('channels/followed', {
	limit: 10,
}));
/** 两种界面的所属频道共用一个查询所有者，窗口关闭不会丢弃已确认页。 */
const ownedChannels: OwnedChannelsQuery = createOwnedChannelsQuery();
/** 原界面也直接消费同一只读投影，不再建立另一个 owned 分页器。 */
const ownedView: ComputedRef<TwitterCommunityLibraryView> = ownedChannels.view;
/** 所属频道仅在当前入口真实可见时初始化或消费回访刷新。 */
const ownedVisible: ComputedRef<boolean> = computed<boolean>(/** 可见性不从集合是否为空推断。 */ (): boolean =>
	pageActive.value && (isTwitterUi.value ? twitterLibrary.value === 'owned' : tab.value === 'owned'));
/** 原界面的列表容器只提供 DOM 焦点范围，不保存频道状态副本。 */
const ownedRoot: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('ownedRoot');
/** 原界面与管理弹窗共用相同的键盘追加衔接。 */
const rememberOwnedFocus: (event?: MouseEvent) => void = useChannelLibraryFocus(ownedView, ownedRoot, /** 缓存页隐藏时不抢回焦点。 */ (): boolean => ownedVisible.value);

/** Twitter Communities：已关注频道帖子聚合流（ADR-0005 D2，channels/followed-timeline）。 */
const followedTimelinePaginator = markRaw(new Paginator('channels/followed-timeline', {
	limit: 10,
}));

/** Twitter Communities：全频道帖子聚合流（ADR-0005 D3，channels/global-timeline）。 */
const globalTimelinePaginator = markRaw(new Paginator('channels/global-timeline', {
	limit: 10,
}));

/** Twitter Communities：已关注频道横条（Home 顶部；复用既有 channels/followed）。 */
const followedChannelsPaginator: Paginator<'channels/followed'> = markRaw(new Paginator('channels/followed', {
	limit: 20,
	// 此端点按上限返回完整集合；使用原分页器的数量探测，避免少量频道仍显示多余分页入口。
	canFetchDetection: 'limit',
}));

/** 仅记录分页器是否由本页面发起过首拉，不复制集合或成功／错误事实。 */
const initializedPaginators: WeakSet<IPaginator> = new WeakSet<IPaginator>();
/** 首页当前是否实际展示，搜索和资料库覆盖时不消费回访刷新。 */
const twitterHomeVisible: ComputedRef<boolean> = computed<boolean>(/** UI 可见性只调度查询。 */ (): boolean =>
	isTwitterUi.value && pageActive.value && !twitterSearching.value && twitterLibrary.value == null && twitterTab.value === 'home');
/** 发现页可见性和首页互斥。 */
const twitterExploreVisible: ComputedRef<boolean> = computed<boolean>(/** 不以频道内容反推导航状态。 */ (): boolean =>
	isTwitterUi.value && pageActive.value && !twitterSearching.value && twitterLibrary.value == null && twitterTab.value === 'explore');

/** 每个实例只由页面发起一次首拉，合法空集合不会被误判为尚未初始化。 */
function initializePaginator(paginator: IPaginator): void {
	if (initializedPaginators.has(paginator)) return;
	initializedPaginators.add(paginator);
	void paginator.init();
}

/** 只初始化当前入口需要的原查询，展示组件统一关闭自动首拉。 */
function initializeVisiblePaginators(): void {
	if (!isTwitterUi.value || !pageActive.value) return;
	if (twitterLibrary.value != null) {
		if (twitterLibrary.value === 'favorites') initializePaginator(favoritesPaginator);
	} else if (twitterHomeVisible.value) {
		initializePaginator(followedChannelsPaginator);
		initializePaginator(followedTimelinePaginator);
	} else if (twitterExploreVisible.value) {
		initializePaginator(globalTimelinePaginator);
	}
}

watch([isTwitterUi, twitterTab, twitterSearching, twitterLibrary, pageActive], initializeVisiblePaginators, { immediate: true, flush: 'post' });
watch(ownedVisible, /** 首拉幂等性由查询状态负责，失败和合法空集合不被当作未初始化。 */ (visible: boolean): void => {
	if (visible) void ownedChannels.initialize();
}, { immediate: true, flush: 'post' });
onActivated(/** 原缓存页恢复后再消费当前入口。 */ (): void => { pageActive.value = true; });
onDeactivated(/** 隐藏页面不响应其子树关闭窗口造成的导航状态变化。 */ (): void => { pageActive.value = false; });
onBeforeUnmount(/** 仅在页面所有者销毁时取消所属频道请求，关闭窗口不销毁查询。 */ (): void => { ownedChannels.dispose(); });

useTwitterPaginatorRefresh(/** 已关注频道聚合流。 */ (): typeof followedTimelinePaginator => followedTimelinePaginator,
	/** 首拉由页面负责，回访仍由原调度器合并。 */ (): boolean => twitterHomeVisible.value);
useTwitterPaginatorRefresh(/** 全频道聚合流。 */ (): typeof globalTimelinePaginator => globalTimelinePaginator,
	/** 搜索覆盖时不发后台请求。 */ (): boolean => twitterExploreVisible.value);
useTwitterPaginatorRefresh(/** 空关注横条也需要回访更新。 */ (): typeof followedChannelsPaginator => followedChannelsPaginator,
	/** 横条与首页帖子共用可见边界。 */ (): boolean => twitterHomeVisible.value);
useTwitterPaginatorRefresh(/** 原界面推荐集合维持固定十条的端点语义。 */ (): typeof featuredPaginator => featuredPaginator,
	/** 推荐频道仅由原界面的推荐标签消费。 */ (): boolean => !isTwitterUi.value && tab.value === 'featured');
useTwitterPaginatorRefresh(/** 收藏集合不借用菜单缓存。 */ (): typeof favoritesPaginator => favoritesPaginator,
	/** 只在当前资料库窗口展示时消费回访。 */ (): boolean => isTwitterUi.value ? pageActive.value && twitterLibrary.value === 'favorites' : tab.value === 'favorites');
useTwitterRefresh(/** 回访复用通用调度，将取消信号传给所属频道的唯一查询。 */ (signal: AbortSignal): Promise<boolean> => ownedChannels.reload(signal), {
	visible: /** 资料库关闭时保留刷新意图，原界面使用同一可见边界。 */ (): boolean => ownedVisible.value,
	busy: /** 首拉、刷新和追加均占用当前查询。 */ (): boolean => ownedChannels.state.value.status === 'loading',
	initializing: /** 首拉同步覆盖此前回访意图，避免首次进入连续取两页。 */ (): boolean =>
		ownedChannels.state.value.status === 'loading' && ownedChannels.state.value.operation === 'initial',
});
useTwitterPaginatorRefresh(/** 默认界面原关注列表。 */ (): typeof followingPaginator => followingPaginator,
	/** 不为未挂载的默认分支发请求。 */ (): boolean => !isTwitterUi.value && tab.value === 'following');

/** 用户重试只操作空闲的原分页器，避免在途 init 相互覆盖。 */
function retryPaginator(paginator: IPaginator): void {
	if (!paginator.fetching.value && !paginator.fetchingOlder.value && !paginator.fetchingNewer.value) void paginator.reload();
}

/** 关注频道错误的显式恢复入口。 */
function retryFollowedChannels(): void { retryPaginator(followedChannelsPaginator); }

/** 横向排版保留服务端游标，不将关注集合截断为固定列表。 */
function loadMoreChannels(): void { void followedChannelsPaginator.fetchOlder(); }

/** 两种界面的所属频道重试都重放失败操作，追加失败保留原游标。 */
function retryOwnedChannels(event?: MouseEvent): void {
	rememberOwnedFocus(event);
	void ownedChannels.retry();
}

/** 更多意图只交给页面查询，重复点击由其在途守卫合并。 */
function loadMoreOwnedChannels(event?: MouseEvent): void {
	if (ownedView.value.status === 'loading' || !ownedView.value.hasMore) return;
	rememberOwnedFocus(event);
	void ownedChannels.loadMore();
}

/** 资料库窗口的重试始终定位当前唯一查询。 */
function retryLibrary(): void {
	if (twitterLibrary.value === 'owned') retryOwnedChannels();
	else if (twitterLibrary.value === 'favorites') retryPaginator(favoritesPaginator);
}

/** 搜索复用频道实体端点；同参提交刷新原实例，首次搜索由唯一页面所有者初始化。 */
function search(): void {
	const query: string = searchQuery.value.trim();
	if (query === '') return;
	const type: SearchType = searchType.value;
	const nextKey: string = JSON.stringify([query, type]);
	if (key.value === nextKey && channelPaginator.value != null) {
		retryPaginator(channelPaginator.value);
		return;
	}
	const nextPaginator: Paginator<'channels/search'> = markRaw(new Paginator('channels/search', {
		limit: 10,
		params: { query, type },
	}));
	channelPaginator.value = nextPaginator;
	key.value = nextKey;
	if (isTwitterUi.value) initializePaginator(nextPaginator);
}

/** Twitter 变体搜索回调：同步页面层搜索状态后走统一 search 流程
 *  （业务 funnel 单点；变体只持临时输入状态，规范第 12 条）。 */
function searchFromTwitter(query: string, type: SearchType): void {
	searchQuery.value = query;
	searchType.value = type;
	void search();
}

/** Communities 常驻搜索回调（P-26）：搜索条不含类型单选，固定按名称+描述检索
 *  （X Communities 搜索行为），复用统一 search 流程（含 K-14 守卫）。 */
function searchFromCommunitiesBar(query: string): void {
	searchFromTwitter(query, 'nameAndDescription');
}

const headerActions = computed(() => []);

const headerTabs = computed(() => [{
	key: 'search',
	title: i18n.ts.search,
	icon: 'ti ti-search',
}, {
	key: 'featured',
	title: i18n.ts._channel.featured,
	icon: 'ti ti-comet',
}, {
	key: 'favorites',
	title: i18n.ts.favorites,
	icon: 'ti ti-star',
}, {
	key: 'following',
	title: i18n.ts._channel.following,
	icon: 'ti ti-eye',
}, {
	key: 'owned',
	title: i18n.ts._channel.owned,
	icon: 'ti ti-edit',
}]);

definePage(() => ({
	title: i18n.ts.channel,
	icon: 'ti ti-device-tv',
}));
</script>

<style lang="scss" module>
.searchRoot {
	width: 100%;
	max-width: 700px;
	margin: 0 auto;
}

.root {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
	gap: var(--MI-margin);
}

.ownedStatus {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--MI-margin);
	text-align: center;

	p { margin: 0; }
}
</style>
