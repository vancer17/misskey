<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_pageScrollable" :class="$style.root">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header">
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
					:id="`twitter-search-tab-${item.value}`"
					:key="item.value"
					class="_button"
					:class="[$style.tab, { [$style.activeTab]: tab === item.value }]"
					type="button"
					role="tab"
					:aria-selected="tab === item.value"
					:aria-controls="`twitter-search-panel-${item.value}`"
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
			:id="`twitter-search-panel-${tab}`"
			:class="$style.body"
			role="tabpanel"
			:aria-labelledby="`twitter-search-tab-${tab}`"
		>
			<TwitterTimelineState
				v-if="query === ''"
				:emptyTitle="i18n.ts.search"
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

				<XNote
					v-else-if="tab === 'note'"
					v-bind="noteProps"
				/>
				<XUser
					v-else
					v-bind="userProps"
				/>
			</template>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import type { Endpoints } from 'misskey-js';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { instance } from '@/instance.js';
import TwitterSearchField from '@/ui/twitter/SearchField.vue';
import TwitterTimelineState from '@/ui/twitter/TimelineState.vue';
import { apLookup } from '@/utility/lookup.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';

const XNote = defineAsyncComponent(() => import('./search.note.vue'));
const XUser = defineAsyncComponent(() => import('./search.user.vue'));

const props = withDefaults(defineProps<{
	query?: string;
	userId?: string;
	username?: string;
	host?: string | null;
	type?: 'note' | 'user';
	origin?: Endpoints['users/search']['req']['origin'];
	canSearchNotes: boolean;
	canSearchUsers: boolean;
}>(), {
	query: '',
	userId: undefined,
	username: undefined,
	host: undefined,
	type: 'note',
	origin: 'combined',
});

const router = useRouter();
const draftQuery = ref(props.query);
const tab = ref(props.type);
const lookupLoading = ref(false);

watch(() => props.query, (query) => {
	draftQuery.value = query;
});

watch(() => props.type, (type) => {
	tab.value = type;
});

const tabs = computed(() => [{
	value: 'note' as const,
	title: i18n.ts.notes,
}, {
	value: 'user' as const,
	title: i18n.ts.users,
}]);

const originOptions = computed(() => {
	if (instance.federation === 'none') return [];

	return [{
		value: 'combined' as const,
		label: i18n.ts.all,
	}, {
		value: 'local' as const,
		label: i18n.ts.local,
	}, {
		value: 'remote' as const,
		label: i18n.ts.remote,
	}];
});

const noteProps = computed(() => ({
	query: props.query,
	userId: props.userId,
	username: props.username,
		host: props.host,
		autoSearch: true,
	}));

const userProps = computed(() => ({
	query: props.query,
		origin: props.origin,
		autoSearch: true,
	}));

const urlIntent = computed(() => {
	return props.query.startsWith('https://') && !props.query.includes(' ')
		? props.query
		: null;
});

const userIntent = computed(() => {
	return props.query.length > 1 && !props.query.includes(' ') && props.query.startsWith('@')
		? props.query
		: null;
});

const hashtagIntent = computed(() => {
	return props.query.length > 1 && !props.query.includes(' ') && props.query.startsWith('#')
		? props.query.slice(1)
		: null;
});

function routeQuery(
	nextQuery: string,
	nextTab: 'note' | 'user',
	nextOrigin: Endpoints['users/search']['req']['origin'],
) {
	return {
		q: nextQuery,
		type: nextTab,
		...(nextTab === 'note' ? {
			userId: props.userId,
			username: props.username,
			host: props.host,
		} : {}),
		...(nextTab === 'user' && instance.federation !== 'none' ? { origin: nextOrigin } : {}),
	};
}

function submit() {
	const trimmedQuery = draftQuery.value.trim();
	if (trimmedQuery === '') return;

	router.replace('/search', {
		query: routeQuery(trimmedQuery, tab.value, props.origin),
	});
}

function changeTab(nextTab: 'note' | 'user') {
	if (tab.value === nextTab) return;

	tab.value = nextTab;
	router.replace('/search', {
		query: routeQuery(props.query, nextTab, props.origin),
	});
}

function changeOrigin(nextOrigin: Endpoints['users/search']['req']['origin']) {
	if (props.origin === nextOrigin) return;

	router.replace('/search', {
		query: routeQuery(props.query, tab.value, nextOrigin),
	});
}

function onTabKeydown(ev: KeyboardEvent) {
	const currentIndex = tabs.value.findIndex(item => item.value === tab.value);
	let nextIndex: number | null = null;

	if (ev.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.value.length;
	else if (ev.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.value.length) % tabs.value.length;
	else if (ev.key === 'Home') nextIndex = 0;
	else if (ev.key === 'End') nextIndex = tabs.value.length - 1;

	if (nextIndex == null) return;

	ev.preventDefault();
	changeTab(tabs.value[nextIndex].value);
}

async function lookupUrl() {
	if (urlIntent.value == null || lookupLoading.value) return;

	lookupLoading.value = true;

	const result = await apLookup(urlIntent.value).catch(() => null);

	if (result != null) {
		if (result.type === 'User') {
			router.push('/@:acct/:page?', {
				params: {
					acct: `${result.object.username}@${result.object.host}`,
				},
			});
		} else if (result.type === 'Note') {
			router.push('/notes/:noteId/:initialTab?', {
				params: {
					noteId: result.object.id,
				},
			});
		}
	}

	lookupLoading.value = false;
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
}

.header {
	display: flex;
	gap: 8px;
	align-items: center;
	min-height: 53px;
	padding: 8px 16px;
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
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
	border-bottom: solid 0.5px var(--twitter-border);
}

.tab {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 53px;
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
	border-bottom: solid 0.5px var(--twitter-border);
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
	border-bottom: solid 0.5px var(--twitter-border);
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

@media (max-width: 500px) {
	.header,
	.originBar {
		padding-right: 12px;
		padding-left: 12px;
	}
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
