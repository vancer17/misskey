/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 时间线手动刷新结果。
 * 作用：为查询所有者与页面反馈提供唯一结果契约，不将接口完成等同于查询成功。
 * 数据链：真实查询及归属校验 → 本结果 → 页面轻量反馈；不承载帖子副本。
 */

/** 手动刷新成功、失败及生命周期撤销的唯一业务结果。 */
export type TwitterTimelineRefreshResult =
	/** 成功查询确认了点击前尚未展示的新帖子。 */
	| 'updated'
	/** 成功查询未确认新增，保留已加载窗口。 */
	| 'unchanged'
	/** 查询失败，保留已有内容并允许重试。 */
	| 'failed'
	/** 查询归属已撤销，迟到响应不得提交或提示。 */
	| 'cancelled';
