/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { assert, describe, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { render } from '@testing-library/vue';
import { Nirax, type RouteDef } from '@/lib/nirax.js';
import type { Router } from '@/router.js';
import RouterView from '@/components/global/RouterView.vue';

describe('RouterView', () => {
	test('should reuse a component instance when the route defines a stable view key', async () => {
		let setupCount = 0;
		const Page = defineComponent({
			props: {
				acct: {
					type: String,
					required: true,
				},
				page: {
					type: String,
					default: undefined,
				},
			},
			setup(props) {
				setupCount++;
				return () => h('div', {
					'data-testid': 'router-view-page',
					'data-page': props.page ?? 'home',
				}, props.page ?? 'home');
			},
		});

		const routes: RouteDef[] = [{
			name: 'user',
			path: '/@:acct/:page?',
			viewKey: 'user',
			component: Page,
		}];

		const router = new Nirax(routes, '/@blobcat/notes', false, Page) as unknown as Router;
		const view = render(RouterView, {
			props: {
				router,
			},
		});

		await nextTick();
		assert.strictEqual(setupCount, 1);
		assert.strictEqual(view.container.querySelector('[data-testid="router-view-page"]')?.getAttribute('data-page'), 'notes');

		router.pushByPath('/@blobcat/replies');
		await nextTick();

		assert.strictEqual(setupCount, 1);
		assert.strictEqual(view.container.querySelector('[data-testid="router-view-page"]')?.getAttribute('data-page'), 'replies');
	});
});
