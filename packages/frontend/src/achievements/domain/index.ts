/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：成就领域公共入口。
 * 作用：向原申领工具及业务层暴露唯一目录、徽章和权威类型，避免加载页面或状态实现。
 * 数据链：领域定义 → 协议适配／Store／展示，不执行请求或环境加载。
 */
export { ACHIEVEMENT_TYPES, ACHIEVEMENT_BADGES, ACHIEVEMENT_FRAME_STYLES, ACHIEVEMENT_BADGE_EFFECTS } from './catalog.js';
export type { AchievementName, AchievementBadge } from './catalog.js';
export type { Achievement, OwnAchievementsState } from './models.js';
