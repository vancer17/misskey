/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 模块索引
 *
 * 作用：向模块外暴露 Twitter UI 的公共 API（代码规范第 6 条：外部新代码
 * 必须经本文件导入，禁止直接引用模块内部实现文件）。
 *
 * 说明：历史 PR 已合入的深路径导入（pages / Mk* 组件直接引用 ui/twitter/*.vue）
 * 维持原样，待对应文件因业务修改时再迁移至本索引，避免无谓变更面。
 */

export { useTwitterLayout } from './composables/use-twitter-layout.js';
export type { TwitterLayoutState } from './composables/use-twitter-layout.js';
export { useIsTwitterUi } from './composables/use-is-twitter-ui.js';
export { TWITTER_LAYOUT_BREAKPOINTS } from './domain/index.js';
export { TWITTER_MOTION_DURATIONS } from './domain/index.js';
export { TWITTER_PAGE_STATE_TYPES, TWITTER_PAGE_SKELETON_VARIANTS } from './domain/index.js';
export type { TwitterPageStateType, TwitterPageSkeletonVariant } from './domain/index.js';
export { twitterUserErrorStateType } from './domain/index.js';
export { default as TwitterPageState } from './components/TwitterPageState.vue';
export { default as TwitterPageSkeleton } from './components/TwitterPageSkeleton.vue';
export { default as TwitterUserResult } from './UserResult.vue';
