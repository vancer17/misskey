/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, post, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('Channel', () => {
	let alice: misskey.entities.SignupResponse;
	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
	});

	describe('Follow', () => {
		let channel: misskey.entities.ChannelsCreateResponse;

		beforeAll(async () => {
			const res = await api('channels/create', { name: 'follow-test-channel' }, alice);
			channel = res.body;
		});

		test('フォローしているチャンネルを再度フォローするとALREADY_FOLLOWINGエラーになる', async () => {
			const res1 = await api('channels/follow', { channelId: channel.id }, alice);
			assert.strictEqual(res1.status, 204);

			const res2 = await api('channels/follow', { channelId: channel.id }, alice);
			assert.strictEqual(res2.status, 400);
			assert.strictEqual(castAsError(res2.body as any).error.code, 'ALREADY_FOLLOWING');
		});
	});

	// ADR-0005 D2/D3：チャンネル集約タイムライン（X Communities の Home / Explore 相当）
	describe('Aggregated timelines', () => {
		let followedChannel: misskey.entities.ChannelsCreateResponse;
		let unfollowedChannel: misskey.entities.ChannelsCreateResponse;
		let followedNote: misskey.entities.Note;
		let unfollowedNote: misskey.entities.Note;

		beforeAll(async () => {
			const res1 = await api('channels/create', { name: 'agg-followed-channel' }, alice);
			followedChannel = res1.body;
			const res2 = await api('channels/create', { name: 'agg-unfollowed-channel' }, alice);
			unfollowedChannel = res2.body;

			await api('channels/follow', { channelId: followedChannel.id }, alice);

			followedNote = await post(alice, { text: 'followed channel note', channelId: followedChannel.id });
			unfollowedNote = await post(alice, { text: 'unfollowed channel note', channelId: unfollowedChannel.id });
		});

		test('followed-timeline はフォロー中チャンネルのノートのみを返す', async () => {
			const res = await api('channels/followed-timeline', { limit: 10 }, alice);
			assert.strictEqual(res.status, 200);

			const notes = res.body as misskey.entities.Note[];
			const ids = notes.map(n => n.id);
			assert.ok(ids.includes(followedNote.id), 'フォロー中チャンネルのノートが含まれる');
			assert.ok(!ids.includes(unfollowedNote.id), '未フォローチャンネルのノートは含まれない');
		});

		test('followed-timeline は非ログインでは呼べない', async () => {
			const res = await api('channels/followed-timeline', {});
			assert.strictEqual(res.status, 401);
		});

		test('global-timeline は全チャンネルのノートを返す（未ログイン可）', async () => {
			const res = await api('channels/global-timeline', { limit: 10 });
			assert.strictEqual(res.status, 200);

			const notes = res.body as misskey.entities.Note[];
			const ids = notes.map(n => n.id);
			assert.ok(ids.includes(followedNote.id), 'フォロー中チャンネルのノートが含まれる');
			assert.ok(ids.includes(unfollowedNote.id), '未フォローチャンネルのノートも含まれる');
		});

		test('global-timeline は通常ノートを含まない', async () => {
			const normalNote = await post(alice, { text: 'non channel note' });

			const res = await api('channels/global-timeline', { limit: 100 });
			assert.strictEqual(res.status, 200);

			const ids = (res.body as misskey.entities.Note[]).map(n => n.id);
			assert.ok(!ids.includes(normalNote.id), 'チャンネル外ノートは含まれない');
		});

		test('followed-timeline はミュート済みチャンネルのノートを除外する', async () => {
			const mutedChannel = (await api('channels/create', { name: 'agg-muted-channel' }, alice)).body as misskey.entities.ChannelsCreateResponse;
			await api('channels/follow', { channelId: mutedChannel.id }, alice);
			const mutedNote = await post(alice, { text: 'muted channel note', channelId: mutedChannel.id });
			await api('channels/mute/create', { channelId: mutedChannel.id }, alice);

			const res = await api('channels/followed-timeline', { limit: 100 }, alice);
			assert.strictEqual(res.status, 200);

			const ids = (res.body as misskey.entities.Note[]).map(n => n.id);
			assert.ok(!ids.includes(mutedNote.id), 'ミュート済みチャンネルのノートは含まれない');
		});

		test('global-timeline はアーカイブ済みチャンネルのノートを除外する', async () => {
			const archivedChannel = (await api('channels/create', { name: 'agg-archived-channel' }, alice)).body as misskey.entities.ChannelsCreateResponse;
			const archivedNote = await post(alice, { text: 'archived channel note', channelId: archivedChannel.id });
			await api('channels/update', { channelId: archivedChannel.id, isArchived: true }, alice);

			const res = await api('channels/global-timeline', { limit: 100 });
			assert.strictEqual(res.status, 200);

			const ids = (res.body as misskey.entities.Note[]).map(n => n.id);
			assert.ok(!ids.includes(archivedNote.id), 'アーカイブ済みチャンネルのノートは含まれない');
		});
	});
});
