<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkButton rounded full small @click="toggle"><b>{{ modelValue ? i18n.ts._cw.hide : i18n.ts._cw.show }}</b><span v-if="!modelValue" :class="[$style.label, { [$style.twitter]: isTwitterUi }]">{{ label }}</span></MkButton>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import type { PollEditorModelValue } from '@/components/MkPollEditor.vue';
import { concat } from '@/utility/array.js';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const props = defineProps<{
	modelValue: boolean;
	text: string | null;
	renote?: Misskey.entities.Note | null;
	files?: Misskey.entities.DriveFile[];
	poll?: Misskey.entities.Note['poll'] | PollEditorModelValue | null;
}>();

const isTwitterUi = useIsTwitterUi();

const emit = defineEmits<{
	(ev: 'update:modelValue', v: boolean): void;
}>();

const label = computed(() => {
	return concat([
		props.text ? [i18n.tsx._cw.chars({ count: props.text.length })] : [],
		props.renote ? [i18n.ts.quote] : [],
		props.files && props.files.length !== 0 ? [i18n.tsx._cw.files({ count: props.files.length })] : [],
		props.poll != null ? [i18n.ts.poll] : [],
	] as string[][]).join(' / ');
});

function toggle() {
	emit('update:modelValue', !props.modelValue);
}
</script>

<style lang="scss" module>
.label {
	margin-left: 4px;

	&::before {
		content: '(';
	}

	&::after {
		content: ')';
	}

	/* Twitter UI 表现变体：计数标签弱化为次要色（按钮本体经 MkButton 的 twitter 变体继承） */
	&.twitter {
		color: var(--twitter-secondary-fg);
		font-weight: 400;
	}
}
</style>
