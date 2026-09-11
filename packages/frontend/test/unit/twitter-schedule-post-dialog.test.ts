/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, test } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import TwitterSchedulePostDialog from '@/ui/twitter/SchedulePostDialog.vue';

describe('TwitterSchedulePostDialog', () => {
	afterEach(() => {
		cleanup();
	});

	test('should use a custom calendar instead of a native datetime picker', () => {
		const dialog = render(TwitterSchedulePostDialog, {
			props: {
				default: Date.now() + (24 * 60 * 60 * 1000),
			},
			global: {
				stubs: {
					MkModal: {
						template: '<div><slot/></div>',
					},
				},
			},
		});

		assert.strictEqual(dialog.container.querySelectorAll('input[type="datetime-local"]').length, 0);
		assert.strictEqual(dialog.container.querySelectorAll('input[type="date"]').length, 0);
		assert.strictEqual(dialog.container.querySelectorAll('input[type="time"]').length, 0);
		assert.strictEqual(dialog.container.querySelectorAll('input[type="text"]').length, 2);
		assert.ok(dialog.container.querySelector('[aria-selected="true"]'));
	});
});
