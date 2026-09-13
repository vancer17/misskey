<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<TwitterSearchField v-model="query" @submit="search"/>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { mainRouter } from '@/router.js';
import TwitterSearchField from './SearchField.vue';

const query = ref('');

const routeQuery = computed(() => mainRouter.currentRoute.value.query?.q);

watch(routeQuery, (value) => {
	query.value = typeof value === 'string' ? value : '';
}, { immediate: true });

function search() {
	const trimmedQuery = query.value.trim();
	if (trimmedQuery === '') return;

	mainRouter.push('/search', {
		query: {
			q: trimmedQuery,
		},
	});
}
</script>
