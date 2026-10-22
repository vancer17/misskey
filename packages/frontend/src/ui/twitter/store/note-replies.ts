/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 单个父帖的直接回复查询所有者。
 * 作用：扩展既有分页器，协调可取消分页与保留窗口刷新，不修改基础分页器业务。
 * 数据链：页面意图 → 真实协议适配器 → 唯一 items → 回复列表；失败保留已确认结果。
 */
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { entities } from 'misskey-js';
import { fetchTwitterRepliesPage, fetchTwitterRepliesWindow } from '../adapters/note-replies.js';
import type { TwitterRepliesPage } from '../adapters/note-replies.js';
import { Paginator } from '@/utility/paginator.js';

/** 每个父帖仅一个分页集合，所有响应必须属于仍存活的当前请求。 */
export class TwitterRepliesPaginator extends Paginator<'notes/replies'> {
	/** 刷新已有集合时保留列表，不借用首拉骨架状态。 */
	public readonly refreshing: Ref<boolean> = ref(false);
	/** 刷新失败与首次加载失败分别展示。 */
	public readonly refreshError: Ref<boolean> = ref(false);
	/** 翻页失败仍保留原游标和更多入口。 */
	public readonly pageError: Ref<boolean> = ref(false);
	/** 当前实例固定的父帖标识，不从显示数组反推查询身份。 */
	private readonly noteId: string;
	/** 主回复和子节点分别沿用原有批量规模。 */
	private readonly pageSize: number;
	/** 成功空集合也是已经初始化的查询。 */
	private initialized: boolean = false;
	/** 首拉、刷新、翻页共用一个可取消请求归属。 */
	private controller: AbortController | null = null;
	/** 当前读取的完成协议，供显式刷新在翻页之后串行执行。 */
	private activeRead: Promise<void> | null = null;
	/** 在途时合并一次手动刷新意图，调用者等待该轮真正完成。 */
	private pendingReload: Promise<void> | null = null;
	/** 最终卸载后拒绝所有迟到响应。 */
	private disposed: boolean = false;

	/** 接入原分页组件的公开协议，实例本身持有唯一集合。 */
	public constructor(noteId: string, pageSize: number) {
		super('notes/replies', { limit: pageSize, params: { noteId } });
		this.noteId = noteId;
		this.pageSize = pageSize;
		// 真正 init 开始时切换，刷新调度才能识别尚未挂载面板的首次请求。
		this.fetching.value = false;
		this.dispose = this.dispose.bind(this);
	}

	/** 分页组件重新挂载时保留已经确认的窗口，首拉错误允许重试。 */
	public override async init(): Promise<void> {
		if (!this.initialized) await this.startRead(false);
	}

	/** 发布、回访和显式重试统一重新确认当前已展示范围。 */
	public override reload(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.pendingReload != null) return this.pendingReload;
		if (this.activeRead == null) return this.startRead(false);
		this.pendingReload = this.activeRead
			.then(/** 在途响应处理完成后再确认完整窗口，不丢失右键刷新意图。 */ (): Promise<void> => this.startRead(false))
			.finally(/** 本轮排队刷新结束后允许下一次明确意图。 */ (): void => { this.pendingReload = null; });
		return this.pendingReload;
	}

	/** 只读取当前窗口之后的直接回复，失败不推进游标。 */
	public override async fetchOlder(): Promise<void> {
		if (!this.canFetchOlder.value || !this.initialized) return;
		await this.startRead(true);
	}

	/** 首拉和翻页只允许一个请求，重复更多点击不建立额外队列。 */
	private startRead(append: boolean): Promise<void> {
		if (this.disposed || this.activeRead != null) return Promise.resolve();
		this.activeRead = this.read(append).finally(/** 释放当前读取后，排队刷新才可开始。 */ (): void => {
			this.activeRead = null;
		});
		return this.activeRead;
	}

	/** 所有集合变更只在当前请求完整成功后一次提交。 */
	private async read(append: boolean): Promise<void> {
		if (this.disposed || this.controller != null) return;
		const controller: AbortController = new AbortController();
		this.controller = controller;
		this.error.value = false;
		this.refreshError.value = false;
		this.pageError.value = false;
		this.fetching.value = !this.initialized;
		this.fetchingOlder.value = append;
		this.refreshing.value = this.initialized && !append;
		const oldestId: string | undefined = this.items.value.reduce(
			/** 从唯一集合派生窗口边界，删除原末项后仍可读取到该边界之外。 */
			(oldest: string | undefined, note: entities.Note): string => oldest == null || note.id < oldest ? note.id : oldest,
			undefined as string | undefined,
		);
		try {
			const page: TwitterRepliesPage = append
				? await fetchTwitterRepliesPage(this.noteId, this.pageSize, oldestId, controller.signal)
				: await fetchTwitterRepliesWindow(this.noteId, this.pageSize, oldestId, controller.signal);
			if (this.disposed || controller.signal.aborted || this.controller !== controller) return;
			if (append) {
				const known: Set<string> = new Set(this.items.value.map(/** 仅去除分页边界的重复实体。 */ (note: entities.Note): string => note.id));
				this.items.value = [...this.items.value, ...page.items.filter(/** 已确认实体仍以当前所有者集合为准。 */ (note: entities.Note): boolean => !known.has(note.id))];
			} else {
				this.items.value = page.items;
			}
			this.canFetchOlder.value = page.hasMore;
			this.initialized = true;
		} catch (_cause: unknown) {
			if (this.disposed || controller.signal.aborted || this.controller !== controller) return;
			if (!this.initialized) this.error.value = true;
			else if (append) this.pageError.value = true;
			else this.refreshError.value = true;
		} finally {
			if (this.controller === controller) {
				this.controller = null;
				this.fetching.value = false;
				this.fetchingOlder.value = false;
				this.refreshing.value = false;
			}
		}
	}

	/** 最终卸载取消当前读取，不影响其他父帖的查询或全局事件。 */
	public dispose(): void {
		this.disposed = true;
		this.controller?.abort();
		this.controller = null;
		this.fetching.value = false;
		this.fetchingOlder.value = false;
		this.refreshing.value = false;
	}
}
