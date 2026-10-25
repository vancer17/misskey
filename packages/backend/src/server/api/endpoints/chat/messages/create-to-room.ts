/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 聊天发送适配器：解析请求内容、校验附件所有权并返回结构化业务结果。 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import type { DriveFilesRepository, MiDriveFile, MiUser, MiChatRoom } from '@/models/_.js';

import { ChatPermissionError } from '@/core/chat/domain/index.js';
import type { SchemaType, Packed } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

/** 声明聊天发送 HTTP 协议及可预期的业务拒绝。 */
export const meta = {
	tags: ['chat'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:chat',

	limit: {
		duration: ms('1hour'),
		max: 500,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'ChatMessageLiteForRoom',
	},

	errors: {
		/** 权限限制以原因码交给界面解释，服务端仍在写入前重新校验。 */
		chatSendDenied: { message: 'Chat message cannot be sent.', code: 'CHAT_SEND_DENIED', id: 'bc9b8892-dab6-490d-9286-f75e5696b3de' },
		noSuchRoom: {
			message: 'No such room.',
			code: 'NO_SUCH_ROOM',
			id: '8098520d-2da5-4e8f-8ee1-df78b55a4ec6',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'b6accbd3-1d7b-4d9f-bdb7-eb185bac06db',
		},

		contentRequired: {
			message: 'Content required. You need to set text or fileId.',
			code: 'CONTENT_REQUIRED',
			id: '340517b7-6d04-42c0-bac1-37ee804e3594',
		},
	},
} as const;

/** 发送请求仅携带内容及目标身份，不接受客户端权限结果。 */
export const paramDef = {
	type: 'object',
	properties: {
		text: { type: 'string', nullable: true, maxLength: 2000 },
		fileId: { type: 'string', format: 'misskey:id' },
		toRoomId: { type: 'string', format: 'misskey:id' },
	},
	required: ['toRoomId'],
} as const;

/** 将 HTTP 内容映射到唯一聊天服务并转换领域错误。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入附件所有权查询和聊天领域服务。 */
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private getterService: GetterService,
		private chatService: ChatService,
	) {
		/** 解析附件所有权并提交发送，以服务端回执作为消息事实。 */
		super(meta, paramDef, async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<Packed<'ChatMessageLiteForRoom'>> => {
			let file: MiDriveFile | null = null;
			if (ps.fileId != null) {
				file = await this.driveFilesRepository.findOneBy({ id: ps.fileId, userId: me.id });
				if (file == null) throw new ApiError(meta.errors.noSuchFile);
			}
			const text: string | null = ps.text?.trim() || null;
			if (text == null && file == null) throw new ApiError(meta.errors.contentRequired);
			const room: MiChatRoom | null = await this.chatService.findRoomById(ps.toRoomId);
			if (!room) throw new ApiError(meta.errors.noSuchRoom);
			try { return await this.chatService.createMessageToRoom(me, room, { text, file }); } catch (error: unknown) {
				if (error instanceof ChatPermissionError) throw new ApiError(meta.errors.chatSendDenied, { reason: error.reason });
				throw error;
			}
		});
	}
}
