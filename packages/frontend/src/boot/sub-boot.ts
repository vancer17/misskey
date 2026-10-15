/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 子页面 Bootstrap：共享启动前会话恢复结果，保留分享、授权等既有子页面语义。 */

import { createApp } from 'vue';
import type { App } from 'vue';
import { common } from './common.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import UiMinimum from '@/ui/minimum.vue';

/** 创建最小 UI；凭据失效触发受控重载时停止后续初始化。 */
export async function subBoot(): Promise<void> {
	const bootResult: Awaited<ReturnType<typeof common>> = await common(
		/** 子页面沿用已有根组件，不引入另一套账户状态。 */
		async (): Promise<App<Element>> => createApp(UiMinimum),
	);
	if (bootResult === null) return;

	emojiPicker.init();
}
