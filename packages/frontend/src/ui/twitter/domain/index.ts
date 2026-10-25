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
export { RIGHT_RAIL_LIMITS } from './right-rail.js';
export type { TwitterTrendItem } from './right-rail.js';
export { twitterUserErrorStateType } from './user-state.js';

/** 服务端确认帖子计数的只读展示投影。 */
export type { TwitterNoteCounters } from './note-counters.js';

/** 头像挂件展示场景及既有佩戴实体的只读预览投影。 */
export type { TwitterAvatarDecoration, TwitterAvatarDecorationContext } from './avatar-decoration.js';
/** 静态素材制作规格与临时编辑坐标，不进入服务端佩戴协议。 */
export { TWITTER_AVATAR_DECORATION_CALIBRATION } from './avatar-decoration.js';
export type { TwitterAvatarDecorationCalibrationTransform, TwitterAvatarDecorationMaterialFailure } from './avatar-decoration.js';

/** 频道页导航、所属频道分页事实与资料库只读展示的唯一类型来源。 */
export type { TwitterCommunitiesTab, TwitterCommunityLibrary, TwitterCommunityLibraryView, OwnedChannelsPage, OwnedChannelsOperation, OwnedChannelsState } from './communities.js';
/** 频道详情与热门集合的查询状态及标签规则。 */
export { getChannelCommunityTabs, resolveChannelCommunityTab } from './channel-detail.js';
export type { ChannelDetailState, ChannelCommunityTab, ChannelFeaturedOperation, ChannelFeaturedPage, ChannelFeaturedState } from './channel-detail.js';
/** 用户主页标签及其独立查询范围。 */
export type { TwitterUserTimelineTab } from './user-timeline.js';
/** 手动时间线查询的唯一结果语义，不由页面或提示文案反向推断。 */
export type { TwitterTimelineRefreshResult } from './timeline-refresh.js';

/** 附件自然尺寸只向临时展示比例派生，不复制文件业务模型。 */
export { getTwitterMediaAspectRatio } from './media-layout.js';
export type { TwitterMediaMeasurement } from './media-layout.js';

/** 搜索容器及路由序列化共享的标签标识。 */
export type { TwitterSearchTab } from './search.js';
