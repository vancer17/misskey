<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter Shell 右侧信息栏。
作用：保持搜索、趋势和推荐内容，按实际内容高度在主视口内吸顶或吸底。
数据链：实际元素高度 → 局部吸顶偏移；不持有业务状态，不建立第二条主滚动链。
-->

<template>
<aside ref="rootEl" :class="$style.root" :style="{ '--twitter-rail-height': `${railHeight}px` }">
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
import { onMounted, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import TwitterSearchBox from './SearchBox.vue';
import TwitterTrending from './components/TwitterTrending.vue';
import TwitterWhoToFollow from './components/TwitterWhoToFollow.vue';
/** 只测量右栏实际内容高度；长栏随主视口滚到末尾后吸底，短栏吸顶。 */
const rootEl: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('rootEl');
const railHeight: Ref<number> = ref(0);
let observer: ResizeObserver | null = null;
onMounted(
	/** 元素尺寸是展示参数，不属于环境 readiness 或业务事实。 */
	(): void => {
		observer = new ResizeObserver(
			/** 保持吸顶偏移与实际内容同步，不添加滚动方向状态机。 */
			(): void => { railHeight.value = rootEl.value?.offsetHeight ?? 0; },
		);
		if (rootEl.value != null) observer.observe(rootEl.value);
	},
);
onBeforeUnmount(
	/** 右栏移除时释放观察。 */
	(): void => { observer?.disconnect(); },
);
</script>

<style lang="scss" module>
.root {
	position: sticky;
	top: min(0px, calc(100cqh - var(--twitter-rail-height)));
	align-self: start;
	display: flex;
	flex-direction: column;
	gap: var(--twitter-space-4);
	height: auto;
	min-height: 0;
	box-sizing: border-box;
	padding: 0 var(--twitter-space-4);
	overflow: visible;
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
