/*
 * 社区制品构建公共入口：统一暴露固定输入、语言清单、最终装配和摘要校验。
 * 构建器与验收命令只使用此入口，不跨模块读取内部文件。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export { COMMUNITY_BUILD_ENTRIES, COMMUNITY_BUILD_LANGUAGES, createCommunityClosedGraphPlugin } from './config.internal.js';
export { finalizeCommunityApp, verifyCommunityArtifact } from './artifact.internal.js';
export type { CommunityFinalizeOptions } from './artifact.internal.js';
