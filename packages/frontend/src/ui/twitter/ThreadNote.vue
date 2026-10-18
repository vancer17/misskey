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
<article
	v-if="muted === false && !hideByPlugin && !isDeleted"
	ref="rootEl"
	v-hotkey="keymap"
	data-testid="twitter-thread-note"
	:data-note-id="appearNote.id"
	:class="[$style.root, { [$style.mobile]: isMobile }]"
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

		<button
			v-if="canExpand && !repliesExpanded && !repliesLoading && !repliesError"
			:class="$style.showReplies"
			class="_button"
			type="button"
			@click="expandReplies"
		>
			<i class="ti ti-message-circle" aria-hidden="true"></i>{{ i18n.ts.loadReplies }}
		</button>
		<MkLoading v-else-if="repliesLoading" mini :class="$style.loading"/>
		<div v-else-if="repliesError" :class="$style.repliesError">
			<span>{{ i18n.ts.error }}</span>
			<button class="_button" type="button" @click="expandReplies">{{ i18n.ts.retry }}</button>
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
		<div v-else-if="depth >= maxDepth && noteCounters.repliesCount > 0" :class="$style.more">
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
import type { ComputedRef } from 'vue';
import type { TwitterNoteCounters } from '@/ui/twitter/index.js';
import type { Ref } from 'vue';
import { onBeforeUnmount } from 'vue';
import { useGlobalEvent } from '@/events.js';
import { useTwitterRefresh } from '@/ui/twitter/index.js';
import { useTwitterNoteCounters } from '@/ui/twitter/index.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
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
/* 递归自引用：回复线程树逐层渲染子回复 */
import TwitterThreadNote from './ThreadNote.vue';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile } = useTwitterLayout();

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
/** 保留展开意图，不以返回条目数量代表是否展开。 */
const repliesExpanded: Ref<boolean> = ref<boolean>(false);
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

/** 只由深度展示限制与已确认计数决定展开入口，不建立回复事实副本。 */
const canExpand: ComputedRef<boolean> = computed(/** 只读 UI 可展开状态。 */ (): boolean => props.depth < maxDepth && noteCounters.value.repliesCount > 0);

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
		const fetched: Misskey.entities.Note[] = await misskeyApi('notes/children', { noteId: id, limit: 10 }, undefined, controller.signal);
		if (controller.signal.aborted || (getAppearNote(props.note) ?? props.note).id !== id || repliesRequest !== controller) return;
		replies.value = fetched;
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
		visible: /** 未展开的线程不预取；已展开的空集合仍应更新。 */ (): boolean => repliesExpanded.value && props.depth < maxDepth,
	},
);

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
/** 仅渲染服务端计数；共享 useNote 的动作与权限输入不被展示投影改写。 */
const noteCounters: ComputedRef<TwitterNoteCounters> = useTwitterNoteCounters(
	/** 纯转发显示原帖计数，而不是转发外壳计数。 */ (): Misskey.entities.Note => getAppearNote(props.note) ?? props.note,
	/** 样本继承既有 DI，不额外启用真实请求。 */ (): boolean => false,
	/** 外壳身份与显示原帖身份分开，不复制实体。 */ (): Misskey.entities.Note => props.note,
);

/** 用户主动展开只加载此节点，不扩大递归深度。 */
function expandReplies(): void { repliesExpanded.value = true; invalidateReplies(); }

useGlobalEvent('notePosted', /** 本人原地回复时打开对应父节点，其余节点不受影响。 */ (created: Misskey.entities.Note): void => {
	if (created.replyId !== appearNote.id) return;
	if (props.depth < maxDepth) repliesExpanded.value = true;
	invalidateReplies();
});
useGlobalEvent('noteDeleted', /** 已有直接子回复删除后更新该集合。 */ (id: string): void => {
	if (replies.value.some(/** 只定位当前集合成员。 */ (child: Misskey.entities.Note): boolean => child.id === id)) invalidateReplies();
});

</script>

<style lang="scss" module>
.root {
	position: relative;
	display: grid;
	/* nitter 地面真值：thread 行复用 tweet-avatar 48×48（PF-2 N-11 裁决：对齐） */
	grid-template-columns: 48px minmax(0, 1fr);
	gap: 10px;
	min-width: 0;
	/* nitter 地面真值：timeline-item 内距 12px 四向一致（PF-2 N-2 裁决：对齐） */
	padding: var(--twitter-space-3);
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-body);
	/* nitter 地面真值：行高 1.3（PF-2 N-3 裁决：对齐） */
	line-height: 1.3;
	border-bottom: solid 1px var(--twitter-border);
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
	width: 48px;
	height: 48px;
}

.threadLine {
	/* nitter 地面真值：thread-line 3px / accent_dark（thread.scss；twitter 主题 accent_dark = accent，PF-1 N-8） */
	width: 3px;
	flex: 1;
	min-height: 8px;
	margin-top: var(--twitter-space-1);
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
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
	gap: var(--twitter-space-2);
	margin: 0;
}

.body {
	white-space: pre-wrap;
}

.media {
	margin-top: var(--twitter-space-2);
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
	font-size: var(--twitter-font-size-meta);
	font-weight: 700;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover, &:focus-visible {
		background: color-mix(in srgb, var(--twitter-accent) 10%, transparent);
	}
}

.loading {
	margin-top: var(--twitter-space-2);
}

.repliesError {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 6px;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);

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
	margin-top: var(--twitter-space-1);
	padding-left: var(--twitter-space-1);
}

.more {
	margin-top: 6px;

	a {
		color: var(--twitter-accent);
		font-size: var(--twitter-font-size-meta);
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
	padding: var(--twitter-space-3) var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	border-bottom: solid 1px var(--twitter-border);
}

.muted {
	cursor: pointer;
}

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.root.mobile {
	/* nitter 无移动端头像收缩（PF-2 N-9 裁决：对齐 48px） */
	grid-template-columns: 48px minmax(0, 1fr);
	gap: var(--twitter-space-2);
	padding: var(--twitter-space-3);

	.avatar {
		width: 48px;
		height: 48px;
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
