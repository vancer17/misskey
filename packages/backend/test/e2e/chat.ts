/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 聊天真实后端集成验证：覆盖双方权限、聚合分页、显式标读、多设备事件与群聊生命周期。
 * 仅通过真实 HTTP / WebSocket、独立 PostgreSQL 和 Redis 证明业务行为；批量数据直接写入测试数据库。
 */
process.env.NODE_ENV = 'test';

import * as assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import type WebSocket from 'ws';
import type { Endpoints, entities } from 'misskey-js';
import { api, connectStream, initTestDb, role, signup, uploadFile } from '../utils.js';
import { loadConfig } from '@/config.js';
import { IdService } from '@/core/IdService.js';
import { MiChatMessage, MiChatRoom, MiUser } from '@/models/_.js';

/** 从 SDK 协议派生 HTTP 测试结果，禁止复制业务响应类型。 */
type ApiResult<E extends keyof Endpoints> = Awaited<ReturnType<typeof api<E, Endpoints[E]['req']>>>;

/** 在未知错误响应上验证结构化业务码和原因，不对正常响应强制类型断言。 */
function assertError(response: { status: number; body: unknown }, code: string, reason?: string): void {
	assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(response.body));
	assert.ok(typeof response.body === 'object' && response.body !== null && 'error' in response.body);
	const error: unknown = response.body.error;
	assert.ok(typeof error === 'object' && error !== null && 'code' in error);
	assert.equal(error.code, code);
	if (reason) {
		assert.ok('info' in error && typeof error.info === 'object' && error.info !== null && 'reason' in error.info);
		assert.equal(error.info.reason, reason);
	}
}

/** 所有测试共享隔离账号，特定业务策略场景另建用户以避免存量授权污染。 */
describe('Chat workspace real backend', /** 注册真实服务集成用例。 */ (): void => {
	let admin: entities.SignupResponse;
	let alice: entities.SignupResponse;
	let bob: entities.SignupResponse;
	let carol: entities.SignupResponse;
	let db: DataSource;
	let redis: Redis;
	const ids: IdService = new IdService(loadConfig());

	beforeAll(/** 建立真实普通账号与数据库连接，不修改开发实例。 */ async (): Promise<void> => {
		admin = await signup({ username: 'chat_admin' });
		alice = await signup({ username: 'chat_alice' });
		bob = await signup({ username: 'chat_bob' });
		carol = await signup({ username: 'chat_carol' });
		for (const user of [alice, bob, carol]) await api('i/update', { chatScope: 'everyone' }, user);
		db = await initTestDb(true);
		redis = new Redis(loadConfig().redis);
	}, 120_000);

	afterAll(/** 释放连接，测试数据仅留在测试专用数据库。 */ async (): Promise<void> => {
		await redis.quit();
		await db.destroy();
	});

	test('接收范围、互关及存量授权都来自同一权限服务', /** 真实关注链与发送链共同证明权限及存量授权。 */ async (): Promise<void> => {
		const sender: entities.SignupResponse = await signup({ username: 'chat_scope_sender' });
		const target: entities.SignupResponse = await signup({ username: 'chat_scope_target' });
		let contact: ApiResult<'chat/contacts/show'> = await api('chat/contacts/show', { userId: target.id }, sender);
		assert.equal(contact.body.canRead, true);
		assert.equal(contact.body.canSend, false);
		assert.equal(contact.body.reason, 'RECIPIENT_SCOPE');
		const denied: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: target.id, text: 'denied' }, sender);
		assertError(denied, 'CHAT_SEND_DENIED', 'RECIPIENT_SCOPE');
		await api('following/create', { userId: target.id }, sender);
		contact = await api('chat/contacts/show', { userId: target.id }, sender);
		assert.equal(contact.body.canSend, false);
		await api('following/create', { userId: sender.id }, target);
		contact = await api('chat/contacts/show', { userId: target.id }, sender);
		assert.equal(contact.body.canSend, true);
		assert.equal((await api('chat/messages/create-to-user', { toUserId: target.id, text: 'first' }, sender)).status, 200);
		assert.equal((await api('chat/messages/create-to-user', { toUserId: sender.id, text: 'reply' }, target)).status, 200);
		await api('following/delete', { userId: target.id }, sender);
		await api('following/delete', { userId: sender.id }, target);
		await api('i/update', { chatScope: 'none' }, target);
		contact = await api('chat/contacts/show', { userId: target.id }, sender);
		assert.equal(contact.body.canSend, true, '已存在的相互批准在取消关注后保持有效');
		await api('blocking/create', { userId: sender.id }, target);
		contact = await api('chat/contacts/show', { userId: target.id }, sender);
		assert.equal(contact.body.reason, 'BLOCKED');
		assertError(await api('chat/messages/create-to-user', { toUserId: target.id, text: 'blocked' }, sender), 'YOU_HAVE_BEEN_BLOCKED');
	});

	test('每种接收范围、远端、自身和空白内容均明确拒绝', /** 将独立目标的每种接收策略放入真实 HTTP 权限链。 */ async (): Promise<void> => {
		const target: entities.SignupResponse = await signup({ username: 'chat_range_target' });
		for (const scope of ['none', 'followers', 'following', 'mutual'] as const) {
			await api('i/update', { chatScope: scope }, target);
			const contact: ApiResult<'chat/contacts/show'> = await api('chat/contacts/show', { userId: target.id }, carol);
			assert.equal(contact.body.reason, 'RECIPIENT_SCOPE');
		}
		await api('i/update', { chatScope: 'followers' }, target);
		await api('following/create', { userId: target.id }, carol);
		assert.equal((await api('chat/contacts/show', { userId: target.id }, carol)).body.canSend, true);
		await api('i/update', { chatScope: 'following' }, target);
		assert.equal((await api('chat/contacts/show', { userId: target.id }, carol)).body.canSend, false);
		await api('following/create', { userId: carol.id }, target);
		assert.equal((await api('chat/contacts/show', { userId: target.id }, carol)).body.canSend, true);
		await api('i/update', { chatScope: 'mutual' }, target);
		assert.equal((await api('chat/contacts/show', { userId: target.id }, carol)).body.canSend, true);
		assert.equal((await api('chat/contacts/show', { userId: alice.id }, alice)).body.reason, 'SELF');
		assertError(await api('chat/messages/create-to-user', { toUserId: bob.id, text: ' \n\t ' }, alice), 'CONTENT_REQUIRED');
		const remote: entities.SignupResponse = await signup({ username: 'chat_remote' });
		await db.getRepository(MiUser).update(remote.id, { host: 'remote.example' });
		assert.equal((await api('chat/contacts/show', { userId: remote.id }, alice)).body.reason, 'REMOTE_USER');
		assertError(await api('chat/messages/create-to-user', { toUserId: remote.id, text: 'not federated' }, alice), 'CHAT_SEND_DENIED', 'REMOTE_USER');
		assertError(await api('chat/contacts/show', { userId: '0000000000' }, alice), 'NO_SUCH_USER');
	});

	test('只读与禁用角色限制同时作用于预检和实际写入', /** 通过真实角色分配验证业务权限。 */ async (): Promise<void> => {
		const reader: entities.SignupResponse = await signup({ username: 'chat_readonly' });
		const room: ApiResult<'chat/rooms/create'> = await api('chat/rooms/create', { name: 'Role permissions group' }, bob);
		await api('chat/rooms/invitations/create', { roomId: room.body.id, userId: reader.id }, bob);
		await api('chat/rooms/join', { roomId: room.body.id }, reader);
		const readonly: entities.Role = await role(admin, { name: 'Chat readonly' }, { chatAvailability: { useDefault: false, priority: 1, value: 'readonly' } });
		await api('admin/roles/assign', { roleId: readonly.id, userId: reader.id }, admin);
		assert.equal((await api('chat/contacts/show', { userId: bob.id }, reader)).body.reason, 'CHAT_READ_ONLY');
		assert.equal((await api('chat/conversations/list', {}, reader)).status, 200);
		assert.equal((await api('chat/rooms/show', { roomId: room.body.id }, reader)).status, 200);
		assertError(await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'readonly' }, reader), 'CHAT_SEND_DENIED', 'CHAT_READ_ONLY');
		const unavailable: entities.Role = await role(admin, { name: 'Chat unavailable' }, { chatAvailability: { useDefault: false, priority: 2, value: 'unavailable' } });
		await api('admin/roles/assign', { roleId: unavailable.id, userId: reader.id }, admin);
		assert.equal((await api('chat/contacts/show', { userId: bob.id }, reader)).body.reason, 'CHAT_UNAVAILABLE');
		assertError(await api('chat/conversations/list', {}, reader), 'CHAT_UNAVAILABLE');
		assertError(await api('chat/rooms/show', { roomId: room.body.id }, reader), 'CHAT_UNAVAILABLE');
		await api('chat/rooms/delete', { roomId: room.body.id }, bob);
		assert.equal((await api('chat/contacts/show', { userId: reader.id }, alice)).body.reason, 'RECIPIENT_UNAVAILABLE');
	});

	test('聚合后分页跨越一百个会话，旧消息不会重复制造会话', /** 批量真实数据库数据覆盖聚合和空群聊边界，不替代 HTTP 业务操作。 */ async (): Promise<void> => {
		const roomIds: string[] = [];
		for (let index: number = 0; index < 105; index++) {
			const roomId: string = ids.gen(Date.now() - 100_000 - index * 1000);
			roomIds.push(roomId);
			await db.getRepository(MiChatRoom).insert({ id: roomId, name: `Pagination ${index}`, ownerId: alice.id, description: '' });
			if (index < 100) {
				for (let version: number = 0; version < 2; version++) await db.getRepository(MiChatMessage).insert({ id: ids.gen(Date.now() - 50_000 - index * 100 - version), fromUserId: alice.id, toRoomId: roomId, text: 'history' });
			}
		}
		const seen: Set<string> = new Set<string>();
		let cursor: string | undefined = undefined;
		let nullMessages: number = 0;
		do {
			const page: ApiResult<'chat/conversations/list'> = await api('chat/conversations/list', { kind: 'room', query: 'Pagination', limit: 13, cursor }, alice);
			assert.equal(page.status, 200, JSON.stringify(page.body));
			for (const item of page.body.items) {
				assert.equal(seen.has(item.key), false);
				seen.add(item.key);
				assert.ok(item.room?.name.startsWith('Pagination'));
				if (item.latestMessage == null) nullMessages++;
			}
			cursor = page.body.nextCursor ?? undefined;
		} while (cursor);
		assert.equal(seen.size, 105);
		assert.equal(nullMessages, 5);
		assertError(await api('chat/conversations/list', { cursor: 'invalid' }, alice), 'INVALID_CURSOR');
		const other: ApiResult<'chat/conversations/list'> = await api('chat/conversations/list', { kind: 'room', query: 'Pagination' }, bob);
		assert.equal(other.body.items.length, 0);
		await db.getRepository(MiChatRoom).delete(roomIds);
	});

	test('后台查询不标读，旧位置不会清除新消息，全部已读清理双层标记', /** 使用真实消息顺序与 Redis 原子状态验证并发标读契约。 */ async (): Promise<void> => {
		const first: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'read first' }, alice);
		const second: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'read second' }, alice);
		assert.equal(first.status, 200);
		await api('chat/messages/user-timeline', { userId: alice.id, markAsRead: false }, bob);
		assert.equal((await api('i', {}, bob)).body.hasUnreadChatMessages, true);
		assert.equal((await api('chat/conversations/read', { userId: alice.id, messageId: first.body.id }, bob)).status, 204);
		assert.equal((await api('i', {}, bob)).body.hasUnreadChatMessages, true);
		assertError(await api('chat/conversations/read', { userId: carol.id, messageId: second.body.id }, bob), 'NO_SUCH_MESSAGE');
		await api('chat/conversations/read', { userId: alice.id, messageId: second.body.id }, bob);
		assert.equal((await api('i', {}, bob)).body.hasUnreadChatMessages, false);
		await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'read all' }, alice);
		await api('chat/read-all', {}, bob);
		assert.equal(await redis.get(`newUserChatMessageExists:${bob.id}:${alice.id}`), null);
		assert.equal(await redis.scard(`newChatMessagesExists:${bob.id}`), 0);
		const previous: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'deletion previous' }, alice);
		const latest: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'deletion latest' }, alice);
		await api('chat/messages/delete', { messageId: latest.body.id }, alice);
		assert.equal((await api('i', {}, bob)).body.hasUnreadChatMessages, true);
		assert.equal(await redis.get(`newUserChatMessageExists:${bob.id}:${alice.id}`), previous.body.id);
		await api('chat/conversations/read', { userId: alice.id, messageId: previous.body.id }, bob);
		await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'native read' }, alice);
		await api('chat/messages/user-timeline', { userId: alice.id }, bob);
		assert.equal((await api('i', {}, bob)).body.hasUnreadChatMessages, false);
	});

	test('双方设备即时接收发送、反应、删除及标读的会话失效事件', /** 真实 WebSocket 订阅跨设备主流，不依赖延迟推送。 */ async (): Promise<void> => {
		const aliceEvents: Record<string, unknown>[] = [];
		const bobEvents: Record<string, unknown>[] = [];
		const aliceStream: WebSocket = await connectStream(alice, 'main', /** 仅收集账号级会话事件。 */ (message: Record<string, unknown>): void => { if (message.type === 'chatUpdated') aliceEvents.push(message); });
		const bobStream: WebSocket = await connectStream(bob, 'main', /** 仅收集账号级会话事件。 */ (message: Record<string, unknown>): void => { if (message.type === 'chatUpdated') bobEvents.push(message); });
		try {
			const sent: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'stream event' }, alice);
			await expect.poll(/** 等待实际事件到达两端设备。 */ (): number => Math.min(aliceEvents.length, bobEvents.length)).toBeGreaterThanOrEqual(1);
			assert.equal((await api('chat/messages/react', { messageId: sent.body.id, reaction: '👍' }, bob)).status, 204);
			await expect.poll(/** 等待反应导致的摘要失效事件。 */ (): number => aliceEvents.length).toBeGreaterThanOrEqual(2);
			await api('chat/conversations/read', { userId: alice.id, messageId: sent.body.id }, bob);
			await api('chat/messages/delete', { messageId: sent.body.id }, alice);
			await expect.poll(/** 删除同样通知发送者其他设备。 */ (): number => aliceEvents.length).toBeGreaterThanOrEqual(3);
			await expect.poll(/** 标读和删除均通知接收者其他设备。 */ (): number => bobEvents.length).toBeGreaterThanOrEqual(4);
		} finally {
			aliceStream.close();
			bobStream.close();
		}
	});

	test('附件所有权和搜索连续分页由真实消息存储证明', /** 上传真实附件并用多页搜索验证内容与归属。 */ async (): Promise<void> => {
		const upload: Awaited<ReturnType<typeof uploadFile>> = await uploadFile(alice);
		assert.equal(upload.status, 200);
		assert.ok(upload.body);
		assertError(await api('chat/messages/create-to-user', { toUserId: alice.id, fileId: upload.body.id }, bob), 'NO_SUCH_FILE');
		const attached: ApiResult<'chat/messages/create-to-user'> = await api('chat/messages/create-to-user', { toUserId: bob.id, fileId: upload.body.id }, alice);
		assert.equal(attached.status, 200);
		assert.equal(attached.body.file?.id, upload.body.id);
		for (let index: number = 0; index < 5; index++) await api('chat/messages/create-to-user', { toUserId: bob.id, text: `Paginated-search ${index}` }, alice);
		const found: Set<string> = new Set<string>();
		let untilId: string | undefined = undefined;
		for (;;) {
			const result: ApiResult<'chat/messages/search'> = await api('chat/messages/search', { query: 'Paginated-search', userId: alice.id, limit: 2, untilId }, bob);
			assert.equal(result.status, 200);
			for (const message of result.body) {
				assert.equal(found.has(message.id), false);
				found.add(message.id);
			}
			if (result.body.length < 2) break;
			untilId = result.body.at(-1)?.id;
		}
		assert.equal(found.size, 5);
		assert.equal((await api('chat/messages/search', { query: 'Paginated-search' }, carol)).body.length, 0);
	});

	test('空群聊、邀请、加入、收发、静音、退出和删除完整可达', /** 群聊生命周期通过真实 API 串联，不以私聊替代群聊权限。 */ async (): Promise<void> => {
		const created: ApiResult<'chat/rooms/create'> = await api('chat/rooms/create', { name: 'Lifecycle group' }, alice);
		assert.equal(created.status, 200);
		const roomId: string = created.body.id;
		const empty: ApiResult<'chat/conversations/list'> = await api('chat/conversations/list', { query: 'Lifecycle group' }, alice);
		assert.equal(empty.body.items[0].latestMessage, null);
		assertError(await api('chat/messages/create-to-room', { toRoomId: roomId, text: 'outsider' }, carol), 'CHAT_SEND_DENIED', 'NOT_ROOM_MEMBER');
		assert.equal((await api('chat/rooms/invitations/create', { roomId, userId: bob.id }, alice)).status, 200);
		assertError(await api('chat/rooms/invitations/create', { roomId, userId: bob.id }, alice), 'CHAT_OPERATION_DENIED', 'ALREADY_INVITED');
		assert.equal((await api('chat/rooms/show', { roomId }, bob)).body.isMember, false);
		assert.equal((await api('chat/rooms/join', { roomId }, bob)).status, 204);
		assert.equal((await api('chat/rooms/show', { roomId }, bob)).body.isMember, true);
		const sent: ApiResult<'chat/messages/create-to-room'> = await api('chat/messages/create-to-room', { toRoomId: roomId, text: 'group message' }, alice);
		assert.equal(sent.status, 200);
		assert.equal((await api('chat/messages/room-timeline', { roomId, markAsRead: false }, bob)).body[0].id, sent.body.id);
		const unread: ApiResult<'chat/conversations/list'> = await api('chat/conversations/list', { query: 'Lifecycle group' }, bob);
		assert.equal(unread.body.items[0].unread, true);
		await api('chat/conversations/read', { roomId, messageId: sent.body.id }, bob);
		assert.equal((await api('chat/conversations/list', { query: 'Lifecycle group' }, bob)).body.items[0].unread, false);
		assert.equal((await api('chat/messages/show', { messageId: sent.body.id }, bob)).status, 200);
		await api('chat/rooms/mute', { roomId, mute: true }, bob);
		assert.equal((await api('chat/rooms/show', { roomId }, bob)).body.isMuted, true);
		await api('chat/messages/create-to-room', { toRoomId: roomId, text: 'left-room-search' }, bob);
		await api('chat/rooms/leave', { roomId }, bob);
		assert.equal((await api('chat/messages/search', { query: 'left-room-search' }, bob)).body.length, 0);
		assert.equal((await api('chat/conversations/list', { query: 'Lifecycle group' }, bob)).body.items.length, 0);
		assert.equal((await api('chat/rooms/delete', { roomId }, alice)).status, 204);
		assert.equal((await api('chat/conversations/list', { query: 'Lifecycle group' }, alice)).body.items.length, 0);
	});
});
