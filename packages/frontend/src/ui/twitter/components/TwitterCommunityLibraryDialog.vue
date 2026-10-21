<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 频道管理与收藏入口。
作用：在既有模态窗口／移动端抽屉中展示管理中或已收藏的频道，避免管理列表混入发现帖子流。
数据链：宿主频道页持有的分页器与创建权限 → 只读频道列表 → 导航、重试和关闭意图回传宿主。
本组件不初始化请求、不复制频道业务状态，不改变 MkModalWindow 的关闭过渡与设备适配行为。
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="600"
	:height="650"
	@close="requestClose"
	@click="requestClose"
	@esc="requestClose"
	@closed="notifyClosed"
>
	<template #header>{{ title }}</template>
	<div :class="$style.root" data-testid="twitter-community-library">
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
		<TwitterPageState
			v-if="paginator.error.value && !paginator.fetching.value"
			type="error"
			@retry="retry"
		/>
		<MkPagination
			v-else
			:paginator="paginator"
			:autoLoad="false"
			:pullToRefresh="false"
			:forceDisableInfiniteScroll="true"
		>
			<template #empty>
				<TwitterPageState type="empty" :title="emptyTitle"/>
			</template>
			<template #default="{ items }">
				<ul :class="$style.list">
					<li v-for="channel in items" :key="channel.id">
						<MkA :to="`/channels/${channel.id}`" :class="$style.channel" @click="navigate">
							<img v-if="channel.bannerUrl" :class="$style.banner" :src="channel.bannerUrl" alt="" loading="lazy">
							<span v-else :class="$style.banner" aria-hidden="true"><i class="ti ti-device-tv"></i></span>
							<span :class="$style.name">{{ channel.name }}</span>
							<i class="ti ti-chevron-right" :class="$style.chevron" aria-hidden="true"></i>
						</MkA>
					</li>
				</ul>
			</template>
		</MkPagination>
	</div>
</MkModalWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { TwitterCommunityLibrary } from '../domain/index.js';
import TwitterPageState from './TwitterPageState.vue';
import MkA from '@/components/global/MkA.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkPagination from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import type { Paginator } from '@/utility/paginator.js';

/** 宿主提供权威频道分页器及权限；此展示契约不另建频道实体或请求状态。 */
type LibraryDialogProps = Readonly<{
	kind: TwitterCommunityLibrary;
	paginator: Paginator<'channels/owned'> | Paginator<'channels/my-favorites'>;
	canCreateChannel: boolean;
	closing?: boolean;
}>;

/** 模态窗口只回传交互意图，宿主负责分页器请求和实例生命周期。 */
type LibraryDialogEvents = {
	(event: 'close'): void;
	(event: 'closed'): void;
	(event: 'navigate'): void;
	(event: 'retry'): void;
};

/** 只读接收当前管理视图的数据源与创建权限。 */
const props: Readonly<Required<LibraryDialogProps>> = withDefaults(defineProps<LibraryDialogProps>(), {
	/** 外部路由尚未要求退出时，窗口维持既有打开状态。 */
	closing: false,
});
/** 将窗口交互转交持有频道页状态的宿主。 */
const emit: LibraryDialogEvents = defineEmits<LibraryDialogEvents>();
/** 仅保存既有窗口的实例引用，以保留其关闭过渡与抽屉适配。 */
const dialog: Readonly<ShallowRef<InstanceType<typeof MkModalWindow> | null>> = useTemplateRef<InstanceType<typeof MkModalWindow>>('dialog');
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

/** 失败重试交给持有分页器请求生命周期的频道页处理。 */
function retry(): void {
	emit('retry');
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
	background: var(--twitter-bg);
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
