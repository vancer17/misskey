/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：所属频道接口的分页适配。
 * 作用：复用既有鉴权客户端，以多取一条的结果确认后续页，不保存接口响应副本。
 * 数据链：channels/owned 原始响应 → 十条可见结果与排他游标 → 查询状态所有者。
 */
import type { entities } from 'misskey-js';
import type { OwnedChannelsPage } from '../domain/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 每页展示数量的唯一来源，接口额外请求一条以确认后续页。 */
const OWNED_CHANNELS_PAGE_SIZE: number = 10;

/** 将所属频道响应映射为可见页；下一页从最后展示的条目之后继续，避免跳过预读条目。 */
export async function fetchOwnedChannelsPage(untilId: string | null, signal: AbortSignal): Promise<OwnedChannelsPage> {
	const channels: entities.Channel[] = await misskeyApi('channels/owned', {
		limit: OWNED_CHANNELS_PAGE_SIZE + 1,
		...(untilId == null ? {} : { untilId }),
	}, undefined, signal);
	const items: readonly entities.Channel[] = channels.slice(0, OWNED_CHANNELS_PAGE_SIZE);
	const nextCursor: string | null = channels.length > OWNED_CHANNELS_PAGE_SIZE ? items.at(-1)?.id ?? null : null;
	return { items, nextCursor };
}
