/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, test } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import * as Misskey from 'misskey-js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import TwitterUserTimeline from '@/pages/user/TwitterUserTimeline.vue';

const user = {
	id: 'blobcat',
	username: 'blobcat',
	host: null,
	roles: [],
	createdAt: '1970-01-01T00:00:00.000Z',
	fields: [],
	pinnedNotes: [],
	avatarUrl: 'https://example.com/avatar.png',
	avatarDecorations: [],
} as unknown as Misskey.entities.UserDetailed;

describe('TwitterUserTimeline', () => {
	afterEach(() => {
		cleanup();
	});

	test('should render Twitter profile timeline tabs', () => {
		const timeline = render(TwitterUserTimeline, {
			props: {
				user,
				page: 'notes',
			},
			global: {
				components,
				directives,
				stubs: {
					MkNotesTimeline: true,
					TwitterNote: true,
				},
			},
		});

		const links = [...timeline.container.querySelectorAll<HTMLAnchorElement>('a')];
		assert.deepEqual(links.map(link => link.getAttribute('href')), [
			'/@blobcat/notes',
			'/@blobcat/replies',
			'/@blobcat/files',
			'/@blobcat/featured',
		]);
		assert.strictEqual(links[0].getAttribute('aria-current'), 'page');
	});
});
