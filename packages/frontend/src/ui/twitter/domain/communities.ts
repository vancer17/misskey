/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 频道页的导航模型。
 * 作用：集中定义主标签和频道资料库入口，不重新定义服务端频道实体或请求状态。
 * 数据链：页面导航意图 → 原分页器可见性调度 → 只读组件；不参与频道资格判断。
 */

/** 频道主页的两个内容入口，分别消费关注频道流和全频道流。 */
export type TwitterCommunitiesTab = 'home' | 'explore';

/** 脱离主帖子流展示的管理／收藏资料库入口。 */
export type TwitterCommunityLibrary = 'owned' | 'favorites';
