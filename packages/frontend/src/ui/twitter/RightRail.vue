<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<aside :class="$style.root">
	<TwitterSearchBox :class="$style.search"/>
	<TwitterTrending/>
	<TwitterWhoToFollow/>
</aside>
</template>

<script lang="ts" setup>
/**
 * 文件领域：Twitter UI · Shell 层 · 右侧信息栏容器
 *
 * 作用：宽视口（≥ rightRail 断点）下承载右栏固定内容——搜索框 +
 * 趋势卡 + 推荐关注卡。Misskey 自配挂件系统（XWidgets）已按
 * ADR-0002 决策 D2 移除，leak-audit D1（挂件系统泄漏）随之闭合；
 * MkWidgets 本体不动（default 等其他 UI 继续使用）。
 *
 * 数据链角色：Shell（twitter.vue）按视口与 needWideArea 决定本容器
 * 挂载 → 三张内容卡各自经 composables 层取数；本容器不持有业务状态。
 */
import TwitterSearchBox from './SearchBox.vue';
import TwitterTrending from './components/TwitterTrending.vue';
import TwitterWhoToFollow from './components/TwitterWhoToFollow.vue';
</script>

<style lang="scss" module>
.root {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: var(--twitter-space-4);
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	padding: 0 var(--twitter-space-4);
	overflow-y: auto;
	overscroll-behavior: contain;
	background: var(--twitter-bg);
}

.search {
	position: sticky;
	top: 0;
	z-index: 1;
	flex-shrink: 0;
	margin: var(--twitter-space-4) 0;
	background: var(--twitter-hover);
}
</style>
