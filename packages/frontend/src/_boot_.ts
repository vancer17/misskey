/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 浏览器 Bootstrap 入口：先验证缓存会话，再动态导入会启动账户任务的应用模块。
 * 失效记录由既有账户模块定向移除；不探测基础设施，不改变页面设计或后端鉴权。
 */
import 'vite/modulepreload-polyfill';
import '@/style.scss';
import { prepareBootSession } from '@/boot/session/index.js';
import { i18n } from '@/i18n.js';
import type { InvalidSession } from '@/accounts/index.js';

if (import.meta.env.DEV) {
	await import('@tabler/icons-webfont/dist/tabler-icons.scss');
} else {
	await import('icons-subsetter/built/tabler-icons-frontend.css');
}

const invalidSession: InvalidSession | null = await prepareBootSession();
let recovered: boolean = false;
if (invalidSession !== null) {
	const { removeInvalidAccount } = await import('@/accounts.js');
	recovered = await removeInvalidAccount(invalidSession.credentials);
	if (recovered) {
		const { reloadChannel } = await import('@/utility/unison-reload.js');
		await reloadChannel.postMessage(null);
	}
}

/** 既有子启动路由，只决定 UI 入口，不存放账户或业务事实。 */
const subBootPaths: readonly string[] = ['/share', '/auth', '/miauth', '/oauth', '/signup-complete', '/verify-email', '/install-extensions'];
const isSubBoot: boolean = subBootPaths.some(
	/** 同时覆盖子入口本身及其下级路由。 */
	(path: string): boolean => window.location.pathname === path || window.location.pathname.startsWith(path + '/'),
);
if (isSubBoot) {
	const { subBoot } = await import('@/boot/sub-boot.js');
	await subBoot();
} else {
	const { mainBoot } = await import('@/boot/main-boot.js');
	await mainBoot();
}

if (recovered && window.localStorage.getItem('account') === null) {
	const { alert } = await import('@/os.js');
	await alert({
		type: 'warning',
		title: invalidSession?.reason === 'deleted' ? i18n.ts.accountDeleted : i18n.ts.tokenRevoked,
		text: invalidSession?.reason === 'deleted' ? i18n.ts.accountDeletedDescription : i18n.ts.tokenRevokedDescription,
	});
}
