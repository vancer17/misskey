/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 聊天 HTTP 适配器：返回完整会话索引，游标始终作用于聚合后的会话集合。 */
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import type { SchemaType } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import { ChatCursorError } from '@/core/chat/domain/index.js';
import type { ChatConversationPage } from '@/core/chat/domain/index.js';

/** 会话列表的鉴权、响应和业务错误协议。 */
export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	/** 限制会话聚合及能力查询的服务端成本。 */
	limit: { duration: 60_000, max: 120 },
	errors: {
		/** 聊天阅读能力未开放。 */
		unavailable: { message: 'Chat is unavailable.', code: 'CHAT_UNAVAILABLE', id: 'cb0b8957-e673-4945-a343-031a4581d207' },
		/** 会话分页位置无效。 */
		invalidCursor: { message: 'Invalid conversation cursor.', code: 'INVALID_CURSOR', id: '790485fd-7195-4798-97b9-6ae7d6e1b97e' },
	},
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			items: { type: 'array', optional: false, nullable: false, items: {
				type: 'object', optional: false, nullable: false, properties: {
					key: { type: 'string', optional: false, nullable: false },
					target: { type: 'object', optional: false, nullable: false, properties: {
						type: { type: 'string', enum: ['user', 'room'], optional: false, nullable: false },
						id: { type: 'string', format: 'id', optional: false, nullable: false },
					} },
					latestMessage: { type: 'object', ref: 'ChatMessage', optional: false, nullable: true },
					unread: { type: 'boolean', optional: false, nullable: false },
					user: { type: 'object', ref: 'UserLite', optional: true, nullable: false },
					room: { type: 'object', ref: 'ChatRoom', optional: true, nullable: false },
				},
			} },
			nextCursor: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

/** 只包含过滤条件和不透明游标的请求 Schema。 */
export const paramDef = {
	type: 'object', properties: {
		kind: { type: 'string', enum: ['all', 'user', 'room'], default: 'all' },
		query: { type: 'string', maxLength: 256 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		cursor: { type: 'string', maxLength: 1024 },
	},
} as const;

/** 将列表请求委托给聊天领域服务，不复制会话聚合规则。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入唯一会话服务并声明 HTTP 到领域的映射。 */
	constructor(private chatService: ChatService) {
		/** 校验账号阅读能力，并映射可预期的游标格式拒绝。 */
		super(meta, paramDef, async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<ChatConversationPage> => {
			if (!(await this.chatService.getChatAvailability(me.id)).read) throw new ApiError(meta.errors.unavailable);
			try {
				return await this.chatService.listConversations(me.id, ps);
			} catch (error: unknown) {
				if (error instanceof ChatCursorError) throw new ApiError(meta.errors.invalidCursor);
				throw error;
			}
		});
	}
}
