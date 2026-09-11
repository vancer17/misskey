<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	v-if="!isDeleted && !hardMuted && !hideByPlugin && muted === false"
	ref="rootEl"
	v-hotkey="keymap"
	:class="[$style.root, { [$style.embedded]: embedded }]"
	tabindex="0"
>
	<div v-if="pinned" :class="$style.context">
		<i class="ti ti-pin" aria-hidden="true"></i>{{ i18n.ts.pinnedNote }}
	</div>

	<template v-if="isRenote">
		<TwitterNoteRepostLabel :note="note" :mock="mock">
			<template #menu>
				<button
					ref="renoteTime"
					:class="$style.contextButton"
					class="_button"
					type="button"
					:aria-label="i18n.ts.more"
					@click.stop="showRenoteMenu"
				>
					<i class="ti ti-dots" aria-hidden="true"></i>
				</button>
			</template>
		</TwitterNoteRepostLabel>

		<div v-if="note.renote == null" :class="$style.deleted">
			{{ i18n.ts.deletedNote }}
		</div>
		<button
			v-else-if="renoteCollapsed"
			:class="$style.collapsedRenote"
			class="_button"
			type="button"
			@click="renoteCollapsed = false"
		>
			<MkAvatar :class="$style.collapsedAvatar" :user="appearNote.user" :link="!mock" :preview="!mock"/>
			<span :class="$style.collapsedText">
				<Mfm
					:text="getNoteSummary(appearNote)"
					:plain="true"
					:nowrap="true"
					:author="appearNote.user"
					:nyaize="'respect'"
				/>
			</span>
		</button>
		<TwitterNote
			v-else
			:note="note.renote"
			:mock="mock"
			:withHardMute="withHardMute"
			embedded
			:actionsVisible="true"
		/>
	</template>

	<article
		v-else
		:class="$style.article"
		@contextmenu.stop="onContextmenu"
	>
		<div :class="$style.avatarColumn">
			<MkAvatar
				:class="$style.avatar"
				:user="appearNote.user"
				:link="!mock"
				:preview="!mock"
			/>
			<div v-if="embedded" :class="$style.threadLine" aria-hidden="true"></div>
		</div>

		<div :class="$style.main">
			<TwitterNoteHeader :note="appearNote" :mock="mock">
				<template #menu>
					<button
						ref="menuButton"
						:class="$style.contextButton"
						class="_button"
						type="button"
						:aria-label="i18n.ts.more"
						@click.stop="showMenu"
					>
						<i class="ti ti-dots" aria-hidden="true"></i>
					</button>
				</template>
			</TwitterNoteHeader>

			<MkInstanceTicker
				v-if="showTicker"
				:class="$style.ticker"
				:host="appearNote.user.host"
				:instance="appearNote.user.instance"
			/>

			<div v-if="appearNote.replyId" :class="$style.replyContext">
				<i class="ti ti-arrow-back-up" aria-hidden="true"></i>
				<Mfm
					v-if="appearNote.reply"
					:text="`@${appearNote.reply.user.username}`"
					:plain="true"
					:author="appearNote.reply.user"
				/>
				<MkA v-else :to="`/notes/${appearNote.replyId}`">{{ i18n.ts.reply }}</MkA>
			</div>

			<div :class="$style.contentContainer">
				<p v-if="appearNote.cw != null" :class="$style.cw">
					<span :class="$style.cwText">
						<Mfm
							v-if="appearNote.cw !== ''"
							:text="appearNote.cw"
							:author="appearNote.user"
							:nyaize="'respect'"
							:enableEmojiMenu="true"
							:enableEmojiMenuReaction="true"
						/>
					</span>
					<MkCwButton
						v-model="showContent"
						:text="appearNote.text"
						:renote="appearNote.renote"
						:files="appearNote.files"
						:poll="appearNote.poll"
					/>
				</p>

				<div v-show="appearNote.cw == null || showContent">
					<div :class="$style.text">
						<span v-if="appearNote.isHidden" :class="$style.private">({{ i18n.ts.private }})</span>
						<Mfm
							v-if="appearNote.text"
							:parsedNodes="parsed"
							:text="appearNote.text"
							:author="appearNote.user"
							:nyaize="'respect'"
							:emojiUrls="appearNote.emojis"
							:enableEmojiMenu="true"
							:enableEmojiMenuReaction="true"
							class="_selectable"
						/>
					</div>

					<div v-if="translating || translation" :class="$style.translation">
						<MkLoading v-if="translating" mini/>
						<template v-else-if="translation">
							<b>{{ i18n.tsx.translatedFrom({ x: translation.sourceLang }) }}: </b>
							<Mfm
								:text="translation.text"
								:author="appearNote.user"
								:nyaize="'respect'"
								:emojiUrls="appearNote.emojis"
								class="_selectable"
							/>
						</template>
					</div>

					<div v-if="appearNote.files?.length" :class="$style.media">
						<MkMediaList ref="galleryEl" :mediaList="appearNote.files" :user="appearNote.user"/>
					</div>

					<MkPoll
						v-if="appearNote.poll"
						:class="$style.poll"
						:noteId="appearNote.id"
						:multiple="appearNote.poll.multiple"
						:expiresAt="appearNote.poll.expiresAt"
						:choices="$appearNote.pollChoices"
						:author="appearNote.user"
					/>

					<template v-if="isEnabledUrlPreview">
						<MkUrlPreview
							v-for="url in urls"
							:key="url"
							:class="$style.urlPreview"
							:url="url"
							compact
							:detail="false"
						/>
					</template>

					<TwitterNoteQuote v-if="appearNote.renoteId" :note="appearNote.renote ?? null"/>

					<div v-if="isLong" :class="{ [$style.collapsed]: collapsed }">
						<button
							v-if="collapsed"
							:class="$style.collapsedButton"
							class="_button"
							type="button"
							@click="collapsed = false"
						>{{ i18n.ts.showMore }}</button>
						<button
							v-else
							:class="$style.showLessButton"
							class="_button"
							type="button"
							@click="collapsed = true"
						>{{ i18n.ts.showLess }}</button>
					</div>
				</div>

				<MkA
					v-if="appearNote.channel && !inChannel"
					:class="$style.channel"
					:to="`/channels/${appearNote.channel.id}`"
				>
					<i class="ti ti-device-tv" aria-hidden="true"></i>{{ appearNote.channel.name }}
				</MkA>
			</div>

			<MkReactionsViewer
				v-if="appearNote.reactionAcceptance !== 'likeOnly'"
				:class="$style.reactions"
				:reactions="$appearNote.reactions"
				:reactionEmojis="$appearNote.reactionEmojis"
				:myReaction="$appearNote.myReaction"
				:noteId="appearNote.id"
				:maxNumber="16"
				@mockUpdateMyReaction="emitUpdReaction"
			>
				<template #more>
					<MkA :to="`/notes/${appearNote.id}/reactions`">{{ i18n.ts.more }}</MkA>
				</template>
			</MkReactionsViewer>

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
				@react="handleToggleReact"
				@menu="showMenu"
			/>
		</div>
	</article>
</div>

<div v-else-if="!isDeleted && !hardMuted && !hideByPlugin" :class="$style.muted" @click="muted = false">
	<I18n v-if="muted === 'sensitiveMute'" :src="i18n.ts.userSaysSomethingSensitive" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
	</I18n>
	<I18n v-else-if="isMutedContextVisible" :src="i18n.ts.userSaysSomething" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
	</I18n>
	<I18n v-else :src="i18n.ts.userSaysSomethingAbout" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
		<template #word>
			{{ Array.isArray(muted) ? muted.map(words => Array.isArray(words) ? words.join() : words).slice(0, 3).join(' ') : muted }}
		</template>
	</I18n>
</div>

<div v-else></div>
</template>

<script lang="ts" setup>
import type { ComponentPublicInstance } from 'vue';
import { computed, inject, provide, ref, shallowRef, useTemplateRef } from 'vue';
import type { Ref } from 'vue';
import * as Misskey from 'misskey-js';
import { useNote } from '@/composables/use-note.js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';
import { userPage } from '@/filters/user.js';
import { getNoteSummary } from '@/utility/get-note-summary.js';
import { isEnabledUrlPreview } from '@/utility/url-preview.js';
import { focusPrev, focusNext } from '@/utility/focus.js';
import { DI } from '@/di.js';
import type { Keymap } from '@/utility/hotkey.js';
import MkCwButton from '@/components/MkCwButton.vue';
import MkInstanceTicker from '@/components/MkInstanceTicker.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkPoll from '@/components/MkPoll.vue';
import MkReactionsViewer from '@/components/MkReactionsViewer.vue';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import TwitterNoteActions from './NoteActions.vue';
import TwitterNoteHeader from './NoteHeader.vue';
import TwitterNoteQuote from './NoteQuote.vue';
import TwitterNoteRepostLabel from './NoteRepostLabel.vue';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	pinned?: boolean;
	mock?: boolean;
	withHardMute?: boolean;
	embedded?: boolean;
	actionsVisible?: boolean;
}>(), {
	pinned: false,
	mock: false,
	withHardMute: false,
	embedded: false,
	actionsVisible: true,
});

const emit = defineEmits<{
	(ev: 'reaction', emoji: string): void;
	(ev: 'removeReaction', emoji: string): void;
}>();

provide(DI.mock, props.mock);

const inTimeline = inject<boolean>('inTimeline', false);
const tl_withSensitive = inject<Ref<boolean>>('tl_withSensitive', ref(true));
const inChannel = inject(DI.inChannel, null);
const currentClip = inject<Ref<Misskey.entities.Clip> | null>('currentClip', null);
const currentAntenna = inject<Ref<Misskey.entities.Antenna> | null>('currentAntenna', null);

const rootEl = useTemplateRef('rootEl');
const menuButton = useTemplateRef('menuButton');
const renoteButton = shallowRef<HTMLElement | null>(null);
const renoteTime = useTemplateRef('renoteTime');
const reactButton = shallowRef<HTMLElement | null>(null);
const clipButton = shallowRef<HTMLElement | null>(null);
const galleryEl = useTemplateRef<InstanceType<typeof MkMediaList>>('galleryEl');

const {
	note,
	appearNote,
	$appearNote,
	hideByPlugin,
	isRenote,
	showContent,
	isDeleted,
	translating,
	translation,
	muted,
	hardMuted,
	collapsed,
	renoteCollapsed,
	parsed,
	urls,
	isLong,
	showTicker,
	canRenote,
	renote,
	reply,
	react,
	reactViaMfmEmoji,
	toggleReact,
	onContextmenu,
	showMenu,
	clip,
	showRenoteMenu,
	blur,
} = useNote(props, {
	rootEl,
	menuButton,
	renoteButton,
	renoteTime,
	reactButton,
	clipButton,
}, {
	inTimeline,
	tl_withSensitive,
	inChannel,
	currentClip,
	currentAntenna,
});

provide(DI.mfmEmojiReactCallback, reactViaMfmEmoji);

const isMutedContextVisible = computed(() => muted.value === 'sensitiveMute' || prefer.s.showSoftWordMutedWord !== true);

function handleToggleReact() {
	toggleReact((reaction) => {
		if ($appearNote.myReaction === reaction) {
			emit('removeReaction', reaction);
		} else {
			emit('reaction', reaction);
			$appearNote.reactions[reaction] = 1;
			$appearNote.reactionCount++;
			$appearNote.myReaction = reaction;
		}
	});
}

function emitUpdReaction(emoji: string, delta: number) {
	if (delta < 0) {
		emit('removeReaction', emoji);
	} else if (delta > 0) {
		emit('reaction', emoji);
	}
}

function setRenoteButton(element: Element | ComponentPublicInstance | null) {
	renoteButton.value = element as HTMLElement | null;
}

function setReactButton(element: Element | ComponentPublicInstance | null) {
	reactButton.value = element as HTMLElement | null;
}

const keymap = {
	'r': () => reply(),
	'e|a|plus': () => react(),
	'q': () => renote(),
	'm': () => showMenu(),
	'c': () => {
		if (!prefer.s.showClipButtonInNoteFooter || clipButton.value == null) return;
		clip();
	},
	'o': () => galleryEl.value?.openGallery(),
	'v|enter': () => {
		if (appearNote.cw != null) {
			showContent.value = !showContent.value;
		} else if (isLong) {
			collapsed.value = !collapsed.value;
		}
	},
	'esc': {
		allowRepeat: true,
		callback: () => blur(),
	},
	'up|k|shift+tab': {
		allowRepeat: true,
		callback: () => focusPrev(rootEl.value),
	},
	'down|j|tab': {
		allowRepeat: true,
		callback: () => focusNext(rootEl.value),
	},
} as const satisfies Keymap;
</script>

<style lang="scss" module>
.root {
	position: relative;
	min-width: 0;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
	font-size: 15px;
	line-height: 1.4;
	transition: background-color var(--twitter-duration-fast) ease;

	&:focus-visible {
		outline: none;

		&::after {
			content: "";
			position: absolute;
			inset: 0;
			border: solid 2px var(--twitter-accent);
			pointer-events: none;
		}
	}

	&:not(.embedded) {
		border-bottom: solid 0.5px var(--twitter-border);

		&:hover {
			background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
		}
	}
}

.embedded {
	background: transparent;
	font-size: 15px;
}

.context {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 10px 16px 0 calc(16px + 16px);
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	font-weight: 700;
}

.contextButton {
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

.deleted {
	padding: 16px;
	color: var(--twitter-secondary-fg);
	text-align: center;
}

.collapsedRenote {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 12px 16px;
	text-align: left;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
	}
}

.collapsedAvatar {
	flex-shrink: 0;
	width: 40px;
	height: 40px;
}

.collapsedText {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.article {
	position: relative;
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr);
	gap: 12px;
	padding: 12px 16px;

	@media (max-width: 500px) {
		grid-template-columns: 40px minmax(0, 1fr);
		gap: 10px;
		padding: 12px;
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
	width: 44px;
	height: 44px;

	@media (max-width: 500px) {
		width: 40px;
		height: 40px;
	}
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

.ticker {
	margin-top: 4px;
}

.replyContext {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 2px;
	color: var(--twitter-secondary-fg);
	font-size: 14px;

	a {
		color: var(--twitter-accent);
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}
}

.contentContainer {
	container-type: inline-size;
	min-width: 0;
}

.cw {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin: 0 0 6px;
}

.cwText {
	min-width: 0;
	overflow-wrap: anywhere;
}

.text {
	min-width: 0;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.private {
	opacity: 0.55;
}

.translation {
	margin-top: 8px;
	padding: 8px 10px;
	border-radius: var(--twitter-radius-medium);
	background: color-mix(in srgb, var(--twitter-fg) 5%, transparent);
}

.media {
	margin-top: 10px;
	border-radius: var(--twitter-radius-large);
	overflow: clip;
}

.poll,
.urlPreview {
	margin-top: 10px;
}

.channel,
.reactions {
	margin-top: 8px;
}

.channel {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: var(--twitter-accent);
	font-size: 14px;
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.collapsed {
	position: relative;
	overflow: hidden;
	max-height: 320px;

	&::after {
		content: "";
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		height: 96px;
		background: linear-gradient(to bottom, transparent, var(--twitter-bg));
		pointer-events: none;
	}
}

.collapsedButton,
.showLessButton {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	min-height: 44px;
	color: var(--twitter-accent);
	font-weight: 700;

	&:hover {
		background: color-mix(in srgb, var(--twitter-accent) 7%, transparent);
	}
}

.collapsedButton {
	position: absolute;
	inset-inline: 0;
	bottom: 0;
	z-index: 1;
	background: linear-gradient(to bottom, transparent, var(--twitter-bg) 72%);
}

.showLessButton {
	margin-top: 4px;
	border-top: solid 0.5px var(--twitter-border);
}

.muted {
	padding: 14px 16px;
	border-bottom: solid 0.5px var(--twitter-border);
	color: var(--twitter-secondary-fg);
	cursor: pointer;

	@media (max-width: 500px) {
		padding: 14px 12px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.root,
	.contextButton,
	.collapsedRenote {
		transition-duration: 0.01ms;
	}
}
</style>
