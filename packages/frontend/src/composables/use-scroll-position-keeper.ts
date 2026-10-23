/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：既有滚动容器的页面缓存位置恢复。
 * 作用：沿用锚点捕获与位置还原，并允许宿主在显式切换内容时撤销尚未执行的旧恢复任务。
 * 数据链：容器锚点／滚动位置 → 缓存回访恢复；取消入口只清理展示任务，不保存或解释业务实体。
 */

import { throttle } from 'throttle-debounce';
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import type { Ref } from 'vue';

// note render skippingがオンだとズレるため、遷移直前にスクロール範囲に表示されているdata-scroll-anchor要素を特定して、復元時に当該要素までスクロールするようにする

// TODO: data-scroll-anchor がひとつも存在しない場合、または手動で useAnchor みたいなフラグをfalseで呼ばれた場合、単純にスクロール位置を使用する処理にフォールバックするようにする

/** 为既有容器注册锚点恢复；显式内容切换可取消旧来源的待恢复位置。 */
export function useScrollPositionKeeper(scrollContainerRef: Ref<HTMLElement | null | undefined>): Readonly<{ cancelPendingRestore: () => void }> {
	let anchorId: string | null = null;
	// キャプチャ時のアンカー要素上端のコンテナ上端からの距離
	let anchorContainerLocalY = 0;
	let savedScrollTop = 0;
	let ready = true;
	/** 每次激活／取消都使上一代 nextTick 和延迟回调失效。 */
	let restoreGeneration: number = 0;
	/** 仅跟踪当前激活周期的浏览器延迟任务。 */
	let restoreTimer: number | null = null;
	/** 停用或卸载后禁止迟到回调重新移动页面。 */
	let active: boolean = true;

	/** 取消定时任务并作废已排队但不可直接取消的 nextTick 回调。 */
	function invalidatePendingRestore(): void {
		restoreGeneration++;
		if (restoreTimer == null) return;
		window.clearTimeout(restoreTimer);
		restoreTimer = null;
	}

	/** 宿主开始新内容时放弃旧锚点和旧位置，防止延迟恢复覆盖显式回顶。 */
	function cancelPendingRestore(): void {
		invalidatePendingRestore();
		anchorId = null;
		savedScrollTop = 0;
		ready = true;
	}

	watch(scrollContainerRef, (el) => {
		if (!el) return;

		const captureAnchor = () => {
			if (!el) return;
			if (!ready) return;

			if (el.scrollTop < 100) {
				// 上部にいるときはanchorを参照するとズレの原因になるし位置復元するメリットも乏しいため設定しない
				anchorId = null;
				return;
			}

			const scrollContainerRect = el.getBoundingClientRect();
			const viewPosition = scrollContainerRect.top + scrollContainerRect.height / 2;

			const anchorEls = el.querySelectorAll<HTMLElement>('[data-scroll-anchor]');
			for (let i = anchorEls.length - 1; i > -1; i--) { // 下から見た方が速い
				const anchorEl = anchorEls[i];
				const anchorTop = anchorEl.getBoundingClientRect().top;
				// 上端が viewPosition 以下の最初の要素（＝中央を跨ぐか、中央より上にある中で最も近いもの）を選択する
				// 最下部スクロール時に min-height による空白に viewPosition が入った場合も最後のアイテムをキャプチャできる
				if (anchorTop <= viewPosition) {
					anchorId = anchorEl.getAttribute('data-scroll-anchor');
					anchorContainerLocalY = anchorTop - scrollContainerRect.top;
					break;
				}
			}
		};

		// ほんとはscrollイベントじゃなくてonBeforeDeactivatedでやりたい
		// https://github.com/vuejs/vue/issues/9454
		// https://github.com/vuejs/rfcs/pull/284
		el.addEventListener('scroll', throttle(1000, captureAnchor), { passive: true });
		// スクロール後すぐにクリックするとthrottleによりanchorIdが古いまま残るため、
		// pointerdownで遷移直前のアンカーを同期的に取得する
		el.addEventListener('pointerdown', captureAnchor, { passive: true });
	}, {
		immediate: true,
	});

	const restore = () => {
		if (!anchorId) return;
		const scrollContainer = scrollContainerRef.value;
		if (!scrollContainer) return;
		const scrollAnchorEl = scrollContainer.querySelector<HTMLElement>(`[data-scroll-anchor="${CSS.escape(anchorId)}"]`);
		if (!scrollAnchorEl) return;
		const anchorRect = scrollAnchorEl.getBoundingClientRect();
		// anchorContentY: コンテンツ先頭からのアンカー要素上端の距離（scrollTopに依存しない）
		const anchorContentY = scrollContainer.scrollTop + anchorRect.top - scrollContainer.getBoundingClientRect().top;
		// キャプチャ時と同じ scrollTop になるよう直接セット（コンテナ高さ変化に依存しない）
		scrollContainer.scrollTop = anchorContentY - anchorContainerLocalY;
	};

	onDeactivated(
		/** 停用保留当前锚点与位置供正常回访，同时撤销本轮恢复任务。 */
		(): void => {
			active = false;
			invalidatePendingRestore();
			const el: HTMLElement | null | undefined = scrollContainerRef.value;
			if (el) savedScrollTop = el.scrollTop;
			ready = false;
		},
	);

	onActivated(
		/** 每次回访建立新的任务代次，旧 nextTick 和延迟任务不能跨回访执行。 */
		(): void => {
			active = true;
			invalidatePendingRestore();
			const generation: number = restoreGeneration;
			restore();
			void nextTick(
				/** DOM 更新后仅恢复本轮仍活动的容器。 */
				(): void => {
					if (!active || generation !== restoreGeneration) return;
					restore();
					restoreTimer = window.setTimeout(
						/** 延迟修正须仍属于当前代次，取消后不得重新写入旧位置。 */
						(): void => {
							if (!active || generation !== restoreGeneration) return;
							restoreTimer = null;
							restore();

							// anchor方式が失敗した場合（anchorIdがnullまたは要素が見つからない場合）の
							// フォールバック
							const el: HTMLElement | null | undefined = scrollContainerRef.value;
							if (el && el.scrollTop === 0 && savedScrollTop > 0) {
								el.scrollTop = savedScrollTop;
							}

							ready = true;
						},
						100,
					);
				},
			);
		},
	);

	onBeforeUnmount(
		/** 卸载使全部恢复任务失效，捕获回调也不再提交新的锚点。 */
		(): void => {
			active = false;
			ready = false;
			invalidatePendingRestore();
		},
	);

	return {
		/** 提供显式内容切换使用的窄取消能力，存量消费者可以忽略返回值。 */
		cancelPendingRestore,
	};
}
