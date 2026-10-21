/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：频道管理列表的键盘交互。
 * 作用：异步追加或重试替换操作按钮时，将键盘焦点衔接到新增频道或当前状态。
 * 数据链：用户的键盘操作位置 → 只读查询投影完成更新 → 当前可见列表内的 DOM 焦点。
 * 仅保存一次交互的位置，不复制频道实体、分页游标或请求生命周期，不接管基础窗口的焦点约束。
 */

import { watch } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { TwitterCommunityLibraryView } from '../domain/index.js';

/** 记录触发操作时的焦点和列表位置；该瞬时信息只用于确定下一处阅读位置。 */
type PendingLibraryFocus = Readonly<{
	origin: HTMLElement;
	itemCount: number;
	loadingTarget: HTMLElement | null;
}>;

/** 两种频道管理界面共用焦点衔接；用户已移动焦点或离开入口时不主动抢回。 */
export function useChannelLibraryFocus(
	view: ComputedRef<TwitterCommunityLibraryView>,
	root: Readonly<ShallowRef<HTMLElement | null>>,
	isActive: () => boolean,
): (event?: MouseEvent) => void {
	let pending: PendingLibraryFocus | null = null;

	/** 操作发出前记录键盘位置；无原生事件的既有重试组件仅接受自身仍持有的按钮焦点。 */
	function rememberFocus(event?: MouseEvent): void {
		const container: HTMLElement | null = root.value;
		if (container == null || !isActive() || (event != null && event.detail !== 0)) return;
		const origin: EventTarget | null = event?.currentTarget ?? window.document.activeElement;
		if (!(origin instanceof HTMLElement) || !container.contains(origin) || window.document.activeElement !== origin || !origin.matches('button')) return;
		if (event == null && !origin.matches(':focus-visible')) return;
		pending = { origin, itemCount: view.value.items.length, loadingTarget: null };
	}

	watch(
		/** 只读观察请求阶段，不根据 DOM 反向改变业务状态。 */
		(): TwitterCommunityLibraryView['status'] => view.value.status,
		/** 等待本轮 DOM 更新后承接被禁用或卸载的按钮焦点。 */
		(status: TwitterCommunityLibraryView['status']): void => {
			if (pending == null) return;
			const previous: PendingLibraryFocus = pending;
			if (status !== 'loading') pending = null;
			const container: HTMLElement | null = root.value;
			if (container == null || !isActive()) return;
			const focused: Element | null = window.document.activeElement;
			if (focused !== previous.origin && focused !== previous.loadingTarget && focused !== window.document.body) return;
			if (status === 'loading') {
				const loadingTarget: HTMLElement = container.querySelector<HTMLElement>('[data-community-library-status]') ?? container;
				pending = { ...previous, loadingTarget };
				loadingTarget.focus({ preventScroll: true });
				return;
			}
			const row: HTMLElement | null = container.querySelectorAll<HTMLElement>('[data-community-library-item]').item(previous.itemCount);
			const nextLink: HTMLElement | null | undefined = row?.matches('a[href]') ? row : row?.querySelector<HTMLAnchorElement>('a[href]');
			const target: HTMLElement = nextLink
				?? container.querySelector<HTMLElement>('[data-community-library-action]:not([disabled])')
				?? container.querySelector<HTMLElement>('[data-community-library-status]')
				?? container;
			target.focus();
		},
		{ flush: 'post' },
	);

	return rememberFocus;
}
