<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" class="_pageScrollable" :class="$style.root">
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
	margin-left: 8px;
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
	padding-right: 16px;
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

@media (max-width: 500px) {
	.header {
		grid-template-columns: 48px minmax(0, 1fr);
	}

	.back {
		width: 32px;
		height: 32px;
		margin-left: 4px;
	}

	.title {
		padding-right: 12px;
		font-size: 16px;
	}
}
</style>
