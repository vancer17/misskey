<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：帖子搜索结果。
作用：同步已提交的搜索条件，先解析用户筛选再交给原分页器；原生手动表单仅在默认界面挂载。
数据链：路由条件／临时筛选表单 → 可取消的用户解析 → 原分页器 → 只读结果；不解释环境探测。
-->

<template>
<div :class="{ [$style.twitterRoot]: autoSearch }">
	<div v-if="!autoSearch" class="_gaps" data-testid="search-note-form">
		<MkInput
			v-model="searchQuery"
			large
			autofocus
			type="search"
			@enter.prevent="search"
		>
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>
		<MkFoldableSection :class="$style.filters" :inert="routeFilterLoading">
			<template #header>{{ i18n.ts.options }}</template>

			<div class="_gaps_m">
				<div style="display: flex; gap: 8px;">
					<MkInput v-model="rangeStartAt" type="datetime-local">
						<template #label>{{ i18n.ts._search.postFrom }}</template>
					</MkInput>
					<MkInput v-model="rangeEndAt" type="datetime-local">
						<template #label>{{ i18n.ts._search.postTo }}</template>
					</MkInput>
				</div>

				<MkRadios
					v-model="searchScope"
					:options="searchScopeDef"
					@update:modelValue="updateFormFilter"
				>
				</MkRadios>

				<div v-if="instance.federation !== 'none' && searchScope === 'server'" :class="$style.subOptionRoot">
					<MkInput
						v-model="hostInput"
						:placeholder="i18n.ts._search.serverHostPlaceholder"
						@update:modelValue="updateFormFilter"
						@enter.prevent="search"
					>
						<template #label>{{ i18n.ts._search.pleaseEnterServerHost }}</template>
						<template #prefix><i class="ti ti-server"></i></template>
					</MkInput>
				</div>

				<div v-if="searchScope === 'user'" :class="$style.subOptionRoot">
					<div :class="$style.userSelectLabel">{{ i18n.ts._search.pleaseSelectUser }}</div>
					<div class="_gaps">
						<div v-if="user == null" :class="$style.userSelectButtons">
							<div v-if="$i != null">
								<MkButton
									transparent
									:class="$style.userSelectButton"
									@click="selectSelf"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i><i class="ti ti-user"></i></span>
										<span>{{ i18n.ts.selectSelf }}</span>
									</div>
								</MkButton>
							</div>
							<div :style="$i == null ? 'grid-column: span 2;' : undefined">
								<MkButton
									transparent
									:class="$style.userSelectButton"
									@click="selectUser"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i></span>
										<span>{{ i18n.ts.selectUser }}</span>
									</div>
								</MkButton>
							</div>
						</div>
						<div v-else :class="$style.userSelectedButtons">
							<div style="overflow: hidden;">
								<MkUserCardMini
									:user="user"
									:withChart="false"
								/>
							</div>
							<div>
								<button
									class="_button"
									:class="$style.userSelectedRemoveButton"
									@click="removeUser"
								>
									<i class="ti ti-x"></i>
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</MkFoldableSection>
		<div>
			<MkButton
				large
				primary
				gradate
				rounded
				:disabled="searchParams == null"
				style="margin: 0 auto;"
				@click="search"
			>
				{{ i18n.ts.search }}
			</MkButton>
		</div>
	</div>

	<TwitterPageSkeleton v-if="routeFilterLoading && autoSearch" variant="timeline"/>
	<MkLoading v-else-if="routeFilterLoading"/>
	<TwitterPageState v-else-if="routeFilterError && autoSearch" type="error" @retry="retryRouteFilter"/>
	<MkError v-else-if="routeFilterError" @retry="retryRouteFilter"/>

	<MkFoldableSection v-if="!routeFilterLoading && !routeFilterError && paginator != null && !autoSearch">
		<template #header>{{ i18n.ts.searchResult }}</template>
		<MkNotesTimeline :key="`searchNotes:${key}`" :paginator="paginator" :variant="timelineVariant"/>
	</MkFoldableSection>

	<div v-if="!routeFilterLoading && !routeFilterError && paginator != null && autoSearch" :class="$style.results">
		<MkNotesTimeline :key="`searchNotes:${key}`" :paginator="paginator" :variant="timelineVariant" :withControl="true"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { TwitterPageSkeleton, TwitterPageState, useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { computed, inject, markRaw, onWatcherCleanup, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { host as localHost } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { apLookup } from '@/utility/lookup.js';
import { useRouter } from '@/router.js';
import MkButton from '@/components/MkButton.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkInput from '@/components/MkInput.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import { Paginator } from '@/utility/paginator.js';
import type { MkRadiosOption } from '@/components/MkRadios.vue';

const props = withDefaults(defineProps<{
	query?: string;
	userId?: string;
	username?: string;
	host?: string | null;
	autoSearch?: boolean;
}>(), {
	query: '',
	userId: undefined,
	username: undefined,
	host: '',
	autoSearch: false,
});

const uiStyle = inject(DI.uiStyle, ref('default'));
const timelineVariant = computed(() => uiStyle.value === 'twitter' ? 'twitter' : 'misskey');

const router = useRouter();

const key = ref(0);
const paginator = shallowRef<Paginator<'notes/search'> | null>(null);

/** 搜索仍是查询快照；回访空结果同样重取，不订阅每次发帖改变排序。 */
useTwitterPaginatorRefresh(/** 当前已提交搜索的数据源。 */ (): typeof paginator.value => paginator.value);

/** 搜索表单中的临时关键词；自动模式由整组路由条件统一更新。 */
const searchQuery: Ref<string> = ref(props.query);
/** 搜索表单中的临时主机筛选。 */
const hostInput: Ref<string | null> = ref(props.host);
/** 搜索表单的起始时间草稿。 */
const rangeStartAt: Ref<string | null> = ref(null);
/** 搜索表单的结束时间草稿。 */
const rangeEndAt: Ref<string | null> = ref(null);
/** 供既有筛选卡片及请求映射消费的已解析用户，不持有搜索结果副本。 */
const user: ShallowRef<Misskey.entities.UserDetailed | null> = shallowRef(null);
/** 用户筛选解析期间关闭查询，避免短暂提交未限定用户的请求。 */
const routeFilterLoading: Ref<boolean> = ref(false);
/** 路由指定的筛选无法解析时保持错误态，禁止退回更宽的搜索范围。 */
const routeFilterError: Ref<boolean> = ref(false);
/** 仅供当前筛选解析重试的临时触发序号。 */
const routeFilterRetry: Ref<number> = ref(0);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const noteSearchableScope = instance.noteSearchableScope ?? 'local';

/** 搜索范围是临时表单状态，初始化不触发用户解析前的查询。 */
const searchScope: Ref<'all' | 'local' | 'server' | 'user'> = ref(noteSearchableScope === 'local' ? 'local' : 'all');

/** 从实例搜索能力派生可选表单范围，沿用既有筛选规则。 */
const searchScopeDef: ComputedRef<MkRadiosOption[]> = computed(/** 生成范围选项供原基础单选组件呈现。 */ (): MkRadiosOption[] => {
	const options: MkRadiosOption[] = [];

	if (instance.federation !== 'none' && noteSearchableScope === 'global') {
		options.push({ value: 'all', label: i18n.ts._search.searchScopeAll });
	}

	options.push({ value: 'local', label: instance.federation === 'none' ? i18n.ts._search.searchScopeAll : i18n.ts._search.searchScopeLocal });

	if (instance.federation !== 'none' && noteSearchableScope === 'global') {
		options.push({ value: 'server', label: i18n.ts._search.searchScopeServer });
	}

	options.push({ value: 'user', label: i18n.ts._search.searchScopeUser });

	return options;
});

/** 从既有请求 Schema 派生页面所需只读参数，不复制接口字段定义。 */
type SearchParams = Readonly<Pick<Misskey.Endpoints['notes/search']['req'], 'query' | 'host' | 'userId' | 'rangeStartAt' | 'rangeEndAt'>>;

/** 规范化主机表单并映射接口约定的本地主机标识，供筛选校验与请求共同消费。 */
const fixHostIfLocal = (target: string | null | undefined): string => {
	let host: string = target?.trim() ?? '';
	if (host.startsWith('https://') || host.startsWith('http://')) {
		try {
			host = new URL(host).host;
		} catch { /* 保留普通主机文本，沿用既有接口处理。 */ }
	}
	if (!host || host === localHost) return '.';
	return host;
};

/** 仅将默认界面的手动时间草稿映射为搜索区间；自动搜索只使用既有分页日期定位。 */
const searchRange = (): Pick<SearchParams, 'rangeStartAt' | 'rangeEndAt'> => {
	if (props.autoSearch) return {};
	return {
		rangeStartAt: rangeStartAt.value ? new Date(rangeStartAt.value).getTime() : null,
		rangeEndAt: rangeEndAt.value ? new Date(rangeEndAt.value).getTime() : null,
	};
};

/** 仅在路由筛选完整解析后派生查询快照，防止中间状态扩大查询范围。 */
const searchParams: ComputedRef<SearchParams | null> = computed(/** 将当前有效表单映射为分页器请求参数。 */ (): SearchParams | null => {
	if (routeFilterLoading.value || routeFilterError.value) return null;
	const trimmedQuery: string = searchQuery.value.trim();
	if (!trimmedQuery) return null;

	if (searchScope.value === 'user') {
		if (user.value == null) return null;
		return {
			query: trimmedQuery,
			host: fixHostIfLocal(user.value.host),
			userId: user.value.id,
			...searchRange(),
		};
	}

	if (instance.federation !== 'none' && searchScope.value === 'server') {
		const trimmedHost: string | undefined = hostInput.value?.trim();
		if (!trimmedHost) return null;
		return {
			query: trimmedQuery,
			host: fixHostIfLocal(trimmedHost),
			...searchRange(),
		};
	}

	if (instance.federation === 'none' || searchScope.value === 'local') {
		return {
			query: trimmedQuery,
			host: '.',
			...searchRange(),
		};
	}

	return {
		query: trimmedQuery,
		...searchRange(),
	};
});

/** 用户主动修改筛选表单后解除解析错误；缺失用户等校验仍由参数派生执行。 */
function updateFormFilter(): void {
	routeFilterError.value = false;
}

/** 将用户选择器确认的筛选交给原表单，清除此前路由解析错误。 */
function selectUser(): void {
	os.selectUser({
		includeSelf: true,
		localOnly: instance.noteSearchableScope === 'local',
	}).then(/** 仅接收选择器最终确认的用户。 */ (selectedUser: Misskey.entities.UserDetailed): void => {
		user.value = selectedUser;
		routeFilterError.value = false;
	});
}

/** 使用当前登录用户作为临时用户筛选。 */
function selectSelf(): void {
	user.value = $i;
	routeFilterError.value = false;
}

/** 清空临时用户筛选；用户范围下继续禁止无用户查询。 */
function removeUser(): void {
	user.value = null;
}

/** 仅重试当前路由条件解析，不改写已提交的筛选条件。 */
function retryRouteFilter(): void {
	routeFilterRetry.value++;
}

/** 从路由 props 派生只读提交投影；接口返回值不反向充当路由事实。 */
type SubmittedSearch = Readonly<Pick<typeof props, 'query' | 'userId' | 'username' | 'host'>>;

/** 将所有路由筛选作为一个更新单元，避免关键词与用户条件分别提交。 */
const submittedSearch: ComputedRef<SubmittedSearch> = computed(/** 收集当前完整路由条件。 */ (): SubmittedSearch => ({
	query: props.query,
	userId: props.userId,
	username: props.username,
	host: props.host,
}));

watch([submittedSearch, routeFilterRetry], /** 先解析完整筛选再开放分页；条件变化或卸载时取消旧解析。 */ async ([submitted]: [SubmittedSearch, number]): Promise<void> => {
	// 默认界面收到外部条件后等待手动提交，不把上一轮结果挂在新表单下。
	if (!props.autoSearch) paginator.value = null;
	const controller: AbortController = new AbortController();
	onWatcherCleanup(/** 取消旧条件的用户解析，旧请求不能提交新页面状态。 */ (): void => controller.abort());

	routeFilterLoading.value = true;
	routeFilterError.value = false;
	searchQuery.value = submitted.query;
	hostInput.value = submitted.host;
	user.value = null;
	searchScope.value = submitted.userId || submitted.username ? 'user'
		: noteSearchableScope === 'local' ? 'local'
			: submitted.host ? 'server' : 'all';

	try {
		/** 用户解析沿用同一主机规范化结果；users/show 的本地约定是省略 host，而非帖子检索的「.」。 */
		const lookupHost: string = fixHostIfLocal(submitted.host);
		/** 标识优先；标识解析失败不得改用用户名或更宽的搜索条件。 */
		const userLookup: Misskey.Endpoints['users/show']['req'] | null = submitted.userId ? {
			userId: submitted.userId,
		} : submitted.username ? {
			username: submitted.username,
			...(lookupHost !== '.' ? { host: lookupHost } : {}),
		} : null;
		if (userLookup != null) {
			const selectedUser: Misskey.entities.UserDetailed = await misskeyApi<Misskey.entities.UserDetailed, 'users/show', Misskey.Endpoints['users/show']['req']>('users/show', userLookup, undefined, controller.signal);
			if (controller.signal.aborted) return;
			if (noteSearchableScope === 'local' && selectedUser.host != null) {
				routeFilterError.value = true;
				return;
			}
			user.value = selectedUser;
		} else if (noteSearchableScope === 'local' && submitted.host && lookupHost !== '.') {
			// 显式远端主机在仅本地检索实例中不能悄悄退回本地无主机条件。
			routeFilterError.value = true;
		}
	} catch {
		if (!controller.signal.aborted) routeFilterError.value = true;
	} finally {
		if (!controller.signal.aborted) routeFilterLoading.value = false;
	}
}, { immediate: true });

async function search() {
	if (props.autoSearch) return;

	if (searchParams.value == null) return;

	//#region AP lookup
	if (searchParams.value.query.startsWith('https://') && !searchParams.value.query.includes(' ')) {
		const confirm = await os.confirm({
			type: 'info',
			text: i18n.ts.lookupConfirm,
		});
		if (!confirm.canceled) {
			const res = await apLookup(searchParams.value.query);

			if (res.type === 'User') {
				router.push('/@:acct/:page?', {
					params: {
						acct: `${res.object.username}@${res.object.host}`,
					},
				});
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			} else if (res.type === 'Note') {
				router.push('/notes/:noteId/:initialTab?', {
					params: {
						noteId: res.object.id,
					},
				});
			}

			return;
		}
	}
	//#endregion

	if (searchParams.value.query.length > 1 && !searchParams.value.query.includes(' ')) {
		if (searchParams.value.query.startsWith('@')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.lookupConfirm,
			});
			if (!confirm.canceled) {
				router.pushByPath(`/${searchParams.value.query}`);
				return;
			}
		}

		if (searchParams.value.query.startsWith('#')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.openTagPageConfirm,
			});
			if (!confirm.canceled) {
				router.push('/tags/:tag', {
					params: {
						tag: searchParams.value.query.substring(1),
					},
				});
				return;
			}
		}
	}

	paginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: {
			...searchParams.value,
		},
	}));

	key.value++;
}

watch(searchParams, /** 为已确认的完整条件更换分页所有者；列表挂载负责首次加载。 */ (params: SearchParams | null, oldParams: SearchParams | null | undefined): void => {
	if (!props.autoSearch) return;
	if (params == null) {
		paginator.value = null;
		return;
	}

	if (JSON.stringify(params) === JSON.stringify(oldParams)) return;

	paginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: { ...params },
	}));

	key.value++;
}, { immediate: true });
</script>
<style lang="scss" module>
.twitterRoot {
	background: var(--twitter-bg);
}

.filters {
	border-bottom: solid 1px var(--twitter-border);
}

.results {
	background: var(--twitter-bg);
}

.subOptionRoot {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	padding: var(--MI-margin);
}

.userSelectLabel {
	font-size: 0.85em;
	padding: 0 0 8px;
	user-select: none;
}

.userSelectButtons {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 16px;
}

.userSelectButton {
	width: 100%;
	height: 100%;
	padding: 12px;
	border: 2px dashed color(from var(--MI_THEME-fg) srgb r g b / 0.5);
}

.userSelectButtonInner {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: space-between;
	min-height: 38px;
}

.userSelectedButtons {
	display: grid;
	grid-template-columns: 1fr auto;
	align-items: center;
}

.userSelectedRemoveButton {
	width: 32px;
	height: 32px;
	color: #ff2a2a;
}
</style>
