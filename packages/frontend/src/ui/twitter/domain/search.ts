/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 搜索导航领域。
 * 作用：提供帖子与用户搜索标签的唯一取值类型；不存储查询结果或运行环境事实。
 * 数据链：简单路由输入 → 搜索容器只读标签 → 既有分页查询。
 */

/** 搜索页的标签标识；页面、导航和序列化投影共享这一来源。 */
export type TwitterSearchTab = 'note' | 'user';
