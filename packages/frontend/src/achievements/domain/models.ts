/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：本人成就权威模型。
 * 作用：定义服务端确认后的成就事实和唯一查询状态；视图只能从这些事实派生。
 * 数据链：协议适配 → 本人成就 Store → 只读业务组件；不解释原始响应或路由字段。
 */
import type { AchievementName } from './catalog.js';

/** 已解锁事实只由服务端查询确认；通知与申领请求不会直接构造成就。 */
export type Achievement = Readonly<{
	name: AchievementName;
	unlockedAt: number;
}>;

/** 唯一查询状态保留最后成功结果；刷新失败不会撤下已确认成就。 */
export type OwnAchievementsState = Readonly<{
	userId: string | null;
	status: 'idle' | 'loading' | 'ready' | 'error';
	items: readonly Achievement[] | null;
}>;
