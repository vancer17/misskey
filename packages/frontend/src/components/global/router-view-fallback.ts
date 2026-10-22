/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：通用路由出口的加载展示上下文。
 * 作用：将宿主提供的 fallback 插槽向嵌套路由出口传递，不解释路由或业务状态。
 * 数据链：UI 宿主插槽 → 根出口 → 嵌套出口；未提供时维持各出口原有的 MkLoading。
 */

import type { InjectionKey, Slot } from 'vue';

/** 路由出口只传递加载展示函数，不传递页面实例或业务实体。 */
export const routerViewFallbackKey: InjectionKey<Slot | undefined> = Symbol('router-view-fallback');
