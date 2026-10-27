/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区本地子制品的 P1 定向验收命令。
 * 作用：验证真实输出目录的摘要、HTTP 资源交付和无会话 Bootstrap 边界。
 * 数据链：构建制品 → 独立静态服务 → Chromium 本地启动；不创建用户、不模拟 BFF，
 * 不把静态资源可交付解释成真实 Twitter 页面、私信或业务生命周期已联调通过。
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import * as ts from 'typescript';
import { HOST_SENTINELS } from './lib/community-app-verification/index.js';
import type { StartupAudit, VerificationWindow } from './lib/community-app-verification/index.js';
import type { Browser, BrowserContext, Frame, Page, Request, Route } from '@playwright/test';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommunityArtifactManifest, CommunityArtifactFile } from './src/community-app/bootstrap/index.js';
import type { CommunityBootstrapApi, CommunityBootSnapshot, CommunityHostDependencies } from './src/community-app/bootstrap/index.js';
import { verifyCommunityArtifact } from './lib/community-app-build/index.js';

/** 本地验收仅覆盖两种安装深度，防止根路径部署掩盖相对资源错误。 */
const MOUNT_PREFIXES: readonly string[] = Object.freeze(['/community/', '/app/community/']);

/** 静态服务的 MIME 对照只描述文件交付，不推断业务资源含义。 */
const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
	/** HTML 页面。 */
	'.html': 'text/html',
	/** 原生 ES module。 */
	'.js': 'text/javascript',
	/** 原生 ES module 的替代扩展。 */
	'.mjs': 'text/javascript',
	/** 样式表。 */
	'.css': 'text/css',
	/** 清单及静态 JSON。 */
	'.json': 'application/json',
	/** Worker 或运行库的 WebAssembly。 */
	'.wasm': 'application/wasm',
	/** 图标及字体子集。 */
	'.woff2': 'font/woff2',
	/** 字体兼容格式。 */
	'.woff': 'font/woff',
	/** 字体兼容格式。 */
	'.ttf': 'font/ttf',
	/** SVG 图片。 */
	'.svg': 'image/svg+xml',
	/** PNG 图片。 */
	'.png': 'image/png',
	/** JPEG 图片。 */
	'.jpg': 'image/jpeg',
	/** JPEG 的另一扩展。 */
	'.jpeg': 'image/jpeg',
	/** GIF 图片。 */
	'.gif': 'image/gif',
	/** WebP 图片。 */
	'.webp': 'image/webp',
	/** AVIF 图片。 */
	'.avif': 'image/avif',
	/** 浏览器图标。 */
	'.ico': 'image/x-icon',
	/** 音频素材。 */
	'.mp3': 'audio/mpeg',
	/** 音频素材。 */
	'.ogg': 'audio/ogg',
	/** 音频素材。 */
	'.wav': 'audio/wav',
	/** 文本与许可证。 */
	'.txt': 'text/plain',
});

/** 一种挂载深度的 P1 执行记录，不代表真实业务联调结论。 */
type MountVerification = Readonly<{
	mount: string;
	resources: number;
	checks: readonly string[];
}>;

/** 从扩展名确定静态 MIME；未知类型保留二进制语义。 */
function contentType(filePath: string): string {
	return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** 提供隔离宿主页面和真实制品，不提供 SPA 回退或任何后端代理。 */
async function serveRequest(request: IncomingMessage, response: ServerResponse, outputDirectory: string): Promise<void> {
	const address: URL = new URL(request.url ?? '/', 'http://127.0.0.1');
	if (address.pathname === '/host') {
		const mount: string | null = address.searchParams.get('mount');
		if (mount === null || !MOUNT_PREFIXES.includes(mount)) {
			response.writeHead(400).end();
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
		response.end(`<!doctype html><html><head><title>Community artifact verifier</title></head><body><iframe title="Community artifact" src="${mount}index.html"></iframe></body></html>`);
		return;
	}
	const mount: string | undefined = MOUNT_PREFIXES.find(
		/** 只匹配完整已知安装前缀，不暴露输出目录以外的文件。 */
		(prefix: string): boolean => address.pathname.startsWith(prefix),
	);
	if (mount === undefined) {
		response.writeHead(404).end();
		return;
	}
	const relative: string = decodeURIComponent(address.pathname.slice(mount.length));
	const filePath: string = path.resolve(outputDirectory, relative);
	if (relative === '' || relative.includes('\\') || !filePath.startsWith(outputDirectory + path.sep)) {
		response.writeHead(400).end();
		return;
	}
	try {
		const body: Buffer = await readFile(filePath);
		response.writeHead(200, { 'Content-Type': contentType(filePath), 'Content-Length': body.byteLength, 'Cache-Control': 'no-store' });
		response.end(body);
	} catch (error: unknown) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
			response.writeHead(404).end();
			return;
		}
		throw error;
	}
}

/** 启动使用系统分配端口的本机静态服务器，失败时不遗留监听。 */
async function startStaticServer(outputDirectory: string): Promise<Readonly<{ server: Server; origin: string }>> {
	const server: Server = createServer(
		/** Node 回调立即挂接异步错误处理，避免未观察的 Promise。 */
		(request: IncomingMessage, response: ServerResponse): void => {
			void serveRequest(request, response, outputDirectory).catch(
				/** 交付异常返回失败，不把缺失资源伪装成 HTML。 */
				(error: unknown): void => {
					if (!response.headersSent) response.writeHead(500);
					response.end();
					console.error(error);
				},
			);
		},
	);
	await new Promise<void>(
		/** 监听错误与成功均解除一次性临时监听器。 */
		(resolve: () => void, reject: (reason: unknown) => void): void => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1',
				/** 端口已绑定后不再保留启动阶段错误回调。 */
				(): void => {
					server.off('error', reject);
					resolve();
				},
			);
		},
	);
	const address: AddressInfo = server.address() as AddressInfo;

	return Object.freeze({ server, origin: `http://127.0.0.1:${address.port}` });
}

/** 通过真实 HTTP 检查清单每个文件的 MIME、长度及摘要，两种挂载深度分别执行。 */
async function verifyHttpFiles(origin: string, mount: string, manifest: CommunityArtifactManifest): Promise<void> {
	let cursor: number = 0;

	/** 每个任务顺序领取文件，限制并发以避免资源较多时压垮本地服务。 */
	async function worker(): Promise<void> {
		while (cursor < manifest.files.length) {
			const file: CommunityArtifactFile = manifest.files[cursor++];

			const encodedPath: string = file.path.split('/').map(
				/** 文件名编码不改变制品内目录层级。 */
				(segment: string): string => encodeURIComponent(segment),
			).join('/');
			const response: Response = await fetch(origin + mount + encodedPath);
			assert.equal(response.status, 200, `${mount}${file.path} HTTP 状态`);
			assert.equal(response.headers.get('content-type'), contentType(file.path), `${file.path} MIME`);
			const payload: Buffer = Buffer.from(await response.arrayBuffer());
			assert.equal(payload.byteLength, file.bytes, `${file.path} HTTP 长度`);
			assert.equal(createHash('sha256').update(payload).digest('hex'), file.sha256, `${file.path} HTTP 摘要`);
		}
	}

	await Promise.all(Array.from({ length: Math.min(8, manifest.files.length) },
		/** 创建固定数量的独立 HTTP 校验任务。 */
		(): Promise<void> => worker(),
	));
}

/** 从原始 TS 独立编译浏览器审计，避免序列化 Node TSX 的私有辅助函数。 */
async function installStartupAudit(context: BrowserContext): Promise<void> {
	const scriptPath: string = path.join(import.meta.dirname, 'lib/community-app-verification/index.ts');
	const browserSource: string = await readFile(scriptPath, 'utf8');
	const compiled: ts.TranspileOutput = ts.transpileModule(browserSource, {
		fileName: scriptPath,
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
		reportDiagnostics: true,
	});
	const errors: readonly ts.Diagnostic[] = (compiled.diagnostics ?? []).filter(
		/** 编译错误不能通过跳过审计降级为通过。 */
		(diagnostic: ts.Diagnostic): boolean => diagnostic.category === ts.DiagnosticCategory.Error,
	);
	if (errors.length > 0) throw new Error('启动审计浏览器脚本编译失败');
	const browserScript: string = '/** 在局部模块内运行审计，避免污染生产全局导出。 */\n(function(exports) {\n' + compiled.outputText + '\nexports.installCommunityStartupAudit(exports.HOST_SENTINELS);\n})({});';
	await context.addInitScript({ content: browserScript });
}

/** 读取真实启动 API 的只读快照。 */
async function snapshot(frame: Frame): Promise<CommunityBootSnapshot> {
	return await frame.evaluate(
		/** 仅在真实脚本已安装之后观察状态。 */
		(): CommunityBootSnapshot => {
			const api: CommunityBootstrapApi | undefined = (window as VerificationWindow).__MISSKEY_COMMUNITY_BOOTSTRAP__;
			if (api === undefined) throw new Error('缺少社区 Bootstrap API');
			return api.getState();
		},
	);
}

/** 调用真实 configure 并将可预期拒绝转换成可审查的错误文本。 */
async function configure(frame: Frame, dependencies: unknown, wrongSource: boolean = false): Promise<string | CommunityBootSnapshot> {
	return await frame.evaluate(
		/** 参数来自 Node 用例，但执行的是构建后的正式 Bootstrap。 */
		(input: Readonly<{ dependencies: unknown; wrongSource: boolean }>): string | CommunityBootSnapshot => {
			const api: CommunityBootstrapApi | undefined = (window as VerificationWindow).__MISSKEY_COMMUNITY_BOOTSTRAP__;
			if (api === undefined) throw new Error('缺少社区 Bootstrap API');
			try {
				return api.configure(input.dependencies, input.wrongSource ? window : window.parent);
			} catch (error: unknown) {
				return error instanceof Error ? error.message : String(error);
			}
		},
		{ dependencies, wrongSource },
	);
}

/** 一次挂载的真实浏览器验证，不导入或执行业务应用入口。 */
async function verifyMount(browser: Browser, origin: string, mount: string, manifest: CommunityArtifactManifest): Promise<MountVerification> {
	await verifyHttpFiles(origin, mount, manifest);
	const context: BrowserContext = await browser.newContext({ serviceWorkers: 'block' });
	const violations: string[] = [];
	const pageErrors: string[] = [];
	const payloadPaths: Set<string> = new Set(manifest.files.map(
		/** 浏览器仅可请求当前制品中的文件，不把未知 API 路径当作静态请求放行。 */
		(file: CommunityArtifactFile): string => file.path,
	));
	try {
		await installStartupAudit(context);
		await context.route('**/*',
			/** 禁止远端业务访问及挂载根目录外的静态回退。 */
			async (route: Route, request: Request): Promise<void> => {
				const address: URL = new URL(request.url());
				const knownPayload: boolean = address.pathname.startsWith(mount) && payloadPaths.has(decodeURIComponent(address.pathname.slice(mount.length)));
				if (address.origin !== origin || request.method() !== 'GET' || (address.pathname !== '/host' && !knownPayload)) {
					violations.push(request.method() + ' ' + request.url());
					await route.abort('blockedbyclient');
					return;
				}
				await route.continue();
			},
		);
		const page: Page = await context.newPage();
		page.on('pageerror',
			/** 启动脚本或副作用出现未处理错误时，必须使验收失败。 */
			(error: Error): void => { pageErrors.push(error.message); },
		);
		await page.goto(origin + '/host?mount=' + encodeURIComponent(mount), { waitUntil: 'networkidle' });
		const frame: Frame | null = page.frames().find(
			/** 宿主页不参与社区状态断言。 */
			(candidate: Frame): boolean => candidate.url() === origin + mount + 'index.html',
		) ?? null;
		assert.notEqual(frame, null, `${mount} 缺少真实子文档`);
		if (frame === null) throw new Error('缺少社区子文档');
		await frame.locator('[data-testid="community-app-bootstrap"][data-phase="WAITING_HOST"]').waitFor();
		assert.deepEqual(pageErrors, [], '启动审计和 Bootstrap 初始化时无未处理错误');
		assert.deepEqual(await snapshot(frame), { phase: 'WAITING_HOST', instanceId: null, errorCode: null, language: null });
		assert.equal(await frame.evaluate(
			/** API 和快照冻结，宿主不能直接篡改状态。 */
			(): boolean => {
				const api: CommunityBootstrapApi | undefined = (window as VerificationWindow).__MISSKEY_COMMUNITY_BOOTSTRAP__;
				return api !== undefined && Object.isFrozen(api) && Object.isFrozen(api.getState());
			},
		), true);
		const dependencies: CommunityHostDependencies = Object.freeze({
			instanceId: 'verify-' + mount.replaceAll('/', '-'),
			hostOrigin: origin,
			assetBase: origin + mount,
			canonicalInstanceUrl: 'https://community.example.invalid',
			bffBaseUrl: 'https://bff.example.invalid/community/v1/',
			language: 'en-US',
		});
		assert.equal(await configure(frame, dependencies, true), 'COMMUNITY_INVALID_HOST_WINDOW');
		assert.equal((await snapshot(frame)).phase, 'WAITING_HOST');
		assert.equal(await configure(frame, { ...dependencies, hostOrigin: 'https://untrusted.example.invalid' }), 'COMMUNITY_INVALID_HOST_ORIGIN');
		assert.deepEqual(await snapshot(frame), { phase: 'FAILED', instanceId: null, errorCode: 'COMMUNITY_INVALID_HOST_ORIGIN', language: null });
		assert.equal(await configure(frame, { ...dependencies, assetBase: 'https://untrusted.example.invalid/community/' }), 'COMMUNITY_INVALID_ASSET_BASE');
		assert.equal(await configure(frame, { ...dependencies, assetBase: origin + '/other-community/' }), 'COMMUNITY_INVALID_ASSET_BASE');
		assert.equal(await configure(frame, { ...dependencies, canonicalInstanceUrl: 'https://community.example.invalid/not-an-origin' }), 'COMMUNITY_INVALID_CANONICAL_ORIGIN');
		assert.equal(await configure(frame, { ...dependencies, bffBaseUrl: 'https://bff.example.invalid/community/v1/?token=forbidden' }), 'COMMUNITY_INVALID_DEPENDENCIES');
		assert.equal(await configure(frame, { ...dependencies, bffBaseUrl: 'http://bff.example.invalid/community/v1/' }), 'COMMUNITY_INVALID_DEPENDENCIES');
		assert.equal(await configure(frame, { ...dependencies, language: 'unsupported-language' }), 'COMMUNITY_UNSUPPORTED_LANGUAGE');
		assert.deepEqual(await configure(frame, dependencies), { phase: 'SESSION_REQUIRED', instanceId: dependencies.instanceId, errorCode: 'COMMUNITY_HOST_SESSION_REQUIRED', language: dependencies.language });
		await frame.locator('[data-testid="community-app-bootstrap"][data-phase="SESSION_REQUIRED"]').waitFor();
		assert.equal(await frame.locator('html').getAttribute('lang'), dependencies.language, '宿主选择的语言实际应用到文档');
		assert.equal(await frame.locator('[data-community-boot-message]').textContent(), manifest.bootMessages[dependencies.language].sessionRequired, '会话等待文案使用包内选定语言');
		assert.equal(await configure(frame, dependencies), 'COMMUNITY_INSTANCE_ALREADY_CONFIGURED');
		const staleError: string | null = await frame.evaluate(
			/** 旧实例不能释放当前启动边界。 */
			(): string | null => {
				try {
					(window as VerificationWindow).__MISSKEY_COMMUNITY_BOOTSTRAP__?.dispose('old-instance');
					return null;
				} catch (error: unknown) {
					return error instanceof Error ? error.message : String(error);
				}
			},
		);
		assert.equal(staleError, 'COMMUNITY_STALE_INSTANCE');
		assert.equal((await snapshot(frame)).phase, 'SESSION_REQUIRED');
		await frame.evaluate(
			/** 当前实例释放后不允许通过旧引用重新配置。 */
			(instanceId: string): void => { (window as VerificationWindow).__MISSKEY_COMMUNITY_BOOTSTRAP__?.dispose(instanceId); },
			dependencies.instanceId,
		);
		assert.deepEqual(await snapshot(frame), { phase: 'DISPOSED', instanceId: null, errorCode: 'COMMUNITY_INSTANCE_DISPOSED', language: null });
		assert.equal(await configure(frame, dependencies), 'COMMUNITY_INSTANCE_DISPOSED');
		await frame.locator('[data-testid="community-app-bootstrap"][data-phase="DISPOSED"]').waitFor();
		const applicationFailure: string = await frame.evaluate(
			/** 直接请求真实生产应用入口也必须被会话 gate 拒绝，不能只保护 HTML 正常路径。 */
			async (application: string): Promise<string> => {
				try {
					await import(new URL(application, window.location.href).href);
					return 'COMMUNITY_VERIFY_UNEXPECTED_APPLICATION_IMPORT';
				} catch (error: unknown) {
					return error instanceof Error ? error.message : String(error);
				}
			},
			manifest.application[dependencies.language],
		);
		assert.equal(applicationFailure, 'COMMUNITY_APPLICATION_ADAPTER_REQUIRED', '独立生产入口不能绕过应用初始化 gate');
		const audit: Omit<StartupAudit, 'readSentinels'> & Readonly<{ sentinels: Readonly<Record<string, string | null>> }> = await frame.evaluate(
			/** 汇总观测记录，函数本身不跨序列化边界。 */
			(): Omit<StartupAudit, 'readSentinels'> & Readonly<{ sentinels: Readonly<Record<string, string | null>> }> => {
				const record: StartupAudit | undefined = (window as VerificationWindow).__COMMUNITY_VERIFY_AUDIT__;
				if (record === undefined) throw new Error('启动审计未安装');
				return { storageAccesses: record.storageAccesses, webSocketUrls: record.webSocketUrls, serviceWorkerUrls: record.serviceWorkerUrls, databaseNames: record.databaseNames, broadcastNames: record.broadcastNames, sentinels: record.readSentinels() };
			},
		);
		assert.deepEqual(audit.storageAccesses, [], '无会话启动不访问存储');
		assert.deepEqual(audit.webSocketUrls, [], '无会话启动不建立 WebSocket');
		assert.deepEqual(audit.serviceWorkerUrls, [], '无会话启动不注册 SW');
		assert.deepEqual(audit.databaseNames, [], '无会话启动不初始化数据库');
		assert.deepEqual(audit.broadcastNames, [], '无会话启动不建立业务频道');
		assert.deepEqual(audit.sentinels, HOST_SENTINELS, '宿主存储哨兵保持原值');
		assert.deepEqual(violations, [], '无外部或根路径请求');
		assert.deepEqual(pageErrors, [], '无未处理页面错误');
		assert.equal(page.url(), origin + '/host?mount=' + encodeURIComponent(mount), '宿主物理入口保持不变');
		assert.equal(frame.url(), origin + mount + 'index.html', '社区物理入口保持不变');
		assert.equal(context.pages().length, 1, '未打开额外页面');
		assert.equal(await frame.locator('[data-testid="twitter-root"]').count(), 0, '没有真实会话时不得挂载业务根');
		return Object.freeze({ mount, resources: manifest.files.length, checks: Object.freeze(['http-integrity-mime', 'waiting-host', 'frozen-api', 'invalid-source', 'invalid-addresses', 'session-required', 'configured-language', 'duplicate-configure', 'stale-dispose', 'disposed-instance', 'direct-application-gate', 'no-business-side-effects']) });
	} finally {
		await context.close();
	}
}

/** 编排制品校验与真实浏览器启动，所有执行结论只写入根级忽略目录。 */
async function main(): Promise<void> {
	const outputDirectory: string = path.resolve(process.argv[2] ?? '../../built/community-app');
	await verifyCommunityArtifact(outputDirectory);
	const manifest: CommunityArtifactManifest = JSON.parse(await readFile(path.join(outputDirectory, 'community-artifact.json'), 'utf8')) as CommunityArtifactManifest;
	const reportRoot: string = path.resolve(import.meta.dirname, '../../tmp/community-app-verification');
	await mkdir(reportRoot, { recursive: true });
	const reportDirectory: string = await mkdtemp(path.join(reportRoot, 'run-'));
	const service: Readonly<{ server: Server; origin: string }> = await startStaticServer(outputDirectory);
	let browser: Browser | null = null;
	try {
		browser = await chromium.launch({ headless: true });
		const records: MountVerification[] = [];
		for (const mount of MOUNT_PREFIXES) records.push(await verifyMount(browser, service.origin, mount, manifest));
		await writeFile(path.join(reportDirectory, 'summary.json'), JSON.stringify({ scope: 'P1 artifact delivery and unauthenticated bootstrap only', outputDirectory, records }, null, '\t') + '\n');
		console.info(`Community P1 artifact verification passed: ${records.length} mount prefixes; ${manifest.files.length} files each. Report: ${reportDirectory}`);
	} finally {
		await browser?.close();
		await new Promise<void>(
			/** 完成或异常时都关闭本机服务并观察关闭失败。 */
			(resolve: () => void, reject: (reason: unknown) => void): void => {
				service.server.close(
					/** Node 将不存在的关闭错误视为正常结束。 */
					(error?: Error): void => error === undefined ? resolve() : reject(error),
				);
			},
		);
	}
}

await main();
