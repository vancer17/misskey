/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 回复查询的页面生命周期适配。
 * 作用：把已确认写入、显示状态与销毁交给单个父帖的查询所有者，不复制实体。
 * 数据链：notePosted／noteDeleted → 合并失效 → 可见且空闲的回复分页器 → DOM。
 */
import { markRaw, onBeforeUnmount } from 'vue';
import type { entities } from 'misskey-js';
import { TwitterRepliesPaginator } from '../store/note-replies.js';
import { useTwitterRefresh } from './use-twitter-refresh.js';
import { useGlobalEvent } from '@/events.js';

/** 首拉由原分页组件负责；已确认写入只定向失效相应父帖。 */
export function useNoteReplies(noteId: string, pageSize: number, visible: () => boolean): TwitterRepliesPaginator {
	const paginator: TwitterRepliesPaginator = markRaw(new TwitterRepliesPaginator(noteId, pageSize));
	const invalidate: () => void = useTwitterRefresh(
		/** 失败保留原集合，并阻止无新意图的自动重试。 */
		async (): Promise<boolean> => {
			await paginator.reload();
			return !paginator.error.value && !paginator.refreshError.value;
		},
		{
			/** 未展开或隐藏面板只保留刷新意图。 */
			visible,
			/** 翻页与刷新串行消费，发布不会覆盖在途旧页。 */
			busy: (): boolean => paginator.fetching.value || paginator.fetchingOlder.value || paginator.refreshing.value,
			/** 新挂载面板的首拉覆盖开始前的写入意图。 */
			initializing: (): boolean => paginator.fetching.value,
		},
	);
	useGlobalEvent('notePosted', /** 回执只定位父帖，回复内容仍由服务端查询确认。 */ (created: entities.Note): void => {
		if (created.replyId === noteId) invalidate();
	});
	useGlobalEvent('noteDeleted', /** 删除载荷只有 ID；在途页尚未入集合时也排队复核，防止旧响应带回已删除回复。 */ (id: string): void => {
		if (paginator.fetching.value || paginator.fetchingOlder.value || paginator.refreshing.value
			|| paginator.items.value.some(/** 只读定位已展示实体。 */ (note: entities.Note): boolean => note.id === id)) invalidate();
	});
	onBeforeUnmount(/** 终止本节点所有在途请求。 */ (): void => { paginator.dispose(); });
	return paginator;
}
