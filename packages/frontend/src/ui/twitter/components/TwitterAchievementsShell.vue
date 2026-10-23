<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI 成就路由的 Compatible 页面壳。
作用：提供紧凑返回头、主列背景和移动安全空间，沿用 Shell 的滚动恢复契约。
数据链：原路由页面与成就组件 → 默认插槽呈现；本壳不读取成就、账户或环境探测结果。
布局来源：既有 Twitter 页面头与 Nitter 列表尺度；成就内容无 Nitter 对应页，见 ADR-0024。
-->

<template>
<div ref="rootEl" data-testid="twitter-achievements" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable">
	<MkStickyContainer>
		<template #header>
			<header data-testid="twitter-achievements-header" :class="$style.header">
				<button class="_button" type="button" :class="$style.back" :aria-label="i18n.ts.goBack" @click="goBack">
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<h1 :class="$style.title">{{ i18n.ts.achievements }}</h1>
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
import type { ShallowRef } from 'vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { useTwitterLayout } from '../context/index.js';
import type { TwitterLayoutState } from '../context/index.js';
import { useTwitterScrollPositionKeeper } from '../composables/use-twitter-scroll-host.js';
import { i18n } from '@/i18n.js';

/** 移动状态来自 Shell 唯一断点，不在页面内另行探测环境。 */
const { isMobile }: TwitterLayoutState = useTwitterLayout();
/** 根元素仅用于原页面位置保存器的独立窗口回退。 */
const rootEl: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('rootEl');

/** 主 Shell 统一恢复滚动；独立窗口沿用已有页面位置保存器。 */
useTwitterScrollPositionKeeper(rootEl);

/** 从成就通知进入后沿原历史返回，不创建另一套业务路由状态。 */
function goBack(): void {
	window.history.back();
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);

	&.mobile {
		padding-bottom: calc(var(--twitter-bottom-bar-height) + var(--twitter-space-4) + env(safe-area-inset-bottom));
	}
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

.header {
	display: grid;
	grid-template-columns: calc(var(--twitter-touch-target) + var(--twitter-space-2)) minmax(0, 1fr);
	align-items: center;
	height: var(--twitter-header-height);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: 1px solid var(--twitter-border);
}

.back {
	display: flex;
	align-items: center;
	justify-content: center;
	width: var(--twitter-touch-target);
	height: var(--twitter-touch-target);
	margin-left: var(--twitter-space-2);
	border-radius: var(--twitter-radius-pill);
	font-size: var(--twitter-font-size-heading);
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
	font-size: var(--twitter-font-size-emphasis);
	font-weight: 800;
	line-height: 1.2;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
