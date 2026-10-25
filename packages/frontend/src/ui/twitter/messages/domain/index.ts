/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 私信领域的公开模型。
 * 服务端实体及业务权限直接派生自 misskey-js；此处仅定义客户端查询、草稿和命令生命周期，
 * 不复制用户、消息、会话或接收范围等服务端业务定义。
 */
import type { Endpoints, entities } from 'misskey-js';

/** 服务端会话列表的唯一协议模型，是收件箱事实的输入。 */
export type Conversation = Readonly<Endpoints['chat/conversations/list']['res']['items'][number]>;
/** 会话标识由服务端契约派生，路由只传递该标识。 */
export type ChatTarget = Conversation['target'];
/** 收件箱筛选值直接派生自服务端请求。 */
export type InboxKind = NonNullable<Endpoints['chat/conversations/list']['req']['kind']>;
/** 双方联系能力由服务端判定，前端只消费结果。 */
export type ContactCapability = Readonly<Endpoints['chat/contacts/show']['res']>;
/** 消息只读视图保留服务端权威结构，不赋予 isRead 对方已读的含义。 */
export type ChatMessage = Readonly<entities.ChatMessage>;
/** 用户视图沿用 Misskey 权威类型。 */
export type ChatUser = Readonly<entities.UserDetailed>;
/** 群聊视图沿用 Misskey 权威类型。 */
export type ChatRoom = Readonly<entities.ChatRoom>;
/** 群成员视图沿用 Misskey 权威类型。 */
export type ChatMembership = Readonly<entities.ChatRoomMembership>;
/** 群邀请视图沿用 Misskey 权威类型。 */
export type ChatInvitation = Readonly<entities.ChatRoomInvitation>;
/** 附件只读视图沿用网盘权威类型。 */
export type ChatAttachment = Readonly<entities.DriveFile>;
/** 查询的客户端生命周期，不承担业务权限判断。 */
export type QueryStatus = 'idle' | 'loading' | 'ready' | 'error';
/** 命令超时与明确拒绝分离，避免未经确认的自动重发。 */
export type CommandStatus = 'idle' | 'sending' | 'failed' | 'uncertain';
/** 客户端错误仅保留可展示的协议代码，不复制服务端策略。 */
export type ChatFailure = Readonly<{ code: string; message: string; reason: string | null }>;
/** 当前账户内有界保存的临时草稿，不写入本地持久化。 */
export type ChatDraft = Readonly<{ text: string; file: ChatAttachment | null }>;
/** 收件箱状态保留最后确认的列表，查询失败不会伪装成空列表。 */
export type InboxState = {
	items: readonly Conversation[];
	nextCursor: string | null;
	query: string;
	kind: InboxKind;
	status: QueryStatus;
	error: ChatFailure | null;
};
/** 当前会话状态由 Store 独占，组件只接收只读投影。 */
export type ActiveConversation = {
	target: ChatTarget | null;
	user: ChatUser | null;
	room: ChatRoom | null;
	contact: ContactCapability | null;
	readonly canRead: boolean;
	readonly canSend: boolean;
	messages: readonly ChatMessage[];
	hasMore: boolean;
	status: QueryStatus;
	error: ChatFailure | null;
};
/** 消息搜索保留服务端顺序和游标，不参与会话业务决策。 */
export type MessageSearchState = {
	query: string;
	items: readonly ChatMessage[];
	hasMore: boolean;
	status: QueryStatus;
	error: ChatFailure | null;
};
/** 私信账户状态的唯一内存所有者；切换账户即清空所有消息和草稿。 */
export type MessagesState = {
	accountId: string | null;
	inbox: InboxState;
	active: ActiveConversation;
	draft: ChatDraft;
	command: { status: CommandStatus; error: ChatFailure | null };
	search: MessageSearchState;
	members: readonly ChatMembership[];
	rooms: readonly ChatRoom[];
	invitations: readonly ChatInvitation[];
	sentInvitations: readonly ChatInvitation[];
	roomStatus: QueryStatus;
	roomError: ChatFailure | null;
	focusedMessageId: string | null;
};

/** 公开状态逐层只读，保留既有基础组件的实体 props 契约。 */
export type ReadonlyMessagesState = Readonly<Omit<MessagesState, 'inbox' | 'active' | 'command' | 'search'> & {
	inbox: Readonly<InboxState>;
	active: Readonly<ActiveConversation>;
	command: Readonly<MessagesState['command']>;
	search: Readonly<MessageSearchState>;
}>;
