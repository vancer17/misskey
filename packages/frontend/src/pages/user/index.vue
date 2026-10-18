<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：用户主页路由页面。
作用：按账户标识加载既有用户模型，维持错误状态和缓存回访刷新。
数据链：路由账户 → users/show → 当前实体；失效请求不得覆盖新账户，不解释环境探测。
-->

<template>
<TwitterHome
	v-if="isTwitterUi"
	:user="user"
	:error="error"
	:page="props.page"
	@retry="fetchUser()"
/>
<PageWithHeader v-else v-model:tab="tab" :tabs="headerTabs" :actions="headerActions" :swipable="true">
	<div v-if="user">
		<XHome v-if="tab === 'home'" :user="user" @showMoreFiles="() => { tab = 'files'; }"/>
		<XNotes v-else-if="tab === 'notes'" :user="user"/>
		<XFiles v-else-if="tab === 'files'" :user="user"/>
		<XActivity v-else-if="tab === 'activity'" :user="user"/>
		<XAchievements v-else-if="tab === 'achievements'" :user="user"/>
		<XReactions v-else-if="tab === 'reactions'" :user="user"/>
		<XClips v-else-if="tab === 'clips'" :user="user"/>
		<XLists v-else-if="tab === 'lists'" :user="user"/>
		<XPages v-else-if="tab === 'pages'" :user="user"/>
		<XFlashs v-else-if="tab === 'flashs'" :user="user"/>
		<XGallery v-else-if="tab === 'gallery'" :user="user"/>
		<XRaw v-else-if="tab === 'raw'" :user="user"/>
	</div>
	<MkError v-else-if="error" @retry="fetchUser()"/>
	<MkLoading v-else/>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, computed, inject, watch, ref, onActivated, onDeactivated, onBeforeUnmount } from 'vue';
import * as Misskey from 'misskey-js';
import type { Ref } from 'vue';
import { acct as getAcct } from '@/filters/user.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { serverContext, assertServerContext } from '@/server-context.js';
import { DI } from '@/di.js';

const XHome = defineAsyncComponent(() => import('./home.vue'));
const XNotes = defineAsyncComponent(() => import('./notes.vue'));
const XFiles = defineAsyncComponent(() => import('./files.vue'));
const XActivity = defineAsyncComponent(() => import('./activity.vue'));
const XAchievements = defineAsyncComponent(() => import('./achievements.vue'));
const XReactions = defineAsyncComponent(() => import('./reactions.vue'));
const XClips = defineAsyncComponent(() => import('./clips.vue'));
const XLists = defineAsyncComponent(() => import('./lists.vue'));
const XPages = defineAsyncComponent(() => import('./pages.vue'));
const XFlashs = defineAsyncComponent(() => import('./flashs.vue'));
const XGallery = defineAsyncComponent(() => import('./gallery.vue'));
const XRaw = defineAsyncComponent(() => import('./raw.vue'));
const TwitterHome = defineAsyncComponent(() => import('./TwitterHome.vue'));

// contextは非ログイン状態の情報しかないためログイン時は利用できない
const CTX_USER = !$i && assertServerContext(serverContext, 'user') ? serverContext.user : null;

const props = withDefaults(defineProps<{
	acct: string;
	page?: string;
}>(), {
	page: 'home',
});

const tab = ref(props.page);
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');

/** 当前路由主页实体沿用 Misskey 既有页面归属，不新增账户副本。 */
const user: Ref<Misskey.entities.UserDetailed | null> = ref(CTX_USER);
/** 错误交由既有页面终态映射解释。 */
const error: Ref<unknown> = ref(null);
/** 当前有效加载请求，取消与引用比较共同防止迟到响应回写。 */
let userRequest: AbortController | null = null;
/** 只在真实停用后产生回访需求，不假定首次 activated 的挂载时序。 */
let needsRevisitRefresh: boolean = false;

/** 加载当前账户；首次/重试清空，回访成功回填，失败保留已有资料。 */
async function loadUser(clearBeforeLoad: boolean): Promise<void> {
	const requestedAcct: string = props.acct;
	if (requestedAcct == null) return;
	userRequest?.abort();
	const controller: AbortController = new AbortController();
	userRequest = controller;
	const { username, host }: ReturnType<typeof Misskey.acct.parse> = Misskey.acct.parse(requestedAcct);
	error.value = null;
	if (clearBeforeLoad && CTX_USER && CTX_USER.username === username && CTX_USER.host === host) {
		user.value = CTX_USER;
		userRequest = null;
		return;
	}
	if (clearBeforeLoad) user.value = null;
	try {
		const fetched: Misskey.entities.UserDetailed = await misskeyApi('users/show', { username, host }, undefined, controller.signal);
		if (userRequest !== controller || controller.signal.aborted || props.acct !== requestedAcct) return;
		user.value = fetched;
	} catch (cause: unknown) {
		if (userRequest !== controller || controller.signal.aborted || props.acct !== requestedAcct) return;
		if (user.value == null) error.value = cause;
	} finally {
		if (userRequest === controller) userRequest = null;
	}
}

/** 首次账户加载和主动重试沿用硬刷新入口。 */
async function fetchUser(): Promise<void> {
	await loadUser(true);
}

watch(
	/** 账户变化代表实体切换，不与同账户页签导航混淆。 */
	(): string => props.acct,
	fetchUser,
	{ immediate: true },
);
onDeactivated(
	/** 停用时取消在途请求，留下下一次回访需求。 */
	(): void => {
		needsRevisitRefresh = true;
		userRequest?.abort();
		userRequest = null;
	},
);
onActivated(
	/** 首挂载不重复请求，仅消费真实停用产生的标记。 */
	async (): Promise<void> => {
		if (!needsRevisitRefresh) return;
		needsRevisitRefresh = false;
		await loadUser(false);
	},
);
onBeforeUnmount(
	/** 最终销毁取消请求，防止缓存驱逐后的异步回填。 */
	(): void => { userRequest?.abort(); userRequest = null; },
);

const headerActions = computed(() => []);

const headerTabs = computed(() => user.value ? [{
	key: 'home',
	title: i18n.ts.overview,
	icon: 'ti ti-home',
}, {
	key: 'notes',
	title: i18n.ts.notes,
	icon: 'ti ti-pencil',
}, {
	key: 'files',
	title: i18n.ts.files,
	icon: 'ti ti-photo',
}, {
	key: 'activity',
	title: i18n.ts.activity,
	icon: 'ti ti-chart-line',
}, ...(user.value.host == null ? [{
	key: 'achievements',
	title: i18n.ts.achievements,
	icon: 'ti ti-medal',
}] : []), ...($i && ($i.id === user.value.id || $i.isAdmin || $i.isModerator)) || user.value.publicReactions ? [{
	key: 'reactions',
	title: i18n.ts.reaction,
	icon: 'ti ti-mood-happy',
}] : [], {
	key: 'clips',
	title: i18n.ts.clips,
	icon: 'ti ti-paperclip',
}, {
	key: 'lists',
	title: i18n.ts.lists,
	icon: 'ti ti-list',
}, {
	key: 'pages',
	title: i18n.ts.pages,
	icon: 'ti ti-news',
}, {
	key: 'flashs',
	title: 'Play',
	icon: 'ti ti-player-play',
}, {
	key: 'gallery',
	title: i18n.ts.gallery,
	icon: 'ti ti-icons',
}, {
	key: 'raw',
	title: 'Raw',
	icon: 'ti ti-code',
}] : []);

definePage(() => ({
	title: i18n.ts.user,
	icon: 'ti ti-user',
	...user.value ? {
		title: user.value.name ? `${user.value.name} (@${user.value.username})` : `@${user.value.username}`,
		subtitle: `@${getAcct(user.value)}`,
		userName: user.value,
		avatar: user.value,
		path: `/@${user.value.username}`,
		share: {
			title: user.value.name,
		},
	} : {},
}));
</script>
