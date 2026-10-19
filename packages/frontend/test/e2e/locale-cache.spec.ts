/*
 * 语言资源缓存验收领域：以真实 Chromium HTTP 缓存验证同版本语言资源的重新验证与后续读取。
 * 独立 HTTP 服务只提供已构建语言资源和原样转译的加载器，不依赖账户、产品后端或请求路由替身。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { expect, test } from '@playwright/test';
import type { Page, PlaywrightTestArgs } from '@playwright/test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import type { TranspileOutput } from 'typescript';
import type { Locale } from 'i18n';

/** 历史资源仅允许上传器文案缺失，其余字段沿用真实构建语言对象的权威类型。 */
type CachedLocale = Omit<Locale, '_uploader'> & {
	_uploader: Partial<Locale['_uploader']>;
};

/** 当前测试模块对应的仓库根目录，用于读取产品源码与已构建语言文件。 */
const REPOSITORY_ROOT: URL = new URL('../../../../', import.meta.url);
/** 本用例拥有的 HTTP 服务，由 afterEach 统一释放。 */
let cacheServer: Server | undefined;
/** 系统为当前服务分配的独立 loopback 来源。 */
let serverOrigin: string;
/** 与产品一致的当前应用版本语言资源路径。 */
let localePath: string;
/** 模拟同一资源 URL 发布了新内容，不改写浏览器响应或加载器实现。 */
let serveCurrentLocale: boolean;
/** 只统计语言资源真正到达服务端的请求，证明浏览器是否命中 HTTP 缓存。 */
let localeRequests: number;
/** 从当前构建语言文件取得的真实提示模板。 */
let currentTemplate: string;

/** 使用浏览器默认缓存模式读取原始文案字段，不调用产品格式化函数。 */
async function fetchFallbackTemplate(page: Page, path: string): Promise<unknown> {
	return page.evaluate(/** 普通 fetch 必须沿用 Chromium 自身缓存，不安装请求拦截。 */ async (resourcePath: string): Promise<unknown> => {
		const response: Response = await window.fetch(resourcePath);
		if (!response.ok) throw new Error(`Locale request failed with status ${response.status}.`);
		const translations: CachedLocale = await response.json();
		return translations._uploader.videoCompressionFallback;
	}, path);
}

test.beforeEach(/** 从真实源码和已构建语言快照创建独立 HTTP 缓存场景。 */ async (): Promise<void> => {
	const [packageContent, loaderSource]: [string, string] = await Promise.all([
		readFile(new URL('package.json', REPOSITORY_ROOT), 'utf-8'),
		readFile(new URL('packages/frontend-shared/js/locale.ts', REPOSITORY_ROOT), 'utf-8'),
	]);
	const manifest: { version: string } = JSON.parse(packageContent);
	localePath = `/assets/locales/zh-CN.${manifest.version}.json`;
	const currentContent: string = await readFile(new URL(`built/_frontend_dist_/locales/zh-CN.${manifest.version}.json`, REPOSITORY_ROOT), 'utf-8');
	const currentLocale: Locale = JSON.parse(currentContent);
	const template: unknown = currentLocale._uploader.videoCompressionFallback;
	expect(template).toEqual(expect.any(String));
	if (typeof template !== 'string') throw new Error('The built Chinese locale must contain the video fallback template.');
	expect(template).toContain('{name}');
	currentTemplate = template;
	const previousLocale: CachedLocale = JSON.parse(currentContent);
	delete previousLocale._uploader.videoCompressionFallback;
	const previousContent: string = JSON.stringify(previousLocale);
	const loader: TranspileOutput = transpileModule(loaderSource, {
		fileName: 'locale.ts',
		compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
	});
	serveCurrentLocale = false;
	localeRequests = 0;
	cacheServer = createServer(/** 保留实际 HTTP 缓存与 ETag 语义，仅切换服务端持有的完整语言快照。 */ (request: IncomingMessage, response: ServerResponse): void => {
		if (request.url === localePath) {
			localeRequests++;
			const etag: string = serveCurrentLocale ? '"current-locale"' : '"previous-locale"';
			response.setHeader('Content-Type', 'application/json; charset=utf-8');
			response.setHeader('Cache-Control', 'public, max-age=604800');
			response.setHeader('ETag', etag);
			if (request.headers['if-none-match'] === etag) {
				response.writeHead(304);
				response.end();
				return;
			}
			response.end(serveCurrentLocale ? currentContent : previousContent);
			return;
		}

		response.setHeader('Cache-Control', 'no-store');
		if (request.url === '/') {
			response.setHeader('Content-Type', 'text/html; charset=utf-8');
			response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><script type="importmap">{"imports":{"@@/js/config.js":"/config.js"}}</script></head><body><output id="fallback"></output></body></html>');
		} else if (request.url === '/config.js') {
			response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
			response.end(`export const lang = 'zh-CN'; export const version = ${JSON.stringify(manifest.version)};`);
		} else if (request.url === '/loader.js') {
			response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
			response.end(loader.outputText);
		} else {
			response.writeHead(404);
			response.end();
		}
	});
	const server: Server = cacheServer;
	await new Promise<void>(/** 只等待本用例创建的服务完成绑定，不探测外部基础设施。 */ (resolve: () => void, reject: (reason: unknown) => void): void => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', /** 绑定成功后解除启动阶段错误监听并交付测试来源。 */ (): void => {
			server.off('error', reject);
			resolve();
		});
	});
	const address: ReturnType<Server['address']> = server.address();
	if (address === null || typeof address === 'string') throw new Error('The locale fixture server did not provide a TCP address.');
	serverOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterEach(/** 无论断言是否成功，都关闭本用例的监听端口与仍存活的连接。 */ async (): Promise<void> => {
	const server: Server | undefined = cacheServer;
	cacheServer = undefined;
	if (server === undefined || !server.listening) return;
	await new Promise<void>(/** 等待当前服务的关闭回执，避免后续用例继承连接。 */ (resolve: () => void, reject: (reason: unknown) => void): void => {
		server.close(/** 将关闭异常交给测试框架记录。 */ (error?: Error): void => {
			if (error !== undefined) reject(error);
			else resolve();
		});
		server.closeAllConnections();
	});
});

test('真实语言加载器更新同版本旧缓存，后续默认请求继续取得完整中文资源', /** 先证明旧缓存生效，再验证真实加载器及后续普通读取，不依赖模拟上传业务。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.goto(serverOrigin);
	expect(await fetchFallbackTemplate(page, localePath)).toBeUndefined();
	expect(localeRequests).toBe(1);
	serveCurrentLocale = true;
	expect(await fetchFallbackTemplate(page, localePath)).toBeUndefined();
	expect(localeRequests).toBe(1);

	const loadedTemplate: unknown = await page.evaluate(/** 只导入经类型擦除后的产品加载器，再将其导出的真实文案模板显示到 DOM。 */ async (): Promise<unknown> => {
		const moduleUrl: string = '/loader.js';
		const loader: typeof import('../../../frontend-shared/js/locale.js') = await import(moduleUrl);
		const template: unknown = loader.locale._uploader.videoCompressionFallback;
		if (typeof template !== 'string') throw new Error('The real locale loader retained the obsolete language object.');
		const output: HTMLOutputElement | null = document.querySelector('output#fallback');
		if (output === null) throw new Error('The locale fixture did not provide its output element.');
		output.textContent = template;
		return template;
	});
	expect(loadedTemplate).toBe(currentTemplate);
	await expect(page.locator('output#fallback')).toHaveText(currentTemplate);
	expect(localeRequests).toBe(2);

	expect(await fetchFallbackTemplate(page, localePath)).toBe(currentTemplate);
	expect(localeRequests).toBe(2);
});
