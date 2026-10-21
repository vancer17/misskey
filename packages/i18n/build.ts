/*
 * 语言资源构建领域：编译共享 i18n 代码，并复制原生及 fork 自有资源供统一发布链读取。
 * fork 中文 JSON 与 YAML 一样由构建器监听；删除源文件时同步移除副本，避免旧翻译残留。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import * as esbuild from 'esbuild';
import { build } from 'esbuild';
import { execa } from 'execa';
import { generateLocaleInterface } from './scripts/generateLocaleInterface.js';
import type { BuildOptions, BuildResult, Plugin, PluginBuild } from 'esbuild';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const _package = JSON.parse(fs.readFileSync(_dirname + '/package.json', 'utf-8'));
const _rootPackageDir = resolve(_dirname, '../../');
const _rootPackage = JSON.parse(fs.readFileSync(resolve(_rootPackageDir, 'package.json'), 'utf-8'));
const _frontendLocalesDir = resolve(_dirname, '../../built/_frontend_dist_/locales');
const _localesDir = resolve(_rootPackageDir, 'locales');
const _forkResourcesDir: string = resolve(_dirname, 'src/resources/fork');
const _forkChinesePath: string = resolve(_forkResourcesDir, 'zh-CN.json');

const entryPoints = fs.globSync('./src/**/**.{ts,tsx}');

const options: BuildOptions = {
	entryPoints,
	minify: process.env.NODE_ENV === 'production',
	sourceRoot: 'src',
	outdir: './built',
	target: 'es2022',
	platform: 'node',
	format: 'esm',
	sourcemap: 'linked',
};

// コマンドライン引数を取得
const args = process.argv.slice(2).map(arg => arg.toLowerCase());

// built配下をすべて削除する
if (!args.includes('--no-clean')) {
	fs.rmSync('./built', { recursive: true, force: true });
}

if (args.includes('--watch')) {
	await watchSrc();
} else {
	await buildSrc();
}

/** 同步唯一 fork 补充资源；源文件删除后不允许旧构建副本继续提供翻译。 */
function copyForkChineseSupplement(): void {
	const destination: string = resolve(_dirname, 'built/resources/fork/zh-CN.json');
	fs.mkdirSync(dirname(destination), { recursive: true });
	try {
		fs.copyFileSync(_forkChinesePath, destination);
	} catch (error: unknown) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
		fs.rmSync(destination, { force: true });
	}
}

/** 复制既有原始语言文件及固定 fork JSON，所有消费者继续由共享 i18n 入口合并。 */
function copyLocales(): void {
	const srcDir: string = _localesDir;
	const destDir: string = resolve(_dirname, 'built/locales');

	fs.mkdirSync(destDir, { recursive: true });

	const files: string[] = fs.readdirSync(srcDir).filter(/** 只复制既有 YAML，不把其他文档当作语言数据。 */ (file: string): boolean => file.endsWith('.yml'));
	for (const file of files) {
		fs.copyFileSync(resolve(srcDir, file), resolve(destDir, file));
	}
	copyForkChineseSupplement();
	console.log(`[${_package.name}] locales copied (${files.length} files).`);
}

/**
 * 通过共享构建入口发布前端和 Service Worker 使用的最终 JSON。
 * 模块本身可以复用 ESM 缓存；它的 build() 每次实时读取原生与 fork 资源。
 */
async function writeFrontendLocalesJson(): Promise<void> {
	// 動的 import でビルド済みモジュールから読み込み（循環参照回避）
	const { writeFrontendLocalesJson: write } = await import('./built/index.js');
	await write(_frontendLocalesDir, _rootPackage.version);
	console.log(`[${_package.name}] frontend locales JSON written to ${_frontendLocalesDir}`);
}

async function buildSrc(): Promise<void> {
	console.log(`[${_package.name}] start building...`);

	await generateLocaleInterface(_localesDir);

	await build(options)
		.then(() => {
			console.log(`[${_package.name}] build succeeded.`);
		})
		.catch((err) => {
			process.stderr.write(err.stderr);
			process.exit(1);
		});

	copyLocales();
	await writeFrontendLocalesJson();

	if (process.env.NODE_ENV === 'production') {
		console.log(`[${_package.name}] skip building d.ts because NODE_ENV is production.`);
	} else {
		await buildDts();
	}

	console.log(`[${_package.name}] finish building.`);
}

function buildDts(): Promise<unknown> {
	return execa(
		'tsc',
		[
			'--project', 'tsconfig.json',
			'--rootDir', 'src',
			'--outDir', 'built',
			'--declaration', 'true',
			'--emitDeclarationOnly', 'true',
		],
		{
			stdout: process.stdout,
			stderr: process.stderr,
		},
	);
}

/** 监听源码及原始资源；首次加载成功后，非法编辑保留已发布快照，后续修正可继续发布。 */
async function watchSrc(): Promise<void> {
	copyLocales();
	await generateLocaleInterface(_localesDir);
	const localesWatcher: ReturnType<typeof chokidarWatch> = chokidarWatch([_localesDir, _forkResourcesDir], {
		ignoreInitial: true,
	});
	localesWatcher.on('all', /** 只响应既有语言文件和唯一 fork JSON，删除事件同样发布回退结果。 */ async (event: string, path: string): Promise<void> => {
		const isForkChinese: boolean = resolve(path) === _forkChinesePath;
		if (!path.endsWith('.yml') && !isForkChinese) return;
		if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
		console.log(`[${_package.name}] locales changed: ${event} ${path}`);
		try {
			copyLocales();
			await writeFrontendLocalesJson();
			if (!isForkChinese) await generateLocaleInterface(_localesDir);
		} catch (error: unknown) {
			console.error(`[${_package.name}] locale publication failed:`, error);
		}
	});

	const plugins: Plugin[] = [{
		name: 'gen-dts',
		/** 源码编译结束后更新声明与最终 JSON，初次 watch 无需预留旧 built 目录。 */
		setup(build: PluginBuild): void {
			build.onStart(/** 保持现有构建进度说明。 */ (): void => {
				console.log(`[${_package.name}] detect changed...`);
			});
			build.onEnd(/** 编译错误不发布半成品；成功则通过同一读取和校验链交付语言。 */ async (result: BuildResult): Promise<void> => {
				if (result.errors.length > 0) {
					console.error(`[${_package.name}] watch build failed:`, result);
					return;
				}
				await buildDts();
				await writeFrontendLocalesJson();
			});
		},
	}];

	console.log(`[${_package.name}] start watching...`);

	const context: Awaited<ReturnType<typeof esbuild.context>> = await esbuild.context({ ...options, plugins });
	await context.watch();

	await new Promise<void>(/** 等待既有退出信号，统一回收源码与语言资源监听器。 */ (resolve: () => void, reject: (reason: Error) => void): void => {
		process.on('SIGHUP', resolve);
		process.on('SIGINT', resolve);
		process.on('SIGTERM', resolve);
		process.on('uncaughtException', reject);
		process.on('exit', resolve);
	}).finally(/** 退出时只清理本构建进程建立的监听器。 */ async (): Promise<void> => {
		await context.dispose();
		await localesWatcher.close();
		console.log(`[${_package.name}] finish watching.`);
	});
}
