<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：频道详情与统计。
作用：协调已确认写入与缓存回访，复用原查询及基础组件，不复制业务状态。
数据链：成功通知／回访 → 页面数据所有者 → 只读显示；不解释环境探测。
-->

<template>
<TwitterChannel
	v-if="isTwitterUi"
	v-model:tab="twitterTab"
	:channelId="channelId"
	:state="channelState"
	:featuredState="featuredState"
	:notesSearchAvailable="notesSearchAvailable"
	:searchPaginator="searchPaginator"
	:searchKey="searchKey"
	:actions="twitterActions"
	:onJoin="joinChannel"
	:onLeave="leaveChannel"
	:onFavorite="favorite"
	:onUnfavorite="unfavorite"
	:onSearch="searchFromTwitter"
	:featuredRefresher="refreshFeatured"
	@retry="retryChannel"
	@featuredMore="loadMoreFeatured"
	@featuredRetry="retryFeatured"
	@featuredRefresh="refreshFeatured"
/>
<PageWithHeader v-else v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<div v-if="channel && tab === 'overview'" class="_gaps">
			<div class="_panel" :class="$style.bannerContainer">
				<XChannelFollowButton :channel="channel" :full="true" :class="$style.subscribe"/>
				<MkButton v-if="favorited" v-tooltip="i18n.ts.unfavorite" asLike class="button" rounded primary :class="$style.favorite" @click="unfavorite()"><i class="ti ti-star"></i></MkButton>
				<MkButton v-else v-tooltip="i18n.ts.favorite" asLike class="button" rounded :class="$style.favorite" @click="favorite()"><i class="ti ti-star"></i></MkButton>
				<div :style="{ backgroundImage: channel.bannerUrl ? `url(${channel.bannerUrl})` : undefined }" :class="$style.banner">
					<div :class="$style.bannerStatus">
						<div><i class="ti ti-users ti-fw"></i><I18n :src="i18n.ts._channel.usersCount" tag="span" style="margin-left: 4px;"><template #n><b>{{ channel.usersCount }}</b></template></I18n></div>
						<div><i class="ti ti-pencil ti-fw"></i><I18n :src="i18n.ts._channel.notesCount" tag="span" style="margin-left: 4px;"><template #n><b>{{ channel.notesCount }}</b></template></I18n></div>
						<div v-if="$i != null && channel != null && $i.id === channel.userId" style="color: var(--MI_THEME-warn)"><i class="ti ti-user-star ti-fw"></i><span style="margin-left: 4px;">{{ i18n.ts.youAreAdmin }}</span></div>
					</div>
					<div v-if="channel.isSensitive" :class="$style.sensitiveIndicator">{{ i18n.ts.sensitive }}</div>
					<div :class="$style.bannerFade"></div>
				</div>
				<div v-if="channel.description" :class="$style.description">
					<Mfm :text="channel.description" :isNote="false"/>
				</div>
			</div>

			<MkFoldableSection>
				<template #header><i class="ti ti-pin ti-fw" style="margin-right: 0.5em;"></i>{{ i18n.ts.pinnedNotes }}</template>
				<div v-if="channel.pinnedNotes && channel.pinnedNotes.length > 0" class="_gaps">
					<MkNote v-for="note in channel.pinnedNotes" :key="note.id" class="_panel" :note="note"/>
				</div>
			</MkFoldableSection>
		</div>
		<div v-if="channel && tab === 'timeline'" class="_gaps">
			<MkInfo v-if="channel.isArchived" warn>{{ i18n.ts.thisChannelArchived }}</MkInfo>

			<!-- スマホ・タブレットの場合、キーボードが表示されると投稿が見づらくなるので、デスクトップ場合のみ自動でフォーカスを当てる -->
			<MkPostForm v-if="$i && prefer.r.showFixedPostFormInChannel.value" :channel="channel" class="post-form _panel" fixed :autofocus="deviceKind === 'desktop'"/>

			<MkStreamingNotesTimeline :key="channelId" src="channel" :channel="channelId"/>
		</div>
		<div v-else-if="tab === 'featured'">
			<MkNotesTimeline v-if="featuredPaginator != null" :paginator="featuredPaginator"/>
		</div>
		<div v-else-if="tab === 'search'">
			<div v-if="notesSearchAvailable" class="_gaps">
				<div>
					<MkInput v-model="searchQuery" @enter="search()">
						<template #prefix><i class="ti ti-search"></i></template>
					</MkInput>
					<MkButton primary rounded style="margin-top: 8px;" @click="search()">{{ i18n.ts.search }}</MkButton>
				</div>
				<MkNotesTimeline v-if="searchPaginator" :key="searchKey" :paginator="searchPaginator"/>
			</div>
			<div v-else>
				<MkInfo warn>{{ i18n.ts.notesSearchNotAvailable }}</MkInfo>
			</div>
		</div>
	</div>
	<template #footer>
		<div :class="$style.footer">
			<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 16px;">
				<div class="_buttonsCenter">
					<MkButton inline rounded primary gradate @click="openPostForm()"><i class="ti ti-pencil"></i> {{ i18n.ts.postToTheChannel }}</MkButton>
				</div>
			</div>
		</div>
	</template>
</PageWithHeader>
</template>

<script lang="ts" setup>
import type { ComputedRef, Ref } from 'vue';
import { onBeforeUnmount } from 'vue';
import { useGlobalEvent } from '@/events.js';
import { createChannelDetailQuery, createChannelFeaturedQuery, resolveChannelCommunityTab, useTwitterRefresh, useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import type { ChannelCommunityTab, ChannelDetailState, ChannelDetailQuery, ChannelFeaturedState, ChannelFeaturedQuery } from '@/ui/twitter/index.js';
import { loadTwitterChannelPage } from '@/ui/twitter/routing/index.js';
import { computed, watch, ref, markRaw, shallowRef, defineAsyncComponent, inject } from 'vue';
import * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import { useInterval } from '@@/js/use-interval.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkPostForm from '@/components/MkPostForm.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import XChannelFollowButton from '@/components/MkChannelFollowButton.vue';
import * as os from '@/os.js';
import { $i, iAmModerator } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { deviceKind } from '@/utility/device-kind.js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import { favoritedChannelsCache } from '@/cache.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import { prefer } from '@/preferences.js';
import MkNote from '@/components/MkNote.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import { isSupportShare } from '@/utility/navigator.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { notesSearchAvailable } from '@/utility/check-permissions.js';
import { miLocalStorage } from '@/local-storage.js';
import { useRouter } from '@/router.js';
import { Paginator } from '@/utility/paginator.js';
import { DI } from '@/di.js';

/** Twitter UI 页面变体（异步加载，default UI 不承担其分包成本）。 */
const TwitterChannel = defineAsyncComponent(loadTwitterChannelPage);

const router = useRouter();

const props = defineProps<{
	channelId: string;
}>();

/** Legacy 标签沿用原路由行为；Twitter 标签由 domain 规则单向校正。 */
const tab: Ref<string> = ref<string>('overview');
/** 标签为临时 UI 选择，频道未确认时不猜测关注关系。 */
const twitterTab: Ref<ChannelCommunityTab | null> = ref<ChannelCommunityTab | null>(null);
/** 两种界面共享唯一频道资料所有者，不在页面再持有实体副本。 */
const channelQuery: ChannelDetailQuery = createChannelDetailQuery();
const channelState: ComputedRef<ChannelDetailState> = channelQuery.state;
const channel: ComputedRef<Misskey.entities.Channel | null> = computed(/** 展示从确认实体派生。 */ (): Misskey.entities.Channel | null => channelState.value.channel);
const favorited: ComputedRef<boolean> = computed(/** 收藏事实来自确认实体，不作为关注关系使用。 */ (): boolean => channel.value?.isFavorited ?? false);
/** Twitter 热门集合取代其原 Paginator；legacy 分支继续使用原分页器。 */
const featuredQuery: ChannelFeaturedQuery = createChannelFeaturedQuery();
const featuredState: ComputedRef<ChannelFeaturedState> = featuredQuery.state;
const searchQuery = ref('');

/** 频道内笔记搜索结果分页器（null = 尚未搜索；Twitter 变体经 prop 消费）。 */
const searchPaginator = shallowRef<Paginator<'notes/search'> | null>(null);
const searchKey = ref('');

/** 当前 UI 样式（由 Twitter Shell 注入；非 Twitter 场景回退 'default'）。 */
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');
const featuredPaginator: Paginator<'notes/featured'> | null = isTwitterUi.value ? null : markRaw(new Paginator('notes/featured', {
	limit: 10,
	computedParams: computed(() => ({
		channelId: props.channelId,
	})),
}));

useInterval(() => {
	if (channel.value == null) return;
	miLocalStorage.setItemAsJson(`channelLastReadedAt:${channel.value.id}`, Date.now());
}, 3000, {
	immediate: true,
	afterMounted: true,
});

/** 新范围同步撤下旧频道，资料与热门集合各自只有一个查询所有者。 */
watch(/** 路由只负责选择实体身份。 */ (): string => props.channelId,
	/** 初次请求沿用 legacy 默认标签；Twitter 由确认关系规则决定。 */ (channelId: string): void => {
		tab.value = 'overview';
		featuredQuery.select(channelId);
		void channelQuery.select(channelId);
	}, { immediate: true, flush: 'sync' });

watch(channel, /** 已确认实体驱动标签与原已读记录，不从路由或 DTO 反推关系。 */ (current: Misskey.entities.Channel | null, previous: Misskey.entities.Channel | null): void => {
	twitterTab.value = resolveChannelCommunityTab(current, twitterTab.value, previous?.isFollowing);
	if (current == null || previous != null) return;
	if (current.isFavorited || current.isFollowing) tab.value = 'timeline';
	if ((current.isFavorited || current.isFollowing) && current.lastNotedAt) {
		const lastReadedAt: number = miLocalStorage.getItemAsJson(`channelLastReadedAt:${current.id}`) ?? 0;
		const lastNotedAt: number = Date.parse(current.lastNotedAt);
		if (lastNotedAt > lastReadedAt) miLocalStorage.setItemAsJson(`channelLastReadedAt:${current.id}`, lastNotedAt);
	}
}, { flush: 'sync' });

/** 热门页只在真实可见时首拉，不因重新挂载展示组件重复初始化。 */
watch(/** 等待频道关系确认后再选择默认集合。 */ (): boolean => isTwitterUi.value && channel.value != null && twitterTab.value === 'explore',
	/** 成功空集合与失败均由 store 阻止隐式重拉。 */ (visible: boolean): void => { if (visible) void featuredQuery.initialize(); },
	{ immediate: true, flush: 'post' });

/** 资料刷新继续经既有回访调度，store 在同范围内保留已确认内容。 */
const invalidateChannel: () => void = useTwitterRefresh(channelQuery.reload, {
	busy: /** 等待当前资料请求结束。 */ (): boolean => channelState.value.status === 'loading',
});
useTwitterRefresh(featuredQuery.reload, {
	visible: /** 热门查询只在对应 Twitter 标签可见时重新确认。 */ (): boolean => isTwitterUi.value && channel.value != null && twitterTab.value === 'explore',
	busy: /** 在途首拉、刷新和追加由同一所有者串行协调。 */ (): boolean => featuredState.value.status === 'loading',
	initializing: /** 子树首拉已覆盖此前排队的回访。 */ (): boolean => featuredState.value.status === 'loading' && featuredState.value.snapshot == null,
});
useGlobalEvent('notePosted', /** 本频道发帖成功只更新资料统计，Home 继续使用原流式机制。 */ (note: Misskey.entities.Note): void => {
	if (note.channelId === props.channelId) invalidateChannel();
});
useGlobalEvent('noteDeleted', /** 已明确删除的身份从唯一热门集合撤下，同时重新确认统计。 */ (noteId: string): void => {
	featuredQuery.remove(noteId);
	invalidateChannel();
});
useTwitterPaginatorRefresh(/** legacy 热门集合继续复用原分页器。 */ (): typeof featuredPaginator => featuredPaginator,
	/** Twitter 热门集合已有独立唯一所有者，不再刷新无消费者分页器。 */ (): boolean => !isTwitterUi.value && tab.value === 'featured');
useTwitterPaginatorRefresh(/** 已提交搜索仍交给原分页器。 */ (): typeof searchPaginator.value => searchPaginator.value,
	/** 仅刷新实际可见的搜索结果。 */ (): boolean => isTwitterUi.value ? twitterTab.value === 'search' : tab.value === 'search');

/** 用户重试资料请求，失败不把已有频道内容清空。 */
function retryChannel(): void { void channelQuery.reload(); }

/** 下拉与菜单共用热门集合的原子刷新动作。 */
async function refreshFeatured(): Promise<void> { await featuredQuery.reload(); }

/** 加载更多交给查询所有者检查游标和忙闲。 */
function loadMoreFeatured(): void { void featuredQuery.loadMore(); }

/** 按失败用途重试，不把追加失败误作首拉。 */
function retryFeatured(): void { void featuredQuery.retry(); }

onBeforeUnmount(/** 页面销毁时取消其唯一查询，不让响应写入已卸载页面。 */ (): void => { channelQuery.dispose(); featuredQuery.dispose(); });

/** Twitter 变体 Join（P-26 join-gate）：关注频道并回填实体（变体据 isFollowing 翻转落ホーム）。 */
function joinChannel(): void {
	if (channel.value == null) return;

	os.apiWithDialog('channels/follow', {
		channelId: channel.value.id,
	}).then(
		/** 关系命令成功后重新确认频道。 */ (): void => { invalidateChannel(); },
		/** 原对话框已呈现错误，拒绝不刷新或改变关系。 */ (): void => {},
	);
}

/** Twitter 变体 Leave：取关频道并回填实体。 */
function leaveChannel(): void {
	if (channel.value == null) return;

	os.apiWithDialog('channels/unfollow', {
		channelId: channel.value.id,
	}).then(
		/** 关系命令成功后重新确认频道。 */ (): void => { invalidateChannel(); },
		/** 原对话框已呈现错误，拒绝不刷新或改变关系。 */ (): void => {},
	);
}

function edit() {
	router.push('/channels/:channelId/edit', {
		params: {
			channelId: props.channelId,
		},
	});
}

function openPostForm() {
	os.post({
		channel: channel.value,
	});
}

/** 收藏命令成功后仅由查询所有者更新确认实体。 */
function favorite(): void {
	const channelId: string | undefined = channel.value?.id;
	if (channelId == null) return;

	os.apiWithDialog('channels/favorite', {
		channelId,
	}).then(/** 命令结果按发起时的身份归属。 */ (): void => {
		channelQuery.confirmFavorite(channelId, true);
		favoritedChannelsCache.delete();
	});
}

/** 取消收藏经确认对话框成功后提交至唯一实体所有者。 */
async function unfavorite(): Promise<void> {
	const channelId: string | undefined = channel.value?.id;
	if (channelId == null) return;

	const confirm: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({
		type: 'warning',
		text: i18n.ts.unfavoriteConfirm,
	});
	if (confirm.canceled) return;
	os.apiWithDialog('channels/unfavorite', {
		channelId,
	}).then(/** 取消收藏结果不能更新已切换的频道。 */ (): void => {
		channelQuery.confirmFavorite(channelId, false);
		favoritedChannelsCache.delete();
	});
}

/** 静音命令沿用原协议，确认字段由 store 更新。 */
async function mute(): Promise<void> {
	const channelId: string | undefined = channel.value?.id;
	if (channelId == null) return;

	const { canceled, result: period }: Awaited<ReturnType<typeof os.select<string>>> = await os.select({
		title: i18n.ts.mutePeriod,
		items: [{
			value: 'indefinitely', label: i18n.ts.indefinitely,
		}, {
			value: 'tenMinutes', label: i18n.ts.tenMinutes,
		}, {
			value: 'oneHour', label: i18n.ts.oneHour,
		}, {
			value: 'oneDay', label: i18n.ts.oneDay,
		}, {
			value: 'oneWeek', label: i18n.ts.oneWeek,
		}],
		default: 'indefinitely',
	});
	if (canceled) return;

	const expiresAt: number | null = period === 'indefinitely' ? null
		: period === 'tenMinutes' ? Date.now() + (1000 * 60 * 10)
		: period === 'oneHour' ? Date.now() + (1000 * 60 * 60)
		: period === 'oneDay' ? Date.now() + (1000 * 60 * 60 * 24)
		: period === 'oneWeek' ? Date.now() + (1000 * 60 * 60 * 24 * 7)
		: null;

	os.apiWithDialog('channels/mute/create', {
		channelId,
		expiresAt,
	}).then(/** 静音成功后按原身份提交确认事实。 */ (): void => {
		channelQuery.confirmMuted(channelId, true);
	});
}

/** 取消静音复用原接口，组件不直接修改领域实体。 */
async function unmute(): Promise<void> {
	const channelId: string | undefined = channel.value?.id;
	if (channelId == null) return;

	os.apiWithDialog('channels/mute/delete', {
		channelId,
	}).then(/** 取消静音只更新该命令的频道。 */ (): void => {
		channelQuery.confirmMuted(channelId, false);
	});
}

async function search() {
	if (!channel.value) return;

	const query = searchQuery.value.toString().trim();

	if (query == null) return;

	/* 重复提交相同 query 时 key 不变 → 结果组件不重挂载 → 新建 Paginator 无人
	 * 调用 init()，fetching 停留在初始 true 造成无限加载（K-14，同 channels.vue）。
	 * 同参重复搜索改为刷新既有分页器。 */
	if (searchKey.value === query && searchPaginator.value != null) {
		void searchPaginator.value.reload();
		return;
	}

	searchPaginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: {
			query: query,
			channelId: channel.value.id,
		},
	}));

	searchKey.value = query;
}

/** Twitter 变体搜索回调：同步页面层搜索状态后走统一 search 流程
 *  （业务 funnel 单点；变体只持临时输入状态，规范第 12 条）。 */
function searchFromTwitter(query: string): void {
	searchQuery.value = query;
	void search();
}

const headerActions = computed(() => {
	if (channel.value) {
		const headerItems: PageHeaderItem[] = [];

		headerItems.push({
			icon: 'ti ti-link',
			text: i18n.ts.copyUrl,
			handler: async (): Promise<void> => {
				if (!channel.value) {
					console.warn('failed to copy channel URL. channel.value is null.');
					return;
				}
				copyToClipboard(`${url}/channels/${channel.value.id}`);
			},
		});

		if (isSupportShare()) {
			headerItems.push({
				icon: 'ti ti-share',
				text: i18n.ts.share,
				handler: async (): Promise<void> => {
					if (!channel.value) {
						console.warn('failed to share channel. channel.value is null.');
						return;
					}

					navigator.share({
						title: channel.value.name,
						text: channel.value.description ?? undefined,
						url: `${url}/channels/${channel.value.id}`,
					});
				},
			});
		}

		if (!channel.value.isMuting) {
			headerItems.push({
				icon: 'ti ti-volume',
				text: i18n.ts.mute,
				handler: async (): Promise<void> => {
					await mute();
				},
			});
		} else {
			headerItems.push({
				icon: 'ti ti-volume-off',
				text: i18n.ts.unmute,
				handler: async (): Promise<void> => {
					await unmute();
				},
			});
		}

		if (($i && $i.id === channel.value.userId) || iAmModerator) {
			headerItems.push({
				icon: 'ti ti-settings',
				text: i18n.ts.edit,
				handler: edit,
			});
		}

		return headerItems.length > 0 ? headerItems : null;
	} else {
		return null;
	}
});

const headerTabs = computed(() => [{
	key: 'overview',
	title: i18n.ts.overview,
	icon: 'ti ti-info-circle',
}, {
	key: 'timeline',
	title: i18n.ts.timeline,
	icon: 'ti ti-home',
}, {
	key: 'featured',
	title: i18n.ts.featured,
	icon: 'ti ti-bolt',
}, {
	key: 'search',
	title: i18n.ts.search,
	icon: 'ti ti-search',
}]);

/** Twitter 变体头部动作：发帖预填（O-3 裁决延伸：替代内联表单与 legacy 页脚按钮）
 *  + legacy 头部动作复用；业务 handler 均留在此层（规范第 12 条）。 */
const twitterActions: ComputedRef<PageHeaderItem[]> = computed<PageHeaderItem[]>(/** 资料未确认时不提供可能发往错误频道的动作。 */ (): PageHeaderItem[] => channel.value == null ? [] : [
	{
		icon: 'ti ti-pencil',
		text: i18n.ts.postToTheChannel,
		/** 发帖入口继续复用原频道上下文。 */
		handler: (): void => {
			openPostForm();
		},
	},
	...(headerActions.value ?? []),
]);

definePage(() => ({
	title: channel.value ? channel.value.name : i18n.ts.channel,
	icon: 'ti ti-device-tv',
}));
</script>

<style lang="scss" module>
.footer {
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.bannerContainer {
	position: relative;
}

.subscribe {
	position: absolute;
	z-index: 1;
	top: 16px;
	left: 16px;
}

.favorite {
	position: absolute;
	z-index: 1;
	top: 16px;
	right: 16px;
}

.banner {
	position: relative;
	height: 200px;
	background-position: center;
	background-size: cover;
}

.bannerFade {
	position: absolute;
	bottom: 0;
	left: 0;
	width: 100%;
	height: 64px;
	background: linear-gradient(0deg, var(--MI_THEME-panel), color(from var(--MI_THEME-panel) srgb r g b / 0));
}

.bannerStatus {
	position: absolute;
	z-index: 1;
	bottom: 16px;
	right: 16px;
	padding: 8px 12px;
	font-size: 80%;
	background: rgba(0, 0, 0, 0.7);
	border-radius: 6px;
	color: #fff;
}

.description {
	padding: 16px;
}

.sensitiveIndicator {
	position: absolute;
	z-index: 1;
	bottom: 16px;
	left: 16px;
	background: rgba(0, 0, 0, 0.7);
	color: var(--MI_THEME-warn);
	border-radius: 6px;
	font-weight: bold;
	font-size: 1em;
	padding: 4px 7px;
}
</style>
