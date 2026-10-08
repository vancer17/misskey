<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" class="_pageScrollable" :class="[$style.root, { [$style.mobile]: isMobile }]">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header">
				<button
					:class="$style.back"
					class="_button"
					type="button"
					:aria-label="i18n.ts.goBack"
					@click="goBack"
				>
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<h1 :class="$style.title">{{ i18n.ts.note }}</h1>
			</header>
		</template>

		<div :class="$style.body">
			<slot></slot>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';
import { i18n } from '@/i18n.js';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile } = useTwitterLayout();

const rootEl = useTemplateRef('rootEl');

useScrollPositionKeeper(rootEl);

function goBack() {
	window.history.back();
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
}

.header {
	display: grid;
	grid-template-columns: 56px minmax(0, 1fr);
	align-items: center;
	height: 53px;
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
}

.back {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	margin-left: var(--twitter-space-2);
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.title {
	min-width: 0;
	margin: 0;
	padding-right: var(--twitter-space-4);
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: 17px;
	font-weight: 800;
	line-height: 1.2;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.root.mobile {
	.header {
		grid-template-columns: 48px minmax(0, 1fr);
	}

	.back {
		width: 32px;
		height: 32px;
		margin-left: var(--twitter-space-1);
	}

	.title {
		padding-right: var(--twitter-space-3);
		font-size: var(--twitter-font-size-emphasis);
	}
}
</style>
