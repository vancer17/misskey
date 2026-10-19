/*
 * 开发环境语言资源适配领域：把已发布的最终语言 JSON 变更映射为既有 HMR 通知。
 * 继承合并由 i18n 构建负责；页面只在自己的生成物就绪后重新读取语言资源。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import locales from 'i18n';
import type { Plugin, ViteDevServer } from 'vite';
import meta from '../../../package.json';

const localesDir: string = path.resolve(__dirname, '../../../built/_frontend_dist_/locales');

/**
 * 将当前版本的最终语言生成物接入 Vite 监听器，保持已打开页面使用的事件协议。
 */
export default function pluginWatchLocales(): Plugin {
	const localeJsonPaths: Map<string, string> = new Map(Object.keys(locales).map(
		/** 直接从构建使用的语言集合和应用版本派生文件到语言的映射。 */
		(locale: string): [string, string] => [path.join(localesDir, `${locale}.${meta.version}.json`), locale],
	));
	let detachListeners: (() => void) | undefined;

	return {
		// 保留插件标识，便于开发服务器诊断。
		name: 'watch-locales',

		/** 在最终生成物被原子发布后通知对应语言的页面，不提前消费源 YAML 事件。 */
		configureServer(server: ViteDevServer): void {
			detachListeners?.();

			/** 将最终文件事件映射为既有语言通知，忽略临时文件及其他版本。 */
			function notifyLocaleReady(filePath: string): void {
				const locale: string | undefined = localeJsonPaths.get(path.resolve(filePath));
				if (locale === undefined) return;

				server.ws.send({
					type: 'custom',
					event: 'locale-update',
					data: locale,
				});
			}

			// 此目录与 Vite 的 _frontend_vite_ 输出目录同级，不属于其 outDir 忽略范围。
			server.watcher.add([...localeJsonPaths.keys()]);
			server.watcher.on('add', notifyLocaleReady);
			server.watcher.on('change', notifyLocaleReady);

			detachListeners = /** 重配或关闭插件时移除本插件的回调，不关闭共享监听器。 */ (): void => {
				server.watcher.off('add', notifyLocaleReady);
				server.watcher.off('change', notifyLocaleReady);
			};
		},

		/** 随 Vite 插件容器关闭清理监听回调，避免服务器重启后重复通知。 */
		closeBundle(): void {
			detachListeners?.();
			detachListeners = undefined;
		},
	};
}
