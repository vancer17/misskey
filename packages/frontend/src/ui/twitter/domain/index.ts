/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 模块索引
 *
 * 作用：集中暴露 Twitter UI 领域层的权威常量与类型
 * （代码规范第 6 条：模块对外 API 经索引文件顶层暴露，禁止跨模块直引内部实现文件）。
 */

export { TWITTER_LAYOUT_BREAKPOINTS } from './layout.js';
export { TWITTER_MOTION_DURATIONS } from './motion.js';
export { TWITTER_PAGE_STATE_TYPES, TWITTER_PAGE_SKELETON_VARIANTS } from './page-state.js';
export type { TwitterPageStateType, TwitterPageSkeletonVariant } from './page-state.js';
