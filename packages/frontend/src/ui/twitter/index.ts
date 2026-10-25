/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 模块索引
 *
 * 作用：向模块外暴露 Twitter UI 的展示组件与业务协作 API。
 * 界面识别、响应式布局和纯展示常量通过 context/index.ts 轻量入口公开，
 * 基础组件可独立使用这些能力，避免加载本索引导出的业务组件。
 *
 * 说明：历史 PR 已合入的深路径导入（pages / Mk* 组件直接引用 ui/twitter/*.vue）
 * 维持原样，待对应文件因业务修改时再迁移至本索引，避免无谓变更面。
 */

export { twitterUserErrorStateType } from './domain/index.js';
export { default as TwitterPageState } from './components/TwitterPageState.vue';
export { default as TwitterPageSkeleton } from './components/TwitterPageSkeleton.vue';
/** 横向标签的共享选中指示条，只消费标签标识并维护临时展示几何。 */
export { default as TwitterTabIndicator } from './components/TwitterTabIndicator.vue';
/** 时间线首拉的延显骨架与结果交接，仅消费原查询的只读加载状态。 */
export { default as TwitterTimelineLoadBoundary } from './components/TwitterTimelineLoadBoundary.vue';
/** 路由代码未就绪时的主题一致占位，不读取业务数据。 */
export { default as TwitterRouteLoading } from './components/TwitterRouteLoading.vue';
/** 路由与右栏仅协调现存 DOM 的轻淡入，不持有页面或业务状态。 */
export { useTwitterRouteEntry, useTwitterVisibilityEntry } from './composables/use-twitter-route-entry.js';
export { default as TwitterUserResult } from './UserResult.vue';
export { default as TwitterSettingsShell } from './SettingsShell.vue';
/** 本人成就页只替换页面外观，数据和查看计时继续由原页面及组件持有。 */
export { default as TwitterAchievementsShell } from './components/TwitterAchievementsShell.vue';
export { default as TwitterNote } from './Note.vue';
/** 帖子附件按自身比例排列，所有交互仍交由同一个原有图库处理。 */
export { default as TwitterNoteMedia } from './components/TwitterNoteMedia.vue';
export { default as TwitterSearchField } from './SearchField.vue';
/** 频道集合的横向展示及独立管理／收藏窗口。 */
export { default as TwitterCommunityStrip } from './components/TwitterCommunityStrip.vue';
export { default as TwitterCommunityLibraryDialog } from './components/TwitterCommunityLibraryDialog.vue';
export type { TwitterCommunitiesTab, TwitterCommunityLibrary, TwitterCommunityLibraryView, OwnedChannelsPage, OwnedChannelsOperation, OwnedChannelsState } from './domain/index.js';
/** 页面唯一所属频道查询同时服务原界面与 Twitter 管理窗口。 */
export { createOwnedChannelsQuery } from './store/owned-channels.js';
export type { OwnedChannelsQuery } from './store/owned-channels.js';
/** 所属频道的异步操作在两种界面中保留键盘阅读位置。 */
export { useChannelLibraryFocus } from './composables/use-channel-library-focus.js';
/** 频道管理窗口的临时主列中心坐标，不参与业务状态。 */
export { useCommunityDialogPosition } from './composables/use-community-dialog-position.js';
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
export { provideTwitterScrollHost, useTwitterScrollPositionKeeper, useTwitterSourceScrollReset } from './composables/use-twitter-scroll-host.js';
/** 写入与回访的 UI 调度，业务实体仍归原数据所有者。 */
export { useTwitterRefresh, useTwitterPaginatorRefresh } from './composables/use-twitter-refresh.js';
/** 会话级计数展示投影，不参与业务决策。 */
export { useTwitterNoteCounters } from './store/note-counters.js';
export type { TwitterNoteCounters } from './domain/note-counters.js';
/** 频道详情与热门集合分别持有唯一确认状态，展示组件只读取派生值。 */
export { getChannelCommunityTabs, resolveChannelCommunityTab } from './domain/index.js';
export type { ChannelDetailState, ChannelCommunityTab, ChannelFeaturedOperation, ChannelFeaturedPage, ChannelFeaturedState } from './domain/index.js';
export { createChannelDetailQuery } from './store/channel-detail.js';
export type { ChannelDetailQuery } from './store/channel-detail.js';
export { createChannelFeaturedQuery } from './store/channel-featured.js';
export type { ChannelFeaturedQuery } from './store/channel-featured.js';
export { default as TwitterChannelFeatured } from './components/TwitterChannelFeatured.vue';
/** 个人主页的标签与保留结果刷新仍共用一个分页查询所有者。 */
export type { TwitterUserTimelineTab } from './domain/index.js';
export { TwitterUserTimelinePaginator } from './store/user-timeline.js';
/** 用户写入和关注信号的只读失效适配。 */
export { useTwitterUserEvents, useTwitterRelationshipEvents } from './composables/use-twitter-user-events.js';
/** 首页流式容器及其手动刷新查询所有者，共用原分页集合和流式调用链。 */
export { default as TwitterStreamingTimeline } from './components/TwitterStreamingTimeline.vue';
export { default as TwitterTimelineShell } from './TimelineShell.vue';
export { TwitterTimelinePaginator } from './store/timeline-refresh.js';
export type { TwitterTimelineRefreshController } from './store/timeline-refresh.js';
export type { TwitterTimelineRefreshResult } from './domain/index.js';
