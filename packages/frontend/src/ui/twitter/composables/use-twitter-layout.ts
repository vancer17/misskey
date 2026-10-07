/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · composables 层 · 布局响应式组合函数
 *
 * 作用：将 domain 权威断点常量转换为组件可消费的响应式布局状态
 * （是否移动端 / 是否显示侧栏 / 是否显示右栏）。
 *
 * 数据链角色：domain/layout.ts（权威常量）→ 本组合函数（状态派生）
 * → Shell 与内容组件（多消费点）；组件与样式不得另行复制断点。
 *
 * 实现说明：布局状态为模块级单例——matchMedia 监听全程只建立一次，
 * 全部组件共享同一响应式来源（避免每个消费组件重复挂载监听）；
 * 惰性初始化保证未挂载消费组件的测试环境不触碰 window API。
 */

import { ref } from 'vue';
import type { Ref } from 'vue';
import type { DeviceKind } from '@/utility/device-kind.js';
import { deviceKind } from '@/utility/device-kind.js';
import { TWITTER_LAYOUT_BREAKPOINTS } from '../domain/index.js';

/**
 * Twitter UI 布局状态：三项均为只读消费语义，组件不得回写。
 */
export type TwitterLayoutState = {
	/** 是否处于移动布局（移动 Shell：底部导航 + 发帖 FAB）。 */
	isMobile: Ref<boolean>;
	/** 是否显示左侧主导航栏。 */
	showSidebar: Ref<boolean>;
	/** 是否显示右侧信息栏。 */
	showRightRail: Ref<boolean>;
};

/**
 * 判定给定视口与设备类型是否处于移动布局。
 *
 * @param viewportWidth 当前视口宽度（px）
 * @param kind 设备类型标识（来自 Misskey 既有 device-kind 探测）
 * @returns 应启用移动布局时返回 true
 */
function isMobileLayout(viewportWidth: number, kind: DeviceKind): boolean {
	return kind === 'smartphone' || viewportWidth <= TWITTER_LAYOUT_BREAKPOINTS.mobile;
}

/** 模块级共享布局状态（惰性初始化，生命周期与模块一致）。 */
let sharedLayoutState: TwitterLayoutState | null = null;

/**
 * 创建共享布局状态：基于权威断点建立响应式 refs 与 matchMedia 监听（仅执行一次）。
 *
 * @returns 三项布局状态的共享只读集合
 */
function createSharedLayoutState(): TwitterLayoutState {
	const isMobile = ref(isMobileLayout(window.innerWidth, deviceKind));
	const showSidebar = ref(window.innerWidth > TWITTER_LAYOUT_BREAKPOINTS.mobile);
	const showRightRail = ref(window.innerWidth >= TWITTER_LAYOUT_BREAKPOINTS.rightRail);

	const mobileMediaQueryList = window.matchMedia(`(max-width: ${TWITTER_LAYOUT_BREAKPOINTS.mobile}px)`);
	const sidebarMediaQueryList = window.matchMedia(`(min-width: ${TWITTER_LAYOUT_BREAKPOINTS.mobile + 1}px)`);
	const rightRailMediaQueryList = window.matchMedia(`(min-width: ${TWITTER_LAYOUT_BREAKPOINTS.rightRail}px)`);

	/** 同步移动布局状态（matchMedia change 回调）。 */
	function syncMobile(): void {
		isMobile.value = isMobileLayout(window.innerWidth, deviceKind);
	}

	/** 同步侧栏显示状态（matchMedia change 回调）。 */
	function syncSidebar(): void {
		showSidebar.value = window.innerWidth > TWITTER_LAYOUT_BREAKPOINTS.mobile;
	}

	/** 同步右栏显示状态（matchMedia change 回调）。 */
	function syncRightRail(): void {
		showRightRail.value = window.innerWidth >= TWITTER_LAYOUT_BREAKPOINTS.rightRail;
	}

	mobileMediaQueryList.addEventListener('change', syncMobile);
	sidebarMediaQueryList.addEventListener('change', syncSidebar);
	rightRailMediaQueryList.addEventListener('change', syncRightRail);

	return {
		isMobile,
		showSidebar,
		showRightRail,
	};
}

/**
 * Twitter UI 布局状态组合函数：返回模块级共享的响应式布局状态。
 *
 * @returns 三项布局状态的共享只读集合（多组件消费同一实例）
 */
export function useTwitterLayout(): TwitterLayoutState {
	sharedLayoutState ??= createSharedLayoutState();
	return sharedLayoutState;
}
