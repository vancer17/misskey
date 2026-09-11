<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="user" :class="$style.root" class="_pageScrollable">
	<header :class="$style.header">
		<button
			class="_button"
			:class="$style.back"
			type="button"
			:aria-label="i18n.ts.goBack"
			@click="goBack"
		>
			<i class="ti ti-arrow-left" aria-hidden="true"></i>
		</button>
		<div :class="$style.headerMeta">
			<div :class="$style.headerName">
				<MkUserName :user="user" :nowrap="true"/>
			</div>
			<div :class="$style.headerCount">{{ number(user.notesCount) }} {{ i18n.ts.notes }}</div>
		</div>
	</header>

	<div
		:class="$style.banner"
		:style="bannerStyle"
		role="presentation"
	></div>

	<div :class="$style.identity">
		<div :class="$style.identityTop">
			<MkAvatar :class="$style.avatar" :user="user" indicator/>
			<div :class="$style.actions">
				<button
					class="_button"
					:class="$style.menuButton"
					type="button"
					:aria-label="i18n.ts.more"
					@click="showMenu"
				>
					<i class="ti ti-dots" aria-hidden="true"></i>
				</button>
				<button
					v-if="$i?.id === user.id"
					class="_button"
					:class="$style.editButton"
					type="button"
					@click="router.push('/settings/profile')"
				>
					{{ i18n.ts.editProfile }}
				</button>
				<MkFollowButton
					v-else
					class="_button"
					:class="$style.followButton"
					:user="user"
					variant="twitter"
					full
				/>
			</div>
		</div>

		<div :class="$style.identityMain">
			<div :class="$style.nameRow">
				<h1 :class="$style.name"><MkUserName :user="user" :nowrap="false"/></h1>
				<span v-if="user.isLocked" :class="$style.badgeIcon" :aria-label="i18n.ts.private">
					<i class="ti ti-lock" aria-hidden="true"></i>
				</span>
				<span v-if="user.isBot" :class="$style.badgeIcon" :aria-label="i18n.ts.bot">
					<i class="ti ti-robot" aria-hidden="true"></i>
				</span>
			</div>
			<div :class="$style.acct"><MkAcct :user="user" :detail="true"/></div>
			<span v-if="$i && $i.id !== user.id && user.isFollowed" :class="$style.followed">
				{{ i18n.ts.followsYou }}
			</span>

			<div :class="$style.bio">
				<Mfm
					v-if="user.description"
					:text="user.description"
					:isNote="false"
					:author="user"
					class="_selectable"
				/>
				<p v-else :class="$style.emptyBio">{{ i18n.ts.noAccountDescription }}</p>
			</div>

				<div :class="$style.fields">
				<div v-if="user.location" :class="$style.field">
					<i class="ti ti-map-pin" aria-hidden="true"></i>
					<span>{{ user.location }}</span>
				</div>
				<div v-if="user.birthday" :class="$style.field">
					<i class="ti ti-cake" aria-hidden="true"></i>
					<span>{{ birthday }}</span>
				</div>
				<div :class="$style.field">
					<i class="ti ti-calendar" aria-hidden="true"></i>
					<span>{{ dateString(user.createdAt) }}</span>
				</div>
				<div v-for="(field, index) in user.fields" :key="index" :class="$style.field">
					<i class="ti ti-link" aria-hidden="true"></i>
					<div :class="$style.fieldValue">
						<Mfm :text="`${field.name}: ${field.value}`" :author="user" :plain="true" :colored="false"/>
						<i
							v-if="user.verifiedLinks.includes(field.value)"
							v-tooltip:dialog="i18n.ts.verifiedLink"
							:class="[$style.verified, 'ti ti-circle-check']"
							aria-hidden="true"
						></i>
					</div>
				</div>
			</div>

			<div v-if="user.roles.length > 0" :class="$style.roles">
				<MkA
					v-for="role in user.roles"
					:key="role.id"
					:class="$style.role"
					:to="`/roles/${role.id}`"
					:style="{ '--roleColor': role.color ?? 'transparent' }"
				>
					<img v-if="role.iconUrl" :class="$style.roleIcon" :src="role.iconUrl" alt="">
					<span>{{ role.name }}</span>
				</MkA>
			</div>

				<div :class="$style.stats">
				<MkA :to="userPage(user, 'notes')">
					<b>{{ number(user.notesCount) }}</b>
					<span>{{ i18n.ts.notes }}</span>
				</MkA>
				<MkA v-if="isFollowingVisibleForMe(user)" :to="userPage(user, 'following')">
					<b>{{ number(user.followingCount) }}</b>
					<span>{{ i18n.ts.following }}</span>
				</MkA>
				<MkA v-if="isFollowersVisibleForMe(user)" :to="userPage(user, 'followers')">
					<b>{{ number(user.followersCount) }}</b>
					<span>{{ i18n.ts.followers }}</span>
				</MkA>
			</div>
		</div>
	</div>

	<div :class="$style.notices">
		<MkAccountMoved v-if="user.movedTo" :movedTo="user.movedTo"/>
		<MkRemoteCaution v-if="user.host != null" :href="user.url ?? user.uri!"/>
		<MkInfo v-if="user.host == null && user.username.includes('.')">{{ i18n.ts.isSystemAccount }}</MkInfo>
		<MkInfo v-if="user.isSuspended">{{ i18n.ts.userSuspended }}</MkInfo>
		<MkInfo v-if="user.isSilenced">{{ i18n.ts.userSilenced }}</MkInfo>
	</div>

	<TwitterUserTimeline :user="user" :page="page"/>
</div>
<TwitterTimelineState v-else-if="error" type="error" @retry="emit('retry')"/>
<MkLoading v-else :class="$style.loading"/>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkFollowButton from '@/components/MkFollowButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkRemoteCaution from '@/components/MkRemoteCaution.vue';
import MkAccountMoved from '@/components/MkAccountMoved.vue';
import TwitterTimelineState from '@/ui/twitter/TimelineState.vue';
import TwitterUserTimeline from './TwitterUserTimeline.vue';
import number from '@/filters/number.js';
import { dateString } from '@/filters/date.js';
import { userPage } from '@/filters/user.js';
import { getUserMenu } from '@/utility/get-user-menu.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import { isFollowingVisibleForMe, isFollowersVisibleForMe } from '@/utility/isFfVisibleForMe.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

const props = defineProps<{
	user: Misskey.entities.UserDetailed | null;
	page?: string;
	error?: unknown;
}>();

const emit = defineEmits<{
	(ev: 'retry'): void;
}>();

const router = useRouter();
const bannerStyle = computed(() => {
	if (props.user?.bannerUrl == null) return {};

	return {
		backgroundImage: `url(${prefer.s.disableShowingAnimatedImages ? getStaticImageUrl(props.user.bannerUrl) : props.user.bannerUrl})`,
	};
});

const birthday = computed(() => {
	if (props.user?.birthday == null) return '';
	return props.user.birthday.replaceAll('-', '/');
});

function goBack() {
	window.history.back();
}

function showMenu(ev: PointerEvent) {
	if (props.user == null) return;
	const { menu, cleanup } = getUserMenu(props.user, router);
	os.popupMenu(menu, ev.currentTarget ?? ev.target).finally(cleanup);
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
	padding-bottom: calc(72px + env(safe-area-inset-bottom));

	@media (min-width: 501px) {
		padding-bottom: 0;
	}
}

.header {
	position: sticky;
	top: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	gap: 12px;
	height: 53px;
	padding: 0 8px 0 4px;
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 0.5px var(--twitter-border);
}

.back {
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	flex-shrink: 0;
	border-radius: var(--twitter-radius-pill);
	font-size: 18px;
	transition:
		background-color var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-fast) var(--twitter-ease);

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:active {
		transform: scale(0.94);
	}
}

.headerMeta {
	min-width: 0;
}

.headerName {
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: 16px;
	font-weight: 800;
	line-height: 1.25;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.headerCount {
	color: var(--twitter-secondary-fg);
	font-size: 13px;
}

.banner {
	aspect-ratio: 3 / 1;
	max-height: 200px;
	width: 100%;
	background-color: color-mix(in srgb, var(--twitter-fg) 10%, var(--twitter-bg));
	background-position: center;
	background-size: cover;
}

.identity {
	--profileAvatarSize: 112px;
	--profileAvatarOverlap: 44px;
	padding: 0 16px;

	@media (max-width: 500px) {
		--profileAvatarSize: 80px;
		--profileAvatarOverlap: 32px;
		padding: 0 12px;
	}
}

.identityTop {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 12px;
	margin-top: calc(-1 * var(--profileAvatarOverlap));
}

.avatar {
	width: var(--profileAvatarSize);
	height: var(--profileAvatarSize);
	flex-shrink: 0;
	border: solid 4px var(--twitter-bg);
	background: var(--twitter-panel);
}

.actions {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-top: 8px;
}

.menuButton,
.editButton,
.followButton {
	height: 36px;
	border-radius: var(--twitter-radius-pill);
	font-size: 14px;
	font-weight: 700;
	transition:
		background-color var(--twitter-duration-fast) ease,
		border-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-fast) var(--twitter-ease);
}

.menuButton {
	width: 36px;
	color: var(--twitter-fg);
	font-size: 18px;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.editButton {
	padding: 0 16px;
	border: solid 1px var(--twitter-secondary-fg);
	color: var(--twitter-fg);

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.identityMain {
	padding-top: 12px;
}

.nameRow {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
}

.name {
	margin: 0;
	overflow-wrap: anywhere;
	color: var(--twitter-fg);
	font-size: 20px;
	font-weight: 800;
	line-height: 1.2;
}

.badgeIcon {
	display: grid;
	place-items: center;
	width: 20px;
	height: 20px;
	flex-shrink: 0;
	border-radius: var(--twitter-radius-pill);
	background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	color: var(--twitter-accent);
	font-size: 12px;
}

.acct {
	color: var(--twitter-secondary-fg);
	font-size: 15px;
}

.followed {
	display: inline-block;
	margin-top: 8px;
	padding: 2px 8px;
	border-radius: var(--twitter-radius-pill);
	background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	color: var(--twitter-secondary-fg);
	font-size: 12px;
	font-weight: 700;
}

.bio {
	margin-top: 12px;
	color: var(--twitter-fg);
	font-size: 15px;
	line-height: 1.4;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.emptyBio {
	margin: 0;
	color: var(--twitter-secondary-fg);
}

.fields {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 12px;
}

.field {
	display: flex;
	align-items: baseline;
	gap: 8px;
	min-width: 0;
	color: var(--twitter-secondary-fg);
	font-size: 14px;

	> i {
		flex-shrink: 0;
		color: var(--twitter-secondary-fg);
	}

	> span,
	> .fieldValue {
		min-width: 0;
		overflow-wrap: anywhere;
	}
}

.fieldValue {
	display: flex;
	align-items: baseline;
	gap: 4px;
	color: var(--twitter-fg);
}

.verified {
	flex-shrink: 0;
	color: var(--twitter-accent);
}

.roles {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 12px;
}

.role {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	max-width: 100%;
	min-height: 24px;
	padding: 2px 10px;
	border-radius: var(--twitter-radius-pill);
	background: color-mix(in srgb, var(--roleColor, var(--twitter-accent)) 14%, transparent);
	color: var(--twitter-fg);
	font-size: 12px;
	font-weight: 700;
}

.roleIcon {
	height: 14px;
}

.stats {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	margin-top: 16px;
	font-size: 14px;

	a {
		color: var(--twitter-secondary-fg);

		&:hover b {
			text-decoration: underline;
		}
	}

	b {
		margin-right: 4px;
		color: var(--twitter-fg);
	}
}

.notices {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 16px 0;
}

.loading {
	display: grid;
	place-items: center;
	min-height: 100%;
	background: var(--twitter-bg);
}

@media (prefers-reduced-motion: reduce) {
	.back,
	.menuButton,
	.editButton,
	.followButton {
		transition: none;
	}
}
</style>
