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

/** 根级中文仅补右栏标题；此键表同时约束权威类型投影与运行时读取。 */
const forkChineseRootKeys = {
	/** 右栏热门话题区域的标题。 */
	trending: true,
	/** 右栏推荐账户区域的标题。 */
	whoToFollow: true,
} as const satisfies Readonly<Partial<Record<keyof Locale, true>>>;

/** 搜索快捷入口只补三个当前缺失的提示，不开放整个搜索语言区域。 */
const twitterSearchChineseKeys = {
	/** 将当前搜索词作为链接查询的入口提示。 */
	lookupUrl: true,
	/** 打开匹配账户的入口提示。 */
	showUser: true,
	/** 打开匹配话题标签的入口提示。 */
	showHashtag: true,
} as const satisfies Readonly<Partial<Record<keyof Locale['_twitterSearch'], true>>>;

/** Twitter 中文仅补已确认缺失的导航、刷新和定时发布文案。 */
const twitterUiChineseKeys = {
	/** 主导航区域的无障碍名称。 */
	primaryNavigation: true,
	/** 带未读数量的通知入口名称。 */
	notificationsWithCount: true,
	/** 带数量的新帖子加载入口名称。 */
	newNotesWithCount: true,
	/** 已取得新帖子时的完成提示。 */
	timelineUpdated: true,
	/** 检查成功但没有新帖子时的轻量提示。 */
	timelineUpToDate: true,
	/** 检查失败时的重试提示。 */
	timelineRefreshFailed: true,
	/** 定时发布表单中的日期字段名称。 */
	scheduleDate: true,
	/** 定时发布表单中的时间字段名称。 */
	scheduleTime: true,
	/** 日期选择器切换至上个月的按钮名称。 */
	previousMonth: true,
	/** 日期选择器切换至下个月的按钮名称。 */
	nextMonth: true,
	/** 定时发布时间已经过去时的校验提示。 */
	scheduleTimeIsInThePast: true,
} as const satisfies Readonly<Partial<Record<keyof Locale['_twitterUi'], true>>>;

/** 混合上游上传区域只补此次迁移的视频压缩提示，不开放其他字段。 */
const uploaderChineseKeys = {
	/** 压缩无法安全完成时说明继续使用原视频。 */
	videoCompressionFallback: true,
} as const satisfies Readonly<Partial<Record<keyof Locale['_uploader'], true>>>;

/** 混合上游二维码区域只补当前缺少正式译文的展示与扫描提示。 */
const qrChineseKeys = {
	/** 个人资料二维码的展示说明。 */
	showDescription: true,
	/** 摄像头与图片两种扫描入口的说明。 */
	scanDescription: true,
	/** 摄像头启动过程中的权限引导。 */
	cameraStarting: true,
	/** 摄像头暂停后的继续操作提示。 */
	cameraStopped: true,
	/** 非安全访问地址下的摄像头限制说明。 */
	cameraInsecure: true,
	/** 浏览器缺少摄像头能力时的替代入口说明。 */
	cameraUnavailable: true,
	/** 摄像头权限未获批准时的恢复提示。 */
	cameraPermissionDenied: true,
	/** 未检测到摄像头时的恢复提示。 */
	cameraNotFound: true,
	/** 摄像头无法读取时的占用检查提示。 */
	cameraNotReadable: true,
	/** 设备约束无法满足时的重新选择提示。 */
	cameraConstraints: true,
	/** 未分类的摄像头启动失败提示。 */
	cameraUnknown: true,
	/** 无设备名称时的摄像头编号标签。 */
	cameraNumber: true,
	/** 闪光灯切换失败但仍可扫描的反馈。 */
	flashFailed: true,
	/** 图片二维码识别失败时的恢复提示。 */
	scanFailed: true,
	/** 摄像头不可用状态的标题。 */
	cameraUnavailableTitle: true,
	/** 摄像头暂停状态的标题。 */
	cameraPausedTitle: true,
	/** 摄像头启动状态的标题。 */
	cameraStartingTitle: true,
	/** 仅一个摄像头可选时的设备说明。 */
	cameraSingle: true,
	/** 摄像头列表读取失败时的恢复提示。 */
	cameraListUnavailable: true,
	/** 设备检测进行中的提示。 */
	cameraDetecting: true,
	/** 重新检测设备的操作名称。 */
	refreshCameras: true,
	/** 重试摄像头的操作名称。 */
	retryCamera: true,
	/** 图片识别进行中的提示。 */
	imageProcessing: true,
	/** 二维码内容查询进行中的提示。 */
	resultProcessing: true,
	/** 二维码结果中没有用户的空态。 */
	noUsers: true,
	/** 二维码结果中没有帖子的空态。 */
	noNotes: true,
} as const satisfies Readonly<Partial<Record<keyof Locale['_qr'], true>>>;

/** fork 明确允许补充的业务区域，所有字段均从现有日文权威类型派生。 */
type ForkChineseNamespaces = Pick<Locale, '_avatarDecorationCalibration' | '_channel' | '_twitterMessages' | '_avatarDecorationSettings' | '_avatarDecorationManager'> & {
	_uploader: Pick<Locale['_uploader'], keyof typeof uploaderChineseKeys>;
	_qr: Pick<Locale['_qr'], keyof typeof qrChineseKeys>;
	_twitterSearch: Pick<Locale['_twitterSearch'], keyof typeof twitterSearchChineseKeys>;
	_twitterUi: Pick<Locale['_twitterUi'], keyof typeof twitterUiChineseKeys>;
};

/** 根叶子与各允许区域只补尚未进入正式中文资源的键，不复制完整语言模型。 */
type ForkChineseSupplement = Partial<Pick<Locale, keyof typeof forkChineseRootKeys>> & {
	[Namespace in keyof ForkChineseNamespaces]?: Partial<ForkChineseNamespaces[Namespace]>;
};

/** 补充范围保持显式白名单，避免任意业务区域意外绕过原生回退。 */
const forkChineseNamespaces = {
	/** 视频压缩失败后使用原文件的既有上传提示。 */
	_uploader: true,
	/** 二维码展示、设备访问与扫描状态的既有中文文案。 */
	_qr: true,
	/** 头像挂件试戴、保存及权限反馈的既有中文文案。 */
	_avatarDecorationSettings: true,
	/** 头像挂件管理、素材上传及目录反馈的既有中文文案。 */
	_avatarDecorationManager: true,
	/** 头像挂件素材校准的本地业务文案。 */
	_avatarDecorationCalibration: true,
	/** 频道搜索、资料库空态与加载结束文案。 */
	_channel: true,
	/** 搜索快捷入口提示，叶子键另受白名单约束。 */
	_twitterSearch: true,
	/** Twitter 导航、刷新和定时发布提示，叶子键另受白名单约束。 */
	_twitterUi: true,
	/** 新私信工作区的 fork 自有文案；正式中文接管对应键后移除补充。 */
	_twitterMessages: true,
} as const satisfies Readonly<Record<keyof ForkChineseNamespaces, true>>;

/** 判断外部 JSON 是否为普通对象，避免数组、空值或标量被当作翻译字典。 */
function isLocaleRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验单个补充叶子及其占位符，确保补充与日文权威文案协议一致且不遮蔽正式中文。 */
function validateForkChineseValue(path: string, source: unknown, value: unknown, hasOfficialChinese: boolean): string {
	if (typeof source !== 'string') throw new Error(`Fork zh-CN supplement has unknown key: ${path}`);
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Fork zh-CN ${path} must be a nonempty string.`);
	if (hasOfficialChinese) throw new Error(`Official zh-CN already contains ${path}; remove the fork supplement for this key.`);

	const expectedParameters: ReadonlySet<string> = new Set<string>(source.match(/\{[^}]+\}/g) ?? []);
	const actualParameters: ReadonlySet<string> = new Set<string>(value.match(/\{[^}]+\}/g) ?? []);
	if (expectedParameters.size !== actualParameters.size) throw new Error(`Fork zh-CN supplement has mismatched placeholders: ${path}`);
	for (const parameter of expectedParameters) {
		if (!actualParameters.has(parameter)) throw new Error(`Fork zh-CN supplement has mismatched placeholders: ${path}`);
	}
	return value;
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
		if (Object.hasOwn(forkChineseRootKeys, rawNamespace)) {
			const rootKey: keyof typeof forkChineseRootKeys = rawNamespace as keyof typeof forkChineseRootKeys;
			supplement[rootKey] = validateForkChineseValue(rootKey, rawLocales['ja-JP'][rootKey], section, Object.hasOwn(rawLocales['zh-CN'], rootKey));
			continue;
		}
		if (!Object.hasOwn(forkChineseNamespaces, rawNamespace)) throw new Error(`Fork zh-CN supplement has unsupported namespace: ${rawNamespace}`);
		const namespace: keyof ForkChineseNamespaces = rawNamespace as keyof ForkChineseNamespaces;
		if (!isLocaleRecord(section)) throw new Error(`Fork zh-CN ${namespace} must be an object.`);
		const source: unknown = rawLocales['ja-JP'][namespace];
		if (!isLocaleRecord(source)) throw new Error(`Fork zh-CN source namespace is missing: ${namespace}`);
		const nativeChinese: unknown = rawLocales['zh-CN'][namespace];
		const sectionSupplement: Record<string, string> = {};
		for (const [key, value] of Object.entries(section)) {
			if (namespace === '_uploader' && !Object.hasOwn(uploaderChineseKeys, key)) throw new Error(`Fork zh-CN supplement has unsupported key: ${namespace}.${key}`);
			if (namespace === '_qr' && !Object.hasOwn(qrChineseKeys, key)) throw new Error(`Fork zh-CN supplement has unsupported key: ${namespace}.${key}`);
			if (namespace === '_twitterSearch' && !Object.hasOwn(twitterSearchChineseKeys, key)) throw new Error(`Fork zh-CN supplement has unsupported key: ${namespace}.${key}`);
			if (namespace === '_twitterUi' && !Object.hasOwn(twitterUiChineseKeys, key)) throw new Error(`Fork zh-CN supplement has unsupported key: ${namespace}.${key}`);
			if (!Object.hasOwn(source, key)) throw new Error(`Fork zh-CN supplement has unknown key: ${namespace}.${key}`);
			sectionSupplement[key] = validateForkChineseValue(`${namespace}.${key}`, source[key], value, isLocaleRecord(nativeChinese) && Object.hasOwn(nativeChinese, key));
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
