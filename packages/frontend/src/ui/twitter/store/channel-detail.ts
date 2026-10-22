/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：频道详情唯一查询状态。
 * 作用：保留同范围确认结果，隔离路由切换、取消与迟到响应，接收已确认关系命令结果。
 * 数据链：路由频道标识／刷新意图 → 协议适配器 → 只读状态 → 页面；不解释运行环境。
 */
import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { entities } from 'misskey-js';
import type { ChannelDetailState } from '../domain/index.js';
import { fetchChannelDetail, isChannelNotFound } from '../adapters/channel-detail.js';

/** 查询所有者的公开动作，实体与状态只有这一处存储。 */
export type ChannelDetailQuery = Readonly<{
	state: ComputedRef<ChannelDetailState>;
	select: (channelId: string) => Promise<boolean>;
	reload: (signal?: AbortSignal) => Promise<boolean>;
	confirmFavorite: (channelId: string, favorited: boolean) => void;
	confirmMuted: (channelId: string, muted: boolean) => void;
	dispose: () => void;
}>;

/** 创建页面生命周期内独占查询；现有 Misskey store 模式以只读 ref 和动作暴露状态。 */
export function createChannelDetailQuery(): ChannelDetailQuery {
	const settled: ShallowRef<ChannelDetailState> = shallowRef<ChannelDetailState>({ channelId: null, status: 'idle', channel: null });
	const pending: ShallowRef<boolean> = shallowRef<boolean>(false);
	let controller: AbortController | null = null;
	let generation: number = 0;
	let disposed: boolean = false;
	const state: ComputedRef<ChannelDetailState> = computed(/** 请求状态从唯一确认实体派生，刷新不清空内容。 */ (): ChannelDetailState => pending.value ? { ...settled.value, status: 'loading' } : settled.value);

	/** 当前请求占有世代才允许发布结果，外部信号只能取消本次请求。 */
	async function reload(signal?: AbortSignal): Promise<boolean> {
		const channelId: string | null = settled.value.channelId;
		if (disposed || signal?.aborted || channelId == null) return false;
		generation += 1;
		const requestGeneration: number = generation;
		controller?.abort();
		const request: AbortController = new AbortController();
		controller = request;
		pending.value = true;

		/** 将页面刷新取消转发至本次协议请求。 */
		function cancel(): void { request.abort(); }

		signal?.addEventListener('abort', cancel, { once: true });
		if (signal?.aborted) cancel();
		try {
			const channel: entities.Channel = await fetchChannelDetail(channelId, request.signal);
			if (disposed || request.signal.aborted || generation !== requestGeneration) return false;
			settled.value = { channelId, status: 'ready', channel };
			return true;
		} catch (error: unknown) {
			if (!disposed && !request.signal.aborted && generation === requestGeneration) {
				const notFound: boolean = isChannelNotFound(error);
				settled.value = { channelId, status: notFound ? 'notFound' : 'error', channel: notFound ? null : settled.value.channel };
			}
			return false;
		} finally {
			signal?.removeEventListener('abort', cancel);
			if (generation === requestGeneration) { controller = null; pending.value = false; }
		}
	}

	/** 新路由范围立即撤下旧实体；相同标识的重新确认保留现有资料。 */
	function select(channelId: string): Promise<boolean> {
		if (settled.value.channelId !== channelId) settled.value = { channelId, status: 'idle', channel: null };
		return reload();
	}

	/** 收藏命令成功后更新唯一实体；迟到命令不能写入其他频道。 */
	function confirmFavorite(channelId: string, favorited: boolean): void {
		if (settled.value.channel?.id !== channelId) return;
		settled.value = { ...settled.value, channel: { ...settled.value.channel, isFavorited: favorited } };
		void reload();
	}

	/** 静音命令成功后替换实体字段，组件不能直接修改 props。 */
	function confirmMuted(channelId: string, muted: boolean): void {
		if (settled.value.channel?.id !== channelId) return;
		settled.value = { ...settled.value, channel: { ...settled.value.channel, isMuting: muted } };
		void reload();
	}

	/** 卸载释放在途请求，使迟到结果永久失效。 */
	function dispose(): void { disposed = true; generation += 1; controller?.abort(); }

	return { state, select, reload, confirmFavorite, confirmMuted, dispose };
}
