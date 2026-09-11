<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div :class="$style.top">
		<button
			:class="$style.back"
			class="_button"
			type="button"
			:aria-label="i18n.ts.goBack"
			@click="goBack"
		>
			<i class="ti ti-arrow-left" aria-hidden="true"></i>
		</button>
		<h1 :class="$style.title">{{ i18n.ts.notifications }}</h1>
		<div :class="$style.actions">
			<button
				v-for="(action, index) in actions"
				:key="index"
				:class="[$style.action, { [$style.highlighted]: action.highlighted }]"
				class="_button"
				type="button"
				:aria-label="action.text"
				@click="action.handler"
			>
				<i :class="action.icon" aria-hidden="true"></i>
			</button>
		</div>
	</div>

	<nav :class="$style.tabs" :aria-label="i18n.ts.notifications">
		<button
			v-for="item in tabs"
			:key="item.key"
			:class="$style.tab"
			class="_button"
			type="button"
			:aria-current="item.key === tabModel ? 'page' : undefined"
			@click="tabModel = item.key"
		>
			<span :class="$style.tabTitle">{{ item.title }}</span>
		</button>
	</nav>
</header>
</template>

<script lang="ts" setup>
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import { i18n } from '@/i18n.js';

defineProps<{
	tabs: Tab[];
	actions?: PageHeaderItem[];
}>();

const tabModel = defineModel<string>('tab');

function goBack() {
	window.history.back();
}
</script>

<style lang="scss" module>
.root {
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
}

.top {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr) minmax(72px, auto);
	align-items: center;
	height: 50px;
}

.back,
.action {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	font-size: 17px;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.back {
	margin-left: 8px;
}

.title {
	min-width: 0;
	margin: 0;
	padding: 0 8px;
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: 17px;
	font-weight: 800;
	line-height: 1.2;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	display: flex;
	gap: 4px;
	justify-content: flex-end;
	padding-right: 8px;
}

.highlighted {
	color: var(--twitter-accent);
}

.tabs {
	display: flex;
	height: 50px;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		display: none;
	}
}

.tab {
	position: relative;
	display: flex;
	flex: 1 0 auto;
	align-items: center;
	justify-content: center;
	min-width: 72px;
	height: 100%;
	padding: 0 14px;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	font-weight: 700;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&::after {
		content: "";
		position: absolute;
		right: 14px;
		bottom: 0;
		left: 14px;
		height: 4px;
		border-radius: var(--twitter-radius-pill) var(--twitter-radius-pill) 0 0;
		background: var(--twitter-accent);
		opacity: 0;
		transform: scaleX(0.4);
		transition:
			opacity var(--twitter-duration-fast) ease,
			transform var(--twitter-duration-normal) var(--twitter-ease);
	}

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 6%, transparent);
		color: var(--twitter-fg);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}

	&[aria-current="page"] {
		color: var(--twitter-fg);

		&::after {
			opacity: 1;
			transform: scaleX(1);
		}
	}
}

.tabTitle {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
	.tab::after,
	.back,
	.action {
		transition: none;
	}
}

@media (max-width: 500px) {
	.top {
		grid-template-columns: 40px minmax(0, 1fr) minmax(68px, auto);
		height: 48px;
	}

	.back {
		width: 32px;
		height: 32px;
		margin-left: 4px;
	}

	.tabs {
		height: 48px;
	}

	.tab {
		flex: 0 0 auto;
		min-width: 64px;
		padding: 0 12px;
	}
}
</style>
