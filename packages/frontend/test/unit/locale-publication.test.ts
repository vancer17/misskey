/*
 * 语言资源发布集成测试：验证完整语言发布、局部中文补充与官方译文接管的构建边界。
 * 数据链：真实 i18n 源码和语言资源 → 隔离目录中的 Node 原生模块 → 合并与发布公开 API。
 * 所有输入变更和输出均限定在临时副本，不修改项目 YAML、构建产物或运行实例。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFrontendLocalesJson, languages, locales } from 'i18n';
import type { Locale } from 'i18n';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import meta from '../../../../package.json';

/** 测试创建的临时目录登记表，供清理钩子统一回收。 */
const directories: string[] = [];

/** 仓库中的权威 i18n 源码和依赖入口，仅用于读取及临时目录依赖解析。 */
const i18nDirectory: string = path.resolve(__dirname, '../../../i18n');

/** 为实际发布函数分配独立输出目录，失败时同样由清理钩子回收。 */
async function createOutputDirectory(): Promise<string> {
	const directory: string = await mkdtemp(path.join(tmpdir(), 'misskey-locale-publication-'));
	directories.push(directory);
	return directory;
}

/** 将真实 TypeScript 转译为原生 ESM，保留 import.meta.url 的文件资源解析语义。 */
function transpileNativeModule(source: string): string {
	return transpileModule(source, {
		compilerOptions: {
			/** 测试由 Node 原生导入，不能转成 CommonJS 或依赖 Vitest 的模块转换。 */
			module: ModuleKind.ESNext,
			/** 与语言包生产转译保持相同的运行语法级别。 */
			target: ScriptTarget.ES2022,
		},
	}).outputText;
}

/** 在临时副本中运行真实构建公开 API，使测试中的文件变更不会触及开发环境。 */
async function runIsolatedPublication(assertions: string): Promise<void> {
	const directory: string = await createOutputDirectory();
	await writeFile(path.join(directory, 'package.json'), '{"type":"module"}', 'utf-8');
	await symlink(path.join(i18nDirectory, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
	const sourceFiles: readonly string[] = ['index', 'const'];
	await Promise.all(sourceFiles.map(
		/** 转译当前源码，而非复用可能尚未更新的项目 built 产物。 */
		async (fileName: string): Promise<void> => {
			const source: string = await readFile(path.join(i18nDirectory, 'src', `${fileName}.ts`), 'utf-8');
			await writeFile(path.join(directory, `${fileName}.js`), transpileNativeModule(source), 'utf-8');
		},
	));
	await cp(path.resolve(i18nDirectory, '../../locales'), path.join(directory, 'locales'), { recursive: true });
	await mkdir(path.join(directory, 'resources', 'fork'), { recursive: true });
	await cp(path.join(i18nDirectory, 'src', 'resources', 'fork', 'zh-CN.json'), path.join(directory, 'resources', 'fork', 'zh-CN.json'));
	const source: string = `
		import assert from 'node:assert/strict';
		import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
		import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
		import { build, writeFrontendLocalesJson } from './index.js';
		import type { Locale } from 'i18n';

		/** 测试输入直接沿用生成的权威语言字段，不复制另一套业务键定义。 */
		type CalibrationMessages = Locale['_avatarDecorationCalibration'];
		/** 文件载荷只作为构建输入，不能被当作已合并的完整语言。 */
		type ForkSupplement = { _avatarDecorationCalibration: CalibrationMessages };
		/** 当前临时副本的中文补充路径，与真实构建的资源布局相同。 */
		const supplementPath: string = './resources/fork/zh-CN.json';
		/** 读取真实补充资源作为期望值，不在测试内复制18条译文。 */
		const supplement: ForkSupplement = JSON.parse(readFileSync(supplementPath, 'utf-8'));

		/** 通过实际文件加载发布结果，验证使用者取得完整有效 JSON。 */
		function published(language: string): Locale & { _version_: string } {
			return JSON.parse(readFileSync('./published/' + language + '.test-version.json', 'utf-8'));
		}

		/** 变更临时的原始中文 YAML，用于模拟 Crowdin 后续提供正式译文。 */
		function writeOfficialMessages(messages: Partial<CalibrationMessages>): void {
			const chinese: Record<string, unknown> = loadYaml(readFileSync('./locales/zh-CN.yml', 'utf-8')) as Record<string, unknown>;
			chinese._avatarDecorationCalibration = messages;
			writeFileSync('./locales/zh-CN.yml', dumpYaml(chinese), 'utf-8');
		}

		${assertions}
	`;
	execFileSync(process.execPath, ['--input-type=module', '--eval', transpileNativeModule(source)], {
		cwd: directory,
		encoding: 'utf-8',
		stdio: 'pipe',
	});
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

	it('publishes all calibration translations without changing other languages', /** 真实源码的发布链采用18条中文补充，日文、英文与繁体中文保持官方资源的原始含义。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const japanese: Locale = loadYaml(readFileSync('./locales/ja-JP.yml', 'utf-8')) as Locale;
			const english: Partial<Locale> = loadYaml(readFileSync('./locales/en-US.yml', 'utf-8')) as Partial<Locale>;
			await writeFrontendLocalesJson('./published', 'test-version');
			const chinese: Locale & { _version_: string } = published('zh-CN');
			assert.deepEqual(Object.keys(supplement._avatarDecorationCalibration).sort(), Object.keys(japanese._avatarDecorationCalibration).sort());
			assert.deepEqual(chinese._avatarDecorationCalibration, supplement._avatarDecorationCalibration);
			assert.equal(chinese._version_, 'test-version');
			assert.equal(chinese._lang_, build()['zh-CN']._lang_);
			assert.ok(Object.keys(chinese).length > Object.keys(supplement).length);
			assert.deepEqual(published('ja-JP')._avatarDecorationCalibration, japanese._avatarDecorationCalibration);
			assert.deepEqual(published('en-US')._avatarDecorationCalibration, {
				...japanese._avatarDecorationCalibration,
				...english._avatarDecorationCalibration,
			});
			const traditionalChinese: Locale['_avatarDecorationCalibration'] = published('zh-TW')._avatarDecorationCalibration;
			rmSync(supplementPath);
			await writeFrontendLocalesJson('./published', 'test-version');
			assert.deepEqual(published('zh-TW')._avatarDecorationCalibration, traditionalChinese);
		`);
	});

	it('reads changed supplements again within the same native module instance', /** 同进程第二次发布必须读取新文件，不能复用 import JSON 缓存或污染其他语言。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			await writeFrontendLocalesJson('./published', 'test-version');
			const originalChinese: Locale = published('zh-CN');
			const originalJapanese: string = readFileSync('./published/ja-JP.test-version.json', 'utf-8');
			const originalEnglish: string = readFileSync('./published/en-US.test-version.json', 'utf-8');
			const updated: string = originalChinese._avatarDecorationCalibration.title + '（同进程更新）';
			supplement._avatarDecorationCalibration.title = updated;
			writeFileSync(supplementPath, JSON.stringify(supplement), 'utf-8');
			assert.equal(build()['zh-CN']._avatarDecorationCalibration.title, updated);
			await writeFrontendLocalesJson('./published', 'test-version');
			assert.equal(published('zh-CN')._avatarDecorationCalibration.title, updated);
			assert.equal(readFileSync('./published/ja-JP.test-version.json', 'utf-8'), originalJapanese);
			assert.equal(readFileSync('./published/en-US.test-version.json', 'utf-8'), originalEnglish);
		`);
	});

	it('requires removal before official translations take ownership of overlapping keys', /** 空官方译文允许补充；正式同键即使内容相同也报错，移除该补充后由正式资源接管。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			writeOfficialMessages({ title: '' });
			assert.equal(build()['zh-CN']._avatarDecorationCalibration.title, supplement._avatarDecorationCalibration.title);
			await writeFrontendLocalesJson('./published', 'test-version');
			const priorChinese: string = readFileSync('./published/zh-CN.test-version.json', 'utf-8');
			writeOfficialMessages({ title: supplement._avatarDecorationCalibration.title });
			assert.throws(/** 正式与临时同键不能依赖覆盖优先级掩盖。 */ (): void => { build(); }, /remove the fork supplement/);
			await assert.rejects(writeFrontendLocalesJson('./published', 'test-version'), /remove the fork supplement/);
			assert.equal(readFileSync('./published/zh-CN.test-version.json', 'utf-8'), priorChinese);
			const remaining: Partial<CalibrationMessages> = { ...supplement._avatarDecorationCalibration };
			delete remaining.title;
			writeFileSync(supplementPath, JSON.stringify({ _avatarDecorationCalibration: remaining }), 'utf-8');
			const officialTitle: string = '官方译文已接管';
			writeOfficialMessages({ title: officialTitle });
			await writeFrontendLocalesJson('./published', 'test-version');
			assert.deepEqual(published('zh-CN')._avatarDecorationCalibration, { ...supplement._avatarDecorationCalibration, title: officialTitle });
			rmSync(supplementPath);
			await writeFrontendLocalesJson('./published', 'test-version');
			const japanese: Locale = loadYaml(readFileSync('./locales/ja-JP.yml', 'utf-8')) as Locale;
			assert.deepEqual(published('zh-CN')._avatarDecorationCalibration, { ...japanese._avatarDecorationCalibration, title: officialTitle });
		`);
	});

	it('rejects unsupported scopes, keys, blank translations and non-string values', /** 补充资源不能扩展到其他命名空间或未声明键，非法文件不得被作为有效译文发布。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const invalidSupplements: readonly unknown[] = [
				/** 根节点必须是语言资源对象。 */
				null, [], '中文资源',
				/** 仅允许已授权的校准命名空间。 */
				{ _avatarDecorationManager: { title: '越界补充' } },
				{ _avatarDecorationCalibration: {}, unrelated: {} },
				/** 命名空间本身也必须是对象。 */
				{ _avatarDecorationCalibration: null },
				{ _avatarDecorationCalibration: [] },
				{ _avatarDecorationCalibration: '错误层级' },
				/** 叶键必须来自日文源的当前权威字段。 */
				{ _avatarDecorationCalibration: { nonexistentCalibrationKey: '未知字段' } },
				/** 已知叶键只接受非空字符串。 */
				{ _avatarDecorationCalibration: { title: '' } },
				{ _avatarDecorationCalibration: { title: '   ' } },
				{ _avatarDecorationCalibration: { title: 1 } },
				{ _avatarDecorationCalibration: { title: false } },
				{ _avatarDecorationCalibration: { title: null } },
				{ _avatarDecorationCalibration: { title: {} } },
			];
			for (const payload of invalidSupplements) {
				writeFileSync(supplementPath, JSON.stringify(payload), 'utf-8');
				assert.throws(/** 校验失败须由真实公开构建函数抛出。 */ (): void => { build(); }, /Fork zh-CN/);
			}
		`);
	});

	it('rejects unreadable or malformed supplements instead of silently falling back', /** 只有真实缺文件允许移除回退，解析错误和错误路径必须阻断发布。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			writeFileSync(supplementPath, '{', 'utf-8');
			assert.throws(/** 损坏 JSON 不得伪装为不存在的补充文件。 */ (): void => { build(); }, SyntaxError);
			rmSync(supplementPath);
			mkdirSync(supplementPath);
			assert.throws(/** 已存在的错误目录不能触发 ENOENT 回退。 */ (): void => { build(); }, { code: 'EISDIR' });
		`);
	});
});
