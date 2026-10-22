/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 用户资料帖子查询所有者。
 * 作用：复用既有分页器的唯一条目集合和分页动作，同一集合刷新成功前保留已确认内容。
 * 数据链：页面首次加载／回访／重试 → 真实协议适配器 → 唯一 items → 既有帖子列表。
 * 请求控制器只管理首批读取，不保存条目快照，也不修改共享分页器的业务逻辑。
 */
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { entities } from 'misskey-js';
import type { TwitterUserTimelineTab } from '../domain/index.js';
import { createTwitterUserTimelineRequest, fetchTwitterUserTimelineWindow } from '../adapters/user-timeline.js';
import type { TwitterUserTimelineAnchor, TwitterUserTimelineRequest } from '../adapters/user-timeline.js';
import { Paginator } from '@/utility/paginator.js';

/** 页面生命周期内每个标签独占一个查询所有者，基础列表继续消费同一 IPaginator。 */
export class TwitterUserTimelinePaginator extends Paginator<'users/notes' | 'users/featured-notes'> {
	/** 已确认集合刷新中的展示状态，不借用首拉 fetching 导致列表卸载。 */
	public readonly refreshing: Ref<boolean> = ref(false);
	/** 刷新失败只在列表局部提示；首次失败仍使用既有 error 终态。 */
	public readonly refreshError: Ref<boolean> = ref(false);
	/** 唯一账户／集合的协议参数，页面实例更换时整个所有者更换。 */
	private readonly request: TwitterUserTimelineRequest;
	/** 真实成功（含空集合）才算已初始化，不能以条目数量代替。 */
	private initialized: boolean = false;
	/** 最近成功首批的查询身份，只用于判断当前锚点能否保留唯一集合。 */
	private confirmedQuery: string | null = null;
	/** 翻页占用期间合并的单个刷新意图，消费时读取最新排序和日期锚点。 */
	private pendingReload: boolean = false;
	/** 当前首批请求归属；取消后迟到响应不能覆盖已确认条目。 */
	private controller: AbortController | null = null;
	/** 页面最终销毁后不接受首批读取结果。 */
	private disposed: boolean = false;

	/** 从唯一领域标签构建继承分页器配置，不创建旁路条目数组。 */
	public constructor(userId: string, tab: TwitterUserTimelineTab) {
		const request: TwitterUserTimelineRequest = createTwitterUserTimelineRequest(userId, tab);
		super(request.endpoint, { limit: 20, params: request.params });
		this.request = request;
		this.dispose = this.dispose.bind(this);
	}

	/** 首次挂载和首次错误重试保持原有加载／错误／空态约定。 */
	public override init(): Promise<void> {
		return this.requestFirstPage();
	}

	/** 同一查询回访刷新仅在成功后替换条目，失败保留原集合。 */
	public override reload(): Promise<void> {
		return this.requestFirstPage();
	}

	/** 刷新首批时阻止自动翻页竞争，空闲时完整复用原有分页协议。 */
	public override async fetchOlder(): Promise<void> {
		if (this.disposed || this.controller != null || this.fetchingOlder.value || this.fetchingNewer.value) return;
		try {
			await super.fetchOlder();
		} finally {
			await this.consumePendingReload();
		}
	}

	/** 避免首批替换与较新页读取同时修改同一集合。 */
	public override async fetchNewer(options: { toQueue?: boolean } = {}): Promise<void> {
		if (this.disposed || this.controller != null || this.fetchingOlder.value || this.fetchingNewer.value) return;
		try {
			await super.fetchNewer(options);
		} finally {
			await this.consumePendingReload();
		}
	}

	/** 从继承分页器的唯一查询字段派生身份，不保存条目或锚点的旁路状态。 */
	private queryIdentity(): string {
		return JSON.stringify([this.initialId, this.initialDate, this.initialDirection, this.order.value]);
	}

	/** 所有继承翻页结束后消费一次意图，避免排序、日期和手动刷新被占用状态丢弃。 */
	private async consumePendingReload(): Promise<void> {
		if (!this.pendingReload || this.disposed || this.fetchingOlder.value || this.fetchingNewer.value) return;
		await this.requestFirstPage();
	}

	/** 首批读取为请求局部结果；成功提交时同步清理旧队列和分页能力。 */
	private async requestFirstPage(): Promise<void> {
		if (this.disposed) return;
		if (this.fetchingOlder.value || this.fetchingNewer.value) {
			this.pendingReload = true;
			return;
		}
		this.pendingReload = false;
		const query: string = this.queryIdentity();
		const retain: boolean = this.initialized && this.confirmedQuery === query;
		const anchor: TwitterUserTimelineAnchor = {
			initialId: this.initialId,
			initialDate: this.initialDate,
			initialDirection: this.initialDirection,
			retainedCount: retain ? this.items.value.length : 0,
			oldestRetainedId: retain ? this.items.value.reduce(/** 从唯一集合派生已有可见范围的结束标识。 */ (oldest: string | null, note: entities.Note): string => oldest == null || note.id < oldest ? note.id : oldest, null as string | null) : null,
		};
		this.controller?.abort();
		const controller: AbortController = new AbortController();
		this.controller = controller;
		this.refreshError.value = false;
		if (retain) {
			this.refreshing.value = true;
		} else {
			this.fetching.value = true;
			this.error.value = false;
		}
		try {
			const items: entities.Note[] = await fetchTwitterUserTimelineWindow(this.request, anchor, controller.signal);
			if (this.disposed || this.controller !== controller || controller.signal.aborted) return;
			// 仅通过公开动作清除旧排队条目，随后在同一同步提交内替换唯一集合。
			this.releaseQueue();
			this.items.value = items;
			// 广告槽位是原分页器定义的列表元数据，修改的仍是此所有者唯一集合。
			for (let index: number = 0; index < this.items.value.length; index++) {
				if (index === 3 || (index >= 30 && (index - 30) % 30 === 0)) this.items.value[index]._shouldInsertAd_ = true;
			}
			this.canFetchOlder.value = false;
			this.canFetchNewer.value = false;
			if (anchor.initialDirection === 'older') this.canFetchOlder.value = items.length > 0;
			else this.canFetchNewer.value = items.length > 0;
			this.error.value = false;
			this.initialized = true;
			this.confirmedQuery = query;
		} catch (_cause: unknown) {
			if (this.disposed || this.controller !== controller || controller.signal.aborted) return;
			if (retain) this.refreshError.value = true;
			else this.error.value = true;
		} finally {
			if (this.controller === controller) {
				this.controller = null;
				this.fetching.value = false;
				this.refreshing.value = false;
			}
		}
	}

	/** 最终卸载时中止首批请求并撤销归属；停用缓存页不销毁已确认集合。 */
	public dispose(): void {
		this.disposed = true;
		this.pendingReload = false;
		this.controller?.abort();
		this.controller = null;
		this.fetching.value = false;
		this.refreshing.value = false;
	}
}
