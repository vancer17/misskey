<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：用户关注关系页面实体。
作用：协调已确认写入与缓存回访，复用原查询及基础组件，不复制业务状态。
数据链：成功通知／回访 → 页面数据所有者 → 只读显示；不解释环境探测。
-->

<template>
<TwitterFollowList
	v-if="isTwitterUi"
	:user="user"
	:error="error"
	type="following"
	@retry="fetchUser()"
/>
<PageWithHeader v-else :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 1000px;">
		<Transition name="fade" mode="out-in">
			<div v-if="user">
				<XFollowList :user="user" type="following"/>
			</div>
			<MkError v-else-if="error" @retry="fetchUser()"/>
			<MkLoading v-else/>
		</Transition>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import type { Ref } from 'vue';
import { onBeforeUnmount } from 'vue';
import { useTwitterRefresh, useTwitterRelationshipEvents } from '@/ui/twitter/index.js';
import { computed, defineAsyncComponent, inject, watch, ref } from 'vue';
import * as Misskey from 'misskey-js';
import XFollowList from './follow-list.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { DI } from '@/di.js';

/** Twitter UI 页面变体（异步加载，default UI 不承担其分包成本）。 */
const TwitterFollowList = defineAsyncComponent(() => import('./TwitterFollowList.vue'));

const props = withDefaults(defineProps<{
	acct: string;
}>(), {
});

const user = ref<null | Misskey.entities.UserDetailed>(null);
const error: Ref<unknown> = ref<unknown>(null);

/** 当前 UI 样式（由 Twitter Shell 注入；非 Twitter 场景回退 'default'）。 */
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');

/** 当前用户请求的取消句柄与占用，避免跨账户迟到响应。 */
let userRequest: AbortController | null = null;
const userLoading: Ref<boolean> = ref<boolean>(false);

/** 原实体的唯一加载入口：首次清空，回访成功才回填。 */
async function loadUser(clear: boolean): Promise<boolean> {
	const acct: string = props.acct;
	userRequest?.abort();
	const request: AbortController = new AbortController();
	userRequest = request;
	userLoading.value = true;
	error.value = null;
	if (clear) user.value = null;
	try {
		const fetched: Misskey.entities.UserDetailed = await misskeyApi('users/show', Misskey.acct.parse(acct), undefined, request.signal);
		if (request.signal.aborted || userRequest !== request || props.acct !== acct) return false;
		user.value = fetched;
		return true;
	} catch (cause: unknown) {
		if (!request.signal.aborted && props.acct === acct && user.value == null) error.value = cause;
		return false;
	} finally {
		if (userRequest === request) { userRequest = null; userLoading.value = false; }
	}
}

/** 初次及错误重试，不将表单／路由投影当作用户实体。 */
async function fetchUser(): Promise<void> { await loadUser(true); }

watch(/** 账户切换对应资源切换。 */ (): string => props.acct, fetchUser, { immediate: true });
onBeforeUnmount(/** 最终销毁时取消实体请求。 */ (): void => { userRequest?.abort(); });
const invalidateUser: () => void = useTwitterRefresh(
	/** 列表头部计数从用户查询回填，不从分页长度推算。 */ async (): Promise<boolean> => loadUser(false),
	{ busy: /** 等待首次加载完成。 */ (): boolean => userLoading.value },
);
useTwitterRelationshipEvents(/** 此页面实体标识。 */ (): string | null => user.value?.id ?? null, invalidateUser);

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.user,
	icon: 'ti ti-user',
	...user.value ? {
		title: user.value.name ? `${user.value.name} (@${user.value.username})` : `@${user.value.username}`,
		subtitle: i18n.ts.following,
		userName: user.value,
		avatar: user.value,
	} : {},
}));
</script>
