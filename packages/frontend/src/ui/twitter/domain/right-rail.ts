/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 右栏固定内容权威类型与常量
 *
 * 作用：定义右侧信息栏两张固定内容卡（趋势 / 推荐关注）的权威领域类型与
 * 显示上限常量（ADR-0002 决策 D2：移除 Misskey 自配挂件，右栏改为固定内容）。
 * 趋势条目为 hashtags/trend 接口原始响应的单向只读视图投影——原始响应
 * 不得反向参与业务决策（代码规范第 12 条）。
 *
 * 数据链角色：hashtags/trend、users/recommendation、pinned-users 接口响应
 * → composables 层（适配器，单向映射与降级链）→ 本类型（右栏业务权威形态）
 * → TwitterTrending / TwitterWhoToFollow 组件（展示，只读消费）。
 *
 * 类型权威说明：推荐关注条目不另建类型，misskey-js 的
 * Misskey.entities.UserDetailed 即该业务概念唯一权威类型（代码规范第 10 条
 * 禁止复制类型投影）。
 *
 * 形制来源说明：nitter 为单列只读查看器，无右栏与趋势 / 推荐域
 * （检索证据见 port-fidelity-audit.md P-23 登记节），右栏形制属
 * X-behavior，成文见 ADR-0004。
 */

/**
 * 趋势条目权威类型：hashtags/trend 响应条目的只读视图投影，
 * 仅保留右栏展示所需字段（chart 序列留待后续 sparkline 需求再引入，
 * 避免悬空字段——代码规范第 9 条）。
 */
export type TwitterTrendItem = {
	/** 趋势 hashtag 名称（不含 # 前缀，路由目标为 /tags/:tag）。 */
	tag: string;
	/** 统计窗口内参与该 hashtag 的用户数峰值（对应接口 usersCount 字段）。 */
	usersCount: number;
};

/**
 * 右栏固定内容显示上限常量（X 右栏形制，B 类成文见 ADR-0004）。
 */
export const RIGHT_RAIL_LIMITS = {
	/** 趋势卡展示条目数（接口返回 Top 10，右栏取前 N 条且不设「显示更多」入口）。 */
	trendingTags: 5,
	/** 推荐关注卡展示用户数。 */
	recommendedUsers: 3,
	/** users/recommendation 请求条数（多于展示数，用于抵扣登录者本人被过滤后的缺口）。 */
	recommendationQueryLimit: 5,
} as const;
