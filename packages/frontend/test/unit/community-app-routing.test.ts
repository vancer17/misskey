/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：包内社区路由装配的协议测试。
 * 作用：验证路径解析顺序及物理文档地址不变，不证明页面业务或后端权限。
 * 数据链：内部序列化地址 → 原 Nirax 解析结果。
 */
import { describe, expect, it } from 'vitest';
import { createRouter } from '@/community-app/routing/index.js';
import type { Router } from '@/community-app/routing/index.js';

describe('community document routing', /** 只证明路由解析和内存导航边界。 */ (): void => {
	it('resolves following before the generic user page', /** 具体关系路径不得被可选 page 参数吞掉。 */ (): void => {
		const router: Router = createRouter('/@alice/following');
		expect(router.currentRoute.value.path).toBe('/@:acct/following');
	});

	it('resolves followers before the generic user page', /** 被关注列表使用既有专用页面。 */ (): void => {
		const router: Router = createRouter('/@alice/followers');
		expect(router.currentRoute.value.path).toBe('/@:acct/followers');
	});

	it('preserves the existing notification address', /** 侧栏原链接应命中同一个原页面。 */ (): void => {
		const router: Router = createRouter('/my/notifications');
		expect(router.currentRoute.value.path).toBe('/my/notifications');
	});

	it('resolves channel creation before the channel identifier', /** 创建路径不能被当作频道标识。 */ (): void => {
		const router: Router = createRouter('/channels/new');
		expect(router.currentRoute.value.path).toBe('/channels/new');
	});

	it('uses a named catch-all for native authentication addresses', /** 未交付路径不会重定向到原认证页或递归导航。 */ (): void => {
		const router: Router = createRouter('/reset-password/secret');
		expect(router.currentRoute.value.name).toBe('community-not-found');
		expect(router.currentRoute.value.path).toBe('/:communityUnknownPath(*)');
	});

	it('keeps physical document address unchanged', /** 业务地址仅保留在文档内路由器。 */ (): void => {
		const beforeUrl: string = window.location.href;
		const router: Router = createRouter('/');
		router.pushByPath('/my/notifications');
		router.replaceByPath('/unknown-community-route');
		expect(window.location.href).toBe(beforeUrl);
		expect(router.currentRoute.value.name).toBe('community-not-found');
	});

	it('retains native login guards for every reused private address', /** 真实 Nirax 必须拒绝未认证会话，不依赖外层启动门控代替原保护。 */ (): void => {
		const privatePaths: readonly string[] = [
			'/my/notifications', '/channels/owned/edit', '/channels/new', '/my/lists/owned', '/my/lists', '/my/favorites',
			'/chat', '/chat/user/other', '/chat/room/owned', '/chat/messages/message', '/settings/profile',
		];
		for (const path of privatePaths) {
			const router: Router = createRouter(path);
			expect(router.currentRoute.value.loginRequired, path).toBe(true);
			expect(router.current.props.get('showLoginPopup'), path).toBe(true);
		}
	});

	it('does not impose login on native public addresses', /** 既有公开页面不因专用构建额外增加认证规则。 */ (): void => {
		const publicPaths: readonly string[] = ['/', '/@alice', '/notes/note', '/search', '/explore', '/channels', '/channels/public', '/list/public', '/announcements', '/announcements/public'];
		for (const path of publicPaths) {
			const router: Router = createRouter(path);
			expect(router.currentRoute.value.loginRequired, path).not.toBe(true);
			expect(router.current.props.get('showLoginPopup'), path).not.toBe(true);
		}
		expect(createRouter('/list/public').currentRoute.value.name).toBe('list');
	});
});
