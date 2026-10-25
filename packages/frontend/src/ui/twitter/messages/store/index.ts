/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 私信的账户隔离内存 Store。
 * HTTP 与流式事件在此合并为唯一会话事实；组件仅提交动作。离页释放连接，换号销毁消息和草稿，
 * 不使用 Pizzax 持久化正文，不承担声音、环境探测或运维 readiness。
 */
import { reactive, readonly, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { Channels, Endpoints, IChannelConnection, IStream, entities, api } from 'misskey-js';
import { useStream } from '@/stream.js';
import { accountSnapshot, failureFrom, freezeEntity, isCurrentAccount, isUncertainFailure, normalizeMessage, request, syncChatUnreadState } from '../adapters/index.js';
import type { ActiveConversation, ChatAttachment, ChatDraft, ChatFailure, ChatMessage, ChatRoom, ChatTarget, Conversation, InboxKind, MessagesState, ReadonlyMessagesState } from '../domain/index.js';

/** 查询批量大小；只用于分页，不改变业务规则。 */
const PAGE_SIZE: number = 30;
/** 每个账户最多保留的会话草稿数，避免无限内存增长。 */
const MAX_DRAFTS: number = 30;

/** 生成无旧账户事实的会话查询容器。 */
function emptyActive(target: ChatTarget | null = null): ActiveConversation {
	return {
		target, user: null, room: null, contact: null, messages: [], hasMore: false, status: 'idle', error: null,
		/** 联系能力或群成员事实是读取能力的唯一来源，只公开派生值。 */
		get canRead(): boolean { return actor.value !== null && actor.value.policies.chatAvailability !== 'unavailable' && (this.contact?.canRead ?? (this.room !== null && this.room.isMember === true)); },
		/** 发送能力从服务端联系事实或冻结账户业务策略与群成员事实单向派生。 */
		get canSend(): boolean { return this.canRead && actor.value?.policies.chatAvailability === 'available' && (this.contact?.canSend ?? this.room !== null); },
	};
}

/** 生成不持久化的账户内存状态。 */
function emptyState(): MessagesState {
	return {
		accountId: null,
		inbox: { items: [], nextCursor: null, query: '', kind: 'all', status: 'idle', error: null },
		active: emptyActive(),
		draft: Object.freeze({ text: '', file: null }),
		command: { status: 'idle', error: null },
		search: { query: '', items: [], hasMore: false, status: 'idle', error: null },
		members: [], rooms: [], invitations: [], sentInvitations: [], roomStatus: 'idle', roomError: null,
		focusedMessageId: null,
	};
}

/** 唯一可写容器仅在本模块内保留。 */
const mutable: MessagesState = reactive(emptyState());
/** 外部只读视图通过现有 Vue 响应式机制公开。 */
const state: ReadonlyMessagesState = readonly(mutable) as ReadonlyMessagesState;
/** 草稿按会话标识隔离，不写入浏览器持久化。 */
const drafts: Map<string, ChatDraft> = new Map();
/** 发送生命周期按会话保存，防止切走再返回时重复提交。 */
const commands: Map<string, MessagesState['command']> = new Map();
/** 当前会话删除墓碑阻止迟到历史或搜索结果复活消息。 */
const deletedIds: Set<string> = new Set();
/** 账户代次使旧账户异步结果永久失效。 */
let accountGeneration: number = 0;
/** 选择代次使旧会话异步结果永久失效。 */
let selectionGeneration: number = 0;
/** 收件箱查询代次用于过滤、分页与刷新竞争。 */
let inboxGeneration: number = 0;
/** 搜索代次拒绝旧关键词的迟到响应。 */
let searchGeneration: number = 0;
/** 群列表查询代次拒绝旧生命周期快照。 */
let roomsGeneration: number = 0;
/** 消息刷新代次拒绝被后续刷新取代的完整快照。 */
let timelineGeneration: number = 0;
/** 元数据和消息刷新共用一次提交代次，旧权限快照不能覆盖新结果。 */
let activeRefreshGeneration: number = 0;
/** 同一页面重复激活时通过租约计数共享唯一连接。 */
let owners: number = 0;
/** 当前账户下的全部可取消请求。 */
const controllers: Set<AbortController> = new Set();
/** 选择会话时必须取消的查询请求。 */
const selectedControllers: Set<AbortController> = new Set();
/** 主通道仅在私信页面拥有活动租约期间订阅。 */
let mainConnection: IChannelConnection<Channels['main']> | null = null;
/** 当前会话仅持有一条活动连接。 */
let conversationConnection: IChannelConnection<Channels['chatUser']> | IChannelConnection<Channels['chatRoom']> | null = null;
/** 复用 Misskey 的既有 WebSocket，不创建独立连接。 */
let stream: IStream | null = null;
/** 当前账户只读业务快照用于补齐私聊省略字段。 */
const actor: ShallowRef<ReturnType<typeof accountSnapshot> | null> = shallowRef(null);
/** 认证会话令牌固定到当前代次，不随账户快照更新漂移。 */
let sessionToken: string | null = null;
/** 只有页面可见且在消息底部附近时允许显式标读。 */
let readLease: boolean = false;
/** 最近成功标读的消息避免重复请求。 */
let lastReadId: string | null = null;
/** 正在标读的消息避免滚动事件重复请求。 */
let readingId: string | null = null;
/** 完整快照请求期间到达的增量不得被迟到快照覆盖。 */
let reconciliationChanges: Map<string, ChatMessage | null> | null = null;
/** 合并短时间内同一批会话失效事件。 */
let invalidationTimer: number | null = null;
/** 群生命周期失效才重新查询全部群列表，普通私聊消息不触发此查询。 */
let groupsInvalidated: boolean = false;

/** 会话键仅用于账户内存索引，不承载业务实体。 */
function targetKey(target: ChatTarget | null): string {
	return target ? `${target.type}:${target.id}` : '';
}

/** 检查请求归属的账户与选择仍然有效。 */
function isCurrent(account: number, selection?: number): boolean {
	return account === accountGeneration && mutable.accountId !== null && sessionToken !== null && isCurrentAccount(mutable.accountId, sessionToken) && (selection === undefined || selection === selectionGeneration);
}

/** 类型化、可取消请求包装；选中会话查询随选择变化取消。 */
async function call<E extends keyof Endpoints, P extends Endpoints[E]['req']>(endpoint: E, params: P, selected: boolean = false): Promise<api.SwitchCaseResponseType<E, P>> {
	const accountId: string | null = mutable.accountId;
	if (!accountId || !sessionToken || !isCurrentAccount(accountId, sessionToken)) throw new Error('ACCOUNT_REQUIRED');
	const controller: AbortController = new AbortController();
	controllers.add(controller);
	if (selected) selectedControllers.add(controller);
	try {
		return await request(accountId, endpoint, params, controller.signal);
	} finally {
		controllers.delete(controller);
		selectedControllers.delete(controller);
	}
}

/** 合并服务端 ID 相同的消息，后传入的确认事实覆盖先前值。 */
function mergeMessages(first: readonly ChatMessage[], second: readonly ChatMessage[]): readonly ChatMessage[] {
	const messages: Map<string, ChatMessage> = new Map();
	for (const message of first) if (!deletedIds.has(message.id)) messages.set(message.id, message);
	for (const message of second) if (!deletedIds.has(message.id)) messages.set(message.id, message);
	return Object.freeze(Array.from(messages.values()).sort(/** 用服务端创建时间与 ID 确定展示顺序。 */ (a: ChatMessage, b: ChatMessage): number => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}

/** 将服务端消息归一化为只读领域事实。 */
function normalize(message: entities.ChatMessageLite | entities.ChatMessage): ChatMessage {
	if (!actor.value) throw new Error('ACCOUNT_REQUIRED');
	return normalizeMessage(message, actor.value, mutable.active.user);
}

/** 将消息写入唯一活动会话，并记录快照期间的变化。 */
function acceptMessage(message: ChatMessage): void {
	if (!mutable.active.canRead || deletedIds.has(message.id)) return;
	mutable.active.messages = mergeMessages(mutable.active.messages, [message]);
	reconciliationChanges?.set(message.id, message);
}

/** 从时间线和搜索结果移除已删除消息。 */
function forgetMessage(id: string): void {
	deletedIds.add(id);
	mutable.active.messages = mutable.active.messages.filter(/** 删除后保留其他确认事实。 */ (message: ChatMessage): boolean => message.id !== id);
	mutable.search.items = mutable.search.items.filter(/** 同步搜索视图中的删除。 */ (message: ChatMessage): boolean => message.id !== id);
	reconciliationChanges?.set(id, null);
}

/** 权威读取权限已撤销时立即移除正文和成员，普通传输失败不调用此操作。 */
function revokeReadView(): void {
	conversationConnection?.dispose();
	conversationConnection = null;
	timelineGeneration++;
	searchGeneration++;
	reconciliationChanges = null;
	mutable.active.messages = [];
	mutable.active.hasMore = false;
	mutable.search.items = [];
	mutable.search.hasMore = false;
	mutable.members = [];
	mutable.sentInvitations = [];
	readLease = false;
}

/** 释放会话查询与订阅，清空只属于该会话的临时 UI 查询。 */
function releaseSelection(): void {
	selectionGeneration++;
	timelineGeneration++;
	activeRefreshGeneration++;
	searchGeneration++;
	for (const controller of selectedControllers) controller.abort();
	selectedControllers.clear();
	conversationConnection?.dispose();
	conversationConnection = null;
	readLease = false;
	lastReadId = null;
	readingId = null;
	reconciliationChanges = null;
	deletedIds.clear();
	mutable.members = [];
	mutable.sentInvitations = [];
	mutable.focusedMessageId = null;
	mutable.search = { query: '', items: [], hasMore: false, status: 'idle', error: null };
}

/** 释放全部活动所有者的订阅，但保留当前账户的有界草稿供返回页面使用。 */
function releaseLifecycle(): void {
	releaseSelection();
	mainConnection?.dispose();
	mainConnection = null;
	stream?.off('_connected_', onReconnect);
	stream = null;
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
	window.removeEventListener('pagehide', onPageHide);
	if (invalidationTimer) window.clearTimeout(invalidationTimer);
	invalidationTimer = null;
	for (const controller of controllers) controller.abort();
	controllers.clear();
	mutable.active = emptyActive();
}

/** 销毁旧账户所有业务状态与未完成请求。 */
function clear(): void {
	accountGeneration++;
	inboxGeneration++;
	roomsGeneration++;
	owners = 0;
	releaseLifecycle();
	drafts.clear();
	commands.clear();
	actor.value = null;
	sessionToken = null;
	Object.assign(mutable, emptyState());
}

/** 页面卸载或退出账户后，不保留任何可恢复的消息内存。 */
function onPageHide(): void {
	clear();
}

/** 激活账户页所有权；返回幂等释放方法，离页不会保留流式业务消费者。 */
function activate(accountId: string): () => void {
	const snapshot: ReturnType<typeof accountSnapshot> = accountSnapshot(accountId);
	if (mutable.accountId !== accountId || sessionToken !== snapshot.token) {
		clear();
		mutable.accountId = accountId;
	}
	actor.value = snapshot;
	sessionToken = snapshot.token;
	owners++;
	const generation: number = accountGeneration;
	if (owners === 1) {
		stream = useStream();
		mainConnection = stream.useChannel('main');
		mainConnection.on('chatUpdated', onConversationUpdated);
		mainConnection.on('newChatMessage', onInvalidated);
		mainConnection.on('meUpdated', onAccountUpdated);
		stream.on('_connected_', onReconnect);
		window.document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', onPageHide);
		void loadInbox();
		void loadRooms();
	}
	let released: boolean = false;
	/** 页面租约只释放一次，旧账户租约不能关闭新账户的连接。 */
	return (): void => {
		if (released || generation !== accountGeneration) return;
		released = true;
		owners = Math.max(0, owners - 1);
		if (owners === 0) releaseLifecycle();
	};
}

/** 从当前账户更新策略快照后重新读取服务端联系能力。 */
function onAccountUpdated(): void {
	if (!mutable.accountId) return;
	if (!sessionToken || !isCurrentAccount(mutable.accountId, sessionToken)) { clear(); return; }
	actor.value = accountSnapshot(mutable.accountId);
	if (mutable.active.target && !mutable.active.canRead) revokeReadView();
	onInvalidated();
}

/** 服务器仅发送失效标识，群生命周期才同步邀请与群辅助列表。 */
function onConversationUpdated(event: Parameters<Channels['main']['events']['chatUpdated']>[0]): void {
	if (event.type !== 'user') groupsInvalidated = true;
	onInvalidated();
}

/** 页面恢复可见时校准收件箱、权限和消息，不自动将后台消息标读。 */
function onVisibilityChange(): void {
	if (window.document.visibilityState === 'visible') {
		groupsInvalidated = true;
		onInvalidated();
	} else readLease = false;
}

/** 重连后重新获取已加载消息窗口，恢复断线期间的删除与反应。 */
function onReconnect(): void {
	groupsInvalidated = true;
	onInvalidated();
}

/** 合并账户失效事件，查询失败时保留最后确认数据。 */
function onInvalidated(): void {
	if (owners === 0 || invalidationTimer) return;
	invalidationTimer = window.setTimeout(/** 延迟合并同一批服务端写入事件。 */ (): void => {
		invalidationTimer = null;
		if (owners === 0) return;
		void loadInbox();
		void refreshActive();
		if (groupsInvalidated) { groupsInvalidated = false; void loadRooms(); }
		void syncChatUnreadState();
	}, 100);
}

/** 首次、筛选或失效时获取收件箱；失败保留最后确认事实。 */
async function loadInbox(preserveDepth: boolean = true): Promise<void> {
	const account: number = accountGeneration;
	const generation: number = ++inboxGeneration;
	const depth: number = preserveDepth ? Math.max(PAGE_SIZE, mutable.inbox.items.length) : PAGE_SIZE;
	const query: string = mutable.inbox.query;
	const kind: InboxKind = mutable.inbox.kind;
	mutable.inbox.status = 'loading';
	mutable.inbox.error = null;
	try {
		const conversations: Map<string, Conversation> = new Map();
		const visited: Set<string> = new Set();
		let cursor: string | undefined;
		let nextCursor: string | null;
		do {
			const result: Endpoints['chat/conversations/list']['res'] = await call('chat/conversations/list', { limit: Math.min(PAGE_SIZE, depth - conversations.size), kind, query, cursor });
			if (!isCurrent(account) || generation !== inboxGeneration) return;
			for (const conversation of result.items) conversations.set(conversation.key, freezeEntity(conversation));
			nextCursor = result.nextCursor;
			if (nextCursor && visited.has(nextCursor)) throw new Error('REPEATED_CONVERSATION_CURSOR');
			if (nextCursor) visited.add(nextCursor);
			cursor = nextCursor ?? undefined;
		} while (nextCursor && conversations.size < depth);
		mutable.inbox.items = Object.freeze([...conversations.values()]);
		mutable.inbox.nextCursor = nextCursor;
		mutable.inbox.status = 'ready';
	} catch (error: unknown) {
		if (!isCurrent(account) || generation !== inboxGeneration) return;
		mutable.inbox.status = 'error';
		mutable.inbox.error = failureFrom(error);
	}
}

/** 按服务端不透明游标加载下一页会话，不按消息分页伪造会话分页。 */
async function loadMoreInbox(): Promise<void> {
	if (!mutable.inbox.nextCursor || mutable.inbox.status === 'loading') return;
	const account: number = accountGeneration;
	const generation: number = inboxGeneration;
	mutable.inbox.status = 'loading';
	try {
		const result: Endpoints['chat/conversations/list']['res'] = await call('chat/conversations/list', { limit: PAGE_SIZE, kind: mutable.inbox.kind, query: mutable.inbox.query, cursor: mutable.inbox.nextCursor });
		if (!isCurrent(account) || generation !== inboxGeneration) return;
		const confirmed: Map<string, Conversation> = new Map(mutable.inbox.items.map(/** 收件箱按服务端会话键建立唯一索引。 */ (item: Conversation): [string, Conversation] => [item.key, item]));
		for (const conversation of result.items) confirmed.set(conversation.key, freezeEntity(conversation));
		mutable.inbox.items = Object.freeze([...confirmed.values()]);
		mutable.inbox.nextCursor = result.nextCursor;
		mutable.inbox.status = 'ready';
		mutable.inbox.error = null;
	} catch (error: unknown) {
		if (!isCurrent(account) || generation !== inboxGeneration) return;
		mutable.inbox.status = 'error';
		mutable.inbox.error = failureFrom(error);
	}
}

/** 提交收件箱搜索条件并重新获取服务端结果。 */
async function setInboxQuery(query: string): Promise<void> {
	mutable.inbox.query = query.trim();
	await loadInbox(false);
}

/** 提交服务器支持的会话种类筛选。 */
async function setInboxKind(kind: InboxKind): Promise<void> {
	mutable.inbox.kind = kind;
	await loadInbox(false);
}

/** 在当前选择中获取消息，不触发服务器原有的读取即标读行为。 */
async function fetchTimeline(target: ChatTarget, untilId?: string): Promise<(entities.ChatMessageLite | entities.ChatMessage)[]> {
	return target.type === 'user'
		? await call('chat/messages/user-timeline', { userId: target.id, limit: PAGE_SIZE, untilId, markAsRead: false }, true)
		: await call('chat/messages/room-timeline', { roomId: target.id, limit: PAGE_SIZE, untilId, markAsRead: false }, true);
}

/** 读取对方或群聊的服务器权威事实；邀请中的群聊可展示加入状态但不能读取正文。 */
async function refreshMetadata(target: ChatTarget, generation: number): Promise<void> {
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	if (target.type === 'user') {
		const result: [entities.UserDetailed, Endpoints['chat/contacts/show']['res']] = await Promise.all([
			call('users/show', { userId: target.id }, true),
			call('chat/contacts/show', { userId: target.id }, true),
		]);
		if (!isCurrent(account, selection) || generation !== activeRefreshGeneration) return;
		mutable.active.user = freezeEntity(result[0]);
		mutable.active.contact = freezeEntity(result[1]);
	} else {
		const room: Endpoints['chat/rooms/show']['res'] = await call('chat/rooms/show', { roomId: target.id }, true);
		if (!isCurrent(account, selection) || generation !== activeRefreshGeneration) return;
		mutable.active.room = freezeEntity(room);
	}
}

/** 将路由中的简单会话标识选择为活动会话，所有业务事实由服务器装载。 */
async function select(target: ChatTarget | null): Promise<void> {
	if (targetKey(target) === targetKey(mutable.active.target) && mutable.active.status !== 'idle') {
		if (mutable.active.status === 'error') await refreshActive();
		return;
	}
	releaseSelection();
	mutable.active = emptyActive(target ? freezeEntity({ ...target }) : null);
	mutable.draft = drafts.get(targetKey(target)) ?? Object.freeze({ text: '', file: null });
	mutable.command = commands.get(targetKey(target)) ?? { status: 'idle', error: null };
	if (!target || owners === 0) return;
	mutable.active.status = 'loading';
	await refreshActive();
}

/** 已加载窗口的完整重新确认，修复断线期间的删除及反应，不丢弃并发流式事件。 */
async function reconcileTimeline(): Promise<void> {
	const target: ChatTarget | null = mutable.active.target;
	if (!target || !mutable.active.canRead) return;
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	const generation: number = ++timelineGeneration;
	let oldest: string | undefined = mutable.active.messages[0]?.id;
	const changes: Map<string, ChatMessage | null> = new Map();
	reconciliationChanges = changes;
	let messages: ChatMessage[] = [];
	let cursor: string | undefined;
	let more: boolean = true;
	do {
		const page: (entities.ChatMessageLite | entities.ChatMessage)[] = await fetchTimeline(target, cursor);
		if (!isCurrent(account, selection) || generation !== timelineGeneration || !mutable.active.canRead) return;
		messages.push(...page.map(/** 统一完整时间线的服务器消息视图。 */ (message: entities.ChatMessageLite | entities.ChatMessage): ChatMessage => normalize(message)));
		more = page.length === PAGE_SIZE;
		cursor = page.at(-1)?.id;
		oldest = mutable.active.messages[0]?.id ?? oldest;
	} while (more && cursor && oldest && cursor > oldest);
	if (!isCurrent(account, selection) || generation !== timelineGeneration) return;
	const confirmed: Map<string, ChatMessage> = new Map(messages.map(/** 以消息 ID 建立快照索引。 */ (message: ChatMessage): [string, ChatMessage] => [message.id, message]));
	for (const [id, message] of changes) {
		if (message) confirmed.set(id, message);
		else confirmed.delete(id);
	}
	messages = [...confirmed.values()];
	mutable.active.messages = mergeMessages([], messages);
	mutable.active.hasMore = more;
	reconciliationChanges = null;
}

/** 主动刷新当前会话元数据与已加载消息；错误保留最后确认的数据。 */
async function refreshActive(): Promise<void> {
	const target: ChatTarget | null = mutable.active.target;
	if (!target || owners === 0) return;
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	const generation: number = ++activeRefreshGeneration;
	try {
		await refreshMetadata(target, generation);
		if (!isCurrent(account, selection) || generation !== activeRefreshGeneration) return;
		if (mutable.active.canRead) {
			if (!conversationConnection) connectConversation(target);
			await reconcileTimeline();
		} else {
			revokeReadView();
		}
		if (!isCurrent(account, selection) || generation !== activeRefreshGeneration) return;
		mutable.active.status = 'ready';
		mutable.active.error = null;
	} catch (error: unknown) {
		if (!isCurrent(account, selection) || generation !== activeRefreshGeneration) return;
		mutable.active.status = 'error';
		mutable.active.error = failureFrom(error);
		if (mutable.active.error.code === 'NO_SUCH_ROOM' || mutable.active.error.code === 'NO_SUCH_USER' || mutable.active.error.code === 'CHAT_UNAVAILABLE') {
			revokeReadView();
			mutable.active.room = null;
			mutable.active.contact = null;
			mutable.active.user = null;
		}
	}
}

/** 用户显式请求更早历史，已有事实优先于可能迟到的分页快照。 */
async function loadMoreMessages(): Promise<void> {
	const target: ChatTarget | null = mutable.active.target;
	if (!target || !mutable.active.hasMore || mutable.active.status === 'loading') return;
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	mutable.active.status = 'loading';
	try {
		const page: (entities.ChatMessageLite | entities.ChatMessage)[] = await fetchTimeline(target, mutable.active.messages[0]?.id);
		if (!isCurrent(account, selection) || !mutable.active.canRead) return;
		mutable.active.messages = mergeMessages(page.map(/** 归一化历史页，不覆盖更晚的确认事实。 */ (message: entities.ChatMessageLite | entities.ChatMessage): ChatMessage => normalize(message)), mutable.active.messages);
		mutable.active.hasMore = page.length === PAGE_SIZE;
		mutable.active.status = 'ready';
		mutable.active.error = null;
	} catch (error: unknown) {
		if (!isCurrent(account, selection)) return;
		mutable.active.status = 'error';
		mutable.active.error = failureFrom(error);
	}
}

/** 绑定当前会话消息流，选择代次防止旧通道事件污染新会话。 */
function connectConversation(target: ChatTarget): void {
	conversationConnection?.dispose();
	if (!stream) return;
	conversationConnection = target.type === 'user' ? stream.useChannel('chatUser', { otherId: target.id }) : stream.useChannel('chatRoom', { roomId: target.id });
	conversationConnection.on('message', onMessage);
	conversationConnection.on('deleted', onDeleted);
	conversationConnection.on('react', onReaction);
	conversationConnection.on('unreact', onUnreaction);
}

/** 合并流式正文，不在后台或未观察的情况下自动标读。 */
function onMessage(message: entities.ChatMessageLite): void {
	try {
		acceptMessage(normalize(message));
	} catch {
		onInvalidated();
	}
}

/** 服务端确认删除后同步活动视图及收件箱。 */
function onDeleted(id: string): void {
	forgetMessage(id);
	onInvalidated();
}

/** 反应事件协议直接派生自 misskey-js。 */
type ReactionEvent = Parameters<Channels['chatUser']['events']['react']>[0];

/** 只在 Store 中合并反应事件，不修改传给组件的冻结模型。 */
function applyReaction(event: ReactionEvent, remove: boolean): void {
	const message: ChatMessage | undefined = mutable.active.messages.find(/** 定位服务端事件对应消息。 */ (item: ChatMessage): boolean => item.id === event.messageId);
	if (!message || !actor.value) return;
	const user: Readonly<entities.UserLite> | undefined = event.user ?? (message.fromUserId === actor.value.id ? mutable.active.user ?? undefined : actor.value);
	if (!user) {
		onInvalidated();
		return;
	}
	const reactions: entities.ChatMessage['reactions'] = message.reactions.filter(/** 反应按用户与 emoji 去重。 */ (item: entities.ChatMessage['reactions'][number]): boolean => item.user.id !== user.id || item.reaction !== event.reaction);
	if (!remove) reactions.push({ user, reaction: event.reaction });
	acceptMessage(freezeEntity({ ...message, reactions }));
}

/** 接收服务器添加反应事实。 */
function onReaction(event: ReactionEvent): void {
	applyReaction(event, false);
}

/** 接收服务器移除反应事实。 */
function onUnreaction(event: ReactionEvent): void {
	applyReaction(event, true);
}

/** 将草稿更新限制在当前账户的有界内存中。 */
function setDraft(text: string, file: ChatAttachment | null = mutable.draft.file): void {
	const key: string = targetKey(mutable.active.target);
	if (!key) return;
	const draft: ChatDraft = Object.freeze({ text, file: file ? freezeEntity(file) : null });
	drafts.delete(key);
	drafts.set(key, draft);
	while (drafts.size > MAX_DRAFTS) {
		const oldestKey: string | undefined = drafts.keys().next().value;
		if (oldestKey === undefined) break;
		drafts.delete(oldestKey);
		if (commands.get(oldestKey)?.status !== 'sending') commands.delete(oldestKey);
	}
	mutable.draft = draft;
}

/** 设置会话级命令状态，切换会话时仍不会重复提交正在发送的消息。 */
function setCommand(key: string, status: MessagesState['command']['status'], error: ChatFailure | null = null): void {
	const command: MessagesState['command'] = { status, error };
	if (status === 'idle') commands.delete(key);
	else commands.set(key, command);
	if (targetKey(mutable.active.target) === key) mutable.command = command;
}

/** 提交文本及单附件，HTTP 回执与流式消息按服务器 ID 去重。 */
async function send(): Promise<boolean> {
	const target: ChatTarget | null = mutable.active.target;
	const key: string = targetKey(target);
	if (!target || !mutable.active.canSend || commands.get(key)?.status === 'sending' || commands.get(key)?.status === 'uncertain') return false;
	const draft: ChatDraft = mutable.draft;
	if (!draft.text.trim() && !draft.file) return false;
	const account: number = accountGeneration;
	setCommand(key, 'sending');
	try {
		const message: Endpoints['chat/messages/create-to-user']['res'] | Endpoints['chat/messages/create-to-room']['res'] = target.type === 'user'
			? await call('chat/messages/create-to-user', { toUserId: target.id, text: draft.text || undefined, fileId: draft.file?.id })
			: await call('chat/messages/create-to-room', { toRoomId: target.id, text: draft.text || undefined, fileId: draft.file?.id });
		if (!isCurrent(account)) return false;
		if (targetKey(mutable.active.target) === key) acceptMessage(normalize(message));
		if (drafts.get(key) === draft || targetKey(mutable.active.target) === key && mutable.draft === draft) {
			drafts.delete(key);
			if (targetKey(mutable.active.target) === key) mutable.draft = Object.freeze({ text: '', file: null });
		}
		setCommand(key, 'idle');
		onInvalidated();
		return true;
	} catch (error: unknown) {
		if (!isCurrent(account)) return false;
		setCommand(key, isUncertainFailure(error) ? 'uncertain' : 'failed', failureFrom(error));
		if (!isUncertainFailure(error)) void refreshActive();
		return false;
	}
}

/** 用户完成服务器历史核对后显式解除待确认状态，不自动重发。 */
function confirmUncertainSend(): void {
	const key: string = targetKey(mutable.active.target);
	if (commands.get(key)?.status === 'uncertain') setCommand(key, 'idle');
}

/** 删除命令仍由服务器验证所有权，组件不维护消息副本。 */
async function removeMessage(messageId: string): Promise<void> {
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	await call('chat/messages/delete', { messageId });
	if (!isCurrent(account, selection)) return;
	forgetMessage(messageId);
	onInvalidated();
}

/** 依据服务端确认的反应事实提交添加或移除操作。 */
async function toggleReaction(messageId: string, reaction: string): Promise<void> {
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	const message: ChatMessage | undefined = mutable.active.messages.find(/** 获取唯一权威消息。 */ (item: ChatMessage): boolean => item.id === messageId);
	if (!message || !actor.value) return;
	const reacted: boolean = message.reactions.some(/** 判断当前账户已确认的反应。 */ (item: entities.ChatMessage['reactions'][number]): boolean => item.user.id === actor.value?.id && item.reaction === reaction);
	await call(reacted ? 'chat/messages/unreact' : 'chat/messages/react', { messageId, reaction });
	if (!isCurrent(account, selection)) return;
	await refreshActive();
}

/** 页面仅提交可见性和滚动位置，不能利用该租约重定义业务权限。 */
function setReadLease(visible: boolean, nearBottom: boolean): void {
	readLease = owners > 0 && visible && nearBottom && window.document.visibilityState === 'visible';
}

/** 只标读已经由活动页面观察到的消息 ID，后台同步不产生标读副作用。 */
async function markObservedRead(messageId: string): Promise<void> {
	const target: ChatTarget | null = mutable.active.target;
	if (!target || !readLease || readingId !== null && readingId >= messageId || lastReadId !== null && lastReadId >= messageId || !mutable.active.messages.some(/** 只接受当前会话已装载的服务端消息。 */ (message: ChatMessage): boolean => message.id === messageId)) return;
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	readingId = messageId;
	try {
		await call('chat/conversations/read', target.type === 'user' ? { userId: target.id, messageId } : { roomId: target.id, messageId }, true);
		if (!isCurrent(account, selection)) return;
		if (lastReadId === null || messageId > lastReadId) lastReadId = messageId;
		void loadInbox();
		void syncChatUnreadState();
	} catch {
		// 标读失败保留未读事实，下一次观察或重连后重新尝试。
	} finally {
		if (isCurrent(account, selection) && readingId === messageId) readingId = null;
	}
}

/** 在当前会话内执行服务器消息搜索，首次结果不会被旧关键词响应覆盖。 */
async function searchMessages(query: string): Promise<void> {
	searchGeneration++;
	const changed: boolean = mutable.search.query !== query.trim();
	mutable.search.query = query.trim();
	mutable.search.error = null;
	if (changed || !mutable.search.query) { mutable.search.items = []; mutable.search.hasMore = false; }
	await loadSearch(false);
}

/** 以服务端 ID 游标读取搜索结果下一页。 */
async function loadMoreSearch(): Promise<void> {
	if (!mutable.search.hasMore || mutable.search.status === 'loading') return;
	await loadSearch(true);
}

/** 搜索请求统一管理生命周期和错误。 */
async function loadSearch(more: boolean): Promise<void> {
	const target: ChatTarget | null = mutable.active.target;
	if (!target || !mutable.search.query) {
		mutable.search.status = 'idle';
		return;
	}
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	const generation: number = ++searchGeneration;
	mutable.search.status = 'loading';
	mutable.search.error = null;
	try {
		const results: Endpoints['chat/messages/search']['res'] = await call('chat/messages/search', { query: mutable.search.query, userId: target.type === 'user' ? target.id : undefined, roomId: target.type === 'room' ? target.id : undefined, limit: PAGE_SIZE, untilId: more ? mutable.search.items.at(-1)?.id : undefined }, true);
		if (!isCurrent(account, selection) || generation !== searchGeneration) return;
		const confirmed: Map<string, ChatMessage> = new Map((more ? mutable.search.items : []).map(/** 搜索分页同样按服务端标识去重。 */ (message: ChatMessage): [string, ChatMessage] => [message.id, message]));
		for (const message of results) if (!deletedIds.has(message.id)) confirmed.set(message.id, normalize(message));
		mutable.search.items = Object.freeze([...confirmed.values()]);
		mutable.search.hasMore = results.length === PAGE_SIZE;
		mutable.search.status = 'ready';
	} catch (error: unknown) {
		if (!isCurrent(account, selection) || generation !== searchGeneration) return;
		mutable.search.status = 'error';
		mutable.search.error = failureFrom(error);
	}
}

/** 从服务器消息深链解析其真实会话，不接受路由中的业务实体副本。 */
async function resolveMessage(messageId: string): Promise<ChatTarget | null> {
	const account: number = accountGeneration;
	const message: Endpoints['chat/messages/show']['res'] = await call('chat/messages/show', { messageId });
	if (!isCurrent(account) || !actor.value) return null;
	if (message.toRoomId) return freezeEntity({ type: 'room', id: message.toRoomId });
	const userId: string | null | undefined = message.fromUserId === actor.value.id ? message.toUserId : message.fromUserId;
	return userId ? freezeEntity({ type: 'user', id: userId }) : null;
}

/** 通过正常历史分页定位深链或搜索结果，不将搜索 DTO 反向写入业务时间线。 */
async function revealMessage(messageId: string): Promise<boolean> {
	if (mutable.active.status === 'loading') return false;
	const selection: number = selectionGeneration;
	while (!mutable.active.messages.some(/** 等待真正的历史消息包含目标。 */ (message: ChatMessage): boolean => message.id === messageId) && mutable.active.hasMore) {
		await loadMoreMessages();
		if (selection !== selectionGeneration || mutable.active.status === 'error') return false;
	}
	const exists: boolean = mutable.active.messages.some(/** 最终以历史事实验证目标存在。 */ (message: ChatMessage): boolean => message.id === messageId);
	if (exists) mutable.focusedMessageId = messageId;
	return exists;
}

/** 分页取全群聊辅助列表，不把接口的默认上限当作完整列表。 */
async function loadRooms(): Promise<void> {
	const account: number = accountGeneration;
	const generation: number = ++roomsGeneration;
	mutable.roomStatus = 'loading';
	try {
		const rooms: ChatRoom[] = [];
		const invitations: entities.ChatRoomInvitation[] = [];
		let cursor: string | undefined;
		let ownedPage: Endpoints['chat/rooms/owned']['res'];
		do {
			ownedPage = await call('chat/rooms/owned', { limit: 100, untilId: cursor });
			if (!isCurrent(account) || generation !== roomsGeneration) return;
			rooms.push(...freezeEntity(ownedPage));
			cursor = ownedPage.at(-1)?.id;
		} while (ownedPage.length === 100);
		let joinedPage: Endpoints['chat/rooms/joining']['res'];
		cursor = undefined;
		do {
			joinedPage = await call('chat/rooms/joining', { limit: 100, untilId: cursor });
			if (!isCurrent(account) || generation !== roomsGeneration) return;
			for (const membership of joinedPage) if (membership.room) rooms.push(freezeEntity(membership.room));
			cursor = joinedPage.at(-1)?.id;
		} while (joinedPage.length === 100);
		let invitationPage: Endpoints['chat/rooms/invitations/inbox']['res'];
		cursor = undefined;
		do {
			invitationPage = await call('chat/rooms/invitations/inbox', { limit: 100, untilId: cursor });
			if (!isCurrent(account) || generation !== roomsGeneration) return;
			invitations.push(...invitationPage);
			cursor = invitationPage.at(-1)?.id;
		} while (invitationPage.length === 100);
		mutable.rooms = Object.freeze([...new Map(rooms.map(/** 按权威群聊标识去重。 */ (room: ChatRoom): [string, ChatRoom] => [room.id, room])).values()]);
		mutable.invitations = freezeEntity(invitations);
		mutable.roomStatus = 'ready';
		mutable.roomError = null;
	} catch (error: unknown) {
		if (!isCurrent(account) || generation !== roomsGeneration) return;
		mutable.roomStatus = 'error';
		mutable.roomError = failureFrom(error);
	}
}

/** 装载当前群聊全部成员及所有者可见的邀请。 */
async function fetchMembers(): Promise<void> {
	const room: ChatRoom | null = mutable.active.room;
	if (!room) return;
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	const members: entities.ChatRoomMembership[] = [];
	const invitations: entities.ChatRoomInvitation[] = [];
	let cursor: string | undefined;
	let page: Endpoints['chat/rooms/members']['res'];
	do {
		page = await call('chat/rooms/members', { roomId: room.id, limit: 100, untilId: cursor }, true);
		if (!isCurrent(account, selection) || !mutable.active.canRead) return;
		members.push(...page);
		cursor = page.at(-1)?.id;
	} while (page.length === 100);
	if (room.ownerId === actor.value?.id) {
		let invitationPage: Endpoints['chat/rooms/invitations/outbox']['res'];
		cursor = undefined;
		do {
			invitationPage = await call('chat/rooms/invitations/outbox', { roomId: room.id, limit: 100, untilId: cursor }, true);
			if (!isCurrent(account, selection) || !mutable.active.canRead) return;
			invitations.push(...invitationPage);
			cursor = invitationPage.at(-1)?.id;
		} while (invitationPage.length === 100);
	}
	mutable.members = freezeEntity(members);
	mutable.sentInvitations = freezeEntity(invitations);
}

/** 成员查询失败由 Store 保留错误状态，并交给 UI 显示显式重试。 */
async function loadMembers(): Promise<void> {
	const account: number = accountGeneration;
	const selection: number = selectionGeneration;
	mutable.roomStatus = 'loading';
	mutable.roomError = null;
	try {
		await fetchMembers();
		if (isCurrent(account, selection)) mutable.roomStatus = 'ready';
	} catch (error: unknown) {
		if (!isCurrent(account, selection)) return;
		mutable.roomStatus = 'error';
		mutable.roomError = failureFrom(error);
		throw error;
	}
}

/** 创建群聊并更新服务器会话索引。 */
async function createRoom(name: string): Promise<ChatRoom | null> {
	const account: number = accountGeneration;
	const room: Endpoints['chat/rooms/create']['res'] = await call('chat/rooms/create', { name });
	if (isCurrent(account)) {
		void loadInbox();
		void loadRooms();
	}
	return isCurrent(account) ? freezeEntity(room) : null;
}

/** 群聊所有者通过服务器发送邀请。 */
async function inviteUser(roomId: string, userId: string): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/invitations/create', { roomId, userId });
	if (isCurrent(account) && mutable.active.room?.id === roomId) await loadMembers();
}

/** 接受真实邀请后重新读取群聊权限和消息。 */
async function joinRoom(roomId: string): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/join', { roomId });
	if (!isCurrent(account)) return;
	await loadRooms();
	await loadInbox();
	if (mutable.active.target?.type === 'room' && mutable.active.target.id === roomId) await refreshActive();
}

/** 忽略指定邀请后重新获取账户邀请事实。 */
async function ignoreInvitation(roomId: string): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/invitations/ignore', { roomId });
	if (isCurrent(account)) await loadRooms();
}

/** 退出群聊后关闭其活动选择并刷新服务器索引。 */
async function leaveRoom(roomId: string): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/leave', { roomId });
	if (!isCurrent(account)) return;
	if (mutable.active.target?.type === 'room' && mutable.active.target.id === roomId) await select(null);
	await loadInbox();
	await loadRooms();
}

/** 修改群聊静音事实后重新获取群聊，不在视图中乐观复制业务状态。 */
async function setRoomMuted(roomId: string, muted: boolean): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/mute', { roomId, mute: muted });
	if (!isCurrent(account)) return;
	if (mutable.active.room?.id === roomId) await refreshActive();
	await loadRooms();
}

/** 群聊资料由服务器更新并重新确认。 */
async function updateRoom(roomId: string, name: string, description: string): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/update', { roomId, name, description });
	if (!isCurrent(account)) return;
	if (mutable.active.room?.id === roomId) await refreshActive();
	await loadRooms();
	await loadInbox();
}

/** 删除群聊后清理活动选择，权限与成员归属仍由服务器验证。 */
async function removeRoom(roomId: string): Promise<void> {
	const account: number = accountGeneration;
	await call('chat/rooms/delete', { roomId });
	if (!isCurrent(account)) return;
	if (mutable.active.room?.id === roomId) await select(null);
	await loadRooms();
	await loadInbox();
}

/** 私信模块唯一公共业务入口；状态只读，所有变更经显式 Action 提交。 */
export const chatStore: Readonly<{
	state: ReadonlyMessagesState;
	activate: typeof activate;
	clear: typeof clear;
	select: typeof select;
	loadInbox: typeof loadInbox;
	loadMoreInbox: typeof loadMoreInbox;
	setInboxQuery: typeof setInboxQuery;
	setInboxKind: typeof setInboxKind;
	refreshActive: typeof refreshActive;
	loadMoreMessages: typeof loadMoreMessages;
	setDraft: typeof setDraft;
	send: typeof send;
	confirmUncertainSend: typeof confirmUncertainSend;
	removeMessage: typeof removeMessage;
	toggleReaction: typeof toggleReaction;
	setReadLease: typeof setReadLease;
	markObservedRead: typeof markObservedRead;
	searchMessages: typeof searchMessages;
	loadMoreSearch: typeof loadMoreSearch;
	resolveMessage: typeof resolveMessage;
	revealMessage: typeof revealMessage;
	loadRooms: typeof loadRooms;
	loadMembers: typeof loadMembers;
	createRoom: typeof createRoom;
	inviteUser: typeof inviteUser;
	joinRoom: typeof joinRoom;
	ignoreInvitation: typeof ignoreInvitation;
	leaveRoom: typeof leaveRoom;
	setRoomMuted: typeof setRoomMuted;
	updateRoom: typeof updateRoom;
	removeRoom: typeof removeRoom;
}> = Object.freeze({ state, activate, clear, select, loadInbox, loadMoreInbox, setInboxQuery, setInboxKind, refreshActive, loadMoreMessages, setDraft, send, confirmUncertainSend, removeMessage, toggleReaction, setReadLease, markObservedRead, searchMessages, loadMoreSearch, resolveMessage, revealMessage, loadRooms, loadMembers, createRoom, inviteUser, joinRoom, ignoreInvitation, leaveRoom, setRoomMuted, updateRoom, removeRoom });
