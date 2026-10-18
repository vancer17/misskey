/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 用户数据失效适配。
 * 作用：将原发帖／账户／关注信号交给实体或集合的原刷新入口，不保存用户模型。
 */
import { onBeforeUnmount } from 'vue';
import type * as Misskey from 'misskey-js';
import { useGlobalEvent } from '@/events.js';
import { useStream } from '@/stream.js';
import { $i } from '@/i.js';

/** 只按目标标识路由刷新意图，不把关注请求判为已建立关系。 */
export function useTwitterUserEvents(target: () => string | null, invalidate: () => void): void {
	useGlobalEvent('notePosted', /** 实际发布者可能不同于当前登录账户。 */ (note: Misskey.entities.Note): void => {
		if (target() === note.userId) invalidate();
	});
	useGlobalEvent('noteDeleted', /** 删除信号只有 ID；当前实体重新确认，不推算作者或计数。 */ (): void => { if (target() != null) invalidate(); });
	useGlobalEvent('userPinnedNotesChanged', /** 置顶写入确认后定向更新主页。 */ (id: string): void => { if (target() === id) invalidate(); });
	useTwitterRelationshipEvents(target, invalidate);
}

/** 仅适配关系与资料信号；关系列表不会因无关发帖而刷新。 */
export function useTwitterRelationshipEvents(target: () => string | null, invalidate: () => void): void {
	if ($i == null) return;
	const connection: Misskey.IChannelConnection<Misskey.Channels['main']> = useStream().useChannel('main');

	/** 本人关系集合或被操作用户资料可能变化，最终事实仍由查询返回。 */
	function onRelationship(user: Misskey.entities.UserLite): void {
		if (target() === $i?.id || target() === user.id) invalidate();
	}

	/** 账户详细更新只作用于同一目标。 */
	function onMeUpdated(user: Misskey.entities.UserLite): void { if (target() === user.id) invalidate(); }

	connection.on('follow', onRelationship);
	connection.on('unfollow', onRelationship);
	connection.on('followed', onRelationship);
	connection.on('meUpdated', onMeUpdated);
	onBeforeUnmount(/** 释放引用计数的频道，不关闭全局连接。 */ (): void => { connection.dispose(); });
}
