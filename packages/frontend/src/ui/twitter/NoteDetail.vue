<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 帖子展示与动作边界。
作用：连接成功写入与当前显示，保持原数据所有者和基础组件职责。
数据链：既有确认事件 → 局部刷新调度 → 原查询结果 → 只读渲染；不探测环境。
-->

<template>
<div v-if="muted === false && !hideByPlugin && !isDeleted" data-testid="twitter-note-detail" :data-note-id="appearNote.id" :class="[$style.root, { [$style.mobile]: isMobile }]">
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
			<TwitterAvatar decorationContext="note" :class="$style.avatar" :user="appearNote.user" link preview/>
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
				data-testid="detail-tab-replies" :aria-current="tab === 'replies' ? 'true' : undefined"
				@click="tab = 'replies'"
			>
				<strong>{{ number(noteCounters.repliesCount) }}</strong>{{ i18n.ts.replies }}
			</button>
			<button
				class="_button"
				:class="$style.stat"
				type="button"
				data-testid="detail-tab-renotes" :aria-current="tab === 'renotes' ? 'true' : undefined"
				@click="tab = 'renotes'"
			>
				<strong>{{ number(noteCounters.renoteCount) }}</strong>{{ i18n.ts.renotes }}
			</button>
			<button
				class="_button"
				:class="$style.stat"
				type="button"
				data-testid="detail-tab-reactions" :aria-current="tab === 'reactions' ? 'true' : undefined"
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
			:repliesCount="noteCounters.repliesCount"
			:renoteCount="noteCounters.renoteCount"
			:reactionAcceptance="appearNote.reactionAcceptance"
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
			<TwitterPageSkeleton v-if="repliesLoading" variant="timeline"/>
			<TwitterPageState
				v-else-if="repliesError"
				type="error"
				@retry="loadReplies"
			/>
			<TwitterPageState v-else-if="repliesLoaded && replies.length === 0" type="empty" :title="i18n.ts.noNotes"/>
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
import TwitterAvatar from './components/TwitterAvatar.vue';
import { useInterval } from '@@/js/use-interval.js';
import { store } from '@/store.js';
import { prefer } from '@/preferences.js';
import type { ComputedRef } from 'vue';
import type { TwitterNoteCounters } from '@/ui/twitter/index.js';
import { noteEvents } from '@/composables/use-note-capture.js';
import { onBeforeUnmount } from 'vue';
import { useGlobalEvent } from '@/events.js';
import { useTwitterRefresh, useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { useTwitterNoteCounters } from '@/ui/twitter/index.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
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
import TwitterPageState from './components/TwitterPageState.vue';
import TwitterPageSkeleton from './components/TwitterPageSkeleton.vue';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile } = useTwitterLayout();

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

/** 当前回复请求归属，不允许卸载或资源切换后回填。 */
let repliesRequest: AbortController | null = null;

/** 使用真实查询更新既有集合；失败保留旧回复，错误由页面原重试入口呈现。 */
async function loadReplies(): Promise<void> {
	if (repliesLoading.value) return;
	const id: string = (getAppearNote(props.note) ?? props.note).id;
	const controller: AbortController = new AbortController();
	repliesRequest = controller;
	repliesLoading.value = true;
	repliesError.value = false;
	try {
		const fetched: Misskey.entities.Note[] = await misskeyApi('notes/children', { noteId: id, limit: 30 }, undefined, controller.signal);
		if (controller.signal.aborted || (getAppearNote(props.note) ?? props.note).id !== id || repliesRequest !== controller) return;
		replies.value = fetched;
		repliesLoaded.value = true;
	} catch (error: unknown) {
		if (!controller.signal.aborted) { console.error(error); repliesError.value = true; }
	} finally {
		if (repliesRequest === controller) { repliesRequest = null; repliesLoading.value = false; }
	}
}

onBeforeUnmount(/** 回复请求只属于当前节点，不取消全局业务。 */ (): void => { repliesRequest?.abort(); });

/** 复用现有回复集合，不建立另一份线程缓存。 */
const invalidateReplies: () => void = useTwitterRefresh(
	/** 加载失败不冒充成功，不在后台循环重试。 */ async (): Promise<boolean> => { await loadReplies(); return !repliesError.value; },
	{
		busy: /** 首拉和手动重试也是同一请求占用。 */ (): boolean => repliesLoading.value,
		visible: /** 隐藏标签只保留意图。 */ (): boolean => tab.value === 'replies',
	},
);

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
/** 仅渲染服务端计数；共享 useNote 的动作与权限输入不被展示投影改写。 */
const noteCounters: ComputedRef<TwitterNoteCounters> = useTwitterNoteCounters(
	/** 纯转发显示原帖计数，而不是转发外壳计数。 */ (): Misskey.entities.Note => getAppearNote(props.note) ?? props.note,
	/** 样本继承既有 DI，不额外启用真实请求。 */ (): boolean => false,
	/** 外壳身份与显示原帖身份分开，不复制实体。 */ (): Misskey.entities.Note => props.note,
);

/** 人员名单与统计分别失效；v-if 原生初始化仍由 MkPagination 负责。 */
const invalidateRenotes: () => void = useTwitterPaginatorRefresh(
	/** 转发名单的唯一分页器。 */ (): typeof renotesPaginator => renotesPaginator,
	/** 仅显示转发标签时取数。 */ (): boolean => tab.value === 'renotes',
);
const invalidateReactions: () => void = useTwitterPaginatorRefresh(
	/** 反应名单的唯一分页器。 */ (): typeof reactionsPaginator => reactionsPaginator,
	/** 同一反应类型的人员变化也需要更新。 */ (): boolean => tab.value === 'reactions' && reactionTabType.value != null,
);
useGlobalEvent('notePosted', /** 回执只定位受影响原帖，不插入未经过滤的回复或名单。 */ (created: Misskey.entities.Note): void => {
	if (created.replyId === appearNote.id) invalidateReplies();
	if (created.renoteId === appearNote.id) invalidateRenotes();
});
useGlobalEvent('noteDeleted', /** 删除已有直接回复／转发时分别重取集合。 */ (id: string): void => {
	if (replies.value.some(/** 直接回复归属。 */ (child: Misskey.entities.Note): boolean => child.id === id)) invalidateReplies();
	if (renotesPaginator.items.value.some(/** 已载入转发归属。 */ (item: Misskey.entities.Note): boolean => item.id === id)) invalidateRenotes();
});
/** 非实时模式的人员名单沿用既有轮询档位；不能用总数未变证明成员未变。 */
const peoplePollingInterval: number = 10_000 * (prefer.s.pollingInterval === 1 ? 2.25 : prefer.s.pollingInterval === 2 ? 1.5 : 1);
if (!store.s.realtimeMode) {
	useInterval(/** 只更新实际显示的名单，不为每张卡或隐藏标签建立轮询。 */ (): void => {
		if (tab.value === 'reactions') invalidateReactions();
		if (tab.value === 'renotes') invalidateRenotes();
	}, peoplePollingInterval, { immediate: false, afterMounted: true });
}
noteEvents.on(`reacted:${appearNote.id}`, invalidateReactions);
noteEvents.on(`unreacted:${appearNote.id}`, invalidateReactions);
onBeforeUnmount(/** 页面销毁后不保留名单监听。 */ (): void => {
	noteEvents.off(`reacted:${appearNote.id}`, invalidateReactions);
	noteEvents.off(`unreacted:${appearNote.id}`, invalidateReactions);
});
watch(/** 非实时轮询改变的反应数量也使当前名单失效。 */ (): number => $appearNote.reactionCount,
	/** 仅用于显示新鲜度，不由总数推断人员。 */ (): void => { invalidateReactions(); });

</script>

<style lang="scss" module>
.root {
	min-width: 0;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
}

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.root.mobile {
	.article {
		padding: var(--twitter-space-3);
	}

	.header {
		/* nitter 无移动端头像收缩（PF-2 N-11 裁决：对齐 48px） */
		grid-template-columns: var(--twitter-avatar-note-size) minmax(0, 1fr) 32px;
		gap: var(--twitter-avatar-note-mobile-gap);
	}

	.avatar {
		width: var(--twitter-avatar-note-size);
		height: var(--twitter-avatar-note-size);
	}

	.text {
		font-size: var(--twitter-font-size-title);
	}

	.people {
		padding: 10px 12px;
	}
}

.contextLoading {
	display: flex;
	justify-content: center;
	padding: var(--twitter-space-4);
	border-bottom: solid 1px var(--twitter-border);
}

.contextError {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-bottom: solid 1px var(--twitter-border);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);

	button {
		padding: var(--twitter-space-1) var(--twitter-space-3);
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
	padding: var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	border-bottom: solid 1px var(--twitter-border);
	text-align: center;
}

.muted {
	cursor: pointer;
}

.article {
	position: relative;
	min-width: 0;
	padding: var(--twitter-space-4);
	border-bottom: solid 1px var(--twitter-border);

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.header {
	display: grid;
	grid-template-columns: var(--twitter-avatar-note-size) minmax(0, 1fr) 36px;
	gap: var(--twitter-avatar-note-gap);
	align-items: center;
}

.avatar {
	width: var(--twitter-avatar-note-size);
	height: var(--twitter-avatar-note-size);
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
	gap: var(--twitter-space-1);
}

.name {
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-content);
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
	padding: 0 var(--twitter-space-1);
	border: solid 1px var(--twitter-border);
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
	font-size: var(--twitter-font-size-body);
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
	margin-top: var(--twitter-space-2);
}

.content {
	min-width: 0;
	margin-top: var(--twitter-space-2);
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
	gap: var(--twitter-space-2);
	margin: 0;
}

.replyContext {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	margin-bottom: var(--twitter-space-1);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);

	a {
		color: var(--twitter-accent);
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}
}

.text {
	font-size: var(--twitter-font-size-heading);
	line-height: 1.35;
	white-space: pre-wrap;
}

.private {
	color: var(--twitter-secondary-fg);
}

.translation {
	margin-top: var(--twitter-space-2);
	font-size: var(--twitter-font-size-content);
}

.media,
.poll,
.urlPreview {
	margin-top: var(--twitter-space-3);
}

.channel {
	display: inline-flex;
	align-items: center;
	gap: var(--twitter-space-1);
	margin-top: 10px;
	color: var(--twitter-accent);
	font-size: var(--twitter-font-size-body);
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
	margin-top: var(--twitter-space-3);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
}

.stats {
	display: flex;
	flex-wrap: wrap;
	gap: 20px;
	padding: var(--twitter-space-3) 0;
	border-bottom: solid 1px var(--twitter-border);
}

.stat {
	display: inline-flex;
	align-items: baseline;
	gap: var(--twitter-space-1);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
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
	margin-top: var(--twitter-space-2);
}

.results {
	min-width: 0;
}

.people {
	padding: var(--twitter-space-3) var(--twitter-space-4);
}

.person {
	display: block;
	margin-bottom: var(--twitter-space-2);
	color: inherit;
	text-decoration: none;
}

.reactionTabs {
	display: flex;
	flex-wrap: wrap;
	gap: var(--twitter-space-2);
	margin-bottom: 10px;
}

.reactionTab {
	display: inline-flex;
	align-items: center;
	gap: var(--twitter-space-1);
	padding: var(--twitter-space-1) var(--twitter-space-2);
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
	transition:
		background-color var(--twitter-duration-fast) ease,
		border-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;
}

.reactionTabActive {
	border-color: var(--twitter-accent);
	color: var(--twitter-accent);
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
