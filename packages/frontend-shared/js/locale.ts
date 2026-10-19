/*
 * 语言资源加载领域：为开发页面重新验证当前语言资源，并保留生产构建的语言内联入口。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang, version } from '@@/js/config.js';
import type { Locale } from 'i18n';

// 生产内联器会把整个 await 表达式替换为语言 JSON；独立加载时必须重新验证同版本旧缓存。
export let locale: Locale = await window.fetch(`/assets/locales/${lang}.${version}.json`, {
	// 文案可在应用版本不变时更新，不能直接复用仍在有效期内的旧响应。
	cache: 'no-cache',
}).then(
	/** 按既有 JSON 读取协议向启动链交付语言对象。 */
	(response: Response): ReturnType<Response['json']> => response.json(),
	/** 保留网络失败时由既有启动链处理空语言对象的行为。 */
	(): null => null,
);

/** 为测试等已有消费者替换导出的语言对象。 */
export function updateLocale(newLocale: Locale): void {
	locale = newLocale;
}
