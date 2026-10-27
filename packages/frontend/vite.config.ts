/*
 * 站点前端构建领域：保留 Misskey 服务端集成入口、开发代理和 CDN 外置策略。
 * 公共源码编译参数由无环境 IO 的工具提供；本文件仅供原站点构建使用。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import type { PluginOption, UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createSharedViteConfig, hash, toBase62 } from './lib/vite-shared-config.js';
export { BASE62_DIGITS, hash, toBase62 } from './lib/vite-shared-config.js';
import { load as loadYaml } from 'js-yaml';
import { promises as fsp } from 'fs';

import locales from 'i18n';
import packageInfo from './package.json' with { type: 'json' };
import type { Options as SearchIndexOptions } from './lib/vite-plugin-create-search-index.js';
import pluginCreateSearchIndex from './lib/vite-plugin-create-search-index.js';
import pluginWatchLocales from './lib/vite-plugin-watch-locales.js';

const url = process.env.NODE_ENV === 'development' ? (loadYaml(await fsp.readFile('../../.config/default.yml', 'utf-8')) as any).url : null;
const host = url ? (new URL(url)).hostname : undefined;

function getBundleVisualizerPlugin(): PluginOption[] {
	if (process.env.FRONTEND_BUNDLE_VISUALIZER !== 'true') return [];

	const visualizerOptions = {
		title: 'Misskey frontend bundle visualizer',
		gzipSize: true,
		brotliSize: true,
		projectRoot: path.resolve(__dirname, '../..'),
	};
	const plugins = [
		visualizer({
			...visualizerOptions,
			filename: process.env.FRONTEND_BUNDLE_VISUALIZER_FILE,
			template: 'raw-data',
		}) as PluginOption,
	];

	if (process.env.FRONTEND_BUNDLE_VISUALIZER_HTML_FILE != null) {
		plugins.push(visualizer({
			...visualizerOptions,
			filename: process.env.FRONTEND_BUNDLE_VISUALIZER_HTML_FILE,
			template: 'treemap',
		}) as PluginOption);
	}

	return plugins;
}

/**
 * 検索インデックスの生成設定
 */
export const searchIndexes = [{
	targetFilePaths: ['src/pages/settings/*.vue'],
	mainVirtualModule: 'search-index:settings',
	modulesToHmrOnUpdate: ['src/pages/settings/index.vue'],
	verbose: process.env.FRONTEND_SEARCH_INDEX_VERBOSE === 'true',
}, {
	targetFilePaths: ['src/pages/admin/*.vue'],
	mainVirtualModule: 'search-index:admin',
	modulesToHmrOnUpdate: ['src/pages/admin/index.vue'],
	verbose: process.env.FRONTEND_SEARCH_INDEX_VERBOSE === 'true',
}] satisfies SearchIndexOptions[];

/**
 * Misskeyのフロントエンドにバンドルせず、CDNなどから別途読み込むリソースを記述する。
 * CDNを使わずにバンドルしたい場合、以下の配列から該当要素を削除orコメントアウトすればOK
 */
const externalPackages = [
	// shiki（コードブロックのシンタックスハイライトで使用中）はテーマ・言語の定義の容量が大きいため、それらはCDNから読み込む
	{
		name: 'shiki',
		match: /^shiki\/(?<subPkg>(langs|themes))$/,
		path(id: string, pattern: RegExp): string {
			const match = pattern.exec(id)?.groups;
			return match
				? `https://esm.sh/shiki@${packageInfo.dependencies.shiki}/${match['subPkg']}`
				: id;
		},
	},
];

/** 为原站点生成服务端集成配置，沿用既有输出、开发服务及外置包策略。 */
export function getConfig(): UserConfig {
	const localesHash: string = toBase62(hash(JSON.stringify(locales)));
	const shared: UserConfig = createSharedViteConfig(__dirname, process.env.NODE_ENV === 'production');

	return {
		...shared,
		base: '/vite/',

		// The console is shared with backend, so clearing the console will also clear the backend log.
		clearScreen: false,

		server: {
			// The backend allows access from any addresses, so vite also allows access from any addresses.
			host: '0.0.0.0',
			allowedHosts: host ? [host] : undefined,
			port: 5173,
			strictPort: true,
			hmr: {
				// バックエンド経由での起動時、Viteは5173経由でアセットを参照していると思い込んでいるが実際は3000から配信される
				// そのため、バックエンドのWSサーバーにHMRのWSリクエストが吸収されてしまい、正しくHMRが機能しない
				// クライアント側のWSポートをViteサーバーのポートに強制させることで、正しくHMRが機能するようになる
				clientPort: 5173,
			},
			headers: { // なんか効かない
				'X-Frame-Options': 'DENY',
			},
		},

		plugins: [
			pluginWatchLocales(),
			...searchIndexes.map(/** 保持原站点的设置和管理搜索索引。 */ (options: SearchIndexOptions): PluginOption => pluginCreateSearchIndex(options)),
			...(shared.plugins ?? []),
			...getBundleVisualizerPlugin(),
		],

		build: {
			target: [
				'chrome130',
				'firefox132',
				'safari18.2',
			],
			manifest: 'manifest.json',
			rolldownOptions: {
				experimental: {
					nativeMagicString: true,
				},
				input: {
					i18n: './src/i18n.ts',
					entry: './src/_boot_.ts',
				},
				external: externalPackages.map(/** 原站点继续使用其既有 CDN 外置规则。 */ (entry: typeof externalPackages[number]): RegExp => entry.match),
				preserveEntrySignatures: 'allow-extension',
				output: {
					codeSplitting: {
						groups: [{
							name: 'vue',
							test: /node_modules[\\/]vue/,
						}, {
							// split i18n related module to distinct module
							name: 'i18n',
							includeDependenciesRecursively: false,
							test: /i18n\.ts|locale\.ts/,
						}],
					},
					entryFileNames: `scripts/${localesHash}-[hash:8].js`,
					chunkFileNames: `scripts/${localesHash}-[hash:8].js`,
					assetFileNames: `assets/${localesHash}-[hash:8][extname]`,
					/** 将原站点外置模块映射到既有 CDN 地址。 */
					paths(id: string): string {
						for (const entry of externalPackages) {
							if (entry.match.test(id)) {
								return entry.path(id, entry.match);
							}
						}

						return id;
					},
				},
			},
			cssCodeSplit: true,
			outDir: __dirname + '/../../built/_frontend_vite_',
			assetsDir: '.',
			emptyOutDir: false,
			sourcemap: process.env.NODE_ENV === 'development',
			reportCompressedSize: false,

			// https://vitejs.dev/guide/dep-pre-bundling.html#monorepos-and-linked-dependencies
			commonjsOptions: {
				include: [/misskey-js/, /misskey-reversi/, /misskey-bubble-game/, /node_modules/],
			},
		},

	};
}

/** 原站点入口仅消费站点配置，不选择社区目标。 */
const config: ReturnType<typeof defineConfig> = defineConfig(/** 沿用 Vite 的配置函数入口。 */ (): UserConfig => getConfig());

export default config;
