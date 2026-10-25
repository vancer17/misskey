<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：通用叠层路由出口。
作用：保留既有叠层、返回和缓存行为，允许宿主定制等待展示、页面底色及指定路径的卡片展示身份。
数据链：路由解析结果 → 叠层页面；加载展示上下文继续传递给后代出口。
-->

<template>
<TransitionGroup
	:enterActiveClass="prefer.s.animation ? $style.transition_x_enterActive : ''"
	:leaveActiveClass="prefer.s.animation ? $style.transition_x_leaveActive : ''"
	:enterFromClass="prefer.s.animation ? $style.transition_x_enterFrom : ''"
	:leaveToClass="prefer.s.animation ? $style.transition_x_leaveTo : ''"
	:moveClass="prefer.s.animation ? $style.transition_x_move : ''"
	:duration="200"
	tag="div" :class="$style.tabs"
>
	<div v-for="(tab, i) in tabs" :key="tab.renderKey" :class="$style.tab" :style="{ '--i': i - 1 }">
		<div v-if="i > 0" :class="$style.tabBg" @click="back()"></div>
		<div :class="$style.tabFg" @click.stop="back()">
			<div v-if="i > 0" :class="$style.tabMenu">
				<svg :class="$style.tabMenuShape" viewBox="0 0 24 16">
					<g transform="matrix(2.04108e-17,-0.333333,0.222222,1.36072e-17,21.3333,15.9989)">
						<path d="M23.997,-42C47.903,-23.457 47.997,12 47.997,12L-0.003,12L-0.003,-96C-0.003,-96 0.091,-60.543 23.997,-42Z" style="fill:var(--MI_THEME-panel);"/>
					</g>
				</svg>
				<button :class="$style.tabMenuButton" class="_button" @click.stop="mount"><i class="ti ti-rectangle"></i></button>
				<button :class="$style.tabMenuButton" class="_button" @click.stop="back"><i class="ti ti-x"></i></button>
			</div>
			<div v-if="i > 0" :class="$style.tabBorder"></div>
			<div :class="$style.tabContent" class="_pageContainer" @click.stop="">
				<Suspense :timeout="0">
					<component :is="tab.component" v-bind="Object.fromEntries(tab.props)"/>

					<template #fallback>
						<slot name="fallback">
							<component :is="routeFallback" v-if="routeFallback"/>
							<MkLoading v-else/>
						</slot>
					</template>
				</Suspense>
			</div>
		</div>
	</div>
</TransitionGroup>
</template>

<script lang="ts" setup>
import { inject, provide, shallowRef, useSlots } from 'vue';
import type { Component, ShallowRef, Slot, Slots } from 'vue';
import { routerViewFallbackKey } from './router-view-fallback.js';
import type { Router } from '@/router.js';
import type { PathResolvedResult, RouterEvents } from '@/lib/nirax.js';
import { prefer } from '@/preferences.js';
import MkLoadingPage from '@/pages/_loading_.vue';
import { DI } from '@/di.js';
import { deepEqual } from '@/utility/deep-equal.js';

/** 叠层出口仅接收现有路由依赖和基础展示参数。 */
type StackingOutletProps = {
	router?: Router;
	/** 宿主可指定一个路径在当前卡片内更新参数；缺省继续按完整地址创建卡片。 */
	stableViewPath?: string;
};
const props: Readonly<StackingOutletProps> = defineProps<StackingOutletProps>();

/** 叠层根出口的插槽对各卡片共用，仅提供加载视觉。 */
const slots: Slots = useSlots();
/** 后代嵌套出口继承同一宿主的展示函数。 */
const routeFallback: Slot | undefined = slots.fallback ?? inject(routerViewFallbackKey, undefined);
provide(routerViewFallbackKey, routeFallback);

const injectedRouter: Router | undefined = props.router ?? inject(DI.router);
if (injectedRouter == null) throw new Error('no router provided');
const router: Router = injectedRouter;
const currentDepth: number = inject(DI.routerCurrentDepth, 0);
provide(DI.routerCurrentDepth, currentDepth + 1);

/** 仅保存现有路由解析与展示身份，不持有页面业务事实。 */
type StackedPage = {
	renderKey: string | number;
	fullPath: string;
	routePath: string;
	component: Component;
	props: PathResolvedResult['props'];
};
/** 指定路径的新卡片使用递增展示键，避免与历史同路径卡片混用实例。 */
let stableKey: number = 0;

/** 普通卡片维持完整地址键；宿主指定路径只在同一当前卡片内保留数字键。 */
function createPage(resolved: PathResolvedResult, fullPath: string): StackedPage {
	return {
		renderKey: resolved.route.path === props.stableViewPath ? ++stableKey : fullPath,
		fullPath,
		routePath: resolved.route.path,
		component: 'component' in resolved.route ? resolved.route.component : MkLoadingPage,
		props: resolved.props,
	};
}

const tabs: ShallowRef<StackedPage[]> = shallowRef([createPage(router.current, router.getCurrentFullPath())]);

/** 固定当前卡片时保留其展示身份及既有路由参数。 */
function mount(): void {
	const currentTab: StackedPage = tabs.value[tabs.value.length - 1];
	tabs.value = [currentTab];
}

/** 返回上一层仍由现有路由 replace 恢复地址，不创建额外导航历史。 */
function back(): void {
	if (tabs.value.length <= 1) return;
	const prev: StackedPage = tabs.value[tabs.value.length - 2];
	tabs.value = [...tabs.value.slice(0, tabs.value.length - 1)];
	router.replaceByPath(prev.fullPath);
}

router.useListener('change',
	/** 宿主指定路径只更新当前卡片；其余导航沿用原有匹配、返回和缓存上限。 */
	({ resolved }: Parameters<RouterEvents['change']>[0]): void => {
		if (resolved == null || 'redirect' in resolved.route) return;
		const currentTab: StackedPage = tabs.value[tabs.value.length - 1];
		const routePath: string = resolved.route.path;
		if (routePath === currentTab.routePath && deepEqual(resolved.props, currentTab.props)) return;
		const fullPath: string = router.getCurrentFullPath();
		if (routePath === props.stableViewPath && routePath === currentTab.routePath) {
			tabs.value = [...tabs.value.slice(0, -1), {
				...currentTab,
				fullPath,
				component: resolved.route.component,
				props: resolved.props,
			}];
			return;
		}
		const previousIndex: number = tabs.value.findIndex(
			/** 仅精确匹配已有路径与参数；不同参数的历史卡片保持独立。 */
			(tab: StackedPage): boolean => tab.routePath === routePath && deepEqual(resolved.props, tab.props),
		);
		if (previousIndex !== -1) {
			tabs.value = tabs.value.slice(0, previousIndex + 1);
			return;
		}
		const retainedTabs: StackedPage[] = tabs.value.length >= prefer.s.numberOfPageCache ? tabs.value.slice(1) : tabs.value;
		tabs.value = [...retainedTabs, createPage(resolved, fullPath)];
	},
);

router.useListener('replace',
	/** 地址替换仍维持普通页面原有键语义；指定路径的当前实例保留展示键。 */
	({ fullPath }: Parameters<RouterEvents['replace']>[0]): void => {
		const currentTab: StackedPage = tabs.value[tabs.value.length - 1];
		tabs.value = [...tabs.value.slice(0, -1), {
			...currentTab,
			fullPath,
			renderKey: currentTab.routePath === props.stableViewPath ? currentTab.renderKey : fullPath,
		}];
	},
);
</script>

<style lang="scss" module>
.transition_x_move,
.transition_x_enterActive,
.transition_x_leaveActive {
	.tabBg {
		transition: opacity 0.2s cubic-bezier(0,.5,.5,1), transform 0.2s cubic-bezier(0,.5,.5,1) !important;
	}

	.tabFg {
		transition: opacity 0.2s cubic-bezier(0,.5,.5,1), transform 0.2s cubic-bezier(0,.5,.5,1) !important;
	}
}
.transition_x_enterFrom,
.transition_x_leaveTo {
	.tabBg {
		opacity: 0;
	}

	.tabFg {
		opacity: 0;
		transform: translateY(100px);
	}
}
.transition_x_leaveActive {
	.tabFg {
		//position: absolute;
	}
}

.tabs {
	position: relative;
	width: 100%;
	height: 100%;
}

.tab {
	overflow: clip;

	&:first-child {
		position: relative;
		width: 100%;
		height: 100%;

		.tabFg {
			position: relative;
			width: 100%;
			height: 100%;
		}
	}

	&:not(:first-child) {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 100%;

		.tabBg {
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: #0003;
			-webkit-backdrop-filter: var(--MI-blur, blur(3px));
			backdrop-filter: var(--MI-blur, blur(3px));
		}

		.tabFg {
			position: absolute;
			bottom: 0;
			left: 0;
			width: 100%;
			height: calc(100% - (10px + (20px * var(--i))));
			display: flex;
			flex-direction: column;
		}

		.tabContent {
			flex: 1;
		}
	}
}

.tabContent {
	position: relative;
	width: 100%;
	height: 100%;
	background: var(--MI-router-view-background, var(--MI_THEME-bg));
}

.tabMenu {
	position: relative;
	margin-left: auto;
	padding: 0 4px;
	background: var(--MI_THEME-panel);
}

.tabMenuShape {
	position: absolute;
	bottom: -1px;
	left: -100%;
	height: calc(100% + 1px);
	width: 129%;
	pointer-events: none;
}

.tabBorder {
	height: 6px;
	background: var(--MI_THEME-panel);
}

.tabMenuButton {
	padding: 8px;
	font-size: 13px;
}
</style>
