/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Web 资源交付协议测试：通过真实 ClientServerService、Fastify HTTP 与临时制品，
 * 验证主前端和嵌入前端各自依据 manifest 选择静态文件或开发代理。
 * 所有监听端口均由操作系统分配，文件仅写入临时目录，不访问开发服务或业务数据库。
 */

import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { mock, mockDeep } from 'vitest-mock-extended';
import { ClientServerService } from '@/server/web/ClientServerService.js';
import type { Config } from '@/config.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** 两份制品的独立存在事实；测试仅据此安排文件，不模拟路由注册结果。 */
type AssetModes = Readonly<{
	frontend: boolean;
	embed: boolean;
}>;

/** 从被测服务构造器派生依赖类型，避免在协议测试内复制生产依赖定义。 */
type ClientServerDependencies = ConstructorParameters<typeof ClientServerService>;

/** 本地真实开发上游及其分配地址，用于验证代理实际发送的请求。 */
type DevelopmentUpstream = Readonly<{
	server: FastifyInstance;
	port: string;
}>;

/** 覆盖两端均开发、两种混合制品和两端均构建的四种启动状态。 */
const assetModes: ReadonlyArray<AssetModes> = [
	{ frontend: false, embed: false },
	{ frontend: true, embed: false },
	{ frontend: false, embed: true },
	{ frontend: true, embed: true },
];

/** 创建真实本地开发上游，返回请求路径与缓存头以证明代理未套用静态资源策略。 */
async function createDevelopmentUpstream(prefix: string): Promise<DevelopmentUpstream> {
	const server: FastifyInstance = Fastify();
	server.get(`${prefix}/*`, /** 回传上游收到的完整资源路径，保留模块版本查询参数。 */ (request: FastifyRequest, reply: FastifyReply): string => {
		reply.header('Content-Type', 'application/javascript');
		reply.header('Cache-Control', 'no-cache');
		return `development:${request.url}`;
	});
	const address: string = await server.listen({ port: 0, host: '127.0.0.1' });
	return { server, port: new URL(address).port };
}

/** 只提供路由注册实际读取的配置；其他业务依赖不会在资源 HTTP 请求中被调用。 */
function createClientServer(config: Config): ClientServerService {
	return new ClientServerService(
		config,
		mock<ClientServerDependencies[1]>(),
		mock<ClientServerDependencies[2]>(),
		mock<ClientServerDependencies[3]>(),
		mock<ClientServerDependencies[4]>(),
		mock<ClientServerDependencies[5]>(),
		mock<ClientServerDependencies[6]>(),
		mock<ClientServerDependencies[7]>(),
		mock<ClientServerDependencies[8]>(),
		mock<ClientServerDependencies[9]>(),
		mock<ClientServerDependencies[10]>(),
		mock<ClientServerDependencies[11]>(),
		mock<ClientServerDependencies[12]>(),
		mock<ClientServerDependencies[13]>(),
		mock<ClientServerDependencies[14]>(),
		mock<ClientServerDependencies[15]>(),
		mock<ClientServerDependencies[16]>(),
		mock<ClientServerDependencies[17]>(),
		mock<ClientServerDependencies[18]>(),
		mock<ClientServerDependencies[19]>(),
		mock<ClientServerDependencies[20]>(),
		mock<ClientServerDependencies[21]>(),
		mock<ClientServerDependencies[22]>(),
		mock<ClientServerDependencies[23]>(),
		mockDeep<ClientServerDependencies[24]>(),
	);
}

describe('ClientServerService frontend asset delivery', /** 对独立制品选择执行真实 HTTP 回归。 */ (): void => {
	test.each(assetModes)('frontend=$frontend, embed=$embed use their own manifests', /** 每组独立启动资源服务与两个开发上游，验证混合状态不会串用另一份 manifest。 */ async (modes: AssetModes): Promise<void> => {
		const rootDir: string = await mkdtemp(join(tmpdir(), 'misskey-client-assets-'));
		const server: FastifyInstance = Fastify();
		const upstreams: DevelopmentUpstream[] = [];
		const previousVitePort: string | undefined = process.env.VITE_PORT;
		const previousEmbedPort: string | undefined = process.env.EMBED_VITE_PORT;
		try {
			const frontendUpstream: DevelopmentUpstream = await createDevelopmentUpstream('/vite');
			upstreams.push(frontendUpstream);
			const embedUpstream: DevelopmentUpstream = await createDevelopmentUpstream('/embed_vite');
			upstreams.push(embedUpstream);
			process.env.VITE_PORT = frontendUpstream.port;
			process.env.EMBED_VITE_PORT = embedUpstream.port;
			const frontendOut: string = join(rootDir, 'built/_frontend_vite_');
			const embedOut: string = join(rootDir, 'built/_frontend_embed_vite_');
			await mkdir(frontendOut, { recursive: true });
			await mkdir(embedOut, { recursive: true });
			if (modes.frontend) {
				await writeFile(join(frontendOut, 'manifest.json'), '{}');
				await writeFile(join(frontendOut, 'entry.js'), 'built:frontend');
			}
			if (modes.embed) {
				await writeFile(join(embedOut, 'manifest.json'), '{}');
				await writeFile(join(embedOut, 'entry.js'), 'built:embed');
			}
			const config: Config = mock<Config>({
				rootDir,
				url: 'http://127.0.0.1:1',
				frontendManifestExists: existsSync(join(frontendOut, 'manifest.json')),
				frontendEmbedManifestExists: existsSync(join(embedOut, 'manifest.json')),
			});
			const clientServer: ClientServerService = createClientServer(config);
			server.register(clientServer.createServer);
			const origin: string = await server.listen({ port: 0, host: '127.0.0.1' });
			await assertAssetDelivery(origin, '/vite', modes.frontend, 'frontend');
			await assertAssetDelivery(origin, '/embed_vite', modes.embed, 'embed');
		} finally {
			await server.close();
			for (const upstream of upstreams) await upstream.server.close();
			await rm(rootDir, { recursive: true, force: true });
			if (previousVitePort === undefined) delete process.env.VITE_PORT;
			else process.env.VITE_PORT = previousVitePort;
			if (previousEmbedPort === undefined) delete process.env.EMBED_VITE_PORT;
			else process.env.EMBED_VITE_PORT = previousEmbedPort;
		}
	});
});

/** 使用网络 HTTP 验证资源来源、长期缓存及查询参数钩子仅作用于各自静态分支。 */
async function assertAssetDelivery(origin: string, prefix: string, built: boolean, target: string): Promise<void> {
	const path: string = `${prefix}/entry.js`;
	const response: Response = await fetch(`${origin}${path}`);
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toContain('javascript');
	expect(await response.text()).toBe(built ? `built:${target}` : `development:${path}`);
	const queryResponse: Response = await fetch(`${origin}${path}?v=module-version`, { redirect: 'manual' });
	if (built) {
		expect(response.headers.get('cache-control')).toContain('max-age=2592000');
		expect(response.headers.get('cache-control')).toContain('immutable');
		expect(queryResponse.status).toBe(301);
		expect(queryResponse.headers.get('location')).toBe(path);
	} else {
		expect(response.headers.get('cache-control')).toBe('no-cache');
		expect(queryResponse.status).toBe(200);
		expect(queryResponse.headers.get('location')).toBeNull();
		expect(await queryResponse.text()).toBe(`development:${path}?v=module-version`);
	}
}
