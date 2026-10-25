/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 聊天会话流适配器：在订阅与事件交付时验证服务端阅读权限。 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import type { JsonObject } from '@/misc/json-value.js';
import { ChatService } from '@/core/ChatService.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class ChatUserChannel extends Channel {
	public readonly chName = 'chatUser';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:chat';
	private otherId: string;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private chatService: ChatService,
	) {
		super(request);
	}

	/** 只为具有聊天阅读权限的当前账号建立订阅。 */
	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		if (typeof params.otherId !== 'string') return false;
		if (!this.user) return false;
		if (!(await this.chatService.getChatAvailability(this.user.id)).read) return false;
		if (params.otherId === this.user.id) return false;

		this.otherId = params.otherId;

		this.subscriber.on(`chatUserStream:${this.user.id}-${this.otherId}`, this.onEvent);

		return true;
	}

	/** 权限撤销后不继续向已建立的流交付聊天内容。 */
	@bindThis
	private async onEvent(data: GlobalEvents['chatUser']['payload']): Promise<void> {
		if (!this.user || !(await this.chatService.getChatAvailability(this.user.id)).read) return;
		this.send(data.type, data.body);
	}

	@bindThis
	public onMessage(type: string, body: any) {
		switch (type) {
			case 'read':
				if (this.otherId) {
					this.chatService.readUserChatMessage(this.user!.id, this.otherId);
				}
				break;
		}
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`chatUserStream:${this.user!.id}-${this.otherId}`, this.onEvent);
	}
}
