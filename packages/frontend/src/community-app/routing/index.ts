/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：本地社区文档内路由。
 * 作用：复用 Nirax 与真实页面解析，不修改浏览器顶层或 iframe 物理入口。
 * 数据链：内部序列化路径 → 原页面生命周期；返回与宿主协调留待正式接线。
 */
import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import { Nirax } from '@/lib/nirax.js';
import { DI } from '@/di.js';
import { $i } from '@/i.js';
import { page, ROUTE_DEF } from './definition.js';

/** 从本制品唯一装配路由表派生路由器类型。 */
export type Router = Nirax<typeof ROUTE_DEF>;

/** 创建独立内存路由，不注册 popstate 或写入 window.history。 */
export function createRouter(fullPath: string): Router {
	const router: Router = new Nirax(ROUTE_DEF, fullPath, $i !== null, page(/** 缺失内容使用原错误页面。 */ (): Promise<typeof import('@/pages/not-found.vue')> => import('@/pages/not-found.vue')));

	/** 强制页面导航在嵌入环境中仍留在当前文档。 */
	function keepInDocument(context: { fullPath: string }): void { router.replaceByPath(context.fullPath); }

	router.addListener('forcePush', keepInDocument);
	router.addListener('forceReplace', keepInDocument);
	router.init();
	return router;
}

/** 初始业务路径固定在文档内部，物理 URL 不作为业务状态副本。 */
export const mainRouter: Router = createRouter('/');

/** 沿用基础组件的注入入口，窗口页面仍可提供所属路由器。 */
export function useRouter(): Router {
	return inject(DI.router as InjectionKey<Router>, null) ?? mainRouter;
}

export { page, ROUTE_DEF } from './definition.js';
