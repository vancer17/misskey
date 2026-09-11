<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component
	:is="rootComponent"
	:to="rootComponent === MkA ? target : undefined"
	:class="[$style.root, { [$style.unread]: unread }]"
	:data-notification-type="notification.type"
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
				<MkAvatar :class="$style.avatar" :user="reaction.user"/>
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
				<MkAvatar :class="$style.avatar" :user="user"/>
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
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkA from '@/components/global/MkA.vue';
import MkButton from '@/components/MkButton.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import TwitterNotificationIcon from './NotificationIcon.vue';
import TwitterNotificationNotePreview from './NotificationNotePreview.vue';

const props = withDefaults(defineProps<{
	notification: Misskey.entities.Notification;
	unread?: boolean;
	full?: boolean;
}>(), {
	unread: false,
	full: false,
});

const followRequestDone = ref(false);

const actor = computed(() => {
	if ('user' in props.notification && props.notification.user != null) {
		return props.notification.user;
	}
	return null;
});

const actionLabel = computed(() => {
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

const headerLabel = computed(() => {
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
			const entityName = {
				antenna: i18n.ts.antennas,
				blocking: i18n.ts.blockedUsers,
				clip: i18n.ts.clips,
				customEmoji: i18n.ts.customEmojis,
				favorite: i18n.ts.favorites,
				following: i18n.ts.following,
				muting: i18n.ts.mutedUsers,
				note: i18n.ts.notes,
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

const target = computed(() => {
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

const rootComponent = computed(() => {
	if (target.value == null) return 'article';
	if (props.notification.type === 'receiveFollowRequest') return 'article';
	return MkA;
});

const previewNote = computed(() => {
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

const visibleReactions = computed(() => {
	return props.notification.type === 'reaction:grouped'
		? props.notification.reactions.slice(0, 8)
		: [];
});

const visibleRenoteUsers = computed(() => {
	return props.notification.type === 'renote:grouped'
		? props.notification.users.slice(0, 8)
		: [];
});

function acceptFollowRequest() {
	if (!('user' in props.notification)) return;
	followRequestDone.value = true;
	misskeyApi('following/requests/accept', { userId: props.notification.user.id });
}

function rejectFollowRequest() {
	if (!('user' in props.notification)) return;
	followRequestDone.value = true;
	misskeyApi('following/requests/reject', { userId: props.notification.user.id });
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: 32px minmax(0, 1fr);
	gap: 12px;
	box-sizing: border-box;
	padding: 14px 16px;
	color: inherit;
	text-decoration: none;
	background: var(--twitter-bg);
	border-bottom: solid 0.5px var(--twitter-border);
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
	font-size: 14px;
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
	font-size: 14px;
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
	font-size: 13px;
}

.body {
	margin-top: 2px;
	min-width: 0;
	color: var(--twitter-secondary-fg);
	font-size: 14px;
	line-height: 1.35;
	overflow-wrap: anywhere;
}

.users {
	display: flex;
	gap: 8px;
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
	font-size: 12px;
	font-weight: 700;
}

.followRequestActions {
	display: flex;
	gap: 8px;
	max-width: 300px;
	margin-top: 10px;
}

.followRequestButton {
	flex: 1;
}

@media (max-width: 500px) {
	.root {
		grid-template-columns: 28px minmax(0, 1fr);
		gap: 10px;
		padding: 12px;
	}

	.header {
		gap: 4px;
	}

	.actor,
	.action,
	.systemTitle {
		font-size: 13px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.root {
		transition: none;
	}
}
</style>
