<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="muted === false && !hideByPlugin && !isDeleted" :class="$style.root">
	<div v-if="conversationLoading" :class="$style.contextLoading"><MkLoading mini/></div>
	<div v-else-if="conversationError" :class="$style.contextError">
		<span>{{ i18n.ts.error }}</span>
		<button class="_button" type="button" @click="loadConversation">{{ i18n.ts.retry }}</button>
	</div>
	<template v-else>
		<TwitterThreadNote
			v-for="ancestor in conversation"
			:key="ancestor.id"
			:note="ancestor"
				:connected="true"
				:actionsVisible="false"
			/>
	</template>

	<TwitterNoteRepostLabel v-if="isRenote" :note="note">
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

	<div v-if="isRenote && note.renote == null" :class="$style.deleted">
		{{ i18n.ts.deletedNote }}
	</div>

	<article v-else ref="rootEl" v-hotkey="keymap" :class="$style.article" tabindex="0">
		<header :class="$style.header">
			<MkAvatar :class="$style.avatar" :user="appearNote.user" link preview/>
			<div :class="$style.identity">
				<div :class="$style.nameRow">
					<MkA
						v-user-preview="appearNote.user.id"
						:class="$style.name"
						:to="userPage(appearNote.user)"
					>
						<MkUserName :user="appearNote.user" :nowrap="false"/>
					</MkA>
					<span v-if="appearNote.user.isBot" :class="$style.bot">{{ i18n.ts.bot }}</span>
					<span
						v-for="(role, index) in appearNote.user.badgeRoles"
						:key="index"
						v-tooltip="role.name"
						:class="$style.badgeRole"
					>
						<img v-if="role.iconUrl" :src="role.iconUrl" :alt="role.name">
					</span>
				</div>
				<div :class="$style.acct"><MkAcct :user="appearNote.user"/></div>
			</div>
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
		</header>

		<MkInstanceTicker
			v-if="showTicker"
			:class="$style.ticker"
			:host="appearNote.user.host"
			:instance="appearNote.user.instance"
		/>

		<div :class="$style.content">
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
						:detail="true"
					/>
				</template>

				<TwitterNoteQuote v-if="appearNote.renoteId" :note="appearNote.renote ?? null"/>
			</div>

			<MkA
				v-if="appearNote.channel && !inChannel"
				:class="$style.channel"
				:to="`/channels/${appearNote.channel.id}`"
			>
				<i class="ti ti-device-tv" aria-hidden="true"></i>{{ appearNote.channel.name }}
			</MkA>
		</div>

		<div :class="$style.meta">
			<span><MkTime :time="appearNote.createdAt" mode="detail"/></span>
			<span aria-hidden="true">·</span>
			<span :title="i18n.ts._visibility[appearNote.visibility]">
				<i :class="visibilityIcon" aria-hidden="true"></i>{{ i18n.ts._visibility[appearNote.visibility] }}
			</span>
			<span
				v-if="appearNote.localOnly"
				:title="i18n.ts._visibility['disableFederation']"
			>
				<i class="ti ti-rocket-off" aria-hidden="true"></i>{{ i18n.ts._visibility['disableFederation'] }}
			</span>
		</div>

		<div :class="$style.stats">
			<button
				class="_button"
				:class="$style.stat"
				type="button"
				:aria-current="tab === 'replies' ? 'true' : undefined"
				@click="tab = 'replies'"
			>
				<strong>{{ number(appearNote.repliesCount) }}</strong>{{ i18n.ts.replies }}
			</button>
			<button
				class="_button"
				:class="$style.stat"
				type="button"
				:aria-current="tab === 'renotes' ? 'true' : undefined"
				@click="tab = 'renotes'"
			>
				<strong>{{ number(appearNote.renoteCount) }}</strong>{{ i18n.ts.renotes }}
			</button>
			<button
				class="_button"
				:class="$style.stat"
				type="button"
				:aria-current="tab === 'reactions' ? 'true' : undefined"
				@click="tab = 'reactions'"
			>
				<strong>{{ number($appearNote.reactionCount) }}</strong>{{ i18n.ts.reactions }}
			</button>
		</div>

		<MkReactionsViewer
			v-if="appearNote.reactionAcceptance !== 'likeOnly'"
			:class="$style.reactions"
			:reactions="$appearNote.reactions"
			:reactionEmojis="$appearNote.reactionEmojis"
			:myReaction="$appearNote.myReaction"
			:noteId="appearNote.id"
			:maxNumber="16"
		>
			<template #more>
				<button type="button" @click.stop="tab = 'reactions'">{{ i18n.ts.more }}</button>
			</template>
		</MkReactionsViewer>

		<TwitterNoteActions
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
	</article>

	<div :class="$style.results">
		<div v-if="tab === 'replies'">
			<div v-if="repliesLoading" :class="$style.loading"><MkLoading/></div>
			<TwitterTimelineState
				v-else-if="repliesError"
				type="error"
				@retry="loadReplies"
			/>
			<TwitterTimelineState v-else-if="repliesLoaded && replies.length === 0"/>
			<TwitterThreadNote
				v-for="(replyNote, index) in replies"
				:key="replyNote.id"
				:note="replyNote"
				:connected="index < replies.length - 1"
				:actionsVisible="true"
			/>
		</div>

		<div v-else-if="tab === 'renotes'" :class="$style.people">
			<MkPagination :paginator="renotesPaginator" :forceDisableInfiniteScroll="true">
				<template #default="{ items }">
					<MkA
						v-for="item in items"
						:key="item.id"
						:class="$style.person"
						:to="userPage(item.user)"
					>
						<MkUserCardMini :user="item.user" :withChart="false"/>
					</MkA>
				</template>
			</MkPagination>
		</div>

		<div v-else :class="$style.people">
			<div v-if="reactionTypes.length > 0" :class="$style.reactionTabs">
				<button
					v-for="reaction in reactionTypes"
					:key="reaction"
					:class="[$style.reactionTab, { [$style.reactionTabActive]: reactionTabType === reaction }]"
					class="_button"
					type="button"
					@click="reactionTabType = reaction"
				>
					<MkReactionIcon :reaction="reaction"/>
					<span>{{ $appearNote.reactions[reaction] }}</span>
				</button>
			</div>
			<MkPagination
				v-if="reactionTabType"
				:key="reactionTabType"
				:paginator="reactionsPaginator"
				:forceDisableInfiniteScroll="true"
			>
				<template #default="{ items }">
					<MkA
						v-for="item in items"
						:key="item.id"
						:class="$style.person"
						:to="userPage(item.user)"
					>
						<MkUserCardMini :user="item.user" :withChart="false"/>
					</MkA>
				</template>
			</MkPagination>
		</div>
	</div>
</div>
<button v-else-if="!isDeleted && !hideByPlugin" :class="$style.muted" class="_button" type="button" @click="muted = false">
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
import { computed, inject, markRaw, onMounted, provide, ref, shallowRef, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { useNote } from '@/composables/use-note.js';
import { i18n } from '@/i18n.js';
import { userPage } from '@/filters/user.js';
import { isEnabledUrlPreview } from '@/utility/url-preview.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import number from '@/filters/number.js';
import { Paginator } from '@/utility/paginator.js';
import { DI } from '@/di.js';
import type { Keymap } from '@/utility/hotkey.js';
import MkCwButton from '@/components/MkCwButton.vue';
import MkInstanceTicker from '@/components/MkInstanceTicker.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkPoll from '@/components/MkPoll.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkReactionsViewer from '@/components/MkReactionsViewer.vue';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import TwitterNoteActions from './NoteActions.vue';
import TwitterNoteQuote from './NoteQuote.vue';
import TwitterNoteRepostLabel from './NoteRepostLabel.vue';
import TwitterThreadNote from './ThreadNote.vue';
import TwitterTimelineState from './TimelineState.vue';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	initialTab?: 'replies' | 'renotes' | 'reactions';
}>(), {
	initialTab: 'replies',
});

const inChannel = inject(DI.inChannel, null);
const rootEl = useTemplateRef('rootEl');
const menuButton = useTemplateRef('menuButton');
const renoteButton = shallowRef<HTMLElement | null>(null);
const renoteTime = useTemplateRef('renoteTime');
const reactButton = shallowRef<HTMLElement | null>(null);
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
	parsed,
	urls,
	showTicker,
	canRenote,
	renote,
	reply,
	react,
	reactViaMfmEmoji,
	toggleReact,
	showMenu,
	showRenoteMenu,
	blur,
} = useNote(props, {
	rootEl,
	menuButton,
	renoteButton,
	renoteTime,
	reactButton,
}, {
	inChannel,
});

provide(DI.mfmEmojiReactCallback, reactViaMfmEmoji);

const tab = ref(props.initialTab);
const reactionTabType = ref<string | null>(null);
const conversation = ref<Misskey.entities.Note[]>([]);
const conversationLoading = ref(false);
const conversationError = ref(false);
const replies = ref<Misskey.entities.Note[]>([]);
const repliesLoaded = ref(false);
const repliesLoading = ref(false);
const repliesError = ref(false);

const renotesPaginator = markRaw(new Paginator('notes/renotes', {
	limit: 10,
	params: {
		noteId: appearNote.id,
	},
}));

const reactionsPaginator = markRaw(new Paginator('notes/reactions', {
	limit: 10,
	computedParams: computed(() => ({
		noteId: appearNote.id,
		type: reactionTabType.value,
	})),
}));

const reactionTypes = computed(() => Object.keys($appearNote.reactions));
const visibilityIcon = computed(() => {
	if (appearNote.visibility === 'home') return 'ti ti-home';
	if (appearNote.visibility === 'followers') return 'ti ti-lock';
	if (appearNote.visibility === 'specified') return 'ti ti-mail';
	return 'ti ti-world';
});

watch(reactionTypes, (types) => {
	if (reactionTabType.value == null || !types.includes(reactionTabType.value)) {
		reactionTabType.value = types[0] ?? null;
	}
}, {
	immediate: true,
});

onMounted(() => {
	loadConversation();
	loadReplies();
});

async function loadConversation() {
	conversation.value = [];

	if (appearNote.replyId == null) return;

	conversationLoading.value = true;
	conversationError.value = false;

	try {
		const ancestors = await misskeyApi('notes/conversation', {
			noteId: appearNote.id,
		});
		conversation.value = ancestors.reverse();
	} catch (error) {
		console.error(error);
		conversationError.value = true;
	} finally {
		conversationLoading.value = false;
	}
}

async function loadReplies() {
	if (repliesLoading.value) return;

	repliesLoading.value = true;
	repliesError.value = false;

	try {
		replies.value = await misskeyApi('notes/children', {
			noteId: appearNote.id,
			limit: 30,
		});
		repliesLoaded.value = true;
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
	'r': () => reply(),
	'e|a|plus': () => react(),
	'q': () => renote(),
	'm': () => showMenu(),
	'o': () => galleryEl.value?.openGallery(),
	'v|enter': () => {
		if (appearNote.cw != null) showContent.value = !showContent.value;
	},
	'esc': {
		allowRepeat: true,
		callback: () => blur(),
	},
} as const satisfies Keymap;
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
}

.contextLoading {
	display: flex;
	justify-content: center;
	padding: 16px;
	border-bottom: solid 0.5px var(--twitter-border);
}

.contextError {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	padding: 12px 16px;
	border-bottom: solid 0.5px var(--twitter-border);
	color: var(--twitter-secondary-fg);
	font-size: 14px;

	button {
		padding: 4px 12px;
		border-radius: var(--twitter-radius-pill);
		color: var(--twitter-accent);
		font-weight: 700;

		&:hover, &:focus-visible {
			background: color-mix(in srgb, var(--twitter-accent) 10%, transparent);
		}
	}
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

.deleted,
.muted {
	display: block;
	width: 100%;
	padding: 16px;
	color: var(--twitter-secondary-fg);
	border-bottom: solid 0.5px var(--twitter-border);
	text-align: center;
}

.muted {
	cursor: pointer;
}

.article {
	position: relative;
	min-width: 0;
	padding: 16px;
	border-bottom: solid 0.5px var(--twitter-border);

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.header {
	display: grid;
	grid-template-columns: 48px minmax(0, 1fr) 36px;
	gap: 12px;
	align-items: center;
}

.avatar {
	width: 48px;
	height: 48px;
}

.identity,
.nameRow,
.name,
.acct {
	min-width: 0;
}

.nameRow {
	display: flex;
	align-items: center;
	gap: 4px;
}

.name {
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: 15px;
	font-weight: 800;
	line-height: 1.25;
	text-decoration: none;
	text-overflow: ellipsis;
	white-space: nowrap;

	&:hover {
		text-decoration: underline;
	}
}

.bot {
	flex-shrink: 0;
	padding: 0 4px;
	border: solid 0.5px var(--twitter-border);
	border-radius: var(--twitter-radius-small);
	color: var(--twitter-secondary-fg);
	font-size: 11px;
}

.badgeRole {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;

	img {
		width: 16px;
		height: 16px;
	}
}

.acct {
	overflow: hidden;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.menuButton {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
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

.ticker {
	margin-top: 8px;
}

.content {
	min-width: 0;
	margin-top: 8px;
}

.cw,
.cwText,
.text,
.translation {
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

.replyContext {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 4px;
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

.text {
	font-size: 20px;
	line-height: 1.35;
	white-space: pre-wrap;
}

.private {
	color: var(--twitter-secondary-fg);
}

.translation {
	margin-top: 8px;
	font-size: 15px;
}

.media,
.poll,
.urlPreview {
	margin-top: 12px;
}

.channel {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	margin-top: 10px;
	color: var(--twitter-accent);
	font-size: 14px;
	font-weight: 700;
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 12px;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
}

.stats {
	display: flex;
	flex-wrap: wrap;
	gap: 20px;
	padding: 12px 0;
	border-bottom: solid 0.5px var(--twitter-border);
}

.stat {
	display: inline-flex;
	align-items: baseline;
	gap: 4px;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	transition: color var(--twitter-duration-fast) ease;

	strong {
		color: var(--twitter-fg);
		font-weight: 800;
	}

	&:hover, &:focus-visible {
		color: var(--twitter-accent);

		strong {
			color: var(--twitter-accent);
		}
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.reactions {
	margin-top: 8px;
}

.results {
	min-width: 0;
}

.loading {
	display: flex;
	justify-content: center;
	padding: 32px;
}

.people {
	padding: 12px 16px;
}

.person {
	display: block;
	margin-bottom: 8px;
	color: inherit;
	text-decoration: none;
}

.reactionTabs {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 10px;
}

.reactionTab {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px;
	border: solid 0.5px var(--twitter-border);
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-secondary-fg);
	font-size: 13px;
	transition:
		background-color var(--twitter-duration-fast) ease,
		border-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;
}

.reactionTabActive {
	border-color: var(--twitter-accent);
	color: var(--twitter-accent);
}

@media (max-width: 500px) {
	.article {
		padding: 12px;
	}

	.header {
		grid-template-columns: 40px minmax(0, 1fr) 32px;
		gap: 10px;
	}

	.avatar {
		width: 40px;
		height: 40px;
	}

	.text {
		font-size: 18px;
	}

	.people {
		padding: 10px 12px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.contextButton,
	.menuButton,
	.stat,
	.reactionTab {
		transition: none;
	}
}
</style>
