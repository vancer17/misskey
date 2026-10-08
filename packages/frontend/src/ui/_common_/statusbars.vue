<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.twitter]: isTwitterUi }]">
	<div
		v-for="x in prefer.r.statusbars.value" :key="x.id" :class="[$style.item, { [$style.black]: x.black,
			[$style.verySmall]: x.size === 'verySmall',
			[$style.small]: x.size === 'small',
			[$style.large]: x.size === 'large',
			[$style.veryLarge]: x.size === 'veryLarge',
		}]"
	>
		<span :class="$style.name">{{ x.name }}</span>
		<XRss v-if="x.type === 'rss'" :class="$style.body" :refreshIntervalSec="x.props.refreshIntervalSec" :marqueeDuration="x.props.marqueeDuration" :marqueeReverse="x.props.marqueeReverse" :display="x.props.display" :url="x.props.url" :shuffle="x.props.shuffle"/>
		<XFederation v-else-if="x.type === 'federation' && instance.federation !== 'none'" :class="$style.body" :refreshIntervalSec="x.props.refreshIntervalSec" :marqueeDuration="x.props.marqueeDuration" :marqueeReverse="x.props.marqueeReverse" :display="x.props.display" :colored="x.props.colored"/>
		<XUserList v-else-if="x.type === 'userList'" :class="$style.body" :refreshIntervalSec="x.props.refreshIntervalSec" :marqueeDuration="x.props.marqueeDuration" :marqueeReverse="x.props.marqueeReverse" :display="x.props.display" :userListId="x.props.userListId"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent } from 'vue';
import { instance } from '@/instance.js';
import { prefer } from '@/preferences.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const XRss = defineAsyncComponent(() => import('./statusbar-rss.vue'));
const XFederation = defineAsyncComponent(() => import('./statusbar-federation.vue'));
const XUserList = defineAsyncComponent(() => import('./statusbar-user-list.vue'));

const isTwitterUi = useIsTwitterUi();
</script>

<style lang="scss" module>
.root {
	font-size: 15px;
	background: var(--MI_THEME-panel);

	/* Twitter UI 表现变体：X 顶部状态条表面（marquee 行为与 black 反色项保持用户配置语义） */
	&.twitter {
		background: var(--twitter-panel);
		color: var(--twitter-fg);
		border-bottom: 1px solid var(--twitter-border);
	}
}

.item {
	--height: 24px;
	--nameMargin: 10px;
	font-size: 0.85em;

	display: flex;
	vertical-align: bottom;
	width: 100%;
	line-height: var(--height);
	height: var(--height);
	overflow: clip;
	contain: strict;

	&.verySmall {
		--nameMargin: 7px;
		--height: 16px;
		font-size: 0.75em;
	}

	&.small {
		--nameMargin: 8px;
		--height: 20px;
		font-size: 0.8em;
	}

	&.large {
		--nameMargin: 12px;
		--height: 26px;
		font-size: 0.875em;
	}

	&.veryLarge {
		--nameMargin: 14px;
		--height: 30px;
		font-size: 0.9em;
	}

	&.black {
		background: #000;
		color: #fff;
	}
}

.name {
	padding: 0 var(--nameMargin);
	font-weight: bold;
	color: var(--MI_THEME-accent);

	&:empty {
		display: none;
	}
}

.body {
	min-width: 0;
	flex: 1;
}
</style>
