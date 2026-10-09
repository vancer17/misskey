<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI · Hashtag 结果页（P-15，/tags/:tag 页面变体）

作用：消费页面层（tag.vue）持有的标签时间线分页器与头部动作，
呈现紧凑返回头（back + #tag 标题 + 发帖预填 / ⋯ 动作）与
Twitter 变体帖子时间线，关闭泄漏审计 A3 的路由级旧样式泄漏。

数据链角色：页面层（paginator / actions，单向传入）→ 本组件（壳呈现）；
MkNotesTimeline(variant=twitter) → TwitterNote（行），
加载 / 空 / 错误终态由 MkPagination 内建 P-09 状态件承担。
布局尺度地面真值：nitter 搜索结果页（timeline-container 600px 经 Shell
主列承担、行间 hairline；无 tab 为已记录偏离——notes/search-by-tag 仅
时间序，无热度数据源）。
-->

<template>
<div ref="rootEl" :class="[$style.root, { [$style.mobile]: isMobile }]" class="_pageScrollable">
	<MkStickyContainer>
		<template #header>
			<header :class="$style.header">
				<button
					:class="$style.back"
					class="_button"
					type="button"
					:aria-label="i18n.ts.goBack"
					@click="goBack"
				>
					<i class="ti ti-arrow-left" aria-hidden="true"></i>
				</button>
				<h1 :class="$style.title">#{{ tag }}</h1>
				<div :class="$style.actions">
					<button
						v-for="(action, index) in actions"
						:key="index"
						:class="[$style.action, { [$style.highlighted]: action.highlighted }]"
						class="_button"
						type="button"
						:aria-label="action.text"
						@click="action.handler"
					>
						<i :class="action.icon" aria-hidden="true"></i>
					</button>
				</div>
			</header>
		</template>

		<div :class="$style.body">
			<MkNotesTimeline :paginator="paginator" variant="twitter"/>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkStickyContainer from '@/components/global/MkStickyContainer.vue';
import { useTwitterLayout } from '@/ui/twitter/index.js';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';
import { i18n } from '@/i18n.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import type { Paginator } from '@/utility/paginator.js';

defineProps<{
	/** 路由参数中的 hashtag 名（权威值，仅呈现，不回写）。 */
	tag: string;
	/** 页面层持有的标签时间线分页器（notes/search-by-tag，单向传入）。 */
	paginator: Paginator<'notes/search-by-tag'>;
	/** 头部动作（发帖预填 / ⋯ 菜单）；业务 handler 留在页面层（规范第 12 条）。 */
	actions: PageHeaderItem[];
}>();

const { isMobile } = useTwitterLayout();
const rootEl = useTemplateRef<HTMLDivElement>('rootEl');

/** 保留时间线滚动位置（返回导航后恢复）。 */
useScrollPositionKeeper(rootEl);

/** 返回上一页（与 TwitterFollowList / NotificationsHeader 一致的返回行为）。 */
function goBack(): void {
	window.history.back();
}
</script>

<style lang="scss" module>
.root {
	min-height: 100%;
	background: var(--twitter-bg);
	color: var(--twitter-fg);

	/* 移动布局（≤500px）经 Shell 权威断点切换 class，不写媒体查询（ADR-0001 决策 4）；
	 * 底部留白与 TwitterHome / TwitterFollowList 一致，避免末行被 FAB 遮挡 */
	&.mobile {
		padding-bottom: calc(72px + env(safe-area-inset-bottom));
	}
}

.body {
	min-height: calc(100cqh - (var(--MI-stickyTop, 0px) + var(--MI-stickyBottom, 0px)));
	background: var(--twitter-bg);
}

/* 紧凑返回头：X-behavior 现代表现层（nitter 此页无返回头，属已记录偏离） */
.header {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr) minmax(72px, auto);
	align-items: center;
	height: var(--twitter-header-height);
	background: color-mix(in srgb, var(--twitter-bg) 82%, transparent);
	-webkit-backdrop-filter: blur(12px);
	backdrop-filter: blur(12px);
	border-bottom: solid 1px var(--twitter-border);
}

.back,
.action {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	font-size: 17px;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.back {
	margin-left: var(--twitter-space-2);
}

.title {
	min-width: 0;
	margin: 0;
	padding: 0 var(--twitter-space-2);
	overflow: hidden;
	color: var(--twitter-fg);
	font-size: var(--twitter-font-size-emphasis);
	font-weight: 800;
	line-height: 1.2;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	display: flex;
	gap: var(--twitter-space-1);
	justify-content: flex-end;
	padding-right: var(--twitter-space-2);
}

.highlighted {
	color: var(--twitter-accent);
}
</style>
