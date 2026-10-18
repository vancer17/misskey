/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 页面刷新调度。
 * 作用：合并写入与缓存回访的 UI 刷新意图，不持有实体或集合副本。
 * 数据链：成功信号／实际停用 → 可见且空闲时消费 → 原数据所有者取数。
 */
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue';
import type { IPaginator } from '@/utility/paginator.js';

/** 调度依赖均为 UI 生命周期或既有请求状态，不解释业务及环境策略。 */
type RefreshOptions = Readonly<{
	visible?: () => boolean;
	busy?: () => boolean;
	initializing?: () => boolean;
}>;

/** 返回唯一失效入口；真实初次请求仍由调用者或原分页组件负责。 */
export function useTwitterRefresh(
	refresh: (signal: AbortSignal) => Promise<boolean>,
	options: RefreshOptions = {},
): () => void {
	let mounted: boolean = false;
	let active: boolean = true;
	let disposed: boolean = false;
	let pending: boolean = false;
	let running: boolean = false;
	let failed: boolean = false;
	let controller: AbortController | null = null;

	/** 延迟到本轮挂载结束再检查，避免与 v-if 子分页器的 init 竞争。 */
	async function flush(): Promise<void> {
		await nextTick();
		if (disposed || !mounted || !active || !pending || running || failed || options.visible?.() === false || options.busy?.()) return;
		pending = false;
		running = true;
		const request: AbortController = new AbortController();
		controller = request;
		try {
			failed = !await refresh(request.signal) && !pending;
		} catch (error: unknown) {
			failed = !pending;
			if (!request.signal.aborted) console.error(error);
		} finally {
			running = false;
			if (controller === request) controller = null;
		}
		// 在途时的新写入仍保留；失败只能由新意图／用户重试恢复，不循环轰炸 API。
		if (pending && !failed) void flush();
	}

	/** 只标记失效，不把当前实体、表单或路由参数变成业务事实。 */
	function invalidate(): void {
		if (disposed) return;
		pending = true;
		failed = false;
		void flush();
	}

	onMounted(/** 首次挂载不主动重复加载。 */ (): void => { mounted = true; void flush(); });
	onDeactivated(/** 真正停用才留下回访意图，模态遮挡不算停用。 */ (): void => { active = false; pending = true; failed = false; });
	onActivated(/** 晚挂载子树首次回访也会消费已有意图。 */ (): void => { active = true; void flush(); });
	onBeforeUnmount(/** 释放自身请求；原分页器不具备取消能力，不伪造该契约。 */ (): void => { disposed = true; controller?.abort(); });
	watch(
		/** 可见与忙闲只影响调度，不形成业务状态副本。 */ (): readonly boolean[] => [options.visible?.() ?? true, options.busy?.() ?? false],
		/** 请求结束或面板出现后尝试消费。 */ (): void => { void flush(); },
		{ flush: 'post' },
	);
	if (options.initializing) {
		watch(options.initializing, /** 新挂载的原生 init 已覆盖开始前的意图；开始后的写入仍会排队。 */ (initializing: boolean): void => {
			if (initializing && !running) { pending = false; failed = false; }
		}, { flush: 'sync' });
	}
	return invalidate;
}

/** 复用原分页器公开状态与 reload，不直接写 items，不把空集合视为未初始化。 */
export function useTwitterPaginatorRefresh(
	source: () => IPaginator | null,
	visible: () => boolean = /** 默认消费当前页面可见集合。 */ (): boolean => true,
): () => void {
	return useTwitterRefresh(
		/** 结果成功性由分页器自身的错误状态决定。 */ async (): Promise<boolean> => {
			const paginator: IPaginator | null = source();
			if (paginator == null) return true;
			await paginator.reload();
			return !paginator.error.value;
		}, {
			visible: /** 只有真实存在的显示面板才发起刷新。 */ (): boolean => source() != null && visible(),
			busy: /** 同时尊重首拉、旧页和新页请求。 */ (): boolean => {
				const paginator: IPaginator | null = source();
				return paginator == null || paginator.fetching.value || paginator.fetchingOlder.value || paginator.fetchingNewer.value;
			},
			initializing: /** init 开始时可替代此前已排队的回访请求。 */ (): boolean => source()?.fetching.value ?? false,
		},
	);
}
