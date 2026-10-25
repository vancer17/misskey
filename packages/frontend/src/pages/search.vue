<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：既有搜索页面与 Twitter UI 展示适配。
作用：将解析路由及响应式搜索权限传入对应页面；稳定实例时同步默认 UI 标签。
数据链：路由 props／既有角色策略 → 展示参数 → 原搜索结果组件。
-->

<template>
<TwitterSearch
	v-if="isTwitterUi"
	v-bind="twitterProps"
/>

<PageWithHeader v-else v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div v-if="tab === 'note'" class="_spacer" style="--MI_SPACER-w: 800px;">
		<div v-if="notesSearchAvailable || ignoreNotesSearchAvailable">
			<XNote v-bind="props"/>
		</div>
		<div v-else>
			<MkInfo warn>{{ i18n.ts.notesSearchNotAvailable }}</MkInfo>
		</div>
	</div>

	<div v-else-if="tab === 'user'" class="_spacer" style="--MI_SPACER-w: 800px;">
		<div v-if="usersSearchAvailable">
			<XUser v-bind="props"/>
		</div>
		<div v-else>
			<MkInfo warn>{{ i18n.ts.usersSearchNotAvailable }}</MkInfo>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import type { Component, ComputedRef, Ref } from 'vue';
import type { TwitterSearchTab } from '@/ui/twitter/domain/index.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import type { PageMetadata } from '@/page.js';
import { notesSearchAvailable, usersSearchAvailable } from '@/utility/check-permissions.js';
import MkInfo from '@/components/MkInfo.vue';
import { DI } from '@/di.js';

/** 搜索宿主接收的简单路由字段；忽略权限仅供既有 Storybook 使用。 */
type SearchPageProps = {
	query?: string;
	userId?: string;
	username?: string;
	host?: string | null;
	type?: TwitterSearchTab;
	origin?: 'combined' | 'local' | 'remote';
	ignoreNotesSearchAvailable?: boolean;
};
const props: Readonly<Required<Omit<SearchPageProps, 'userId' | 'username' | 'host'>> & Pick<SearchPageProps, 'userId' | 'username' | 'host'>> = withDefaults(defineProps<SearchPageProps>(), {
	query: '',
	userId: undefined,
	username: undefined,
	host: undefined,
	type: 'note',
	origin: 'combined',
	ignoreNotesSearchAvailable: false,
});

const XNote: Component = defineAsyncComponent(
	/** 结果组件维持既有惰性加载与分页器所有权。 */
	(): Promise<typeof import('./search.note.vue')> => import('./search.note.vue'),
);
const XUser: Component = defineAsyncComponent(
	/** 用户查询独立加载，避免成为页头的取数责任。 */
	(): Promise<typeof import('./search.user.vue')> => import('./search.user.vue'),
);
const TwitterSearch: Component = defineAsyncComponent(
	/** 仅 Twitter 风格挂载搜索展示容器。 */
	(): Promise<typeof import('./TwitterSearch.vue')> => import('./TwitterSearch.vue'),
);

const tab: Ref<TwitterSearchTab> = ref(props.type);
watch(
	/** 每次外部搜索条件提交都恢复路由标签，覆盖默认 UI 尚未写回路由的临时标签。 */
	(): readonly (string | null | undefined)[] => [props.type, props.query, props.userId, props.username, props.host, props.origin],
	/** 默认 UI 的 v-model 只保存当前展示选择；导航后仍由完整路由恢复标签。 */
	(): void => { tab.value = props.type; },
);
const uiStyle: Ref<string> = inject(DI.uiStyle, ref('default'));
const isTwitterUi: ComputedRef<boolean> = computed(
	/** 风格只选择展示宿主，不改变搜索规则。 */
	(): boolean => uiStyle.value === 'twitter',
);

const headerActions: ComputedRef<never[]> = computed(
	/** 搜索页维持无额外页头操作的既有展示。 */
	(): never[] => [],
);

/** 既有页头标签的只读展示数据，不再定义另一组搜索标签取值。 */
type SearchHeaderTab = Readonly<{ key: TwitterSearchTab; title: string; icon: string }>;
const headerTabs: ComputedRef<SearchHeaderTab[]> = computed(
	/** 默认 UI 标签与 Twitter UI 共用领域标识。 */
	(): SearchHeaderTab[] => [{
		key: 'note',
		title: i18n.ts.notes,
		icon: 'ti ti-pencil',
	}, {
		key: 'user',
		title: i18n.ts.users,
		icon: 'ti ti-users',
	}],
);

/** Twitter 搜索容器仅接收路由原始值与当前权限的只读投影。 */
type TwitterSearchProjection = Readonly<Omit<typeof props, 'ignoreNotesSearchAvailable'> & { canSearchNotes: boolean; canSearchUsers: boolean }>;
const twitterProps: ComputedRef<TwitterSearchProjection> = computed(
	/** 路由参数和权限策略单向形成只读展示投影。 */
	(): TwitterSearchProjection => ({
		query: props.query,
		userId: props.userId,
		username: props.username,
		host: props.host,
		type: props.type,
		origin: props.origin,
		canSearchNotes: notesSearchAvailable.value || props.ignoreNotesSearchAvailable,
		canSearchUsers: usersSearchAvailable.value,
	}),
);

definePage(
	/** 搜索页标题不依赖异步结果。 */
	(): PageMetadata => ({ title: i18n.ts.search, icon: 'ti ti-search' }),
);
</script>
