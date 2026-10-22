<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：共享身份组件的 Twitter 表现适配。
作用：通过公开头像属性关闭 Twitter 紧凑场景的挂件，保留原组件交互及默认 UI 表现。
数据链：UI 展示上下文 → 头像装饰属性；不参与用户状态与业务判断。
-->

<template>
<MkTooltip ref="tooltip" :showing="showing" :anchorElement="anchorElement" :maxWidth="250" @closed="emit('closed')">
	<div :class="$style.root">
		<div v-for="u in users" :key="u.id" :class="$style.user">
			<MkAvatar :decorations="isTwitterUi ? [] : undefined" :class="$style.avatar" :user="u"/>
			<MkUserName :user="u" :nowrap="true"/>
		</div>
		<div v-if="users.length < count">+{{ count - users.length }}</div>
	</div>
</MkTooltip>
</template>

<script lang="ts" setup>
import type { ComputedRef } from 'vue';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';
import * as Misskey from 'misskey-js';
import MkTooltip from './MkTooltip.vue';

/** 共享紧凑头像只在 Twitter 展示上下文关闭挂件，保留原 UI 的既有偏好行为。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();

defineProps<{
	showing: boolean;
	users: Misskey.entities.UserLite[];
	count: number;
	anchorElement: HTMLElement;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();
</script>

<style lang="scss" module>
.root {
	font-size: 0.9em;
	text-align: left;
}

.user {
	line-height: 24px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;

	&:not(:last-child) {
		margin-bottom: 3px;
	}
}

.avatar {
	width: 24px;
	height: 24px;
	margin-right: 3px;
}
</style>
