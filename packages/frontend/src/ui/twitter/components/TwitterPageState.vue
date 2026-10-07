<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" role="status">
	<i v-if="type !== 'empty'" :class="[$style.icon, iconClass]" aria-hidden="true"></i>
	<h2 :class="$style.title">{{ resolvedTitle }}</h2>
	<p v-if="resolvedDescription != null" :class="$style.description">{{ resolvedDescription }}</p>
	<button
		v-if="type === 'error'"
		class="_button"
		:class="$style.retry"
		type="button"
		@click="emit('retry')"
	>
		{{ i18n.ts.retry }}
	</button>
</div>
</template>

<script lang="ts" setup>
/**
 * 文件领域：Twitter UI · 基础组件 · 页面终态呈现
 *
 * 作用：统一呈现必做页面的空态 / 未找到 / 错误终态与重试入口，
 * 只接收原始类型 props，不含业务取数逻辑（规范组件层 #1）。
 *
 * 数据链角色：页面取数逻辑（状态派生）→ 本组件（终态呈现）；
 * 重试经 retry 事件交回页面重发请求（业务状态不出组件，规范组件层 #2）。
 */

import { computed } from 'vue';
import type { TwitterPageStateType } from '@/ui/twitter/domain/page-state.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	/** 终态类型（domain 权威类型）。 */
	type: TwitterPageStateType;
	/** 覆盖默认标题。 */
	title?: string;
	/** 覆盖默认说明文字。 */
	description?: string;
}>(), {
	title: undefined,
	description: undefined,
});

const emit = defineEmits<{
	(ev: 'retry'): void;
}>();

/** 按终态类型解析默认标题。 */
const defaultTitle = computed<string>(() => {
	switch (props.type) {
		case 'notFound': return i18n.ts.notFound;
		case 'error': return i18n.ts.somethingHappened;
		default: return i18n.ts.nothing;
	}
});

/** 按终态类型解析默认说明文字（部分终态无副文）。 */
const defaultDescription = computed<string | null>(() => {
	switch (props.type) {
		case 'notFound': return i18n.ts.notFoundDescription;
		case 'error': return i18n.ts.error;
		default: return null;
	}
});

/** 实际渲染标题：显式传入优先。 */
const resolvedTitle = computed<string>(() => props.title ?? defaultTitle.value);

/** 实际渲染副文：显式传入优先，无内容时不渲染该行。 */
const resolvedDescription = computed<string | null>(() => props.description ?? defaultDescription.value);

/** 按终态类型解析图标（空态沿用已验收的无图标形态）。 */
const iconClass = computed<string>(() => {
	switch (props.type) {
		case 'notFound': return 'ti ti-question-circle';
		default: return 'ti ti-alert-triangle';
	}
});
</script>

<style lang="scss" module>
.root {
	display: grid;
	min-height: min(60vh, 480px);
	align-content: center;
	justify-items: center;
	gap: 8px;
	padding: 48px 24px;
	text-align: center;
	background: var(--twitter-bg);
}

.icon {
	color: var(--twitter-secondary-fg);
	font-size: 32px;
}

.title {
	margin: 0;
	color: var(--twitter-fg);
	font-size: 20px;
	font-weight: 800;
}

.description {
	margin: 0;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
}

.retry {
	margin-top: 8px;
	padding: 8px 16px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 14px;
	font-weight: 700;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: var(--twitter-accent-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}
</style>
