/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：嵌入账户状态的既有模块接缝。
 * 作用：公开唯一账户 Store 的只读投影，所有变更回到同一状态所有者。
 * 数据链：真实 BFF 账户 → 状态模型 → 既有消费者；不附加 token 或读取本地账户缓存。
 */
import type { entities } from 'misskey-js';
import { getCommunityAccount, incrementCommunityNotesCount } from '../state/session/index.js';

/** 沿用 SDK 权威账户类型；null 只表示当前尚无经过验证的账户。 */
export const $i: Readonly<entities.MeDetailed> | null = getCommunityAccount();
/** 未认证状态不授予管理权限。 */
export const iAmModerator: boolean = $i !== null && ($i.isAdmin || $i.isModerator);
/** 未认证状态不授予实例管理员权限。 */
export const iAmAdmin: boolean = $i?.isAdmin ?? false;

/** 缺少真实会话时拒绝取得已登录账户。 */
export function ensureSignin(): Readonly<entities.MeDetailed> {
	const current: Readonly<entities.MeDetailed> | null = getCommunityAccount();
	if (current === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	return current;
}

/** 从唯一账户事实派生当前展示计数，不维护数值副本。 */
export function getNotesCount(): number {
	return ensureSignin().notesCount;
}

/** 成功发布后的展示变化提交给唯一账户状态 Action。 */
export function incNotesCount(): void {
	incrementCommunityNotesCount();
}
