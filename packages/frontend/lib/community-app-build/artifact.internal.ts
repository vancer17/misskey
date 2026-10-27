/*
 * 社区制品装配领域：从真实 Vite 清单生成静态入口和语言索引，并校验包内文件摘要及静态依赖。
 * 所有输出只写入调用方指定的隔离构建目录；不访问运维配置或生成业务会话。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { walk } from 'oxc-walker';
import locales from 'i18n';
import { COMMUNITY_BUILD_ENTRIES } from './config.internal.js';
import type { ESTree } from 'rolldown/utils';
import type { Manifest, ManifestChunk } from 'vite';
import type { CommunityArtifactFile, CommunityArtifactManifest, CommunityRuntimeManifest } from '../../src/community-app/bootstrap/index.js';

/** 为一次已完成语言内联的真实 Vite 输出提供静态装配输入。 */
export type CommunityFinalizeOptions = Readonly<{
	outputDir: string;
	templatePath: string;
	manifest: Manifest;
	supportedLanguages: readonly string[];
	version: string;
	sourceRevision: string;
	sourceDirty: boolean;
	sourceFingerprint: string;
}>;

/** 验证制品路径不会逃逸根目录，也不会使用浏览器根地址或带查询参数的文件名。 */
function assertArtifactPath(value: string): void {
	if (value.length === 0 || value.includes('\\') || /[?#\u0000]/u.test(value) || /^[a-z][a-z\d+.-]*:/iu.test(value) || value.startsWith('/') || path.posix.normalize(value) !== value || value.startsWith('../')) {
		throw new Error(`Invalid community artifact path: ${value}`);
	}
}

/** 沿真实清单的静态和动态导入收集闭包，不根据源码字符串猜测入口。 */
function collectManifestClosure(manifest: Manifest, entry: string, includeDynamic: boolean = true): Set<string> {
	const visited: Set<string> = new Set<string>();

	/** 递归检查清单引用，缺失依赖立即阻止制品发布。 */
	function visit(key: string): void {
		if (visited.has(key)) return;
		const chunk: ManifestChunk | undefined = manifest[key];
		if (chunk === undefined) throw new Error(`Missing Vite manifest chunk: ${key}`);
		visited.add(key);
		for (const dependency of [...(chunk.imports ?? []), ...(includeDynamic ? chunk.dynamicImports ?? [] : [])]) visit(dependency);
	}

	visit(entry);
	return visited;
}

/** 将所有文件稳定排序，并拒绝链接文件或其他不能可靠打包的条目。 */
async function listPayloadFiles(outputDir: string): Promise<string[]> {
	const files: string[] = [];

	/** 递归读取当前制品根目录，不跟随任何符号链接。 */
	async function visit(directory: string): Promise<void> {
		for (const entry of await fs.readdir(path.join(outputDir, directory), { withFileTypes: true })) {
			const relative: string = directory ? `${directory}/${entry.name}` : entry.name;
			if (entry.isSymbolicLink()) throw new Error(`Community artifact cannot contain symlinks: ${relative}`);
			if (entry.isDirectory()) await visit(relative);
			else if (entry.isFile() && relative !== 'community-artifact.json') files.push(relative);
			else if (!entry.isFile()) throw new Error(`Unsupported community artifact entry: ${relative}`);
		}
	}

	await visit('');
	return files.sort();
}

/** 为实际有效载荷生成摘要，不将清单本身列入自摘要。 */
async function digestPayload(outputDir: string): Promise<CommunityArtifactFile[]> {
	const files: CommunityArtifactFile[] = [];
	for (const relative of await listPayloadFiles(outputDir)) {
		assertArtifactPath(relative);
		const content: Buffer = await fs.readFile(path.join(outputDir, relative));
		files.push({ path: relative, bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') });
	}
	return files;
}

/** 将既有语言文案安全写入 HTML 属性或文本，不插入可执行字符串。 */
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/gu, /** 转义 HTML 标点，防止语言内容改变静态结构。 */ (character: string): string => {
		switch (character) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			default: return '&#39;';
		}
	});
}

/** 按语言清单生成可复用装配对象，原始账户、实例或凭据不进入制品。 */
function createRuntimeManifest(options: CommunityFinalizeOptions, bootstrap: ManifestChunk, application: ManifestChunk, styles: readonly string[]): CommunityRuntimeManifest {
	const applications: Record<string, string> = {};
	const bootMessages: Record<string, CommunityRuntimeManifest['bootMessages'][string]> = {};
	for (const language of options.supportedLanguages) {
		const locale: typeof locales[string] | undefined = locales[language];
		if (locale === undefined) throw new Error(`Unsupported community build language: ${language}`);
		if (!application.file.startsWith('scripts/')) throw new Error('Community application must use the locale inliner scripts directory.');
		applications[language] = `${language}/${application.file.slice('scripts/'.length)}`;
		bootMessages[language] = {
			waitingHost: locale.loading,
			sessionRequired: locale.signinRequired,
			failed: locale.failedToFetchAccountInformation,
		};
	}
	return {
		formatVersion: 1,
		bootstrap: bootstrap.file,
		application: applications,
		styles,
		supportedLanguages: [...options.supportedLanguages],
		bootMessages,
		sourceRevision: options.sourceRevision,
		sourceDirty: options.sourceDirty,
		sourceFingerprint: options.sourceFingerprint,
		version: options.version,
	};
}

/** 装配 HTML、清理不可执行的原始入口并生成真实有效载荷清单。 */
export async function finalizeCommunityApp(options: CommunityFinalizeOptions): Promise<CommunityArtifactManifest> {
	const bootstrapKey: string = COMMUNITY_BUILD_ENTRIES.bootstrap.slice(2);
	const applicationKey: string = COMMUNITY_BUILD_ENTRIES.application.slice(2);
	const bootstrap: ManifestChunk | undefined = options.manifest[bootstrapKey];
	const application: ManifestChunk | undefined = options.manifest[applicationKey];
	if (bootstrap === undefined || application === undefined) throw new Error('Community bootstrap and application entries must be present.');
	const bootstrapClosure: Set<string> = collectManifestClosure(options.manifest, bootstrapKey);
	if (bootstrapClosure.has(applicationKey) || bootstrapClosure.has(COMMUNITY_BUILD_ENTRIES.i18n.slice(2))) {
		throw new Error('Community bootstrap must not import the application or i18n entry.');
	}
	const staticStyleClosure: Set<string> = new Set([
		...collectManifestClosure(options.manifest, bootstrapKey, false),
		...collectManifestClosure(options.manifest, applicationKey, false),
	]);
	const styles: string[] = [...new Set([...staticStyleClosure].flatMap(/** 只预载入口静态 CSS，异步路由仍由 Vite 按需加载。 */ (key: string): string[] => options.manifest[key].css ?? []))].sort();
	const retainedRawScripts: Set<string> = new Set([...bootstrapClosure].map(/** 保留最小 Bootstrap 的真实代码依赖。 */ (key: string): string => options.manifest[key].file));
	for (const chunk of Object.values(options.manifest)) {
		if (chunk.file.startsWith('scripts/') && chunk.file.endsWith('.js') && !retainedRawScripts.has(chunk.file)) {
			await fs.rm(path.join(options.outputDir, chunk.file));
		}
	}
	await fs.rm(path.join(options.outputDir, 'manifest.json'), { force: true });
	const runtime: CommunityRuntimeManifest = createRuntimeManifest(options, bootstrap, application, styles);
	const defaultMessages: CommunityRuntimeManifest['bootMessages'][string] = runtime.bootMessages['zh-CN'] ?? runtime.bootMessages[runtime.supportedLanguages[0]];
	if (defaultMessages === undefined) throw new Error('Community build must contain at least one language.');
	const replacements: Readonly<Record<string, string>> = {
		/** 最小启动脚本，不指向任何语言应用入口。 */
		__COMMUNITY_BOOTSTRAP__: './' + runtime.bootstrap,
		/** 真实构建的本地 CSS。 */
		__COMMUNITY_STYLES__: styles.map(/** 为每份 CSS 生成本地引用。 */ (file: string): string => `<link rel="stylesheet" href="./${escapeHtml(file)}">`).join('\n\t\t'),
		/** 等待宿主时使用原有 loading 文案。 */
		__COMMUNITY_LOADING_LABEL__: escapeHtml(defaultMessages.waitingHost),
		/** 等待真实会话时使用原有文案。 */
		__COMMUNITY_SESSION_LABEL__: escapeHtml(defaultMessages.sessionRequired),
		/** 启动失败时使用原有文案。 */
		__COMMUNITY_FAILED_LABEL__: escapeHtml(defaultMessages.failed),
		/** 仅包含已有启动标签，供轻量 Bootstrap 切换语言而不请求业务语言单例。 */
		__COMMUNITY_BOOT_MESSAGES__: JSON.stringify(runtime.bootMessages).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029'),
	};
	let html: string = await fs.readFile(options.templatePath, 'utf8');
	for (const [token, value] of Object.entries(replacements)) {
		if (!html.includes(token)) throw new Error(`Missing community HTML template token: ${token}`);
		html = html.replaceAll(token, value);
	}
	await fs.writeFile(path.join(options.outputDir, 'index.html'), html, 'utf8');
	const artifact: CommunityArtifactManifest = { ...runtime, files: await digestPayload(options.outputDir) };
	await fs.writeFile(path.join(options.outputDir, 'community-artifact.json'), JSON.stringify(artifact, null, '\t') + '\n', 'utf8');
	try {
		return await verifyCommunityArtifact(options.outputDir);
	} catch (error: unknown) {
		await fs.rm(path.join(options.outputDir, 'community-artifact.json'), { force: true });
		throw error;
	}
}

/** 检查解析值是普通记录，避免依赖 JSON 强制类型转换掩盖损坏的清单。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 验证文件清单的结构后沿唯一 Bootstrap 权威类型返回。 */
function parseArtifact(content: string): CommunityArtifactManifest {
	const parsed: unknown = JSON.parse(content);
	if (!isRecord(parsed) || parsed.formatVersion !== 1 || typeof parsed.bootstrap !== 'string' || !isRecord(parsed.application) || !Array.isArray(parsed.styles) || !Array.isArray(parsed.supportedLanguages) || !isRecord(parsed.bootMessages) || typeof parsed.sourceRevision !== 'string' || typeof parsed.sourceDirty !== 'boolean' || typeof parsed.sourceFingerprint !== 'string' || !/^[a-f\d]{64}$/u.test(parsed.sourceFingerprint) || typeof parsed.version !== 'string' || !Array.isArray(parsed.files)) {
		throw new Error('Invalid community artifact manifest.');
	}
	const supportedLanguages: unknown[] = parsed.supportedLanguages;
	const fileRecords: unknown[] = parsed.files;
	const manifestStrings: unknown[] = [...parsed.styles, ...supportedLanguages, ...Object.values(parsed.application)];
	for (const value of manifestStrings) {
		if (typeof value !== 'string') throw new Error('Invalid community manifest string field.');
	}
	if (parsed.supportedLanguages.length === 0 || new Set(parsed.supportedLanguages).size !== parsed.supportedLanguages.length) throw new Error('Community supported languages must be nonempty and unique.');
	for (const language of supportedLanguages) {
		if (typeof language !== 'string' || !(language in parsed.application)) throw new Error('Missing community language entry.');
		const messages: unknown = parsed.bootMessages[language];
		if (!isRecord(messages) || typeof messages.waitingHost !== 'string' || typeof messages.sessionRequired !== 'string' || typeof messages.failed !== 'string') throw new Error('Invalid community bootstrap messages.');
	}
	for (const file of fileRecords) {
		if (!isRecord(file) || typeof file.path !== 'string' || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(file.sha256)) throw new Error('Invalid community artifact file record.');
		assertArtifactPath(file.path);
	}
	return parsed as CommunityArtifactManifest;
}

/** 解析构建资源引用，仅 data/blob 是无需包内文件的内联资源。 */
function resolveReference(from: string, reference: string, files: ReadonlySet<string>): void {
	if (/^(?:data:|blob:|#)/u.test(reference)) return;
	if (/^(?:[a-z][a-z\d+.-]*:|\/)/iu.test(reference)) throw new Error(`Community static dependency must be local: ${from} -> ${reference}`);
	const withoutQuery: string = reference.split(/[?#]/u)[0];
	if (withoutQuery.length === 0) return;
	const resolved: string = path.posix.normalize(path.posix.join(path.posix.dirname(from), withoutQuery));
	assertArtifactPath(resolved);
	if (!files.has(resolved)) throw new Error(`Missing community static dependency: ${from} -> ${reference}`);
}

/** 按 Vite 生成器的声明与参数绑定定位预加载依赖表，不将任意业务字符串视为资源。 */
function verifyVitePreloadDependencies(file: string, declaration: ESTree.VariableDeclarator, files: ReadonlySet<string>): void {
	if (declaration.id.type !== 'Identifier' || declaration.id.name !== '__vite__mapDeps') return;
	const initializer: ESTree.VariableDeclarator['init'] = declaration.init;
	if (initializer?.type !== 'ArrowFunctionExpression') throw new Error(`Unsupported Vite preload helper: ${file}`);
	const cacheParameter: ESTree.ParamPattern | undefined = initializer.params[1];
	if (cacheParameter?.type !== 'AssignmentPattern' || cacheParameter.left.type !== 'Identifier' || cacheParameter.right.type !== 'Identifier' || cacheParameter.right.name !== declaration.id.name) {
		throw new Error(`Unsupported Vite preload cache binding: ${file}`);
	}
	const cacheName: string = cacheParameter.left.name;
	let dependencyTableFound: boolean = false;
	walk(initializer, {
		/** 仅匹配已绑定缓存参数的 .f 数组赋值，这是 Vite 预加载索引实际消费的表。 */
		enter(node: ESTree.Node): void {
			if (node.type !== 'AssignmentExpression' || node.operator !== '=' || node.left.type !== 'MemberExpression' || node.left.computed || node.left.object.type !== 'Identifier' || node.left.object.name !== cacheName || node.left.property.type !== 'Identifier' || node.left.property.name !== 'f') return;
			if (node.right.type !== 'ArrayExpression') throw new Error(`Unsupported Vite preload dependency table: ${file}`);
			dependencyTableFound = true;
			for (const dependency of node.right.elements) {
				if (dependency?.type !== 'Literal' || typeof dependency.value !== 'string') throw new Error(`Nonliteral Vite preload dependency: ${file}`);
				resolveReference(file, dependency.value, files);
			}
		},
	});
	if (!dependencyTableFound) throw new Error(`Missing Vite preload dependency table: ${file}`);
}

/** 检查 ES 模块静态/动态导入和 Vite URL 资产，不将业务内容 URL 当作代码资源。 */
function verifyScriptReferences(file: string, source: string, files: ReadonlySet<string>): void {
	const program: ESTree.Program = parseAst(source);
	walk(program, {
		/** 仅校验语法上实际用作模块或资源的字面量，不扫描任意字符串。 */
		enter(node: ESTree.Node): void {
			if (node.type === 'VariableDeclarator') {
				verifyVitePreloadDependencies(file, node, files);
			} else if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') {
				if (node.source !== null && typeof node.source.value === 'string') resolveReference(file, node.source.value, files);
			} else if (node.type === 'ImportExpression' && node.source.type === 'Literal' && typeof node.source.value === 'string') {
				resolveReference(file, node.source.value, files);
			} else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && node.arguments.length === 2) {
				const argument: ESTree.Expression | ESTree.SpreadElement = node.arguments[0];
				const base: ESTree.Expression | ESTree.SpreadElement = node.arguments[1];
				if (argument.type === 'Literal' && typeof argument.value === 'string' && base.type === 'MemberExpression' && base.object.type === 'MetaProperty') resolveReference(file, argument.value, files);
			}
		},
	});
}

/** 校验最终文件集合、入口、摘要和实际静态引用，供构建与 App 装配命令共同使用。 */
export async function verifyCommunityArtifact(outputDir: string): Promise<CommunityArtifactManifest> {
	const artifact: CommunityArtifactManifest = parseArtifact(await fs.readFile(path.join(outputDir, 'community-artifact.json'), 'utf8'));
	const actual: CommunityArtifactFile[] = await digestPayload(outputDir);
	if (JSON.stringify(actual) !== JSON.stringify(artifact.files)) throw new Error('Community artifact payload or digest does not match its manifest.');
	const files: Set<string> = new Set(actual.map(/** 从已验证载荷建立静态引用索引。 */ (file: CommunityArtifactFile): string => file.path));
	for (const entry of [artifact.bootstrap, ...Object.values(artifact.application), ...artifact.styles, 'index.html']) {
		assertArtifactPath(entry);
		if (!files.has(entry)) throw new Error(`Missing community artifact entry: ${entry}`);
	}
	for (const file of actual) {
		if (!/\.(?:js|mjs|css|html)$/u.test(file.path)) continue;
		const source: string = await fs.readFile(path.join(outputDir, file.path), 'utf8');
		if (/\/(?:vite\/|assets\/locales\/)/u.test(source)) throw new Error(`Legacy frontend root dependency remains: ${file.path}`);
		if (/\.(?:js|mjs)$/u.test(file.path)) verifyScriptReferences(file.path, source, files);
		if (file.path.endsWith('.css')) {
			for (const match of source.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/gu)) resolveReference(file.path, match[1], files);
		} else if (file.path.endsWith('.html')) {
			for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) resolveReference(file.path, match[1], files);
		}
	}
	return artifact;
}
