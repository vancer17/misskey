/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：页面生命周期内唯一的所属频道查询状态。
 * 作用：持有已确认快照，串行追加并允许刷新替换旧请求；窗口只消费只读投影。
 * 数据链：页面初始化／刷新／重试意图 → 分页适配器 → 唯一快照 → 原界面与 Twitter 窗口。
 */
import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { entities } from 'misskey-js';
import type { OwnedChannelsOperation, OwnedChannelsPage, OwnedChannelsState, TwitterCommunityLibraryView } from '../domain/index.js';
import { fetchOwnedChannelsPage } from '../adapters/owned-channels.js';

/** 不在请求中的已确认状态；请求取消时直接保留该状态，不重新构造业务快照。 */
type OwnedChannelsSettledState = Exclude<OwnedChannelsState, { status: 'loading' }>;

/** 当前请求的生命周期上下文，不保存另一份频道集合。 */
type OwnedChannelsRequest = Readonly<{
	generation: number;
	operation: OwnedChannelsOperation;
	controller: AbortController;
}>;

/** 页面所有者可调用的查询动作；组件只读取 computed 投影并向所有者提交意图。 */
export type OwnedChannelsQuery = Readonly<{
	state: ComputedRef<OwnedChannelsState>;
	view: ComputedRef<TwitterCommunityLibraryView>;
	initialize: () => Promise<boolean>;
	reload: (signal?: AbortSignal) => Promise<boolean>;
	loadMore: () => Promise<boolean>;
	retry: () => Promise<boolean>;
	dispose: () => void;
}>;

/** 追加确认页并按权威频道标识去重；下一游标始终取本次响应的协议结果。 */
function appendPage(snapshot: OwnedChannelsPage, page: OwnedChannelsPage): OwnedChannelsPage {
	const items: entities.Channel[] = [...snapshot.items];
	const ids: Set<string> = new Set(items.map(/** 提取既有条目的身份以避免追加重复。 */ (channel: entities.Channel): string => channel.id));
	for (const channel of page.items) {
		if (ids.has(channel.id)) continue;
		ids.add(channel.id);
		items.push(channel);
	}
	return { items, nextCursor: page.nextCursor };
}

/** 创建页面独占查询；返回值为动作是否成功，未发起或失效的动作返回 false。 */
export function createOwnedChannelsQuery(): OwnedChannelsQuery {
	const settled: ShallowRef<OwnedChannelsSettledState> = shallowRef<OwnedChannelsSettledState>({ status: 'idle', snapshot: null });
	const activeRequest: ShallowRef<OwnedChannelsRequest | null> = shallowRef<OwnedChannelsRequest | null>(null);
	let generation: number = 0;
	let disposed: boolean = false;

	const state: ComputedRef<OwnedChannelsState> = computed(/** 从唯一已确认状态和当前请求派生公开状态。 */ (): OwnedChannelsState => {
		const request: OwnedChannelsRequest | null = activeRequest.value;
		return request == null ? settled.value : { status: 'loading', operation: request.operation, snapshot: settled.value.snapshot };
	});
	const view: ComputedRef<TwitterCommunityLibraryView> = computed(/** 为只读窗口派生列表、请求状态和后续能力，不保存展示副本。 */ (): TwitterCommunityLibraryView => {
		const current: OwnedChannelsState = state.value;
		return {
			items: current.snapshot?.items ?? [],
			status: current.status === 'idle' ? 'loading' : current.status,
			hasMore: current.snapshot?.nextCursor != null,
		};
	});

	/** 只允许当前请求世代发布成功、失败或清理结果。 */
	function isCurrentRequest(request: OwnedChannelsRequest): boolean {
		return !disposed && generation === request.generation;
	}

	/** 执行实际取页；刷新替换在途追加，取消则继续保留最近已确认状态。 */
	async function requestPage(operation: OwnedChannelsOperation, signal?: AbortSignal): Promise<boolean> {
		if (disposed || signal?.aborted) return false;
		const snapshot: OwnedChannelsPage | null = settled.value.snapshot;
		if (operation === 'more' && (activeRequest.value != null || snapshot?.nextCursor == null)) return false;

		generation += 1;
		activeRequest.value?.controller.abort();
		const request: OwnedChannelsRequest = {
			/** 新请求先占用世代，旧请求的取消回调不能恢复或清理当前状态。 */
			generation,
			/** 请求用途决定成功后替换集合还是追加页。 */
			operation,
			/** 每次请求独占取消信号，外部刷新 signal 只转发到该请求。 */
			controller: new AbortController(),
		};
		activeRequest.value = request;

		/** 将刷新调度的取消意图转交给当前请求，不修改其他请求的控制器。 */
		function cancelRequest(): void {
			request.controller.abort();
		}

		signal?.addEventListener('abort', cancelRequest, { once: true });
		if (signal?.aborted) cancelRequest();

		try {
			const page: OwnedChannelsPage = await fetchOwnedChannelsPage(operation === 'more' ? snapshot?.nextCursor ?? null : null, request.controller.signal);
			if (!isCurrentRequest(request) || request.controller.signal.aborted) return false;
			settled.value = { status: 'ready', snapshot: operation === 'more' && snapshot != null ? appendPage(snapshot, page) : page };
			return true;
		} catch (error: unknown) {
			if (isCurrentRequest(request) && !request.controller.signal.aborted) {
				settled.value = { status: 'error', operation, snapshot, error };
			}
			return false;
		} finally {
			signal?.removeEventListener('abort', cancelRequest);
			if (isCurrentRequest(request)) activeRequest.value = null;
		}
	}

	/** 只处理尚未尝试的首拉；失败与成功空集合均由现有状态阻止隐式重复初始化。 */
	function initialize(): Promise<boolean> {
		return state.value.status === 'idle' ? requestPage('initial') : Promise.resolve(false);
	}

	/** 显式刷新优先于旧请求，只有成功响应才替换现有频道快照。 */
	function reload(signal?: AbortSignal): Promise<boolean> {
		return requestPage(settled.value.snapshot == null ? 'initial' : 'refresh', signal);
	}

	/** 在空闲且已观察到后续页时追加；失败后游标保持不变以供同页重试。 */
	function loadMore(): Promise<boolean> {
		return requestPage('more');
	}

	/** 重放真正失败的操作，追加失败不能误触发整表刷新。 */
	function retry(): Promise<boolean> {
		const current: OwnedChannelsState = state.value;
		if (current.status !== 'error') return Promise.resolve(false);
		return current.operation === 'more' ? loadMore() : reload();
	}

	/** 页面卸载时释放请求并使全部旧响应失效；关闭展示窗口不调用此动作。 */
	function dispose(): void {
		disposed = true;
		generation += 1;
		activeRequest.value?.controller.abort();
		activeRequest.value = null;
	}

	return { state, view, initialize, reload, loadMore, retry, dispose };
}
