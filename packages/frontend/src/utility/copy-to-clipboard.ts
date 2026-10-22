/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：通用工具 · 剪贴板。
 * 作用：在用户操作期间立即写入剪贴板，并在写入成功后按需加载成功提示。
 */

import { i18n } from '@/i18n.js';

/** 写入成功后才加载并显示提示，避免通用工具在初始化时加载界面模块。 */
async function showCopySuccess(): Promise<void> {
	const os: typeof import('@/os.js') = await import('@/os.js');
	os.toast(i18n.ts.copiedToClipboard);
}

/** 复制非空文本；保持同步调用签名，让剪贴板请求保留用户操作上下文。 */
export function copyToClipboard(input: string | null): void {
	if (input) {
		const copying: Promise<void> = navigator.clipboard.writeText(input);
		copying.then(showCopySuccess).catch(
			/** 写入或提示加载失败时记录错误，不显示成功提示。 */
			(error: unknown): void => {
				console.error('无法完成剪贴板复制或成功提示。', error);
			},
		);
	}
}
