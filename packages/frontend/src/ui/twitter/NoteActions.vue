<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<footer :class="$style.root">
	<button
		:class="[$style.action, $style.reply]"
		class="_button"
		type="button"
		:aria-label="i18n.ts.reply"
		@click.stop="emit('reply')"
	>
		<i class="ti ti-message-circle" aria-hidden="true"></i>
		<span v-if="note.repliesCount > 0" :class="$style.count">{{ number(note.repliesCount) }}</span>
	</button>

	<button
		:ref="setRenoteButton"
		:class="[$style.action, $style.renote]"
		class="_button"
		type="button"
		:disabled="!canRenote"
		:aria-label="i18n.ts.renote"
		@click.stop="emit('renote')"
	>
		<i :class="canRenote ? 'ti ti-repeat' : 'ti ti-ban'" aria-hidden="true"></i>
		<span v-if="canRenote && note.renoteCount > 0" :class="$style.count">{{ number(note.renoteCount) }}</span>
	</button>

	<button
		:ref="setReactButton"
		:class="[$style.action, $style.like, { [$style.active]: note.myReaction != null }]"
		class="_button"
		type="button"
		:aria-pressed="myReaction != null"
		:aria-label="myReaction != null ? i18n.ts.unlike : i18n.ts.like"
		@click.stop="emit('react')"
	>
		<i
			:class="note.reactionAcceptance === 'likeOnly'
				? (myReaction != null ? 'ti ti-heart-filled' : 'ti ti-heart')
				: (myReaction != null ? 'ti ti-heart-filled' : 'ti ti-plus')"
			aria-hidden="true"
		></i>
		<span
			v-if="(note.reactionAcceptance === 'likeOnly' || prefer.s.showReactionsCount) && reactionCount > 0"
			:class="$style.count"
		>{{ number(reactionCount) }}</span>
	</button>

	<button
		:class="[$style.action, $style.share]"
		class="_button"
		type="button"
		:aria-label="i18n.ts.more"
		@click.stop="emit('menu')"
	>
		<i class="ti ti-dots" aria-hidden="true"></i>
	</button>
</footer>
</template>

<script lang="ts" setup>
import type { ComponentPublicInstance } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import number from '@/filters/number.js';

type ElementRefSetter = (element: Element | ComponentPublicInstance | null) => void;

defineProps<{
	note: Misskey.entities.Note;
	reactionCount: number;
	myReaction: string | null | undefined;
	canRenote: boolean;
	setRenoteButton: ElementRefSetter;
	setReactButton: ElementRefSetter;
}>();

const emit = defineEmits<{
	(ev: 'reply'): void;
	(ev: 'renote'): void;
	(ev: 'react'): void;
	(ev: 'menu'): void;
}>();
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	justify-content: space-between;
	max-width: 425px;
	margin-top: 6px;
}

.action {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	min-width: 34px;
	height: 32px;
	padding: 0 8px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-secondary-fg);
	font-size: 13px;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-fast) var(--twitter-ease);

	&:hover:not(:disabled) {
		transform: scale(1.02);
	}

	&:active:not(:disabled) {
		transform: scale(0.94);
	}

	&:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
}

.reply {
	&:hover:not(:disabled), &:focus-visible {
		background: color-mix(in srgb, var(--twitter-accent) 12%, transparent);
		color: var(--twitter-accent);
	}
}

.renote {
	&:hover:not(:disabled), &:focus-visible {
		background: color-mix(in srgb, var(--twitter-success) 12%, transparent);
		color: var(--twitter-success);
	}
}

.like {
	&:hover:not(:disabled), &:focus-visible {
		background: color-mix(in srgb, var(--twitter-like) 12%, transparent);
		color: var(--twitter-like);
	}
}

.share {
	&:hover:not(:disabled), &:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
		color: var(--twitter-fg);
	}
}

.active {
	color: var(--twitter-like);
	animation: twitterLike var(--twitter-duration-slow, 240ms) var(--twitter-ease);
}

.count {
	min-width: 1em;
	text-align: left;
}

@keyframes twitterLike {
	0% { transform: scale(1); }
	35% { transform: scale(1.22); }
	65% { transform: scale(0.92); }
	100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
	.action,
	.active {
		animation: none;
		transition-duration: 0.01ms;
	}
}
</style>
