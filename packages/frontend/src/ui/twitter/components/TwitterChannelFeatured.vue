<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 频道热门集合业务展示。
作用：只读消费权威查询状态，保留刷新中的帖卡；请求与分页意图交还页面所有者。
数据链：热门查询 store → 状态／帖卡／原广告组件；重试、刷新、追加事件 → store action。
-->

<template>
<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="refresher" @contextmenu="onContextmenu">
	<TwitterPageSkeleton v-if="state.snapshot == null && (state.status === 'idle' || state.status === 'loading')" variant="timeline"/>
	<TwitterPageState v-else-if="state.snapshot == null && state.status === 'error'" type="error" @retry="emit('retry')"/>
	<template v-else>
		<div v-if="state.status === 'loading' && state.operation === 'refresh'" :class="$style.refreshing" role="status" :aria-label="i18n.ts.loading"></div>
		<div v-if="state.status === 'error'" :class="$style.status" role="status">
			{{ i18n.ts.error }} <button class="_textButton" type="button" @click="emit('retry')">{{ i18n.ts.retry }}</button>
		</div>
		<TwitterPageState v-if="state.snapshot?.items.length === 0" type="empty" :title="i18n.ts.noNotes"/>
		<div v-else>
			<div v-for="(note, index) in state.snapshot?.items" :key="note.id" :data-scroll-anchor="note.id">
				<TwitterNote :note="note" decorationContext="note" :withHardMute="true"/>
				<div v-if="index === 3 || (index >= 20 && (index - 20) % 30 === 0)" :class="$style.ad"><MkAd :preferForms="['horizontal', 'horizontal-big']"/></div>
			</div>
		</div>
		<div v-if="state.snapshot?.nextCursor != null && state.status !== 'error'" :class="$style.more">
			<MkLoading v-if="state.status === 'loading' && state.operation === 'more'"/>
			<MkButton v-else v-appear="prefer.s.enableInfiniteScroll ? onMore : null" rounded @click="onMore">{{ i18n.ts.loadMore }}</MkButton>
		</div>
	</template>
</component>
</template>

<script lang="ts" setup>
import type { ChannelFeaturedState } from '../domain/index.js';
import { TwitterNote } from '../index.js';
import TwitterPageSkeleton from './TwitterPageSkeleton.vue';
import TwitterPageState from './TwitterPageState.vue';
import MkButton from '@/components/MkButton.vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { isLink } from '@@/js/is-link.js';
import * as os from '@/os.js';

/** 业务组件仅接收 domain 权威查询状态，不保存实体副本。 */
defineProps<{ state: ChannelFeaturedState; refresher: () => Promise<void> }>();
/** 展示交互只提交查询动作，接口请求继续归页面查询 store。 */
const emit = defineEmits<{ (ev: 'more' | 'retry' | 'refresh'): void }>();

/** 滚动与显式按钮共用追加意图，是否允许请求由 store 校验。 */
function onMore(): void { emit('more'); }

/** 复用原列表的右键刷新入口，链接与文本选择仍由浏览器处理。 */
function onContextmenu(event: PointerEvent): void {
	if ((event.target instanceof HTMLElement && isLink(event.target)) || (window.getSelection()?.toString() ?? '') !== '') return;
	event.preventDefault();
	event.stopPropagation();
	os.contextMenu([{
		icon: 'ti ti-refresh',
		text: i18n.ts.reload,
		/** 菜单只发送刷新意图，不改变集合快照。 */
		action: (): void => { emit('refresh'); },
	}], event);
}
</script>

<style lang="scss" module>
.refreshing {
	height: 2px;
	margin-bottom: -2px;
	position: relative;
	z-index: 1;
	background: var(--twitter-accent);
}

.status {
	padding: var(--twitter-space-2) var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
}

.more {
	display: flex;
	justify-content: center;
	padding: var(--twitter-space-3);
}

.ad {
	padding: var(--twitter-space-2);
	border-bottom: solid 1px var(--twitter-border);
}
</style>
