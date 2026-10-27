/*
 * 社区构建验收测试：使用隔离文件树证明装配、摘要和资源闭包拒绝真实失败路径。
 * 不创建账户、模拟业务行为或将单次验收结果写入源码目录。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMUNITY_BUILD_LANGUAGES, createCommunityClosedGraphPlugin, finalizeCommunityApp, verifyCommunityArtifact } from '../../lib/community-app-build/index.js';
import { createCommunityStorageScopePlugin } from '../../vite.community-app.config.js';
import type { Manifest } from 'vite';
import type { Plugin, TransformResult } from 'vite';
import type { CommunityArtifactManifest } from '../../src/community-app/bootstrap/index.js';
import type { NormalizedOutputOptions, OutputBundle } from 'rolldown';

/** 本组测试创建的临时目录，在每个用例结束后释放。 */
const temporaryDirectories: string[] = [];

/** 描述构建协议夹具，不复制社区业务模型。 */
type BuildFixture = Readonly<{
	outputDir: string;
	manifest: Manifest;
}>;

/** 写入真实文件及 Vite 形状的清单，以测试包内依赖和摘要校验。 */
async function createFixture(applicationCode: string = 'import "./shared.js"; new URL("../assets/logo.svg", import.meta.url);'): Promise<BuildFixture> {
	const outputDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'community-build-'));
	temporaryDirectories.push(outputDir);
	await fs.mkdir(path.join(outputDir, 'scripts'));
	await fs.mkdir(path.join(outputDir, 'assets'));
	await fs.writeFile(path.join(outputDir, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
	await fs.writeFile(path.join(outputDir, 'assets/font.woff2'), 'font');
	await fs.writeFile(path.join(outputDir, 'assets/style.css'), '@font-face{src:url("./font.woff2")}');
	await fs.writeFile(path.join(outputDir, 'scripts/bootstrap.js'), 'export const phase = "WAITING_HOST";');
	await fs.writeFile(path.join(outputDir, 'scripts/application.js'), 'export const rawApplication = true;');
	await fs.writeFile(path.join(outputDir, 'scripts/shared.js'), 'export const shared = true;');
	await fs.writeFile(path.join(outputDir, 'scripts/i18n.js'), 'await window.fetch(`/assets/locales/${lang}.${version}.json`);');
	for (const language of COMMUNITY_BUILD_LANGUAGES) {
		await fs.mkdir(path.join(outputDir, language));
		await fs.writeFile(path.join(outputDir, language, 'application.js'), applicationCode);
		await fs.writeFile(path.join(outputDir, language, 'shared.js'), 'export const shared = true;');
	}
	const manifest: Manifest = {
		'src/community-app/bootstrap/entry.ts': { file: 'scripts/bootstrap.js', isEntry: true },
		'src/community-app/application.ts': { file: 'scripts/application.js', isEntry: true, imports: ['_shared.js'], css: ['assets/style.css'] },
		'src/i18n.ts': { file: 'scripts/i18n.js', isEntry: true },
		'_shared.js': { file: 'scripts/shared.js' },
	};
	await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest));
	return { outputDir, manifest };
}

/** 使用正式 HTML 模板和唯一语言列表完成夹具装配。 */
async function finalizeFixture(fixture: BuildFixture): Promise<CommunityArtifactManifest> {
	return finalizeCommunityApp({
		...fixture,
		templatePath: path.resolve(import.meta.dirname, '../../community-app.html'),
		supportedLanguages: COMMUNITY_BUILD_LANGUAGES,
		version: 'test-version',
		sourceRevision: 'test-revision',
		sourceDirty: false,
		sourceFingerprint: 'a'.repeat(64),
	});
}

/** 调用真实编译插件，仅为不依赖插件上下文的变换提供最小测试上下文。 */
async function transformScopedSource(source: string, relative: string): Promise<TransformResult | null> {
	const plugin: Plugin = createCommunityStorageScopePlugin();
	const handler: Plugin['transform'] = plugin.transform;
	if (typeof handler !== 'function') throw new Error('Expected community storage transform hook.');
	const transformed: Awaited<ReturnType<typeof handler>> = await handler.call({} as never, source, path.resolve(import.meta.dirname, '../..', relative), { moduleType: 'ts' });
	if (transformed === null || transformed === undefined) return null;
	if (typeof transformed === 'string') return { code: transformed, map: null };
	return { code: transformed.code ?? source, map: transformed.map ?? null } as TransformResult;
}

/** 调用真实输出图检查钩子，以最小构建协议夹具验证非法边界会被阻止。 */
function verifyOutputGraph(bundle: OutputBundle): void {
	const plugin: Plugin = createCommunityClosedGraphPlugin('/frontend');
	const handler: Plugin['generateBundle'] = plugin.generateBundle;
	if (typeof handler !== 'function') throw new Error('Expected community output graph hook.');
	handler.call({} as never, {} as NormalizedOutputOptions, bundle, false);
}

afterEach(/** 删除全部夹具文件，不保留测试结论产物。 */ async (): Promise<void> => {
	for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe('社区静态制品装配与闭包', /** 覆盖真实文件层面的成功、篡改和缺失行为。 */ (): void => {
	it('仅从 HTML 执行最小 Bootstrap，应用入口使用包内语言路径', /** 确保原始应用和语言网络加载器不会随 HTML 启动。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture();
		const artifact: CommunityArtifactManifest = await finalizeFixture(fixture);
		const html: string = await fs.readFile(path.join(fixture.outputDir, 'index.html'), 'utf8');
		expect(html).toContain('src="./scripts/bootstrap.js"');
		expect(html).not.toContain('application.js');
		expect(artifact.application['zh-CN']).toBe('zh-CN/application.js');
		expect(artifact.bootMessages['zh-CN'].waitingHost).not.toBe('');
		expect(artifact.files.some(/** 清单不能自摘要。 */ (file: CommunityArtifactManifest['files'][number]): boolean => file.path === 'community-artifact.json')).toBe(false);
		await expect(fs.access(path.join(fixture.outputDir, 'scripts/application.js'))).rejects.toThrow();
		await expect(fs.access(path.join(fixture.outputDir, 'scripts/i18n.js'))).rejects.toThrow();
		await expect(verifyCommunityArtifact(fixture.outputDir)).resolves.toEqual(artifact);
	});

	it('修改已列入摘要的文件会失败', /** 装配方不能接收与锁定载荷不符的文件。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture();
		await finalizeFixture(fixture);
		await fs.writeFile(path.join(fixture.outputDir, 'assets/logo.svg'), 'changed');
		await expect(verifyCommunityArtifact(fixture.outputDir)).rejects.toThrow('digest');
	});

	it('缺失的动态模块依赖阻止完成制品', /** 检查动态导入与静态导入采用相同闭包约束。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture('export const load = () => import("./missing.js");');
		await expect(finalizeFixture(fixture)).rejects.toThrow('Missing community static dependency');
		await expect(fs.access(path.join(fixture.outputDir, 'community-artifact.json'))).rejects.toThrow();
	});

	it('Vite 预加载依赖表中的动态 CSS 缺失会失败', /** CSS 只出现在真实形态的预加载表中也必须属于包内文件闭包。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture('const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./shared.js","../assets/missing-preload.css"])))=>i.map(i=>d[i]);');
		await expect(finalizeFixture(fixture)).rejects.toThrow('missing-preload.css');
	});

	it('识别 Vite 预加载表但不扫描任意业务字符串', /** 有效模块与 CSS 可通过，普通数组里的内容不被误判为制品资源。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture('const __vite__mapDeps=(i,cache=__vite__mapDeps,deps=(cache.f||(cache.f=["./shared.js","../assets/style.css"])))=>i.map(i=>deps[i]); export const content=["https://content.example/image.png","./not-a-dependency.css"];');
		await expect(finalizeFixture(fixture)).resolves.toMatchObject({ bootstrap: 'scripts/bootstrap.js' });
	});

	it('CDN 代码依赖不能进入本地制品', /** 外置模块即使写在生成代码中也必须被拒绝。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture('import "https://esm.sh/example";');
		await expect(finalizeFixture(fixture)).rejects.toThrow('must be local');
	});

	it('Bootstrap 提前依赖真实应用时拒绝发布', /** 静态等待壳不能在真实会话建立前触发业务单例。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture();
		fixture.manifest['src/community-app/bootstrap/entry.ts'].imports = ['src/community-app/application.ts'];
		await expect(finalizeFixture(fixture)).rejects.toThrow('must not import');
	});

	it('清单中的越界路径被拒绝', /** 防止制品清单让 App 装配读取包外文件。 */ async (): Promise<void> => {
		const fixture: BuildFixture = await createFixture();
		const artifact: CommunityArtifactManifest = await finalizeFixture(fixture);
		await fs.writeFile(path.join(fixture.outputDir, 'community-artifact.json'), JSON.stringify({ ...artifact, bootstrap: '../outside.js' }));
		await expect(verifyCommunityArtifact(fixture.outputDir)).rejects.toThrow('Invalid community artifact path');
	});

	it('仅给明确的旧存储消费者注入作用域绑定', /** 不改写字符串字段或任意业务模块。 */ async (): Promise<void> => {
		const source: string = 'export const value = localStorage.getItem("account"); const label = "localStorage";';
		const transformed: TransformResult | null = await transformScopedSource(source, 'src/lib/pizzax.ts');
		expect(transformed).toMatchObject({ code: expect.stringContaining('communityLocalStorage as localStorage') });
		if (transformed !== null && typeof transformed !== 'string') expect(transformed.code).toContain(source);
		await expect(transformScopedSource(source, 'src/pages/timeline.vue')).resolves.toBeNull();
	});

	it('广播作用域变换只处理明确 import 节点', /** 保留代码注释、普通字符串及无关模块的原样内容。 */ async (): Promise<void> => {
		const source: string = 'import { BroadcastChannel } from "broadcast-channel"; const label = "broadcast-channel";';
		const transformed: TransformResult | null = await transformScopedSource(source, 'src/preferences.ts');
		if (transformed === null || typeof transformed === 'string') throw new Error('Expected mapped broadcast import.');
		expect(transformed.code).toContain('from "@/community-app/storage/broadcast.js"');
		expect(transformed.code).toContain('const label = "broadcast-channel"');
		await expect(transformScopedSource(source, 'src/utility/other.ts')).resolves.toBeNull();
	});

	it('真实输出图中混入原站启动模块会失败', /** 即使模块通过相对路径进入图也不能绕过身份检查。 */ (): void => {
		const bundle: OutputBundle = {
			'entry.js': { type: 'chunk', fileName: 'entry.js', imports: [], dynamicImports: [], modules: { '/frontend/src/boot/common.ts': {} } } as unknown as OutputBundle[string],
		};
		expect(/** 执行生产输出钩子而非复制其判断逻辑。 */ (): void => verifyOutputGraph(bundle)).toThrow('Original frontend entry leaked');
	});

	it('真实输出图中的外置代码会失败', /** 模块未被当前构建输出接管时不允许发布。 */ (): void => {
		const bundle: OutputBundle = {
			'entry.js': { type: 'chunk', fileName: 'entry.js', imports: ['https://esm.sh/example'], dynamicImports: [], modules: {} } as unknown as OutputBundle[string],
		};
		expect(/** 使用同一生产输出钩子检查外置依赖。 */ (): void => verifyOutputGraph(bundle)).toThrow('must be bundled locally');
	});
});
