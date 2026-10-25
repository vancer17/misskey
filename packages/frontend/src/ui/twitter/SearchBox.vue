<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI 常驻搜索入口。
作用：保留临时输入草稿，从当前解析后的搜索路由恢复关键词。
数据链：当前出口路由 props → 输入草稿 → 搜索导航；不读取路由定义中的字段映射。
-->

<template>
<TwitterSearchField v-model="query" @submit="search"/>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useRouter } from '@/router.js';
import type { Router } from '@/router.js';
import TwitterSearchField from './SearchField.vue';

const router: Router = useRouter();
const query: Ref<string> = ref('');
/** 搜索路由真实关键词来自解析 props；离开搜索后保留输入草稿。 */
const routeQuery: ComputedRef<string | null> = computed(
	/** 路由定义只描述映射，不能作为用户提交内容。 */
	(): string | null => {
		if (router.currentRef.value.route.path !== '/search') return null;
		const value: string | boolean | undefined = router.currentRef.value.props.get('query');
		return typeof value === 'string' ? value : '';
	},
);

watch(routeQuery,
	/** 只在搜索页的解析关键词发生变化时恢复已提交文本。 */
	(value: string | null): void => {
		if (value !== null) query.value = value;
	}, { immediate: true });

/** 入口导航交给注入的现有路由，不额外持有已提交业务状态。 */
function search(): void {
	const trimmedQuery: string = query.value.trim();
	if (trimmedQuery === '') return;
	router.push('/search', { query: { q: trimmedQuery } });
}
</script>
