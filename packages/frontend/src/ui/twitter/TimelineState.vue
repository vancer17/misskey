<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" role="status">
	<i v-if="type === 'error'" :class="[$style.icon, 'ti ti-alert-triangle']" aria-hidden="true"></i>
	<h2 :class="$style.title">{{ type === 'error' ? i18n.ts.somethingHappened : i18n.ts.noNotes }}</h2>
	<p v-if="type === 'error'" :class="$style.description">{{ i18n.ts.error }}</p>
	<button
		v-if="type === 'error'"
		class="_button"
		:class="$style.retry"
		type="button"
		@click="emit('retry')"
	>
		{{ i18n.ts.retry }}
	</button>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';

withDefaults(defineProps<{
	type?: 'empty' | 'error';
}>(), {
	type: 'empty',
});

const emit = defineEmits<{
	(ev: 'retry'): void;
}>();
</script>

<style lang="scss" module>
.root {
	display: grid;
	min-height: min(60vh, 480px);
	align-content: center;
	justify-items: center;
	gap: 8px;
	padding: 48px 24px;
	text-align: center;
}

.icon {
	color: var(--twitter-secondary-fg);
	font-size: 32px;
}

.title {
	margin: 0;
	color: var(--twitter-fg);
	font-size: 20px;
	font-weight: 800;
}

.description {
	margin: 0;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
}

.retry {
	margin-top: 8px;
	padding: 8px 16px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 14px;
	font-weight: 700;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: var(--twitter-accent-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}
</style>
