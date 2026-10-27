/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 契约构建入口。
 * 作用：仅在忽略的 built 目录生成交接 Schema；不把结论或构建产物提交 Git。
 * 数据链：权威控制 Schema及当前SDK生成输入 → 可移交的 JSON Schema/OpenAPI。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { COMMUNITY_BFF_SCHEMAS } from '../src/domain/schema.js';
import { createCommunityBffJsonSchema, createCommunityBffOpenApi } from '../src/schema/openapi.js';

/** 生成自包含实体校验器，只在构建时编译；产物不依赖Ajv运行时或动态eval。 */
async function generateEntityValidators(packageRoot: string, upstream: Record<string, unknown>): Promise<void> {
	const outputDirectory: string = path.join(packageRoot, 'built');
	const ajv: Ajv = new Ajv({ strict: false, validateFormats: false, coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true, esm: true } });
	ajv.addSchema({ $id: 'misskey.openapi.json', components: upstream.components });
	ajv.addSchema({ $id: 'community-me', $ref: COMMUNITY_BFF_SCHEMAS.Session.properties.me.$ref });
	ajv.addSchema({ $id: 'community-meta', $ref: COMMUNITY_BFF_SCHEMAS.Session.properties.meta.$ref });
	const source: string = standaloneCode(ajv, { validateMeDetailed: 'community-me', validateMetaDetailed: 'community-meta' });
	await mkdir(outputDirectory, { recursive: true });
	await build({
		stdin: { contents: source, resolveDir: packageRoot, sourcefile: 'community-entities.generated.js', loader: 'js' },
		outfile: path.join(outputDirectory, 'entities.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
		banner: { js: '/* Generated from current misskey-js OpenAPI. SPDX-License-Identifier: AGPL-3.0-only */' },
	});
	await writeFile(path.join(outputDirectory, 'entities.d.ts'), `/** 从现行SDK OpenAPI生成的完整实体shape校验，不修改输入。 */\nexport declare function validateMeDetailed(input: unknown): boolean;\n/** 从现行SDK OpenAPI生成的完整实例shape校验，不修改输入。 */\nexport declare function validateMetaDetailed(input: unknown): boolean;\n`);
}

/** 从仓库既有 SDK 输入生成配套业务 Schema，移除本地服务地址但保留操作参数与响应。 */
async function generate(): Promise<void> {
	const repositoryRoot: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
	const outputDirectory: string = path.join(repositoryRoot, 'built/community-bff-contract');
	const upstream: Record<string, unknown> = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/misskey-js/generator/api.json'), 'utf8')) as Record<string, unknown>;
	await generateEntityValidators(path.join(repositoryRoot, 'packages/community-bff-contract'), upstream);
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(path.join(outputDirectory, 'openapi.json'), `${JSON.stringify(createCommunityBffOpenApi(), null, 2)}\n`);
	await writeFile(path.join(outputDirectory, 'community-bff.schema.json'), `${JSON.stringify(createCommunityBffJsonSchema(), null, 2)}\n`);
	await writeFile(path.join(outputDirectory, 'misskey.openapi.json'), `${JSON.stringify({ openapi: upstream.openapi, info: upstream.info, paths: upstream.paths, components: upstream.components }, null, 2)}\n`);
}

await generate();
