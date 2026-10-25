/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Twitter 私信模块的公开入口；路由、页面和其他模块只经此入口消费业务状态及权威类型。 */
export { chatStore } from './store/index.js';
export { syncChatUnreadState } from './adapters/index.js';
export type { ChatTarget, ChatMessage, ChatUser, ChatRoom, ChatMembership, ChatInvitation, ChatAttachment, ChatDraft, ChatFailure, ContactCapability, Conversation, InboxKind, MessagesState, ReadonlyMessagesState, QueryStatus } from './domain/index.js';

/** 路由按需加载私信工作区，启动未读同步不会提前载入页面组件。 */
export async function loadTwitterMessagesPage(): Promise<typeof import('./pages/MessagesPage.vue')> {
	return await import('./pages/MessagesPage.vue');
}
