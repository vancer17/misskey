/*
 * 语言资源领域：合并各语言及其回退内容，按完整文件发布发生变化的前端语言资源。
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

function build(): Record<Language, Locale> {
	// vitestの挙動を調整するため、一度ローカル変数化する必要がある
	// https://github.com/vitest-dev/vitest/issues/3988#issuecomment-1686599577
	// https://github.com/misskey-dev/misskey/pull/14057#issuecomment-2192833785
	const metaUrl = import.meta.url;
	const locales = languages.reduce<Locales>((a, lang) => {
		a[lang] = (loadYaml(clean(fs.readFileSync(new URL(`./locales/${lang}.yml`, metaUrl), 'utf-8'))) ?? {}) as ILocale;
		return a;
	}, {} as Locales);

	removeEmpty(locales);

	return Object.entries(locales).reduce<Record<Language, Locale>>((a, [k, v]) => {
		const lang = k.split('-')[0];
		const key = k as Language;

		switch (key) {
			case 'ja-JP':
				a[key] = v as Locale;
				break;
			case 'ja-KS':
			case 'en-US':
				a[key] = merge<Locale>(locales['ja-JP'] as Locale, v);
				break;
			default: {
				const primaryLang = lang as PrimaryLang;
				const primaryKey = (lang in primaries ? `${lang}-${primaries[primaryLang]}` : undefined) as Language | undefined;
				a[key] = merge<Locale>(
					locales['ja-JP'] as Locale,
					locales['en-US'],
					primaryKey ? locales[primaryKey] : {},
					v,
				);
				break;
			}
		}

		return a;
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
