<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	:preferType="modalPreferType"
	@click="onBgClick()"
	@closed="onModalClosed()"
	@esc="onEsc"
>
	<MkPostForm
		ref="form"
		:class="[
			isTwitterUi ? undefined : '_popup',
			$style.form,
			{ [$style.twitterForm]: isTwitterUi },
		]"
		v-bind="props"
		autofocus
		freezeAfterPosted
		@posted="onPosted"
		@cancel="_close()"
		@esc="_close()"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import { computed, inject, ref, useTemplateRef } from 'vue';
import type { PostFormProps } from '@/types/post-form.js';
import MkModal from '@/components/MkModal.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import { deviceKind } from '@/utility/device-kind.js';
import { DI } from '@/di.js';

const props = withDefaults(defineProps<PostFormProps & {
	instant?: boolean;
	fixed?: boolean;
	autofocus?: boolean;
}>(), {
	initialLocalOnly: undefined,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');
const modalPreferType = computed(() => isTwitterUi.value && deviceKind === 'smartphone' ? 'drawer' : 'dialog');

const modal = useTemplateRef('modal');
const form = useTemplateRef('form');

function onPosted() {
	modal.value?.close({
		useSendAnimation: true,
	});
}

async function _close() {
	const canClose = await form.value?.canClose();
	if (!canClose) return;
	form.value?.abortUploader();
	modal.value?.close();
}

function onEsc() {
	_close();
}

function onBgClick() {
	_close();
}

function onModalClosed() {
	emit('closed');
}
</script>

<style lang="scss" module>
.form {
	width: 100%;
	max-width: 520px;
	margin: 0 auto auto auto;
}

.twitterForm {
	max-width: 600px;
	overflow: hidden;
	border-radius: var(--twitter-radius-large, 16px);
	background: var(--twitter-panel, var(--MI_THEME-panel));
	box-shadow: 0 16px 48px color-mix(in srgb, var(--MI_THEME-shadow) 45%, transparent);
}

@media (max-width: 500px) {
	.twitterForm {
		max-width: none;
		min-height: auto;
		border-radius: var(--twitter-radius-large, 16px) var(--twitter-radius-large, 16px) 0 0;
		box-shadow: 0 -8px 32px color-mix(in srgb, var(--MI_THEME-shadow) 35%, transparent);
	}
}
</style>
