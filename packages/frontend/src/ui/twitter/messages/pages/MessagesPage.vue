<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI 私信 · 路由工作区。
作用：协调收件箱、对话、搜索与群管理展示，持有滚动、焦点、布局和表单等临时 UI 状态。
数据链：路由标识 → 私信 Store 查询／命令 → 只读模型 → 展示组件。
边界：所有聊天业务事实均由 Store 唯一持有；本页不请求 API、不解释环境探测或运行身份。
-->

<template>
<div ref="workspace" :style="workspaceStyle" :class="[$style.workspace, { [$style.split]: split, [$style.showConversation]: hasTarget || searchOpen }]" data-testid="twitter-messages-workspace">
	<aside :class="$style.inbox" :aria-label="i18n.ts._twitterMessages.title" data-testid="twitter-messages-inbox">
		<header :class="$style.header">
			<h1>{{ i18n.ts._twitterMessages.title }}</h1>
			<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._twitterMessages.newRoom" @click="createRoom"><i class="ti ti-users-plus" aria-hidden="true"></i></button>
			<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._twitterMessages.newChat" data-testid="twitter-messages-new-chat" @click="newChat"><i class="ti ti-message-plus" aria-hidden="true"></i></button>
		</header>
		<form :class="$style.searchForm" data-testid="twitter-messages-inbox-search" @submit.prevent="searchInbox">
			<i class="ti ti-search" aria-hidden="true"></i>
			<input v-model="inboxQuery" type="search" :aria-label="i18n.ts._twitterMessages.inboxSearch" :placeholder="i18n.ts._twitterMessages.inboxSearch" :class="$style.searchInput">
			<button v-if="inboxQuery" type="button" class="_button" :class="$style.clear" :aria-label="i18n.ts.clear" @click="clearInboxSearch"><i class="ti ti-x" aria-hidden="true"></i></button>
		</form>
		<div role="group" data-testid="twitter-messages-filters" :class="$style.filters" :aria-label="i18n.ts.filter">
			<button type="button" class="_button" :class="[$style.filter, { [$style.selected]: state.inbox.kind === 'all' }]" :aria-pressed="state.inbox.kind === 'all'" data-twitter-tab-key="all" @click="setKind('all')">{{ i18n.ts._twitterMessages.all }}</button>
			<button type="button" class="_button" :class="[$style.filter, { [$style.selected]: state.inbox.kind === 'user' }]" :aria-pressed="state.inbox.kind === 'user'" data-twitter-tab-key="user" @click="setKind('user')">{{ i18n.ts._twitterMessages.people }}</button>
			<button type="button" class="_button" :class="[$style.filter, { [$style.selected]: state.inbox.kind === 'room' }]" :aria-pressed="state.inbox.kind === 'room'" data-twitter-tab-key="room" @click="setKind('room')">{{ i18n.ts._twitterMessages.groups }}</button>
			<TwitterTabIndicator :activeKey="state.inbox.kind"/>
		</div>
		<div :class="$style.inboxScroll">
			<div v-if="state.roomError" :class="$style.status" role="alert"><p>{{ i18n.ts._twitterMessages.operationFailed }}</p><button type="button" class="_button" :class="$style.outline" @click="retryRooms">{{ i18n.ts._twitterMessages.retry }}</button></div>
			<div v-if="state.inbox.status === 'loading' && state.inbox.items.length === 0" :class="$style.status" role="status"><MkLoading/><span>{{ i18n.ts.loading }}</span></div>
			<div v-if="state.inbox.error" :class="$style.status" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>{{ i18n.ts._twitterMessages.loadFailed }}</p><button type="button" class="_button" :class="$style.outline" @click="retryInbox">{{ i18n.ts._twitterMessages.retry }}</button></div>
			<div v-if="state.inbox.status === 'ready' && state.inbox.items.length === 0 && (state.inbox.kind === 'user' || state.invitations.length === 0)" :class="$style.emptyInbox">
				<i class="ti ti-message-circle" :class="$style.inboxEmptyIcon" aria-hidden="true"></i>
				<h2>{{ state.inbox.query ? i18n.ts._twitterMessages.noSearchResults : i18n.ts._twitterMessages.emptyInbox }}</h2>
				<p v-if="!state.inbox.query">{{ i18n.ts._twitterMessages.emptyInboxDescription }}</p>
			</div>
			<button v-for="conversation in state.inbox.items" :key="conversation.key" type="button" class="_button" :class="[$style.conversation, { [$style.activeConversation]: isSelected(conversation.target), [$style.unread]: conversation.unread }]" :aria-current="isSelected(conversation.target) ? 'page' : undefined" @click="openTarget(conversation.target)">
				<MkAvatar v-if="conversation.user" :decorations="[]" :user="conversation.user" :class="$style.listAvatar"/>
				<span v-else :class="$style.roomAvatar"><i class="ti ti-users" aria-hidden="true"></i></span>
				<span :class="$style.conversationBody">
					<span :class="$style.conversationTitle"><span :class="$style.truncate">{{ conversationName(conversation) }}</span><MkTime v-if="conversation.latestMessage" :class="$style.time" :time="conversation.latestMessage.createdAt"/></span>
					<span :class="$style.preview">{{ conversation.latestMessage?.text || (conversation.latestMessage?.file ? i18n.ts._twitterMessages.attachmentOnly : i18n.ts._twitterMessages.noMessages) }}</span>
				</span>
				<span v-if="conversation.unread" role="img" :class="$style.unreadDot" :aria-label="i18n.ts.unread"></span>
			</button>
			<button v-if="state.inbox.nextCursor" type="button" class="_button" :class="$style.loadMore" :disabled="state.inbox.status === 'loading'" @click="loadMoreInbox">{{ state.inbox.status === 'loading' ? i18n.ts.loading : i18n.ts.loadMore }}</button>
			<template v-if="state.invitations.length > 0 && state.inbox.kind !== 'user'">
				<h2 :class="$style.sectionTitle">{{ i18n.ts._twitterMessages.receivedInvitation }}</h2>
				<button v-for="invitation in state.invitations" :key="invitation.id" type="button" class="_button" :class="$style.conversation" @click="openRoom(invitation.roomId)"><span :class="$style.roomAvatar"><i class="ti ti-mail" aria-hidden="true"></i></span><span :class="$style.conversationBody"><strong>{{ invitation.room.name }}</strong><span :class="$style.preview">{{ i18n.ts._twitterMessages.invitedRoom }}</span></span></button>
			</template>
		</div>
	</aside>
	<section :class="$style.conversationPane" :aria-label="conversationTitle" data-testid="twitter-messages-conversation">
		<template v-if="searchOpen">
			<header :class="$style.header"><button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._twitterMessages.backToConversation" @click="closeSearch"><i class="ti ti-arrow-left" aria-hidden="true"></i></button><h2>{{ i18n.ts._twitterMessages.searchMessages }}</h2></header>
			<form :class="$style.searchForm" @submit.prevent="searchMessages"><i class="ti ti-search" aria-hidden="true"></i><input v-model="messageQuery" type="search" :class="$style.searchInput" :aria-label="i18n.ts._twitterMessages.searchMessages" :placeholder="i18n.ts._twitterMessages.searchMessages"><button type="submit" class="_button" :class="$style.iconButton" :aria-label="i18n.ts.search"><i class="ti ti-arrow-right" aria-hidden="true"></i></button></form>
			<div :class="$style.messagesScroll">
				<div v-if="state.search.status === 'loading'" :class="$style.status" role="status"><MkLoading/></div>
				<div v-if="state.search.error" :class="$style.status" role="alert"><p>{{ i18n.ts._twitterMessages.loadFailed }}</p><button type="button" class="_button" :class="$style.outline" @click="searchMessages">{{ i18n.ts._twitterMessages.retry }}</button></div>
				<p v-if="state.search.status === 'ready' && state.search.items.length === 0" :class="$style.status">{{ i18n.ts._twitterMessages.noSearchResults }}</p>
				<MessageBubble v-for="message in state.search.items" :key="message.id" :message="message" :canInteract="false" :showSender="true" :searchResult="true"/>
				<button v-if="state.search.hasMore" type="button" class="_button" :class="$style.loadMore" :disabled="state.search.status === 'loading'" @click="loadMoreSearch">{{ i18n.ts.loadMore }}</button>
			</div>
		</template>
		<template v-else-if="hasTarget">
			<header :class="$style.header">
				<button v-if="!split" type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts.goBack" @click="backToInbox"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>
				<MkAvatar v-if="state.active.user" :decorations="[]" :user="state.active.user" :class="$style.headerAvatar"/>
				<h2 :class="$style.truncate">{{ conversationTitle }}</h2>
				<button v-if="state.active.user" type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._twitterMessages.openProfile" @click="openProfile"><i class="ti ti-user" aria-hidden="true"></i></button>
				<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._twitterMessages.searchMessages" @click="openSearch"><i class="ti ti-search" aria-hidden="true"></i></button>
				<button v-if="state.active.room" type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._twitterMessages.roomDetails" :aria-expanded="detailsOpen" @click="toggleDetails"><i class="ti ti-info-circle" aria-hidden="true"></i></button>
			</header>
			<div v-if="routeLoading" :class="$style.status" role="status"><MkLoading/><span>{{ i18n.ts.loading }}</span></div>
			<RoomDetails v-else-if="detailsOpen && state.active.room" :room="state.active.room" :canRead="state.active.canRead" @close="closeDetails"/>
			<template v-else>
				<div ref="messageViewport" :class="$style.messagesScroll" tabindex="0" :aria-label="i18n.ts._chat.messages" @scroll.passive="onScroll">
					<div ref="messageContent" :class="$style.messageContent">
						<div v-if="state.active.status === 'loading' && state.active.messages.length === 0" :class="$style.status" role="status"><MkLoading/><span>{{ i18n.ts.loading }}</span></div>
						<div v-if="state.active.error" :class="$style.status" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>{{ i18n.ts._twitterMessages.loadFailed }}</p><button type="button" class="_button" :class="$style.outline" @click="retryConversation">{{ i18n.ts._twitterMessages.retry }}</button></div>
						<div v-if="deepLinkMissing" :class="$style.status" role="alert">{{ i18n.ts._twitterMessages.messageUnavailable }}</div>
						<button v-if="state.active.hasMore" type="button" class="_button" :class="$style.loadMore" :disabled="loadingOlder" @click="loadOlder">{{ loadingOlder ? i18n.ts.loading : i18n.ts._twitterMessages.olderMessages }}</button>
						<div v-if="state.active.status === 'ready' && state.active.messages.length === 0 && state.active.canRead" :class="$style.emptyConversation"><h3>{{ i18n.ts._twitterMessages.noMessages }}</h3><p>{{ i18n.ts._twitterMessages.noMessagesDescription }}</p></div>
						<div v-if="state.active.room && !state.active.canRead" :class="$style.status"><p>{{ !state.active.room.isMember && state.active.room.invitationExists ? i18n.ts._twitterMessages.invitedRoom : disabledReason }}</p><button v-if="state.active.room.invitationExists" type="button" class="_button" :class="$style.primary" @click="joinRoom">{{ i18n.ts._twitterMessages.joinRoom }}</button></div>
						<template v-for="(message, index) in state.active.messages" :key="message.id">
							<div v-if="startsDate(message, index)" :class="$style.dateDivider"><time :datetime="message.createdAt">{{ formatDate(message.createdAt) }}</time></div>
							<MessageBubble :message="message" :canInteract="state.active.canSend" :showSender="state.active.room != null" :highlighted="state.focusedMessageId === message.id"/>
						</template>
					</div>
				</div>
				<button v-if="newMessages" type="button" class="_button" :class="$style.newMessages" @click="scrollToBottom"><i class="ti ti-arrow-down" aria-hidden="true"></i> {{ i18n.ts._twitterMessages.newMessages }}</button>
				<MessageComposer v-if="state.active.status === 'ready'" :key="activeKey" :canSend="state.active.canSend" :disabledReason="disabledReason"/>
			</template>
		</template>
		<div v-else :class="$style.unselected">
			<div :class="$style.emptyCircle"><i class="ti ti-message-circle" aria-hidden="true"></i></div>
			<h2>{{ i18n.ts._twitterMessages.startConversation }}</h2>
			<p>{{ i18n.ts._twitterMessages.chooseConversation }}</p>
			<button type="button" class="_button" :class="$style.primary" @click="newChat">{{ i18n.ts._twitterMessages.newChat }}</button>
		</div>
	</section>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { ComputedRef, CSSProperties, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { lang } from '@@/js/config.js';
import { chatStore } from '../index.js';
import type { ChatMessage, ChatTarget, Conversation, InboxKind } from '../index.js';
import MessageBubble from '../components/MessageBubble.vue';
import MessageComposer from '../components/MessageComposer.vue';
import RoomDetails from '../components/RoomDetails.vue';
import { TWITTER_LAYOUT_BREAKPOINTS } from '../../context/index.js';
import { TwitterTabIndicator } from '../../index.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { userPage } from '@/filters/user.js';
import * as os from '@/os.js';

/** 路由只传实体或消息标识，不能成为业务实体的副本。 */
type MessagesPageProps = Readonly<{ userId?: string; roomId?: string; messageId?: string }>;
/** 路由输入保持只读。 */
const props: MessagesPageProps = defineProps<MessagesPageProps>();
/** 当前认证账户用于激活隔离的内存状态。 */
const $i: Misskey.entities.MeDetailed = ensureSignin();
/** 路由对象只承担位置变更。 */
const router: ReturnType<typeof useRouter> = useRouter();
/** 页面只消费唯一状态所有者。 */
const state: typeof chatStore.state = chatStore.state;
/** 当前页面注册的生命周期租约。 */
let disposeStore: () => void = chatStore.activate($i.id);
/** 工作区几何只用于展示分栏，不探测运行环境。 */
const workspace: Readonly<Ref<HTMLElement | null>> = useTemplateRef<HTMLElement>('workspace');
/** 消息滚动容器只服务 UI 几何和可见消息观察。 */
const messageViewport: Readonly<Ref<HTMLElement | null>> = useTemplateRef<HTMLElement>('messageViewport');
/** 内容节点在媒体尺寸变化时维持到底部的跟随。 */
const messageContent: Readonly<Ref<HTMLElement | null>> = useTemplateRef<HTMLElement>('messageContent');
/** 根据容器尺寸从权威断点派生双栏展示。 */
const split: Ref<boolean> = ref<boolean>(false);
/** 搜索输入未提交前只是临时表单。 */
const inboxQuery: Ref<string> = ref<string>(state.inbox.query);
/** 消息搜索输入未提交前只是临时表单。 */
const messageQuery: Ref<string> = ref<string>('');
/** 展示开关不承载会话事实。 */
const searchOpen: Ref<boolean> = ref<boolean>(false);
/** 群详情开关是临时 UI 状态。 */
const detailsOpen: Ref<boolean> = ref<boolean>(false);
/** 上拉分页过程保留同一滚动锚点。 */
const loadingOlder: Ref<boolean> = ref<boolean>(false);
/** 距底部的几何状态，不能用来推断服务器未读总数。 */
const nearBottom: Ref<boolean> = ref<boolean>(true);
/** 新消息提示是临时展示提示，不保存另一份消息集合。 */
const newMessages: Ref<boolean> = ref<boolean>(false);
/** 消息深链不存在时独立提示，不能伪装为空会话。 */
const deepLinkMissing: Ref<boolean> = ref<boolean>(false);
/** 深链解析期间仅保留加载展示，不呈现前一个会话。 */
const routeLoading: Ref<boolean> = ref<boolean>(false);
/** 保留路由请求代次，忽略已经切换页面的 UI 回调。 */
let routeGeneration: number = 0;
/** keep-alive 非活动期间不能标读。 */
let pageActive: boolean = true;
/** 销毁后不再操作页面 DOM。 */
let disposed: boolean = false;
/** 工作区尺寸观察器只负责展示几何。 */
let layoutObserver: ResizeObserver | null = null;
/** 内容尺寸观察器只负责媒体加载后的滚动跟随。 */
let contentObserver: ResizeObserver | null = null;
/** 可视视口的几何上限，只约束当前工作区，不解释键盘或设备能力。 */
const availableHeight: Ref<number | null> = ref<number | null>(null);
/** 浏览器平移可视视口时，工作区在原父容器内的临时位移。 */
const viewportShift: Ref<number> = ref<number>(0);
/** 合并可视视口和父容器的同一帧几何变化。 */
let viewportFrame: number | null = null;
/** 当前注册的几何事件监听仅属于活动页面。 */
let viewportListening: boolean = false;
/** 高度与位移全部由 DOM 几何派生，不影响业务发送能力。 */
const workspaceStyle: ComputedRef<CSSProperties> = computed(/** 原容器内可见部分成为聊天滚动边界。 */ (): CSSProperties => availableHeight.value == null ? {} : { height: `${availableHeight.value}px`, transform: viewportShift.value > 0 ? `translateY(${viewportShift.value}px)` : undefined });
/** 初次与路由切换的展示取决于同步路由输入。 */
const hasTarget: ComputedRef<boolean> = computed(/** 不把路由实体标识当成权限事实。 */ (): boolean => !!(props.userId || props.roomId || props.messageId));
/** 草稿编辑器以权威会话标识绑定生命周期。 */
const activeKey: ComputedRef<string> = computed(/** 仅派生临时节点键。 */ (): string => `${state.accountId}:${state.active.target?.type}:${state.active.target?.id}`);
/** 页面标题直接消费服务端用户或群名称。 */
const conversationTitle: ComputedRef<string> = computed(/** 标题只是模型的只读展示投影。 */ (): string => state.active.user?.name || state.active.user?.username || state.active.room?.name || i18n.ts._twitterMessages.title);
/** 服务端能力原因只映射文案，不在客户端重新实现授权规则。 */
const disabledReason: ComputedRef<string | null> = computed(/** 允许状态直接服从 Store，不从用户字段推导。 */ (): string | null => {
	if (state.active.canSend) return null;
	if (state.active.status === 'loading') return i18n.ts._twitterMessages.contactLoading;
	switch (state.active.contact?.reason) {
		case 'SELF': return i18n.ts._twitterMessages.selfChat;
		case 'REMOTE_USER': return i18n.ts._twitterMessages.remoteUser;
		case 'CHAT_UNAVAILABLE':
		case 'RECIPIENT_UNAVAILABLE': return i18n.ts._twitterMessages.unavailable;
		case 'CHAT_READ_ONLY': return i18n.ts._twitterMessages.readOnly;
		case 'BLOCKED': return i18n.ts._twitterMessages.blocked;
		case 'RECIPIENT_SCOPE': return i18n.ts._twitterMessages.forbidden;
		default: return state.active.room && !state.active.room.isMember ? i18n.ts._twitterMessages.notMember : state.active.canRead ? i18n.ts._twitterMessages.readOnly : i18n.ts._twitterMessages.unavailable;
	}
});

/** 会话名称保留原有权威用户／群实体来源。 */
function conversationName(conversation: Conversation): string {
	return conversation.user?.name || conversation.user?.username || conversation.room?.name || i18n.ts._twitterMessages.title;
}

/** 行选中态只比较当前权威会话标识。 */
function isSelected(target: ChatTarget): boolean {
	return state.active.target?.type === target.type && state.active.target.id === target.id;
}

/** 导航仅序列化会话标识，由路由观察器触发唯一查询。 */
function openTarget(target: ChatTarget): void {
	if (target.type === 'user') router.push('/chat/user/:userId', { params: { userId: target.id } });
	else router.push('/chat/room/:roomId', { params: { roomId: target.id } });
}

/** 邀请进入群路由，不在列表中预先执行加入命令。 */
function openRoom(id: string): void { router.push('/chat/room/:roomId', { params: { roomId: id } }); }

/** 返回列表只改变路由。 */
function backToInbox(): void { router.push('/chat'); }

/** 用户主页入口只引用当前权威联系人标识。 */
function openProfile(): void { if (state.active.user) router.pushByPath(userPage(state.active.user)); }

/** 复用现有本地用户选择器，选中后进入草稿会话。 */
async function newChat(): Promise<void> {
	try {
		const user: Misskey.entities.UserDetailed = await os.selectUser({ includeSelf: false, localOnly: true });
		if (!disposed) openTarget({ type: 'user', id: user.id });
	} catch { /* 用户取消选择时不产生业务命令。 */ }
}

/** 群创建提交给 Store，创建回执而非表单决定后续路由。 */
async function createRoom(): Promise<void> {
	const input: Awaited<ReturnType<typeof os.inputText>> = await os.inputText({ title: i18n.ts._twitterMessages.newRoom, placeholder: i18n.ts._twitterMessages.roomName, minLength: 1, maxLength: 100 });
	if (input.canceled || !input.result?.trim()) return;
	try {
		const room: Awaited<ReturnType<typeof chatStore.createRoom>> = await chatStore.createRoom(input.result.trim());
		if (room && !disposed) openRoom(room.id);
	} catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); }
}

/** 收件箱查询仅在用户提交时更新 Store 查询条件。 */
async function searchInbox(): Promise<void> { await chatStore.setInboxQuery(inboxQuery.value.trim()); }

/** 清空表单后从唯一查询所有者重新加载。 */
async function clearInboxSearch(): Promise<void> { inboxQuery.value = ''; await searchInbox(); }

/** 筛选值直接沿用接口领域类型。 */
async function setKind(kind: InboxKind): Promise<void> { await chatStore.setInboxKind(kind); }

/** 查询失败保留原有结果，显式重试交给 Store。 */
async function retryInbox(): Promise<void> { await chatStore.loadInbox(); }

/** 群邀请查询失败时显式重试，不能伪装成没有邀请。 */
async function retryRooms(): Promise<void> { await chatStore.loadRooms(); }

/** 游标由 Store 唯一管理。 */
async function loadMoreInbox(): Promise<void> { await chatStore.loadMoreInbox(); }

/** 搜索开关只切换视图。 */
function openSearch(): void { searchOpen.value = true; syncRead(); }

/** 关闭搜索恢复原会话，不复制搜索结果。 */
function closeSearch(): void { searchOpen.value = false; void nextTick(syncRead); }

/** 当前会话搜索的目标由 Store 确定。 */
async function searchMessages(): Promise<void> { await chatStore.searchMessages(messageQuery.value.trim()); }

/** 搜索分页沿用服务端游标。 */
async function loadMoreSearch(): Promise<void> { await chatStore.loadMoreSearch(); }

/** 群详情展示前由 Store 统一更新成员与邀请。 */
async function toggleDetails(): Promise<void> { detailsOpen.value = !detailsOpen.value; syncRead(); if (detailsOpen.value && state.active.canRead) { try { await chatStore.loadMembers(); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } } }

/** 关闭详情恢复消息区域的可见观察。 */
function closeDetails(): void { detailsOpen.value = false; void nextTick(syncRead); }

/** 加入后由 Store 刷新会话读取能力。 */
async function joinRoom(): Promise<void> {
	if (!state.active.room) return;
	try { await chatStore.joinRoom(state.active.room.id); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); }
}

/** 日期分隔只从权威创建时间派生。 */
function startsDate(message: ChatMessage, index: number): boolean {
	const previous: ChatMessage | undefined = state.active.messages[index - 1];
	return previous == null || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
}

/** 使用既有界面语言格式化本地日期，不新增业务日期。 */
function formatDate(timestamp: string): string { return new Date(timestamp).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' }); }

/** 上拉分页前后按内容高度差保留当前消息锚点。 */
async function loadOlder(): Promise<void> {
	const element: HTMLElement | null = messageViewport.value;
	if (!element || loadingOlder.value) return;
	const oldHeight: number = element.scrollHeight;
	const oldTop: number = element.scrollTop;
	loadingOlder.value = true;
	try {
		await chatStore.loadMoreMessages();
		await nextTick();
		if (messageViewport.value === element) element.scrollTop = oldTop + element.scrollHeight - oldHeight;
	} finally { loadingOlder.value = false; onScroll(); }
}

/** 已观察消息只在页面可见、当前视图为消息且位于底部时提交标读。 */
function syncRead(): void {
	if (!pageActive || disposed) return;
	const visible: boolean = pageActive && !window.document.hidden && !searchOpen.value && !detailsOpen.value && os.popups.value.length === 0;
	chatStore.setReadLease(visible, nearBottom.value);
	if (!visible || !nearBottom.value || !state.active.canRead || !messageViewport.value) return;
	const bounds: DOMRect = messageViewport.value.getBoundingClientRect();
	const nodes: NodeListOf<HTMLElement> | undefined = messageContent.value?.querySelectorAll<HTMLElement>('[data-message-id]');
	if (!nodes) return;
	let observed: string | null = null;
	for (const node of nodes) {
		const rectangle: DOMRect = node.getBoundingClientRect();
		if (rectangle.bottom > bounds.top && rectangle.top < bounds.bottom) observed = node.dataset.messageId ?? observed;
	}
	if (observed) void chatStore.markObservedRead(observed);
}

/** 手动滚动仅派生几何状态，不计算业务未读计数。 */
function onScroll(): void {
	if (!pageActive || disposed) return;
	const element: HTMLElement | null = messageViewport.value;
	if (!element) return;
	nearBottom.value = element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
	if (nearBottom.value) newMessages.value = false;
	syncRead();
}

/** 明确点击新消息提示后定位底部，并重新确认可见消息。 */
function scrollToBottom(): void {
	if (!pageActive || disposed) return;
	const element: HTMLElement | null = messageViewport.value;
	if (!element) return;
	element.scrollTop = element.scrollHeight;
	nearBottom.value = true;
	newMessages.value = false;
	syncRead();
}

/** 读取浏览器当前可见矩形，避免输入法覆盖编辑器；不推断键盘种类或设备。 */
function measureViewport(): void {
	viewportFrame = null;
	if (!pageActive || disposed) return;
	const parent: HTMLElement | null | undefined = workspace.value?.parentElement;
	const viewport: VisualViewport | null = window.visualViewport;
	if (!parent || !viewport) { availableHeight.value = null; viewportShift.value = 0; return; }
	const rectangle: DOMRect = parent.getBoundingClientRect();
	const shift: number = Math.max(0, viewport.offsetTop - rectangle.top);
	const visibleTop: number = Math.max(rectangle.top, viewport.offsetTop);
	const visibleBottom: number = Math.min(rectangle.bottom, viewport.offsetTop + viewport.height);
	viewportShift.value = shift;
	availableHeight.value = Math.max(0, visibleBottom - visibleTop);
	if (nearBottom.value) void nextTick(scrollToBottom);
}

/** 同一帧只读取一次布局，避免 resize 与 scroll 连续触发同步回流。 */
function scheduleViewportMeasurement(): void {
	if (!pageActive || disposed || viewportFrame != null) return;
	viewportFrame = window.requestAnimationFrame(measureViewport);
}

/** 活动页订阅视口几何；不引入运行环境能力模型。 */
function startViewportGeometry(): void {
	if (viewportListening) return;
	viewportListening = true;
	window.visualViewport?.addEventListener('resize', scheduleViewportMeasurement);
	window.visualViewport?.addEventListener('scroll', scheduleViewportMeasurement);
	window.addEventListener('resize', scheduleViewportMeasurement);
	window.document.addEventListener('visibilitychange', onVisibilityChange);
	scheduleViewportMeasurement();
}

/** 页面缓存或销毁时撤销几何监听，防止隐藏页操作共享读租约。 */
function stopViewportGeometry(): void {
	viewportListening = false;
	window.visualViewport?.removeEventListener('resize', scheduleViewportMeasurement);
	window.visualViewport?.removeEventListener('scroll', scheduleViewportMeasurement);
	window.removeEventListener('resize', scheduleViewportMeasurement);
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
	if (viewportFrame != null) window.cancelAnimationFrame(viewportFrame);
	viewportFrame = null;
}

/** 消息内容尺寸变化只操作当前活动页的跟随状态。 */
function observeContent(element: HTMLElement | null): void {
	contentObserver?.disconnect();
	if (!element || !pageActive) return;
	contentObserver = new ResizeObserver(/** 附件解码改变高度时只跟随已到底部的视图。 */ (): void => { if (nearBottom.value && !loadingOlder.value && !props.messageId) scrollToBottom(); });
	contentObserver.observe(element);
}

/** 可见性变化不自动重发或重建业务策略。 */
function onVisibilityChange(): void { syncRead(); }

/** 路由标识交给 Store 校验，迟到的 DOM 处理受页面代次保护。 */
async function selectRoute(): Promise<void> {
	if (!pageActive) return;
	const generation: number = ++routeGeneration;
	routeLoading.value = true;
	searchOpen.value = false;
	detailsOpen.value = false;
	deepLinkMissing.value = false;
	newMessages.value = false;
	nearBottom.value = true;
	chatStore.setReadLease(false, false);
	let target: ChatTarget | null = props.userId ? { type: 'user', id: props.userId } : props.roomId ? { type: 'room', id: props.roomId } : null;
	if (props.messageId) {
		await chatStore.select(null);
		try { target = await chatStore.resolveMessage(props.messageId); } catch { target = null; }
	}
	if (disposed || generation !== routeGeneration) return;
	if (props.messageId && !target) { deepLinkMissing.value = true; routeLoading.value = false; return; }
	await chatStore.select(target);
	if (disposed || generation !== routeGeneration) return;
	routeLoading.value = false;
	if (props.messageId) {
		const found: boolean = await chatStore.revealMessage(props.messageId);
		if (disposed || generation !== routeGeneration) return;
		deepLinkMissing.value = !found;
		await nextTick();
		const focused: HTMLElement | null = window.document.getElementById(`chat-message-${props.messageId}`);
		focused?.scrollIntoView({ block: 'center' });
		onScroll();
	} else {
		await nextTick();
		scrollToBottom();
	}
}

/** 会话错误重试沿用相同路由，不创建另一份数据所有者。 */
async function retryConversation(): Promise<void> { await selectRoute(); }

watch(/** 只观察路由简单标识。 */ (): readonly (string | undefined)[] => [props.userId, props.roomId, props.messageId], selectRoute, { immediate: true });
watch(/** 只观察最新确认消息标识，历史前插不冒充新消息。 */ (): string | undefined => state.active.messages.at(-1)?.id,
	/** 新消息到达时仅在原本到底部的情况下跟随。 */
	async (id: string | undefined, previous: string | undefined): Promise<void> => {
		if (!id || id === previous || loadingOlder.value || props.messageId && !previous) return;
		const follow: boolean = nearBottom.value;
		await nextTick();
		if (follow) scrollToBottom(); else newMessages.value = true;
	});
watch(messageContent, observeContent);
watch(/** 全局交互弹窗覆盖会话时暂停观察，关闭后重新核对可见消息。 */ (): number => os.popups.value.length, /** 弹窗只影响可见租约，不影响服务端未读事实。 */ (): void => { void nextTick(syncRead); });

onMounted(/** 建立工作区几何与文档可见性观察。 */ (): void => {
	layoutObserver = new ResizeObserver(/** 分栏断点只有领域常量一处权威定义。 */ (entries: ResizeObserverEntry[]): void => { const width: number | undefined = entries[0]?.contentRect.width; if (width != null) split.value = width >= TWITTER_LAYOUT_BREAKPOINTS.chatSplit; scheduleViewportMeasurement(); });
	if (workspace.value) layoutObserver.observe(workspace.value);
	startViewportGeometry();
});
onActivated(/** keep-alive 回访时重新取得账户租约，首次挂载复用 setup 的租约。 */ (): void => {
	if (!pageActive) {
		pageActive = true;
		disposeStore = chatStore.activate($i.id);
		startViewportGeometry();
		if (workspace.value) layoutObserver?.observe(workspace.value);
		observeContent(messageContent.value);
		void selectRoute();
	}
	void nextTick(syncRead);
});
onDeactivated(/** 缓存页退出时停止标读并释放全部当前页订阅。 */ (): void => {
	pageActive = false;
	routeGeneration++;
	layoutObserver?.disconnect();
	contentObserver?.disconnect();
	stopViewportGeometry();
	chatStore.setReadLease(false, false);
	disposeStore();
});
onBeforeUnmount(/** 释放 DOM 与 Store 租约，终止迟到 UI 回调。 */ (): void => {
	disposed = true;
	routeGeneration++;
	layoutObserver?.disconnect();
	contentObserver?.disconnect();
	stopViewportGeometry();
	if (pageActive) chatStore.setReadLease(false, false);
	pageActive = false;
	disposeStore();
});

definePage(/** 页面元信息仅提供标题与图标；Shell 布局由同步路由策略裁定。 */ (): { title: string; icon: string } => ({ title: conversationTitle.value, icon: 'ti ti-messages' }));
</script>

<style lang="scss" module>
.workspace { display: flex; width: 100%; height: 100%; min-height: 0; overflow: hidden; color: var(--twitter-fg); background: var(--twitter-panel); font-size: var(--twitter-font-size-body); }
.inbox { display: flex; flex-direction: column; width: 100%; min-width: 0; min-height: 0; }
.conversationPane { position: relative; display: none; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.showConversation:not(.split) .inbox { display: none; }
.showConversation:not(.split) .conversationPane { display: flex; }
/* 收件箱复用主页右栏的有界尺寸，边框计入同一列宽，余量交由会话区。 */
.split .inbox { flex: 0 0 var(--twitter-right-rail-width); box-sizing: border-box; border-right: 1px solid var(--twitter-border); }
.split .conversationPane { display: flex; }
.header { flex: none; display: flex; align-items: center; gap: var(--twitter-space-2); min-height: var(--twitter-header-height); padding-inline: var(--twitter-space-4); box-sizing: border-box; border-bottom: 1px solid var(--twitter-border); }
.header h1, .header h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--twitter-font-size-title); font-weight: 700; }
.iconButton { flex: none; display: grid; place-items: center; width: var(--twitter-touch-target); height: var(--twitter-touch-target); border-radius: var(--twitter-radius-pill); font-size: var(--twitter-font-size-emphasis); }
.iconButton:hover { background: var(--twitter-hover); }
.headerAvatar { flex: none; width: 36px; height: 36px; }
.searchForm { flex: none; display: flex; align-items: center; gap: var(--twitter-space-2); margin: var(--twitter-space-3) var(--twitter-space-4); padding-inline: var(--twitter-space-3); min-height: var(--twitter-touch-target); border: 1px solid transparent; border-radius: var(--twitter-radius-pill); color: var(--twitter-secondary-fg); background: var(--twitter-hover); }
.searchForm:focus-within { border-color: var(--twitter-accent); color: var(--twitter-accent); }
.searchInput { width: 100%; min-width: 0; padding-block: var(--twitter-space-2); outline: none; border: none; color: var(--twitter-fg); background: transparent; font: inherit; }
.clear { display: grid; place-items: center; min-width: 32px; min-height: 32px; }
/* 标签只消费已有筛选事实，指示条由共享展示组件测量实际按钮几何。 */
.filters { --twitter-tab-indicator-inset: var(--twitter-space-3); position: relative; display: flex; flex: none; border-bottom: 1px solid var(--twitter-border); }
.filter { display: flex; flex: 1 1 0; align-items: center; justify-content: center; min-width: 0; min-height: var(--twitter-header-height); padding-inline: var(--twitter-space-3); color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-body); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; transition: background-color var(--twitter-duration-fast) var(--twitter-ease), color var(--twitter-duration-fast) var(--twitter-ease); }
.filter:hover { color: var(--twitter-fg); background: var(--twitter-hover); }
.selected { color: var(--twitter-fg); }
.inboxScroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.conversation { display: flex; align-items: center; gap: var(--twitter-space-3); width: 100%; box-sizing: border-box; padding: var(--twitter-space-4); text-align: left; border-right: 2px solid transparent; }
.conversation:hover, .activeConversation { background: var(--twitter-hover); }
.activeConversation { border-right-color: var(--twitter-accent); }
.listAvatar, .roomAvatar { flex: none; width: var(--twitter-avatar-note-size); height: var(--twitter-avatar-note-size); }
.roomAvatar { display: grid; place-items: center; border-radius: var(--twitter-radius-pill); background: var(--twitter-hover); font-size: var(--twitter-font-size-display); }
.conversationBody { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: var(--twitter-space-1); }
.conversationTitle { display: flex; align-items: baseline; gap: var(--twitter-space-2); }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { margin-left: auto; flex: none; color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-caption); }
.preview { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-meta); }
.unread .conversationTitle { font-weight: 700; }
.unread .preview { color: var(--twitter-fg); }
.unreadDot { flex: none; width: 8px; height: 8px; border-radius: var(--twitter-radius-pill); background: var(--twitter-accent); }
.loadMore { display: block; min-height: var(--twitter-touch-target); width: 100%; color: var(--twitter-accent); text-align: center; }
.sectionTitle { padding-inline: var(--twitter-space-4); font-size: var(--twitter-font-size-emphasis); }
.emptyInbox, .unselected, .emptyConversation, .status { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: var(--twitter-space-4); padding: var(--twitter-space-6) var(--twitter-space-4); text-align: center; }
.emptyInbox { box-sizing: border-box; min-height: 100%; }
.emptyInbox h2, .unselected h2 { margin: 0; font-size: var(--twitter-font-size-heading); }
.emptyInbox p, .unselected p, .emptyConversation p, .status p { margin: 0; color: var(--twitter-secondary-fg); line-height: 1.5; }
.inboxEmptyIcon { font-size: 64px; }
.unselected { flex: 1; gap: 24px; }
.unselected p { max-width: 320px; }
.emptyCircle { display: grid; place-items: center; width: var(--twitter-chat-empty-size); height: var(--twitter-chat-empty-size); background: var(--twitter-hover); border-radius: var(--twitter-radius-pill); font-size: var(--twitter-chat-empty-icon-size); }
.primary, .outline { min-height: var(--twitter-touch-target); padding: var(--twitter-space-2) var(--twitter-space-4); border-radius: var(--twitter-radius-pill); font-weight: 700; }
.primary { color: var(--twitter-panel); background: var(--twitter-fg); }
.primary:hover { opacity: .88; }
.outline { border: 1px solid var(--twitter-border); }
.messagesScroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; overflow-anchor: none; }
.messageContent { padding-block: var(--twitter-space-3); }
.dateDivider { display: flex; justify-content: center; padding: var(--twitter-space-4); color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-caption); }
.dateDivider time { border: 1px solid var(--twitter-border); border-radius: var(--twitter-radius-pill); padding: var(--twitter-space-1) var(--twitter-space-3); }
.newMessages { flex: none; align-self: center; z-index: 1; margin-block: var(--twitter-space-2); min-height: var(--twitter-touch-target); padding: var(--twitter-space-2) var(--twitter-space-4); border-radius: var(--twitter-radius-pill); white-space: nowrap; color: var(--twitter-fg-on-accent); background: var(--twitter-accent); box-shadow: var(--twitter-overlay-shadow); }
.workspace :is(button, a):focus-visible { outline: 2px solid var(--twitter-accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .messagesScroll { scroll-behavior: auto; } .filter { transition: none; } }
</style>
