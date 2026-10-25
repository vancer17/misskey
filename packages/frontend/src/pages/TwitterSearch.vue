<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI 搜索页容器与查询导航。
作用：从路由派生已提交的查询与标签，保留输入草稿；异步等待限制在结果区。
数据链：已解析路由 props → 只读标签及结果参数 → 原搜索分页器；导航不复制业务实体。
-->

<template>
<div class="_pageScrollable" :class="[$style.root, { [$style.mobile]: isMobile }]">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header" data-testid="twitter-search-header">
				<TwitterSearchField
					v-model="draftQuery"
					:class="$style.searchField"
					:autofocus="query === ''"
					@submit="submit"
				/>
			</header>

			<nav :class="$style.tabs" role="tablist" :aria-label="i18n.ts.search">
				<button
					v-for="item in tabs"
						:id="`${searchId}-tab-${item.value}`"
						:key="item.value"
						:data-twitter-search-tab="item.value"
					class="_button"
					:class="[$style.tab, { [$style.activeTab]: tab === item.value }]"
					type="button"
					role="tab"
					:aria-selected="tab === item.value"
						:aria-controls="`${searchId}-panel-${item.value}`"
					:tabindex="tab === item.value ? 0 : -1"
					@click="changeTab(item.value)"
					@keydown="onTabKeydown"
				>
					{{ item.title }}
				</button>
			</nav>

			<div v-if="tab === 'user' && query !== ''" :class="$style.originBar">
				<button
					v-for="item in originOptions"
					:key="item.value"
					class="_button"
					:class="[$style.origin, { [$style.activeOrigin]: origin === item.value }]"
					type="button"
					@click="changeOrigin(item.value)"
				>
					{{ item.label }}
				</button>
			</div>
		</template>

		<div
			:id="`${searchId}-panel-${tab}`"
			:class="$style.body"
			role="tabpanel"
			data-testid="twitter-search-results"
			:aria-labelledby="`${searchId}-tab-${tab}`"
		>
			<TwitterPageState
				v-if="query === ''"
				type="empty"
				:title="i18n.ts.search"
			/>

			<template v-else>
				<div v-if="urlIntent != null" :class="$style.intents">
					<button
						class="_button"
						:class="$style.intent"
						type="button"
						:disabled="lookupLoading"
						@click="lookupUrl"
					>
						<i class="ti ti-external-link" aria-hidden="true"></i>
						<span :class="$style.intentText">
							<span>{{ i18n.ts._twitterSearch.lookupUrl }}</span>
							<small>{{ query }}</small>
						</span>
					</button>
				</div>

				<div v-else-if="userIntent != null || hashtagIntent != null" :class="$style.intents">
					<button
						v-if="userIntent != null"
						class="_button"
						:class="$style.intent"
						type="button"
						@click="router.pushByPath(`/${userIntent}`)"
					>
						<i class="ti ti-user" aria-hidden="true"></i>
						<span :class="$style.intentText">
							<span>{{ i18n.ts._twitterSearch.showUser }}</span>
							<small>{{ userIntent }}</small>
						</span>
					</button>

					<button
						v-if="hashtagIntent != null"
						class="_button"
						:class="$style.intent"
						type="button"
						@click="router.push(`/tags/:tag`, { params: { tag: hashtagIntent } })"
					>
						<i class="ti ti-hash" aria-hidden="true"></i>
						<span :class="$style.intentText">
							<span>{{ i18n.ts._twitterSearch.showHashtag }}</span>
							<small>#{{ hashtagIntent }}</small>
						</span>
					</button>
				</div>

				<div v-if="tab === 'note' && !canSearchNotes" :class="$style.notice">
					{{ i18n.ts.notesSearchNotAvailable }}
				</div>
				<div v-else-if="tab === 'user' && !canSearchUsers" :class="$style.notice">
					{{ i18n.ts.usersSearchNotAvailable }}
				</div>

				<Suspense v-else :timeout="0">
					<XNote v-if="tab === 'note'" v-bind="noteProps"/>
					<XUser v-else v-bind="userProps"/>
					<template #fallback>
						<div role="status" :aria-label="i18n.ts.loading" data-testid="twitter-search-loading"><MkLoading/></div>
					</template>
				</Suspense>
			</template>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue';
import type { Component, ComputedRef, Ref } from 'vue';
import type { Endpoints } from 'misskey-js';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { instance } from '@/instance.js';
import TwitterSearchField from '@/ui/twitter/SearchField.vue';
import { useTwitterLayout } from '@/ui/twitter/context/index.js';
import type { TwitterSearchTab } from '@/ui/twitter/domain/index.js';
import TwitterPageState from '@/ui/twitter/components/TwitterPageState.vue';
import { apLookup } from '@/utility/lookup.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';
import type { Router } from '@/router.js';

const XNote: Component = defineAsyncComponent(
	/** 帖子查询仅在结果区域被选中时加载，等待不穿透页头。 */
	(): Promise<typeof import('./search.note.vue')> => import('./search.note.vue'),
);
const XUser: Component = defineAsyncComponent(
	/** 用户查询与帖子查询共享稳定页头，各自持有既有分页器。 */
	(): Promise<typeof import('./search.user.vue')> => import('./search.user.vue'),
);

/** 搜索容器接收的路由原始值与既有策略投影；不持有 API 业务实体。 */
type SearchProps = {
	query?: string;
	userId?: string;
	username?: string;
	host?: string | null;
	type?: TwitterSearchTab;
	origin?: Endpoints['users/search']['req']['origin'];
	canSearchNotes: boolean;
	canSearchUsers: boolean;
};
const props: Readonly<Required<Omit<SearchProps, 'userId' | 'username' | 'host'>> & Pick<SearchProps, 'userId' | 'username' | 'host'>> = withDefaults(defineProps<SearchProps>(), {
	query: '',
	userId: undefined,
	username: undefined,
	host: undefined,
	type: 'note',
	origin: 'combined',
});

/** 帖子与用户搜索的只读标签展示投影。 */
type SearchTabItem = Readonly<{ value: TwitterSearchTab; title: string }>;
/** 来源选项使用既有接口请求的取值范围，不另建来源枚举。 */
type SearchOriginItem = Readonly<{ value: NonNullable<SearchProps['origin']>; label: string }>;
/** 结果查询参数由路由 props 单向派生，仅附加现有自动查询约定。 */
type AutoSearchProps = Readonly<Pick<SearchProps, 'query' | 'userId' | 'username' | 'host'> & { autoSearch: true }>;

const router: Router = useRouter();
/** 每个展示实例拥有独立 ARIA 标识，叠层中的历史搜索页不会重用 DOM ID。 */
const searchId: string = useId();
/** Twitter 布局状态（移动端 class 驱动，ADR-0001 决策 4）。 */
const { isMobile }: ReturnType<typeof useTwitterLayout> = useTwitterLayout();
const draftQuery: Ref<string> = ref(props.query);
/** 标签只读派生自已提交路由；缓存实例不保留另一个可变副本。 */
const tab: ComputedRef<TwitterSearchTab> = computed(
	/** 路由更新是标签切换唯一提交点。 */
	(): TwitterSearchTab => props.type,
);
const lookupLoading: Ref<boolean> = ref(false);
/** URL 解析属于当前交互代次；离开页面或提交新词后旧结果不得导航。 */
let lookupGeneration: number = 0;

/** 废弃旧 URL 查找的展示与导航资格，不干预既有 AP 解析服务。 */
function invalidateLookup(): void {
	lookupGeneration++;
	lookupLoading.value = false;
}

onBeforeUnmount(invalidateLookup);
onDeactivated(invalidateLookup);
/** 叠层历史卡片不会停用；任何新导航都撤销旧交互的导航资格。 */
router.useListener('change', invalidateLookup);

watch(
	/** 外部导航和历史恢复同步输入草稿。 */
	(): string => props.query,
	/** 草稿仅服务当前输入，不反向参与已提交查询。 */
	(query: string): void => { draftQuery.value = query; invalidateLookup(); },
);

const tabs: ComputedRef<readonly SearchTabItem[]> = computed(
	/** 标签标题随当前语言派生。 */
	(): readonly SearchTabItem[] => [{ value: 'note', title: i18n.ts.notes }, { value: 'user', title: i18n.ts.users }],
);
const originOptions: ComputedRef<readonly SearchOriginItem[]> = computed(
	/** 来源选择沿用实例联邦策略；不自行探测外部服务。 */
	(): readonly SearchOriginItem[] => instance.federation === 'none' ? [] : [
		{ value: 'combined', label: i18n.ts.all },
		{ value: 'local', label: i18n.ts.local },
		{ value: 'remote', label: i18n.ts.remote },
	],
);
const noteProps: ComputedRef<AutoSearchProps> = computed(
	/** 帖子过滤条件随路由整体更新，取数仍由既有搜索页面负责。 */
	(): AutoSearchProps => ({ query: props.query, userId: props.userId, username: props.username, host: props.host, autoSearch: true }),
);
const userProps: ComputedRef<Readonly<Pick<SearchProps, 'query' | 'origin'> & { autoSearch: true }>> = computed(
	/** 用户关键词与来源由同一提交后的路由快照派生。 */
	(): Readonly<Pick<SearchProps, 'query' | 'origin'> & { autoSearch: true }> => ({ query: props.query, origin: props.origin, autoSearch: true }),
);
const urlIntent: ComputedRef<string | null> = computed(
	/** URL 仅作为现有远程查找入口提示，不替代普通搜索。 */
	(): string | null => props.query.startsWith('https://') && !props.query.includes(' ') ? props.query : null,
);
const userIntent: ComputedRef<string | null> = computed(
	/** 账户文本仅派生导航提示，不在容器内解析账户实体。 */
	(): string | null => props.query.length > 1 && !props.query.includes(' ') && props.query.startsWith('@') ? props.query : null,
);
const hashtagIntent: ComputedRef<string | null> = computed(
	/** 仅帖子区从已提交关键词派生话题入口；用户区不生成该入口及其外层容器。 */
	(): string | null => {
		if (tab.value !== 'note') return null;
		return props.query.length > 1 && !props.query.includes(' ') && props.query.startsWith('#') ? props.query.slice(1) : null;
	},
);

/** 构造简单查询串，缺省筛选不序列化为 undefined/null；本地 host 的既有约定为点号。 */
function routeQuery(nextQuery: string, nextTab: TwitterSearchTab, nextOrigin: SearchProps['origin']): Record<string, string> {
	const query: Record<string, string> = { q: nextQuery, type: nextTab };
	if (nextTab === 'note') {
		if (props.userId) query.userId = props.userId;
		if (props.username) query.username = props.username;
		if (typeof props.host === 'string' && props.host !== '') query.host = props.host;
	}
	if (nextTab === 'user' && instance.federation !== 'none' && nextOrigin != null) query.origin = nextOrigin;
	return query;
}

/** 输入提交只更新路由，由路由统一驱动标签及结果查询。 */
function submit(): void {
	const trimmedQuery: string = draftQuery.value.trim();
	if (trimmedQuery === '') return;
	router.replace('/search', { query: routeQuery(trimmedQuery, tab.value, props.origin) });
}

/** 单击仅提交目标标签，避免先写本地副本后被缓存恢复覆盖。 */
function changeTab(nextTab: TwitterSearchTab): void {
	if (tab.value === nextTab) return;
	router.replace('/search', { query: routeQuery(props.query, nextTab, props.origin) });
}

/** 来源切换仍使用同一关键词及标签，不另行创建结果状态。 */
function changeOrigin(nextOrigin: SearchProps['origin']): void {
	if (props.origin === nextOrigin) return;
	router.replace('/search', { query: routeQuery(props.query, tab.value, nextOrigin) });
}

/** 键盘切换遵循标签顺序，并将焦点交给目标标签。 */
function onTabKeydown(ev: KeyboardEvent): void {
	const currentIndex: number = tabs.value.findIndex(
		/** 只比较当前只读标签标识。 */
		(item: SearchTabItem): boolean => item.value === tab.value,
	);
	let nextIndex: number | null = null;
	if (ev.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.value.length;
	else if (ev.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.value.length) % tabs.value.length;
	else if (ev.key === 'Home') nextIndex = 0;
	else if (ev.key === 'End') nextIndex = tabs.value.length - 1;
	if (nextIndex == null) return;
	ev.preventDefault();
	const nextTab: TwitterSearchTab = tabs.value[nextIndex].value;
	changeTab(nextTab);
	const tabList: HTMLElement | null = ev.currentTarget instanceof HTMLElement ? ev.currentTarget.closest('nav') : null;
	tabList?.querySelector<HTMLButtonElement>(`[data-twitter-search-tab="${nextTab}"]`)?.focus();
}

/** URL 查找复用既有 AP 解析与错误弹层，不承担搜索结果缓存。 */
async function lookupUrl(): Promise<void> {
	if (urlIntent.value == null || lookupLoading.value) return;
	const generation: number = ++lookupGeneration;
	lookupLoading.value = true;
	const result: Endpoints['ap/show']['res'] | null = await apLookup(urlIntent.value).catch(
		/** 失败提示由 apLookup 保持统一处理，容器只结束等待。 */
		(): null => null,
	);
	if (generation !== lookupGeneration) return;
	lookupLoading.value = false;
	if (result?.type === 'User') {
		router.push('/@:acct/:page?', { params: { acct: `${result.object.username}@${result.object.host}` } });
	} else if (result?.type === 'Note') {
		router.push('/notes/:noteId/:initialTab?', { params: { noteId: result.object.id } });
	}
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);

	/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
	&.mobile {
		.header,
		.originBar {
			padding-right: var(--twitter-space-3);
			padding-left: var(--twitter-space-3);
		}
	}
}

.header {
	display: flex;
	gap: 8px;
	align-items: center;
	/* nitter 地面真值：navbar 50px（PF-1 S-2/S-3 统一权威 token） */
	min-height: var(--twitter-header-height);
	padding: 8px 16px;
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.searchField {
	flex: 1;
}

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
	/* 既有 tab 行高度惯例（NotificationsHeader 为 50px，消除 53px 孤值） */
	min-height: 50px;
	padding: 0 12px;
	color: var(--twitter-secondary-fg);
	font-size: 15px;
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

.originBar {
	display: flex;
	gap: 8px;
	padding: 8px 16px;
	overflow-x: auto;
	background: var(--twitter-bg);
	border-bottom: solid 1px var(--twitter-border);
	scrollbar-width: none;

	&::-webkit-scrollbar {
		display: none;
	}
}

.origin {
	flex-shrink: 0;
	min-height: 32px;
	padding: 0 16px;
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-secondary-fg);
	font-size: 13px;
	font-weight: 700;
	transition:
		background-color var(--twitter-duration-fast) ease,
		border-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover,
	&:focus-visible {
		border-color: var(--twitter-secondary-fg);
		color: var(--twitter-fg);
	}
}

.activeOrigin {
	border-color: var(--twitter-accent);
	background: var(--twitter-accent);
	color: var(--twitter-fg);
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

.intents {
	display: grid;
	border-bottom: solid 1px var(--twitter-border);
}

.intent {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 56px;
	padding: 8px 16px;
	color: var(--twitter-fg);
	text-align: left;
	transition: background-color var(--twitter-duration-fast) ease;

	> i {
		flex-shrink: 0;
		color: var(--twitter-accent);
		font-size: 18px;
	}

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 5%, transparent);
	}

	&:disabled {
		opacity: 0.55;
	}
}

.intentText {
	display: grid;
	gap: 2px;
	min-width: 0;
	font-size: 14px;
	font-weight: 700;

	small {
		overflow: hidden;
		color: var(--twitter-secondary-fg);
		font-weight: 400;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}

.notice {
	padding: 32px 24px;
	color: var(--twitter-secondary-fg);
	font-size: 15px;
	text-align: center;
}

@media (prefers-reduced-motion: reduce) {
	.tab::after,
	.tab,
	.origin,
	.intent {
		transition-duration: 0.01ms;
	}
}
</style>
