/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区制品源码身份验证。
 * 作用：在临时 Git 工作树中验证真实输入变化能改变指纹，输出与实例配置不会污染身份。
 * 数据链：文件系统和 Git 枚举 → 公开指纹函数 → 构建来源判定；不模拟业务接口或用户行为。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { readCommunitySourceFingerprint } from '../../lib/community-app-source/index.js';

/** 为每例建立真实 Git 工作树，结束后删除临时目录，不修改当前仓库配置。 */
async function withSourceTree(run: (repositoryRoot: string) => Promise<void>): Promise<void> {
	const repositoryRoot: string = await mkdtemp(path.join(tmpdir(), 'community-source-'));
	try {
		await execa('git', ['init', '--quiet'], { cwd: repositoryRoot });
		await mkdir(path.join(repositoryRoot, 'packages/frontend'), { recursive: true });
		await writeFile(path.join(repositoryRoot, 'packages/frontend/input.ts'), 'export const value = 1;\n');
		await writeFile(path.join(repositoryRoot, '.gitignore'), 'built/\n.config/\npackages/frontend/cache/\n');
		await execa('git', ['add', '.'], { cwd: repositoryRoot });
		await run(repositoryRoot);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
}

describe('community source fingerprint', /** 按真实工作树变化验证来源身份，不依赖提交与用户配置。 */ (): void => {
	it('包含已跟踪文件的未提交修改和删除', /** 相同 Git 索引下，实际字节和删除状态均改变构建身份。 */ async (): Promise<void> => {
		await withSourceTree(/** 操作真正的源码输入文件，避免仅验证哈希实现细节。 */ async (repositoryRoot: string): Promise<void> => {
			const original: string = await readCommunitySourceFingerprint(repositoryRoot);
			await writeFile(path.join(repositoryRoot, 'packages/frontend/input.ts'), 'export const value = 2;\n');
			const modified: string = await readCommunitySourceFingerprint(repositoryRoot);
			expect(modified).not.toBe(original);
			await rm(path.join(repositoryRoot, 'packages/frontend/input.ts'));
			expect(await readCommunitySourceFingerprint(repositoryRoot)).not.toBe(modified);
		});
	});
	it('包含尚未跟踪的新构建输入', /** 新模块无需先加入暂存区即可获得不同来源身份。 */ async (): Promise<void> => {
		await withSourceTree(/** 验证 untracked 模块进入构建输入集合。 */ async (repositoryRoot: string): Promise<void> => {
			const original: string = await readCommunitySourceFingerprint(repositoryRoot);
			await writeFile(path.join(repositoryRoot, 'packages/frontend/new-module.ts'), 'export const added = true;\n');
			expect(await readCommunitySourceFingerprint(repositoryRoot)).not.toBe(original);
		});
	});
	it('排除忽略产物、缓存、实例配置及其他领域文件', /** 运维配置与生成物不进入源码身份，也不会被函数读取。 */ async (): Promise<void> => {
		await withSourceTree(/** 建立真实目录与文件，验证 Git 忽略规则及构建输入范围。 */ async (repositoryRoot: string): Promise<void> => {
			const original: string = await readCommunitySourceFingerprint(repositoryRoot);
			const excludedPaths: readonly string[] = ['built/community-app/index.html', '.config/default.yml', 'packages/frontend/cache/result.json', 'packages/backend/src/unrelated.ts'];
			for (const relativePath of excludedPaths) {
				const filePath: string = path.join(repositoryRoot, relativePath);
				await mkdir(path.dirname(filePath), { recursive: true });
				await writeFile(filePath, 'excluded test input\n');
			}
			expect(await readCommunitySourceFingerprint(repositoryRoot)).toBe(original);
		});
	});
});
