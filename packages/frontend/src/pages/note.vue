<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：帖子详情路由实体与前后文。
作用：原数据所有者处理写入与回访，不移动基础组件内部逻辑。
数据链：确认信号 → 原查询 → 当前实体／分页集合；无环境探测。
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
import type { Ref } from 'vue';
import { onBeforeUnmount } from 'vue';
import { useGlobalEvent } from '@/events.js';
import { useTwitterRefresh, useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
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

/** 当前主帖请求归属，防止快速切帖后的迟到回填。 */
let noteRequest: AbortController | null = null;
const noteLoading: Ref<boolean> = ref<boolean>(false);

/** 主帖与前后文独立加载；成功回填保留原展开状态。 */
async function loadNote(clear: boolean): Promise<boolean> {
	const noteId: string = props.noteId;
	noteRequest?.abort();
	const request: AbortController = new AbortController();
	noteRequest = request;
	noteLoading.value = true;
	if (clear) { showPrev.value = false; showNext.value = false; note.value = null; clips.value = undefined; error.value = null; }
	if (clear && CTX_NOTE?.id === noteId) {
		// 保留原匿名上下文的短路，不扩大旧 Clip 查询兼容消费者。
		note.value = CTX_NOTE; noteRequest = null; noteLoading.value = false; return true;
	}
	try {
		const fetched: Misskey.entities.Note = await misskeyApi('notes/show', { noteId }, undefined, request.signal);
		if (request.signal.aborted || noteRequest !== request || props.noteId !== noteId) return false;
		note.value = fetched;
		const appeared: Misskey.entities.Note = getAppearNote(fetched) ?? fetched;
		// 保留原存量帖的 Clip 查询兼容范围，不扩大消费者。
		if ((appeared.clippedCount ?? 0) > 0 || new Date(appeared.createdAt).getTime() < new Date('2023-10-01').getTime()) {
			const fetchedClips: Misskey.entities.Clip[] = await misskeyApi('notes/clips', { noteId: appeared.id }, undefined, request.signal);
			if (!request.signal.aborted && props.noteId === noteId) clips.value = fetchedClips;
		}
		return true;
	} catch (cause: unknown) {
		if (request.signal.aborted || props.noteId !== noteId) return false;
		const failureId: string | null = typeof cause === 'object' && cause != null && 'id' in cause && typeof cause.id === 'string' ? cause.id : null;
		if (failureId && ['fbcc002d-37d9-4944-a6b0-d9e29f2d33ab', '145f88d2-b03d-4087-8143-a78928883c4b'].includes(failureId)) {
			void pleaseLogin({ path: '/',
				message: failureId === 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' ? i18n.ts.thisContentsAreMarkedAsSigninRequiredByAuthor : i18n.ts.signinOrContinueOnRemote,
				openOnRemote: { type: 'lookup', url: `https://${host}/notes/${noteId}` },
			});
		}
		if (note.value == null) error.value = cause;
		return false;
	} finally {
		if (noteRequest === request) { noteRequest = null; noteLoading.value = false; }
	}
}

/** 首拉和手动错误重试沿用原页面入口。 */
async function fetchNote(): Promise<void> { await loadNote(true); }

watch(/** 仅实体标识切换触发首拉。 */ (): string => props.noteId, fetchNote, { immediate: true });
onBeforeUnmount(/** 取消当前页面独立实体请求。 */ (): void => { noteRequest?.abort(); });
useTwitterRefresh(/** 真实回访才重取主帖，不重建详情或清除展开态。 */ async (): Promise<boolean> => loadNote(false),
	{ busy: /** 不与首拉并发。 */ (): boolean => noteLoading.value });
/** 已展开的前后文集合分别刷新；空集合也是已执行查询。 */
const invalidatePrevUser: () => void = useTwitterPaginatorRefresh(/** 原用户前文。 */ (): typeof prevUserPaginator => prevUserPaginator, /** 用户前文已显示。 */ (): boolean => showPrev.value === 'user');
const invalidateNextUser: () => void = useTwitterPaginatorRefresh(/** 原用户后文。 */ (): typeof nextUserPaginator => nextUserPaginator, /** 用户后文已显示。 */ (): boolean => showNext.value === 'user');
const invalidatePrevChannel: () => void = useTwitterPaginatorRefresh(/** 原频道前文。 */ (): typeof prevChannelPaginator => prevChannelPaginator, /** 频道前文已显示。 */ (): boolean => showPrev.value === 'channel');
const invalidateNextChannel: () => void = useTwitterPaginatorRefresh(/** 原频道后文。 */ (): typeof nextChannelPaginator => nextChannelPaginator, /** 频道后文已显示。 */ (): boolean => showNext.value === 'channel');
useGlobalEvent('notePosted', /** 只路由失效意图，时间范围仍由前后文查询裁定。 */ (created: Misskey.entities.Note): void => {
	if (created.userId === note.value?.userId) { invalidatePrevUser(); invalidateNextUser(); }
	if (created.channelId != null && created.channelId === note.value?.channelId) { invalidatePrevChannel(); invalidateNextChannel(); }
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
	border-bottom: solid 1px var(--twitter-border);
}

.twitterMain {
	min-width: 0;
	background: var(--twitter-bg);
}

.twitterLoadRow {
	display: flex;
	justify-content: center;
	padding: 10px 16px;
	border-bottom: solid 1px var(--twitter-border);
}

.twitterDetail {
	min-width: 0;
}

.twitterClips {
	min-width: 0;
	border-bottom: solid 1px var(--twitter-border);

	> div:last-child {
		padding-bottom: 16px;
	}
}

</style>
