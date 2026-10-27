/*
 * 社区本地制品构建入口：串联独立 Vite 编译、既有语言内联及最终资源闭包校验。
 * 只生成 ignored 的 built/community-app，不读取后端配置、不写验收结论到源码目录。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import locales from 'i18n';
import metadata from '../../package.json';
import { LocaleInliner } from '../frontend-builder/locale-inliner.js';
import { createLogger } from '../frontend-builder/logger.js';
import { COMMUNITY_BUILD_ENTRIES, COMMUNITY_BUILD_LANGUAGES, finalizeCommunityApp } from './lib/community-app-build/index.js';
import { readCommunitySourceFingerprint } from './lib/community-app-source/index.js';
import type { Manifest } from 'vite';

/** 前端包根目录，不受调用者 cwd 影响。 */
const frontendRoot: string = path.dirname(fileURLToPath(import.meta.url));
/** 独立社区制品目录，与原站点输出隔离。 */
const outputDir: string = path.resolve(frontendRoot, '../../built/community-app');

/** 编译真实代码图，再按权威语言入口内联并装配静态制品。 */
async function buildCommunityApp(): Promise<void> {
	const repositoryRoot: string = path.resolve(frontendRoot, '../..');
	const sourceFingerprint: string = await readCommunitySourceFingerprint(repositoryRoot);
	await execa('vite', ['build', '--config', 'vite.community-app.config.ts'], {
		cwd: frontendRoot,
		stdout: process.stdout,
		stderr: process.stderr,
		env: { NODE_ENV: 'production' },
	});
	const manifest: Manifest = JSON.parse(await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf8')) as Manifest;
	const logger: ReturnType<typeof createLogger> = createLogger();
	const inliner: LocaleInliner = new LocaleInliner({ outputDir, scriptsDir: 'scripts', i18nFile: COMMUNITY_BUILD_ENTRIES.i18n.slice(2), logger, manifest });
	await inliner.loadFiles();
	inliner.collectsModifications();
	for (const language of COMMUNITY_BUILD_LANGUAGES) {
		await inliner.saveLocale(language, locales[language]);
	}
	if (logger.errorCount > 0) throw new Error(`Community locale inlining failed with ${logger.errorCount} errors.`);
	const source: Awaited<ReturnType<typeof execa>> = await execa('git', ['rev-parse', 'HEAD'], { cwd: frontendRoot });
	const changes: Awaited<ReturnType<typeof execa>> = await execa('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: frontendRoot });
	if (await readCommunitySourceFingerprint(repositoryRoot) !== sourceFingerprint) throw new Error('Community build sources changed while compiling; retry from a stable source tree.');
	await finalizeCommunityApp({
		outputDir,
		templatePath: path.join(frontendRoot, 'community-app.html'),
		manifest,
		supportedLanguages: COMMUNITY_BUILD_LANGUAGES,
		version: metadata.version,
		sourceRevision: String(source.stdout).trim(),
		sourceDirty: String(changes.stdout).length > 0,
		sourceFingerprint,
	});
	console.info(`Community application built at ${outputDir}`);
}

await buildCommunityApp();
