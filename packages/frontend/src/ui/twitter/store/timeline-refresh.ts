/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 流式时间线查询所有者。
 * 作用：以继承分页器的唯一 items 接纳实时事件、翻页与非破坏刷新，页面仅消费结果。
 * 数据链：手动意图／原分页动作 → 真实 API → 归属校验 → 唯一列表 → 原流式组件。
 * 首批、旧页与新页串行；仅保存请求身份、删除标识及刷新期间接纳的标识，不缓存实体快照。
 */
import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { TwitterTimelineRefreshResult } from '../domain/timeline-refresh.js';
import { fetchTwitterTimelineWindow } from '../adapters/timeline-refresh.js';
import { FIRST_FETCH_LIMIT, Paginator, SECOND_FETCH_LIMIT } from '@/utility/paginator.js';
import type { MisskeyEntity, PaginatorCompatibleEndpointPaths, PaginatorCompatibleEndpoints, PaginatorOptions } from '@/utility/paginator.js';

/** 请求控制参数仅复用既有分页协议，不成为业务状态或运行时架构开关。 */
type TimelineRequestCursor = Readonly<{
	limit: number;
	allowPartial?: boolean;
	sinceId?: string;
	untilId?: string;
	sinceDate?: number;
	untilDate?: number;
	offset?: number;
}>;

/** 单次用户意图的控制数据；新帖标识只用于保护请求期间已接纳的真实流事件。 */
type ManualRefreshOperation = {
	baseline: string | null;
	query: string;
	generation: number;
	acceptedIds: Set<string>;
	result: TwitterTimelineRefreshResult;
};

/** 忙碌期间合并的新页读取意图，仅保存协议归属与展示目标。 */
type PendingNewerOperation = Readonly<{
	generation: number;
	query: string;
	toQueue: boolean;
}>;

/** 复用既有分页集合的 Twitter 查询所有者，支持可撤销的非破坏手动刷新。 */
export class TwitterTimelinePaginator<Endpoint extends PaginatorCompatibleEndpointPaths> extends Paginator<Endpoint, PaginatorCompatibleEndpoints[Endpoint], PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity, true> {
	/** 页面只读的手动刷新展示状态，独立于首次加载骨架屏。 */
	public readonly refreshing: ComputedRef<boolean>;
	/** 首拉状态的只读投影，首拉期间禁用页面手动刷新。 */
	public readonly initializing: ComputedRef<boolean>;
	/** 手动意图独占状态，由只读 computed 对外暴露。 */
	private readonly manualBusy: Ref<boolean> = ref(false);
	/** 原构造参数用于派生真实请求，不复制筛选业务事实。 */
	private readonly paginationOptions: PaginatorOptions<Endpoint>;
	/** 原始端点决定所有分页与刷新请求。 */
	private readonly timelineEndpoint: Endpoint;
	/** 串行尾链保证首拉、翻页与刷新不会并发提交。 */
	private serial: Promise<void> = Promise.resolve();
	/** 当前协议请求的取消控制器。 */
	private controller: AbortController | null = null;
	/** 当前请求的手动归属，取消等待中的意图不取消已经开始的分页。 */
	private controllerOperation: ManualRefreshOperation | null = null;
	/** 已登记的唯一翻页任务，避免同一渲染周期重复排队。 */
	private pagePromise: Promise<void> | null = null;
	/** 原 notePosted／轮询在请求占用期间合并的单个新页意图，不保存响应实体。 */
	private pendingNewer: PendingNewerOperation | null = null;
	/** 当前手动意图；取消后旧结果不得更新反馈。 */
	private manualOperation: ManualRefreshOperation | null = null;
	/** 连续手动点击共享同一次完整操作。 */
	private manualPromise: Promise<TwitterTimelineRefreshResult> | null = null;
	/** 原流式 reloadTimeline 同步进入本所有者时的手动归属。 */
	private dispatchingManual: boolean = false;
	/** 每次外部查询变更撤销旧读取。 */
	private generation: number = 0;
	/** 成功空响应同样属于初始化完成，不能用条目数量代替。 */
	private initialized: boolean = false;
	/** 最近成功窗口对应的查询身份。 */
	private confirmedQuery: string | null = null;
	/** 页面销毁后不再接受任何读取结果。 */
	private disposed: boolean = false;
	/** 删除通知的标识墓碑同时过滤列表、迟到响应及继承队列。 */
	private readonly deletedIds: Set<string> = new Set<string>();
	/** 当前首批读取期间接纳的标识，保护晚到实时内容。 */
	private acceptedDuringRequest: Set<string> | null = null;

	/** 接收原流式组件已经确定的端点及参数，同一实例拥有唯一继承集合。 */
	public constructor(endpoint: Endpoint, options: PaginatorOptions<Endpoint>) {
		super(endpoint, { ...options, useShallowRef: true });
		this.timelineEndpoint = endpoint;
		this.paginationOptions = options;
		this.refreshing = computed(/** 从唯一操作状态派生按钮展示。 */ (): boolean => this.manualBusy.value);
		this.initializing = computed(/** 直接投影既有首拉状态，不增加第二份布尔事实。 */ (): boolean => this.fetching.value);
	}

	/** 首次读取与错误重试使用原骨架屏／错误终态，同时参与请求串行。 */
	public override init(): Promise<void> {
		return this.requestReload(null);
	}

	/** 原流式入口仍负责广告计数重置，本方法只执行其委托的实际读取。 */
	public override reload(): Promise<void> {
		return this.requestReload(this.dispatchingManual ? this.manualOperation : null);
	}

	/** 点击时先记录展示基线，再通知页面回顶，最后通过原流式入口读取。 */
	public runManualRefresh(reload: () => Promise<void>, started: () => void): Promise<TwitterTimelineRefreshResult> {
		if (this.disposed) return Promise.resolve('cancelled');
		if (this.manualPromise != null) return this.manualPromise;
		const operation: ManualRefreshOperation = {
			baseline: this.newestId(this.items.value),
			query: this.queryIdentity(),
			generation: this.generation,
			acceptedIds: new Set<string>(),
			result: 'cancelled',
		};
		this.manualOperation = operation;
		this.manualBusy.value = true;
		started();
		const pending: Promise<TwitterTimelineRefreshResult> = this.performManualRefresh(operation, reload);
		this.manualPromise = pending;
		return pending;
	}

	/** 等待已占用的分页结束后消费手动意图；重复点击共享同一结果。 */
	private async performManualRefresh(operation: ManualRefreshOperation, reload: () => Promise<void>): Promise<TwitterTimelineRefreshResult> {
		try {
			await this.serial;
			if (!this.isManualCurrent(operation)) return 'cancelled';
			this.dispatchingManual = true;
			let request: Promise<void>;
			try {
				request = reload();
			} finally {
				this.dispatchingManual = false;
			}
			await request;
			await this.consumeManualNewer(operation);
			return this.isManualCurrent(operation) ? operation.result : 'cancelled';
		} catch (_cause: unknown) {
			return this.isManualCurrent(operation) ? 'failed' : 'cancelled';
		} finally {
			if (this.manualOperation === operation) {
				this.manualOperation = null;
				this.manualPromise = null;
				this.manualBusy.value = false;
			}
			this.consumePendingNewer();
		}
	}

	/** 查询变化撤销旧归属，成功前保留同一查询已经确认的条目。 */
	private requestReload(operation: ManualRefreshOperation | null): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (operation == null) {
			this.cancelManualRefresh();
			this.pendingNewer = null;
			this.generation++;
			this.controller?.abort();
		}
		const generation: number = this.generation;
		const query: string = this.queryIdentity();
		return this.serialize(/** 将实际请求排在已经开始的首批及分页之后。 */ async (): Promise<void> => {
			if (!this.isCurrent(generation, query) || (operation != null && !this.isManualCurrent(operation))) return;
			await this.requestFirstPage(generation, query, operation);
		});
	}

	/** 用单次真实最新窗口判断结果；失败和无新增均不清空已加载集合。 */
	private async requestFirstPage(generation: number, query: string, operation: ManualRefreshOperation | null): Promise<void> {
		const controller: AbortController = new AbortController();
		const retain: boolean = this.initialized && this.confirmedQuery === query;
		this.controller = controller;
		this.controllerOperation = operation;
		this.acceptedDuringRequest = operation?.acceptedIds ?? new Set<string>();
		if (!retain) this.fetching.value = true;
		try {
			const response: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[] = await fetchTwitterTimelineWindow(this.timelineEndpoint, this.requestParameters({
				limit: this.paginationOptions.limit ?? FIRST_FETCH_LIMIT,
				allowPartial: true,
				...(this.initialDirection === 'newer' ? {
					...(this.initialId == null && this.initialDate == null ? { sinceId: '0' } : { sinceId: this.initialId ?? undefined, sinceDate: this.initialDate ?? undefined }),
				} : { untilId: this.initialId ?? undefined, untilDate: this.initialDate ?? undefined }),
			}), controller.signal);
			if (!this.isCurrent(generation, query) || controller.signal.aborted || (operation != null && !this.isManualCurrent(operation))) return;
			if ((this.initialId != null || this.initialDate != null) && this.initialDirection === 'newer') response.reverse();
			// 继承队列经重写插入动作过滤已删除条目；同步提交期间不留旁路队列。
			this.releaseQueue();
			const fresh: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[] = this.acceptableItems(response);
			const updated: boolean = operation != null && (fresh.some(/** 只把比点击前最大标识更新的真实响应计为新帖。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => operation.baseline == null || item.id > operation.baseline) || this.items.value.some(/** 回顶释放和请求期间接纳的新帖也属于此次刷新可见结果。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => operation.acceptedIds.has(item.id) && (operation.baseline == null || item.id > operation.baseline)));
			if (operation == null || updated || !retain) {
				const oldestResponseId: string | null = fresh.reduce(/** 响应下界以内及更新的流事件均可连续保留，兼容分布式事务乱序提交。 */ (oldest: string | null, item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): string => oldest == null || item.id < oldest ? item.id : oldest, null as string | null);
				const responseIds: Set<string> = new Set<string>(fresh.map(/** 本次请求去重标识不作为持久业务状态。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): string => item.id));
				const retained: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[] = this.items.value.filter(/** 不跨过最新窗口下界保留旧排队条目，同时保留窗口内快照尚未包含的真实流事件。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => this.acceptedDuringRequest?.has(item.id) === true && !this.deletedIds.has(item.id) && !responseIds.has(item.id) && (oldestResponseId == null || item.id >= oldestResponseId));
				this.items.value = [...retained, ...fresh].sort(/** 保护流事件的同时沿用原分页器按标识字典顺序排序的语义。 */ (left: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity, right: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): number => left.id === right.id ? 0 : (left.id < right.id ? -1 : 1) * (this.order.value === 'oldest' ? 1 : -1));
				if (this.items.value[3] != null) this.items.value[3]._shouldInsertAd_ = true;
				this.canFetchOlder.value = this.initialDirection === 'older' && this.hasFurtherPage(response.length);
				this.canFetchNewer.value = this.initialDirection === 'newer' && this.hasFurtherPage(response.length);
			}
			this.error.value = false;
			this.initialized = true;
			this.confirmedQuery = query;
			if (operation != null) operation.result = updated ? 'updated' : 'unchanged';
		} catch (_cause: unknown) {
			if (!this.isCurrent(generation, query) || controller.signal.aborted || (operation != null && !this.isManualCurrent(operation))) return;
			if (!retain) this.error.value = true;
			if (operation != null) operation.result = 'failed';
		} finally {
			if (this.controller === controller) {
				this.controller = null;
				this.controllerOperation = null;
				this.acceptedDuringRequest = null;
				this.fetching.value = false;
				this.clearDrainedDeletions();
				this.consumePendingNewer();
			}
		}
	}

	/** 保留既有旧页游标和广告位置，刷新意图存在时不再发起新的翻页。 */
	public override fetchOlder(): Promise<void> {
		if (this.pagePromise != null) return this.pagePromise;
		if (this.disposed || this.manualBusy.value || this.controller != null || !this.canFetchOlder.value || this.items.value.length === 0) return Promise.resolve();
		return this.requestPage(false, false);
	}

	/** 轮询继续使用原新页协议，与手动读取共享串行提交及删除过滤。 */
	public override fetchNewer(options: { toQueue?: boolean } = {}): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.manualBusy.value || this.controller != null || this.fetching.value || this.pagePromise != null) {
			const query: string = this.queryIdentity();
			const existing: PendingNewerOperation | null = this.pendingNewer;
			this.pendingNewer = {
				generation: this.generation,
				query,
				/** 合并同源意图时保留任何一次立即展示要求，不能降级为仅排队。 */
				toQueue: existing != null && existing.generation === this.generation && existing.query === query ? existing.toQueue && (options.toQueue ?? false) : options.toQueue ?? false,
			};
			return this.pagePromise ?? this.serial;
		}
		return this.requestPage(true, options.toQueue ?? false);
	}

	/** 手动主读取后逐次消费已观察到的新页意图，全部补读结束后再反馈；失败不自行重试。 */
	private async consumeManualNewer(operation: ManualRefreshOperation): Promise<void> {
		while (this.pendingNewer != null && this.isManualCurrent(operation)) {
			const pending: PendingNewerOperation = this.pendingNewer;
			this.pendingNewer = null;
			if (!this.isCurrent(pending.generation, pending.query)) return;
			await this.requestPage(true, pending.toQueue, operation);
		}
	}

	/** 占用结束后只消费一次原入口意图；失败不自动重试，来源变化或销毁即丢弃。 */
	private consumePendingNewer(): void {
		if (this.pendingNewer == null || this.manualBusy.value || this.controller != null || this.fetching.value || this.pagePromise != null) return;
		const pending: PendingNewerOperation = this.pendingNewer;
		this.pendingNewer = null;
		if (!this.isCurrent(pending.generation, pending.query)) return;
		void this.requestPage(true, pending.toQueue);
	}

	/** 统一旧／新页请求生命周期，迟到响应不得污染更新后的筛选集合。 */
	private requestPage(newer: boolean, toQueue: boolean, operation: ManualRefreshOperation | null = null): Promise<void> {
		const generation: number = this.generation;
		const query: string = this.queryIdentity();
		const pending: Promise<void> = this.serialize(/** 排队后重新读取唯一集合的游标，避免复用旧页起点。 */ async (): Promise<void> => {
			if (!this.isCurrent(generation, query) || (operation != null ? !this.isManualCurrent(operation) : this.manualBusy.value)) return;
			const controller: AbortController = new AbortController();
			const flag: Ref<boolean> = newer ? this.fetchingNewer : this.fetchingOlder;
			this.controller = controller;
			this.controllerOperation = operation;
			flag.value = true;
			try {
				const response: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[] = await fetchTwitterTimelineWindow(this.timelineEndpoint, this.requestParameters({
					limit: SECOND_FETCH_LIMIT,
					...(this.paginationOptions.offsetMode ? { offset: this.items.value.length } : newer ? { sinceId: this.getNewestId() ?? undefined } : { untilId: this.getOldestId() ?? undefined }),
				}), controller.signal);
				if (!this.isCurrent(generation, query) || controller.signal.aborted || (operation != null && !this.isManualCurrent(operation))) return;
				if (newer) {
					if (toQueue) {
						for (const item of response) this.enqueue(item);
					} else if (this.order.value === 'oldest') this.pushItems(response);
					else this.unshiftItems(response.toReversed(), false);
					if (response.length === 0 || this.paginationOptions.canFetchDetection === 'limit') this.canFetchNewer.value = this.hasFurtherPage(response.length);
					if (operation?.result === 'unchanged' && response.some(/** 只有本次成功补读真正接纳的新增标识才能提升手动结果，失败结果保持失败。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => !this.deletedIds.has(item.id) && (operation.baseline == null || item.id > operation.baseline))) operation.result = 'updated';
				} else {
					if (response[10] != null) response[10]._shouldInsertAd_ = true;
					if (this.order.value === 'oldest') this.unshiftItems(response.toReversed(), false);
					else this.pushItems(response);
					this.canFetchOlder.value = this.hasFurtherPage(response.length);
				}
			} catch (_cause: unknown) {
				// 与原分页动作一致，失败保留现有集合及重试能力。
				if (operation != null && this.isManualCurrent(operation) && !controller.signal.aborted) operation.result = 'failed';
			} finally {
				if (this.controller === controller) {
					this.controller = null;
					this.controllerOperation = null;
				}
				flag.value = false;
				this.clearDrainedDeletions();
			}
		});
		this.pagePromise = pending.finally(/** 任务结束后开放下一次分页，不保留实体或请求副本。 */ (): void => {
			this.pagePromise = null;
			this.consumePendingNewer();
		});
		return this.pagePromise;
	}

	/** 从原分页配置和唯一查询字段派生接口 Schema 参数。 */
	private requestParameters(cursor: TimelineRequestCursor): PaginatorCompatibleEndpoints[Endpoint]['req'] {
		return {
			...(typeof this.paginationOptions.params === 'function' ? this.paginationOptions.params() : this.paginationOptions.params),
			...(this.computedParams?.value ?? {}),
			...(this.searchQuery.value != null && this.searchQuery.value.trim() !== '' ? { [this.paginationOptions.searchParamName ?? 'search']: this.searchQuery.value } : {}),
			...cursor,
		};
	}

	/** 查询身份只从权威构造参数和继承分页字段单向派生。 */
	private queryIdentity(): string {
		return JSON.stringify([this.timelineEndpoint, this.requestParameters({ limit: this.paginationOptions.limit ?? FIRST_FETCH_LIMIT }), this.initialId, this.initialDate, this.initialDirection, this.order.value]);
	}

	/** 请求串行尾链不承载任何帖子数据。 */
	private serialize(work: () => Promise<void>): Promise<void> {
		const next: Promise<void> = this.serial.then(work, work);
		this.serial = next;
		return next;
	}

	/** 同一生命周期与筛选身份的请求才允许提交。 */
	private isCurrent(generation: number, query: string): boolean {
		return !this.disposed && this.generation === generation && this.queryIdentity() === query;
	}

	/** 手动结果还必须属于当前用户意图，停用页面后不再发出反馈。 */
	private isManualCurrent(operation: ManualRefreshOperation): boolean {
		return this.manualOperation === operation && this.isCurrent(operation.generation, operation.query);
	}

	/** 延续原分页器的保守／数量检测协议。 */
	private hasFurtherPage(count: number): boolean {
		return !this.noPaging && (this.paginationOptions.canFetchDetection === 'limit' ? count >= FIRST_FETCH_LIMIT : count > 0);
	}

	/** 从唯一实体集合派生最大标识，不假定当前展示顺序。 */
	private newestId(items: readonly (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[]): string | null {
		return items.reduce(/** 既有分页器同样以标识字典顺序决定时间游标。 */ (newest: string | null, item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): string => newest == null || item.id > newest ? item.id : newest, null as string | null);
	}

	/** 插入前统一过滤已确认删除及单次响应内重复条目。 */
	private acceptableItems(items: readonly (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[]): (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[] {
		const seen: Set<string> = new Set<string>();
		return items.filter(/** 临时标识集合只负责一次请求的去重，不保存实体副本。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => {
			if (this.deletedIds.has(item.id) || seen.has(item.id)) return false;
			seen.add(item.id);
			return true;
		});
	}

	/** 记录真实流事件及回顶释放标识，供本次刷新保护晚到内容。 */
	private recordAccepted(item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): void {
		this.manualOperation?.acceptedIds.add(item.id);
		this.acceptedDuringRequest?.add(item.id);
	}

	/** 继承队列释放也经过此动作，因此不会复活已删除排队帖子。 */
	public override unshiftItems(items: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[], trim: boolean = true): void {
		if (this.disposed) return;
		const accepted: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[] = this.acceptableItems(items);
		for (const item of accepted) this.recordAccepted(item);
		super.unshiftItems(accepted, trim);
	}

	/** 旧页插入复用继承集合，过滤跨页重复及删除墓碑。 */
	public override pushItems(items: (PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[]): void {
		if (this.disposed) return;
		super.pushItems(this.acceptableItems(items).filter(/** 从唯一集合判断跨页重复。 */ (item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => !this.items.value.some(/** 已有集合是唯一去重依据。 */ (existing: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): boolean => existing.id === item.id)));
	}

	/** 实时到达顶部的条目仍走原前插与裁剪动作。 */
	public override prepend(item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): void {
		if (this.disposed || this.deletedIds.has(item.id)) return;
		this.recordAccepted(item);
		super.prepend(item);
	}

	/** 实时排队仍由原队列持有实体，刷新只记录本次接纳标识。 */
	public override enqueue(item: PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity): void {
		if (this.disposed || this.deletedIds.has(item.id)) return;
		this.recordAccepted(item);
		super.enqueue(item);
	}

	/** 排队条目通过过滤插入动作释放，排空后清理请求删除标识。 */
	public override releaseQueue(): void {
		if (this.disposed) return;
		super.releaseQueue();
		this.clearDrainedDeletions();
	}

	/** 删除标识同时约束迟到响应与无法直接访问的继承队列。 */
	public override removeItem(id: string): void {
		if (this.controller != null || this.queuedAheadItemsCount.value > 0) this.deletedIds.add(id);
		super.removeItem(id);
	}

	/** 仅在请求与排队源全部排空后清理墓碑，避免全局删除事件永久积累。 */
	private clearDrainedDeletions(): void {
		if (this.controller == null && this.queuedAheadItemsCount.value === 0) this.deletedIds.clear();
	}

	/** 停用或切换来源时撤销当前手动操作，已有分页仍可正常结束。 */
	public cancelManualRefresh(): void {
		if (this.manualOperation == null) return;
		if (this.controllerOperation === this.manualOperation) this.controller?.abort();
		this.manualOperation = null;
		this.manualPromise = null;
		this.manualBusy.value = false;
	}

	/** 最终卸载撤销所有请求归属，迟到响应不能修改唯一集合。 */
	public dispose(): void {
		this.disposed = true;
		this.generation++;
		this.pendingNewer = null;
		this.cancelManualRefresh();
		this.controller?.abort();
		this.controller = null;
		this.controllerOperation = null;
		this.fetching.value = false;
		this.fetchingOlder.value = false;
		this.fetchingNewer.value = false;
		this.deletedIds.clear();
	}
}

/** 包装组件只持有查询控制能力，不接触泛型实体状态或创建业务状态副本。 */
export type TwitterTimelineRefreshController = Pick<TwitterTimelinePaginator<PaginatorCompatibleEndpointPaths>, 'refreshing' | 'initializing' | 'runManualRefresh' | 'cancelManualRefresh' | 'dispose'>;
