<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span :class="$style.root">
	<Mfm
		:class="$style.text"
		:text="getNoteSummary(note)"
		:plain="true"
		:author="note.user"
	/>
	<span v-if="(note.files?.length ?? 0) > 0" :class="$style.files">
		<i class="ti ti-photo" aria-hidden="true"></i>
	</span>
</span>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { getNoteSummary } from '@/utility/get-note-summary.js';

defineProps<{
	note: Misskey.entities.Note;
}>();
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	color: var(--twitter-secondary-fg);
}

.text {
	display: -webkit-box;
	overflow: hidden;
	font-size: 14px;
	line-height: 1.35;
	overflow-wrap: anywhere;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}

.files {
	margin-left: 4px;
	color: var(--twitter-accent);
	font-size: 13px;
}
</style>
