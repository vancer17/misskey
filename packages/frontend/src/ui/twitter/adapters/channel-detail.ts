/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：频道详情与热门帖子协议适配。
 * 作用：复用 Misskey 客户端鉴权与取消机制，将协议失败和排他游标交给查询所有者。
 * 数据链：channels/show、notes/featured → 权威实体／分页结果 → store；不保存响应副本。
 */
import type { entities } from 'misskey-js';
import type { ChannelFeaturedPage } from '../domain/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 将既有频道接口映射到查询所有者，不创建另一份频道业务类型。 */
export function fetchChannelDetail(channelId: string, signal: AbortSignal): Promise<entities.Channel> {
	return misskeyApi('channels/show', { channelId }, undefined, signal);
}

/** 只将后端明确的频道不存在错误映射为终态，其余错误仍允许重试。 */
export function isChannelNotFound(error: unknown): boolean {
	return typeof error === 'object' && error != null && 'code' in error && error.code === 'NO_SUCH_CHANNEL';
}

/** 复用原分页器首拉十条／追加三十条协议；过滤可能产生短页，只有空页确认结束。 */
export async function fetchChannelFeatured(channelId: string, untilId: string | null, signal: AbortSignal): Promise<ChannelFeaturedPage> {
	const items: entities.Note[] = await misskeyApi('notes/featured', {
		channelId,
		limit: untilId == null ? 10 : 30,
		...(untilId == null ? {} : { untilId }),
	}, undefined, signal);
	return { items, nextCursor: items.at(-1)?.id ?? null };
}
