/*
 * 语言构建测试领域：验证启动加载器的缓存参数仍可被生产语言内联器识别，
 * 并保留动态请求选项的运行行为；测试直接使用构建器与当前加载器源码。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import locales from 'i18n';
import { afterAll, describe, expect, it } from 'vitest';
import { LocaleInliner } from '../../../frontend-builder/locale-inliner.js';
import { collectModifications } from '../../../frontend-builder/locale-inliner/collect-modifications.js';
import { createLogger } from '../../../frontend-builder/logger.js';
import type { TextModification } from '../../../frontend-builder/locale-inliner.js';
import type { Logger } from '../../../frontend-builder/logger.js';

/** 构建器只向本组测试的独立临时目录写入，不改动开发服务的语言制品。 */
const outputDir: string = mkdtempSync(join(tmpdir(), 'misskey-locale-inliner-cache-'));

/** 使用真实构造器提供最小有效清单，沿用生产构建器的脚本路径解析。 */
function createInliner(logger: Logger): LocaleInliner {
	return new LocaleInliner({
		/** 仅用于本组内联输出的临时目录。 */
		outputDir,
		/** 与生产脚本清单相同的目录层级。 */
		scriptsDir: 'scripts',
		/** 内联器在清单中查找的入口标识。 */
		i18nFile: 'src/i18n.ts',
		/** 单入口清单足以执行真实源码替换和语言输出。 */
		manifest: {
			/** 入口对应的脚本文件，供构造器发现待处理代码块。 */
			'src/i18n.ts': {
				/** 生产清单中的相对脚本路径。 */
				file: 'scripts/i18n.js',
			},
		},
		/** 使用构建器自己的日志计数，避免将解析失败当作不匹配。 */
		logger,
	});
}

/** 将真实识别结果交给生产输出方法，检查缓存请求最终被完整语言 JSON 替换。 */
async function expectLocaleInlined(sourceCode: string): Promise<void> {
	const logger: ReturnType<typeof createLogger> = createLogger();
	const inliner: LocaleInliner = createInliner(logger);
	const modifications: TextModification[] = collectModifications(sourceCode, 'i18n.js', logger, inliner);
	expect(logger.errorCount).toBe(0);
	expect(modifications).toHaveLength(1);
	expect(modifications[0]?.type).toBe('locale-json');

	const chunk: LocaleInliner['chunks'][number] | undefined = inliner.chunks[0];
	if (chunk === undefined) throw new Error('The locale entry must be present in the build manifest.');
	chunk.sourceCode = sourceCode;
	chunk.modifications = modifications;
	await inliner.saveLocale('zh-CN', locales['zh-CN']);
	const localizedSource: string = readFileSync(join(outputDir, 'zh-CN', 'i18n.js'), 'utf-8');
	expect(localizedSource).toContain('JSON.parse(');
	expect(localizedSource).toContain(locales['zh-CN']._lang_);
	expect(localizedSource).not.toContain('window.fetch');
	expect(logger.errorCount).toBe(0);
}

afterAll(/** 删除本组测试生成的制品，避免临时目录在多次运行间累积。 */ (): void => {
	rmSync(outputDir, { recursive: true, force: true });
});

describe('语言加载缓存选项与生产内联契约', /** 覆盖实际加载器与静态请求选项的识别边界。 */ (): void => {
	it('实际加载器重新验证缓存时，生产内联仍消除网络请求', /** 使用仓库当前源码转译，防止手写正例与真实启动链脱节。 */ async (): Promise<void> => {
		const loaderSource: string = readFileSync(resolve(__dirname, '../../../frontend-shared/js/locale.ts'), 'utf-8');
		const sourceCode: string = transpileModule(loaderSource, {
			/** 保持生产内联器接收的 ESM 与顶层 await 形态。 */
			compilerOptions: {
				/** 不把模块语法转换为 CommonJS。 */
				module: ModuleKind.ESNext,
				/** 保留加载器的顶层 await。 */
				target: ScriptTarget.ES2022,
			},
		}).outputText;
		expect(sourceCode).toMatch(/cache:\s*["']no-cache["']/);
		await expectLocaleInlined(sourceCode);
	});

	it('既有单参数语言请求仍可内联', /** 保留内联器已有调用协议的有效匹配。 */ async (): Promise<void> => {
		const sourceCode: string = 'export let locale = await window.fetch(`/assets/locales/${lang}.${version}.json`).then(response => response.json(), () => null);';
		await expectLocaleInlined(sourceCode);
	});

	it('生产压缩器输出的无插值模板常量仍可内联', /** 保留实际 Rolldown 产物中的缓存值形态，避免仅验证 TypeScript 转译文本。 */ async (): Promise<void> => {
		const sourceCode: string = 'let i=await window.fetch(`/assets/locales/${n}.${t}.json`,{cache:`no-cache`}).then(e=>e.json(),()=>null);';
		await expectLocaleInlined(sourceCode);
	});

	it.each([
		'sideEffect()',
		"{ [key]: 'no-cache' }",
		"{ cache: 'no-cache', headers: sideEffect() }",
		'{ cache: cacheMode }',
		'{ cache: `no-${sideEffect()}` }',
		"{ ...requestOptions, cache: 'no-cache' }",
	])('保留不能静态替换的请求选项：%s', /** 动态值或额外行为不能因语言内联而被静默删除。 */ (requestOptions: string): void => {
		const sourceCode: string = `export let locale = await window.fetch(\`/assets/locales/\${lang}.\${version}.json\`, ${requestOptions}).then(response => response.json(), () => null);`;
		const logger: ReturnType<typeof createLogger> = createLogger();
		const inliner: LocaleInliner = createInliner(logger);
		const modifications: TextModification[] = collectModifications(sourceCode, 'i18n.js', logger, inliner);
		expect(logger.errorCount).toBe(0);
		expect(modifications).toEqual([]);
	});
});
