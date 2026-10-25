<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：用户搜索结果。
作用：同步完整的关键词及来源条件，复用既有分页器及默认界面的手动搜索。
数据链：路由条件／临时表单 → 原分页器 → 用户结果；不持有第二份结果或环境探测状态。
-->

<template>
<div :class="{ [$style.twitterRoot]: autoSearch }">
	<div v-if="!autoSearch" class="_gaps">
		<MkInput v-model="searchQuery" :large="true" :autofocus="true" type="search" @enter.prevent="search">
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>
		<MkRadios
			v-if="instance.federation !== 'none'"
			v-model="searchOrigin"
			:options="[
				{ value: 'combined', label: i18n.ts.all },
				{ value: 'local', label: i18n.ts.local },
				{ value: 'remote', label: i18n.ts.remote },
			]"
			@update:modelValue="search()"
		>
		</MkRadios>
		<MkButton large primary gradate rounded @click="search">{{ i18n.ts.search }}</MkButton>
	</div>

	<MkFoldableSection v-if="paginator != null && !autoSearch">
		<template #header>{{ i18n.ts.searchResult }}</template>
		<MkUserList :key="`searchUsers:${key}`" :paginator="paginator"/>
	</MkFoldableSection>

	<div v-if="paginator != null && autoSearch" :class="$style.twitterResults">
		<MkPagination :key="`searchUsers:${key}`" :paginator="paginator">
			<template #empty>
				<TwitterPageState type="empty" :title="i18n.ts.noUsers"/>
			</template>
			<template #default="{ items }">
				<TwitterUserResult v-for="item in items" :key="item.id" :user="asDetailedUser(item)"/>
			</template>
		</MkPagination>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { Endpoints } from 'misskey-js';
import * as Misskey from 'misskey-js';
import MkUserList from '@/components/MkUserList.vue';
import MkInput from '@/components/MkInput.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import * as os from '@/os.js';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkPagination from '@/components/MkPagination.vue';
import TwitterPageState from '@/ui/twitter/components/TwitterPageState.vue';
import TwitterUserResult from '@/ui/twitter/UserResult.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useRouter } from '@/router.js';
import { Paginator } from '@/utility/paginator.js';

const props = withDefaults(defineProps<{
	query?: string,
	origin?: Endpoints['users/search']['req']['origin'],
	autoSearch?: boolean,
}>(), {
	query: '',
	origin: 'combined',
	autoSearch: false,
});

const router = useRouter();

const key = ref(0);
const paginator = shallowRef<Paginator<'users/search'> | null>(null);

function asDetailedUser(user: Misskey.entities.User): Misskey.entities.UserDetailed {
	return user as Misskey.entities.UserDetailed;
}

/** 默认界面的关键词草稿；自动模式由同一批路由条件更新。 */
const searchQuery: Ref<string> = ref(props.query);
/** 默认界面的来源草稿，与关键词作为一组同步。 */
const searchOrigin: Ref<typeof props.origin> = ref(props.origin);

watch(/** 读取同一轮提交的关键词和来源，避免发送中间条件请求。 */ (): readonly [typeof props.query, typeof props.origin] => [props.query, props.origin], /** 一次同步表单投影，后续查询只消费完整条件。 */ ([query, origin]: readonly [typeof props.query, typeof props.origin]): void => {
	// 仅外部条件提交清空默认界面的旧结果；临时表单编辑仍等待原手动搜索。
	if (!props.autoSearch) paginator.value = null;
	searchQuery.value = query;
	searchOrigin.value = origin;
}, { immediate: true });

/** 从既有请求 Schema 派生本页使用的只读查询参数。 */
type SearchParams = Readonly<Pick<Endpoints['users/search']['req'], 'query' | 'origin'>>;

/** 仅从完整表单投影生成分页器参数，不保留结果业务状态副本。 */
const searchParams: ComputedRef<SearchParams | null> = computed(/** 映射关键词及实例允许的用户来源。 */ (): SearchParams | null => {
	const query: string = searchQuery.value.trim();
	if (query === '') return null;

	return {
		query,
		origin: instance.federation === 'none' ? 'local' : searchOrigin.value,
	};
});

async function search() {
	if (props.autoSearch) return;

	const query = searchQuery.value.toString().trim();

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (query == null || query === '') return;

	//#region AP lookup
	if (query.startsWith('https://') && !query.includes(' ')) {
		const confirm = await os.confirm({
			type: 'info',
			text: i18n.ts.lookupConfirm,
		});
		if (!confirm.canceled) {
			const promise = misskeyApi('ap/show', {
				uri: query,
			});

			os.promiseDialog(promise, null, null, i18n.ts.fetchingAsApObject);

			const res = await promise;

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

	if (query.length > 1 && !query.includes(' ')) {
		if (query.startsWith('@')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.lookupConfirm,
			});
			if (!confirm.canceled) {
				router.pushByPath(`/${query}`);
				return;
			}
		}

		if (query.startsWith('#')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.openTagPageConfirm,
			});
			if (!confirm.canceled) {
				router.push('/user-tags/:tag', {
					params: {
						tag: query.substring(1),
					},
				});
				return;
			}
		}
	}

	paginator.value = markRaw(new Paginator('users/search', {
		limit: 10,
		offsetMode: true,
		params: {
			query: query,
			origin: instance.federation === 'none' ? 'local' : searchOrigin.value,
		},
	}));

	key.value++;
}

watch(searchParams, /** 每次完整条件只更换一次分页器，首次加载仍由列表挂载负责。 */ (params: SearchParams | null, oldParams: SearchParams | null | undefined): void => {
	if (!props.autoSearch) return;
	if (params == null) {
		paginator.value = null;
		return;
	}

	if (JSON.stringify(params) === JSON.stringify(oldParams)) return;

	paginator.value = markRaw(new Paginator('users/search', {
		limit: 10,
		offsetMode: true,
		params: { ...params },
	}));

	key.value++;
}, { immediate: true });
</script>

<style lang="scss" module>
.twitterRoot,
.twitterResults {
	background: var(--twitter-bg);
}
</style>
