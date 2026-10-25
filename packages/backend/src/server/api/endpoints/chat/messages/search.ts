/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 聊天搜索适配器：在服务端权限范围内按消息位置连续分页。 */

import type { SchemaType, Packed } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiChatRoom, MiChatMessage, MiChatRoomInvitation, MiUser } from '@/models/_.js';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApiError } from '@/server/api/error.js';

/** 当前聊天操作的认证、响应和业务错误契约。 */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'read:chat',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'ChatMessage',
		},
	},

	errors: {
		/** 账号角色关闭聊天阅读时明确返回权限限制。 */
		chatUnavailable: { message: 'Chat is unavailable.', code: 'CHAT_UNAVAILABLE', id: '7c02d6fc-d399-4712-a800-97cd180d12a1' },
		/** 操作目标不存在或当前账号无权访问。 */
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '460b3669-81b0-4dc9-a997-44442141bf83',
		},
	},
} as const;

/** 当前操作仅接收目标身份、内容或简单分页参数。 */
export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string', minLength: 1, maxLength: 256 },
		untilId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		userId: { type: 'string', format: 'misskey:id', nullable: true },
		roomId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: ['query'],
} as const;

/** 将 HTTP 请求交给聊天领域服务处理。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入当前操作依赖的聊天服务与实体打包器。 */
	constructor(
		private chatEntityService: ChatEntityService,
		private chatService: ChatService,
	) {
		super(meta, paramDef, /** 校验服务端事实并执行当前聊天请求。 */ async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<Packed<'ChatMessage'>[]> => {
			if (!(await this.chatService.getChatAvailability(me.id)).read) throw new ApiError(meta.errors.chatUnavailable);

			if (ps.roomId != null) {
				const room: MiChatRoom | null = await this.chatService.findRoomById(ps.roomId);
				if (room == null) {
					throw new ApiError(meta.errors.noSuchRoom);
				}

				if (!(await this.chatService.isRoomMember(room, me.id))) {
					throw new ApiError(meta.errors.noSuchRoom);
				}
			}

			const messages: MiChatMessage[] = await this.chatService.searchMessages(me.id, ps.query, ps.limit, {
				userId: ps.userId,
				roomId: ps.roomId,
				untilId: ps.untilId,
			});

			return await this.chatEntityService.packMessagesDetailed(messages, me);
		});
	}
}
