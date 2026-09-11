<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span :class="[$style.root, $style[`tone_${tone}`]]">
	<MkReactionIcon
		v-if="notification.type === 'reaction'"
		:class="$style.reaction"
		:reaction="notification.reaction.replace(/^:(\w+):$/, ':$1@.:')"
		:noStyle="true"
	/>
	<img
		v-else-if="notification.type === 'roleAssigned' && notification.role.iconUrl != null"
		:class="$style.image"
		:src="notification.role.iconUrl"
		alt=""
	/>
	<img
		v-else-if="notification.type === 'app' && notification.icon != null"
		:class="$style.image"
		:src="notification.icon"
		alt=""
	/>
	<i v-else :class="iconClass" aria-hidden="true"></i>
</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkReactionIcon from '@/components/MkReactionIcon.vue';

const props = defineProps<{
	notification: Misskey.entities.Notification;
}>();

const tone = computed(() => {
	switch (props.notification.type) {
		case 'follow':
		case 'followRequestAccepted':
		case 'receiveFollowRequest':
		case 'reply':
		case 'pollEnded':
		case 'scheduledNotePosted':
		case 'login':
			return 'accent';
		case 'renote':
		case 'renote:grouped':
		case 'quote':
			return 'success';
		case 'reaction':
		case 'reaction:grouped':
			return props.notification.note.reactionAcceptance === 'likeOnly' ? 'like' : 'reaction';
		case 'achievementEarned':
		case 'createToken':
		case 'roleAssigned':
			return 'warning';
		case 'scheduledNotePostFailed':
			return 'danger';
		default:
			return 'system';
	}
});

const iconClass = computed(() => {
	switch (props.notification.type) {
		case 'follow': return 'ti ti-user-plus';
		case 'receiveFollowRequest': return 'ti ti-clock';
		case 'followRequestAccepted': return 'ti ti-check';
		case 'mention': return 'ti ti-at';
		case 'reply': return 'ti ti-message-circle';
		case 'renote':
		case 'renote:grouped': return 'ti ti-repeat';
		case 'quote': return 'ti ti-quote';
		case 'reaction:grouped': return props.notification.note.reactionAcceptance === 'likeOnly' ? 'ti ti-heart-filled' : 'ti ti-plus';
		case 'pollEnded': return 'ti ti-chart-arrows';
		case 'scheduledNotePosted': return 'ti ti-send';
		case 'scheduledNotePostFailed': return 'ti ti-alert-triangle';
		case 'achievementEarned': return 'ti ti-medal';
		case 'exportCompleted': return 'ti ti-archive';
		case 'login': return 'ti ti-login-2';
		case 'createToken': return 'ti ti-key';
		case 'roleAssigned': return 'ti ti-badges';
		case 'chatRoomInvitationReceived': return 'ti ti-messages';
		case 'note': return 'ti ti-pencil';
		case 'test': return 'ti ti-bell';
		default: return 'ti ti-bell';
	}
});
</script>

<style lang="scss" module>
.root {
	--twitter-warning: var(--MI_THEME-warn);

	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-pill);
	font-size: 16px;
}

.tone_accent {
	background: color-mix(in srgb, var(--twitter-accent) 14%, transparent);
	color: var(--twitter-accent);
}

.tone_success {
	background: color-mix(in srgb, var(--twitter-success) 14%, transparent);
	color: var(--twitter-success);
}

.tone_like {
	background: color-mix(in srgb, var(--twitter-like) 14%, transparent);
	color: var(--twitter-like);
}

.tone_reaction {
	background: color-mix(in srgb, var(--twitter-warning) 16%, transparent);
	color: var(--twitter-warning);
}

.tone_warning {
	background: color-mix(in srgb, var(--twitter-warning) 16%, transparent);
	color: var(--twitter-warning);
}

.tone_danger {
	background: color-mix(in srgb, var(--twitter-danger) 14%, transparent);
	color: var(--twitter-danger);
}

.tone_system {
	background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	color: var(--twitter-secondary-fg);
}

.reaction {
	width: 18px;
	height: 18px !important;
	object-fit: contain;
}

.image {
	width: 18px;
	height: 18px;
	object-fit: contain;
}
</style>
