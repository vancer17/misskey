/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：本人成就业务模块公共入口。
 * 作用：公开唯一业务容器、权威目录与类型；内部查询和生命周期实现不跨模块引用。
 * 数据链：路由页面 → 业务容器 → Store／协议适配 → 只读事实呈现。
 */
/** 页面计时仅通过业务动作申领，不直接改成就状态。 */
export { ownAchievementsStore } from './store/own-achievements.js';
export { default as OwnAchievements } from './components/OwnAchievements.vue';
export { ACHIEVEMENT_TYPES, ACHIEVEMENT_BADGES } from './domain/index.js';
export type { Achievement, AchievementName, AchievementBadge, OwnAchievementsState } from './domain/index.js';
