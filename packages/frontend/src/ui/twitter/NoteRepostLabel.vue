<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 帖子身份展示（NoteRepostLabel）。
作用：保持帖子模型只读，将作者头像和名称绑定到既有账户／用户展示引用。
数据链：实际作者标识 → 只读身份展示；不改写帖子事实或动作参数。
-->

<template>
<div :class="[$style.root, { [$style.mobile]: isMobile }]">
	<MkAvatar :class="$style.avatar" :user="displayUser" :link="!mock" :preview="!mock"/>
	<i :class="['ti ti-repeat', $style.icon]" aria-hidden="true"></i>
	<I18n :src="i18n.ts.renotedBy" tag="span" :class="$style.text">
		<template #user>
			<MkA
				v-if="!mock"
				v-user-preview="displayUser.id"
				:class="$style.user"
				:to="userPage(displayUser)"
			>
				<MkUserName :user="displayUser"/>
			</MkA>
			<span v-else :class="$style.user"><MkUserName :user="displayUser"/></span>
		</template>
	</I18n>

	<div v-if="$slots.menu" :class="$style.menu">
		<slot name="menu"></slot>
	</div>
</div>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import type { ComputedRef } from 'vue';
import { useTwitterDisplayUser } from './composables/use-twitter-display-user.js';
import { i18n } from '@/i18n.js';
import { userPage } from '@/filters/user.js';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile } = useTwitterLayout();

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
	gap: var(--twitter-space-2);
	min-width: 0;
	padding: 10px 16px 0 calc(16px + 16px);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	line-height: 20px;

	/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
	&.mobile {
		padding-right: var(--twitter-space-3);
		padding-left: calc(12px + 16px);
	}
}

.avatar {
	width: 20px;
	height: 20px;
}

.icon {
	flex-shrink: 0;
	color: var(--twitter-secondary-fg);
}

.text {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.user {
	color: var(--twitter-fg);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
}

.menu {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	margin-left: auto;
}
</style>
