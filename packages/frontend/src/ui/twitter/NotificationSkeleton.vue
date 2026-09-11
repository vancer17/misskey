<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" role="status" :aria-label="i18n.ts.loading">
	<div v-for="index in 6" :key="index" :class="$style.row">
		<div :class="$style.icon"></div>
		<div :class="$style.lines">
			<div :class="[$style.line, $style.short]"></div>
			<div :class="$style.line"></div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
</script>

<style lang="scss" module>
.root {
	background: var(--twitter-bg);
	border-bottom: solid 0.5px var(--twitter-border);
}

.row {
	display: grid;
	grid-template-columns: 32px minmax(0, 1fr);
	gap: 12px;
	padding: 18px 16px;
	border-bottom: solid 0.5px var(--twitter-border);

	&:last-child {
		border-bottom: none;
	}
}

.icon,
.line {
	background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	animation: twitterNotificationSkeleton 1.2s ease-in-out infinite;
}

.icon {
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-pill);
}

.lines {
	display: grid;
	gap: 10px;
}

.line {
	height: 10px;
	border-radius: var(--twitter-radius-pill);
}

.short {
	width: 40%;
}

@keyframes twitterNotificationSkeleton {
	0% { opacity: 0.45; }
	50% { opacity: 0.85; }
	100% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
	.icon,
	.line {
		animation: none;
	}
}
</style>
