/*
 * 语言资源领域：合并上游语言、原生回退与 fork 专属中文补充，发布前端共享语言资源。
 * fork 补充在构建期校验和读取，不覆盖 Crowdin 原始文件，也不进入组件或运行时配置。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Languages Loader
 */

import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { languages, primaries } from './const.js';
import type { Locale } from './autogen/locale.js';
import type { ILocale, ParameterizedString } from './types.js';

type Language = typeof languages[number];

type PrimaryLang = keyof typeof primaries;

type Locales = Record<Language, ILocale>;

/** 时间线手动刷新只补充三个结果提示；此键表同时约束类型投影与运行时校验。 */
const twitterRefreshChineseKeys = {
	/** 已取得新帖子时的完成提示。 */
	timelineUpdated: true,
	/** 检查成功但没有新帖子时的轻量提示。 */
	timelineUpToDate: true,
	/** 检查失败时的重试提示。 */
	timelineRefreshFailed: true,
} as const satisfies Readonly<Partial<Record<keyof Locale['_twitterUi'], true>>>;

/** fork 明确允许补充的业务区域，刷新提示仅从日文权威类型派生获准的三个叶子键。 */
type ForkChineseNamespaces = Pick<Locale, '_avatarDecorationCalibration' | '_channel'> & {
	_twitterUi: Pick<Locale['_twitterUi'], keyof typeof twitterRefreshChineseKeys>;
};

/** 每个允许区域只补尚未进入正式中文资源的叶子键，不复制完整语言模型。 */
type ForkChineseSupplement = { [Namespace in keyof ForkChineseNamespaces]?: Partial<ForkChineseNamespaces[Namespace]> };

/** 补充范围保持显式白名单，避免任意业务区域意外绕过原生回退。 */
const forkChineseNamespaces = {
	/** 头像挂件素材校准的本地业务文案。 */
	_avatarDecorationCalibration: true,
	/** 频道资料库的空态与加载结束文案。 */
	_channel: true,
	/** 时间线手动刷新的三个结果提示，叶子键另受白名单约束。 */
	_twitterUi: true,
} as const satisfies Readonly<Record<keyof ForkChineseNamespaces, true>>;

/** 判断外部 JSON 是否为普通对象，避免数组、空值或标量被当作翻译字典。 */
function isLocaleRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读取 fork 自有的中文补充，只补当前日文源存在而正式中文尚未提供的叶子键。
 * 每次构建重新读取原始字节，避免常驻开发进程的 ESM 缓存冻结翻译；删除文件即回到原生回退。
 */
function loadForkChineseSupplement(rawLocales: Locales, moduleUrl: string): ForkChineseSupplement {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(new URL('./resources/fork/zh-CN.json', moduleUrl), 'utf-8'));
	} catch (error: unknown) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
		throw error;
	}
	if (!isLocaleRecord(parsed)) throw new Error('Fork zh-CN supplement must be an object.');
	const supplement: ForkChineseSupplement = {};
	for (const [rawNamespace, section] of Object.entries(parsed)) {
		if (!Object.hasOwn(forkChineseNamespaces, rawNamespace)) throw new Error(`Fork zh-CN supplement has unsupported namespace: ${rawNamespace}`);
		const namespace: keyof ForkChineseNamespaces = rawNamespace as keyof ForkChineseNamespaces;
		if (!isLocaleRecord(section)) throw new Error(`Fork zh-CN ${namespace} must be an object.`);
		const source: unknown = rawLocales['ja-JP'][namespace];
		if (!isLocaleRecord(source)) throw new Error(`Fork zh-CN source namespace is missing: ${namespace}`);
		const nativeChinese: unknown = rawLocales['zh-CN'][namespace];
		const sectionSupplement: Record<string, string> = {};
		for (const [key, value] of Object.entries(section)) {
			if (namespace === '_twitterUi' && !Object.hasOwn(twitterRefreshChineseKeys, key)) throw new Error(`Fork zh-CN supplement has unsupported key: ${namespace}.${key}`);
			if (!Object.hasOwn(source, key) || typeof source[key] !== 'string') throw new Error(`Fork zh-CN supplement has unknown key: ${namespace}.${key}`);
			if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Fork zh-CN ${namespace}.${key} must be a nonempty string.`);
			if (isLocaleRecord(nativeChinese) && Object.hasOwn(nativeChinese, key)) {
				throw new Error(`Official zh-CN already contains ${namespace}.${key}; remove the fork supplement for this key.`);
			}
			sectionSupplement[key] = value;
		}
		supplement[namespace] = sectionSupplement;
	}
	return supplement;
}

/**
 * オブジェクトを再帰的にマージする
 */
function merge<T extends ILocale>(...args: (T | ILocale | undefined)[]): T {
	return args.reduce<ILocale>((a, c) => ({
		...a,
		...c,
		...Object.entries(a)
			.filter(([k]) => c && typeof c[k] === 'object')
			.reduce<Record<string, ILocale[string]>>((acc, [k, v]) => {
				acc[k] = merge(v as ILocale, (c as ILocale)[k] as ILocale);
				return acc;
			}, {}),
	}), {} as ILocale) as T;
}

/**
 * 何故か文字列にバックスペース文字が混入することがあり、YAMLが壊れるので取り除く
 */
function clean (text: string) {
	return text.replace(new RegExp(String.fromCodePoint(0x08), 'g'), '');
}

/**
 * 空文字列が入ることがあり、フォールバックが動作しなくなるのでプロパティごと消す
 */
function removeEmpty<T extends ILocale>(obj: T): T {
	for (const [k, v] of Object.entries(obj)) {
		if (v === '') {
			delete obj[k];
		} else if (typeof v === 'object') {
			removeEmpty(v as ILocale);
		}
	}
	return obj;
}

/** 仅为 zh-CN 的目标副本添加已验证补充，再沿用原生回退链；其他语言继续继承原始资源。 */
function build(): Record<Language, Locale> {
	// vitestの挙動を調整するため、一度ローカル変数化する必要がある
	// https://github.com/vitest-dev/vitest/issues/3988#issuecomment-1686599577
	// https://github.com/misskey-dev/misskey/pull/14057#issuecomment-2192833785
	const metaUrl: string = import.meta.url;
	const rawLocales: Locales = languages.reduce<Locales>(
		/** 原始语言仍由现有 YAML 入口读取，不把合并结果作为正式翻译来源。 */
		(all: Locales, lang: Language): Locales => {
			all[lang] = (loadYaml(clean(fs.readFileSync(new URL(`./locales/${lang}.yml`, metaUrl), 'utf-8'))) ?? {}) as ILocale;
			return all;
		}, {} as Locales,
	);

	removeEmpty(rawLocales);
	const forkChinese: ForkChineseSupplement = loadForkChineseSupplement(rawLocales, metaUrl);

	return Object.entries(rawLocales).reduce<Record<Language, Locale>>(/** 保持各语言原有继承顺序，补充不会流入英文、日文或繁体中文。 */ (all: Record<Language, Locale>, [language, value]: [string, ILocale]): Record<Language, Locale> => {
		const lang: string = language.split('-')[0];
		const key: Language = language as Language;
		/** 中文目标独享补充；不修改 rawLocales，避免 primaries.zh=CN 将 fork 文案传给繁体中文。 */
		const target: ILocale = key === 'zh-CN' ? merge<ILocale>(value, forkChinese as ILocale) : value;

		switch (key) {
			case 'ja-JP':
				all[key] = value as Locale;
				break;
			case 'ja-KS':
			case 'en-US':
				all[key] = merge<Locale>(rawLocales['ja-JP'] as Locale, value);
				break;
			default: {
				const primaryLang: PrimaryLang = lang as PrimaryLang;
				const primaryKey: Language | undefined = (lang in primaries ? `${lang}-${primaries[primaryLang]}` : undefined) as Language | undefined;
				all[key] = merge<Locale>(
					rawLocales['ja-JP'] as Locale,
					rawLocales['en-US'],
					primaryKey ? rawLocales[primaryKey] : {},
					target,
				);
				break;
			}
		}

		return all;
	}, {} as Record<Language, Locale>);
}

const locales = build() as {
	[lang: string]: Locale;
};

/**
 * 将合并后的语言快照发布为前端与 Service Worker 消费的 JSON，仅替换内容发生变化的资源。
 * 取得快照后的比较与原子替换不让出执行权，避免同一构建进程的旧快照晚于新快照发布。
 * @param destDir 前端语言资源的输出目录。
 * @param version 文件名与语言资源中使用的应用版本。
 */
async function writeFrontendLocalesJson(destDir: string, version: string): Promise<void> {
	await fs.promises.mkdir(destDir, { recursive: true });
	const builtLocales: Record<Language, Locale> = build();

	for (const [lang, locale] of Object.entries(builtLocales)) {
		const filePath: string = resolve(destDir, `${lang}.${version}.json`);
		const content: string = JSON.stringify({
			...locale,
			// 与资源 URL 使用同一应用版本，不另设语言协议版本。
			_version_: version,
		});
		try {
			if (fs.readFileSync(filePath, 'utf-8') === content) continue;
		} catch (error: unknown) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
		}

		const temporaryPath: string = `${filePath}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temporaryPath, content, { encoding: 'utf-8', flag: 'wx' });
			// 同目录原子替换后，监听器与 HTTP 读取者只能取得完整的旧文件或新文件。
			fs.renameSync(temporaryPath, filePath);
		} finally {
			fs.rmSync(temporaryPath, { force: true });
		}
	}
}

export { locales, languages, build, writeFrontendLocalesJson };
export type { Language, Locale, ILocale, ParameterizedString };
export default locales;
