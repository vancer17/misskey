<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.twitter]: isTwitterUi }]" :style="isTwitterUi ? undefined : themeColorStyle">
	<img v-if="faviconUrl" :class="$style.icon" :src="faviconUrl"/>
	<div :class="$style.name">{{ instanceName }}</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { instanceName as localInstanceName } from '@@/js/config.js';
import type { CSSProperties } from 'vue';
import { instance as localInstance } from '@/instance.js';
import { getProxiedImageUrlNullable } from '@/utility/media-proxy.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const props = defineProps<{
	host: string | null;
	instance?: {
		faviconUrl?: string | null
		name?: string | null
		themeColor?: string | null
	}
}>();

const isTwitterUi = useIsTwitterUi();

// if no instance data is given, this is for the local instance
const instanceName = computed(() => props.host == null ? localInstanceName : props.instance?.name ?? props.host);

const faviconUrl = computed(() => {
	let imageSrc: string | null = null;
	if (props.host == null) {
		if (localInstance.iconUrl == null) {
			return '/favicon.ico';
		} else {
			imageSrc = localInstance.iconUrl;
		}
	} else {
		imageSrc = props.instance?.faviconUrl ?? null;
	}
	return getProxiedImageUrlNullable(imageSrc);
});

const themeColorStyle = computed<CSSProperties>(() => {
	const themeColor = (props.host == null ? localInstance.themeColor : props.instance?.themeColor) ?? '#777777';
	return {
		background: `linear-gradient(90deg, ${themeColor}, ${themeColor}00)`,
	};
});
</script>

<style lang="scss" module>
$height: 2ex;

.root {
	display: flex;
	align-items: center;
	height: $height;
	border-radius: 4px 0 0 4px;
	overflow: clip;
	color: #fff;

	// text-shadowは重いから使うな

	mask-image: linear-gradient(90deg,
		rgb(0,0,0),
		rgb(0,0,0) calc(100% - 16px),
		rgba(0,0,0,0) 100%
	);

	/* Twitter UI 表现变体：中性实例 chip（nitter/X 均无对应物，X 视觉语言派生；功能保留＝远程帖可见来源实例，偏离记录见 ADR-0001） */
	&.twitter {
		display: inline-flex;
		height: 20px;
		padding: 0 8px;
		border-radius: var(--twitter-radius-pill);
		border: solid 1px var(--twitter-border);
		background: var(--twitter-panel);
		color: var(--twitter-secondary-fg);
		-webkit-text-stroke: 0;
		mask-image: none;

		> .icon {
			height: 14px;
		}

		> .name {
			margin-left: 4px;
			color: var(--twitter-secondary-fg);
			font-size: 12px;
			font-weight: 600;
			-webkit-text-stroke: 0;
		}
	}
}

.icon {
	height: $height;
	flex-shrink: 0;
}

.name {
	margin-left: 4px;
	line-height: 1;
	font-size: 0.9em;
	font-weight: bold;
	white-space: nowrap;
	overflow: visible;

	// text-shadowは重いから使うな
	color: var(--MI_THEME-fg);
	-webkit-text-stroke: var(--MI_THEME-panel) .225em;
	paint-order: stroke fill;
}
</style>
