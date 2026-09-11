/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent } from 'vue';
import * as os from '@/os.js';

export function openTwitterSchedulePostDialog(defaultTime?: number | null): Promise<{
	canceled: boolean;
	result?: number;
}> {
	return new Promise(resolve => {
		let settled = false;
		const TwitterSchedulePostDialog = defineAsyncComponent(() => import('./SchedulePostDialog.vue'));

		const { dispose } = os.popup(TwitterSchedulePostDialog, {
			default: defaultTime ?? null,
		}, {
			done: result => {
				settled = true;
				resolve(result);
			},
			closed: () => {
				dispose();
				if (!settled) resolve({ canceled: true });
			},
		});
	});
}
