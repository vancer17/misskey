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
		ref: 'ChatMessageLiteFor1on1',
	},

	errors: {
		/** 权限限制以原因码交给界面解释，服务端仍在写入前重新校验。 */
		chatSendDenied: { message: 'Chat message cannot be sent.', code: 'CHAT_SEND_DENIED', id: '3c2f3ae0-0766-4569-b8f9-888ddabf8fba' },
		recipientIsYourself: {
			message: 'You can not send a message to yourself.',
			code: 'RECIPIENT_IS_YOURSELF',
			id: '17e2ba79-e22a-4cbc-bf91-d327643f4a7e',
		},

		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '11795c64-40ea-4198-b06e-3c873ed9039d',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: '4372b8e2-185d-4146-8749-2f68864a3e5f',
		},

		contentRequired: {
			message: 'Content required. You need to set text or fileId.',
			code: 'CONTENT_REQUIRED',
			id: '25587321-b0e6-449c-9239-f8925092942c',
		},

		youHaveBeenBlocked: {
			message: 'You cannot send a message because you have been blocked by this user.',
			code: 'YOU_HAVE_BEEN_BLOCKED',
			id: 'c15a5199-7422-4968-941a-2a462c478f7d',
		},
	},
} as const;

/** 发送请求仅携带内容及目标身份，不接受客户端权限结果。 */
export const paramDef = {
	type: 'object',
	properties: {
		text: { type: 'string', nullable: true, maxLength: 2000 },
		fileId: { type: 'string', format: 'misskey:id' },
		toUserId: { type: 'string', format: 'misskey:id' },
	},
	required: ['toUserId'],
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
		super(meta, paramDef, async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<Packed<'ChatMessageLiteFor1on1'>> => {
			let file: MiDriveFile | null = null;
			if (ps.fileId != null) {
				file = await this.driveFilesRepository.findOneBy({ id: ps.fileId, userId: me.id });
				if (file == null) throw new ApiError(meta.errors.noSuchFile);
			}
			const text: string | null = ps.text?.trim() || null;
			if (text == null && file == null) throw new ApiError(meta.errors.contentRequired);
			if (ps.toUserId === me.id) throw new ApiError(meta.errors.recipientIsYourself);
			let toUser: MiUser;
			try { toUser = await this.getterService.getUser(ps.toUserId); } catch (error: unknown) {
				if (error instanceof IdentifiableError && error.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
				throw error;
			}
			try { return await this.chatService.createMessageToUser(me, toUser, { text, file }); } catch (error: unknown) {
				if (error instanceof ChatPermissionError) {
					if (error.reason === 'BLOCKED') throw new ApiError(meta.errors.youHaveBeenBlocked);
					throw new ApiError(meta.errors.chatSendDenied, { reason: error.reason });
				}
				throw error;
			}
		});
	}
}
