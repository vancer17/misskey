/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 用户实体取数终态派生
 *
 * 作用：定义「用户不存在」错误码判定与页面终态类型的单向派生规则，
 * 供用户主页（TwitterHome）与关注关系列表（TwitterFollowList）共享，
 * 避免各页面复制同一错误判定逻辑（规范第 10 条）。
 *
 * 数据链角色：页面取数错误（users/show 响应）→ 本派生（仅读取错误 id 的
 * 单向判定）→ TwitterPageState（终态呈现）。
 */

import type { TwitterPageStateType } from './page-state.js';

/** users/show「用户不存在」错误码（misskey API 错误 id 权威值）。 */
const NO_SUCH_USER_ERROR_ID = '4362f8dc-731f-4ad8-a694-be5a88922a24';

/**
 * 将用户取数错误单向派生为 Twitter UI 页面终态类型。
 *
 * @param err 页面层捕获的 users/show 错误（不解释完整形态，仅读取错误 id）
 * @returns 用户不存在 → notFound（404 语义，不可重试）；其余 → error（可重试）
 */
export function twitterUserErrorStateType(err: unknown): TwitterPageStateType {
	const maybeApiError = err as { id?: unknown } | null | undefined;
	return maybeApiError?.id === NO_SUCH_USER_ERROR_ID ? 'notFound' : 'error';
}
