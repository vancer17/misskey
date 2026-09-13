<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<form :class="$style.root" role="search" @submit.prevent="emit('submit', model.trim())">
	<i :class="$style.icon" class="ti ti-search ti-fw" aria-hidden="true"></i>
	<input
		ref="inputEl"
		v-model="model"
		:class="$style.input"
		type="search"
		name="q"
		:placeholder="placeholder"
		:aria-label="placeholder"
		:autofocus="autofocus"
	>
	<button
		v-if="model !== ''"
		class="_button"
		:class="$style.clear"
		type="button"
		:aria-label="i18n.ts.clear"
		@click="clear"
	>
		<i class="ti ti-x" aria-hidden="true"></i>
	</button>
</form>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import { i18n } from '@/i18n.js';

const model = defineModel<string>({
	default: '',
});

withDefaults(defineProps<{
	placeholder?: string;
	autofocus?: boolean;
}>(), {
	placeholder: i18n.ts.search,
	autofocus: false,
});

const emit = defineEmits<{
	(ev: 'submit', query: string): void;
	(ev: 'clear'): void;
}>();

const inputEl = useTemplateRef('inputEl');

function clear() {
	model.value = '';
	emit('clear');
	inputEl.value?.focus();
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 44px;
	padding: 0 16px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-hover);
	color: var(--twitter-secondary-fg);
	transition:
		background-color var(--twitter-duration-fast) ease,
		box-shadow var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:focus-within {
		background: var(--twitter-bg);
		box-shadow: 0 0 0 1px var(--twitter-accent);
		color: var(--twitter-fg);
	}
}

.icon {
	flex-shrink: 0;
	font-size: 18px;
}

.input {
	flex: 1;
	min-width: 0;
	border: none;
	background: transparent;
	color: var(--twitter-fg);
	font-size: 15px;
	outline: none;

	&::placeholder {
		color: var(--twitter-secondary-fg);
	}

	&::-webkit-search-cancel-button {
		display: none;
	}
}

.clear {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-pill);
	color: inherit;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}
</style>
