/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 群聊生命周期 HTTP 适配器：保持既有操作并返回可解释的业务限制。 */

import type { SchemaType, Packed } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiChatRoom, MiChatMessage, MiChatRoomInvitation, MiUser } from '@/models/_.js';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatPermissionError } from '@/core/chat/domain/index.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';

/** 当前聊天操作的认证、响应和业务错误契约。 */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'write:chat',

	errors: {
		/** 群聊生命周期业务限制以原因码返回。 */
		chatOperationDenied: { message: 'Chat operation cannot be completed.', code: 'CHAT_OPERATION_DENIED', id: '2adb8f65-f8bd-44fc-b0d1-84632a3f72d5' },
		/** 操作目标不存在或当前账号无权访问。 */
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '84416476-5ce8-4a2c-b568-9569f1b10733',
		},
	},
} as const;

/** 当前操作仅接收目标身份、内容或简单分页参数。 */
export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
	},
	required: ['roomId'],
} as const;

/** 将 HTTP 请求交给聊天领域服务处理。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入当前操作依赖的聊天服务与实体打包器。 */
	constructor(
		private chatService: ChatService,
	) {
		super(meta, paramDef, /** 校验服务端事实并执行当前聊天请求。 */ async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<void> => {
			try {
				await this.chatService.checkChatAvailability(me.id, 'write');

				await this.chatService.joinToRoom(me.id, ps.roomId);
			} catch (error: unknown) {
				if (error instanceof ChatPermissionError) throw new ApiError(meta.errors.chatOperationDenied, { reason: error.reason });
				throw error;
			}
		});
	}
}
