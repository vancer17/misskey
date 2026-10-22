/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：Twitter UI · 路由代码加载。
 * 作用：为正式异步页面与交互意图预加载提供唯一 loader；本模块不静态依赖页面组件或请求业务 API。
 * 数据链：入口交互意图 → 页面代码缓存 → 原路由异步组件；失败仅释放预加载任务，导航继续走原生命周期。
 */

/** 频道详情外层路由与预加载共享同一个模块入口。 */
export function loadChannelPage(): Promise<typeof import('@/pages/channel.vue')> {
	return import('@/pages/channel.vue');
}

/** 频道外层页面和预加载共享 Twitter 业务展示模块。 */
export function loadTwitterChannelPage(): Promise<typeof import('@/pages/TwitterChannel.vue')> {
	return import('@/pages/TwitterChannel.vue');
}

/** 个人资料外层路由与预加载共享模块入口。 */
export function loadUserPage(): Promise<typeof import('@/pages/user/index.vue')> {
	return import('@/pages/user/index.vue');
}

/** 个人资料页面和预加载共享 Twitter 展示模块，避免二次按需加载串行等待。 */
export function loadTwitterUserPage(): Promise<typeof import('@/pages/user/TwitterHome.vue')> {
	return import('@/pages/user/TwitterHome.vue');
}

/** 通知路由仍由原异步组件创建，预加载只预热它的模块缓存。 */
export function loadNotificationsPage(): Promise<typeof import('@/pages/notifications.vue')> {
	return import('@/pages/notifications.vue');
}

/** 合并同一入口的意图预加载；失败后允许后续意图重试，不向导航事件传播拒绝。 */
function createCodePreloader(load: () => Promise<void>): () => void {
	/** 成功任务保留为代码已就绪的记录；不保存实体、查询参数或业务响应。 */
	let task: Promise<void> | null = null;
	return /** 同步提交意图，不阻塞点击和原路由导航。 */ (): void => {
		task ??= load().catch(
			/** 网络或模块加载失败只重置预热记录，正式加载继续自行报告错误。 */
			(): void => { task = null; },
		);
	};
}

/** 频道入口意图并行预热外层路由与展示模块，不接受业务实体标识。 */
export const preloadTwitterChannelPage: () => void = createCodePreloader(
	/** 两个模块同时开始传输，消除外层就绪后再请求展示层的串行等待。 */
	async (): Promise<void> => { await Promise.all([loadChannelPage(), loadTwitterChannelPage()]); },
);

/** 个人资料入口意图并行预热路由与展示代码，不预取用户接口。 */
export const preloadTwitterUserPage: () => void = createCodePreloader(
	/** 保持页面模块为动态依赖，不将资料业务代码纳入 UI 宿主初始包。 */
	async (): Promise<void> => { await Promise.all([loadUserPage(), loadTwitterUserPage()]); },
);

/** 通知入口意图仅预热已有通知路由代码，不改写通知队列与未读状态。 */
export const preloadTwitterNotificationsPage: () => void = createCodePreloader(
	/** 通知展示已包含在路由模块中，无需建立新的页面注册表。 */
	async (): Promise<void> => { await loadNotificationsPage(); },
);
