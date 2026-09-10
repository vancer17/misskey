<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div :class="$style.left">
		<MkA v-if="displayMyAvatar && $i != null" :class="$style.avatarLink" to="/" :aria-label="i18n.ts.timeline">
			<MkAvatar :user="$i" :class="$style.avatar"/>
		</MkA>
	</div>

	<nav
		:class="$style.tabs"
		:aria-label="i18n.ts.timeline"
	>
		<button
			v-for="tab in tabs"
			:key="tab.key"
			class="_button"
			:class="$style.tab"
			type="button"
			:aria-current="tab.key === tabModel ? 'page' : undefined"
			@click="(ev) => onTabClick(tab, ev)"
		>
			<span :class="$style.tabTitle">{{ tab.title }}</span>
		</button>
	</nav>

	<div :class="$style.actions">
		<button
			v-for="(action, index) in actions"
			:key="index"
			class="_button"
			:class="$style.action"
			type="button"
			:aria-label="action.text ?? i18n.ts.options"
			@click="action.handler"
		>
			<i :class="[action.icon, $style.actionIcon]" aria-hidden="true"></i>
		</button>
	</div>
</header>
</template>

<script lang="ts" setup>
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

withDefaults(defineProps<{
	tabs: Tab[];
	actions?: PageHeaderItem[];
	displayMyAvatar?: boolean;
}>(), {
	actions: () => [],
	displayMyAvatar: false,
});

const tabModel = defineModel<string>('tab');

function onTabClick(tab: Tab, ev: PointerEvent) {
	if (tab.onClick != null) {
		tab.onClick(ev);
		return;
	}

	tabModel.value = tab.key;
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: minmax(44px, 1fr) minmax(0, 3fr) minmax(44px, 1fr);
	align-items: center;
	height: 53px;
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
}

.left {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	min-width: 0;
	padding-left: 12px;
}

.avatarLink {
	flex-shrink: 0;
}

.avatar {
	width: 32px;
	height: 32px;
}

.tabs {
	display: flex;
	height: 100%;
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
	gap: 6px;
	min-width: 56px;
	height: 100%;
	padding: 0 12px;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	font-weight: 700;
	text-overflow: ellipsis;
	white-space: nowrap;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&::after {
		content: "";
		position: absolute;
		right: 12px;
		bottom: 0;
		left: 12px;
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
}

.actions {
	display: flex;
	gap: 4px;
	justify-content: flex-end;
	min-width: 0;
	padding-right: 8px;
}

.action {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
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

.actionIcon {
	font-size: 18px;
}

@media (prefers-reduced-motion: reduce) {
	.tab::after {
		transition: none;
	}
}

@media (max-width: 500px) {
	.root {
		grid-template-columns: minmax(40px, 0.6fr) minmax(0, 3fr) minmax(40px, 0.6fr);
	}

	.tab {
		flex: 0 0 auto;
		min-width: 48px;
		padding: 0 10px;
	}
}
</style>
