<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 通知业务行。
作用：展示既有通知投影并提交已读动作，导航继续由原链接组件处理。
数据链：只读通知 → 用户点击 → 通知状态动作 → 权威账户未读字段，不保存计数副本。
-->

<template>
<component
	:is="rootComponent"
	:to="rootComponent === MkA ? target : undefined"
	:class="[$style.root, { [$style.unread]: unread, [$style.mobile]: isMobile }]"
	:data-notification-type="notification.type"
	@click.capture="onNotificationClick"
>
	<TwitterNotificationIcon :class="$style.icon" :notification="notification"/>

	<div :class="$style.main">
		<header :class="$style.header">
			<template v-if="actor != null">
				<span :class="$style.actor"><MkUserName :user="actor"/></span>
				<span :class="$style.action">{{ actionLabel }}</span>
			</template>
			<span v-else :class="$style.systemTitle">{{ headerLabel }}</span>
			<span v-if="unread" :class="$style.unreadDot">
				<span :class="$style.screenReaderOnly">{{ i18n.ts.unread }}</span>
			</span>
			<MkTime :class="$style.time" :time="notification.createdAt"/>
		</header>

		<div :class="$style.body">
			<TwitterNotificationNotePreview
				v-if="previewNote != null"
				:note="previewNote"
			/>
			<span v-else-if="notification.type === 'roleAssigned'">{{ notification.role.name }}</span>
			<span v-else-if="notification.type === 'chatRoomInvitationReceived'">{{ notification.invitation.room.name }}</span>
			<span v-else-if="notification.type === 'achievementEarned'">{{ i18n.ts._achievements._types[`_${notification.achievement}`].title }}</span>
			<span v-else-if="notification.type === 'exportCompleted'">{{ i18n.ts.showFile }}</span>
			<span v-else-if="notification.type === 'followRequestAccepted' && notification.message != null">
				<Mfm :text="notification.message" :author="notification.user" :plain="true"/>
			</span>
			<span v-else-if="notification.type === 'createToken'">
				<Mfm :text="i18n.tsx._notification.createTokenDescription({ text: i18n.ts.manageAccessTokens })"/>
			</span>
			<span v-else-if="notification.type === 'app'">
				<Mfm :text="notification.body"/>
			</span>
			<span v-else-if="notification.type === 'test'">{{ i18n.ts._notification.notificationWillBeDisplayedLikeThis }}</span>
		</div>

		<div v-if="notification.type === 'reaction:grouped'" :class="$style.users">
			<span
				v-for="reaction in visibleReactions"
				:key="`${reaction.user.id}-${reaction.reaction}`"
				:class="$style.userStackItem"
			>
				<TwitterAvatar decorationContext="none" :class="$style.avatar" :user="reaction.user"/>
				<span :class="$style.reactionBadge">
					<MkReactionIcon
						:reaction="reaction.reaction.replace(/^:(\w+):$/, ':$1@.:')"
						:noStyle="true"
					/>
				</span>
			</span>
			<span v-if="notification.reactions.length > visibleReactions.length" :class="$style.moreUsers">
				+{{ notification.reactions.length - visibleReactions.length }}
			</span>
		</div>

		<div v-else-if="notification.type === 'renote:grouped'" :class="$style.users">
			<span
				v-for="user in visibleRenoteUsers"
				:key="user.id"
				:class="$style.userStackItem"
			>
				<TwitterAvatar decorationContext="none" :class="$style.avatar" :user="user"/>
			</span>
			<span v-if="notification.users.length > visibleRenoteUsers.length" :class="$style.moreUsers">
				+{{ notification.users.length - visibleRenoteUsers.length }}
			</span>
		</div>

		<div v-if="notification.type === 'receiveFollowRequest' && full && !followRequestDone" :class="$style.followRequestActions">
			<MkButton :class="$style.followRequestButton" rounded primary @click.stop="acceptFollowRequest">
				{{ i18n.ts.accept }}
			</MkButton>
			<MkButton :class="$style.followRequestButton" rounded danger @click.stop="rejectFollowRequest">
				{{ i18n.ts.reject }}
			</MkButton>
		</div>
	</div>
</component>
</template>

<script lang="ts" setup>
import TwitterAvatar from './components/TwitterAvatar.vue';
import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkA from '@/components/global/MkA.vue';
import MkButton from '@/components/MkButton.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { confirmNotificationsRead } from '@/notifications/index.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import TwitterNotificationIcon from './NotificationIcon.vue';
import TwitterNotificationNotePreview from './NotificationNotePreview.vue';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile }: { isMobile: Readonly<Ref<boolean>> } = useTwitterLayout();

/** 通知业务行只读输入，通知实体继续复用服务端权威协议类型。 */
type NotificationRowProps = Readonly<{
	notification: Misskey.entities.Notification;
	unread?: boolean;
	full?: boolean;
}>;

const props: Readonly<Required<NotificationRowProps>> = withDefaults(defineProps<NotificationRowProps>(), {
	unread: false,
	full: false,
});

const followRequestDone: Ref<boolean> = ref(false);

/** 点击仅提交全局已读水位动作，不阻塞链接导航；离页后的对账由状态模块继续完成。 */
function onNotificationClick(): void {
	void confirmNotificationsRead();
}

const actor: ComputedRef<Misskey.entities.UserLite | null> = computed(/** 从只读通知投影获取行为人，用于名称展示。 */ (): Misskey.entities.UserLite | null => {
	if ('user' in props.notification && props.notification.user != null) {
		return props.notification.user;
	}
	return null;
});

const actionLabel: ComputedRef<string> = computed(/** 将既有通知种类映射为本地化动作文本。 */ (): string => {
	switch (props.notification.type) {
		case 'reaction':
			return props.notification.note.reactionAcceptance === 'likeOnly'
				? i18n.ts.like
				: i18n.ts._notification._types.reaction;
		case 'note':
		case 'mention':
		case 'reply':
		case 'renote':
		case 'quote':
		case 'follow':
		case 'receiveFollowRequest':
		case 'followRequestAccepted':
			return i18n.ts._notification._types[props.notification.type];
		case 'pollEnded':
			return i18n.ts._notification.pollEnded;
		default:
			return i18n.ts.notifications;
	}
});

const headerLabel: ComputedRef<string> = computed(/** 为系统通知与聚合通知派生本地化标题，不修改通知事实。 */ (): string => {
	switch (props.notification.type) {
		case 'reaction:grouped':
			return props.notification.note.reactionAcceptance === 'likeOnly'
				? i18n.tsx._notification.likedBySomeUsers({ n: String(props.notification.reactions.length) })
				: i18n.tsx._notification.reactedBySomeUsers({ n: String(props.notification.reactions.length) });
		case 'renote:grouped':
			return i18n.tsx._notification.renotedBySomeUsers({ n: String(props.notification.users.length) });
		case 'scheduledNotePosted':
			return i18n.ts._notification.scheduledNotePosted;
		case 'scheduledNotePostFailed':
			return i18n.ts._notification.scheduledNotePostFailed;
		case 'roleAssigned':
			return i18n.ts._notification.roleAssigned;
		case 'chatRoomInvitationReceived':
			return i18n.ts._notification.chatRoomInvitationReceived;
		case 'achievementEarned':
			return i18n.ts._notification.achievementEarned;
		case 'exportCompleted': {
			const entityName: Readonly<Record<Extract<Misskey.entities.Notification, { type: 'exportCompleted' }>['exportedEntity'], string>> = {
				/** 天线导出对象名称。 */
				antenna: i18n.ts.antennas,
				/** 屏蔽列表导出对象名称。 */
				blocking: i18n.ts.blockedUsers,
				/** 收藏夹导出对象名称。 */
				clip: i18n.ts.clips,
				/** 自定义表情导出对象名称。 */
				customEmoji: i18n.ts.customEmojis,
				/** 收藏帖子导出对象名称。 */
				favorite: i18n.ts.favorites,
				/** 关注列表导出对象名称。 */
				following: i18n.ts.following,
				/** 静音列表导出对象名称。 */
				muting: i18n.ts.mutedUsers,
				/** 帖子导出对象名称。 */
				note: i18n.ts.notes,
				/** 用户列表导出对象名称。 */
				userList: i18n.ts.lists,
			} as const;
			return i18n.tsx._notification.exportOfXCompleted({ x: entityName[props.notification.exportedEntity] });
		}
		case 'login':
			return i18n.ts._notification.login;
		case 'createToken':
			return i18n.ts._notification.createToken;
		case 'app':
			return props.notification.header ?? i18n.ts.notifications;
		default:
			return i18n.ts.notifications;
	}
});

const target: ComputedRef<string | null> = computed(/** 导航仅序列化通知关联的实体标识，不向路由写入完整实体。 */ (): string | null => {
	switch (props.notification.type) {
		case 'note':
		case 'mention':
		case 'reply':
		case 'quote':
		case 'reaction':
		case 'reaction:grouped':
		case 'pollEnded':
		case 'scheduledNotePosted':
		case 'renote':
		case 'renote:grouped':
			return notePage(props.notification.note);
		case 'follow':
		case 'receiveFollowRequest':
		case 'followRequestAccepted':
			return userPage(props.notification.user);
		case 'achievementEarned':
			return '/my/achievements';
		case 'exportCompleted':
			return `/my/drive/file/${props.notification.fileId}`;
		case 'createToken':
			return '/settings/apps';
		default:
			return null;
	}
});

const rootComponent: ComputedRef<typeof MkA | 'article'> = computed(/** 有关联目标时复用原链接，否则仅展示通知内容。 */ (): typeof MkA | 'article' => {
	if (target.value == null) return 'article';
	if (props.notification.type === 'receiveFollowRequest') return 'article';
	return MkA;
});

const previewNote: ComputedRef<Misskey.entities.Note | null> = computed(/** 从通知原有投影选择帖子预览，不保存帖子状态副本。 */ (): Misskey.entities.Note | null => {
	switch (props.notification.type) {
		case 'note':
		case 'mention':
		case 'reply':
		case 'quote':
		case 'reaction':
		case 'reaction:grouped':
		case 'pollEnded':
		case 'scheduledNotePosted':
			return props.notification.note;
		case 'renote':
		case 'renote:grouped':
			return props.notification.note.renote ?? props.notification.note;
		default:
			return null;
	}
});

const visibleReactions: ComputedRef<Extract<Misskey.entities.Notification, { type: 'reaction:grouped' }>['reactions']> = computed(/** 聚合回应仅投影前八个头像，原聚合计数保持不变。 */ (): Extract<Misskey.entities.Notification, { type: 'reaction:grouped' }>['reactions'] => {
	return props.notification.type === 'reaction:grouped'
		? props.notification.reactions.slice(0, 8)
		: [];
});

const visibleRenoteUsers: ComputedRef<Extract<Misskey.entities.Notification, { type: 'renote:grouped' }>['users']> = computed(/** 聚合转发仅投影前八个用户，原通知实体保持只读。 */ (): Extract<Misskey.entities.Notification, { type: 'renote:grouped' }>['users'] => {
	return props.notification.type === 'renote:grouped'
		? props.notification.users.slice(0, 8)
		: [];
});

/** 沿用原关注申请确认接口；完成标记只用于本行按钮的临时 UI 展示。 */
function acceptFollowRequest(): void {
	if (!('user' in props.notification)) return;
	followRequestDone.value = true;
	misskeyApi('following/requests/accept', { userId: props.notification.user.id });
}

/** 沿用原关注申请拒绝接口；不在通知组件持有关系状态副本。 */
function rejectFollowRequest(): void {
	if (!('user' in props.notification)) return;
	followRequestDone.value = true;
	misskeyApi('following/requests/reject', { userId: props.notification.user.id });
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: 32px minmax(0, 1fr);
	gap: var(--twitter-space-3);
	box-sizing: border-box;
	padding: 14px 16px;
	color: inherit;
	text-decoration: none;
	background: var(--twitter-bg);
	border-bottom: solid 1px var(--twitter-border);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 4%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.unread {
	background: color-mix(in srgb, var(--twitter-accent) 5%, transparent);
}

.icon {
	margin-top: 2px;
}

.main {
	min-width: 0;
}

.header {
	display: flex;
	gap: 6px;
	align-items: baseline;
	min-width: 0;
}

.actor {
	min-width: 0;
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.action,
.systemTitle {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	font-weight: 400;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.systemTitle {
	color: var(--twitter-fg);
	font-weight: 700;
}

.unreadDot {
	flex-shrink: 0;
	width: 6px;
	height: 6px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
}

.screenReaderOnly {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	clip-path: inset(50%);
	white-space: nowrap;
	border: 0;
	padding: 0;
}

.time {
	flex-shrink: 0;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
}

.body {
	margin-top: 2px;
	min-width: 0;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	line-height: 1.35;
	overflow-wrap: anywhere;
}

.users {
	display: flex;
	gap: var(--twitter-space-2);
	align-items: center;
	margin-top: 10px;
}

.userStackItem {
	position: relative;
}

.avatar {
	width: 32px;
	height: 32px;
}

.reactionBadge {
	position: absolute;
	right: -4px;
	bottom: -4px;
	display: flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	width: 18px;
	height: 18px;
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-bg);
	box-shadow: 0 0 0 2px var(--twitter-bg);
	font-size: 11px;

	> * {
		width: 14px;
		height: 14px !important;
		object-fit: contain;
	}
}

.moreUsers {
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-caption);
	font-weight: 700;
}

.followRequestActions {
	display: flex;
	gap: var(--twitter-space-2);
	max-width: 300px;
	margin-top: 10px;
}

.followRequestButton {
	flex: 1;
}

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.root.mobile {
	grid-template-columns: 28px minmax(0, 1fr);
	gap: 10px;
	padding: var(--twitter-space-3);

	.header {
		gap: var(--twitter-space-1);
	}

	.actor,
	.action,
	.systemTitle {
		font-size: var(--twitter-font-size-meta);
	}
}

@media (prefers-reduced-motion: reduce) {
	.root {
		transition: none;
	}
}
</style>
