/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：独立站链接预览网络边界。
 * 作用：保留原站 /url 响应协议，允许社区构建固定替换为 BFF 适配。
 * 数据链：组件 URL 和语言 → HTTP 响应；预览业务解释仍由现有组件负责。
 */

/** 请求既有链接预览响应，不添加认证或改变组件解释。 */
export function requestUrlPreview(url: string, language: string, signal?: AbortSignal): Promise<Response> {
	return window.fetch(`/url?url=${encodeURIComponent(url)}&lang=${encodeURIComponent(language)}`, { signal });
}
