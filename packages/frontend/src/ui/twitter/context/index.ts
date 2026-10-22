/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 轻量上下文公共入口。
 * 作用：向基础组件和页面提供界面识别、响应式布局及纯展示常量与类型。
 * 依赖边界：仅导出轻量组合式函数与领域叶子模块，独立于页面、路由和业务状态。
 */

export { useIsTwitterUi } from '../composables/use-is-twitter-ui.js';
export { useTwitterLayout } from '../composables/use-twitter-layout.js';
export type { TwitterLayoutState } from '../composables/use-twitter-layout.js';
export { TWITTER_LAYOUT_BREAKPOINTS } from '../domain/layout.js';
export { TWITTER_MOTION_DURATIONS } from '../domain/motion.js';
export { TWITTER_PAGE_STATE_TYPES, TWITTER_PAGE_SKELETON_VARIANTS } from '../domain/page-state.js';
export type { TwitterPageStateType, TwitterPageSkeletonVariant } from '../domain/page-state.js';
