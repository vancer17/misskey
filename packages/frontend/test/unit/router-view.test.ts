/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：通用路由出口的组件契约测试。
 * 作用：验证实例复用与加载占位继承，不模拟领域行为或后端业务结果。
 * 数据链：真实 Nirax 路由解析 → Vue Suspense 出口 → 宿主展示插槽。
 */

import { afterEach, assert, describe, test } from 'vitest';
import { defineAsyncComponent, defineComponent, h, nextTick } from 'vue';
import type { Component, VNode } from 'vue';
import { cleanup, render, waitFor } from '@testing-library/vue';
import { Nirax, type RouteDef } from '@/lib/nirax.js';
import type { Router } from '@/router.js';
import RouterView from '@/components/global/RouterView.vue';
import NestedRouterView from '@/components/global/NestedRouterView.vue';
import StackingRouterView from '@/components/global/StackingRouterView.vue';

/** 仅控制模块就绪时机，验证 Suspense 展示协议，不伪造业务请求。 */
function createPendingPage(): Readonly<{ page: Component; release: () => void }> {
	/** 允许测试在断言占位后推进模块加载生命周期。 */
	let release!: () => void;
	/** 显式挂起模块，避免依赖真实网络速度决定测试结果。 */
	const pending: Promise<void> = new Promise<void>(
		/** 保存模块就绪的控制入口。 */
		(resolve: (value: void | PromiseLike<void>) => void): void => { release = resolve; },
	);
	/** 就绪后的普通页面，只用于识别占位已交接给实际内容。 */
	const loadedPage: Component = defineComponent({
		/** 纯展示页面不读取路由或领域状态。 */
		setup: (): (() => VNode) => /** 以可观测节点确认加载结束。 */ (): VNode => h('div', { 'data-testid': 'loaded-route' }),
	});
	/** 异步组件模拟代码就绪，不替代原路由器与 Vue 加载机制。 */
	const page: Component = defineAsyncComponent(
		/** 等待测试释放模块后返回正常页面。 */
		async (): Promise<Component> => { await pending; return loadedPage; },
	);
	return { page, release };
}

afterEach(cleanup);

describe('route loading presentation', /** 三个出口共享展示契约，保持非定制宿主的默认行为。 */ (): void => {
	test('uses the default loading component without a host slot', /** 缺少宿主插槽时维持已有加载展示。 */ (): void => {
		/** 延后代码就绪，确保断言发生在加载阶段。 */
		const pending: ReturnType<typeof createPendingPage> = createPendingPage();
		/** 使用实际路由解析，不模拟 RouterView 内部状态。 */
		const router: Router = new Nirax([{ path: '/', component: pending.page }], '/', false, pending.page) as unknown as Router;
		/** 注册最小展示组件以识别默认占位。 */
		const view: ReturnType<typeof render> = render(RouterView, {
			props: { router },
			global: { components: { MkLoading: { template: '<div data-testid="default-route-loading"></div>' } } },
		});
		assert.exists(view.container.querySelector('[data-testid="default-route-loading"]'));
		pending.release();
	});

	test.each([RouterView, StackingRouterView])('inherits the host fallback in a nested outlet (%#)', /** 根和叠层入口均透传宿主加载展示。 */ async (outlet: Component): Promise<void> => {
		/** 子路由的模块保持挂起，根页面本身立即就绪。 */
		const pending: ReturnType<typeof createPendingPage> = createPendingPage();
		/** 同步父页面保持实例，只有嵌套出口处理子页面加载。 */
		const parentPage: Component = defineComponent({
			/** 父页面不另建数据状态或复制路由解析结果。 */
			setup: (): (() => VNode) => /** 显式创建嵌套出口来验证实际继承链。 */ (): VNode => h(NestedRouterView, { router }),
		});
		/** 真实父子路由使 currentDepth 逻辑参与测试。 */
		const routes: RouteDef[] = [{ path: '/parent', component: parentPage, children: [{ path: '/child', component: pending.page }] }];
		/** 父页面挂载前建立唯一的真实路由器，其渲染闭包在挂载时才读取。 */
		const router: Router = new Nirax(routes, '/parent/child', false, parentPage) as unknown as Router;
		/** 宿主只提供根插槽，不直接把占位传给子页面。 */
		const view: ReturnType<typeof render> = render(outlet, {
			props: { router },
			slots: { fallback: /** 展示插槽不依赖路由或业务状态。 */ (): VNode => h('div', { 'data-testid': 'host-route-loading' }) },
			global: { components: { MkLoading: { template: '<div data-testid="default-route-loading"></div>' } } },
		});
		assert.exists(view.container.querySelector('[data-testid="host-route-loading"]'));
		assert.notExists(view.container.querySelector('[data-testid="default-route-loading"]'));
		pending.release();
		await waitFor(/** 就绪后原出口完成交接，宿主占位不残留。 */ (): void => {
			assert.exists(view.container.querySelector('[data-testid="loaded-route"]'));
			assert.notExists(view.container.querySelector('[data-testid="host-route-loading"]'));
		});
	});
});

describe('RouterView', () => {
	test('should reuse a component instance when the route defines a stable view key', async () => {
		let setupCount = 0;
		const Page = defineComponent({
			props: {
				acct: {
					type: String,
					required: true,
				},
				page: {
					type: String,
					default: undefined,
				},
			},
			setup(props) {
				setupCount++;
				return () => h('div', {
					'data-testid': 'router-view-page',
					'data-page': props.page ?? 'home',
				}, props.page ?? 'home');
			},
		});

		const routes: RouteDef[] = [{
			name: 'user',
			path: '/@:acct/:page?',
			viewKey: 'user',
			component: Page,
		}];

		const router = new Nirax(routes, '/@blobcat/notes', false, Page) as unknown as Router;
		const view = render(RouterView, {
			props: {
				router,
			},
		});

		await nextTick();
		assert.strictEqual(setupCount, 1);
		assert.strictEqual(view.container.querySelector('[data-testid="router-view-page"]')?.getAttribute('data-page'), 'notes');

		router.pushByPath('/@blobcat/replies');
		await nextTick();

		assert.strictEqual(setupCount, 1);
		assert.strictEqual(view.container.querySelector('[data-testid="router-view-page"]')?.getAttribute('data-page'), 'replies');
	});
});
