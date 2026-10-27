/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：包内 Twitter 社区的真实应用代码入口。
 * 作用：把既有 Twitter 根、原页面与基础注册能力纳入制品，不以演示壳替代真实 UI。
 * 数据链：专用构建图 → 真实应用依赖；完整初始化与活动生命周期尚未接通时不执行挂载。
 */
import 'vite/modulepreload-polyfill';
import '@/style.scss';
import 'icons-subsetter/built/tabler-icons-frontend.css';
import TwitterRoot from '@/ui/twitter.vue';
import components from '@/components/index.js';
import directives from '@/directives/index.js';
import { mainRouter } from './routing/index.js';
import { requireCommunityApplication } from './bootstrap/index.js';

/** 保留真实 Twitter 及基础组件依赖，供后续真实会话装配消费；不是业务就绪标记。 */
export const communityApplication: Readonly<{
	root: typeof TwitterRoot;
	components: typeof components;
	directives: typeof directives;
	router: typeof mainRouter;
}> = Object.freeze({ root: TwitterRoot, components, directives, router: mainRouter });

/** 当前缺少 BFF 账户与传输实现时明确拒绝挂载，不制造假 Me/token 或桥接 ACK。 */
export function mountCommunityApplication(): never {
	return requireCommunityApplication();
}
