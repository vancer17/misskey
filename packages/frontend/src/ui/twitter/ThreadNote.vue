<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article
	v-if="muted === false && !hideByPlugin && !isDeleted"
	ref="rootEl"
	v-hotkey="keymap"
	:class="$style.root"
	tabindex="0"
>
	<div :class="$style.avatarColumn">
		<MkAvatar :class="$style.avatar" :user="appearNote.user" link preview/>
		<div v-if="connected" :class="$style.threadLine" aria-hidden="true"></div>
	</div>

	<div :class="$style.main">
		<TwitterNoteHeader :note="appearNote">
			<template v-if="actionsVisible" #menu>
				<button
					ref="menuButton"
					:class="$style.menuButton"
					class="_button"
					type="button"
					:aria-label="i18n.ts.more"
					@click.stop="showMenu"
				>
					<i class="ti ti-dots" aria-hidden="true"></i>
				</button>
			</template>
		</TwitterNoteHeader>

		<div :class="$style.content">
			<p v-if="appearNote.cw != null" :class="$style.cw">
				<Mfm v-if="appearNote.cw !== ''" :text="appearNote.cw" :author="appearNote.user" :nyaize="'respect'"/>
				<MkCwButton
					v-model="showContent"
					:text="appearNote.text"
					:renote="appearNote.renote"
					:files="appearNote.files"
					:poll="appearNote.poll"
				/>
			</p>

			<div v-show="appearNote.cw == null || showContent" :class="$style.body">
				<Mfm
					v-if="appearNote.text"
					:text="appearNote.text"
					:author="appearNote.user"
					:nyaize="'respect'"
					:emojiUrls="appearNote.emojis"
					class="_selectable"
				/>
				<div v-if="appearNote.files?.length" :class="$style.media">
					<MkMediaList :mediaList="appearNote.files" :user="appearNote.user"/>
				</div>
				<TwitterNoteQuote v-if="appearNote.renoteId" :note="appearNote.renote ?? null"/>
			</div>
		</div>

		<TwitterNoteActions
			v-if="actionsVisible"
			:note="appearNote"
			:reactionCount="$appearNote.reactionCount"
			:myReaction="$appearNote.myReaction"
			:canRenote="canRenote"
			:setRenoteButton="setRenoteButton"
			:setReactButton="setReactButton"
			@reply="reply"
			@renote="renote"
			@react="toggleReact"
			@menu="showMenu"
		/>

		<button
			v-if="canExpand && replies.length === 0 && !repliesLoading && !repliesError"
			:class="$style.showReplies"
			class="_button"
			type="button"
			@click="loadReplies"
		>
			<i class="ti ti-message-circle" aria-hidden="true"></i>{{ i18n.ts.loadReplies }}
		</button>
		<MkLoading v-else-if="repliesLoading" mini :class="$style.loading"/>
		<div v-else-if="repliesError" :class="$style.repliesError">
			<span>{{ i18n.ts.error }}</span>
			<button class="_button" type="button" @click="loadReplies">{{ i18n.ts.retry }}</button>
		</div>

		<div v-if="replies.length > 0" :class="$style.children">
			<TwitterThreadNote
				v-for="(child, index) in replies"
				:key="child.id"
				:note="child"
				:connected="index < replies.length - 1"
				:actionsVisible="true"
				:depth="depth + 1"
			/>
		</div>
		<div v-else-if="depth >= maxDepth && appearNote.repliesCount > 0" :class="$style.more">
			<MkA :to="notePage(appearNote)">{{ i18n.ts.continueThread }} <i class="ti ti-chevron-double-right" aria-hidden="true"></i></MkA>
		</div>
	</div>
</article>
<button v-else-if="muted" :class="$style.muted" class="_button" type="button" @click="muted = false">
	<I18n :src="i18n.ts.userSaysSomething" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.user.id" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
	</I18n>
</button>
</template>

<script lang="ts" setup>
import type { ComponentPublicInstance } from 'vue';
import { computed, provide, ref, shallowRef, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import { useNote } from '@/composables/use-note.js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { DI } from '@/di.js';
import type { Keymap } from '@/utility/hotkey.js';
import MkCwButton from '@/components/MkCwButton.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import TwitterNoteActions from './NoteActions.vue';
import TwitterNoteHeader from './NoteHeader.vue';
import TwitterNoteQuote from './NoteQuote.vue';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	connected?: boolean;
	actionsVisible?: boolean;
	depth?: number;
}>(), {
	connected: false,
	actionsVisible: true,
	depth: 0,
});

const rootEl = useTemplateRef('rootEl');
const menuButton = useTemplateRef('menuButton');
const renoteButton = shallowRef<HTMLElement | null>(null);
const reactButton = shallowRef<HTMLElement | null>(null);
const replies = ref<Misskey.entities.Note[]>([]);
const repliesLoading = ref(false);
const repliesError = ref(false);
const maxDepth = 3;

const {
	appearNote,
	$appearNote,
	hideByPlugin,
	isDeleted,
	showContent,
	muted,
	canRenote,
	reply,
	renote,
	toggleReact,
	reactViaMfmEmoji,
	showMenu,
	blur,
} = useNote(props, {
	rootEl,
	menuButton,
	renoteButton,
	reactButton,
});

provide(DI.mfmEmojiReactCallback, reactViaMfmEmoji);

const canExpand = computed(() => props.depth < maxDepth && props.note.repliesCount > 0);

async function loadReplies() {
	if (repliesLoading.value) return;
	repliesLoading.value = true;
	repliesError.value = false;

	try {
		replies.value = await misskeyApi('notes/children', {
			noteId: props.note.id,
			limit: 10,
		});
	} catch (error) {
		console.error(error);
		repliesError.value = true;
	} finally {
		repliesLoading.value = false;
	}
}

function setRenoteButton(element: Element | ComponentPublicInstance | null) {
	renoteButton.value = element as HTMLElement | null;
}

function setReactButton(element: Element | ComponentPublicInstance | null) {
	reactButton.value = element as HTMLElement | null;
}

const keymap = {
	'r': () => reply?.(),
	'e|a|plus': () => toggleReact?.(),
	'q': () => renote?.(),
	'm': () => showMenu?.(),
	'esc': {
		allowRepeat: true,
		callback: () => blur?.(),
	},
} as const satisfies Keymap;
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: grid;
	grid-template-columns: 40px minmax(0, 1fr);
	gap: 10px;
	min-width: 0;
	padding: 10px 16px;
	color: var(--twitter-fg);
	font-size: 14px;
	line-height: 1.4;
	border-bottom: solid 0.5px var(--twitter-border);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.avatarColumn {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	min-width: 0;
}

.avatar {
	width: 40px;
	height: 40px;
}

.threadLine {
	width: 2px;
	flex: 1;
	min-height: 8px;
	margin-top: 4px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-border);
}

.main {
	min-width: 0;
}

.content,
.body,
.cw {
	min-width: 0;
	overflow-wrap: anywhere;
}

.cw {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
	margin: 0;
}

.body {
	white-space: pre-wrap;
}

.media {
	margin-top: 8px;
}

.menuButton {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 30px;
	height: 30px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-secondary-fg);
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover, &:focus-visible {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
		color: var(--twitter-fg);
	}
}

.showReplies {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-top: 6px;
	padding: 4px 10px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-accent);
	font-size: 13px;
	font-weight: 700;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover, &:focus-visible {
		background: color-mix(in srgb, var(--twitter-accent) 10%, transparent);
	}
}

.loading {
	margin-top: 8px;
}

.repliesError {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 6px;
	color: var(--twitter-secondary-fg);
	font-size: 13px;

	button {
		padding: 2px 10px;
		border-radius: var(--twitter-radius-pill);
		color: var(--twitter-accent);
		font-weight: 700;

		&:hover, &:focus-visible {
			background: color-mix(in srgb, var(--twitter-accent) 10%, transparent);
		}
	}
}

.children {
	margin-top: 4px;
	padding-left: 4px;
}

.more {
	margin-top: 6px;

	a {
		color: var(--twitter-accent);
		font-size: 13px;
		font-weight: 700;
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}
}

.muted {
	display: block;
	width: 100%;
	padding: 12px 16px;
	color: var(--twitter-secondary-fg);
	border-bottom: solid 0.5px var(--twitter-border);
}

.muted {
	cursor: pointer;
}

@media (max-width: 500px) {
	.root {
		grid-template-columns: 36px minmax(0, 1fr);
		gap: 8px;
		padding: 10px 12px;
	}

	.avatar {
		width: 36px;
		height: 36px;
	}

	.children {
		padding-left: 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.root,
	.menuButton,
	.showReplies {
		transition: none;
	}
}
</style>
