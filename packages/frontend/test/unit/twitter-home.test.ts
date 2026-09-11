/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, test } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import * as Misskey from 'misskey-js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import TwitterHome from '@/pages/user/TwitterHome.vue';

function renderTwitterHome(user: Partial<Misskey.entities.UserDetailed>) {
	return render(TwitterHome, {
		props: {
			user: user as Misskey.entities.UserDetailed,
			page: 'notes',
		},
		global: {
			components,
			directives,
			stubs: {
				MkFollowButton: true,
				TwitterUserTimeline: true,
			},
		},
	});
}

describe('TwitterHome', () => {
	afterEach(() => {
		cleanup();
	});

	test('should render the remote caution with the remote profile URL', () => {
		const home = renderTwitterHome({
			id: 'blobcat',
			name: 'blobcat',
			username: 'blobcat',
			host: 'example.com',
			uri: 'https://example.com/@user',
			url: 'https://example.com/@user/profile',
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com/avatar.png',
			avatarDecorations: [],
		});

		const anchor = home.container.querySelector<HTMLAnchorElement>('a[href="https://example.com/@user/profile"]');
		assert.exists(anchor);
	});
});
