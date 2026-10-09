<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI · 设置树子页共享壳（P-11 结构前提，P-20 可复用）

作用：为 settings/index.vue 的嵌套子路由提供 Twitter 式页面壳——
紧凑返回头（back + 子页标题）+ 可滚动主体，替代该场景下的
PageWithHeader + SuperMenu 布局。

数据链角色：settings/index.vue（子页存在性判定 + definePage 元数据标题）
→ 本组件（壳呈现）→ NestedRouterView（子页内容）。
布局来源：与 TwitterFollowList / TwitterTag 头部同构（X-behavior）；
设置首页（/settings root）的导航 IA 不在本壳范围（P-20）。
-->

<template>
<div ref="rootEl" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header">
				<button
					:class="$style.back"
					class="_button"
					type="button"
					:aria-label="i18n.ts.goBack"
					@click="goBack"
				>
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<h1 :class="$style.title">{{ title }}</h1>
			</header>
		</template>

		<div :class="$style.body">
			<slot></slot>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { useTwitterLayout } from './composables/use-twitter-layout.js';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';
import { i18n } from '@/i18n.js';

defineProps<{
	/** 壳标题（settings 子页 definePage 元数据，无子页时由调用方回退“设置”）。 */
	title: string;
}>();

const { isMobile } = useTwitterLayout();
const rootEl = useTemplateRef<HTMLDivElement>('rootEl');

/** 保留子页滚动位置（返回导航后恢复）。 */
useScrollPositionKeeper(rootEl);

/** 返回上一页（与 TwitterFollowList / TwitterTag 一致的返回行为）。 */
function goBack(): void {
	window.history.back();
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);

	/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4）；
	 * 底部留白避免表单末行被 FAB 遮挡 */
	&.mobile {
		padding-bottom: calc(72px + env(safe-area-inset-bottom));
	}
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

/* 紧凑返回头：X-behavior 现代表现层 */
.header {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr);
	align-items: center;
	height: 50px;
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
}

.back {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	margin-left: var(--twitter-space-2);
	border-radius: var(--twitter-radius-pill);
	font-size: 17px;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.title {
	min-width: 0;
	margin: 0;
	padding: 0 var(--twitter-space-2);
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-emphasis);
	font-weight: 800;
	line-height: 1.2;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
