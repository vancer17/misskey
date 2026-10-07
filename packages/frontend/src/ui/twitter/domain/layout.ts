/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 布局权威常量
 *
 * 作用：定义 Twitter UI 响应式断点的唯一权威来源（代码规范第 10 条：单权威，
 * 禁止在 SCSS 媒体查询或组件中复制断点后依靠测试维持一致）。
 *
 * 数据链角色：本常量（权威事实）→ composables/use-twitter-layout.ts（响应式状态派生）
 * → Shell 组件（唯一消费点）；CSS 侧不书写布局断点媒体查询。
 */

/**
 * Twitter UI 响应式布局断点集合（px），全模块唯一权威定义。
 */
export const TWITTER_LAYOUT_BREAKPOINTS = {
	/** 移动端阈值：视口宽 ≤ 此值时启用移动 Shell（底部导航 + 发帖 FAB）。 */
	mobile: 500,
	/** 右栏阈值：视口宽 ≥ 此值时显示右侧信息栏。 */
	rightRail: 1280,
} as const;
