<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<TwitterCommunities
	v-if="isTwitterUi"
	v-model:tab="twitterTab"
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
import { computed, defineAsyncComponent, inject, markRaw, onActivated, onMounted, ref, shallowRef } from 'vue';
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

/** legacy 当前 tab 对应的频道列表分页器（K-08 回访定向刷新目标；search tab 由用户提交驱动，不自动刷新）。 */
function activeListPaginator(): Paginator<'channels/featured'> | Paginator<'channels/my-favorites'> | Paginator<'channels/followed'> | Paginator<'channels/owned'> | null {
	switch (tab.value) {
		case 'featured': return featuredPaginator;
		case 'favorites': return favoritesPaginator;
		case 'following': return followingPaginator;
		case 'owned': return ownedPaginator;
		default: return null;
	}
}

/** Twitter Communities 当前 tab 对应的聚合流分页器（回访定向刷新目标）。 */
function activeCommunitiesPaginator(): Paginator<'channels/followed-timeline'> | Paginator<'channels/global-timeline'> | null {
	switch (twitterTab.value) {
		case 'home': return followedTimelinePaginator;
		case 'explore': return globalTimelinePaginator;
		default: return null;
	}
}

/** 条件重载：仅对已加载（有条目）的分页器执行；未加载过的由 MkPagination / MkNotesTimeline 首次渲染自然拉取，避免 API 风暴。 */
function reloadConditionally(paginator: Paginator<'channels/featured'> | Paginator<'channels/my-favorites'> | Paginator<'channels/followed'> | Paginator<'channels/owned'> | Paginator<'channels/followed-timeline'> | Paginator<'channels/global-timeline'> | null): void {
	if (paginator == null || paginator.items.value.length === 0) return;
	void paginator.reload();
}

/** KeepAlive 首次激活跳过标志（挂载期已完成首拉，防止双拉）。 */
let skipNextActivation = true;

/** 回访刷新（K-08：创建 / 关注 / 收藏频道后回访不陈旧）。
 *  注：tab 切换不需要在此刷新——tab 面板为 v-if 链，目标面板的分页组件重挂载时
 *  onMounted 自带 paginator.init()；若此处再 watch(tab) reload 会与其并发双 init，
 *  两个响应先后 pushItems 产生重复项（回归教训，见 keepalive-freshness-audit）。
 *  Twitter Communities 双 tab 同理（聚合流为 MkNotesTimeline，同为挂载期 init）。 */
onActivated(() => {
	if (skipNextActivation) {
		skipNextActivation = false;
		return;
	}
	if (isTwitterUi.value) {
		reloadConditionally(activeCommunitiesPaginator());
		/* Home 横条跟随关注态变化，回访时一并刷新 */
		reloadConditionally(followedChannelsPaginator);
	} else {
		reloadConditionally(activeListPaginator());
	}
});

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
