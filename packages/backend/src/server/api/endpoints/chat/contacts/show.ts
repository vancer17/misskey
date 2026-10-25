/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 联系能力 HTTP 适配器：返回双方服务端权限事实，供主页和编辑器共同消费。 */
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import type { SchemaType } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { GetterService } from '@/server/api/GetterService.js';
import { chatContactReasons } from '@/core/chat/domain/index.js';
import type { ChatContact } from '@/core/chat/domain/index.js';
import type { MiUser } from '@/models/_.js';

/** 联系查询响应协议，原因仅解释服务端判断。 */
export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	/** 限制会话聚合及能力查询的服务端成本。 */
	limit: { duration: 60_000, max: 240 },
	errors: {
		/** 目标用户不存在。 */
		noSuchUser: { message: 'No such user.', code: 'NO_SUCH_USER', id: 'b2de1618-40db-4347-bc42-e25e58c19845' },
	},
	res: { type: 'object', optional: false, nullable: false, properties: {
		canRead: { type: 'boolean', optional: false, nullable: false },
		canSend: { type: 'boolean', optional: false, nullable: false },
		reason: { type: 'string', optional: false, nullable: true, enum: [...Object.values(chatContactReasons), null] },
	} },
} as const;

/** 目标身份是查询唯一输入，不接收客户端授权结果。 */
export const paramDef = { type: 'object', properties: { userId: { type: 'string', format: 'misskey:id' } }, required: ['userId'] } as const;

/** 连接用户仓储查询与聊天联系能力。 */
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	/** 注入查询服务和聊天领域服务。 */
	constructor(private chatService: ChatService, private getterService: GetterService) {
		/** 查询真实目标并单向派生当前联系权限。 */
		super(meta, paramDef, async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<ChatContact> => {
			let user: MiUser;
			try { user = await this.getterService.getUser(ps.userId); } catch (error: unknown) {
				if (error instanceof IdentifiableError && error.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
				throw error;
			}
			return await this.chatService.getContactState(me.id, user);
		});
	}
}
