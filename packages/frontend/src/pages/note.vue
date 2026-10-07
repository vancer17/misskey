<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component :is="detailComponent">
	<div
		:class="isTwitterUi ? $style.twitterBody : '_spacer'"
		:style="isTwitterUi ? undefined : { '--MI_SPACER-w': '800px' }"
	>
		<Transition :name="prefer.s.animation ? 'fade' : ''" mode="out-in">
			<div v-if="note">
				<div v-if="showNext" :class="isTwitterUi ? $style.twitterContext : $style.context">
					<MkNotesTimeline direction="up" :withControl="false" :pullToRefresh="false" :paginator="showNext === 'channel' ? nextChannelPaginator : nextUserPaginator" :noGap="true" :forceDisableInfiniteScroll="true" :variant="isTwitterUi ? 'twitter' : 'misskey'"/>
				</div>

				<div :class="isTwitterUi ? $style.twitterMain : $style.context">
					<div v-if="!showNext" :class="[$style.loadNext, { [$style.twitterLoadRow]: isTwitterUi }]">
						<div class="_buttons">
							<MkButton v-if="note.channelId" rounded :class="$style.loadButton" @click="showNext = 'channel'"><i class="ti ti-chevron-up"></i> <i class="ti ti-device-tv"></i></MkButton>
							<MkButton rounded :class="$style.loadButton" @click="showNext = 'user'"><i class="ti ti-chevron-up"></i> <i class="ti ti-user"></i></MkButton>
						</div>
					</div>

					<div :class="isTwitterUi ? $style.twitterDetail : ['_margin', '_gaps_s']">
						<MkRemoteCaution v-if="note.user.host != null" :href="note.url ?? note.uri"/>
						<TwitterNoteDetail
							v-if="isTwitterUi"
							:key="note.id + ':' + (initialTab ?? 'replies')"
							:note="note"
							:initialTab="initialTab"
						/>
						<MkNoteDetailed v-else :key="note.id" v-model:note="note" :initialTab="initialTab" :class="$style.note"/>
					</div>

					<div v-if="clips && clips.length > 0" :class="isTwitterUi ? $style.twitterClips : $style.clips">
						<div style="font-weight: bold; padding: 12px;">{{ i18n.ts.clip }}</div>
						<div class="_gaps">
							<MkClipPreview v-for="item in clips" :key="item.id" :clip="item"/>
						</div>
					</div>
					<div v-if="!showPrev" :class="[$style.loadPrev, { [$style.twitterLoadRow]: isTwitterUi }]">
						<div class="_buttons">
							<MkButton v-if="note.channelId" rounded :class="$style.loadButton" @click="showPrev = 'channel'"><i class="ti ti-chevron-down"></i> <i class="ti ti-device-tv"></i></MkButton>
							<MkButton rounded :class="$style.loadButton" @click="showPrev = 'user'"><i class="ti ti-chevron-down"></i> <i class="ti ti-user"></i></MkButton>
						</div>
					</div>
				</div>

				<div v-if="showPrev" :class="isTwitterUi ? $style.twitterContext : $style.context">
					<MkNotesTimeline :withControl="false" :pullToRefresh="false" :paginator="showPrev === 'channel' ? prevChannelPaginator : prevUserPaginator" :noGap="true" :variant="isTwitterUi ? 'twitter' : 'misskey'"/>
				</div>
			</div>
			<TwitterPageState v-else-if="isTwitterUi && error" :type="errorStateType" @retry="fetchNote()"/>
			<MkError v-else-if="error" @retry="fetchNote()"/>
			<TwitterPageSkeleton v-else-if="isTwitterUi" variant="detail"/>
			<MkLoading v-else/>
		</Transition>
	</div>
</component>
</template>

<script lang="ts" setup>
import { computed, watch, ref, markRaw, inject } from 'vue';
import * as Misskey from 'misskey-js';
import { host } from '@@/js/config.js';
import PageWithHeader from '@/components/global/PageWithHeader.vue';
import MkNoteDetailed from '@/components/MkNoteDetailed.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkRemoteCaution from '@/components/MkRemoteCaution.vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { dateString } from '@/filters/date.js';
import MkClipPreview from '@/components/MkClipPreview.vue';
import TwitterNoteDetail from '@/ui/twitter/NoteDetail.vue';
import TwitterNoteDetailShell from '@/ui/twitter/NoteDetailShell.vue';
import TwitterPageState from '@/ui/twitter/components/TwitterPageState.vue';
import TwitterPageSkeleton from '@/ui/twitter/components/TwitterPageSkeleton.vue';
import type { TwitterPageStateType } from '@/ui/twitter/domain/page-state.js';
import { prefer } from '@/preferences.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
import { serverContext, assertServerContext } from '@/server-context.js';
import { $i } from '@/i.js';
import { Paginator } from '@/utility/paginator.js';
import { DI } from '@/di.js';

// contextは非ログイン状態の情報しかないためログイン時は利用できない
const CTX_NOTE = !$i && assertServerContext(serverContext, 'note') ? serverContext.note : null;

const props = defineProps<{
	noteId: string;
	initialTab?: string;
}>();

const note = ref<null | Misskey.entities.Note>(CTX_NOTE);
const clips = ref<Misskey.entities.Clip[]>();
const showPrev = ref<'user' | 'channel' | false>(false);
const showNext = ref<'user' | 'channel' | false>(false);
const initialTab = computed<'reactions' | 'replies' | 'renotes' | undefined>(() => {
	if (['reactions', 'replies', 'renotes'].includes(props.initialTab ?? '')) {
		return props.initialTab as 'reactions' | 'replies' | 'renotes';
	}
	return undefined;
});
const error = ref();

/**
 * 判定取帖错误是否为"帖子不存在"（404 语义）。
 *
 * @param err notes/show 返回的错误对象
 * @returns 帖子不存在时返回 true（呈现 notFound 终态，不提供重试）
 */
function isNoSuchNoteError(err: unknown): boolean {
	const maybeApiError = err as { id?: unknown } | null | undefined;
	return maybeApiError?.id === '24fcbfc6-2e37-42b6-8388-c29b3861a08d';
}

/** Twitter UI 终态派生：实体不存在 → notFound，其余错误 → error（可重试）。 */
const errorStateType = computed<TwitterPageStateType>(() => isNoSuchNoteError(error.value) ? 'notFound' : 'error');
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');
const detailComponent = computed(() => isTwitterUi.value ? TwitterNoteDetailShell : PageWithHeader);

const prevUserPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	initialId: props.noteId,
	computedParams: computed(() => note.value ? ({
		userId: note.value.userId,
	}) : undefined),
}));

const nextUserPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	initialId: props.noteId,
	initialDirection: 'newer',
	computedParams: computed(() => note.value ? ({
		userId: note.value.userId,
	}) : undefined),
}));

const prevChannelPaginator = markRaw(new Paginator('channels/timeline', {
	limit: 10,
	initialId: props.noteId,
	computedParams: computed(() => note.value && note.value.channelId != null ? ({
		channelId: note.value.channelId,
	}) : undefined),
}));

const nextChannelPaginator = markRaw(new Paginator('channels/timeline', {
	limit: 10,
	initialId: props.noteId,
	initialDirection: 'newer',
	computedParams: computed(() => note.value && note.value.channelId != null ? ({
		channelId: note.value.channelId,
	}) : undefined),
}));

function fetchNote() {
	showPrev.value = false;
	showNext.value = false;
	note.value = null;

	if (CTX_NOTE && CTX_NOTE.id === props.noteId) {
		note.value = CTX_NOTE;
		return;
	}

	misskeyApi('notes/show', {
		noteId: props.noteId,
	}).then(res => {
		note.value = res;
		const appearNote = getAppearNote(res) ?? res;
		// 古いノートは被クリップ数をカウントしていないので、2023-10-01以前のものは強制的にnotes/clipsを叩く
		if ((appearNote.clippedCount ?? 0) > 0 || new Date(appearNote.createdAt).getTime() < new Date('2023-10-01').getTime()) {
			misskeyApi('notes/clips', {
				noteId: appearNote.id,
			}).then((_clips) => {
				clips.value = _clips;
			});
		}
	}).catch(err => {
		if (['fbcc002d-37d9-4944-a6b0-d9e29f2d33ab', '145f88d2-b03d-4087-8143-a78928883c4b'].includes(err.id)) {
			pleaseLogin({
				path: '/',
				message: err.id === 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' ? i18n.ts.thisContentsAreMarkedAsSigninRequiredByAuthor : i18n.ts.signinOrContinueOnRemote,
				openOnRemote: {
					type: 'lookup',
					url: `https://${host}/notes/${props.noteId}`,
				},
			});
		}
		error.value = err;
	});
}

watch(() => props.noteId, fetchNote, {
	immediate: true,
});

definePage(() => ({
	title: i18n.ts.note,
	...note.value ? {
		subtitle: dateString(note.value.createdAt),
		avatar: note.value.user,
		path: `/notes/${note.value.id}`,
		share: {
			title: i18n.tsx.noteOf({ user: note.value.user.name ?? note.value.user.username }),
			text: note.value.text,
		},
	} : {},
}));
</script>

<style lang="scss" module>
.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.125s ease;
}
.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}

.context,
.clips {
	margin: var(--MI-margin);
}

.loadNext,
.loadPrev {
	display: flex;
	justify-content: center;
}

.loadNext {
	margin-bottom: var(--MI-margin);
}

.loadPrev {
	margin-top: var(--MI-margin);
}

.loadButton {
	min-width: 0;
}

.note {
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.twitterBody {
	min-height: 100%;
	background: var(--twitter-bg);
}

.twitterContext {
	border-bottom: solid 0.5px var(--twitter-border);
}

.twitterMain {
	min-width: 0;
	background: var(--twitter-bg);
}

.twitterLoadRow {
	display: flex;
	justify-content: center;
	padding: 10px 16px;
	border-bottom: solid 0.5px var(--twitter-border);
}

.twitterDetail {
	min-width: 0;
}

.twitterClips {
	min-width: 0;
	border-bottom: solid 0.5px var(--twitter-border);

	> div:last-child {
		padding-bottom: 16px;
	}
}

</style>
