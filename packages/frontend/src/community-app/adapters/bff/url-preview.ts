/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区构建的链接预览网络接缝。
 * 作用：将原组件 /url 请求固定转交 BFF，组件仍解释既有 Summaly 响应。
 * 数据链：URL 与语言 → 当前实例 BFF → 原始预览响应。
 */
import { requireCommunityBffClient } from '@/community-app/bootstrap/index.js';

/** 不依赖 App 本地根路径，也不向预览 URL 写入凭据。 */
export function requestUrlPreview(url: string, language: string, signal?: AbortSignal): Promise<Response> {
	return requireCommunityBffClient().urlPreview(url, language, signal);
}
