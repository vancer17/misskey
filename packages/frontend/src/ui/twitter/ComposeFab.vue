<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button
	class="_button"
	:class="$style.root"
	type="button"
	:aria-label="i18n.ts.note"
	data-testid="open-post-form"
	@click="openPostForm"
>
	<i class="ti ti-pencil" aria-hidden="true"></i>
</button>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

function openPostForm() {
	os.post();
}
</script>

<style lang="scss" module>
.root {
	position: fixed;
	right: 16px;
	bottom: calc(72px + env(safe-area-inset-bottom, 0px));
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 56px;
	height: 56px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 22px;
	box-shadow: 0 4px 12px color-mix(in srgb, var(--MI_THEME-shadow) 80%, transparent);
	transition:
		background-color var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-normal) var(--twitter-ease);

	&:hover,
	&:focus-visible {
		background: var(--twitter-accent-hover);
	}

	&:active {
		transform: scale(0.94);
	}
}

@media (prefers-reduced-motion: reduce) {
	.root {
		transition: none;
	}
}
</style>
