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
	v-model:ownedPanelVisible="ownedPanelVisible"
	v-model:favoritesPanelVisible="favoritesPanelVisible"
	:followedTimelinePaginator="followedTimelinePaginator"
	:globalTimelinePaginator="globalTimelinePaginator"
	:followedChannelsPaginator="followedChannelsPaginator"
	:featuredPaginator="featuredPaginator"
	:ownedPaginator="ownedPaginator"
	:favoritesPaginator="favoritesPaginator"
	:onSearch="searchFromCommunitiesBar"
	:searchPaginator="channelPaginator"
	:searchKey="key"
	:canCreateChannel="$i != null && $i.policies.canCreateChannel"
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
		<div v-else-if="tab === 'owned'" class="_gaps">
			<MkButton v-if="$i?.policies.canCreateChannel" type="routerLink" primary rounded to="/channels/new"><i class="ti ti-plus"></i> {{ i18n.ts.createNew }}</MkButton>
			<MkPagination v-slot="{items}" :paginator="ownedPaginator">
				<div :class="$style.root">
					<MkChannelPreview v-for="channel in items" :key="channel.id" :channel="channel"/>
				</div>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import type { Ref } from 'vue';
import { useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { computed, defineAsyncComponent, inject, markRaw, onMounted, ref, shallowRef } from 'vue';
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
import { $i } from '@/i.js';
import { DI } from '@/di.js';

/** Twitter UI 页面变体（Communities IA，ADR-0005；异步加载，default UI 不承担其分包成本）。 */
const TwitterCommunities = defineAsyncComponent(() => import('./TwitterCommunities.vue'));

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
/** Twitter Communities 双 tab 状态（home / explore；P-26，页面层持有以支持回访定向刷新）。 */
const twitterTab = ref<'home' | 'explore'>('home');
/** 折叠体显示由业务包裹节点报告，不持有频道实体副本。 */
const ownedPanelVisible: Ref<boolean> = ref<boolean>(false);
const favoritesPanelVisible: Ref<boolean> = ref<boolean>(false);
const searchQuery = ref('');
const searchType = ref<SearchType>('nameAndDescription');

/** 搜索结果分页器（null = 尚未执行搜索；Twitter 变体经 prop 消费）。 */
const channelPaginator = shallowRef<Paginator<'channels/search'> | null>(null);

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
const ownedPaginator = markRaw(new Paginator('channels/owned', {
	limit: 10,
}));

/** Twitter Communities：已关注频道帖子聚合流（ADR-0005 D2，channels/followed-timeline）。 */
const followedTimelinePaginator = markRaw(new Paginator('channels/followed-timeline', {
	limit: 10,
}));

/** Twitter Communities：全频道帖子聚合流（ADR-0005 D3，channels/global-timeline）。 */
const globalTimelinePaginator = markRaw(new Paginator('channels/global-timeline', {
	limit: 10,
}));

/** Twitter Communities：已关注频道横条（Home 顶部；复用既有 channels/followed）。 */
const followedChannelsPaginator = markRaw(new Paginator('channels/followed', {
	limit: 20,
}));

/** 独立集合分别处理回访；不以非空判断是否初始化，不订阅聚合实时流。 */
useTwitterPaginatorRefresh(/** 已关注频道聚合流。 */ (): typeof followedTimelinePaginator => followedTimelinePaginator,
	/** 仅 Twitter Home 存在此面板。 */ (): boolean => isTwitterUi.value && twitterTab.value === 'home');
useTwitterPaginatorRefresh(/** 全频道聚合流。 */ (): typeof globalTimelinePaginator => globalTimelinePaginator,
	/** 聚合流保持 ADR-0005 的手动／回访刷新边界。 */ (): boolean => isTwitterUi.value && twitterTab.value === 'explore');
useTwitterPaginatorRefresh(/** 空关注横条也需要回访更新。 */ (): typeof followedChannelsPaginator => followedChannelsPaginator,
	/** 不在 Explore 后台预取横条。 */ (): boolean => isTwitterUi.value && twitterTab.value === 'home');
useTwitterPaginatorRefresh(/** 推荐频道集合。 */ (): typeof featuredPaginator => featuredPaginator,
	/** 当前 UI 的推荐面板。 */ (): boolean => isTwitterUi.value ? twitterTab.value === 'explore' : tab.value === 'featured');
useTwitterPaginatorRefresh(/** 收藏频道集合独立于菜单缓存。 */ (): typeof favoritesPaginator => favoritesPaginator,
	/** 已挂载管理区随 Explore 回访；折叠不创建新业务副本。 */ (): boolean => isTwitterUi.value ? twitterTab.value === 'explore' && favoritesPanelVisible.value : tab.value === 'favorites');
useTwitterPaginatorRefresh(/** 管理频道列表。 */ (): typeof ownedPaginator => ownedPaginator,
	/** 创建频道后回访也更新原空集合。 */ (): boolean => isTwitterUi.value ? twitterTab.value === 'explore' && ownedPanelVisible.value : tab.value === 'owned');
useTwitterPaginatorRefresh(/** 默认界面原关注列表。 */ (): typeof followingPaginator => followingPaginator,
	/** 不为未挂载的默认分支发请求。 */ (): boolean => !isTwitterUi.value && tab.value === 'following');

async function search() {
	const query = searchQuery.value.toString().trim();

	if (query == null) return;

	const type = searchType.value.toString().trim();

	if (type !== 'nameAndDescription' && type !== 'nameOnly') {
		console.error(`Unrecognized search type: ${type}`);
		return;
	}

	/* 重复提交完全相同的 query+type 时 key 不变 → MkChannelList 不重挂载 →
	 * 新建 Paginator 无人调用 init()，fetching 停留在初始 true 造成无限加载
	 * （K-14，上游既有缺陷）。同参重复搜索改为刷新既有分页器。 */
	const nextKey = query + type;
	if (key.value === nextKey && channelPaginator.value != null) {
		void channelPaginator.value.reload();
		return;
	}

	channelPaginator.value = markRaw(new Paginator('channels/search', {
		limit: 10,
		params: {
			query: searchQuery.value,
			type: type,
		},
	}));

	key.value = nextKey;
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
</style>
