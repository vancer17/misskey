/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 频道页的导航与频道资料库查询模型。
 * 作用：集中定义导航、所属频道分页事实及资料库只读投影，频道实体沿用 misskey-js。
 * 数据链：频道接口 → 所属频道查询所有者 → 资料库展示投影 → 只读组件。
 */
import type { entities } from 'misskey-js';

/** 频道主页的两个内容入口，分别消费关注频道流和全频道流。 */
export type TwitterCommunitiesTab = 'home' | 'explore';

/** 脱离主帖子流展示的管理／收藏资料库入口。 */
export type TwitterCommunityLibrary = 'owned' | 'favorites';

/** 所属频道的已确认分页结果；游标为空表示该次请求没有观察到后续条目。 */
export type OwnedChannelsPage = Readonly<{
	items: readonly entities.Channel[];
	nextCursor: string | null;
}>;

/** 所属频道请求在集合数据链中的用途，用于恢复正确的失败操作。 */
export type OwnedChannelsOperation = 'initial' | 'refresh' | 'more';

/** 所属频道查询的唯一公开状态，区分未初始化、成功空集合和带旧快照的请求。 */
export type OwnedChannelsState =
	| Readonly<{ status: 'idle'; snapshot: null }>
	| Readonly<{
		status: 'loading';
		operation: OwnedChannelsOperation;
		snapshot: OwnedChannelsPage | null;
	}>
	| Readonly<{ status: 'ready'; snapshot: OwnedChannelsPage }>
	| Readonly<{
		status: 'error';
		operation: OwnedChannelsOperation;
		snapshot: OwnedChannelsPage | null;
		error: unknown;
	}>;

/** 管理与收藏窗口共用的只读展示投影；加载能力由各自查询所有者派生。 */
export type TwitterCommunityLibraryView = Readonly<{
	items: OwnedChannelsPage['items'];
	status: 'loading' | 'ready' | 'error';
	hasMore: boolean;
}>;
