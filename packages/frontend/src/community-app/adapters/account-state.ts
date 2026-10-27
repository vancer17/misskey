/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：尚未安装 BFF 会话时的嵌入账户边界。
 * 作用：保持明确的未认证状态；真实应用入口在此阶段不得挂载。
 * 数据链：缺少会话 → null 身份与显式拒绝；不读取 App 或 Misskey 本地账户缓存。
 */
import type { entities } from 'misskey-js';
import { requireCommunitySession } from '../bootstrap/index.js';

/** 沿用 SDK 权威账户类型；null 只表示当前尚无经过验证的账户。 */
export const $i: entities.MeDetailed | null = null;
/** 未认证状态不授予管理权限。 */
export const iAmModerator: boolean = false;
/** 未认证状态不授予实例管理员权限。 */
export const iAmAdmin: boolean = false;
/** 未建立账户前沿用原模块的初始展示计数，不将其发布为账户事实。 */
export const notesCount: number = 0;

/** 缺少真实会话时拒绝取得已登录账户。 */
export function ensureSignin(): never {
	return requireCommunitySession();
}

/** 缺少真实写入和账户状态时拒绝改变帖子计数。 */
export function incNotesCount(): never {
	return requireCommunitySession();
}
