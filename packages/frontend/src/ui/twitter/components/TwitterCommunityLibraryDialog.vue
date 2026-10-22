<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 频道管理与收藏入口。
作用：在既有模态窗口／移动端抽屉中展示管理中或已收藏的频道，避免管理列表混入发现帖子流。
数据链：宿主频道页持有的唯一查询与创建权限 → 只读频道列表 → 导航、追加、重试和关闭意图回传宿主。
本组件不初始化请求、不复制频道业务状态，不改变 MkModalWindow 的关闭过渡与设备适配行为。
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="600"
	:height="650"
	heightMode="content"
	:dialogCenterX="dialogCenterX"
	@close="requestClose"
	@click="requestClose"
	@esc="requestClose"
	@closed="notifyClosed"
	@keydown="onKeydown"
>
	<template #header>{{ title }}</template>
	<div ref="content" :class="$style.root" data-testid="twitter-community-library" tabindex="-1" :aria-busy="state.status === 'loading'">
		<MkA
			v-if="kind === 'owned' && canCreateChannel"
			to="/channels/new"
			:class="$style.create"
			data-testid="twitter-community-library-create"
			@click="navigate"
		>
			<i class="ti ti-plus" aria-hidden="true"></i>
			{{ i18n.ts._channel.create }}
		</MkA>
		<template v-if="state.items.length === 0">
			<div v-if="state.status === 'loading'" :class="$style.loading" data-testid="twitter-community-library-loading" role="status" :aria-label="i18n.ts.loading">
				<MkLoading/>
			</div>
			<TwitterPageState v-else-if="state.status === 'error'" :class="$style.state" type="error" data-community-library-status tabindex="-1" @retry="retry"/>
			<TwitterPageState v-else :class="$style.state" type="empty" :title="emptyTitle"/>
		</template>
		<template v-else>
			<ul :class="$style.list">
				<li v-for="channel in state.items" :key="channel.id">
					<MkA
						:to="`/channels/${channel.id}`"
						:class="$style.channel"
						data-testid="twitter-community-library-row"
						data-community-library-item
						@click="navigate"
						@mouseenter="preloadTwitterChannelPage"
						@focus="preloadTwitterChannelPage"
						@pointerdown="preloadTwitterChannelPage"
					>
						<img v-if="channel.bannerUrl" :class="$style.banner" :src="channel.bannerUrl" alt="" loading="lazy">
						<span v-else :class="$style.banner" aria-hidden="true"><i class="ti ti-device-tv"></i></span>
						<span :class="$style.name">{{ channel.name }}</span>
						<i class="ti ti-chevron-right" :class="$style.chevron" aria-hidden="true"></i>
					</MkA>
				</li>
			</ul>
			<div :class="$style.status" role="status" aria-live="polite" data-community-library-status tabindex="-1">
				<template v-if="state.status === 'error'">
					<p>{{ i18n.ts.somethingHappened }}</p>
					<MkButton rounded data-community-library-action @click="retry">{{ i18n.ts.retry }}</MkButton>
				</template>
				<MkButton v-else-if="state.hasMore || state.status === 'loading'" rounded :disabled="state.status === 'loading'" data-testid="twitter-community-library-more" data-community-library-action @click="loadMore">
					{{ state.status === 'loading' ? i18n.ts.loading : i18n.ts.loadMore }}
				</MkButton>
				<p v-else data-testid="twitter-community-library-end">{{ i18n.ts._channel.allShown }}</p>
			</div>
		</template>
	</div>
</MkModalWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { TwitterCommunityLibrary, TwitterCommunityLibraryView } from '../domain/index.js';
import { preloadTwitterChannelPage } from '../routing/index.js';
import { useChannelLibraryFocus } from '../composables/use-channel-library-focus.js';
import TwitterPageState from './TwitterPageState.vue';
import MkA from '@/components/global/MkA.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { isFocusable } from '@/utility/focus.js';

/** 宿主提供稳定的只读响应式投影及权限；此展示契约不另建频道实体或请求状态。 */
type LibraryDialogProps = Readonly<{
	kind: TwitterCommunityLibrary;
	view: ComputedRef<TwitterCommunityLibraryView>;
	canCreateChannel: boolean;
	closing?: boolean;
	dialogCenterX?: number;
}>;

/** 模态窗口只回传交互意图，宿主负责分页器请求和实例生命周期。 */
type LibraryDialogEvents = {
	(event: 'close'): void;
	(event: 'closed'): void;
	(event: 'navigate'): void;
	(event: 'retry'): void;
	(event: 'loadMore'): void;
};

/** 只读接收当前管理视图的数据源与创建权限。 */
const props: Readonly<LibraryDialogProps & { closing: boolean }> = withDefaults(defineProps<LibraryDialogProps>(), {
	/** 外部路由尚未要求退出时，窗口维持既有打开状态。 */
	closing: false,
});
/** 将窗口交互转交持有频道页状态的宿主。 */
const emit: LibraryDialogEvents = defineEmits<LibraryDialogEvents>();
/** 仅保存既有窗口的实例引用，以保留其关闭过渡与抽屉适配。 */
const dialog: Readonly<ShallowRef<InstanceType<typeof MkModalWindow> | null>> = useTemplateRef<InstanceType<typeof MkModalWindow>>('dialog');
/** 弹层始终读取宿主当前投影，不截取打开时的快照或复制频道数组。 */
const state: ComputedRef<TwitterCommunityLibraryView> = computed<TwitterCommunityLibraryView>(/** 依赖稳定 ref，使全局弹层持续响应加载和重试。 */ (): TwitterCommunityLibraryView => props.view.value);
/** 焦点仅在当前资料库正文内衔接，窗口退出仍交由既有模态生命周期。 */
const content: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('content');
/** 关闭过程不再把焦点移入即将退出的窗口。 */
const rememberFocus: (event?: MouseEvent) => void = useChannelLibraryFocus(state, content, /** 保留宿主的关闭意图。 */ (): boolean => !props.closing);
/** 窗口标题从当前入口单向派生，不持有独立导航状态。 */
const title: ComputedRef<string> = computed<string>(
	/** 将管理入口标识映射到已有本地化标题。 */
	(): string => props.kind === 'owned' ? i18n.ts._channel.owned : i18n.ts.favorites,
);
/** 空列表明确说明当前频道集合，避免共享分页器显示笼统的“无”。 */
const emptyTitle: ComputedRef<string> = computed<string>(
	/** 根据当前入口选择准确的空态文案。 */
	(): string => props.kind === 'owned' ? i18n.ts._channel.noOwned : i18n.ts._channel.noFavorites,
);

/** 由宿主触发窗口关闭；实际实例释放仍等待 closed 事件。 */
function close(): void {
	dialog.value?.close();
}

/** 先触发基础窗口关闭以释放焦点，再将按钮、背景点击和 Esc 意图交回宿主。 */
function requestClose(): void {
	close();
	emit('close');
}

/** 窗口完成关闭过渡后通知宿主安全释放实例。 */
function notifyClosed(): void {
	emit('closed');
}

/** 链接自行负责路由导航，先关闭窗口释放焦点，宿主在 closed 后释放实例。 */
function navigate(): void {
	close();
	emit('navigate');
}

/** 失败重试交给持有请求生命周期的频道页处理。 */
function retry(event?: MouseEvent): void {
	rememberFocus(event);
	emit('retry');
}

/** 展示层仅发出追加意图，所有者负责在途互斥和游标校验。 */
function loadMore(event: MouseEvent): void {
	if (state.value.status === 'loading' || !state.value.hasMore) return;
	rememberFocus(event);
	emit('loadMore');
}

/** 资料库内部循环 Tab 边界，背景 inert、Esc 与关闭恢复继续由基础窗口负责。 */
function onKeydown(event: KeyboardEvent): void {
	if (event.defaultPrevented || event.key !== 'Tab' || props.closing) return;
	const root: EventTarget | null = event.currentTarget;
	const focused: Element | null = window.document.activeElement;
	if (!(root instanceof HTMLElement) || !(focused instanceof HTMLElement) || !root.contains(focused)) return;
	const controls: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')).filter(isFocusable);
	const first: HTMLElement | undefined = controls.at(0);
	const last: HTMLElement | undefined = controls.at(-1);
	if (first == null || last == null) return;
	if (!controls.includes(focused) || (event.shiftKey ? focused === first : focused === last)) {
		event.preventDefault();
		(event.shiftKey ? last : first).focus();
	}
}

watch(
	/** 宿主停用或卸载时仅传入关闭意图，不直接拆除仍在打开的全局模态实例。 */
	(): boolean => props.closing,
	/** 首帧就收到关闭意图时，等待窗口模板引用建立再进入原生关闭生命周期。 */
	(closing: boolean): void => { if (closing) void nextTick(close); },
	{ immediate: true },
);

defineExpose({
	/** 复用既有窗口关闭能力，不直接卸载组件。 */
	close,
});
</script>

<style lang="scss" module>
.root {
	color: var(--twitter-fg);
	background: var(--twitter-panel);
}

.root .state {
	min-height: 0;
	padding: var(--twitter-space-6) var(--twitter-space-4);
	background: var(--twitter-panel);
}

.loading {
	padding: var(--twitter-space-6) var(--twitter-space-4);
}

.status {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	color: var(--twitter-secondary-fg);
	text-align: center;

	p { margin: 0; }
}

.create {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-2);
	min-height: var(--twitter-touch-target);
	padding: var(--twitter-space-2) var(--twitter-space-4);
	border-bottom: 1px solid var(--twitter-border);
	color: var(--twitter-accent);
	font-weight: 700;

	&:hover {
		background: var(--twitter-hover);
		text-decoration: none;
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.list {
	padding: 0;
	margin: 0;
	list-style: none;
}

.channel {
	display: flex;
	align-items: center;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-bottom: 1px solid var(--twitter-border);
	color: inherit;

	&:hover {
		background: var(--twitter-hover);
		text-decoration: none;
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.banner {
	display: grid;
	flex: 0 0 96px;
	width: 96px;
	height: 48px;
	place-items: center;
	object-fit: cover;
	border-radius: var(--twitter-radius-small);
	background: var(--twitter-panel);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-heading);
}

.name {
	flex: 1;
	min-width: 0;
	font-size: var(--twitter-font-size-content);
	font-weight: 700;
	overflow-wrap: anywhere;
}

.chevron {
	flex: none;
	color: var(--twitter-secondary-fg);
}
</style>
