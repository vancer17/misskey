<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter UI 根宿主与主滚动视口。
作用：维持路由、主题、三栏及全局弹层；主内容在全宽原生视口滚动，页内不再占用滚动条宽度。
私信复用普通页面的居中列宽与导航，主列及右栏的空间合并为有界聊天工作区，内部独立滚动。
路由同步裁定列宽；右栏首次显示后保留实例，内容提交只触发展示层入场，不延迟页面生命周期。
数据链：既有路由 → 页面出口 → UI 位置记录；匿名入口和实验叠层保留各自容器，不解释业务事实。
-->
<template>
<div ref="shellEl" :class="$style.root" data-testid="twitter-root">
	<XTitlebar v-if="$i && prefer.r.showTitlebar.value" :class="$style.titlebar"/>

	<main v-if="isEntrance" :class="$style.entrance" data-testid="twitter-entry-layout">
		<RouterView :class="$style.entranceContent"/>
	</main>
	<div v-else :class="$style.viewportFrame">
		<div ref="viewportEl" :class="[$style.viewport, { [$style.stackedViewport]: isStacked && !isMessagesWorkspace, [$style.messagesViewport]: isMessagesWorkspace }]" :data-twitter-layout="isMessagesWorkspace ? 'messages' : undefined" data-twitter-scroll-viewport data-testid="twitter-scroll-viewport" tabindex="0" role="region" :aria-label="pageMetadata?.title ?? instanceName">
			<div
				:class="[$style.body, {
					[$style.mobile]: isMobile,
					[$style.guest]: !$i,
						[$style.withRightRail]: rightRailVisible,
					[$style.messagesWorkspace]: isMessagesWorkspace,
					[$style.messagesWide]: isMessagesWorkspace && showRightRail && !isMobile,
				}]"
				data-testid="twitter-content-layout"
			>
				<TwitterSidebar
					v-if="$i && showSidebar"
					:class="$style.sidebar"
					:iconOnly="sidebarIconOnly"
					data-testid="twitter-sidebar"
				/>
				<main ref="mainEl" :class="$style.main" data-testid="twitter-main" @contextmenu.stop="onContextmenu">
					<header v-if="!$i" :class="$style.guestHeader" data-testid="twitter-guest-header">
						<MkA to="/?ui=twitter" :aria-label="instanceName">
							<img :src="instance.iconUrl || '/favicon.ico'" :class="$style.guestLogo" alt=""/>
						</MkA>
						<TwitterAuthButtons compact/>
					</header>
					<div v-if="$i" :class="$style.systemChrome">
						<XReloadSuggestion v-if="shouldSuggestReload"/>
						<XPreferenceRestore v-if="shouldSuggestRestoreBackup"/>
						<XThemePreviewing v-if="isThemePreviewMode"/>
						<XAnnouncements/>
						<XStatusBars :class="$style.statusbars"/>
					</div>
					<StackingRouterView v-if="isStacked && !isMessagesWorkspace" :class="$style.content" stableViewPath="/search" data-twitter-route-outlet>
						<template #fallback><TwitterRouteLoading/></template>
					</StackingRouterView>
					<RouterView v-else :class="[$style.content, { [$style.flowOutlet]: !isMessagesWorkspace }]" data-twitter-route-outlet>
						<template #fallback><TwitterRouteLoading/></template>
					</RouterView>
				</main>
				<TwitterRightRail
					v-if="$i && retainedRailAccount === $i.id"
					v-show="rightRailVisible"
					:key="$i.id"
					:visible="rightRailVisible"
					:animated="prefer.s.animation && !isStacked"
					:inert="!rightRailVisible"
					:aria-hidden="rightRailVisible ? undefined : true"
					:class="$style.rightRail"
					data-testid="twitter-right-rail"
				/>
			</div>
		</div>
	</div>
	<template v-if="!isEntrance && $i && isMobile">
		<TwitterMobileBar v-if="chatLayout !== 'conversation'" :class="$style.mobileBar" data-testid="twitter-mobile-bar"/>
		<TwitterComposeFab v-if="!isMessagesWorkspace"/>
	</template>
	<XCommon>
		<template #streamIndicator>
			<TwitterStreamNotice :visible="streamNoticeVisible" @dismiss="streamNotice.dismiss" @reload="reloadAfterDisconnect"/>
		</template>
	</XCommon>
</div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onBeforeUnmount, provide, ref, useTemplateRef, watch } from 'vue';
import type { Component, ComputedRef, Ref, ShallowRef } from 'vue';
import { instanceName } from '@@/js/config.js';
import { isLink } from '@@/js/is-link.js';
import XCommon from './_common_/common.vue';
import TwitterMobileBar from './twitter/MobileBar.vue';
import TwitterComposeFab from './twitter/ComposeFab.vue';
import TwitterRightRail from './twitter/RightRail.vue';
import TwitterSidebar from './twitter/Sidebar.vue';
import XPreferenceRestore from './_common_/PreferenceRestore.vue';
import XReloadSuggestion from './_common_/ReloadSuggestion.vue';
import XThemePreviewing from './_common_/ThemePreviewing.vue';
import XTitlebar from './_common_/titlebar.vue';
import { TwitterAuthButtons, TwitterRouteLoading, TwitterStreamNotice, createTwitterStreamNotice, provideTwitterScrollHost, useTwitterRouteEntry } from './twitter/index.js';
import type { TwitterStreamNoticeController } from './twitter/index.js';
import { useTwitterLayout, resolveTwitterShellLayout } from '@/ui/twitter/context/index.js';
import type { TwitterShellLayout } from '@/ui/twitter/context/index.js';
import type { PathResolvedResult } from '@/lib/nirax.js';
import type { PageMetadata } from '@/page.js';
import { isPreviewMode as isThemePreviewMode } from '@/theme.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { mainRouter } from '@/router.js';
import { prefer } from '@/preferences.js';
import { shouldSuggestRestoreBackup } from '@/preferences/utility.js';
import { DI } from '@/di.js';
import { shouldSuggestReload } from '@/utility/reload-suggest.js';

const XAnnouncements: Component = defineAsyncComponent(
	/** 仅在账户布局确实挂载时加载公告组件。 */
	(): Promise<typeof import('./_common_/announcements.vue')> => import('./_common_/announcements.vue'),
);
const XStatusBars: Component = defineAsyncComponent(
	/** 系统状态条保留原账户布局中的惰性加载契约。 */
	(): Promise<typeof import('./_common_/statusbars.vue')> => import('./_common_/statusbars.vue'),
);
const { isMobile, showRightRail, showSidebar } = useTwitterLayout();
/** 一个 Shell 只拥有一个提示观察者，路由切换不创建新的连接消费者。 */
const streamNotice: TwitterStreamNoticeController = createTwitterStreamNotice();
/** 模板仅消费临时可见性投影，不保存另一份传输或业务状态。 */
const streamNoticeVisible: Readonly<Ref<boolean>> = streamNotice.visible;

/** 用户明确选择刷新时才重载当前文档，前台恢复与自动重连均不调用此入口。 */
function reloadAfterDisconnect(): void {
	window.location.reload();
}

/** 已解析路由单向派生列宽，异步页面元信息不参与 Shell 的结构决策。 */
const shellLayout: ComputedRef<TwitterShellLayout> = computed(
	/** 拼接路由器实际解析的模板，保留两个真实存量管理宽页的展示边界。 */
	(): TwitterShellLayout => {
		const route: PathResolvedResult = mainRouter.currentRef.value;
		let routePath: string = route.route.path;
		let child: PathResolvedResult | undefined = route.child;
		while (child != null) {
			routePath += child.route.path;
			child = child.child;
		}
		// 跟随路由器的 currentRoute 发布点，令既有同步滚动捕获仍能读取离页前的版式。
		return resolveTwitterShellLayout(mainRouter.currentRoute.value.name, routePath);
	},
);
/** 消息页展示来自同一个同步 Shell 策略，不保留另一份工作区状态。 */
const chatLayout: ComputedRef<TwitterShellLayout['chat']> = computed(/** 只读展示投影。 */ (): TwitterShellLayout['chat'] => shellLayout.value.chat);
/** 有界工作区的几何状态，不是业务架构运行开关。 */
const isMessagesWorkspace: ComputedRef<boolean> = computed(/** 两种聊天展示共用 Shell 几何。 */ (): boolean => chatLayout.value !== null);
/** 实际占位与组件显隐共用一个布尔派生，代码等待与最终页面保持相同外框。 */
const rightRailVisible: ComputedRef<boolean> = computed(/** 只消费账户存在性、现有断点及同步展示策略。 */ (): boolean => $i !== null && showRightRail.value && !isMobile.value && shellLayout.value.rightRail);
/** 只记录当前账户是否曾需要右栏；不保存趋势、推荐数据或另一份查询状态。 */
const retainedRailAccount: Ref<string | null> = ref<string | null>(null);
watch(
	/** 账户切换会丢弃旧实例，移动端与首次进入私信时不会预取隐藏右栏。 */
	(): readonly [string | null, boolean] => [$i?.id ?? null, rightRailVisible.value],
	/** 首次实际展示后保留原组件，离开普通页面仅移除占位与交互。 */
	([accountId, visible]: readonly [string | null, boolean]): void => {
		if (accountId !== retainedRailAccount.value) retainedRailAccount.value = null;
		if (accountId !== null && visible) retainedRailAccount.value = accountId;
	},
	{ immediate: true, flush: 'sync' },
);
/** 所有业务页面共用导航宽度，私信不另建图标导航的显示规则。 */
const sidebarIconOnly: ComputedRef<boolean> = computed(
	/** 导航尺寸只消费既有布局状态，不另存账户事实。 */
	(): boolean => showSidebar.value && !showRightRail.value,
);
const isRoot: ComputedRef<boolean> = computed(
	/** 根路由由既有路由器判定，包含查询参数时仍是同一入口。 */
	(): boolean => mainRouter.currentRoute.value.name === 'index',
);
const isEntrance: ComputedRef<boolean> = computed(
	/** 账户恢复完成后的权威身份与路由单向决定入口布局。 */
	(): boolean => $i === null && isRoot.value,
);
const pageMetadata: Ref<PageMetadata | null> = ref(null);

/** 主滚动宿主与内容测量节点；弹层始终位于视口之外。 */
const viewportEl: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('viewportEl');
const mainEl: Readonly<ShallowRef<HTMLElement | null>> = useTemplateRef<HTMLElement>('mainEl');
const shellEl: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('shellEl');
/** 既有实验叠层使用自己的有界面板，不把绝对定位卡片误当作普通流页面。 */
const isStacked: ComputedRef<boolean> = computed(
	/** 不新增架构开关，也不改写用户已有偏好。 */
	(): boolean => prefer.r['experimental.stackingRouterView'].value,
);
provideTwitterScrollHost(viewportEl, mainEl, shellEl, mainRouter, computed(
	/** 只有当前主内容出口参与统一位置恢复。 */
	(): boolean => !isEntrance.value && !isStacked.value && !isMessagesWorkspace.value,
));
useTwitterRouteEntry(mainEl, computed(
	/** 匿名入口与存量叠层保留自身呈现，主出口始终只存在一份业务页面。 */
	(): boolean => $i !== null && !isEntrance.value && !isStacked.value,
), computed(
	/** 仅地址导航取消旧绘制任务；同根更新不会重新挂载或重复触发业务动作。 */
	(): string => mainRouter.currentRef.value._parsedRoute.fullPath,
));

provide(DI.uiStyle, computed(/** 风格上下文独立于业务 Shell，弹层在入口页仍消费 Twitter 变体。 */ (): string => 'twitter'));
provide(DI.router, mainRouter);
provideMetadataReceiver(
	/** 保持标题与页面元信息注入，不以异步元信息决定入口布局。 */
	(metadataGetter: () => PageMetadata): void => {
		const info: PageMetadata = metadataGetter();
		pageMetadata.value = info;
		window.document.title = isRoot.value && info.title === instanceName ? info.title : `${info.title} | ${instanceName}`;
	},
);
provideReactiveMetadata(pageMetadata);
// 首次子树渲染前建立 token 作用域，避免入口先使用业务背景色再闪动。
window.document.body.dataset.ui = 'twitter';
onBeforeUnmount(
	/** 整个 UI 卸载时才清理风格作用域；路由切换不拆除全局弹层宿主。 */
	(): void => {
		streamNotice.dispose();
		if (window.document.body.dataset.ui === 'twitter') delete window.document.body.dataset.ui;
	},
);

/** 内容布局保留原右键菜单行为；不拦截输入、媒体和可选择文本。 */
function onContextmenu(ev: PointerEvent): void {
	const target: EventTarget | null = ev.target;
	if (!(target instanceof HTMLElement) || isLink(target)) return;
	if (['INPUT', 'TEXTAREA', 'IMG', 'VIDEO', 'CANVAS'].includes(target.tagName) || target.hasAttribute('contenteditable')) return;
	if (window.getSelection()?.toString() !== '') return;
	const path: string = mainRouter.getCurrentFullPath();
	os.contextMenu([{
		type: 'label',
		text: path,
	}, {
		icon: 'ti ti-window-maximize',
		text: i18n.ts.openInWindow,
		/** 通过既有页面窗口调度打开当前内容路由。 */
		action: (): void => { os.pageWindow(path); },
	}], ev);
}
</script>

<style lang="scss">
@use './twitter/tokens.scss';
@use './twitter/overlay.scss';
@use './twitter/scroll-layout.scss';
</style>

<style lang="scss" module>
.root {
	--MI-router-view-background: var(--twitter-bg);
	display: flex;
	flex-direction: column;
	height: 100dvh;
	min-height: 0;
	overflow: clip;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
}

.titlebar {
	flex-shrink: 0;
}

.entrance {
	--MI-router-view-background: var(--twitter-entry-bg);
	flex: 1;
	min-height: 0;
	background: var(--twitter-entry-bg);
}

.entranceContent {
	background: var(--twitter-entry-bg);
}

.guestHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-bottom: 1px solid var(--twitter-border);
}

.guestLogo {
	width: var(--twitter-touch-target);
	height: var(--twitter-touch-target);
	object-fit: contain;
}

/* 建立局部坐标原点：有应用标题栏时，既有滚动工具仍以宿主 offsetTop=0 工作。 */
.viewportFrame {
	position: relative;
	flex: 1;
	min-height: 0;
	min-width: 0;
}

/* 只有本视口固定一屏；原生滚动条始终位于可用窗口右缘。 */
.viewport {
	position: absolute;
	inset: 0;
	min-height: 0;
	min-width: 0;
	width: 100%;
	container-type: size;
	overflow-x: hidden;
	overflow-y: auto;
	scrollbar-gutter: stable;
	overscroll-behavior: contain;
	background: var(--twitter-bg);
}

.body {
	display: grid;
	align-items: start;
	grid-template-columns:
		var(--twitter-sidebar-icon-width)
		minmax(0, var(--twitter-main-width));
	justify-content: center;
	min-height: 100cqh;
	background: var(--twitter-bg);

	/* 移动断点不写媒体查询：由 useTwitterLayout 基于权威断点切换本 class（规范第 10 条） */
	&.mobile {
		grid-template-columns: minmax(0, 1fr);

		.main {
			border-right: none;
			border-left: none;
		}
	}
}

/* 公开内容仍可访问，但不挂载账户导航和推荐栏。 */
.body.guest {
	grid-template-columns: minmax(0, var(--twitter-main-width));
}

.withRightRail {
	grid-template-columns:
		var(--twitter-sidebar-width)
		minmax(0, var(--twitter-main-width))
		var(--twitter-right-rail-width);
}

.sidebar {
	position: sticky;
	top: 0;
	align-self: start;
	height: 100cqh;
	min-width: 0;
	min-height: 0;
}

.main {
	align-self: stretch;
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	border-right: solid 1px var(--twitter-border);
	border-left: solid 1px var(--twitter-border);
	background: var(--twitter-bg);
}

.systemChrome {
	flex-shrink: 0;
}

.statusbars {
	position: sticky;
	top: 0;
	left: 0;
	z-index: 1;
}

.content {
	flex: 1;
	min-height: 0;
}

.flowOutlet {
	height: auto;
	flex: 1 0 auto;
}

/* 私信拥有有界的两个滚动面板，普通页面仍沿用窗口右缘主滚动契约。 */
.messagesViewport {
	overflow: hidden;
}

.body.messagesWorkspace {
	height: 100%;
	min-height: 0;
	align-items: stretch;

	/* 与普通三栏同宽：导航不变，主列与右栏的既有空间交给聊天；没有独立宽度常量。 */
	&.messagesWide {
		grid-template-columns:
			var(--twitter-sidebar-width)
			minmax(0, calc(var(--twitter-main-width) + var(--twitter-right-rail-width)));
	}

	&.mobile {
		grid-template-columns: minmax(0, 1fr);
	}

	.main {
		overflow: hidden;
	}
}

.mobileBar {
	flex-shrink: 0;
	z-index: 100;
}

.rightRail {
	min-width: 0;
	min-height: 0;
	border-right: solid 1px var(--twitter-border);
}

/* 真实存量叠层偏好：保留其卡片边界及原生内部滚动，不受流式规则影响。 */
.stackedViewport {
	overflow: clip;
	scrollbar-gutter: auto;

	.body { height: 100%; }
	.content { height: 100%; }
	.rightRail { height: 100cqh; overflow-y: auto; top: 0; }
}

@media (prefers-reduced-motion: reduce) {
	* {
		scroll-behavior: auto;
	}
}
</style>
