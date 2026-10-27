/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区构建的源码身份。
 * 作用：按真实工作树内容计算构建输入指纹，覆盖未提交源码而排除生成物和实例配置。
 * 数据链：版本控制枚举的构建输入 → SHA-256 → 制品 Bootstrap 元数据；业务域不解释该身份。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { Hash } from 'node:crypto';

/** 固定的构建输入范围，不扫描密钥配置、运行证据、依赖缓存或其他业务后端。 */
const sourcePaths: readonly string[] = [
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'scripts/build-community-app.mts',
	'packages/frontend',
	'packages/frontend-shared',
	'packages/frontend-builder',
	'packages/community-bff-contract',
	'packages/backend/assets',
	'packages/i18n',
	'packages/icons-subsetter',
	'packages/misskey-js',
	'packages/misskey-reversi',
	'packages/misskey-bubble-game',
	'locales',
];

/** 基于排序后的路径及实际字节计算源码指纹；删除的已跟踪文件也计入身份。 */
export async function readCommunitySourceFingerprint(repositoryRoot: string): Promise<string> {
	const pathsText: string = (await execa('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sourcePaths], { cwd: repositoryRoot })).stdout;
	const files: string[] = [...new Set(pathsText.split('\0').filter(
		/** 忽略 NUL 终止符产生的空项，保留 Git 返回的原始路径。 */
		(fileName: string): boolean => fileName.length > 0,
	))].sort();
	const digest: Hash = createHash('sha256');
	for (const fileName of files) {
		digest.update(fileName).update('\0');
		try {
			const bytes: Buffer = await readFile(path.join(repositoryRoot, fileName));
			digest.update(String(bytes.byteLength)).update('\0').update(bytes);
		} catch (error: unknown) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
			digest.update('deleted');
		}
		digest.update('\0');
	}
	return digest.digest('hex');
}
