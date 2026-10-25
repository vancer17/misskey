/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层 · 同步布局策略与权威断点
 *
 * 作用：定义 Twitter UI 响应式断点与路由展示分类的唯一权威来源。
 * 列宽及右栏显隐在代码等待前就确定，不依赖页面随后提交的元信息；
 * 禁止在 SCSS 媒体查询或组件中复制断点后依靠测试维持一致。
 *
 * 数据链角色：本常量（权威事实）→ composables/use-twitter-layout.ts（响应式状态派生）
 * → Shell 与匿名入口组件（消费点）；同步路由模板 → 展示策略 → Shell 的占位与导航。
 * CSS 侧不书写布局断点媒体查询，此模块不接收业务实体或环境探测。
 */

/**
 * Twitter UI 响应式布局断点集合（px），全模块唯一权威定义。
 */
export const TWITTER_LAYOUT_BREAKPOINTS = {
	/** 移动端阈值：视口宽 ≤ 此值时启用移动 Shell（底部导航 + 发帖 FAB）。 */
	mobile: 500,
	/** 右栏阈值：视口宽 ≥ 此值时显示右侧信息栏。 */
	rightRail: 1280,
	/** 匿名入口紧凑布局上界（不含）：X 归档 max-sm，独立于业务移动 Shell。 */
	entryCompact: 512,
	/** 匿名入口双列布局下界：X 归档 md；禁止改写业务右栏断点。 */
	entrySplit: 768,
	/** 发帖工具栏极窄容器上界（不含）：X Compose 的 xxSmall，独立于移动 Shell。 */
	composerNarrow: 320,
	/** 私信工作区双栏所需容器宽度：XChat 容器查询值，不改变全站移动断点。 */
	chatSplit: 918,
} as const;

/** 聊天路由的展示名称权威；只用于 Shell 几何，不解释会话权限或实体。 */
export const TWITTER_CHAT_ROUTE_NAMES = {
	/** 会话列表与桌面未选择会话状态。 */
	inbox: 'chat-home',
	/** 一对一本地会话。 */
	user: 'chat-user',
	/** 既有群聊会话。 */
	room: 'chat-room',
	/** 既有消息深链。 */
	message: 'chat-message',
} as const;

/** 同步路由名称单向派生工作区展示，首次加载即避让 FAB，不等待页面请求。 */
export function resolveTwitterChatLayout(name: string | undefined): 'inbox' | 'conversation' | null {
	if (name === TWITTER_CHAT_ROUTE_NAMES.inbox) return 'inbox';
	if (name === TWITTER_CHAT_ROUTE_NAMES.user || name === TWITTER_CHAT_ROUTE_NAMES.room || name === TWITTER_CHAT_ROUTE_NAMES.message) return 'conversation';
	return null;
}

/** Shell 的同步展示策略；仅派生路由几何，不承载页面实体、权限或异步元信息。 */
export type TwitterShellLayout = Readonly<{
	chat: ReturnType<typeof resolveTwitterChatLayout>;
	rightRail: boolean;
}>;

/**
 * 由已解析的路由名称与完整路由模板确定 Shell，目标代码等待期间也使用同一列宽。
 * 两个存量管理宽页继续隐藏右栏；其余普通页复用主列与右栏，聊天保留有界工作区。
 * PageMetadata 的宽页字段仍服务原生 UI，Twitter 不再消费上一个页面的异步字段。
 */
export function resolveTwitterShellLayout(name: string | undefined, routePath: string): TwitterShellLayout {
	const chat: TwitterShellLayout['chat'] = resolveTwitterChatLayout(name);
	return {
		chat,
		rightRail: chat === null && routePath !== '/admin/emojis2' && routePath !== '/admin/job-queue',
	};
}
