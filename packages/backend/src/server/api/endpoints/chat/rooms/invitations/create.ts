/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 群聊生命周期 HTTP 适配器：保持既有操作并返回可解释的业务限制。 */

import type { SchemaType, Packed } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiChatRoom, MiChatMessage, MiChatRoomInvitation, MiUser } from '@/models/_.js';
import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ChatPermissionError } from '@/core/chat/domain/index.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';

/** 当前聊天操作的认证、响应和业务错误契约。 */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:chat',

	limit: {
		duration: ms('1day'),
		max: 50,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'ChatRoomInvitation',
	},

	errors: {
		/** 群聊生命周期业务限制以原因码返回。 */
		chatOperationDenied: { message: 'Chat operation cannot be completed.', code: 'CHAT_OPERATION_DENIED', id: 'abd86a9d-237c-4d66-9486-23e2af7ed668' },
		/** 操作目标不存在或当前账号无权访问。 */
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '916f9507-49ba-4e90-b57f-1fd4deaa47a5',
		},
	},
} as const;

/** 当前操作仅接收目标身份、内容或简单分页参数。 */
export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['roomId', 'userId'],
} as const;

/** 将 HTTP 请求交给聊天领域服务处理。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入当前操作依赖的聊天服务与实体打包器。 */
	constructor(
		private chatService: ChatService,
		private chatEntityService: ChatEntityService,
	) {
		super(meta, paramDef, /** 校验服务端事实并执行当前聊天请求。 */ async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<Packed<'ChatRoomInvitation'>> => {
			try {
				await this.chatService.checkChatAvailability(me.id, 'write');

				const room: MiChatRoom | null = await this.chatService.findMyRoomById(me.id, ps.roomId);
				if (room == null) {
					throw new ApiError(meta.errors.noSuchRoom);
				}
				const invitation: MiChatRoomInvitation = await this.chatService.createRoomInvitation(me.id, room.id, ps.userId);
				return await this.chatEntityService.packRoomInvitation(invitation, me);
			} catch (error: unknown) {
				if (error instanceof ChatPermissionError) throw new ApiError(meta.errors.chatOperationDenied, { reason: error.reason });
				throw error;
			}
		});
	}
}
