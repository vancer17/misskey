<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="() => reload()">
	<TwitterNotificationSkeleton v-if="isTwitter && paginator.fetching.value"/>
	<MkLoading v-else-if="paginator.fetching.value"/>

	<MkError
		v-else-if="paginator.error.value && !isTwitter"
		@retry="paginator.init()"
	/>
	<TwitterTimelineState
		v-else-if="paginator.error.value"
		type="error"
		@retry="paginator.init()"
	/>

	<div v-else-if="paginator.items.value.length === 0" key="_empty_">
		<slot name="empty">
			<TwitterTimelineState
				v-if="isTwitter"
				:emptyTitle="i18n.ts.noNotifications"
			/>
			<MkResult v-else type="empty" :text="i18n.ts.noNotifications"/>
		</slot>
	</div>

	<div v-else ref="rootEl">
		<div
			v-if="isTwitter && paginator.queuedAheadItemsCount.value > 0"
			:class="$style.twitterNew"
			role="status"
			aria-live="polite"
		>
			<TwitterNewNotificationsButton
				:count="paginator.queuedAheadItemsCount.value"
				@click="releaseQueue()"
			/>
		</div>
		<component
			:is="prefer.s.animation ? TransitionGroup : 'div'"
			:class="isTwitter ? $style.twitterNotifications : $style.notifications"
			:enterActiveClass="isTwitter ? $style.twitterEnterActive : $style.transition_x_enterActive"
			:leaveActiveClass="isTwitter ? $style.twitterLeaveActive : $style.transition_x_leaveActive"
			:enterFromClass="isTwitter ? $style.twitterEnterFrom : $style.transition_x_enterFrom"
			:leaveToClass="isTwitter ? $style.twitterLeaveTo : $style.transition_x_leaveTo"
			:moveClass="isTwitter ? $style.twitterMove : $style.transition_x_move"
			tag="div"
		>
			<div v-for="(notification, i) in paginator.items.value" :key="notification.id" :data-scroll-anchor="notification.id" :class="$style.item">
				<div v-if="!isTwitter && i > 0 && isSeparatorNeeded(paginator.items.value[i -1].createdAt, notification.createdAt)" :class="$style.date">
					<span><i class="ti ti-chevron-up"></i> {{ getSeparatorInfo(paginator.items.value[i -1].createdAt, notification.createdAt)?.prevText }}</span>
					<span style="height: 1em; width: 1px; background: var(--MI_THEME-divider);"></span>
					<span>{{ getSeparatorInfo(paginator.items.value[i -1].createdAt, notification.createdAt)?.nextText }} <i class="ti ti-chevron-down"></i></span>
				</div>
				<TwitterNotificationRow
					v-if="isTwitter"
					:class="$style.content"
					:notification="notification"
					:unread="isUnread(notification)"
					:full="true"
					@click="clearUnread(notification.id)"
				/>
				<MkNote v-else-if="['reply', 'quote', 'mention'].includes(notification.type) && 'note' in notification" :class="$style.content" :note="notification.note" :withHardMute="true"/>
				<XNotification v-else :class="$style.content" :notification="notification" :withTime="true" :full="true"/>
			</div>
		</component>
		<button
			v-show="paginator.canFetchOlder.value"
			key="_more_"
			v-appear="prefer.s.enableInfiniteScroll ? paginator.fetchOlder : null"
			:disabled="paginator.fetchingOlder.value"
			class="_button"
			:class="[$style.more, { [$style.twitterMore]: isTwitter }]"
			@click="paginator.fetchOlder"
		>
			<div v-if="!paginator.fetchingOlder.value">{{ i18n.ts.loadMore }}</div>
			<MkLoading v-else/>
		</button>
	</div>
</component>
</template>

<script lang="ts" setup>
import { onUnmounted, onMounted, computed, ref, useTemplateRef, TransitionGroup, markRaw, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { notificationTypes } from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import { useDocumentVisibility } from '@@/js/use-document-visibility.js';
import { getScrollContainer, scrollToTop } from '@@/js/scroll.js';
import XNotification from '@/components/MkNotification.vue';
import MkNote from '@/components/MkNote.vue';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import TwitterNewNotificationsButton from '@/ui/twitter/NewNotificationsButton.vue';
import TwitterNotificationRow from '@/ui/twitter/NotificationRow.vue';
import TwitterNotificationSkeleton from '@/ui/twitter/NotificationSkeleton.vue';
import TwitterTimelineState from '@/ui/twitter/TimelineState.vue';
import { isSeparatorNeeded, getSeparatorInfo } from '@/utility/timeline-date-separate.js';
import { Paginator } from '@/utility/paginator.js';

const props = withDefaults(defineProps<{
	excludeTypes?: typeof notificationTypes[number][] | null;
	variant?: 'misskey' | 'twitter';
	initialUnreadCount?: number;
}>(), {
	excludeTypes: null,
	variant: 'misskey',
	initialUnreadCount: 0,
});

const isTwitter = computed(() => props.variant === 'twitter');

const rootEl = useTemplateRef('rootEl');
const unreadNotificationIds = ref(new Set<string>());
let initialUnreadMarkersApplied = false;

const paginator = prefer.s.useGroupedNotifications ? markRaw(new Paginator('i/notifications-grouped', {
	limit: 20,
	computedParams: computed(() => ({
		excludeTypes: props.excludeTypes ?? undefined,
	})),
})) : markRaw(new Paginator('i/notifications', {
	limit: 20,
	computedParams: computed(() => ({
		excludeTypes: props.excludeTypes ?? undefined,
	})),
}));

const MIN_POLLING_INTERVAL = 1000 * 10;
const POLLING_INTERVAL =
	prefer.s.pollingInterval === 1 ? MIN_POLLING_INTERVAL * 1.5 * 1.5 :
	prefer.s.pollingInterval === 2 ? MIN_POLLING_INTERVAL * 1.5 :
	prefer.s.pollingInterval === 3 ? MIN_POLLING_INTERVAL :
	MIN_POLLING_INTERVAL;

if (!store.s.realtimeMode) {
	useInterval(async () => {
		paginator.fetchNewer({
			toQueue: false,
		});
	}, POLLING_INTERVAL, {
		immediate: false,
		afterMounted: true,
	});
}

function isTop() {
	if (scrollContainer == null) return true;
	if (rootEl.value == null) return true;
	const scrollTop = scrollContainer.scrollTop;
	const tlTop = rootEl.value.offsetTop - scrollContainer.offsetTop;
	return scrollTop <= tlTop;
}

function releaseQueue() {
	paginator.releaseQueue();
	scrollToTop(rootEl.value!);
}

let scrollContainer: HTMLElement | null = null;

function onScrollContainerScroll() {
	if (isTop()) {
		paginator.releaseQueue();
	}
}

watch(rootEl, (el) => {
	if (el && scrollContainer == null) {
		scrollContainer = getScrollContainer(el);
		if (scrollContainer == null) return;
		scrollContainer.addEventListener('scroll', onScrollContainerScroll, { passive: true }); // ほんとはscrollendにしたいけどiosが非対応
	}
}, { immediate: true });

const visibility = useDocumentVisibility();
let isPausingUpdate = false;

watch(visibility, () => {
	if (visibility.value === 'hidden') {
		isPausingUpdate = true;
	} else { // 'visible'
		isPausingUpdate = false;
		if (isTop()) {
			releaseQueue();
		}
	}
});

watch(() => [paginator.fetching.value, paginator.items.value.length] as const, ([fetching]) => {
	if (fetching || initialUnreadMarkersApplied || props.initialUnreadCount <= 0) return;
	initialUnreadMarkersApplied = true;

	const ids = paginator.items.value
		.slice(0, Math.min(props.initialUnreadCount, paginator.items.value.length))
		.map((notification) => notification.id);
	unreadNotificationIds.value = new Set(ids);
});

function onNotification(notification: Misskey.entities.Notification) {
	const isMuted = props.excludeTypes ? props.excludeTypes.includes(notification.type as typeof notificationTypes[number]) : false;
	if (isMuted || window.document.visibilityState === 'visible') {
		if (store.s.realtimeMode) {
			useStream().send('readNotification');
		}
	}

	if (!isMuted) {
		addUnread(notification.id);
		if (isTop() && !isPausingUpdate) {
			paginator.prepend(notification);
		} else {
			paginator.enqueue(notification);
		}
	}
}

function isUnread(notification: Misskey.entities.Notification) {
	return unreadNotificationIds.value.has(notification.id);
}

function addUnread(notificationId: string) {
	unreadNotificationIds.value = new Set([...unreadNotificationIds.value, notificationId]);
}

function clearUnread(notificationId: string) {
	if (!unreadNotificationIds.value.has(notificationId)) return;
	const nextIds = new Set(unreadNotificationIds.value);
	nextIds.delete(notificationId);
	unreadNotificationIds.value = nextIds;
}

function clearUnreadMarkers() {
	unreadNotificationIds.value = new Set();
}

function reload() {
	return paginator.reload();
}

let connection: Misskey.IChannelConnection<Misskey.Channels['main']> | null = null;

onMounted(() => {
	paginator.init();

	if (paginator.computedParams) {
		watch(paginator.computedParams, () => {
			paginator.reload();
		}, { immediate: false, deep: true });
	}

	if (store.s.realtimeMode) {
		connection = useStream().useChannel('main');
		connection.on('notification', onNotification);
		connection.on('notificationFlushed', reload);
	}
});

onUnmounted(() => {
	if (connection) connection.dispose();
	if (scrollContainer != null) {
		scrollContainer.removeEventListener('scroll', onScrollContainerScroll);
	}
});

defineExpose({
	reload,
	clearUnreadMarkers,
});
</script>

<style lang="scss" module>
.transition_x_move {
	transition: transform 0.7s cubic-bezier(0.23, 1, 0.32, 1);
}

.transition_x_enterActive {
	transition: transform 0.7s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.7s cubic-bezier(0.23, 1, 0.32, 1);

	&.content,
	.content {
		/* Skip Note Rendering有効時、TransitionGroupで通知を追加するときに一瞬がくっとなる問題を抑制する */
		content-visibility: visible !important;
	}
}

.transition_x_leaveActive {
	transition: height 0.2s cubic-bezier(0,.5,.5,1), opacity 0.2s cubic-bezier(0,.5,.5,1);
}

.transition_x_enterFrom {
	opacity: 0;
	transform: translateY(max(-64px, -100%));
}

@supports (interpolate-size: allow-keywords) {
	.transition_x_enterFrom {
		interpolate-size: allow-keywords; // heightのtransitionを動作させるために必要
		height: 0;
	}
}

.transition_x_leaveTo {
	opacity: 0;
}

.notifications {
	container-type: inline-size;
	background: var(--MI_THEME-panel);
}

.item {
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.date {
	display: flex;
	font-size: 85%;
	align-items: center;
	justify-content: center;
	gap: 1em;
	padding: 8px 8px;
	margin: 0 auto;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.more {
	display: block;
	width: 100%;
	box-sizing: border-box;
	padding: 16px;
	background: var(--MI_THEME-panel);
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.twitterNew {
	position: relative;
	z-index: 1;
	display: flex;
	justify-content: center;
	padding: 8px 0;
	background: var(--twitter-bg);
	border-bottom: solid 0.5px var(--twitter-border);
}

.twitterNotifications {
	container-type: inline-size;
	background: var(--twitter-bg);
}

.twitterEnterActive {
	transition:
		opacity var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-normal) var(--twitter-ease);
}

.twitterEnterFrom {
	opacity: 0;
	transform: translateY(-8px);
}

.twitterLeaveActive {
	transition:
		opacity var(--twitter-duration-fast) ease,
		transform var(--twitter-duration-fast) ease;
}

.twitterLeaveTo {
	opacity: 0;
	transform: translateY(4px);
}

.twitterMove {
	transition: transform var(--twitter-duration-normal) var(--twitter-ease);
}

.twitterMore {
	min-height: 52px;
	background: var(--twitter-bg);
	border-top: none;
	color: var(--twitter-accent);
	font-weight: 700;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover:not(:disabled) {
		background: color-mix(in srgb, var(--twitter-fg) 5%, transparent);
	}
}

@media (prefers-reduced-motion: reduce) {
	.twitterEnterActive,
	.twitterLeaveActive,
	.twitterMove {
		transition: none;
	}
}
</style>
