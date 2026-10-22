/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 帖子直接回复协议适配。
 * 作用：按真实 replies 游标读取单页或已展示窗口，引用帖不进入回复集合。
 * 数据链：父帖标识与已确认窗口边界 → notes/replies → 请求局部结果；不持有第二份业务状态。
 */
import type { entities } from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 单次读取的协议结果，更多标记由服务端多返回的一项单向派生。 */
export type TwitterRepliesPage = Readonly<{
	/** 本次确认的可见直接回复。 */
	items: entities.Note[];
	/** 当前窗口之后仍有服务端确认的回复。 */
	hasMore: boolean;
}>;

/** 多取一项确认下一页，不把回复计数当作当前用户可见集合的分页依据。 */
export async function fetchTwitterRepliesPage(
	noteId: string,
	pageSize: number,
	untilId: string | undefined,
	signal: AbortSignal,
): Promise<TwitterRepliesPage> {
	const notes: entities.Note[] = await misskeyApi('notes/replies', {
		noteId,
		limit: pageSize + 1,
		...(untilId == null ? {} : { untilId }),
	}, undefined, signal);
	return {
		/** 额外条目只用于判定更多，下次仍由已展示末项作为游标读取。 */
		items: notes.slice(0, pageSize),
		/** 只有真实响应证明还有下一页。 */
		hasMore: notes.length > pageSize,
	};
}

/** 刷新时读到原窗口末标识，完整成功后再交给唯一查询所有者提交。 */
export async function fetchTwitterRepliesWindow(
	noteId: string,
	pageSize: number,
	oldestRetainedId: string | undefined,
	signal: AbortSignal,
): Promise<TwitterRepliesPage> {
	const items: entities.Note[] = [];
	let untilId: string | undefined;
	while (true) {
		const page: TwitterRepliesPage = await fetchTwitterRepliesPage(noteId, pageSize, untilId, signal);
		items.push(...page.items);
		const lastId: string | undefined = page.items.at(-1)?.id;
		if (!page.hasMore || oldestRetainedId == null || (lastId != null && lastId <= oldestRetainedId)) {
			return { items, hasMore: page.hasMore };
		}
		if (lastId == null || (untilId != null && lastId >= untilId)) {
			throw new Error('Reply pagination did not advance');
		}
		untilId = lastId;
	}
}
