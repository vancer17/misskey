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
		/** 手动刷新文案从权威语言类型派生，测试只接收本次明确授权的三个叶子字段。 */
		type TimelineRefreshMessages = Pick<Locale['_twitterUi'], 'timelineUpdated' | 'timelineUpToDate' | 'timelineRefreshFailed'>;
		/** 当前补充包的业务字段从生成类型派生，不另外维护语言领域模型。 */
		type SupplementMessages = Pick<Locale, 'trending' | 'whoToFollow' | '_twitterSearch'> & {
			_twitterUi: Pick<Locale['_twitterUi'], keyof TimelineRefreshMessages | 'primaryNavigation' | 'notificationsWithCount' | 'newNotesWithCount' | 'scheduleDate' | 'scheduleTime' | 'previousMonth' | 'nextMonth' | 'scheduleTimeIsInThePast'>;
			_channel: Pick<Locale['_channel'], 'noFollowing'>;
		};
		/** 文件载荷只作为构建输入，不能被当作已合并的完整语言。 */
		type ForkSupplement = SupplementMessages & MigratedSupplementMessages & { _avatarDecorationCalibration: CalibrationMessages };
		/** 从既有权威类型派生迁移资源协议，上传与二维码仅包含缺少正式译文的字段。 */
		type MigratedSupplementMessages = Pick<Locale, '_avatarDecorationSettings' | '_avatarDecorationManager'> & {
			_uploader: Pick<Locale['_uploader'], 'videoCompressionFallback'>;
			_qr: Partial<Locale['_qr']>;
		};
		/** 原始 YAML 和 JSON 的递归字符串树，仅用于发布前的翻译覆盖检查。 */
		type SourceMessages = { [key: string]: string | SourceMessages };
		/** 当前临时副本的中文补充路径，与真实构建的资源布局相同。 */
		const supplementPath: string = './resources/fork/zh-CN.json';
		/** 读取真实补充资源，既有校准和刷新断言继续复用原始载荷。 */
		const supplement: ForkSupplement = JSON.parse(readFileSync(supplementPath, 'utf-8'));

		/** 展开回退前的实际叶键；不依赖假名检测，以便发现“日付”等纯汉字缺译。 */
		function sourceLeaves(messages: SourceMessages, prefix: string = ''): Record<string, string> {
			const leaves: Record<string, string> = {};
			for (const [key, value] of Object.entries(messages)) {
				const leafPath: string = prefix ? prefix + '.' + key : key;
				if (typeof value === 'string') {
					if (value.trim().length > 0) leaves[leafPath] = value;
				} else {
					Object.assign(leaves, sourceLeaves(value, leafPath));
				}
			}
			return leaves;
		}

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

		/** 投影刷新提示，避免将其他 Twitter UI 词条误纳入本次翻译补充的断言。 */
		function refreshMessages(locale: Pick<Locale, '_twitterUi'>): TimelineRefreshMessages {
			return {
				/** 有新帖子时展示的刷新结果。 */
				timelineUpdated: locale._twitterUi.timelineUpdated,
				/** 成功查询但无新帖子时展示的刷新结果。 */
				timelineUpToDate: locale._twitterUi.timelineUpToDate,
				/** 查询失败时展示的刷新结果。 */
				timelineRefreshFailed: locale._twitterUi.timelineRefreshFailed,
			};
		}

		/** 仅在临时官方资源加入刷新文案，保留该命名空间内其他已有译文。 */
		function writeOfficialRefreshMessages(messages: Partial<TimelineRefreshMessages>): void {
			const chinese: Record<string, unknown> = loadYaml(readFileSync('./locales/zh-CN.yml', 'utf-8')) as Record<string, unknown>;
			const twitter: Record<string, unknown> = chinese._twitterUi as Record<string, unknown>;
			chinese._twitterUi = { ...twitter, ...messages };
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
		expect(chineseLocale._twitterUi.timelineUpdated).toBe('时间线已更新');
		expect(chineseLocale._twitterUi.timelineUpToDate).toBe('本次检查暂无新帖子');
		expect(chineseLocale._twitterUi.timelineRefreshFailed).toBe('刷新失败，请重试');
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

	it('publishes migrated Chinese resources without overriding official messages or other languages', /** 真实静态资源逐叶映射到发布结果，移除四个补充区域不改变其他语言。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const namespaces: readonly (keyof MigratedSupplementMessages)[] = ['_uploader', '_qr', '_avatarDecorationSettings', '_avatarDecorationManager'];
			const officialChinese: Record<string, string> = sourceLeaves(loadYaml(readFileSync('./locales/zh-CN.yml', 'utf-8')) as SourceMessages);
			await writeFrontendLocalesJson('./published', 'test-version');
			const chinese: Record<string, string> = sourceLeaves(published('zh-CN') as unknown as SourceMessages);
			const merged: Record<string, string> = sourceLeaves(build()['zh-CN'] as unknown as SourceMessages);
			for (const namespace of namespaces) {
				const migrated: Record<string, string> = sourceLeaves(supplement[namespace] as SourceMessages, namespace);
				assert.ok(Object.keys(migrated).length > 0);
				for (const [key, value] of Object.entries(migrated)) {
					assert.ok(!Object.hasOwn(officialChinese, key));
					assert.equal(merged[key], value);
					assert.equal(chinese[key], value);
				}
			}
			for (const [key, value] of Object.entries(officialChinese)) assert.equal(chinese[key], value);
			const unaffectedLanguages: readonly string[] = ['ja-JP', 'en-US', 'zh-TW'];
			const previous: readonly string[] = unaffectedLanguages.map(/** 保存其他语言实际发布字节，用于检查补充范围隔离。 */ (language: string): string => readFileSync('./published/' + language + '.test-version.json', 'utf-8'));
			const remaining: Partial<ForkSupplement> = { ...supplement };
			for (const namespace of namespaces) delete remaining[namespace];
			writeFileSync(supplementPath, JSON.stringify(remaining), 'utf-8');
			await writeFrontendLocalesJson('./published', 'test-version');
			unaffectedLanguages.forEach(/** 移除迁移资源只能影响简体中文目标，不能改变其他语言。 */ (language: string, index: number): void => {
				assert.equal(readFileSync('./published/' + language + '.test-version.json', 'utf-8'), previous[index]);
			});
		`);
	});

	it('requires removing migrated supplements before official translations take over', /** 每个迁移区域仍拒绝覆盖正式译文，逐项删除补充后由真实发布链采用官方值。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const namespaces: readonly (keyof MigratedSupplementMessages)[] = ['_uploader', '_qr', '_avatarDecorationSettings', '_avatarDecorationManager'];
			const originalOfficial: string = readFileSync('./locales/zh-CN.yml', 'utf-8');
			for (const namespace of namespaces) {
				const section: SourceMessages = supplement[namespace] as SourceMessages;
				const key: string | undefined = Object.keys(section)[0];
				if (key === undefined) throw new Error('Expected migrated resource in ' + namespace);
				const official: SourceMessages = loadYaml(originalOfficial) as SourceMessages;
				const officialSection: SourceMessages = (official[namespace] ?? {}) as SourceMessages;
				officialSection[key] = section[key];
				official[namespace] = officialSection;
				writeFileSync(supplementPath, JSON.stringify(supplement), 'utf-8');
				writeFileSync('./locales/zh-CN.yml', dumpYaml(official), 'utf-8');
				assert.throws(/** 同值正式译文也要求显式移除补充，避免双份权威来源。 */ (): void => { build(); }, /remove the fork supplement/);
				const remaining: SourceMessages = { ...supplement, [namespace]: { ...section } } as unknown as SourceMessages;
				delete (remaining[namespace] as SourceMessages)[key];
				writeFileSync(supplementPath, JSON.stringify(remaining), 'utf-8');
				const officialValue: string = '正式中文接管：' + namespace + '.' + key;
				officialSection[key] = officialValue;
				writeFileSync('./locales/zh-CN.yml', dumpYaml(official), 'utf-8');
				await writeFrontendLocalesJson('./published', 'test-version');
				assert.equal(sourceLeaves(published('zh-CN') as unknown as SourceMessages)[namespace + '.' + key], officialValue);
			}
		`);
	});

	it('publishes the three Chinese refresh messages and preserves native language fallbacks', /** 真实发布链只补简体中文刷新提示，其他语言保持原始回退，移除补充后恢复中文原生回退。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const expected: TimelineRefreshMessages = {
				/** 成功查询到新帖子时提供中文确认。 */
				timelineUpdated: '时间线已更新',
				/** 无新帖子时提供中文检查结果。 */
				timelineUpToDate: '本次检查暂无新帖子',
				/** 查询失败与无新帖子采用不同的中文反馈。 */
				timelineRefreshFailed: '刷新失败，请重试',
			};
			const japanese: Locale = loadYaml(readFileSync('./locales/ja-JP.yml', 'utf-8')) as Locale;
			const english: Partial<Locale> = loadYaml(readFileSync('./locales/en-US.yml', 'utf-8')) as Partial<Locale>;
			const rawChinese: Partial<Locale> = loadYaml(readFileSync('./locales/zh-CN.yml', 'utf-8')) as Partial<Locale>;
			const rawTraditional: Partial<Locale> = loadYaml(readFileSync('./locales/zh-TW.yml', 'utf-8')) as Partial<Locale>;
			await writeFrontendLocalesJson('./published', 'test-version');
			assert.deepEqual(refreshMessages(supplement), expected);
			assert.deepEqual(refreshMessages(build()['zh-CN']), expected);
			assert.deepEqual(refreshMessages(published('zh-CN')), expected);
			assert.deepEqual(refreshMessages(published('ja-JP')), refreshMessages(japanese));
			assert.deepEqual(refreshMessages(published('en-US')), refreshMessages({ _twitterUi: { ...japanese._twitterUi, ...english._twitterUi } }));
			assert.deepEqual(refreshMessages(published('zh-TW')), refreshMessages({ _twitterUi: {
				...japanese._twitterUi, ...english._twitterUi, ...rawChinese._twitterUi, ...rawTraditional._twitterUi,
			} }));
			const unaffectedLanguages: readonly string[] = ['ja-JP', 'en-US', 'zh-TW'];
			const priorOtherLocales: readonly string[] = unaffectedLanguages.map(
				/** 保存真实发布字节，确认补充移除不会改写其他语言的任意字段。 */
				(language: string): string => readFileSync('./published/' + language + '.test-version.json', 'utf-8'),
			);
			rmSync(supplementPath);
			await writeFrontendLocalesJson('./published', 'test-version');
			assert.deepEqual(refreshMessages(published('zh-CN')), refreshMessages({ _twitterUi: {
				...japanese._twitterUi, ...english._twitterUi, ...rawChinese._twitterUi,
			} }));
			unaffectedLanguages.forEach(/** 缺文件回退继续保持语言隔离。 */ (language: string, index: number): void => {
				assert.equal(readFileSync('./published/' + language + '.test-version.json', 'utf-8'), priorOtherLocales[index]);
			});
		`);
	});

	it('covers every source message before fallback except the shared Bot term', /** 全量比较原始叶键，捕获新增与纯汉字日文缺译；Bot 允许术语回退或正式中文接管。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			/** 术语例外允许缺译，不强制缺译；正式中文完善后仍应通过覆盖检查。 */
			function assertChineseCoverage(): void {
				const japanese: Record<string, string> = sourceLeaves(loadYaml(readFileSync('./locales/ja-JP.yml', 'utf-8')) as SourceMessages);
				const chinese: Record<string, string> = sourceLeaves(loadYaml(readFileSync('./locales/zh-CN.yml', 'utf-8')) as SourceMessages);
				const fork: Record<string, string> = sourceLeaves(supplement as unknown as SourceMessages);
				const missing: readonly string[] = Object.keys(japanese).filter(
					/** 只认正式中文或有效补充，不把英文或日文回退误报为已经翻译。 */
					(key: string): boolean => !Object.hasOwn(chinese, key) && !Object.hasOwn(fork, key),
				).sort();
				assert.deepEqual(missing.filter(/** 仅放行已经明确批准的通用术语。 */ (key: string): boolean => key !== 'bot'), []);
				if (missing.includes('bot')) {
					assert.equal(japanese.bot, 'Bot');
					assert.equal(published('zh-CN').bot, 'Bot');
				}
			}
			await writeFrontendLocalesJson('./published', 'test-version');
			assertChineseCoverage();
			const officialChinese: Record<string, unknown> = loadYaml(readFileSync('./locales/zh-CN.yml', 'utf-8')) as Record<string, unknown>;
			officialChinese.bot = '机器人';
			writeFileSync('./locales/zh-CN.yml', dumpYaml(officialChinese), 'utf-8');
			await writeFrontendLocalesJson('./published', 'test-version');
			assertChineseCoverage();
			assert.equal(published('zh-CN').bot, '机器人');
		`);
	});

	it('publishes the fourteen audited Chinese messages without leaking into other languages', /** 搜索、侧栏、通知与定时发布的实际 JSON 使用明确中文，其他语言的整份字节保持原生回退。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const expected: Readonly<Record<string, string>> = {
				/** 右栏趋势列表的标题。 */
				trending: '趋势',
				/** 右栏推荐账户的标题。 */
				whoToFollow: '推荐关注',
				/** 已关注频道列表的空态。 */
				'_channel.noFollowing': '你还没有关注的频道',
				/** 搜索框内链接的快捷查询操作。 */
				'_twitterSearch.lookupUrl': '查询此链接',
				/** 搜索框内账户标识的快捷查看操作。 */
				'_twitterSearch.showUser': '查看此用户',
				/** 搜索框内话题标签的快捷查看操作。 */
				'_twitterSearch.showHashtag': '查看此话题标签',
				/** 导航区域的无障碍名称。 */
				'_twitterUi.primaryNavigation': '主导航',
				/** 未读通知入口保留数量插值。 */
				'_twitterUi.notificationsWithCount': '通知（{count} 条未读）',
				/** 新帖子提示保留数量插值。 */
				'_twitterUi.newNotesWithCount': '新帖子（{count} 条）',
				/** 定时发布的日期字段，覆盖不含假名的日文缺译。 */
				'_twitterUi.scheduleDate': '日期',
				/** 定时发布的时间字段，覆盖不含假名的日文缺译。 */
				'_twitterUi.scheduleTime': '时间',
				/** 日期选择器向前切换月份的按钮名称。 */
				'_twitterUi.previousMonth': '上个月',
				/** 日期选择器向后切换月份的按钮名称。 */
				'_twitterUi.nextMonth': '下个月',
				/** 过去日期不能用于定时发布的校验反馈。 */
				'_twitterUi.scheduleTimeIsInThePast': '请选择晚于当前时间的日期和时间',
			};
			await writeFrontendLocalesJson('./published', 'test-version');
			const chinese: Record<string, string> = sourceLeaves(published('zh-CN') as unknown as SourceMessages);
			for (const [key, value] of Object.entries(expected)) assert.equal(chinese[key], value, key);
			const otherLanguages: readonly string[] = ['ja-JP', 'en-US', 'zh-TW'];
			const withSupplement: readonly string[] = otherLanguages.map(
				/** 保存整个发布文件，避免只验证新增区域而遗漏跨语言污染。 */
				(language: string): string => readFileSync('./published/' + language + '.test-version.json', 'utf-8'),
			);
			rmSync(supplementPath);
			await writeFrontendLocalesJson('./published', 'test-version');
			otherLanguages.forEach(/** 移除本地中文补充不应改变其他语言的任意字节。 */ (language: string, index: number): void => {
				assert.equal(readFileSync('./published/' + language + '.test-version.json', 'utf-8'), withSupplement[index]);
			});
		`);
	});

	it('reads changed supplements again within the same native module instance', /** 同进程第二次发布必须读取新文件，不能复用 import JSON 缓存或污染其他语言。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			await writeFrontendLocalesJson('./published', 'test-version');
			const originalChinese: Locale = published('zh-CN');
			const originalJapanese: string = readFileSync('./published/ja-JP.test-version.json', 'utf-8');
			const originalEnglish: string = readFileSync('./published/en-US.test-version.json', 'utf-8');
			const originalTraditional: string = readFileSync('./published/zh-TW.test-version.json', 'utf-8');
			const updated: string = originalChinese._avatarDecorationCalibration.title + '（同进程更新）';
			const updatedRefresh: string = originalChinese._twitterUi.timelineUpToDate + '（同进程更新）';
			supplement._avatarDecorationCalibration.title = updated;
			supplement._twitterUi.timelineUpToDate = updatedRefresh;
			writeFileSync(supplementPath, JSON.stringify(supplement), 'utf-8');
			assert.equal(build()['zh-CN']._avatarDecorationCalibration.title, updated);
			assert.equal(build()['zh-CN']._twitterUi.timelineUpToDate, updatedRefresh);
			await writeFrontendLocalesJson('./published', 'test-version');
			assert.equal(published('zh-CN')._avatarDecorationCalibration.title, updated);
			assert.equal(published('zh-CN')._twitterUi.timelineUpToDate, updatedRefresh);
			assert.equal(readFileSync('./published/ja-JP.test-version.json', 'utf-8'), originalJapanese);
			assert.equal(readFileSync('./published/en-US.test-version.json', 'utf-8'), originalEnglish);
			assert.equal(readFileSync('./published/zh-TW.test-version.json', 'utf-8'), originalTraditional);
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

	it('hands over each refresh message only after its fork supplement is removed', /** 三个刷新提示分别验证正式同键冲突、同值拒绝以及单键移除后的正式资源接管。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const originalOfficial: string = readFileSync('./locales/zh-CN.yml', 'utf-8');
			const keys: readonly (keyof TimelineRefreshMessages)[] = Object.keys(refreshMessages(supplement)) as (keyof TimelineRefreshMessages)[];
			for (const key of keys) {
				writeFileSync('./locales/zh-CN.yml', originalOfficial, 'utf-8');
				writeFileSync(supplementPath, JSON.stringify(supplement), 'utf-8');
				writeOfficialRefreshMessages({ [key]: '' });
				assert.equal(build()['zh-CN']._twitterUi[key], supplement._twitterUi[key]);
				await writeFrontendLocalesJson('./published', 'test-version');
				const priorChinese: string = readFileSync('./published/zh-CN.test-version.json', 'utf-8');
				writeOfficialRefreshMessages({ [key]: supplement._twitterUi[key] });
				assert.throws(/** 即使正式译文内容相同，也要求先移除该叶键补充。 */ (): void => { build(); }, /remove the fork supplement/);
				await assert.rejects(writeFrontendLocalesJson('./published', 'test-version'), /remove the fork supplement/);
				assert.equal(readFileSync('./published/zh-CN.test-version.json', 'utf-8'), priorChinese);
				const remaining: Partial<SupplementMessages['_twitterUi']> = { ...supplement._twitterUi };
				delete remaining[key];
				writeFileSync(supplementPath, JSON.stringify({ ...supplement, _twitterUi: remaining }), 'utf-8');
				const officialMessage: string = '正式中文已接管：' + key;
				writeOfficialRefreshMessages({ [key]: officialMessage });
				await writeFrontendLocalesJson('./published', 'test-version');
				assert.deepEqual(refreshMessages(published('zh-CN')), { ...refreshMessages(supplement), [key]: officialMessage });
				assert.deepEqual(published('zh-CN')._avatarDecorationCalibration, supplement._avatarDecorationCalibration);
			}
		`);
	});

	it('hands over each root title only after its fork supplement is removed', /** 根级标题同样拒绝遮蔽正式中文，空译文允许补充，单键移除后由官方资源接管。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const originalOfficial: string = readFileSync('./locales/zh-CN.yml', 'utf-8');
			const keys: readonly (keyof Pick<Locale, 'trending' | 'whoToFollow'>)[] = ['trending', 'whoToFollow'];
			for (const key of keys) {
				const official: Record<string, unknown> = loadYaml(originalOfficial) as Record<string, unknown>;
				writeFileSync(supplementPath, JSON.stringify(supplement), 'utf-8');
				official[key] = '';
				writeFileSync('./locales/zh-CN.yml', dumpYaml(official), 'utf-8');
				assert.equal(build()['zh-CN'][key], supplement[key]);
				await writeFrontendLocalesJson('./published', 'test-version');
				const priorChinese: string = readFileSync('./published/zh-CN.test-version.json', 'utf-8');
				official[key] = supplement[key];
				writeFileSync('./locales/zh-CN.yml', dumpYaml(official), 'utf-8');
				assert.throws(/** 根级同值译文也不能绕过明确移除条件。 */ (): void => { build(); }, /remove the fork supplement/);
				await assert.rejects(writeFrontendLocalesJson('./published', 'test-version'), /remove the fork supplement/);
				assert.equal(readFileSync('./published/zh-CN.test-version.json', 'utf-8'), priorChinese);
				const remaining: Partial<ForkSupplement> = { ...supplement };
				delete remaining[key];
				writeFileSync(supplementPath, JSON.stringify(remaining), 'utf-8');
				const officialMessage: string = '正式中文已接管：' + key;
				official[key] = officialMessage;
				writeFileSync('./locales/zh-CN.yml', dumpYaml(official), 'utf-8');
				await writeFrontendLocalesJson('./published', 'test-version');
				assert.equal(published('zh-CN')[key], officialMessage);
				assert.deepEqual(published('zh-CN')._twitterSearch, supplement._twitterSearch);
			}
		`);
	});

	it('rejects missing and unexpected translation placeholders before publishing', /** 数量占位符不能丢失、更名或额外增加，无参数源文案也不能被补充引入参数。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			await writeFrontendLocalesJson('./published', 'test-version');
			const priorChinese: string = readFileSync('./published/zh-CN.test-version.json', 'utf-8');
			const invalidSupplements: readonly unknown[] = [
				/** 丢失通知数量会让界面无法表达未读数。 */
				{ ...supplement, _twitterUi: { ...supplement._twitterUi, notificationsWithCount: '通知（未读）' } },
				/** 改名后的 token 与现有调用方不兼容。 */
				{ ...supplement, _twitterUi: { ...supplement._twitterUi, notificationsWithCount: '通知（{total} 条未读）' } },
				/** 多出的 token 不会由现有调用方提供。 */
				{ ...supplement, _twitterUi: { ...supplement._twitterUi, newNotesWithCount: '新帖子（{count} 条，{extra}）' } },
				/** 原本无参数的快捷文案不能要求额外参数。 */
				{ ...supplement, _twitterSearch: { ...supplement._twitterSearch, showHashtag: '查看此话题标签 {tag}' } },
				/** 根级叶子也遵守相同的参数协议。 */
				{ ...supplement, trending: '趋势 {count}' },
			];
			for (const payload of invalidSupplements) {
				writeFileSync(supplementPath, JSON.stringify(payload), 'utf-8');
				assert.throws(/** 非法占位符必须在构建阶段阻断。 */ (): void => { build(); }, /Fork zh-CN supplement has mismatched placeholders/);
				await assert.rejects(writeFrontendLocalesJson('./published', 'test-version'), /Fork zh-CN supplement has mismatched placeholders/);
				assert.equal(readFileSync('./published/zh-CN.test-version.json', 'utf-8'), priorChinese);
			}
		`);
	});

	it('rejects unsupported scopes, keys, blank translations and non-string values', /** 补充资源不能扩展到其他命名空间或未声明键，非法文件不得被作为有效译文发布。 */ async (): Promise<void> => {
		await runIsolatedPublication(`
			const invalidSupplements: readonly unknown[] = [
				/** 根节点必须是语言资源对象。 */
				null, [], '中文资源',
				/** 仅允许已经明确授权的补充命名空间。 */
				{ _initialAccountSetting: { accountCreated: '越界补充' } },
				{ _avatarDecorationCalibration: {}, unrelated: {} },
				/** 命名空间本身也必须是对象。 */
				{ _avatarDecorationCalibration: null },
				{ _avatarDecorationCalibration: [] },
				{ _avatarDecorationCalibration: '错误层级' },
				/** 叶键必须来自日文源的当前权威字段。 */
				{ _avatarDecorationCalibration: { nonexistentCalibrationKey: '未知字段' } },
				/** 混合上游区域仅放行此次迁移叶键，不能借新增命名空间扩大补充能力。 */
				{ _uploader: { editImage: '越界上传补充' } },
				{ _qr: { chooseCamera: '越界设备补充' } },
				/** 已知叶键只接受非空字符串。 */
				{ _avatarDecorationCalibration: { title: '' } },
				{ _avatarDecorationCalibration: { title: '   ' } },
				{ _avatarDecorationCalibration: { title: 1 } },
				{ _avatarDecorationCalibration: { title: false } },
				{ _avatarDecorationCalibration: { title: null } },
				{ _avatarDecorationCalibration: { title: {} } },
				/** 根级补充只允许两个已审计标题，其他真实叶子不能扩权。 */
				{ search: '越界搜索补充' },
				{ trending: '' },
				{ whoToFollow: '   ' },
				{ trending: 1 },
				{ trending: {} },
				{ whoToFollow: null },
				/** 搜索与 Twitter UI 补充只覆盖明确授权的叶键。 */
				{ _twitterSearch: { search: '越界搜索补充' } },
				{ _twitterSearch: { showHashtag: '' } },
				{ _twitterSearch: null },
				{ _twitterSearch: [] },
				{ _twitterSearch: '错误层级' },
				{ _twitterUi: { twitterView: '越界界面补充' } },
				{ _twitterUi: { nonexistentRefreshKey: '未知刷新字段' } },
				/** 刷新命名空间与翻译值沿用原有输入守卫。 */
				{ _twitterUi: null },
				{ _twitterUi: [] },
				{ _twitterUi: '错误层级' },
				{ _twitterUi: { timelineUpdated: '' } },
				{ _twitterUi: { timelineUpToDate: '   ' } },
				{ _twitterUi: { timelineRefreshFailed: 1 } },
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
