/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · composables 层 · UI 风格上下文判定
 *
 * 作用：读取 Shell（twitter.vue）注入的 DI.uiStyle，判定当前组件是否处于
 * Twitter UI 风格上下文，供共享 Mk* 弹层组件挂载 twitter 表现变体。
 *
 * 数据链角色：boot/main-boot.ts 选定 ui → twitter.vue provide(DI.uiStyle)
 * → 本组合函数（判定）→ MkMenu / MkDialog / MkTooltip / MkEmojiPickerDialog
 * 等共享组件的表现变体分支（仅表现，不含业务逻辑）。
 */

import { computed, inject, ref } from 'vue';
import type { ComputedRef } from 'vue';
import { DI } from '@/di.js';

/**
 * 判定当前组件是否渲染于 Twitter UI 风格上下文中。
 *
 * @returns true 表示当前处于 twitter UI（组件应挂载 twitter 表现变体 class）
 */
export function useIsTwitterUi(): ComputedRef<boolean> {
	const uiStyle = inject(DI.uiStyle, ref('default'));
	return computed(() => uiStyle.value === 'twitter');
}
