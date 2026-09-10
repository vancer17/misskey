<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button class="_button" :class="$style.root" type="button" @click="emit('click')">
	<i class="ti ti-circle-arrow-up" aria-hidden="true"></i>
	<span>{{ i18n.tsx._twitterUi.newNotesWithCount({ count }) }}</span>
</button>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';

defineProps<{
	count: number;
}>();

const emit = defineEmits<{
	(ev: 'click'): void;
}>();
</script>

<style lang="scss" module>
.root {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	height: 36px;
	padding: 0 16px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 14px;
	font-weight: 700;
	box-shadow: 0 4px 12px color-mix(in srgb, var(--twitter-accent) 35%, transparent);
	transition:
		background-color var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-fast) var(--twitter-ease);

	&:hover {
		background: var(--twitter-accent-hover);
	}

	&:active {
		transform: scale(0.98);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.root {
		transition: none;

		&:active {
			transform: none;
		}
	}
}
</style>
