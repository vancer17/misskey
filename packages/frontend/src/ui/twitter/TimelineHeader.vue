<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 时间线页头与导航展示。
作用：承载时间线切换、紧凑身份与专用刷新入口，刷新忙闲状态由查询所有者传入。
数据链：只读导航／操作投影 → 页头；切换、刷新意图 → 页面协调层，不持有帖子事实。
-->

<template>
<header :class="[$style.root, { [$style.mobile]: isMobile }]">
	<div :class="$style.left">
		<MkA v-if="displayMyAvatar && $i != null" :class="$style.avatarLink" to="/" :aria-label="i18n.ts.timeline">
			<TwitterAvatar decorationContext="none" :user="$i" :class="$style.avatar"/>
		</MkA>
	</div>

	<nav
		:class="$style.tabs"
		:aria-label="i18n.ts.timeline"
	>
		<button
			v-for="tab in tabs"
			:key="tab.key"
			:data-twitter-tab-key="tab.key"
			class="_button"
			:class="$style.tab"
			type="button"
			:aria-current="tab.key === tabModel ? 'page' : undefined"
			@click="onTabClick(tab, $event)"
		>
			<span :class="$style.tabTitle">{{ tab.title }}</span>
		</button>
		<TwitterTabIndicator :activeKey="tabModel ?? null"/>
	</nav>

	<div :class="$style.actions">
		<button
			v-if="showRefresh"
			class="_button"
			:class="$style.action"
			type="button"
			data-testid="twitter-timeline-refresh"
			:aria-label="refreshing ? i18n.ts.loading : i18n.ts.reload"
			:aria-busy="refreshing"
			:disabled="refreshDisabled || refreshing"
			@click="onRefresh"
		>
			<i :class="[refreshing ? 'ti ti-loader-2' : 'ti ti-refresh', $style.actionIcon, { [$style.refreshing]: refreshing }]" aria-hidden="true"></i>
		</button>
		<button
			v-for="(action, index) in actions"
			:key="index"
			class="_button"
			:class="$style.action"
			type="button"
			:aria-label="action.text ?? i18n.ts.options"
			@click="action.handler"
		>
			<i :class="[action.icon, $style.actionIcon]" aria-hidden="true"></i>
		</button>
	</div>
</header>
</template>

<script lang="ts" setup>
import type { ModelRef } from 'vue';
import TwitterAvatar from './components/TwitterAvatar.vue';
import TwitterTabIndicator from './components/TwitterTabIndicator.vue';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useTwitterLayout } from './composables/use-twitter-layout.js';

const { isMobile } = useTwitterLayout();

/** 页头只接收导航与刷新展示参数，业务状态仍由时间线查询所有者提供。 */
type TimelineHeaderProps = {
	tabs: Tab[];
	actions?: PageHeaderItem[];
	displayMyAvatar?: boolean;
	showRefresh?: boolean;
	refreshing?: boolean;
	refreshDisabled?: boolean;
};

const props: Readonly<TimelineHeaderProps> = withDefaults(defineProps<TimelineHeaderProps>(), {
	/** 未传入额外操作时展示空集合，不引入业务默认动作。 */
	actions: (): PageHeaderItem[] => [],
	displayMyAvatar: false,
	showRefresh: false,
	refreshing: false,
	refreshDisabled: false,
});

const tabModel: ModelRef<string | undefined> = defineModel<string>('tab');

/** 页头只向页面提交用户意图，不执行查询或滚动。 */
const emit = defineEmits<{
	(ev: 'tabReselected'): void;
	(ev: 'refresh'): void;
}>();

/** 手动刷新受原生禁用属性与处理器共同保护，忙时不重复提交。 */
function onRefresh(): void {
	if (props.refreshDisabled || props.refreshing) return;
	emit('refresh');
}

/** 保留原标签动作与重选回顶意图，仅提交当前导航标识。 */
function onTabClick(tab: Tab, ev: PointerEvent): void {
	if (tab.onClick != null) {
		tab.onClick(ev);
		return;
	}

	if (tab.key === tabModel.value) {
		emit('tabReselected');
	}

	tabModel.value = tab.key;
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: minmax(44px, 1fr) minmax(0, 3fr) minmax(44px, 1fr);
	align-items: center;
	/* nitter 地面真值：navbar 50px（PF-1 S-2/S-3 统一权威 token） */
	height: var(--twitter-header-height);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.left {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	min-width: 0;
	padding-left: var(--twitter-space-3);
}

.avatarLink {
	flex-shrink: 0;
}

.avatar {
	width: 32px;
	height: 32px;
}

.tabs {
	--twitter-tab-indicator-inset: var(--twitter-space-3);
	position: relative;
	display: flex;
	height: 100%;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		display: none;
	}
}

.tab {
	position: relative;
	display: flex;
	flex: 1 0 auto;
	align-items: center;
	justify-content: center;
	gap: 6px;
	min-width: 56px;
	height: 100%;
	padding: 0 var(--twitter-space-3);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	text-overflow: ellipsis;
	white-space: nowrap;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 6%, transparent);
		color: var(--twitter-fg);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}

	&[aria-current="page"] {
		color: var(--twitter-fg);
	}
}

.tabTitle {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.actions {
	display: flex;
	gap: var(--twitter-space-1);
	justify-content: flex-end;
	min-width: 0;
	padding-right: var(--twitter-space-2);
}

.action {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.actionIcon {
	font-size: var(--twitter-font-size-title);
}

.refreshing {
	animation: refreshSpin calc(var(--twitter-duration-slow) * 4) linear infinite;
}

@keyframes refreshSpin {
	to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
	.refreshing {
		animation: none;
	}
}

/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4） */
.root.mobile {
	grid-template-columns: minmax(40px, 0.6fr) minmax(0, 3fr) minmax(40px, 0.6fr);

	.tab {
		flex: 0 0 auto;
		min-width: 48px;
		padding: 0 10px;
	}
}
</style>
