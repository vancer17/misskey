/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 * 文件领域：独立站点的共享运行配置；社区构建使用 Bootstrap 依赖适配入口。
 * 作用：保留现有站点地址与展示配置，提供可由独立构建绑定的默认图标路径。
 */

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
const address = new URL(window.document.querySelector<HTMLMetaElement>('meta[property="instance_url"]')?.content || window.location.href);
const siteName = window.document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;

export const host = address.host;
export const hostname = address.hostname;
export const url = address.origin;
export const port = address.port;
export const apiUrl = window.location.origin + '/api';
export const wsOrigin = window.location.origin;
export const lang = localStorage.getItem('lang') ?? 'en-US';
export const langs = _LANGS_;
export const version = _VERSION_;
export const instanceName = (siteName === 'Misskey' || siteName == null) ? host : siteName;
/** 独立站点默认图标保留原根路径，包内社区由构建适配器提供本地图标。 */
export const defaultIconUrl: string = '/favicon.ico';
export const ui = localStorage.getItem('ui');
export const debug = localStorage.getItem('debug') === 'true';
export const isSafeMode = localStorage.getItem('isSafeMode') === 'true';
export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion)').matches;
