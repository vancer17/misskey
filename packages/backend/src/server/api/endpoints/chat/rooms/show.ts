/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 群聊资料查询适配器：验证服务端阅读策略和访问关系后提供权威成员事实。 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ChatService } from '@/core/ChatService.js';
import { ApiError } from '@/server/api/error.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';

import type { Packed, SchemaType } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiChatRoom } from '@/models/_.js';

/** 群聊资料的阅读权限和不存在资源错误协议。 */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	kind: 'read:chat',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'ChatRoom',
	},

	errors: {
		/** 当前账号不具备聊天阅读权限，作为明确业务拒绝返回。 */
		chatUnavailable: { message: 'Chat is unavailable.', code: 'CHAT_UNAVAILABLE', id: 'dffeaf42-0cc5-4f24-9144-dd3b6d240c1b' },
		/** 目标群聊不存在或当前账号无权查看。 */
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '857ae02f-8759-4d20-9adb-6e95fffe4fd7',
		},
	},
} as const;

/** 请求仅携带群聊标识，不接收客户端成员或权限判断。 */
export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
	},
	required: ['roomId'],
} as const;

/** 查询服务端群实体及当前账号关系。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入聊天权限服务与实体打包器。 */
	constructor(
		private chatService: ChatService,
		private chatEntityService: ChatEntityService,
	) {
		super(meta, paramDef, /** 验证阅读权限后单向打包群聊事实。 */ async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<Packed<'ChatRoom'>> => {
			if (!(await this.chatService.getChatAvailability(me.id)).read) throw new ApiError(meta.errors.chatUnavailable);

			const room: MiChatRoom | null = await this.chatService.findRoomById(ps.roomId);
			if (room == null) {
				throw new ApiError(meta.errors.noSuchRoom);
			}

			if (!await this.chatService.hasPermissionToViewRoomInfo(me.id, room)) {
				throw new ApiError(meta.errors.noSuchRoom);
			}

			return this.chatEntityService.packRoom(room, me);
		});
	}
}
