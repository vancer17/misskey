<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter Shell 右侧信息栏。
作用：保持搜索、趋势和推荐内容，按实际内容高度在主视口内吸顶或吸底；隐藏时保留实例，恢复显示时重新测量。
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
 * 数据链角色：Shell 同步展示策略决定首次挂载及显隐 → 原有内容卡取数；
 * 本容器只维护实际高度与入场绘制，不持有推荐或趋势业务状态。
 */
import { computed, onMounted, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { useTwitterVisibilityEntry } from './composables/use-twitter-route-entry.js';
import TwitterSearchBox from './SearchBox.vue';
import TwitterTrending from './components/TwitterTrending.vue';
import TwitterWhoToFollow from './components/TwitterWhoToFollow.vue';
/** 右栏只接收基础显示参数，不解释路由、账户或运维环境。 */
type RightRailProps = Readonly<{ visible: boolean; animated: boolean }>;
/** 由唯一 Shell 策略传入当前占位与动画偏好。 */
const props: RightRailProps = defineProps<RightRailProps>();
/** 只测量右栏实际内容高度；长栏随主视口滚到末尾后吸底，短栏吸顶。 */
const rootEl: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('rootEl');
/** 保留最近一次可见高度，隐藏后的零盒子不反向改变恢复时的吸顶位置。 */
const railHeight: Ref<number> = ref(0);
/** 观察器只跟随当前右栏元素，不监听主滚动或复制内容状态。 */
let observer: ResizeObserver | null = null;

/** 同步读取已显示的实际盒子，隐藏时保留最近可见结果。 */
function measureHeight(): void {
	const element: HTMLElement | null = rootEl.value;
	if (!props.visible || element == null || element.getClientRects().length === 0) return;
	railHeight.value = element.offsetHeight;
}

watch(
	/** v-show 恢复后的 DOM 提交是重新测量的唯一展示触发，不请求业务数据。 */
	(): boolean => props.visible,
	/** 重新量取当前实际内容，再由既有 CSS 计算吸顶偏移。 */
	(): void => { measureHeight(); },
	{ flush: 'post' },
);
useTwitterVisibilityEntry(rootEl, computed(
	/** 显示变化只控制绘制，不改变挂载或查询所有权。 */
	(): boolean => props.visible,
), computed(
	/** 偏好关闭直接进入原始完全可见终态。 */
	(): boolean => props.animated,
));
onMounted(
	/** 元素尺寸是展示参数，不属于环境 readiness 或业务事实。 */
	(): void => {
		observer = new ResizeObserver(
			/** 保持吸顶偏移与实际内容同步，不添加滚动方向状态机。 */
			(): void => { measureHeight(); },
		);
		if (rootEl.value != null) observer.observe(rootEl.value);
		measureHeight();
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
