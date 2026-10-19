/*
 * 语言资源发布集成测试：通过真实文件系统验证合并语言的完整发布与未变化资源的稳定性。
 * 所有输出写入独立临时目录，不修改运行实例的语言资源。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFrontendLocalesJson, languages, locales } from 'i18n';
import type { Locale } from 'i18n';
import { afterEach, describe, expect, it } from 'vitest';
import meta from '../../../../package.json';

const directories: string[] = [];

/** 为实际发布函数分配独立输出目录，失败时同样由清理钩子回收。 */
async function createOutputDirectory(): Promise<string> {
	const directory: string = await mkdtemp(path.join(tmpdir(), 'misskey-locale-publication-'));
	directories.push(directory);
	return directory;
}

afterEach(/** 回收当前测试创建的输出，不触及项目内的生成物。 */ async (): Promise<void> => {
	await Promise.all(directories.splice(0).map(
		/** 删除已登记的临时资源目录。 */
		(directory: string): Promise<void> => rm(directory, { recursive: true, force: true }),
	));
});

describe('frontend locale publication', /** 验证发布结果而不替换文件系统或语言构建器。 */ (): void => {
	it('publishes complete merged locales and preserves unchanged files', /** 中文继承完整文案，重复构建与局部修复不重写无变化语言。 */ async (): Promise<void> => {
		const directory: string = await createOutputDirectory();
		const chinesePath: string = path.join(directory, `zh-CN.${meta.version}.json`);
		const japanesePath: string = path.join(directory, `ja-JP.${meta.version}.json`);
		await writeFrontendLocalesJson(directory, meta.version);
		const chineseContent: string = await readFile(chinesePath, 'utf-8');
		const chineseLocale: Locale & { _version_: string } = JSON.parse(chineseContent);
		expect(chineseLocale._version_).toBe(meta.version);
		expect(chineseLocale._uploader.videoCompressionFallback).toBe(locales['zh-CN']._uploader.videoCompressionFallback);
		expect(chineseLocale._uploader.videoCompressionFallback).toContain('{name}');
		expect(await readdir(directory)).toHaveLength(languages.length);
		const originalChinese: Awaited<ReturnType<typeof stat>> = await stat(chinesePath);
		const originalJapanese: Awaited<ReturnType<typeof stat>> = await stat(japanesePath);

		await writeFrontendLocalesJson(directory, meta.version);
		const unchangedChinese: Awaited<ReturnType<typeof stat>> = await stat(chinesePath);
		expect(unchangedChinese.ino).toBe(originalChinese.ino);
		expect(unchangedChinese.mtimeMs).toBe(originalChinese.mtimeMs);

		await writeFile(chinesePath, '{}', 'utf-8');
		await writeFrontendLocalesJson(directory, meta.version);
		expect(await readFile(chinesePath, 'utf-8')).toBe(chineseContent);
		const unchangedJapanese: Awaited<ReturnType<typeof stat>> = await stat(japanesePath);
		expect(unchangedJapanese.ino).toBe(originalJapanese.ino);
		expect(unchangedJapanese.mtimeMs).toBe(originalJapanese.mtimeMs);
		expect((await readdir(directory)).filter(/** 原子替换完成后不遗留临时文件。 */ (name: string): boolean => name.endsWith('.tmp'))).toEqual([]);
	});

	it('propagates output errors instead of treating them as missing files', /** 已存在的错误目标不能被缺文件回退吞掉。 */ async (): Promise<void> => {
		const directory: string = await createOutputDirectory();
		await mkdir(path.join(directory, `zh-CN.${meta.version}.json`));
		await expect(writeFrontendLocalesJson(directory, meta.version)).rejects.toMatchObject({ code: 'EISDIR' });
	});
});
