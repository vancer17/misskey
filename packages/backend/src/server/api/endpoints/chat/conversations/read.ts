/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 显式会话标读 HTTP 适配器：仅标读已经观察并经服务器验证的消息位置。 */
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import type { SchemaType } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiChatMessage, MiChatRoom } from '@/models/_.js';

/** 标读操作的鉴权与不存在资源错误。 */
export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'write:chat',
	/** 标读允许正常滚动频率，同时限制重复写入成本。 */
	limit: { duration: 60_000, max: 600 },
	errors: {
		/** 聊天阅读能力未开放。 */
		unavailable: { message: 'Chat is unavailable.', code: 'CHAT_UNAVAILABLE', id: '5f6ec187-8f4b-41f8-b5ff-954f0e1c9cf9' },
		/** 可读取的目标消息不存在。 */
		noSuchMessage: { message: 'No such message.', code: 'NO_SUCH_MESSAGE', id: '73e1b545-1eaa-4ba4-880c-84d4b59119a7' },
	},
} as const;

/** 会话目标必须二选一，消息身份指向已读取的位置。 */
export const paramDef = {
	type: 'object', properties: {
		userId: { type: 'string', format: 'misskey:id' },
		roomId: { type: 'string', format: 'misskey:id' },
		messageId: { type: 'string', format: 'misskey:id' },
	}, required: ['messageId'], oneOf: [{ required: ['userId'] }, { required: ['roomId'] }],
} as const;

/** 将经过归属验证的消息位置提交给原子标读操作。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入聊天权限和未读状态的唯一所有者。 */
	constructor(private chatService: ChatService) {
		/** 验证阅读权限和消息目标，防止用任意未来身份清除未读。 */
		super(meta, paramDef, async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<void> => {
			if (!(await this.chatService.getChatAvailability(me.id)).read) throw new ApiError(meta.errors.unavailable);
			const message: MiChatMessage | null = await this.chatService.findMessageById(ps.messageId);
			if (!message) throw new ApiError(meta.errors.noSuchMessage);
			if (ps.userId) {
				if (!((message.fromUserId === me.id && message.toUserId === ps.userId) || (message.fromUserId === ps.userId && message.toUserId === me.id))) throw new ApiError(meta.errors.noSuchMessage);
				await this.chatService.readUserChatMessage(me.id, ps.userId, message.id);
			} else if (ps.roomId) {
				const room: MiChatRoom | null = await this.chatService.findRoomById(ps.roomId);
				if (!room || message.toRoomId !== room.id || !await this.chatService.isRoomMember(room, me.id)) throw new ApiError(meta.errors.noSuchMessage);
				await this.chatService.readRoomChatMessage(me.id, room.id, message.id);
			}
		});
	}
}
