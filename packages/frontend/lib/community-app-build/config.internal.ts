/*
 * 社区构建配置领域：定义固定编译输入及本期支持语言，并拒绝输出图中的外置代码。
 * 这些配置只控制制品生成，不提供运行时新旧业务架构切换。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import type { Plugin } from 'vite';
import type { NormalizedOutputOptions, OutputBundle } from 'rolldown';
export { COMMUNITY_SUPPORTED_LANGUAGES as COMMUNITY_BUILD_LANGUAGES } from '../../src/community-app/bootstrap/index.js';

/** 固定社区入口，与原站点入口分别编译。 */
export const COMMUNITY_BUILD_ENTRIES = {
	/** 未导入业务模块的最小启动壳。 */
	bootstrap: './src/community-app/bootstrap/entry.ts',
	/** 真实 Twitter 根及可达业务页面的编译入口。 */
	application: './src/community-app/application.ts',
	/** 既有语言内联器的权威入口。 */
	i18n: './src/i18n.ts',
} as const;

/** 在真实打包输出图上拒绝静态或动态外置代码，防止隐藏的 CDN 运行依赖。 */
export function createCommunityClosedGraphPlugin(frontendRoot: string): Plugin {
	const forbidden: ReadonlySet<string> = new Set([
		'src/_boot_.ts',
		'src/boot/main-boot.ts',
		'src/boot/sub-boot.ts',
		'src/boot/common.ts',
		'src/router.definition.ts',
		'src/i.ts',
		'src/accounts.ts',
		'src/signout.ts',
		'src/utility/please-login.ts',
		'src/utility/initialize-sw.ts',
		'src/ui/_common_/sw-inject.ts',
		'src/components/MkSignin.vue',
		'src/components/MkSigninDialog.vue',
		'src/components/MkSignupDialog.vue',
		'src/components/MkSignupDialog.form.vue',
		'src/pages/welcome.vue',
		'src/pages/auth.vue',
		'src/pages/miauth.vue',
		'src/pages/oauth.vue',
		'src/pages/reset-password.vue',
		'src/pages/signup-complete.vue',
		'src/ui/universal.vue',
		'src/ui/visitor.vue',
		'src/ui/deck.vue',
		'src/ui/zen.vue',
		'src/ui/_common_/common.vue',
		'src/ui/twitter/components/TwitterAuthButtons.vue',
	].map(/** 仅拒绝当前包内明确的原站点入口与副作用宿主。 */ (relative: string): string => path.join(frontendRoot, relative)));
	return {
		name: 'community-closed-module-graph',
		/** 输出文件名存在即证明该依赖属于当前输出图，而非网络外置模块。 */
		generateBundle(_options: NormalizedOutputOptions, bundle: OutputBundle): void {
			for (const output of Object.values(bundle)) {
				if (output.type !== 'chunk') continue;
				for (const moduleId of Object.keys(output.modules)) {
					if (forbidden.has(moduleId.split('?')[0])) throw new Error(`Original frontend entry leaked into community artifact: ${moduleId}`);
				}
				for (const dependency of [...output.imports, ...output.dynamicImports]) {
					if (!(dependency in bundle)) {
						throw new Error(`Community code must be bundled locally: ${output.fileName} -> ${dependency}`);
					}
				}
			}
		},
	};
}
