/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 聊天领域的服务端契约：集中定义联系权限、会话索引及可预期的业务拒绝。
 * HTTP 适配器负责把领域拒绝转换为结构化 API 错误，不在客户端重建授权规则。
 */
import type { Packed } from '@/misc/json-schema.js';

/** 联系权限原因的权威字面量，HTTP Schema 与业务类型共同派生。 */
export const chatContactReasons = {
	/** 不允许向自己发送私信。 */
	self: 'SELF',
	/** 当前聊天服务只支持本地用户。 */
	remoteUser: 'REMOTE_USER',
	/** 当前账号无法阅读或发送聊天。 */
	chatUnavailable: 'CHAT_UNAVAILABLE',
	/** 当前账号只具备聊天阅读权限。 */
	chatReadOnly: 'CHAT_READ_ONLY',
	/** 收件账号的角色策略未开放聊天。 */
	recipientUnavailable: 'RECIPIENT_UNAVAILABLE',
	/** 双方存在拉黑关系。 */
	blocked: 'BLOCKED',
	/** 未满足收件账号的接收范围。 */
	recipientScope: 'RECIPIENT_SCOPE',
} as const;

/** 联系权限拒绝原因；由权威字面量派生供界面解释。 */
export type ChatContactReason = typeof chatContactReasons[keyof typeof chatContactReasons];

/** 当前账号与目标用户之间的阅读及发送能力。 */
export type ChatContact = { canRead: boolean; canSend: boolean; reason: ChatContactReason | null };

/** 发送链路可识别的业务拒绝，避免预期限制退化为内部错误。 */
export class ChatPermissionError extends Error {
	/** 将服务端权限判断携带至 API 错误映射。 */
	constructor(public readonly reason: ChatContactReason | 'NOT_ROOM_MEMBER' | 'CONTENT_REQUIRED' | 'ALREADY_MEMBER' | 'ALREADY_INVITED' | 'ROOM_FULL' | 'NO_INVITATION' | 'NO_SUCH_USER') {
		super(reason);
	}
}

/** 会话列表的规范查询参数，不承载消息实体副本。 */
export type ChatConversationQuery = { kind: 'all' | 'user' | 'room'; query?: string; limit: number; cursor?: string };

/** 数据库聚合产生的会话位置，消息聚合先于游标截断。 */
export type ChatConversationPosition = { type: 'user' | 'room'; targetId: string; latestId: string | null; sortId: string; key: string };

/** 提供给会话视图的服务端索引，空群聊以空最新消息表示。 */
export type ChatConversation = {
	key: string;
	target: { type: 'user' | 'room'; id: string };
	latestMessage: Packed<'ChatMessage'> | null;
	unread: boolean;
	user?: Packed<'UserLite'>;
	room?: Packed<'ChatRoom'>;
};

/** 会话索引的一页及下一页的不透明位置。 */
export type ChatConversationPage = { items: ChatConversation[]; nextCursor: string | null };

/** 游标格式拒绝，供 API 映射为参数错误。 */
export class ChatCursorError extends Error {}
