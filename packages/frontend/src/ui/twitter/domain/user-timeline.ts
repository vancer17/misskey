/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 用户资料时间线领域。
 * 作用：定义个人资料页现有帖子集合的唯一标签类型。
 * 数据链：账户标识与路由标签 → 资料列表查询所有者 → 既有帖子展示组件。
 */

/** 个人资料页支持的四类后端帖子集合；home 路由在页面层单向投影为 notes。 */
export type TwitterUserTimelineTab = 'notes' | 'replies' | 'files' | 'featured';
