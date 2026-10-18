<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 帖子身份展示（NoteHeader）。
作用：保持帖子模型只读，将作者头像和名称绑定到既有账户／用户展示引用。
数据链：实际作者标识 → 只读身份展示；不改写帖子事实或动作参数。
-->

<template>
<header :class="$style.root">
	<div :class="$style.identity">
		<MkA
			v-if="!mock"
			v-user-preview="displayUser.id"
			:class="$style.name"
			:to="userPage(displayUser)"
		>
			<MkUserName :user="displayUser"/>
		</MkA>
		<span v-else :class="$style.name"><MkUserName :user="displayUser"/></span>

		<span v-if="displayUser.isBot" :class="$style.bot">bot</span>
		<span
			v-for="(role, index) in displayUser.badgeRoles"
			:key="index"
			v-tooltip="role.name"
			:class="$style.badgeRole"
		>
			<img v-if="role.iconUrl" :src="role.iconUrl" :alt="role.name">
		</span>
	</div>

	<div :class="$style.meta">
		<span :class="$style.username"><MkAcct :user="displayUser"/></span>
		<span aria-hidden="true">·</span>
		<MkA v-if="!mock" :to="notePage(note)"><MkTime :time="note.createdAt"/></MkA>
		<span v-else><MkTime :time="note.createdAt"/></span>

		<span
			v-if="note.visibility !== 'public'"
			:class="$style.visibility"
			:title="i18n.ts._visibility[note.visibility]"
		>
			<i v-if="note.visibility === 'home'" class="ti ti-home"></i>
			<i v-else-if="note.visibility === 'followers'" class="ti ti-lock"></i>
			<i v-else-if="note.visibility === 'specified'" class="ti ti-mail"></i>
		</span>
		<span
			v-if="note.localOnly"
			:class="$style.visibility"
			:title="i18n.ts._visibility['disableFederation']"
		>
			<i class="ti ti-rocket-off"></i>
		</span>
	</div>

	<div v-if="$slots.menu" :class="$style.menu">
		<slot name="menu"></slot>
	</div>
</header>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import type { ComputedRef } from 'vue';
import { useTwitterDisplayUser } from './composables/use-twitter-display-user.js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';

/** 既有帖子与展示上下文作为只读输入。 */
const props = defineProps<{
	note: Misskey.entities.Note;
	mock?: boolean;
}>();
/** 身份展示与帖子的业务快照分离。 */
const displayUser: ComputedRef<Readonly<Misskey.entities.UserLite>> = useTwitterDisplayUser(
	/** 提取该组件实际显示的作者，不混淆转发者与原作者。 */
	(): Misskey.entities.UserLite => props.note.user,
	/** 样本展示不混入真实账户。 */
	(): boolean => props.mock ?? false,
);
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	min-width: 0;
	margin-bottom: 2px;
	line-height: 1.25;
}

.identity {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	min-width: 0;
	flex-shrink: 1;
}

.name {
	min-width: 0;
	overflow: hidden;
	/* nitter 地面真值：fullname 14px / 700（PF-2 N-5 裁决：对齐） */
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	color: var(--twitter-fg);
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
	line-height: 16px;
}

.badgeRole {
	display: inline-flex;
	align-items: center;
	flex-shrink: 0;
	height: 16px;

	img {
		height: 14px;
	}
}

.meta {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-1);
	min-width: 0;
	color: var(--twitter-secondary-fg);
	/* nitter 地面真值：username / 日期继承 body 15px（PF-2 N-5 裁决：对齐） */
	font-size: var(--twitter-font-size-content);
	white-space: nowrap;
}

.username {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.visibility {
	display: inline-flex;
	color: var(--twitter-secondary-fg);
}

.menu {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	margin-left: auto;
}
</style>
