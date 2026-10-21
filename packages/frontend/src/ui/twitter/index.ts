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
export { default as TwitterSettingsShell } from './SettingsShell.vue';
export { default as TwitterNote } from './Note.vue';
export { default as TwitterSearchField } from './SearchField.vue';
/** 频道集合的横向展示及独立管理／收藏窗口。 */
export { default as TwitterCommunityStrip } from './components/TwitterCommunityStrip.vue';
export { default as TwitterCommunityLibraryDialog } from './components/TwitterCommunityLibraryDialog.vue';
export type { TwitterCommunitiesTab, TwitterCommunityLibrary } from './domain/index.js';
export { default as TwitterWelcome } from './components/TwitterWelcome.vue';
export { default as TwitterAuthButtons } from './components/TwitterAuthButtons.vue';

/** 主内容头像与挂件预览共用同一场景边界和素材坐标。 */
export { default as TwitterAvatar } from './components/TwitterAvatar.vue';
export { default as TwitterAvatarDecorationPreview } from './components/TwitterAvatarDecorationPreview.vue';
/** 管理入口使用的静态素材校准；通过真实上传命令确认后交付新图片。 */
export { default as TwitterAvatarDecorationCalibrationDialog } from './components/TwitterAvatarDecorationCalibrationDialog.vue';
export type { TwitterAvatarDecoration, TwitterAvatarDecorationContext } from './domain/index.js';

/** 当前账户身份的只读展示派生，不改变输入业务模型。 */
export { useTwitterDisplayUser } from './composables/use-twitter-display-user.js';

/** 主视口滚动及独立页面回退的 UI 协调入口。 */
export { provideTwitterScrollHost, useTwitterScrollPositionKeeper } from './composables/use-twitter-scroll-host.js';
/** 写入与回访的 UI 调度，业务实体仍归原数据所有者。 */
export { useTwitterRefresh, useTwitterPaginatorRefresh } from './composables/use-twitter-refresh.js';
/** 会话级计数展示投影，不参与业务决策。 */
export { useTwitterNoteCounters } from './store/note-counters.js';
export type { TwitterNoteCounters } from './domain/note-counters.js';
/** 用户写入和关注信号的只读失效适配。 */
export { useTwitterUserEvents, useTwitterRelationshipEvents } from './composables/use-twitter-user-events.js';
