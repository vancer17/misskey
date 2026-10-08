<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.warn]: warn, [$style.twitter]: isTwitterUi }]" class="_selectable">
	<i v-if="warn" class="ti ti-alert-triangle" :class="$style.i"></i>
	<i v-else class="ti ti-info-circle" :class="$style.i"></i>
	<div><slot></slot></div>
	<button v-if="closable" :class="$style.button" class="_button" @click="close()"><i class="ti ti-x"></i></button>
</div>
</template>

<script lang="ts" setup>
import { } from 'vue';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const props = defineProps<{
	warn?: boolean;
	closable?: boolean;
}>();

const isTwitterUi = useIsTwitterUi();

const emit = defineEmits<{
	(ev: 'close'): void;
}>();

function close() {
	// こいつの中では非表示動作は行わない
	emit('close');
}
</script>

<style lang="scss" module>
.root {
	display: flex;
  align-items: center;
	padding: 12px 14px;
	font-size: 90%;
	background: var(--MI_THEME-infoBg);
	color: var(--MI_THEME-infoFg);
	border-radius: var(--MI-radius);

	&.warn {
		background: var(--MI_THEME-infoWarnBg);
		color: var(--MI_THEME-infoWarnFg);
	}
}

.i {
	margin-right: 4px;
}

.button {
	margin-left: auto;
	padding: 4px;
}

/* Twitter UI 表现变体：X 信息条（nitter 为只读查看器无对应物，X-behavior 来源；13px 行高 1.3、accent/warning 轻底色，见 ADR-0001 覆盖层策略） */
.twitter {
	padding: 8px 12px;
	font-size: var(--twitter-font-size-meta);
	line-height: 1.3;
	background: color-mix(in srgb, var(--twitter-accent) 8%, transparent);
	color: var(--twitter-fg);
	border-radius: var(--twitter-radius-medium);

	.i {
		color: var(--twitter-accent);
	}

	&.warn {
		background: color-mix(in srgb, var(--twitter-warning) 10%, transparent);

		.i {
			color: var(--twitter-warning);
		}
	}
}
</style>
