/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 动效时长权威常量
 *
 * 作用：定义 Twitter UI 动效时长的 JS 侧唯一数值来源，供 Vue <Transition> 的
 * 数值型 :duration 消费（MkModal 等）。CSS 侧同值经 ui/twitter/tokens.scss 的
 * --twitter-duration-* 变量投影（ADR-0001：两处投影必须同步修改，属跨介质
 * 单权威对，禁止在组件内出现第三份时长字面量）。
 *
 * 数据链角色：本常量（权威事实）→ MkModal.transitionDuration（twitter 分支）
 * → <Transition :duration>；样式侧另由 tokens.scss 投影到各过渡变体。
 */

/**
 * Twitter UI 动效时长集合（ms），JS 侧唯一权威定义。
 */
export const TWITTER_MOTION_DURATIONS = {
	/** 快速反馈：菜单弹层（popup）与 tooltip 的进出过渡。 */
	fast: 120,
	/** 标准过渡：对话框（modal）与发帖完成（send）的淡入淡出。 */
	normal: 180,
	/** 强调动效：底部抽屉（drawer / X sheet）的上滑与回落。 */
	slow: 240,
} as const;
