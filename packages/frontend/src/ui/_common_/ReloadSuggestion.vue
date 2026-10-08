<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.twitter]: isTwitterUi }]">
	<span :class="$style.icon">
		<i class="ti ti-info-circle"></i>
	</span>
	<span :class="$style.title">{{ i18n.ts.reloadRequiredToApplySettings }}</span>
	<span :class="$style.body"><button class="_textButton" style="color: var(--MI_THEME-fgOnAccent);" @click="reload">{{ i18n.ts.reload }}</button> | <button class="_textButton" style="color: var(--MI_THEME-fgOnAccent);" @click="skip">{{ i18n.ts.skip }}</button></span>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import { shouldSuggestReload } from '@/utility/reload-suggest.js';
import { unisonReload } from '@/utility/unison-reload.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const isTwitterUi = useIsTwitterUi();

function reload() {
	unisonReload();
}

function skip() {
	shouldSuggestReload.value = false;
}
</script>

<style lang="scss" module>
.root {
	--height: 24px;
	font-size: 0.85em;
	display: flex;
	vertical-align: bottom;
	width: 100%;
	line-height: var(--height);
	height: var(--height);
	overflow: clip;
	contain: strict;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);

	/* Twitter UI 表现变体：X 品牌色系统条（blink 动效留待 R-4 统一校准） */
	&.twitter {
		background: var(--twitter-accent);
		color: var(--twitter-fg-on-accent);
	}
}

.icon {
	margin-left: 10px;
	animation: blink 2s infinite;
}

.title {
	padding: 0 10px;
	font-weight: bold;
	animation: blink 2s infinite;
}

.body {
	min-width: 0;
	flex: 1;
	overflow: clip;
	white-space: nowrap;
	text-overflow: ellipsis;
}

@keyframes blink {
	0% { opacity: 1; }
	10% { opacity: 1; }
	50% { opacity: 0; }
	90% { opacity: 1; }
	100% { opacity: 1; }
}
</style>
