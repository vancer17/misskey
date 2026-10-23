/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通知页面生命周期适配：仅在实际激活且文档可见的全部通知面板提交已读，不持有通知业务状态。 */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { useDocumentVisibility } from '@@/js/use-document-visibility.js';
import { confirmNotificationsRead } from '../store/notification-read.js';

/** 首次挂载、缓存回访与恢复前台共用一个响应式门控，首次 activated 不重复确认。 */
export function useNotificationsRead(enabled: () => boolean): void {
	const active: Ref<boolean> = ref(false);
	const visibility: Ref<DocumentVisibilityState> = useDocumentVisibility();

	onMounted(/** 只改变 UI 生命周期标记，已读状态仍由账户对账决定。 */ (): void => { active.value = true; });
	onActivated(/** 缓存页面重新进入后恢复可见面板的已读确认。 */ (): void => { active.value = true; });
	onDeactivated(/** 缓存期间不响应文档恢复可见，已开始的写入不取消。 */ (): void => { active.value = false; });
	onBeforeUnmount(/** 停止创建新意图，不中断模块持有的服务端对账。 */ (): void => { active.value = false; });
	watch(
		/** 页面、浏览器与面板三者都可见时才产生读意图。 */ (): readonly [boolean, DocumentVisibilityState, boolean] => [active.value, visibility.value, enabled()],
		/** 生命周期门控不直接写入未读数量或通知实体。 */ ([isActive, state, isEnabled]: readonly [boolean, DocumentVisibilityState, boolean]): void => {
			if (isActive && state === 'visible' && isEnabled) void confirmNotificationsRead();
		},
		{ flush: 'post' },
	);
}
