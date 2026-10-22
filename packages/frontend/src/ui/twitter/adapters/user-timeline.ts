/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 用户资料帖子协议适配。
 * 作用：将现有资料标签映射为 Misskey 请求参数，保留既有排序与日期锚点协议。
 * 数据链：领域账户／标签与分页参数 → 既有真实 API → 已确认帖子；不缓存业务列表。
 */
import type { Endpoints, entities } from 'misskey-js';
import type { TwitterUserTimelineTab } from '../domain/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 资料列表仅使用既有两个 API；参数类型直接派生自接口 Schema。 */
export type TwitterUserTimelineRequest = Readonly<{
	endpoint: 'users/notes' | 'users/featured-notes';
	params: Endpoints['users/notes']['req'] | Endpoints['users/featured-notes']['req'];
}>;

/** 继承分页器的首批读取锚点，不在适配器中创建第二份分页状态。 */
export type TwitterUserTimelineAnchor = Readonly<{
	initialId: string | null;
	initialDate: number | null;
	initialDirection: 'older' | 'newer';
	retainedCount: number;
	oldestRetainedId: string | null;
}>;

/** 将唯一标签映射为既有请求，禁止为同一用户集合复制筛选事实。 */
export function createTwitterUserTimelineRequest(userId: string, tab: TwitterUserTimelineTab): TwitterUserTimelineRequest {
	if (tab === 'featured') return { endpoint: 'users/featured-notes', params: { userId } };
	return {
		/** 普通帖、回复和附件使用同一既有端点。 */
		endpoint: 'users/notes',
		/** users/notes 不支持同时开启 withFiles 和 withReplies。 */
		params: {
			userId,
			withRenotes: tab === 'notes',
			withReplies: tab === 'replies',
			withChannelNotes: tab !== 'replies',
			...(tab === 'files' ? { withFiles: true } : {}),
		},
	};
}

/** 读取真实首批及已加载范围；回访跨越原最旧标识，避免刷新后截断深层滚动内容。 */
export async function fetchTwitterUserTimelineWindow(request: TwitterUserTimelineRequest, anchor: TwitterUserTimelineAnchor, signal: AbortSignal): Promise<entities.Note[]> {
	const items: entities.Note[] = await misskeyApi<entities.Note[]>(request.endpoint, {
		...request.params,
		limit: Math.min(100, Math.max(20, anchor.retainedCount)),
		allowPartial: true,
		...(anchor.initialDirection === 'newer' ? {
			...(anchor.initialId == null && anchor.initialDate == null ? { sinceId: '0' } : {
				sinceId: anchor.initialId ?? undefined,
				sinceDate: anchor.initialDate ?? undefined,
			}),
		} : {
			untilId: anchor.initialId ?? undefined,
			untilDate: anchor.initialDate ?? undefined,
		}),
	}, undefined, signal);
	if ((anchor.initialId != null || anchor.initialDate != null) && anchor.initialDirection === 'newer') items.reverse();
	if (anchor.initialDirection === 'older' && anchor.oldestRetainedId != null) {
		const ids: Set<string> = new Set(items.map(/** 当前请求内去重，不维护持久集合副本。 */ (note: entities.Note): string => note.id));
		let cursor: string | null = oldestId(items);
		while (cursor != null && cursor > anchor.oldestRetainedId) {
			const page: entities.Note[] = await misskeyApi<entities.Note[]>(request.endpoint, {
				...request.params,
				limit: 100,
				allowPartial: true,
				untilId: cursor,
			}, undefined, signal);
			const nextCursor: string | null = oldestId(page);
			if (nextCursor == null || nextCursor >= cursor) break;
			for (const note of page) {
				if (ids.has(note.id)) continue;
				ids.add(note.id);
				items.push(note);
			}
			cursor = nextCursor;
		}
	}
	return items;
}

/** 从本次请求结果派生向后翻页游标；不依赖组件或路由的业务副本。 */
function oldestId(items: readonly entities.Note[]): string | null {
	return items.reduce(/** 与既有分页器相同，按标识求游标而不假定响应排序。 */ (oldest: string | null, note: entities.Note): string => oldest == null || note.id < oldest ? note.id : oldest, null as string | null);
}
