/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 频道详情查询与导航规则。
 * 作用：定义频道请求的唯一状态、合法标签及热门帖子集合；频道与帖子实体沿用 misskey-js。
 * 数据链：频道接口 → 查询 store → 只读页面；关系事实只从已确认频道实体单向派生。
 */
import type { entities } from 'misskey-js';

/** 社区详情的合法标签；未知关注关系不产生 Home 入口。 */
export type ChannelCommunityTab = 'home' | 'explore' | 'about' | 'search';

/** 频道查询的唯一公开状态；同一频道刷新期间保留已确认实体。 */
export type ChannelDetailState = Readonly<{
	channelId: string | null;
	status: 'idle' | 'loading' | 'ready' | 'error' | 'notFound';
	channel: entities.Channel | null;
}>;

/** 按已确认关注关系派生可见标签；收藏关系不赋予 Home 权限。 */
export function getChannelCommunityTabs(channel: entities.Channel | null): readonly ChannelCommunityTab[] {
	if (channel == null) return [];
	return channel.isFollowing ? ['home', 'explore', 'about', 'search'] : ['explore', 'about', 'search'];
}

/** 初次确认、加入及退出后统一校正标签；未确认关系时保持未选择状态。 */
export function resolveChannelCommunityTab(channel: entities.Channel | null, selected: ChannelCommunityTab | null, previouslyFollowing: boolean | undefined): ChannelCommunityTab | null {
	if (channel == null) return null;
	if (channel.isFollowing && previouslyFollowing === false) return 'home';
	return selected != null && getChannelCommunityTabs(channel).includes(selected) ? selected : channel.isFollowing ? 'home' : 'explore';
}

/** 热门集合请求的用途；重试恢复失败操作，刷新替换集合，追加使用协议游标。 */
export type ChannelFeaturedOperation = 'initial' | 'refresh' | 'more';

/** 热门集合唯一确认结果；下一游标来自原接口排序，空页表示结束。 */
export type ChannelFeaturedPage = Readonly<{
	items: readonly entities.Note[];
	nextCursor: string | null;
}>;

/** 热门集合状态，首次加载和保留旧结果的刷新可直接区分。 */
export type ChannelFeaturedState = Readonly<{
	channelId: string | null;
	status: 'idle' | 'loading' | 'ready' | 'error';
	operation: ChannelFeaturedOperation;
	snapshot: ChannelFeaturedPage | null;
}>;
