/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 聊天业务服务：统一授权、消息和群聊生命周期、会话索引与账号级未读同步。 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Brackets, In } from 'typeorm';
import type { SelectQueryBuilder, WhereExpressionBuilder } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { PushNotificationService } from '@/core/PushNotificationService.js';
import { bindThis } from '@/decorators.js';
import type { ChatApprovalsRepository, ChatMessagesRepository, ChatRoomInvitationsRepository, ChatRoomMembershipsRepository, ChatRoomsRepository, MiChatMessage, MiChatRoom, MiChatRoomMembership, MiDriveFile, MiEmoji, MiUser, MutingsRepository, UsersRepository } from '@/models/_.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';
import { QueryService } from '@/core/QueryService.js';
import { RoleService } from '@/core/RoleService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { MiChatRoomInvitation } from '@/models/ChatRoomInvitation.js';
import { Packed } from '@/misc/json-schema.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { emojiRegex } from '@/misc/emoji-regex.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

import { ChatCursorError, ChatPermissionError } from '@/core/chat/domain/index.js';
import type { ChatContact, ChatContactReason, ChatConversation, ChatConversationPage, ChatConversationPosition, ChatConversationQuery } from '@/core/chat/domain/index.js';

const MAX_ROOM_MEMBERS = 50;
const MAX_REACTIONS_PER_MESSAGE = 100;
const isCustomEmojiRegexp = /^:([\w+-]+)(?:@\.)?:$/;

// TODO: ReactionServiceのやつと共通化
function normalizeEmojiString(x: string) {
	const match = emojiRegex.exec(x);
	if (match) {
		// 合字を含む1つの絵文字
		const unicode = match[0];

		// 異体字セレクタ除去
		return unicode.match('\u200d') ? unicode : unicode.replace(/\ufe0f/g, '');
	} else {
		throw new Error('invalid emoji');
	}
}

@Injectable()
export class ChatService implements OnApplicationShutdown {
	/** 跟踪待发通知任务，避免服务关闭后继续访问已释放的 Redis。 */
	private readonly notificationTimers: Set<ReturnType<typeof setTimeout>> = new Set<ReturnType<typeof setTimeout>>();

	/** 关闭应用时清理尚未执行的延迟通知。 */
	public onApplicationShutdown(): void {
		for (const timer of this.notificationTimers) clearTimeout(timer);
		this.notificationTimers.clear();
	}

	/** 将现有延迟推送登记到应用生命周期，不新增声音或推送消费者。 */
	private scheduleNotification(task: () => Promise<void>): void {
		const timer: ReturnType<typeof setTimeout> = setTimeout(/** 执行已登记的服务端通知。 */ async (): Promise<void> => {
			this.notificationTimers.delete(timer);
			await task();
		}, 3000);
		this.notificationTimers.add(timer);
	}

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,

		@Inject(DI.chatApprovalsRepository)
		private chatApprovalsRepository: ChatApprovalsRepository,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		@Inject(DI.chatRoomInvitationsRepository)
		private chatRoomInvitationsRepository: ChatRoomInvitationsRepository,

		@Inject(DI.chatRoomMembershipsRepository)
		private chatRoomMembershipsRepository: ChatRoomMembershipsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		private userEntityService: UserEntityService,
		private chatEntityService: ChatEntityService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private apRendererService: ApRendererService,
		private queueService: QueueService,
		private pushNotificationService: PushNotificationService,
		private notificationService: NotificationService,
		private userBlockingService: UserBlockingService,
		private queryService: QueryService,
		private roleService: RoleService,
		private userFollowingService: UserFollowingService,
		private customEmojiService: CustomEmojiService,
		private moderationLogService: ModerationLogService,
	) {
	}

	@bindThis
	public async getChatAvailability(userId: MiUser['id']): Promise<{ read: boolean; write: boolean; }> {
		const policies = await this.roleService.getUserPolicies(userId);

		switch (policies.chatAvailability) {
			case 'available':
				return {
					read: true,
					write: true,
				};
			case 'readonly':
				return {
					read: true,
					write: false,
				};
			case 'unavailable':
				return {
					read: false,
					write: false,
				};
			default:
				throw new Error('invalid chat availability (unreachable)');
		}
	}

	/** 将账号策略校验用于既有 API 操作，不把权限限制当作内部故障。 */
	@bindThis
	public async checkChatAvailability(userId: MiUser['id'], permission: 'read' | 'write'): Promise<void> {
		const policy: { read: boolean; write: boolean } = await this.getChatAvailability(userId);
		if (policy[permission] === false) {
			throw new ChatPermissionError(policy.read ? 'CHAT_READ_ONLY' : 'CHAT_UNAVAILABLE');
		}
	}

	/** 从账号策略、存量授权、关注和拉黑事实派生唯一的双方联系能力。 */
	@bindThis
	public async getContactState(fromUserId: MiUser['id'], toUser: MiUser): Promise<ChatContact> {
		const availability: { read: boolean; write: boolean } = await this.getChatAvailability(fromUserId);
		let reason: ChatContactReason | null = null;
		if (fromUserId === toUser.id) reason = 'SELF';
		else if (toUser.host != null) reason = 'REMOTE_USER';
		else if (!availability.read) reason = 'CHAT_UNAVAILABLE';
		else if (!availability.write) reason = 'CHAT_READ_ONLY';
		else if (!(await this.getChatAvailability(toUser.id)).write) reason = 'RECIPIENT_UNAVAILABLE';
		else if (await this.userBlockingService.checkBlocked(toUser.id, fromUserId) || await this.userBlockingService.checkBlocked(fromUserId, toUser.id)) reason = 'BLOCKED';
		else if (!await this.chatApprovalsRepository.existsBy({ userId: toUser.id, otherId: fromUserId })) {
			let allowed: boolean = true;
			switch (toUser.chatScope) {
				case 'none': allowed = false; break;
				case 'followers': allowed = await this.userFollowingService.isFollowing(fromUserId, toUser.id); break;
				case 'following': allowed = await this.userFollowingService.isFollowing(toUser.id, fromUserId); break;
				case 'mutual': allowed = await this.userFollowingService.isMutual(fromUserId, toUser.id); break;
			}
			if (!allowed) reason = 'RECIPIENT_SCOPE';
		}
		return { canRead: availability.read && fromUserId !== toUser.id && toUser.host == null, canSend: reason == null, reason };
	}

	/** 私聊变更立即通知双方账号设备；原有声音和推送路径保持独立。 */
	@bindThis
	private publishUserConversationUpdated(fromUserId: string, toUserId: string): void {
		this.globalEventService.publishMainStream(fromUserId, 'chatUpdated', { type: 'user', id: toUserId });
		this.globalEventService.publishMainStream(toUserId, 'chatUpdated', { type: 'user', id: fromUserId });
	}

	/** 群聊变更通知当前全部成员，可额外通知刚离开的账号。 */
	@bindThis
	private async publishRoomConversationUpdated(roomId: string, additionalUserId?: string): Promise<void> {
		const room: MiChatRoom | null = await this.chatRoomsRepository.findOneBy({ id: roomId });
		const memberships: MiChatRoomMembership[] = await this.chatRoomMembershipsRepository.findBy({ roomId });
		const userIds: Set<string> = new Set<string>();
		if (room) userIds.add(room.ownerId);
		if (additionalUserId) userIds.add(additionalUserId);
		for (const membership of memberships) userIds.add(membership.userId);
		for (const userId of userIds) this.globalEventService.publishMainStream(userId, 'chatUpdated', { type: 'room', id: roomId });
	}

	/** 校验双方权限并创建私信，随后维护授权与未读标记。 */
	@bindThis
	public async createMessageToUser(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toUser: MiUser, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
	}): Promise<Packed<'ChatMessageLiteFor1on1'>> {
		const contact: ChatContact = await this.getContactState(fromUser.id, toUser);
		if (!contact.canSend) throw new ChatPermissionError(contact.reason!);
		if (!params.text?.trim() && !params.file) throw new ChatPermissionError('CONTENT_REQUIRED');

		const iApprovedOther: boolean = await this.chatApprovalsRepository.existsBy({ userId: fromUser.id, otherId: toUser.id });

		const message: Pick<MiChatMessage, 'id' | 'fromUserId' | 'toUserId' | 'text' | 'fileId' | 'reads' | 'uri'> = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toUserId: toUser.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
		} satisfies Partial<MiChatMessage>;

		const inserted: MiChatMessage = await this.chatMessagesRepository.insertOne(message);

		// 相手を許可しておく
		if (!iApprovedOther) {
			await this.chatApprovalsRepository.createQueryBuilder().insert().values({
				id: this.idService.gen(),
				userId: fromUser.id,
				otherId: toUser.id,
			}).orIgnore().execute();
		}

		const packedMessage: Packed<'ChatMessageLiteFor1on1'> = await this.chatEntityService.packMessageLiteFor1on1(inserted);

		if (this.userEntityService.isLocalUser(toUser)) {
			await this.markConversationUnread(toUser.id, 'user', fromUser.id, message.id);
		}

		if (this.userEntityService.isLocalUser(fromUser)) {
			// 自分のストリーム
			this.globalEventService.publishChatUserStream(fromUser.id, toUser.id, 'message', packedMessage);
		}

		if (this.userEntityService.isLocalUser(toUser)) {
			// 相手のストリーム
			this.globalEventService.publishChatUserStream(toUser.id, fromUser.id, 'message', packedMessage);
		}

		// 3秒経っても既読にならなかったらイベント発行
		if (this.userEntityService.isLocalUser(toUser)) {
			this.scheduleNotification(/** 检查消息仍未读时沿用既有通知路径。 */ async (): Promise<void> => {
				const marker: string | null = await this.redisClient.get(`newUserChatMessageExists:${toUser.id}:${fromUser.id}`);

				if (marker == null) return; // 既読

				const packedMessageForTo: Packed<'ChatMessage'> = await this.chatEntityService.packMessageDetailed(inserted, toUser);
				this.globalEventService.publishMainStream(toUser.id, 'newChatMessage', packedMessageForTo);
				this.pushNotificationService.pushNotification(toUser.id, 'newChatMessage', packedMessageForTo);
			});
		}

		this.publishUserConversationUpdated(fromUser.id, toUser.id);
		return packedMessage;
	}

	/** 校验群成员资格后创建消息，并同步所有成员的会话索引。 */
	@bindThis
	public async createMessageToRoom(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toRoom: MiChatRoom, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
	}): Promise<Packed<'ChatMessageLiteForRoom'>> {
		if (!(await this.getChatAvailability(fromUser.id)).write) throw new ChatPermissionError('CHAT_READ_ONLY');
		if (!params.text?.trim() && !params.file) throw new ChatPermissionError('CONTENT_REQUIRED');
		const memberships: Array<Pick<MiChatRoomMembership, 'userId' | 'isMuted'>> = (await this.chatRoomMembershipsRepository.findBy({ roomId: toRoom.id })).map(/** 从成员记录派生通知接收目标。 */ (m: MiChatRoomMembership): Pick<MiChatRoomMembership, 'userId' | 'isMuted'> => ({
			userId: m.userId,
			isMuted: m.isMuted,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: toRoom.ownerId,
			isMuted: false,
		});

		if (!memberships.some(/** 发送者必须属于当前群聊。 */ (member: Pick<MiChatRoomMembership, 'userId' | 'isMuted'>): boolean => member.userId === fromUser.id)) {
			throw new ChatPermissionError('NOT_ROOM_MEMBER');
		}

		const membershipsOtherThanMe: Array<Pick<MiChatRoomMembership, 'userId' | 'isMuted'>> = memberships.filter(/** 排除发送者以免把本人消息标记为未读。 */ (member: Pick<MiChatRoomMembership, 'userId' | 'isMuted'>): boolean => member.userId !== fromUser.id);

		const message: Pick<MiChatMessage, 'id' | 'fromUserId' | 'toRoomId' | 'text' | 'fileId' | 'reads' | 'uri'> = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toRoomId: toRoom.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
		} satisfies Partial<MiChatMessage>;

		const inserted: MiChatMessage = await this.chatMessagesRepository.insertOne(message);

		const packedMessage: Packed<'ChatMessageLiteForRoom'> = await this.chatEntityService.packMessageLiteForRoom(inserted);

		this.globalEventService.publishChatRoomStream(toRoom.id, 'message', packedMessage);

		for (const membership of membershipsOtherThanMe) {
			if (!membership.isMuted) await this.markConversationUnread(membership.userId, 'room', toRoom.id, message.id);
		}

		// 3秒経っても既読にならなかったらイベント発行
		this.scheduleNotification(/** 检查消息仍未读时沿用既有通知路径。 */ async (): Promise<void> => {
			const redisPipeline: Redis.ChainableCommander = this.redisClient.pipeline();
			for (const membership of membershipsOtherThanMe) {
				redisPipeline.get(`newRoomChatMessageExists:${membership.userId}:${toRoom.id}`);
			}
			const markers: Array<[Error | null, unknown]> | null = await redisPipeline.exec();
			if (markers == null) throw new Error('redis error');

			if (markers.every(/** 无未读标记时不发送延迟提醒。 */ (marker: [Error | null, unknown]): boolean => marker[1] == null)) return;

			const packedMessageForTo: Packed<'ChatMessage'> = await this.chatEntityService.packMessageDetailed(inserted);

			for (let i: number = 0; i < membershipsOtherThanMe.length; i++) {
				const marker: unknown = markers[i][1];
				if (marker == null) continue;

				this.globalEventService.publishMainStream(membershipsOtherThanMe[i].userId, 'newChatMessage', packedMessageForTo);
				this.pushNotificationService.pushNotification(membershipsOtherThanMe[i].userId, 'newChatMessage', packedMessageForTo);
			}
		});

		await this.publishRoomConversationUpdated(toRoom.id);
		return packedMessage;
	}

	/** 原子写入最大消息位置，避免并发发送完成顺序让未读标记倒退。 */
	@bindThis
	private async markConversationUnread(readerId: string, type: 'user' | 'room', targetId: string, messageId: string): Promise<void> {
		const markerKey: string = type === 'user' ? `newUserChatMessageExists:${readerId}:${targetId}` : `newRoomChatMessageExists:${readerId}:${targetId}`;
		await this.redisClient.eval(`
			local read = redis.call('GET', KEYS[3])
			if read and read >= ARGV[2] then return 0 end
			local marker = redis.call('GET', KEYS[1])
			if not marker or marker < ARGV[2] then redis.call('SET', KEYS[1], ARGV[2]) end
			return redis.call('SADD', KEYS[2], ARGV[1])
		`, 3, markerKey, `newChatMessagesExists:${readerId}`, `chatReadWatermark:${readerId}:${type}:${targetId}`, `${type}:${targetId}`, messageId);
	}

	/** 删除最新未读消息后回退至仍未读的上一条消息，保留其他未读事实。 */
	@bindThis
	private async clearDeletedUnreadMarker(readerId: string, type: 'user' | 'room', targetId: string, messageId: string): Promise<void> {
		const markerKey: string = type === 'user' ? `newUserChatMessageExists:${readerId}:${targetId}` : `newRoomChatMessageExists:${readerId}:${targetId}`;
		const query: SelectQueryBuilder<MiChatMessage> = this.chatMessagesRepository.createQueryBuilder('message').orderBy('message.id', 'DESC');
		if (type === 'user') query.where('message.fromUserId = :targetId AND message.toUserId = :readerId', { targetId, readerId });
		else query.where('message.toRoomId = :targetId AND message.fromUserId != :readerId', { targetId, readerId });
		const previous: MiChatMessage | null = await query.getOne();
		await this.redisClient.eval(`
			if redis.call('GET', KEYS[1]) == ARGV[2] then
				local read = redis.call('GET', KEYS[3])
				if ARGV[3] ~= '' and (not read or ARGV[3] > read) then
					redis.call('SET', KEYS[1], ARGV[3])
				else
					redis.call('DEL', KEYS[1])
					redis.call('SREM', KEYS[2], ARGV[1])
				end
			end
		`, 3, markerKey, `newChatMessagesExists:${readerId}`, `chatReadWatermark:${readerId}:${type}:${targetId}`, `${type}:${targetId}`, messageId, previous?.id ?? '');
	}

	/** 原子移除已观察范围内的未读标记，保留并发到达的新消息。 */
	@bindThis
	private async readConversation(readerId: string, type: 'user' | 'room', targetId: string, observedId?: string): Promise<void> {
		const markerKey: string = type === 'user' ? `newUserChatMessageExists:${readerId}:${targetId}` : `newRoomChatMessageExists:${readerId}:${targetId}`;
		const changed: unknown = await this.redisClient.eval(`
			local marker = redis.call('GET', KEYS[1])
			local observed = ARGV[2]
			if observed == '' then observed = marker or '' end
			local read = redis.call('GET', KEYS[3])
			if observed ~= '' and (not read or observed > read) then redis.call('SET', KEYS[3], observed) end
			if not marker or ARGV[2] == '' or marker <= ARGV[2] then
				return redis.call('DEL', KEYS[1]) + redis.call('SREM', KEYS[2], ARGV[1])
			end
			return 0
		`, 3, markerKey, `newChatMessagesExists:${readerId}`, `chatReadWatermark:${readerId}:${type}:${targetId}`, `${type}:${targetId}`, observedId ?? '');
		if (typeof changed === 'number' && changed > 0) this.globalEventService.publishMainStream(readerId, 'chatUpdated', { type, id: targetId });
	}

	/** 标读私聊；旧调用省略观察位置以保留原生界面的行为。 */
	@bindThis
	public async readUserChatMessage(readerId: MiUser['id'], senderId: MiUser['id'], observedId?: string): Promise<void> {
		await this.readConversation(readerId, 'user', senderId, observedId);
	}

	/** 标读群聊；新界面传入实际可见消息的位置。 */
	@bindThis
	public async readRoomChatMessage(readerId: MiUser['id'], roomId: MiChatRoom['id'], observedId?: string): Promise<void> {
		await this.readConversation(readerId, 'room', roomId, observedId);
	}

	/** 在同一 Redis 原子操作中清理全部会话集合和对应标记。 */
	@bindThis
	public async readAllChatMessages(readerId: MiUser['id']): Promise<void> {
		await this.redisClient.eval(`
			local conversations = redis.call('SMEMBERS', KEYS[1])
			local prefix = ARGV[2]
			for _, conversation in ipairs(conversations) do
				local kind, target = string.match(conversation, '^([^:]+):(.+)$')
				local markerKey = prefix .. (kind == 'user' and 'newUserChatMessageExists:' or 'newRoomChatMessageExists:') .. ARGV[1] .. ':' .. target
				local marker = redis.call('GET', markerKey)
				local watermarkKey = prefix .. 'chatReadWatermark:' .. ARGV[1] .. ':' .. conversation
				local read = redis.call('GET', watermarkKey)
				if marker and (not read or marker > read) then redis.call('SET', watermarkKey, marker) end
				redis.call('DEL', markerKey)
			end
			redis.call('DEL', KEYS[1])
		`, 1, `newChatMessagesExists:${readerId}`, readerId, this.redisClient.options.keyPrefix ?? '');
		this.globalEventService.publishMainStream(readerId, 'chatUpdated', { type: 'all' });
	}

	@bindThis
	public findMessageById(messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId });
	}

	@bindThis
	public findMyMessageById(userId: MiUser['id'], messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId, fromUserId: userId });
	}

	@bindThis
	public async hasPermissionToViewRoomTimeline(meId: MiUser['id'], room: MiChatRoom) {
		if (await this.isRoomMember(room, meId)) {
			return true;
		} else {
			const iAmModerator = await this.roleService.isModerator({ id: meId });
			if (iAmModerator) {
				return true;
			}

			return false;
		}
	}

	/** 删除消息并使双方设备的会话摘要失效。 */
	@bindThis
	public async deleteMessage(message: MiChatMessage): Promise<void> {
		await this.chatMessagesRepository.delete(message.id);

		if (message.toUserId) {
			const [fromUser, toUser]: [MiUser, MiUser] = await Promise.all([
				this.usersRepository.findOneByOrFail({ id: message.fromUserId }),
				this.usersRepository.findOneByOrFail({ id: message.toUserId }),
			]);

			if (this.userEntityService.isLocalUser(fromUser)) this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'deleted', message.id);
			if (this.userEntityService.isLocalUser(toUser)) this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'deleted', message.id);

			await this.clearDeletedUnreadMarker(toUser.id, 'user', fromUser.id, message.id);
			this.publishUserConversationUpdated(fromUser.id, toUser.id);
			if (this.userEntityService.isLocalUser(fromUser) && this.userEntityService.isRemoteUser(toUser)) {
				//const activity = this.apRendererService.addContext(this.apRendererService.renderDelete(this.apRendererService.renderTombstone(`${this.config.url}/notes/${message.id}`), fromUser));
				//this.queueService.deliver(fromUser, activity, toUser.inbox);
			}
		} else if (message.toRoomId) {
			this.globalEventService.publishChatRoomStream(message.toRoomId, 'deleted', message.id);
			const room: MiChatRoom | null = await this.findRoomById(message.toRoomId);
			const members: MiChatRoomMembership[] = await this.chatRoomMembershipsRepository.findBy({ roomId: message.toRoomId });
			if (room) await this.clearDeletedUnreadMarker(room.ownerId, 'room', room.id, message.id);
			for (const member of members) await this.clearDeletedUnreadMarker(member.userId, 'room', message.toRoomId, message.id);
			await this.publishRoomConversationUpdated(message.toRoomId);
		}
	}

	@bindThis
	public async userTimeline(meId: MiUser['id'], otherId: MiUser['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
			.setParameter('meId', meId)
			.setParameter('otherId', otherId);

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async roomTimeline(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere('message.toRoomId = :roomId', { roomId })
			.leftJoinAndSelect('message.file', 'file')
			.leftJoinAndSelect('message.fromUser', 'fromUser');

		const messages = await query.take(limit).getMany();

		return messages;
	}

	/** 先聚合各会话的最新消息，再按稳定位置分页，空群聊同样可达。 */
	@bindThis
	public async listConversations(meId: string, params: ChatConversationQuery): Promise<ChatConversationPage> {
		let cursor: { sortId: string; key: string } | null = null;
		if (params.cursor) {
			try {
				const decoded: unknown = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
				if (typeof decoded !== 'object' || decoded == null || !('sortId' in decoded) || !('key' in decoded) || typeof decoded.sortId !== 'string' || !/^[a-zA-Z0-9]+$/.test(decoded.sortId) || typeof decoded.key !== 'string' || !/^(user|room):[a-zA-Z0-9]+$/.test(decoded.key)) throw new ChatCursorError();
				cursor = { sortId: decoded.sortId, key: decoded.key };
			} catch {
				throw new ChatCursorError();
			}
		}
		const positions: ChatConversationPosition[] = await this.chatMessagesRepository.query(`
			WITH private_latest AS (
				SELECT CASE WHEN "fromUserId" = $1 THEN "toUserId" ELSE "fromUserId" END AS "targetId", MAX(id) AS "latestId"
				FROM chat_message WHERE ("fromUserId" = $1 OR "toUserId" = $1) AND "toUserId" IS NOT NULL
				GROUP BY CASE WHEN "fromUserId" = $1 THEN "toUserId" ELSE "fromUserId" END
			), visible_rooms AS (
				SELECT room.id, room.name FROM chat_room room WHERE room."ownerId" = $1
				OR EXISTS (SELECT 1 FROM chat_room_membership membership WHERE membership."roomId" = room.id AND membership."userId" = $1)
			), conversations AS (
				SELECT 'user' AS type, p."targetId", p."latestId", p."latestId" AS "sortId", 'user:' || p."targetId" AS key,
					LOWER(COALESCE(u.name, '') || ' ' || u.username) AS searchable
				FROM private_latest p JOIN "user" u ON u.id = p."targetId" WHERE u.host IS NULL
				UNION ALL
				SELECT 'room' AS type, room.id AS "targetId", MAX(message.id) AS "latestId", COALESCE(MAX(message.id), room.id) AS "sortId", 'room:' || room.id AS key,
					LOWER(room.name) AS searchable
				FROM visible_rooms room LEFT JOIN chat_message message ON message."toRoomId" = room.id GROUP BY room.id, room.name
			)
			SELECT type, "targetId", "latestId", "sortId", key FROM conversations
			WHERE ($2 = 'all' OR type = $2) AND ($3 = '' OR searchable LIKE $3)
			AND ($4::text IS NULL OR "sortId" < $4 OR ("sortId" = $4 AND key < $5))
			ORDER BY "sortId" DESC, key DESC LIMIT $6
		`, [meId, params.kind, params.query?.trim() ? `%${sqlLikeEscape(params.query.trim().toLowerCase())}%` : '', cursor?.sortId ?? null, cursor?.key ?? null, params.limit + 1]);
		const page: ChatConversationPosition[] = positions.slice(0, params.limit);
		const userIds: string[] = [];
		const roomIds: string[] = [];
		const latestIds: string[] = [];
		for (const position of page) {
			if (position.type === 'user') userIds.push(position.targetId);
			else roomIds.push(position.targetId);
			if (position.latestId) latestIds.push(position.latestId);
		}
		const messages: MiChatMessage[] = latestIds.length === 0 ? [] : await this.chatMessagesRepository.find({
			where: { id: In(latestIds) },
			relations: { file: true, fromUser: true, toUser: true, toRoom: { owner: true } },
		});
		const packedMessages: Packed<'ChatMessage'>[] = await this.chatEntityService.packMessagesDetailed(messages, { id: meId });
		const messageMap: Map<string, Packed<'ChatMessage'>> = new Map<string, Packed<'ChatMessage'>>();
		for (const message of packedMessages) messageMap.set(message.id, message);
		const users: Packed<'UserLite'>[] = await this.userEntityService.packMany(userIds, { id: meId });
		const userMap: Map<string, Packed<'UserLite'>> = new Map<string, Packed<'UserLite'>>();
		for (const user of users) userMap.set(user.id, user);
		const rooms: Packed<'ChatRoom'>[] = await this.chatEntityService.packRooms(roomIds, { id: meId });
		const roomMap: Map<string, Packed<'ChatRoom'>> = new Map<string, Packed<'ChatRoom'>>();
		for (const room of rooms) roomMap.set(room.id, room);
		const userReadState: Record<string, boolean> = userIds.length === 0 ? {} : await this.getUserReadStateMap(meId, userIds);
		const roomReadState: Record<string, boolean> = roomIds.length === 0 ? {} : await this.getRoomReadStateMap(meId, roomIds);
		const items: ChatConversation[] = [];
		for (const position of page) {
			const readState: Record<string, boolean> = position.type === 'user' ? userReadState : roomReadState;
			items.push({
				key: position.key,
				target: { type: position.type, id: position.targetId },
				latestMessage: position.latestId ? messageMap.get(position.latestId) ?? null : null,
				unread: readState[position.targetId] === false,
				...(position.type === 'user' ? { user: userMap.get(position.targetId) } : { room: roomMap.get(position.targetId) }),
			});
		}
		const last: ChatConversationPosition | undefined = page.at(-1);
		return { items, nextCursor: positions.length > params.limit && last ? Buffer.from(JSON.stringify({ sortId: last.sortId, key: last.key })).toString('base64url') : null };
	}

	@bindThis
	public async userHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		const history: MiChatMessage[] = [];

		const mutingQuery = this.mutingsRepository.createQueryBuilder('muting')
			.select('muting.muteeId')
			.where('muting.muterId = :muterId', { muterId: meId });

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => (m.fromUserId === meId) ? m.toUserId! : m.fromUserId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where(new Brackets(qb => {
					qb
						.where('message.fromUserId = :meId', { meId: meId })
						.orWhere('message.toUserId = :meId', { meId: meId });
				}))
				.andWhere('message.toRoomId IS NULL')
				.andWhere(`message.fromUserId NOT IN (${ mutingQuery.getQuery() })`)
				.andWhere(`message.toUserId NOT IN (${ mutingQuery.getQuery() })`);

			if (found.length > 0) {
				query.andWhere('message.fromUserId NOT IN (:...found)', { found: found });
				query.andWhere('message.toUserId NOT IN (:...found)', { found: found });
			}

			query.setParameters(mutingQuery.getParameters());

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async roomHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		// TODO: 一回のクエリにまとめられるかも
		const [memberRoomIds, ownedRoomIds] = await Promise.all([
			this.chatRoomMembershipsRepository.findBy({
				userId: meId,
			}).then(xs => xs.map(x => x.roomId)),
			this.chatRoomsRepository.findBy({
				ownerId: meId,
			}).then(xs => xs.map(x => x.id)),
		]);

		const roomIds = memberRoomIds.concat(ownedRoomIds);

		if (memberRoomIds.length === 0 && ownedRoomIds.length === 0) {
			return [];
		}

		const history: MiChatMessage[] = [];

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => m.toRoomId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where('message.toRoomId IN (:...roomIds)', { roomIds });

			if (found.length > 0) {
				query.andWhere('message.toRoomId NOT IN (:...found)', { found: found });
			}

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async getUserReadStateMap(userId: MiUser['id'], otherIds: MiUser['id'][]) {
		const readStateMap: Record<MiUser['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const otherId of otherIds) {
			redisPipeline.get(`newUserChatMessageExists:${userId}:${otherId}`);
		}

		const markers = await redisPipeline.exec();
		if (markers == null) throw new Error('redis error');

		for (let i = 0; i < otherIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[otherIds[i]] = marker == null;
		}

		return readStateMap;
	}

	@bindThis
	public async getRoomReadStateMap(userId: MiUser['id'], roomIds: MiChatRoom['id'][]) {
		const readStateMap: Record<MiChatRoom['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const roomId of roomIds) {
			redisPipeline.get(`newRoomChatMessageExists:${userId}:${roomId}`);
		}

		const markers = await redisPipeline.exec();
		if (markers == null) throw new Error('redis error');

		for (let i = 0; i < roomIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[roomIds[i]] = marker == null;
		}

		return readStateMap;
	}

	@bindThis
	public async hasUnreadMessages(userId: MiUser['id']) {
		const card = await this.redisClient.scard(`newChatMessagesExists:${userId}`);
		return card > 0;
	}

	/** 建立由当前用户拥有的空群聊并立即同步会话列表。 */
	@bindThis
	public async createRoom(owner: MiUser, params: Partial<{
		name: string;
		description: string;
	}>): Promise<MiChatRoom> {
		const room: Pick<MiChatRoom, 'id' | 'ownerId'> & Partial<Pick<MiChatRoom, 'name' | 'description'>> = {
			id: this.idService.gen(),
			name: params.name,
			description: params.description,
			ownerId: owner.id,
		} satisfies Partial<MiChatRoom>;

		const created: MiChatRoom = await this.chatRoomsRepository.insertOne(room);
		await this.publishRoomConversationUpdated(created.id);
		return created;
	}

	@bindThis
	public async hasPermissionToViewRoomInfo(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		if (await this.isRoomMember(room, meId)) {
			return true;
		}

		if (await this.chatRoomInvitationsRepository.findOneBy({ roomId: room.id, userId: meId })) {
			return true;
		}

		if (await this.roleService.isModerator({ id: meId })) {
			return true;
		}

		return false;
	}

	@bindThis
	public async hasPermissionToDeleteRoom(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		const iAmModerator = await this.roleService.isModerator({ id: meId });
		if (iAmModerator) {
			return true;
		}

		return false;
	}

	/** 删除群聊并清理所有成员的未读事实及会话索引。 */
	@bindThis
	public async deleteRoom(room: MiChatRoom, deleter?: MiUser): Promise<void> {
		const memberships: Array<Pick<MiChatRoomMembership, 'userId'>> = (await this.chatRoomMembershipsRepository.findBy({ roomId: room.id })).map(/** 从成员记录派生通知接收目标。 */ (m: MiChatRoomMembership): Pick<MiChatRoomMembership, 'userId'> => ({
			userId: m.userId,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: room.ownerId,
		});

		// 未読フラグ削除
		const redisPipeline: Redis.ChainableCommander = this.redisClient.pipeline();
		for (const membership of memberships) {
			redisPipeline.del(`newRoomChatMessageExists:${membership.userId}:${room.id}`);
			redisPipeline.srem(`newChatMessagesExists:${membership.userId}`, `room:${room.id}`);
		}
		await redisPipeline.exec();

		await this.chatRoomsRepository.delete(room.id);
		for (const membership of memberships) this.globalEventService.publishMainStream(membership.userId, 'chatUpdated', { type: 'room', id: room.id });

		if (deleter) {
			const deleterIsModerator: boolean = await this.roleService.isModerator(deleter);

			if (deleterIsModerator) {
				this.moderationLogService.log(deleter, 'deleteChatRoom', {
					roomId: room.id,
					room: room,
				});
			}
		}
	}

	@bindThis
	public async findMyRoomById(ownerId: MiUser['id'], roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOneBy({ id: roomId, ownerId: ownerId });
	}

	@bindThis
	public async findRoomById(roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOne({
			where: { id: roomId },
			relations: { owner: true },
		});
	}

	@bindThis
	public async isRoomMember(room: MiChatRoom, userId: MiUser['id']) {
		if (room.ownerId === userId) return true;
		const membership = await this.chatRoomMembershipsRepository.findOneBy({ roomId: room.id, userId });
		return membership != null;
	}

	/** 校验本地目标和成员容量后创建真实群邀请。 */
	@bindThis
	public async createRoomInvitation(inviterId: MiUser['id'], roomId: MiChatRoom['id'], inviteeId: MiUser['id']): Promise<MiChatRoomInvitation> {
		if (inviterId === inviteeId) {
			throw new ChatPermissionError('SELF');
		}

		const room: MiChatRoom = await this.chatRoomsRepository.findOneByOrFail({ id: roomId, ownerId: inviterId });

		if (await this.isRoomMember(room, inviteeId)) {
			throw new ChatPermissionError('ALREADY_MEMBER');
		}

		const existingInvitation: MiChatRoomInvitation | null = await this.chatRoomInvitationsRepository.findOneBy({ roomId, userId: inviteeId });
		if (existingInvitation) {
			throw new ChatPermissionError('ALREADY_INVITED');
		}

		const membershipsCount: number = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new ChatPermissionError('ROOM_FULL');
		}

		const invitee: MiUser | null = await this.usersRepository.findOneBy({ id: inviteeId });
		if (!invitee) throw new ChatPermissionError('NO_SUCH_USER');
		if (invitee.host != null) throw new ChatPermissionError('REMOTE_USER');
		if (await this.userBlockingService.checkBlocked(inviteeId, inviterId) || await this.userBlockingService.checkBlocked(inviterId, inviteeId)) throw new ChatPermissionError('BLOCKED');

		const invitation: Pick<MiChatRoomInvitation, 'id' | 'roomId' | 'userId'> = {
			id: this.idService.gen(),
			roomId: room.id,
			userId: inviteeId,
		} satisfies Partial<MiChatRoomInvitation>;

		const created: MiChatRoomInvitation = await this.chatRoomInvitationsRepository.insertOne(invitation);

		this.notificationService.createNotification(inviteeId, 'chatRoomInvitationReceived', {
			invitationId: invitation.id,
		}, inviterId);

		this.globalEventService.publishMainStream(inviteeId, 'chatUpdated', { type: 'room', id: roomId });
		return created;
	}

	@bindThis
	public async getSentRoomInvitationsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.roomId = :roomId', { roomId });

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async getOwnedRoomsWithPagination(ownerId: MiUser['id'], limit: number, sinceId?: MiChatRoom['id'] | null, untilId?: MiChatRoom['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomsRepository.createQueryBuilder('room'), sinceId, untilId)
			.andWhere('room.ownerId = :ownerId', { ownerId });

		const rooms = await query.take(limit).getMany();

		return rooms;
	}

	@bindThis
	public async getReceivedRoomInvitationsWithPagination(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.userId = :userId', { userId })
			.andWhere('invitation.ignored = FALSE');

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	/** 消费已有邀请建立成员关系并同步群会话。 */
	@bindThis
	public async joinToRoom(userId: MiUser['id'], roomId: MiChatRoom['id']): Promise<void> {
		const invitation: MiChatRoomInvitation | null = await this.chatRoomInvitationsRepository.findOneBy({ roomId, userId });
		if (!invitation) throw new ChatPermissionError('NO_INVITATION');

		const membershipsCount: number = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new ChatPermissionError('ROOM_FULL');
		}

		const membership: Pick<MiChatRoomMembership, 'id' | 'roomId' | 'userId'> = {
			id: this.idService.gen(),
			roomId: roomId,
			userId: userId,
		} satisfies Partial<MiChatRoomMembership>;

		// TODO: transaction
		await this.chatRoomMembershipsRepository.insertOne(membership);
		await this.chatRoomInvitationsRepository.delete(invitation.id);
		await this.publishRoomConversationUpdated(roomId);
	}

	/** 保留已忽略的邀请事实并同步接收账号。 */
	@bindThis
	public async ignoreRoomInvitation(userId: MiUser['id'], roomId: MiChatRoom['id']): Promise<void> {
		const invitation: MiChatRoomInvitation | null = await this.chatRoomInvitationsRepository.findOneBy({ roomId, userId });
		if (!invitation) throw new ChatPermissionError('NO_INVITATION');
		await this.chatRoomInvitationsRepository.update(invitation.id, { ignored: true });
		this.globalEventService.publishMainStream(userId, 'chatUpdated', { type: 'room', id: roomId });
	}

	/** 退出群聊并清理本人未读和会话入口。 */
	@bindThis
	public async leaveRoom(userId: MiUser['id'], roomId: MiChatRoom['id']): Promise<void> {
		const membership: MiChatRoomMembership | null = await this.chatRoomMembershipsRepository.findOneBy({ roomId, userId });
		if (!membership) throw new ChatPermissionError('NOT_ROOM_MEMBER');
		await this.chatRoomMembershipsRepository.delete(membership.id);

		// 未読フラグを消す (「既読にする」というわけでもないのでreadメソッドは使わないでおく)
		const redisPipeline: Redis.ChainableCommander = this.redisClient.pipeline();
		redisPipeline.del(`newRoomChatMessageExists:${userId}:${roomId}`);
		redisPipeline.srem(`newChatMessagesExists:${userId}`, `room:${roomId}`);
		await redisPipeline.exec();
		await this.publishRoomConversationUpdated(roomId, userId);
	}

	/** 更新成员静音策略并清理已抑制的未读提示。 */
	@bindThis
	public async muteRoom(userId: MiUser['id'], roomId: MiChatRoom['id'], mute: boolean): Promise<void> {
		const membership: MiChatRoomMembership | null = await this.chatRoomMembershipsRepository.findOneBy({ roomId, userId });
		if (!membership) throw new ChatPermissionError('NOT_ROOM_MEMBER');
		await this.chatRoomMembershipsRepository.update(membership.id, { isMuted: mute });
		if (mute) await this.readRoomChatMessage(userId, roomId);
		await this.publishRoomConversationUpdated(roomId);
	}

	/** 更新当前群聊描述并通知成员重新读取服务端事实。 */
	@bindThis
	public async updateRoom(room: MiChatRoom, params: {
		name?: string;
		description?: string;
	}): Promise<MiChatRoom> {
		await this.chatRoomsRepository.update(room.id, params);
		const updated: MiChatRoom = await this.chatRoomsRepository.findOneByOrFail({ id: room.id });
		await this.publishRoomConversationUpdated(room.id);
		return updated;
	}

	@bindThis
	public async getRoomMembershipsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.roomId = :roomId', { roomId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}

	/** 在权限范围内执行按消息位置分页的全文查询。 */
	@bindThis
	public async searchMessages(meId: MiUser['id'], query: string, limit: number, params: {
		userId?: MiUser['id'] | null;
		roomId?: MiChatRoom['id'] | null;
		untilId?: MiChatMessage['id'];
	}): Promise<MiChatMessage[]> {
		const q: SelectQueryBuilder<MiChatMessage> = this.chatMessagesRepository.createQueryBuilder('message');

		if (params.userId) {
			q.andWhere(new Brackets(/** 将当前账号可见范围组合成单向查询约束。 */ (qb: WhereExpressionBuilder): void => {
				qb
					.where(new Brackets(/** 将当前账号可见范围组合成单向查询约束。 */ (qb: WhereExpressionBuilder): void => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(/** 将当前账号可见范围组合成单向查询约束。 */ (qb: WhereExpressionBuilder): void => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
				.setParameter('meId', meId)
				.setParameter('otherId', params.userId);
		} else if (params.roomId) {
			q.where('message.toRoomId = :roomId', { roomId: params.roomId });
		} else {
			const membershipsQuery: SelectQueryBuilder<MiChatRoomMembership> = this.chatRoomMembershipsRepository.createQueryBuilder('membership')
				.select('membership.roomId')
				.where('membership.userId = :meId', { meId: meId });

			const ownedRoomsQuery: SelectQueryBuilder<MiChatRoom> = this.chatRoomsRepository.createQueryBuilder('room')
				.select('room.id')
				.where('room.ownerId = :meId', { meId });

			q.andWhere(new Brackets(/** 将当前账号可见范围组合成单向查询约束。 */ (qb: WhereExpressionBuilder): void => {
				qb
					.where('(message.toUserId IS NOT NULL AND (message.fromUserId = :meId OR message.toUserId = :meId))')
					.orWhere(`message.toRoomId IN (${membershipsQuery.getQuery()})`)
					.orWhere(`message.toRoomId IN (${ownedRoomsQuery.getQuery()})`);
			}));

			q.setParameters(membershipsQuery.getParameters());
			q.setParameters(ownedRoomsQuery.getParameters());
		}

		if (params.untilId) q.andWhere('message.id < :untilId', { untilId: params.untilId });
		q.andWhere('LOWER(message.text) LIKE :q', { q: `%${ sqlLikeEscape(query.toLowerCase()) }%` });

		q.leftJoinAndSelect('message.file', 'file');
		q.leftJoinAndSelect('message.fromUser', 'fromUser');
		q.leftJoinAndSelect('message.toUser', 'toUser');
		q.leftJoinAndSelect('message.toRoom', 'toRoom');
		q.leftJoinAndSelect('toRoom.owner', 'toRoomOwner');

		const messages: MiChatMessage[] = await q.orderBy('message.id', 'DESC').take(limit).getMany();

		return messages;
	}

	/** 在参与者权限内添加反应并同步会话设备。 */
	@bindThis
	public async react(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string): Promise<void> {
		let reaction: string;

		const custom: RegExpMatchArray | null = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else {
			const name: string = custom[1];
			const emoji: MiEmoji | undefined = (await this.customEmojiService.localEmojisCache.fetch()).get(name);

			if (emoji == null) {
				throw new Error('no such emoji');
			} else {
				reaction = `:${name}:`;
			}
		}

		const message: MiChatMessage = await this.chatMessagesRepository.findOneByOrFail({ id: messageId });

		if (message.fromUserId === userId) {
			throw new Error('cannot react to own message');
		}

		if (message.toRoomId === null && message.toUserId !== userId) {
			throw new Error('cannot react to others message');
		}

		if (message.reactions.length >= MAX_REACTIONS_PER_MESSAGE) {
			throw new Error('too many reactions');
		}

		const room: MiChatRoom | null = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		if (room) {
			if (!(await this.isRoomMember(room, userId))) {
				throw new Error('cannot react to others message');
			}
		}

		await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: /** 生成参数来源受限的表情数组更新表达式。 */ (): string => `array_append("reactions", '${userId}/${reaction}')`,
			})
			.where('id = :id', { id: message.id })
			.execute();

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'react', {
				messageId: message.id,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'react', {
				messageId: message.id,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'react', {
				messageId: message.id,
				reaction,
			});
		}
		if (message.toRoomId) await this.publishRoomConversationUpdated(message.toRoomId);
		else this.publishUserConversationUpdated(message.fromUserId, message.toUserId!);
	}

	/** 移除本人的存量反应并同步参与者设备。 */
	@bindThis
	public async unreact(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string): Promise<void> {
		let reaction: string;

		const custom: RegExpMatchArray | null = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else { // 削除されたカスタム絵文字のリアクションを削除したいかもしれないので絵文字の存在チェックはする必要なし
			const name: string = custom[1];
			reaction = `:${name}:`;
		}

		// NOTE: 自分のリアクションを(あれば)削除するだけなので諸々の権限チェックは必要なし

		const message: MiChatMessage = await this.chatMessagesRepository.findOneByOrFail({ id: messageId });

		const room: MiChatRoom | null = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: /** 生成参数来源受限的表情数组更新表达式。 */ (): string => `array_remove("reactions", '${userId}/${reaction}')`,
			})
			.where('id = :id', { id: message.id })
			.execute();

		// TODO: 実際に削除が行われたときのみイベントを発行する

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'unreact', {
				messageId: message.id,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'unreact', {
				messageId: message.id,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'unreact', {
				messageId: message.id,
				reaction,
			});
		}
		if (message.toRoomId) await this.publishRoomConversationUpdated(message.toRoomId);
		else this.publishUserConversationUpdated(message.fromUserId, message.toUserId!);
	}

	@bindThis
	public async getMyMemberships(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.userId = :userId', { userId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}
}
