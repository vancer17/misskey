/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 私信协议适配器测试。
 * 仅证明请求序列化、账户归属保护、省略字段归一化、冻结和错误映射；
 * 不以 Mock 证明私信授权、业务行为、多轮交互或已读并发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { entities } from 'misskey-js';
import { failureFrom, freezeEntity, isUncertainFailure, normalizeMessage, request, syncChatUnreadState } from '@/ui/twitter/messages/adapters/index.js';

/** 认证依赖替身只用于检查协议账户绑定，不创建业务账户。 */
const auth: { account: { id: string; token: string; hasUnreadChatMessages: boolean } } = vi.hoisted(/** 保证认证替身在适配器加载前安装。 */ (): { account: { id: string; token: string; hasUnreadChatMessages: boolean } } => ({ account: { id: 'alice', token: 'fixture-token', hasUnreadChatMessages: false } }));
vi.mock('@/i.js', /** 替换认证边界，不模拟业务授权服务。 */ (): { $i: typeof auth.account } => ({ $i: auth.account }));
vi.mock('@/accounts.js', /** 检查协议快照只经现有账户所有者提交。 */ (): { updateCurrentAccountPartial: (value: { hasUnreadChatMessages?: boolean }) => void } => ({
	/** 仅映射测试中的快照布尔值，不实现账户业务。 */
	updateCurrentAccountPartial: (value: { hasUnreadChatMessages?: boolean }): void => { if (value.hasUnreadChatMessages !== undefined) auth.account.hasUnreadChatMessages = value.hasUnreadChatMessages; },
}));

beforeEach(/** 清除全局 fetch 替身既有调用，建立本例凭据输入。 */ (): void => {
	vi.clearAllMocks();
	window.localStorage.setItem('account', JSON.stringify(auth.account));
});

/** 生成符合权威用户 Schema 的最小协议样例。 */
function user(id: string): entities.UserLite {
	return { id, username: id, name: id, host: null, avatarUrl: '/avatar.png', avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'unknown' };
}

/** 每个协议样例还原原生网络与认证引用。 */
afterEach(/** 防止协议替身影响其他测试文件。 */ (): void => {
	vi.restoreAllMocks();
	auth.account.id = 'alice';
	auth.account.hasUnreadChatMessages = false;
});

describe('Twitter 私信协议适配器', /** 本组仅检查协议与映射。 */ (): void => {
	it('时间线明确序列化不标读、游标、固定账户令牌和取消信号', /** 查询不能隐式调用服务器读取即标读行为。 */ async (): Promise<void> => {
		const fetchSpy: MockInstance<typeof window.fetch> = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
		const controller: AbortController = new AbortController();
		await request('alice', 'chat/messages/user-timeline', { userId: 'bob', untilId: 'cursor-message', markAsRead: false, limit: 30 }, controller.signal);
		expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/chat/messages/user-timeline'), expect.objectContaining({
			method: 'POST', signal: controller.signal,
			body: JSON.stringify({ userId: 'bob', untilId: 'cursor-message', markAsRead: false, limit: 30, i: 'fixture-token' }),
		}));
	});
	it('不透明会话游标原样送至服务端', /** 客户端不得解释游标为消息或会话事实。 */ async (): Promise<void> => {
		const fetchSpy: MockInstance<typeof window.fetch> = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{"items":[],"nextCursor":null}', { status: 200 }));
		await request('alice', 'chat/conversations/list', { kind: 'all', query: '样例', cursor: 'opaque/+=cursor' }, new AbortController().signal);
		expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ kind: 'all', query: '样例', cursor: 'opaque/+=cursor', i: 'fixture-token' }) }));
	});
	it('账户变化时拒绝请求且不发送网络数据', /** 旧页面不得借用新账户认证。 */ async (): Promise<void> => {
		const fetchSpy: MockInstance<typeof window.fetch> = vi.spyOn(window, 'fetch');
		await expect(request('other-account', 'chat/rooms/owned', {}, new AbortController().signal)).rejects.toThrow('ACCOUNT_CHANGED');
		expect(fetchSpy).not.toHaveBeenCalled();
	});
	it('补齐私聊省略发送者及接收者反应，不改写消息内容', /** 一对一反应者来自真实的接收者协议规则。 */ (): void => {
		const message: entities.ChatMessageLite = { id: 'message', createdAt: '2026-10-25T00:00:00Z', fromUserId: 'alice', toUserId: 'bob', text: 'hello', reactions: [{ reaction: '👍' }] };
		const normalized: ReturnType<typeof normalizeMessage> = normalizeMessage(message, user('alice'), user('bob'));
		expect(normalized.fromUser.id).toBe('alice');
		expect(normalized.reactions[0].user.id).toBe('bob');
		expect(normalized.text).toBe('hello');
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized.reactions)).toBe(true);
		expect(Object.isFrozen(normalized.fromUser.avatarDecorations)).toBe(true);
	});
	it('群聊缺失发送者时拒绝用当前账户冒充', /** 损坏协议不能变为错误的权威消息。 */ (): void => {
		expect(/** 只调用归一化边界。 */ (): void => { normalizeMessage({ id: 'broken', createdAt: '2026-10-25T00:00:00Z', fromUserId: 'unknown', toRoomId: 'room', reactions: [] }, user('alice'), null); }).toThrow('MESSAGE_SENDER_MISSING');
	});
	it('已完整携带的群反应保留服务端成员', /** 不用私聊补齐规则覆盖群成员。 */ (): void => {
		const member: entities.UserLite = user('member');
		const normalized: ReturnType<typeof normalizeMessage> = normalizeMessage({ id: 'message', createdAt: '2026-10-25T00:00:00Z', fromUserId: member.id, fromUser: member, toRoomId: 'room', reactions: [{ reaction: '👍', user: user('reactor') }] }, user('alice'), null);
		expect(normalized.fromUser.id).toBe('member');
		expect(normalized.reactions[0].user.id).toBe('reactor');
	});
	it('业务拒绝与传输不确定结果分开，保留服务端原因', /** 只有明确的 API 拒绝可安全表现为失败。 */ (): void => {
		const denied: { code: string; message: string; info: { reason: string } } = { code: 'CHAT_SEND_DENIED', message: 'denied', info: { reason: 'RECIPIENT_SCOPE' } };
		expect(isUncertainFailure(denied)).toBe(false);
		expect(isUncertainFailure(new TypeError('Failed to fetch'))).toBe(true);
		expect(isUncertainFailure(new DOMException('aborted', 'AbortError'))).toBe(true);
		expect(failureFrom(denied)).toEqual({ code: 'CHAT_SEND_DENIED', message: 'denied', reason: 'RECIPIENT_SCOPE' });
	});
	it('递归冻结只产生只读事实，不创建第二套实体模型', /** 验证适配器的不可变交付边界。 */ (): void => {
		const value: { nested: { ids: string[] } } = { nested: { ids: ['one'] } };
		expect(freezeEntity(value)).toBe(value);
		expect(Object.isFrozen(value.nested.ids)).toBe(true);
	});
	it('未读同步只消费账户快照中的权威布尔值', /** Mock 仅证明快照映射，不证明真实未读行为。 */ async (): Promise<void> => {
		vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{"hasUnreadChatMessages":true}', { status: 200 }));
		expect(await syncChatUnreadState()).toBe(true);
		expect(auth.account.hasUnreadChatMessages).toBe(true);
	});
});
