<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 实时连接提示展示。
作用：展示启动层确认仍需提示的断线状态，并将关闭和刷新操作交回宿主。
数据链：Bootstrap 的只读可见性投影 → 本组件 → 宿主事件；不读取连接或浏览器网络状态。
-->

<template>
<div v-if="visible" :class="$style.root" role="status" data-testid="twitter-stream-notice">
	<div :class="$style.message"><i class="ti ti-alert-triangle" aria-hidden="true"></i> {{ i18n.ts.disconnectedFromServer }}</div>
	<div :class="$style.commands">
		<MkButton type="button" small primary @click="onReload">{{ i18n.ts.reload }}</MkButton>
		<MkButton type="button" small @click="onDismiss">{{ i18n.ts.doNothing }}</MkButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { claimZIndex } from '@/os.js';

defineProps<{
	visible: boolean;
}>();

/** 提示组件只发布基础用户操作，不携带连接事实或业务数据。 */
type NoticeEmits = {
	(event: 'dismiss'): void;
	(event: 'reload'): void;
};

/** 展示层仅提交用户意图，不直接改变连接或重载页面。 */
const emit: NoticeEmits = defineEmits<NoticeEmits>();

/** 与原系统提示共用浮层层级分配，不另建全局层级计数。 */
const zIndex: number = claimZIndex('high');

/** 关闭意图由启动层限制在当前连续断线期间。 */
function onDismiss(): void {
	emit('dismiss');
}

/** 刷新由 Shell 执行，展示组件不拥有页面生命周期。 */
function onReload(): void {
	emit('reload');
}
</script>

<style lang="scss" module>
.root {
	position: fixed;
	z-index: v-bind(zIndex);
	bottom: calc(max(var(--MI-minBottomSpacing), env(safe-area-inset-bottom, 0px)) + var(--MI-margin));
	right: max(var(--MI-margin), env(safe-area-inset-right, 0px));
	box-sizing: border-box;
	width: max-content;
	max-width: min(320px, calc(100vw - max(var(--MI-margin), env(safe-area-inset-left, 0px)) - max(var(--MI-margin), env(safe-area-inset-right, 0px))));
	padding: var(--twitter-space-3);
	border: 1px solid var(--twitter-border);
	border-radius: var(--twitter-radius-large);
	background: var(--twitter-panel);
	color: var(--twitter-fg);
	box-shadow: var(--twitter-overlay-shadow);
	font-size: var(--twitter-font-size-body);
}

.message {
	overflow-wrap: anywhere;
}

.commands {
	display: flex;
	flex-wrap: wrap;
	gap: var(--twitter-space-2);
	margin-top: var(--twitter-space-2);
}
</style>
