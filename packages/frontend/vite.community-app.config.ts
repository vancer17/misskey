/*
 * 社区专用编译入口：将真实 Twitter 图编译为本地子制品，并选择明确的嵌入边界适配器。
 * 不读取后端部署配置，不复制原站 loader，也不提供运行时前端架构切换。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import * as ts from 'typescript';
import { RolldownMagicString } from 'rolldown';
import locales from 'i18n';
import { createSharedViteConfig, hash, toBase62 } from './lib/vite-shared-config.js';
import { COMMUNITY_BUILD_ENTRIES, createCommunityClosedGraphPlugin } from './lib/community-app-build/index.js';
import pluginCreateSearchIndex from './lib/vite-plugin-create-search-index.js';
import type { Alias, Plugin, TransformResult, UserConfig } from 'vite';

/** 专用配置所在前端包根目录，不从执行工作目录推断资源位置。 */
const frontendRoot: string = path.dirname(fileURLToPath(import.meta.url));

/** 仅在确有裸 localStorage 引用的既有模块注入命名空间存储，不改写第三方或任意业务源码。 */
export function createCommunityStorageScopePlugin(): Plugin {
	const scopedSources: ReadonlySet<string> = new Set([
		path.join(frontendRoot, 'src/lib/pizzax.ts'),
		path.join(frontendRoot, 'src/debug.ts'),
		path.resolve(frontendRoot, '../frontend-shared/js/store-boot-errors.ts'),
	]);
	const scopedBroadcastSources: ReadonlySet<string> = new Set([
		path.join(frontendRoot, 'src/preferences.ts'),
		path.join(frontendRoot, 'src/lib/pizzax.ts'),
		path.join(frontendRoot, 'src/utility/unison-reload.ts'),
	]);
	return {
		name: 'community-storage-scope',
		enforce: 'pre',
		/** 通过导入绑定覆盖既有裸标识符，不替换字段、字符串或所有 window API。 */
		transform(source: string, id: string): TransformResult | null {
			const sourcePath: string = id.split('?')[0];
			if (!scopedSources.has(sourcePath) && !scopedBroadcastSources.has(sourcePath)) return null;
			const rewritten: RolldownMagicString = new RolldownMagicString(source);
			if (scopedSources.has(sourcePath)) rewritten.prepend("import { communityLocalStorage as localStorage } from '@/community-app/storage/index.js';\n");
			if (scopedBroadcastSources.has(sourcePath)) {
				const tree: ts.SourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
				for (const statement of tree.statements) {
					if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === 'broadcast-channel') {
						rewritten.update(statement.moduleSpecifier.getStart(tree) + 1, statement.moduleSpecifier.end - 1, '@/community-app/storage/broadcast.js');
					}
				}
			}
			const sourceMap: TransformResult['map'] = JSON.parse(rewritten.generateMap({ hires: true }).toString()) as TransformResult['map'];
			return { code: rewritten.toString(), map: sourceMap };
		},
	};
}

/** 以解析后的模块身份接管相对导入，避免原组件内部的相对路径绕过公开适配入口。 */
function createCommunityRelativeBoundaryPlugin(): Plugin {
	const replacements: ReadonlyMap<string, string> = new Map([
		[path.join(frontendRoot, 'src/ui/_common_/common.vue'), path.join(frontendRoot, 'src/community-app/components/CommunitySystemHost.vue')],
		[path.join(frontendRoot, 'src/ui/twitter/components/TwitterAuthButtons.vue'), path.join(frontendRoot, 'src/community-app/components/CommunityAuthBoundary.vue')],
	]);
	return {
		name: 'community-relative-boundaries',
		enforce: 'pre',
		/** 通过打包器正常解析后匹配两个明确边界，不改写任何组件源码。 */
		async resolveId(source: string, importer: string | undefined): Promise<string | null> {
			if (!source.startsWith('.') || importer === undefined || importer.includes('/node_modules/')) return null;
			const resolved: Awaited<ReturnType<typeof this.resolve>> = await this.resolve(source, importer, { skipSelf: true });
			return resolved === null ? null : replacements.get(resolved.id.split('?')[0]) ?? null;
		},
	};
}

/** 固定社区构建使用的公开适配入口，先匹配精确模块，再匹配普通源码前缀。 */
function createCommunityAliases(shared: UserConfig): Alias[] {
	const scope: string = path.join(frontendRoot, 'src/community-app');
	const aliases: Alias[] = [
		/** 将共享地址推导替换为 Bootstrap 冻结依赖。 */
		{ find: /^@@\/js\/config\.js$/u, replacement: `${scope}/adapters/shared-config.ts` },
		/** 社区物理文档不使用原站 history 路由。 */
		{ find: /^@\/router\.js$/u, replacement: `${scope}/routing/index.ts` },
		/** 只编译社区允许的业务路由入口。 */
		{ find: /^@\/router\.definition\.js$/u, replacement: `${scope}/routing/definition.ts` },
		/** 原账户凭据恢复不能进入包内启动路径。 */
		{ find: /^@\/accounts\.js$/u, replacement: `${scope}/adapters/accounts.ts` },
		/** 当前账户只由经过校验的真实 BFF 会话装配。 */
		{ find: /^@\/i\.js$/u, replacement: `${scope}/adapters/account-state.ts` },
		/** 现有领域只消费不透明归属，不读取社区凭据或账户缓存。 */
		{ find: /^@\/accounts\/ownership\/index\.js$/u, replacement: `${scope}/adapters/ownership/index.ts` },
		/** 所有 SDK HTTP 调用使用同一 BFF 会话。 */
		{ find: /^@\/utility\/misskey-api(?:\.js)?$/u, replacement: `${scope}/adapters/bff/api/index.ts` },
		/** 原频道消费者共享由 BFF 客户端拥有的实时连接。 */
		{ find: /^@\/stream\.js$/u, replacement: `${scope}/adapters/bff/stream/index.ts` },
		/** 只替换上传网络阶段，保留原文件选择和业务校验。 */
		{ find: /^@\/utility\/drive-upload\/index\.js$/u, replacement: `${scope}/adapters/bff/upload.ts` },
		/** 链接预览不得访问 App 本地根路径。 */
		{ find: /^@\/utility\/url-preview-request\/index\.js$/u, replacement: `${scope}/adapters/bff/url-preview.ts` },
		/** 实例策略只使用真实会话安装的权威模型。 */
		{ find: /^@\/instance\.js$/u, replacement: `${scope}/adapters/instance/index.ts` },
		/** 登录意图交给宿主，不打开原认证弹窗。 */
		{ find: /^@\/utility\/please-login\.js$/u, replacement: `${scope}/adapters/authentication.ts` },
		/** 嵌入退出不得清空同源宿主存储。 */
		{ find: /^@\/signout\.js$/u, replacement: `${scope}/adapters/signout.ts` },
		/** 复用基础展示组件，原全局副作用宿主不进入嵌入图。 */
		{ find: /^@\/ui\/_common_\/common\.vue$/u, replacement: `${scope}/components/CommunitySystemHost.vue` },
		/** 认证边界由宿主接管。 */
		{ find: /^@\/ui\/twitter\/components\/TwitterAuthButtons\.vue$/u, replacement: `${scope}/components/CommunityAuthBoundary.vue` },
		/** 既有业务存储使用社区专属键空间。 */
		{ find: /^@\/local-storage\.js$/u, replacement: `${scope}/storage/local-storage.ts` },
		/** IndexedDB 使用社区专属数据库与对象仓库。 */
		{ find: /^@\/utility\/idb-proxy\.js$/u, replacement: `${scope}/storage/idb.ts` },
	];
	const original: NonNullable<UserConfig['resolve']>['alias'] = shared.resolve?.alias;
	if (Array.isArray(original)) aliases.push(...original);
	else if (original !== undefined) {
		aliases.push(...Object.entries(original).map(/** 保留站点现有静态资源和源码别名。 */ ([find, replacement]: [string, string]): Alias => ({ find, replacement })));
	}
	return aliases;
}

/** 生成独立社区配置，不调用带站点环境读取及 CDN 策略的 getConfig。 */
export function getCommunityAppConfig(): UserConfig {
	const shared: UserConfig = createSharedViteConfig(frontendRoot, true);
	const localesHash: string = toBase62(hash(JSON.stringify(locales)));
	return {
		...shared,
		root: frontendRoot,
		base: './',
		publicDir: false,
		clearScreen: false,
		resolve: { ...shared.resolve, alias: createCommunityAliases(shared) },
		plugins: [
			...(shared.plugins ?? []),
			createCommunityRelativeBoundaryPlugin(),
			createCommunityStorageScopePlugin(),
			pluginCreateSearchIndex({ targetFilePaths: ['src/pages/settings/*.vue'], mainVirtualModule: 'search-index:settings', modulesToHmrOnUpdate: [], verbose: false }),
			createCommunityClosedGraphPlugin(frontendRoot),
		],
		build: {
			target: ['chrome130', 'firefox132', 'safari18.2'],
			manifest: 'manifest.json',
			outDir: path.resolve(frontendRoot, '../../built/community-app'),
			emptyOutDir: true,
			assetsDir: '.',
			cssCodeSplit: true,
			sourcemap: false,
			reportCompressedSize: false,
			rolldownOptions: {
				experimental: { nativeMagicString: true },
				input: { ...COMMUNITY_BUILD_ENTRIES },
				preserveEntrySignatures: 'allow-extension',
				output: {
					entryFileNames: `scripts/${localesHash}-[name]-[hash:8].js`,
					chunkFileNames: `scripts/${localesHash}-[hash:8].js`,
					assetFileNames: `assets/${localesHash}-[hash:8][extname]`,
					codeSplitting: {
						groups: [
							/** 保持 Vue 独立依赖块。 */
							{ name: 'vue', test: /node_modules[\\/]vue/u },
							/** 保持现有语言内联器可识别的门面。 */
							{ name: 'i18n', includeDependenciesRecursively: false, test: /i18n\.ts|locale\.ts/u },
						],
					},
				},
			},
			commonjsOptions: { include: [/misskey-js/u, /misskey-reversi/u, /misskey-bubble-game/u, /node_modules/u] },
		},
	};
}

export default defineConfig(/** Vite 固定使用社区目标，不根据运行时配置选择架构。 */ (): UserConfig => getCommunityAppConfig());
