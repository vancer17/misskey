/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 社区本地 Bootstrap 公共入口：向构建器公开制品类型，不导入账户或业务模块。 */
export { COMMUNITY_SUPPORTED_LANGUAGES } from './artifact.js';
export type { CommunitySupportedLanguage, CommunityArtifactFile, CommunityBootMessages, CommunityRuntimeManifest, CommunityArtifactManifest } from './artifact.js';
export { createCommunityBootstrapApi, parseCommunityHostDependencies, requireCommunitySession } from './runtime.js';
export type { CommunityBootPhase, CommunityBootSnapshot, CommunityHostDependencies, CommunityBootstrapApi } from './runtime.js';
