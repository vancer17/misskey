/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 会话内帖子计数展示状态。
 * 作用：相同查看者与帖子共用一次读取；无持久化，不复制 Note 或干预共享 useNote。
 * 数据链：既有成功事件 → 受影响原帖失效 → notes/show → 冻结计数 → 只读组件。
 */
import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type * as Misskey from 'misskey-js';
import type { TwitterNoteCounters } from '../domain/note-counters.js';
import { globalEvents } from '@/events.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';

/** 生命周期引用，不保存原帖副本。 */
type Reader = { origin: () => Misskey.entities.Note; active: boolean };
/** 单个展示投影的请求归属与引用计数；生命周期结束即回收。 */
type Entry = {
	id: string;
	viewer: string | null;
	value: ShallowRef<TwitterNoteCounters | null>;
	readers: Set<Reader>;
	dirty: boolean;
	request: AbortController | null;
};
/** 仅保存仍被组件引用的投影，不写入 Pizzax 的持久化偏好。 */
const entries: Map<string, Entry> = new Map();

/** 按服务器确认数据投影字段，不做加减推断。 */
function project(note: Misskey.entities.Note): TwitterNoteCounters {
	return Object.freeze({ id: note.id, repliesCount: note.repliesCount, renoteCount: note.renoteCount });
}

/** 同键请求合并；已停用消费者不发请求，迟到响应不可跨查看者或已释放实例回填。 */
async function flush(entry: Entry): Promise<void> {
	await Promise.resolve();
	if (!entry.dirty || entry.request || entry.viewer !== ($i?.id ?? null) || ![...entry.readers].some(/** 只查询活动消费范围。 */ (reader: Reader): boolean => reader.active)) return;
	entry.dirty = false;
	const request: AbortController = new AbortController();
	entry.request = request;
	try {
		const note: Misskey.entities.Note = await misskeyApi('notes/show', { noteId: entry.id }, undefined, request.signal);
		if (request.signal.aborted || entry.readers.size === 0 || entry.viewer !== ($i?.id ?? null)) return;
		entry.value.value = project(note);
	} catch (error: unknown) {
		// 保留最后确认值；失败不自动重试，下一次真实失效或回访再确认。
		if (!request.signal.aborted) console.error(error);
	} finally {
		if (entry.request === request) entry.request = null;
	}
	// dirty 在请求开始前已消费；此处仅执行在途期间到达的新意图，失败本身不会重试。
	if (entry.dirty) void flush(entry);
}

/** 只定位受影响的显示帖，多个卡片不会倍增相同请求。 */
function invalidate(id: string | null | undefined): void {
	if (id == null) return;
	for (const entry of entries.values()) {
		if (entry.id !== id) continue;
		entry.dirty = true;
		void flush(entry);
	}
}

/** 回复和引用／转发分别影响其真实父帖统计。 */
function onPosted(note: Misskey.entities.Note): void {
	invalidate(note.replyId);
	invalidate(note.renoteId);
}

/** 已挂载的被删帖仍有原输入引用，可定位父帖；不知道的关系不猜测。 */
function onDeleted(id: string): void {
	for (const entry of entries.values()) {
		for (const reader of entry.readers) {
			const note: Misskey.entities.Note = reader.origin();
			if (note.id !== id) continue;
			invalidate(note.replyId);
			invalidate(note.renoteId);
			break;
		}
	}
}

/** 组件只读消费会话级投影；样本不订阅、不请求真实业务。 */
export function useTwitterNoteCounters(
	source: () => Misskey.entities.Note,
	mock: () => boolean = /** 默认是真实业务卡片。 */ (): boolean => false,
	origin: () => Misskey.entities.Note = source,
): ComputedRef<TwitterNoteCounters> {
	/** 样本上下文继承既有 DI，不读取真实会话计数。 */
	const inheritedMock: boolean = inject(DI.mock, false);
	const current: ShallowRef<Entry | null> = shallowRef(null);
	const reader: Reader = { origin, active: true };
	let key: string | null = null;

	/** 最后一个消费者离开时回收请求、投影和全局监听。 */
	function release(): void {
		const entry: Entry | null = current.value;
		if (entry) {
			entry.readers.delete(reader);
			if (entry.readers.size === 0) { entry.request?.abort(); if (key != null) entries.delete(key); }
		}
		current.value = null;
		key = null;
		if (entries.size === 0) { globalEvents.off('notePosted', onPosted); globalEvents.off('noteDeleted', onDeleted); }
	}

	watch(/** 查看者或真实显示帖变化意味着不同查询身份。 */ (): string => JSON.stringify([$i?.id ?? null, source().id, inheritedMock || mock()]),
		/** 新范围不继承旧账户结果，不接受后到旧 props 覆盖新确认值。 */ (): void => {
			release();
			if (inheritedMock || mock()) return;
			if (entries.size === 0) { globalEvents.on('notePosted', onPosted); globalEvents.on('noteDeleted', onDeleted); }
			key = JSON.stringify([$i?.id ?? null, source().id]);
			let entry: Entry | undefined = entries.get(key);
			if (!entry) {
				entry = { id: source().id, viewer: $i?.id ?? null, value: shallowRef(null), readers: new Set(), dirty: false, request: null };
				entries.set(key, entry);
			}
			entry.readers.add(reader);
			current.value = entry;
			void flush(entry);
		}, { immediate: true },
	);
	onDeactivated(/** 保留已确认显示值，回访时再确认。 */ (): void => { reader.active = false; if (current.value) current.value.dirty = true; });
	onActivated(/** 首次激活没有 dirty 时不重复请求。 */ (): void => { reader.active = true; if (current.value) void flush(current.value); });
	onBeforeUnmount(release);
	return computed(/** 只读展示来源优先采用最新确认投影。 */ (): TwitterNoteCounters => current.value?.value.value ?? project(source()));
}
