/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区制品纯模型公开入口。
 * 作用：让构建配置只消费清单与语言，不把 Bootstrap 的异步运行图带入 Node 配置求值。
 * 数据链：唯一模型 → 构建器／运行装配；不导出会话、网络或业务状态实现。
 */
export { COMMUNITY_SUPPORTED_LANGUAGES } from './model.internal.js';
export type { CommunitySupportedLanguage, CommunityArtifactFile, CommunityBootMessages, CommunityRuntimeManifest, CommunityArtifactManifest } from './model.internal.js';
