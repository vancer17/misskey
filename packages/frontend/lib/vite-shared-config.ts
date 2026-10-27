/*
 * 前端构建领域：提供无环境配置读取的编译参数，供站点与包内社区两个固定构建入口复用。
 * 只负责源码编译、资源解析与稳定类名，不解释会话、部署策略或运行身份。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import pluginVue from '@vitejs/plugin-vue';
import pluginGlsl from 'vite-plugin-glsl';
import { replacePlugin } from 'rolldown/plugins';
import { Features } from 'lightningcss';
import locales from 'i18n';
import meta from '../../../package.json' with { type: 'json' };
import pluginUnwindCssModuleClassName from './rollup-plugin-unwind-css-module-class-name.js';
import pluginJson5 from './vite-plugin-json5.js';
import { pluginRemoveUnrefI18n } from '../../frontend-builder/rollup-plugin-remove-unref-i18n.js';
import type { PluginOption, UserConfig } from 'vite';

/** 将稳定资源摘要编码为既有文件名与类名使用的六十二进制字符。 */
export const BASE62_DIGITS: string = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 沿用站点构建的非加密摘要，保证配置拆分不会改变资源命名算法。 */
export function hash(value: string, seed: number = 0): number {
	let first: number = 0xdeadbeef ^ seed;
	let second: number = 0x41c6ce57 ^ seed;
	for (let index: number = 0; index < value.length; index++) {
		const character: number = value.charCodeAt(index);
		first = Math.imul(first ^ character, 2654435761);
		second = Math.imul(second ^ character, 1597334677);
	}
	first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
	second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
	return 4294967296 * (2097151 & second) + (first >>> 0);
}

/** 将现有摘要转换为既有资源命名格式，不改变站点制品标识。 */
export function toBase62(value: number): string {
	if (value === 0) return '0';
	let remaining: number = value;
	let result: string = '';
	while (remaining > 0) {
		result = BASE62_DIGITS[remaining % BASE62_DIGITS.length] + result;
		remaining = Math.floor(remaining / BASE62_DIGITS.length);
	}
	return result;
}

/** 组装只依赖显式包根目录和编译模式的公共编译参数。 */
export function createSharedViteConfig(frontendRoot: string, production: boolean): UserConfig {
	const plugins: PluginOption[] = [
		pluginVue(),
		pluginRemoveUnrefI18n(),
		pluginUnwindCssModuleClassName(),
		pluginJson5(),
		pluginGlsl({ minify: true }),
	];
	if (production) {
		plugins.push(replacePlugin({ 'isChromatic()': JSON.stringify(false) }, { preventAssignment: true }));
	}
	return {
		plugins,
		resolve: {
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.json5', '.svg', '.sass', '.scss', '.css', '.vue'],
			alias: {
				/** 当前前端源码。 */
				'@/': frontendRoot + '/src/',
				/** 共享浏览器工具与主题。 */
				'@@/': path.resolve(frontendRoot, '../frontend-shared') + '/',
				/** 经打包器处理的前端静态资源。 */
				'/client-assets/': frontendRoot + '/assets/',
				/** 经打包器处理的既有服务端公共资源。 */
				'/static-assets/': path.resolve(frontendRoot, '../backend/assets') + '/',
				/** 经打包器处理的 Fluent 表情资源。 */
				'/fluent-emoji/': '@misskey-dev/emoji-assets/fluent-emoji/',
			},
		},
		css: {
			lightningcss: { exclude: Features.LightDark },
			modules: {
				/** 保持原路径摘要及生产类名算法，避免配置拆分导致样式变化。 */
				generateScopedName(name: string, filename: string, _css: string): string {
					const identity: string = (path.relative(frontendRoot, filename.split('?')[0]) + '-' + name).replace(/[\\\/\.\?&=]/g, '-').replace(/(src-|vue-)/g, '');
					return production ? 'x' + toBase62(hash(identity)).substring(0, 4) : identity;
				},
			},
		},
		define: {
			/** 原应用版本，供既有前端版本信息使用。 */
			_VERSION_: JSON.stringify(meta.version),
			/** 共享语言权威入口提供的语言名称。 */
			_LANGS_: JSON.stringify(Object.entries(locales).map(/** 将语言表转换为既有构建常量格式。 */ ([language, locale]: [string, typeof locales[string]]): [string, string] => [language, locale._lang_])),
			/** 原编译模式名称。 */
			_ENV_: JSON.stringify(production ? 'production' : process.env.NODE_ENV),
			/** 原开发分支编译常量。 */
			_DEV_: !production,
			/** 性能记录使用的既有前缀。 */
			_PERF_PREFIX_: JSON.stringify('Misskey:'),
			/** 关闭 Vue Options API，与现有前端保持一致。 */
			__VUE_OPTIONS_API__: false,
			/** 关闭生产调试工具，与现有前端保持一致。 */
			__VUE_PROD_DEVTOOLS__: false,
		},
		worker: { format: 'es' },
	};
}
