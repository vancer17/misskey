<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 路由代码加载展示。
作用：页面模块尚未就绪时保持主列的背景、页头尺度和内容反馈，随后由页面自身接管数据加载态。
数据链：通用路由出口 fallback → 本展示组件；只使用现有设计 Token，不解释路径或请求业务数据。
-->

<template>
<div :class="$style.root" data-testid="twitter-route-loading" aria-busy="true">
	<div :class="$style.header" aria-hidden="true"><span :class="$style.title"></span></div>
	<TwitterPageSkeleton variant="timeline"/>
</div>
</template>

<script lang="ts" setup>
import TwitterPageSkeleton from './TwitterPageSkeleton.vue';
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
}

.header {
	display: flex;
	align-items: center;
	box-sizing: border-box;
	height: var(--twitter-header-height);
	padding: 0 var(--twitter-space-4);
	border-bottom: solid 1px var(--twitter-border);
	background: var(--twitter-bg);
}

.title {
	width: 30%;
	height: var(--twitter-space-4);
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-skeleton-block);
}
</style>
