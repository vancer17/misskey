<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<aside :class="$style.root">
	<TwitterSearchBox :class="$style.search"/>
	<div :class="$style.widgets">
		<XWidgets place="right"/>
	</div>
</aside>
</template>

<script lang="ts" setup>
import { defineAsyncComponent } from 'vue';
import TwitterSearchBox from './SearchBox.vue';

const XWidgets = defineAsyncComponent(() => import('../_common_/widgets.vue'));
</script>

<style lang="scss" module>
.root {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: 16px;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	padding: 0 16px;
	overflow-y: auto;
	overscroll-behavior: contain;
	background: var(--twitter-bg);
}

.search {
	position: sticky;
	top: 0;
	z-index: 1;
	flex-shrink: 0;
	margin: 16px 0;
	background: var(--twitter-hover);
}

.widgets {
	min-height: 0;
}
</style>
