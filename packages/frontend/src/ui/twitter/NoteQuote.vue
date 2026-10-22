<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 帖子身份展示（NoteQuote）。
作用：保持帖子模型只读，将身份展示与引用卡片入口绑定到被引用帖子。
数据链：被引用帖子 → 只读身份展示及独立导航目标；缺失引用仅保留冒泡边界，不改写帖子事实。
-->

<template>
<div v-if="note == null" data-twitter-note-card :class="[$style.root, $style.deleted]">
	{{ i18n.ts.deletedNote }}
</div>
<article
	v-else
	data-twitter-note-card
	:class="$style.root"
	:aria-label="i18n.ts.quote"
	@click="onNoteClick"
	@auxclick="onNoteAuxClick"
>
	<header v-if="displayUser" :class="$style.header">
		<TwitterAvatar decorationContext="none" :class="$style.avatar" :user="displayUser" link preview/>
		<MkA
			v-user-preview="displayUser.id"
			:class="$style.name"
			:to="userPage(displayUser)"
		>
			<MkUserName :user="displayUser"/>
		</MkA>
		<span :class="$style.username"><MkAcct :user="displayUser"/></span>
		<span aria-hidden="true">·</span>
		<MkTime v-if="mock" :time="note.createdAt"/>
		<MkA v-else :class="$style.time" :to="notePage(note)" :aria-label="i18n.ts.note">
			<MkTime :time="note.createdAt"/>
		</MkA>
	</header>

	<div v-if="note.cw != null" :class="$style.cw">
		<Mfm v-if="note.cw !== ''" :text="note.cw" :author="note.user" :nyaize="'respect'" :emojiUrls="note.emojis" class="_selectable"/>
		<MkA :class="$style.showMore" :to="notePage(note)">{{ i18n.ts.showMore }}</MkA>
	</div>
	<div v-else :class="$style.body">
		<Mfm
			v-if="note.text"
			:text="note.text"
			:author="note.user"
			:nyaize="'respect'"
			:emojiUrls="note.emojis"
			class="_selectable"
		/>
		<div v-if="note.files?.length" :class="$style.meta">
			<i class="ti ti-photo" aria-hidden="true"></i>{{ i18n.ts.files }}
		</div>
		<div v-if="note.poll" :class="$style.meta">
			<i class="ti ti-chart-bar" aria-hidden="true"></i>{{ i18n.ts.poll }}
		</div>
		<div v-if="note.renoteId" :class="$style.meta">
			<i class="ti ti-quote" aria-hidden="true"></i>
			<MkA v-if="note.renote" :to="notePage(note.renote)">{{ i18n.ts.quote }}</MkA>
			<span v-else>{{ i18n.ts.deletedNote }}</span>
		</div>
	</div>
</article>
</template>

<script lang="ts" setup>
import TwitterAvatar from './components/TwitterAvatar.vue';
import * as Misskey from 'misskey-js';
import { computed, inject } from 'vue';
import type { ComputedRef } from 'vue';
import { useTwitterDisplayUser } from './composables/use-twitter-display-user.js';
import { useNoteNavigation } from './composables/use-note-navigation.js';
import { DI } from '@/di.js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';

/** 既有帖子与展示上下文作为只读输入。 */
const props = defineProps<{
	note: Misskey.entities.Note | null;
}>();
/** 样本上下文不新增可跳入真实实例的帖子入口。 */
const mock: boolean = inject(DI.mock, false);
/** 缺失引用保持空值，不把外层帖子作为替代导航目标。 */
const navigationNote: ComputedRef<Misskey.entities.Note | null> = computed(
	/** 引用卡片始终以自身收到的帖子为目标。 */
	(): Misskey.entities.Note | null => props.note,
);
/** 引用正文与空白区复用统一导航，键盘访问保留在真实时间戳链接。 */
const { onNoteClick, onNoteAuxClick }: ReturnType<typeof useNoteNavigation> = useNoteNavigation(navigationNote);

/** 身份展示与帖子的业务快照分离。 */
const displayUser: ComputedRef<Readonly<Misskey.entities.UserLite> | null> = useTwitterDisplayUser(
	/** 提取该组件实际显示的作者，不混淆转发者与原作者。 */
	(): Misskey.entities.UserLite | null => props.note?.user ?? null,
);
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	margin-top: 10px;
	padding: 10px 12px;
	/* nitter 地面真值：quote 边框 1px（quote.scss，PF-2 N-4 裁决：对齐） */
	border: solid 1px var(--twitter-border);
	/* nitter 地面真值：quote 圆角 10px（quote.scss，PF-1 E-1） */
	border-radius: var(--twitter-radius-embed);
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-body);
	/* nitter 地面真值：行高 1.3（PF-2 N-3 裁决：对齐） */
	line-height: 1.3;
	overflow: clip;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
	}
}

.deleted {
	color: var(--twitter-secondary-fg);
	text-align: center;
}

.header {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	min-width: 0;
	margin-bottom: var(--twitter-space-1);
	color: var(--twitter-secondary-fg);
	white-space: nowrap;
}

.avatar {
	width: 20px;
	height: 20px;
}

.name {
	min-width: 0;
	overflow: hidden;
	font-weight: 700;
	color: var(--twitter-fg);
	text-decoration: none;
	text-overflow: ellipsis;

	&:hover {
		text-decoration: underline;
	}
}

.time {
	color: inherit;
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.username {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.cw,
.body {
	min-width: 0;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.cw {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--twitter-space-2);
}

.body {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 5;
}

.showMore {
	flex-shrink: 0;
	color: var(--twitter-accent);
	font-weight: 700;
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.meta {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	margin-top: 6px;
	color: var(--twitter-secondary-fg);

	a {
		color: var(--twitter-accent);
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}
}
</style>
