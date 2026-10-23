/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 个人资料时间线的视图结构验证。
 * 作用：检查路由链接与保留面板的渲染契约，不验证查询或浏览器布局。
 * 数据链：静态用户输入 → Vue 视图；指示条几何与转场由真实浏览器用例证明。
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
					/** 本用例不测量布局，浏览器专用展示组件由 E2E 覆盖。 */
					TwitterTabIndicator: true,
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

	test('should keep profile timeline panes mounted while switching tabs', async () => {
		const timeline = render(TwitterUserTimeline, {
			props: {
				user,
				page: 'notes',
			},
			global: {
				components,
				directives,
				stubs: {
					/** 保留面板测试只检查节点身份，不模拟 FontFaceSet 或布局结果。 */
					TwitterTabIndicator: true,
					MkNotesTimeline: true,
					TwitterNote: true,
				},
			},
		});

		const getPane = (tab: string) => timeline.container.querySelector<HTMLElement>(`[data-testid="twitter-user-timeline-${tab}"]`);
		assert.strictEqual(timeline.container.querySelectorAll('[data-testid^="twitter-user-timeline-"]').length, 4);
		assert.notEqual(getPane('notes')?.style.display, 'none');
		assert.strictEqual(getPane('replies')?.style.display, 'none');

		await timeline.rerender({
			user,
			page: 'replies',
		});

		assert.strictEqual(timeline.container.querySelectorAll('[data-testid^="twitter-user-timeline-"]').length, 4);
		assert.strictEqual(getPane('notes')?.style.display, 'none');
		assert.notEqual(getPane('replies')?.style.display, 'none');
	});
});
