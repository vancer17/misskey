/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区本地子制品构建编排（显式 ESM 入口）。
 * 作用：显式构建实际前端工作区依赖，再执行独立社区构建；不读取实例配置或启动后端。
 * 数据链：锁定的工作区源码 → 前端依赖产物 → built/community-app；不发布或提交生成物。
 */
import path from 'node:path';
import { execa } from 'execa';

/** 当前脚本只消费仓库内锁定工具，不修改用户环境与 Git 配置。 */
const repositoryRoot: string = path.resolve(import.meta.dirname, '..');
/** 原前端可达工作区的构建顺序；不调用后端及 Service Worker 构建。 */
const frontendWorkspaces: readonly string[] = [
	'i18n',
	'misskey-js',
	'misskey-reversi',
	'misskey-bubble-game',
	'icons-subsetter',
];

/** 使用本地 pnpm 按顺序完成显式依赖及社区目标，任一步失败即保留非零退出。 */
async function buildCommunityApp(): Promise<void> {
	for (const workspace of frontendWorkspaces) {
		await execa('pnpm', ['--filter', workspace, 'build'], {
			cwd: repositoryRoot,
			preferLocal: true,
			stdio: 'inherit',
		});
	}
	await execa('pnpm', ['--filter', 'frontend', 'build:community-app'], {
		cwd: repositoryRoot,
		preferLocal: true,
		stdio: 'inherit',
	});
}

await buildCommunityApp();
