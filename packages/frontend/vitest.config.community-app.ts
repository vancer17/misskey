/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区专用构建的定向验证编排。
 * 作用：沿用现有浏览器协议测试环境，单独以 Node 环境验证真实 Git 与文件系统输入。
 * 数据链：协议与构建测试 → Vitest 执行结果；不装配业务后端或生成验收结论到源码目录。
 */
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.unit.js';

export default defineConfig({
	test: {
		projects: [
			{
				...unitConfig,
				test: {
					...unitConfig.test,
					name: 'community-protocol',
					include: [
						'./test/unit/community-app-build.test.ts',
						'./test/unit/community-app-runtime.test.ts',
						'./test/unit/community-app-routing.test.ts',
						'./test/unit/community-bff-*.test.ts',
						'./test/unit/account-ownership-adapter.test.ts',
						'./test/unit/community-ownership-adapter.test.ts',
						'./test/unit/twitter-messages-adapter.test.ts',
						'./test/unit/twitter-stream-notice.test.ts',
						'./test/unit/drive-upload.test.ts',
					],
				},
			},
			{
				test: {
					name: 'community-source',
					environment: 'node',
					include: ['./test/build/community-app-source.test.ts'],
				},
			},
		],
	},
});
