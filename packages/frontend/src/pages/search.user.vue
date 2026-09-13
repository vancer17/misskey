<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.twitterRoot]: autoSearch }]">
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
				<TwitterTimelineState :emptyTitle="i18n.ts.noUsers"/>
			</template>
			<template #default="{ items }">
				<TwitterUserResult v-for="item in items" :key="item.id" :user="asDetailedUser(item)"/>
			</template>
		</MkPagination>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, shallowRef, toRef, watch } from 'vue';
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
import TwitterTimelineState from '@/ui/twitter/TimelineState.vue';
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

const searchQuery = ref(toRef(props, 'query').value);
const searchOrigin = ref(toRef(props, 'origin').value);

watch(() => props.query, (query) => {
	if (props.autoSearch) searchQuery.value = query;
}, { immediate: true });

watch(() => props.origin, (origin) => {
	if (props.autoSearch) searchOrigin.value = origin;
}, { immediate: true });

const searchParams = computed(() => {
	const query = searchQuery.value.trim();
	if (query === '') return null;

	return {
		query,
		origin: instance.federation === 'none' ? 'local' as const : searchOrigin.value,
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

watch(searchParams, (params, oldParams) => {
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
