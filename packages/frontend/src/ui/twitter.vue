<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XTitlebar
		v-if="prefer.r.showTitlebar.value"
		:class="$style.titlebar"
	/>

		<div :class="[$style.body, {
			[$style.mobile]: isMobile,
			[$style.withRightRail]: showRightRail && !pageMetadata?.needWideArea,
		}]">
		<TwitterSidebar
			v-if="showSidebar"
			:class="$style.sidebar"
			:iconOnly="sidebarIconOnly"
		/>

		<main :class="$style.main" @contextmenu.stop="onContextmenu">
			<div :class="$style.systemChrome">
				<XReloadSuggestion v-if="shouldSuggestReload"/>
				<XPreferenceRestore v-if="shouldSuggestRestoreBackup"/>
				<XThemePreviewing v-if="isThemePreviewMode"/>
				<XAnnouncements v-if="$i"/>
				<XStatusBars :class="$style.statusbars"/>
			</div>

			<StackingRouterView
				v-if="prefer.s['experimental.stackingRouterView']"
				:class="$style.content"
			/>
			<RouterView
				v-else
				:class="$style.content"
			/>

			<template v-if="isMobile">
				<TwitterMobileBar :class="$style.mobileBar"/>
				<TwitterComposeFab/>
			</template>
		</main>

		<TwitterRightRail
			v-if="showRightRail && !pageMetadata?.needWideArea"
			:class="$style.rightRail"
		/>
	</div>

	<XCommon/>
</div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref } from 'vue';
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
import type { PageMetadata } from '@/page.js';
import { isPreviewMode as isThemePreviewMode } from '@/theme.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { mainRouter } from '@/router.js';
import { prefer } from '@/preferences.js';
import { shouldSuggestRestoreBackup } from '@/preferences/utility.js';
import { DI } from '@/di.js';
import { shouldSuggestReload } from '@/utility/reload-suggest.js';
import { useTwitterLayout } from './twitter/index.js';

const XAnnouncements = defineAsyncComponent(() => import('./_common_/announcements.vue'));
const XStatusBars = defineAsyncComponent(() => import('./_common_/statusbars.vue'));

const { isMobile, showRightRail, showSidebar } = useTwitterLayout();
const sidebarIconOnly = computed(() => showSidebar.value && !showRightRail.value);
const isRoot = computed(() => mainRouter.currentRoute.value.name === 'index');
const pageMetadata = ref<null | PageMetadata>(null);

provide(DI.uiStyle, computed(() => 'twitter'));
provide(DI.router, mainRouter);
provideMetadataReceiver((metadataGetter) => {
	const info = metadataGetter();
	pageMetadata.value = info;
	if (pageMetadata.value) {
		window.document.title = isRoot.value && pageMetadata.value.title === instanceName
			? pageMetadata.value.title
			: `${pageMetadata.value.title} | ${instanceName}`;
	}
});
provideReactiveMetadata(pageMetadata);

onMounted(() => {
	window.document.body.dataset.ui = 'twitter';
});

onBeforeUnmount(() => {
	if (window.document.body.dataset.ui === 'twitter') {
		delete window.document.body.dataset.ui;
	}
});

function onContextmenu(ev: PointerEvent) {
	if (isLink(ev.target as HTMLElement)) return;
	if (['INPUT', 'TEXTAREA', 'IMG', 'VIDEO', 'CANVAS'].includes((ev.target as HTMLElement).tagName) || (ev.target as HTMLElement).attributes.getNamedItem('contenteditable') != null) return;
	if (window.getSelection()?.toString() !== '') return;

	const path = mainRouter.getCurrentFullPath();
	os.contextMenu([{
		type: 'label',
		text: path,
	}, {
		icon: 'ti ti-window-maximize',
		text: i18n.ts.openInWindow,
		action: () => {
			os.pageWindow(path);
		},
	}], ev);
}
</script>

<style lang="scss">
@use './twitter/tokens.scss';
@use './twitter/overlay.scss';
</style>

<style lang="scss" module>
.root {
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

.body {
	display: grid;
	grid-template-columns:
		var(--twitter-sidebar-icon-width)
		minmax(0, var(--twitter-main-width));
	justify-content: center;
	flex: 1;
	min-height: 0;
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

.withRightRail {
	grid-template-columns:
		var(--twitter-sidebar-width)
		minmax(0, var(--twitter-main-width))
		var(--twitter-right-rail-width);
}

.sidebar {
	min-width: 0;
	min-height: 0;
}

.main {
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

.mobileBar {
	flex-shrink: 0;
}

.rightRail {
	min-width: 0;
	min-height: 0;
	border-right: solid 1px var(--twitter-border);
}

@media (prefers-reduced-motion: reduce) {
	* {
		scroll-behavior: auto;
	}
}
</style>
