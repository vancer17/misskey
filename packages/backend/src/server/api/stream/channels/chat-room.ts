/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 聊天会话流适配器：在订阅与事件交付时验证服务端阅读权限。 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import type { JsonObject } from '@/misc/json-value.js';
import { ChatService } from '@/core/ChatService.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';
import type { ChatRoomsRepository, MiChatRoom } from '@/models/_.js';

@Injectable({ scope: Scope.TRANSIENT })
export class ChatRoomChannel extends Channel {
	public readonly chName = 'chatRoom';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:chat';
	private roomId: string;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		private chatService: ChatService,
	) {
		super(request);
	}

	/** 只为具有聊天阅读权限的当前账号建立订阅。 */
	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		if (typeof params.roomId !== 'string') return false;
		if (!this.user) return false;
		if (!(await this.chatService.getChatAvailability(this.user.id)).read) return false;

		this.roomId = params.roomId;

		const room: MiChatRoom | null = await this.chatRoomsRepository.findOneBy({
			id: this.roomId,
		});

		if (room == null) return false;
		if (!(await this.chatService.hasPermissionToViewRoomTimeline(this.user.id, room))) return false;

		this.subscriber.on(`chatRoomStream:${this.roomId}`, this.onEvent);

		return true;
	}

	/** 权限撤销后不继续向已建立的流交付聊天内容。 */
	@bindThis
	private async onEvent(data: GlobalEvents['chatRoom']['payload']): Promise<void> {
		if (!this.user || !(await this.chatService.getChatAvailability(this.user.id)).read) return;
		const room: MiChatRoom | null = await this.chatService.findRoomById(this.roomId);
		if (!room || !await this.chatService.hasPermissionToViewRoomTimeline(this.user.id, room)) return;
		this.send(data.type, data.body);
	}

	@bindThis
	public onMessage(type: string, body: any) {
		switch (type) {
			case 'read':
				if (this.roomId) {
					this.chatService.readRoomChatMessage(this.user!.id, this.roomId);
				}
				break;
		}
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`chatRoomStream:${this.roomId}`, this.onEvent);
	}
}
