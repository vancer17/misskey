/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter UI 入口布局适配：将 domain 权威入口断点派生为只读表现状态。
 * 仅本入口消费；监听随组件作用域释放，不含身份或基础设施探测。
 */
import { onScopeDispose, readonly, ref } from 'vue';
import type { Ref } from 'vue';
import { TWITTER_LAYOUT_BREAKPOINTS } from '../domain/index.js';

/** 入口布局只读投影；不复制账户、路由或业务状态。 */
type EntryLayout = { compact: Readonly<Ref<boolean>>; split: Readonly<Ref<boolean>> };

/** 同步提供初次布局，避免挂载后再改变断点导致首帧闪动。 */
export function useEntryLayout(): EntryLayout {
	const splitQuery: MediaQueryList = window.matchMedia(`(min-width: ${TWITTER_LAYOUT_BREAKPOINTS.entrySplit}px)`);
	const regularQuery: MediaQueryList = window.matchMedia(`(min-width: ${TWITTER_LAYOUT_BREAKPOINTS.entryCompact}px)`);
	const split: Ref<boolean> = ref(splitQuery.matches);
	const compact: Ref<boolean> = ref(!regularQuery.matches);

	/** 浏览器断点变化只更新只读布局投影。 */
	function syncLayout(): void {
		split.value = splitQuery.matches;
		compact.value = !regularQuery.matches;
	}

	splitQuery.addEventListener('change', syncLayout);
	regularQuery.addEventListener('change', syncLayout);
	onScopeDispose(
		/** 入口卸载时释放监听，避免路由往返累积。 */
		(): void => {
			splitQuery.removeEventListener('change', syncLayout);
			regularQuery.removeEventListener('change', syncLayout);
		},
	);
	return { compact: readonly(compact), split: readonly(split) };
}
