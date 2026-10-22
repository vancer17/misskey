/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 频道热门集合的唯一查询状态。
 * 作用：按原接口追加分页；同范围刷新确认完整已加载窗口后原子替换，失败保留内容。
 * 数据链：页面意图 → 热门适配器 → 唯一确认集合 → 只读帖卡；不复制 Paginator 状态。
 */
import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { entities } from 'misskey-js';
import type { ChannelFeaturedOperation, ChannelFeaturedPage, ChannelFeaturedState } from '../domain/index.js';
import { fetchChannelFeatured } from '../adapters/channel-detail.js';

/** 页面所有者持有的热门查询动作；展示组件不直接调用接口。 */
export type ChannelFeaturedQuery = Readonly<{
	state: ComputedRef<ChannelFeaturedState>;
	select: (channelId: string) => void;
	initialize: () => Promise<boolean>;
	reload: (signal?: AbortSignal) => Promise<boolean>;
	loadMore: () => Promise<boolean>;
	retry: () => Promise<boolean>;
	remove: (noteId: string) => void;
	dispose: () => void;
}>;

/** 依原顺序合并已确认页，重复标识不形成第二个帖卡。 */
function appendPage(snapshot: ChannelFeaturedPage, page: ChannelFeaturedPage): ChannelFeaturedPage {
	const items: entities.Note[] = [...snapshot.items];
	const ids: Set<string> = new Set(items.map(/** 取帖子身份作为去重依据。 */ (note: entities.Note): string => note.id));
	for (const note of page.items) {
		if (!ids.has(note.id)) { ids.add(note.id); items.push(note); }
	}
	return { items, nextCursor: page.nextCursor };
}

/** 创建频道范围独占集合；请求期间不发布半成品刷新结果。 */
export function createChannelFeaturedQuery(): ChannelFeaturedQuery {
	const settled: ShallowRef<ChannelFeaturedState> = shallowRef<ChannelFeaturedState>({ channelId: null, status: 'idle', operation: 'initial', snapshot: null });
	const active: ShallowRef<ChannelFeaturedOperation | null> = shallowRef<ChannelFeaturedOperation | null>(null);
	const removed: Set<string> = new Set<string>();
	let controller: AbortController | null = null;
	let generation: number = 0;
	let disposed: boolean = false;
	const state: ComputedRef<ChannelFeaturedState> = computed(/** 公开状态复用唯一确认集合，加载时不复制列表。 */ (): ChannelFeaturedState => active.value == null ? settled.value : { ...settled.value, status: 'loading', operation: active.value });

	/** 新频道取消旧请求并清除旧范围的实体和删除记录。 */
	function select(channelId: string): void {
		if (settled.value.channelId === channelId) return;
		generation += 1;
		controller?.abort();
		controller = null;
		active.value = null;
		removed.clear();
		settled.value = { channelId, status: 'idle', operation: 'initial', snapshot: null };
	}

	/** 删除事件立刻作用于唯一集合，并防止已在途响应重新插入删除帖。 */
	function remove(noteId: string): void {
		removed.add(noteId);
		const snapshot: ChannelFeaturedPage | null = settled.value.snapshot;
		if (snapshot == null) return;
		settled.value = { ...settled.value, snapshot: { ...snapshot, items: snapshot.items.filter(/** 只撤下已明确删除的身份。 */ (note: entities.Note): boolean => note.id !== noteId) } };
	}

	/** 首拉、刷新与追加共享取消和世代校验；后续页失败不损坏已经确认的范围。 */
	async function requestPage(operation: ChannelFeaturedOperation, signal?: AbortSignal): Promise<boolean> {
		const channelId: string | null = settled.value.channelId;
		const snapshot: ChannelFeaturedPage | null = settled.value.snapshot;
		if (disposed || signal?.aborted || channelId == null || (operation === 'more' && (active.value != null || snapshot?.nextCursor == null))) return false;
		generation += 1;
		const requestGeneration: number = generation;
		controller?.abort();
		const request: AbortController = new AbortController();
		controller = request;
		active.value = operation;

		/** 将生命周期调度的取消意图转交给当前请求。 */
		function cancel(): void { request.abort(); }

		signal?.addEventListener('abort', cancel, { once: true });
		if (signal?.aborted) cancel();
		try {
			let result: ChannelFeaturedPage = await fetchChannelFeatured(channelId, operation === 'more' ? snapshot?.nextCursor ?? null : null, request.signal);
			if (operation === 'refresh') {
				const oldestRetainedId: string | null = snapshot?.items.at(-1)?.id ?? null;
				// 新帖可能已占满原数量，仍须跨过原最旧标识才能确认完整旧窗口。
				while (result.nextCursor != null && (result.items.length < (snapshot?.items.length ?? 0) || (oldestRetainedId != null && result.nextCursor > oldestRetainedId))) {
					const cursor: string = result.nextCursor;
					const page: ChannelFeaturedPage = await fetchChannelFeatured(channelId, cursor, request.signal);
					result = appendPage(result, page);
					if (page.nextCursor === cursor) break;
				}
			}
			if (disposed || request.signal.aborted || generation !== requestGeneration) return false;
			const combined: ChannelFeaturedPage = operation === 'more' && snapshot != null ? appendPage(snapshot, result) : result;
			settled.value = { channelId, status: 'ready', operation, snapshot: { ...combined, items: combined.items.filter(/** 在途期间的删除事实优先于旧响应。 */ (note: entities.Note): boolean => !removed.has(note.id)) } };
			return true;
		} catch (error: unknown) {
			if (!disposed && !request.signal.aborted && generation === requestGeneration) settled.value = { ...settled.value, status: 'error', operation };
			return false;
		} finally {
			signal?.removeEventListener('abort', cancel);
			if (generation === requestGeneration) { controller = null; active.value = null; }
		}
	}

	/** 首次可见时仅初始化尚未尝试的查询，成功空集合也不会反复首拉。 */
	function initialize(): Promise<boolean> { return state.value.status === 'idle' ? requestPage('initial') : Promise.resolve(false); }

	/** 同查询刷新保留内容，只有完整确认后替换集合。 */
	function reload(signal?: AbortSignal): Promise<boolean> { return requestPage(settled.value.snapshot == null ? 'initial' : 'refresh', signal); }

	/** 追加以最后确认的协议游标继续，不把短页误判为结束。 */
	function loadMore(): Promise<boolean> { return requestPage('more'); }

	/** 重试原失败操作，追加失败不意外变成整表刷新。 */
	function retry(): Promise<boolean> { return state.value.status !== 'error' ? Promise.resolve(false) : requestPage(settled.value.operation); }

	/** 页面卸载后取消请求并永久废弃旧响应。 */
	function dispose(): void { disposed = true; generation += 1; controller?.abort(); }

	return { state, select, initialize, reload, loadMore, retry, remove, dispose };
}
