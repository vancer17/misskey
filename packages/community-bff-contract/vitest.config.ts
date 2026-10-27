/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 契约定向验证。
 * 作用：只验证协议Schema、类型投影及参数边界，不证明业务或真实后端行为。
 * 数据链：纯协议输入 → Node 环境单测，不加载社区界面与宿主运行时。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['./test/**/*.test.ts'] } });
