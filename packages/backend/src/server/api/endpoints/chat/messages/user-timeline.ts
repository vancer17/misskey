/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 消息时间线适配器：兼容原生标读，新工作区可选择仅查询消息。 */

import { IdentifiableError } from '@/misc/identifiable-error.js';
import type { SchemaType, Packed } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiChatRoom, MiChatMessage, MiChatRoomInvitation, MiUser } from '@/models/_.js';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { GetterService } from '@/server/api/GetterService.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { IdService } from '@/core/IdService.js';

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
			ref: 'ChatMessageLiteFor1on1',
		},
	},

	errors: {
		/** 账号角色关闭聊天阅读时明确返回权限限制。 */
		chatUnavailable: { message: 'Chat is unavailable.', code: 'CHAT_UNAVAILABLE', id: '27c4bb62-f960-4b41-841b-87d4ff92cd49' },
		/** 目标用户不存在。 */
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '11795c64-40ea-4198-b06e-3c873ed9039d',
		},
	},
} as const;

/** 当前操作仅接收目标身份、内容或简单分页参数。 */
export const paramDef = {
	type: 'object',
	properties: {
		markAsRead: { type: 'boolean', default: true },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

/** 将 HTTP 请求交给聊天领域服务处理。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入当前操作依赖的聊天服务与实体打包器。 */
	constructor(
		private chatEntityService: ChatEntityService,
		private chatService: ChatService,
		private getterService: GetterService,
		private idService: IdService,
	) {
		super(meta, paramDef, /** 校验服务端事实并执行当前聊天请求。 */ async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<Packed<'ChatMessageLiteFor1on1'>[]> => {
			const untilId: string | null = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : null);
			const sinceId: string | null = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : null);

			if (!(await this.chatService.getChatAvailability(me.id)).read) throw new ApiError(meta.errors.chatUnavailable);

			const other: MiUser = await this.getterService.getUser(ps.userId).catch(/** 将不存在目标的领域错误映射为 HTTP 业务错误。 */ (err: unknown): never => {
				if (err instanceof IdentifiableError && err.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
				throw err;
			});

			const messages: MiChatMessage[] = await this.chatService.userTimeline(me.id, other.id, ps.limit, sinceId, untilId);

			if (ps.markAsRead) await this.chatService.readUserChatMessage(me.id, other.id);

			return await this.chatEntityService.packMessagesLiteFor1on1(messages);
		});
	}
}
