/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通知已读接口：等待服务端已读水位写入与同步事件发布后返回成功，不新增协议字段。 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NotificationService } from '@/core/NotificationService.js';
import type { SchemaType } from '@/misc/json-schema.js';
import type { MiLocalUser } from '@/models/User.js';

export const meta = {
	tags: ['notifications', 'account'],

	requireCredential: true,

	kind: 'write:notifications',
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private notificationService: NotificationService,
	) {
		super(meta, paramDef, /** HTTP 成功表示当前账户的已读水位已完成持久化。 */ async (ps: SchemaType<typeof paramDef>, me: MiLocalUser): Promise<void> => {
			await this.notificationService.readAllNotification(me.id, true);
		});
	}
}
