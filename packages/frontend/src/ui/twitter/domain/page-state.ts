/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 共享页面状态权威类型
 *
 * 作用：定义必做页面（时间线 / 帖子详情 / 用户主页 / 通知 / 搜索 / 404 页）
 * 共享的终态类型与骨架屏形态变体，作为全模块唯一权威（规范第 10 条：
 * 禁止各组件复制状态联合类型）。
 *
 * 数据链角色：页面取数逻辑（错误码判定等单向派生）→ 本类型（权威状态）
 * → TwitterPageState / TwitterPageSkeleton（呈现）。
 */

/**
 * Twitter UI 必做页面共享终态类型集合（不含 loading：加载态由骨架屏独立呈现）。
 */
export const TWITTER_PAGE_STATE_TYPES = [
	/** 空态 / 无结果：请求成功但集合为空或无匹配内容。 */
	'empty',
	/** 未找到：请求失败且错误码表明实体不存在（404 语义，不可重试）。 */
	'notFound',
	/** 错误：请求失败且可重试。 */
	'error',
] as const;

/**
 * 页面终态类型：由权威常量派生，组件不得另行声明等价联合类型（规范第 10 条）。
 */
export type TwitterPageStateType = (typeof TWITTER_PAGE_STATE_TYPES)[number];

/**
 * 骨架屏形态变体集合：对应必做页面的内容结构（X-behavior 来源）。
 */
export const TWITTER_PAGE_SKELETON_VARIANTS = [
	/** 时间线 / 搜索结果列表：头像 + 昵称条 + 两行文本。 */
	'timeline',
	/** 通知列表：小图标圆 + 短 / 长两行。 */
	'notifications',
	/** 帖子详情：头部行 + 多行正文 + 操作栏。 */
	'detail',
	/** 用户主页：banner + 大头像 + 身份行 + tabs。 */
	'profile',
] as const;

/**
 * 骨架屏形态变体：由权威常量派生。
 */
export type TwitterPageSkeletonVariant = (typeof TWITTER_PAGE_SKELETON_VARIANTS)[number];
