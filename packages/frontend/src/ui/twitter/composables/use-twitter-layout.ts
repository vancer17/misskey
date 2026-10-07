/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · composables 层 · 布局响应式组合函数
 *
 * 作用：将 domain 权威断点常量转换为组件可消费的响应式布局状态
 * （是否移动端 / 是否显示侧栏 / 是否显示右栏），并管理 matchMedia
 * 监听的挂载与卸载生命周期。
 *
 * 数据链角色：domain/layout.ts（权威常量）→ 本组合函数（状态派生）
 * → twitter.vue 等 Shell 组件（唯一消费点）；组件与样式不得另行复制断点。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';
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

/**
 * Twitter UI 布局状态组合函数：基于权威断点生成响应式布局状态。
 *
 * @returns 三项布局状态的只读集合
 */
export function useTwitterLayout(): TwitterLayoutState {
	const isMobile = ref(isMobileLayout(window.innerWidth, deviceKind));
	const showSidebar = ref(window.innerWidth > TWITTER_LAYOUT_BREAKPOINTS.mobile);
	const showRightRail = ref(window.innerWidth >= TWITTER_LAYOUT_BREAKPOINTS.rightRail);

	let mobileMediaQueryList: MediaQueryList | null = null;
	let sidebarMediaQueryList: MediaQueryList | null = null;
	let rightRailMediaQueryList: MediaQueryList | null = null;

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

	onMounted(() => {
		mobileMediaQueryList = window.matchMedia(`(max-width: ${TWITTER_LAYOUT_BREAKPOINTS.mobile}px)`);
		sidebarMediaQueryList = window.matchMedia(`(min-width: ${TWITTER_LAYOUT_BREAKPOINTS.mobile + 1}px)`);
		rightRailMediaQueryList = window.matchMedia(`(min-width: ${TWITTER_LAYOUT_BREAKPOINTS.rightRail}px)`);

		mobileMediaQueryList.addEventListener('change', syncMobile);
		sidebarMediaQueryList.addEventListener('change', syncSidebar);
		rightRailMediaQueryList.addEventListener('change', syncRightRail);
	});

	onBeforeUnmount(() => {
		mobileMediaQueryList?.removeEventListener('change', syncMobile);
		sidebarMediaQueryList?.removeEventListener('change', syncSidebar);
		rightRailMediaQueryList?.removeEventListener('change', syncRightRail);
	});

	return {
		isMobile,
		showSidebar,
		showRightRail,
	};
}
