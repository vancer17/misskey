/*
 * 开发语言资源集成验收领域：使用原始 Vite 插件、真实语言构建器、文件监听与浏览器 WebSocket。
 * 所有语言修改和生成物均位于独立临时目录，验证最终 JSON 原子发布后才通知受影响的页面。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import type { PlaywrightTestArgs, WebSocket } from '@playwright/test';
import { createServer } from 'vite';
import type { HMRPayload, ViteDevServer } from 'vite';

/** 只读取真实仓库中的插件与构建产物，测试修改全部写入独立副本。 */
const REPOSITORY_ROOT: string = fileURLToPath(new URL('../../../../', import.meta.url));

/** 在独立进程运行已构建的真实 writer，使 Vite 能与发布过程并发接收文件事件。 */
async function publishLocales(directory: string, version: string): Promise<void> {
	await promisify(execFile)(process.execPath, [
		'--input-type=module',
		'--eval',
		"import { writeFrontendLocalesJson } from './packages/i18n/built/index.js'; await writeFrontendLocalesJson('./built/_frontend_dist_/locales', process.argv[1]);",
		version,
	], { cwd: directory, timeout: 20_000 });
}

/** 读取最终资源的真实纳秒修改时间，用于确认无内容变化时没有重新发布。 */
async function localeModificationTimes(directory: string): Promise<Record<string, bigint>> {
	const names: string[] = (await readdir(directory)).filter(/** 排除临时文件，只比较对浏览器发布的资源。 */ (name: string): boolean => name.endsWith('.json'));
	const entries: [string, bigint][] = await Promise.all(names.map(/** 从文件系统获取每个最终资源的修改时间。 */ async (name: string): Promise<[string, bigint]> => [
		name,
		(await stat(path.join(directory, name), { bigint: true })).mtimeNs,
	]));
	return Object.fromEntries(entries);
}

test('真实生成物的原子发布通知中文页面，无变化构建不重复通知', /** 从明确缺少该键译文的语言副本开始，经过真实合并、发布、监听和 WebSocket 到浏览器读取。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const directory: string = await mkdtemp(path.join(tmpdir(), 'misskey-locale-hmr-'));
	let server: ViteDevServer | undefined;

	try {
		const frontendDirectory: string = path.join(directory, 'packages/frontend');
		const i18nDirectory: string = path.join(directory, 'packages/i18n');
		const outputDirectory: string = path.join(directory, 'built/_frontend_dist_/locales');
		await Promise.all([
			mkdir(path.join(frontendDirectory, 'lib'), { recursive: true }),
			mkdir(path.join(frontendDirectory, 'node_modules'), { recursive: true }),
			mkdir(i18nDirectory, { recursive: true }),
		]);
		await Promise.all([
			copyFile(path.join(REPOSITORY_ROOT, 'package.json'), path.join(directory, 'package.json')),
			copyFile(path.join(REPOSITORY_ROOT, 'packages/frontend/package.json'), path.join(frontendDirectory, 'package.json')),
			copyFile(path.join(REPOSITORY_ROOT, 'packages/frontend/lib/vite-plugin-watch-locales.ts'), path.join(frontendDirectory, 'lib/vite-plugin-watch-locales.ts')),
			copyFile(path.join(REPOSITORY_ROOT, 'packages/i18n/package.json'), path.join(i18nDirectory, 'package.json')),
			cp(path.join(REPOSITORY_ROOT, 'packages/i18n/built'), path.join(i18nDirectory, 'built'), { recursive: true }),
			symlink(path.join(REPOSITORY_ROOT, 'packages/i18n/node_modules'), path.join(i18nDirectory, 'node_modules'), 'dir'),
			symlink(i18nDirectory, path.join(frontendDirectory, 'node_modules/i18n'), 'dir'),
		]);
		// 只在副本中移除这条键的译文，明确“尚未翻译”的夹具前提，避免正式翻译进度影响继承更新验收。
		const sourceDirectory: string = path.join(i18nDirectory, 'built/locales');
		const translatedSources: string[] = (await readdir(sourceDirectory)).filter(/** 保留基础语言原文，其余语言是否受影响由真实构建器决定。 */ (name: string): boolean => name.endsWith('.yml') && name !== 'ja-JP.yml');
		await Promise.all(translatedSources.map(/** 清除隔离 YAML 副本中该键的单行译文，不更改真实语言资源或合并规则。 */ async (name: string): Promise<void> => {
			const source: string = path.join(sourceDirectory, name);
			const yaml: string = await readFile(source, 'utf-8');
			await writeFile(source, yaml.replace(/^[ \t]+videoCompressionFallback:.*(?:\r?\n|$)/gm, ''));
		}));
		const manifest: { version: string } = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf-8'));
		await publishLocales(directory, manifest.version);
		const before: Record<string, bigint> = await localeModificationTimes(outputDirectory);
		const zhPath: string = path.join(outputDirectory, `zh-CN.${manifest.version}.json`);
		const resourcePath: string = `/@fs/${zhPath.split(path.sep).join('/')}`;

		await Promise.all([
			writeFile(path.join(frontendDirectory, 'vite.config.mts'), "import pluginWatchLocales from './lib/vite-plugin-watch-locales.ts';\nexport default { plugins: [pluginWatchLocales()] };\n"),
			writeFile(path.join(frontendDirectory, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><ul id="updates"></ul><script type="module" src="/locale-harness.ts"></script></body></html>'),
			writeFile(path.join(frontendDirectory, 'locale-harness.ts'), `
import type { Locale } from 'i18n';
const updates: HTMLElement | null = document.getElementById('updates');
if (updates === null || import.meta.hot === undefined) throw new Error('Missing locale HMR fixture entry.');
import.meta.hot.on('locale-update', /** 收到真实语言通知后立即通过 Vite HTTP 读取最终生成物。 */ async (lang: string): Promise<void> => {
	if (lang !== 'zh-CN') return;
	const output: HTMLLIElement = document.createElement('li');
	updates.append(output);
	try {
		const response: Response = await fetch(${JSON.stringify(resourcePath)}, { cache: 'no-store' });
		if (!response.ok) throw new Error('Cannot read published locale JSON.');
		const locale: Locale = await response.json();
		output.textContent = locale._uploader.videoCompressionFallback;
	} catch (error: unknown) {
		output.textContent = error instanceof Error ? error.message : String(error);
		output.dataset.error = 'true';
	}
});
document.documentElement.dataset.localeReady = 'true';
`),
		]);

		server = await createServer({
			// 原样插件经 Vite 配置加载，保留其真实 __dirname 语义。
			configFile: path.join(frontendDirectory, 'vite.config.mts'),
			// 最小页面与产品使用同样的相对目录结构。
			root: frontendDirectory,
			// 所有 Vite 中间产物也属于本用例的隔离目录。
			cacheDir: path.join(directory, 'vite-cache'),
			// 本用例不扫描与 HMR 无关的应用依赖入口。
			optimizeDeps: { noDiscovery: true, include: [] },
			// 输出目录与最终语言目录同级，复现产品的监听忽略边界。
			build: { outDir: path.join(directory, 'built/_frontend_vite_') },
			// 随机分配独立端口，允许浏览器读取本用例的最终资源。
			server: { host: '127.0.0.1', port: 0, fs: { allow: [directory] } },
			// 失败仍由异常与测试断言报告，减少开发服务器常规日志。
			logLevel: 'error',
		});
		await server.listen();
		const address: ReturnType<NonNullable<ViteDevServer['httpServer']>['address']> = server.httpServer?.address() ?? null;
		if (address === null || typeof address === 'string') throw new Error('The isolated Vite server did not provide a TCP address.');

		const notices: string[] = [];
		let connected: boolean = false;
		page.on('websocket', /** 观察浏览器与真实 Vite 客户端之间的 WebSocket 帧，不合成事件。 */ (socket: WebSocket): void => {
			socket.on('framereceived', /** 记录既有 HMR 协议交付的语言标识及连接事实。 */ ({ payload }: { payload: string | Buffer }): void => {
				const message: HMRPayload = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf-8'));
				if (message.type === 'connected') connected = true;
				if (message.type === 'custom' && message.event === 'locale-update' && typeof message.data === 'string') notices.push(message.data);
			});
		});
		await page.goto(`http://127.0.0.1:${address.port}`);
		await expect(page.locator('html')).toHaveAttribute('data-locale-ready', 'true');
		await expect.poll(/** 等待本用例创建的 WebSocket 完成连接，避免在客户端就绪前发布。 */ (): boolean => connected).toBe(true);
		expect(notices).toEqual([]);

		const jaSource: string = path.join(i18nDirectory, 'built/locales/ja-JP.yml');
		const yaml: string = await readFile(jaSource, 'utf-8');
		const template: string = '「{name}」の動画を安全に圧縮できなかったため、元のファイルを使用します。（言語更新の検証）';
		expect(yaml.match(/^[ \t]+videoCompressionFallback:/gm)).toHaveLength(1);
		await writeFile(jaSource, yaml.replace(/^([ \t]+videoCompressionFallback:).*$/m, `$1 ${JSON.stringify(template)}`));
		await publishLocales(directory, manifest.version);
		const after: Record<string, bigint> = await localeModificationTimes(outputDirectory);
		const changedFiles: number = Object.keys(after).filter(/** 用最终文件的真实变更计算通知总数，不复制语言继承规则。 */ (name: string): boolean => after[name] !== before[name]).length;
		expect(changedFiles).toBeGreaterThan(0);
		await expect.poll(/** 等待已发布文件对应的真实 WebSocket 通知完成交付。 */ (): number => notices.length).toBe(changedFiles);
		expect(notices).toContain('zh-CN');
		await expect(page.locator('#updates > li')).toHaveText([template]);
		await expect(page.locator('#updates > li[data-error]')).toHaveCount(0);

		await publishLocales(directory, manifest.version);
		expect(await localeModificationTimes(outputDirectory)).toEqual(after);
		// 给文件监听器的原子事件合并窗口留出时间，确认无变化写入没有排队的通知。
		await page.waitForTimeout(300);
		expect(notices).toHaveLength(changedFiles);
		await expect(page.locator('#updates > li')).toHaveText([template]);
	} finally {
		await server?.close();
		await rm(directory, { recursive: true, force: true });
	}
});
