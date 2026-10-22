<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：二维码页面 · 展示与扫描入口。
作用：根据既有 UI 上下文选择页面壳，并协调二维码展示、摄像头与图片识别视图。
数据链角色：/qr 路由 → 本页临时页签状态 → qr.show / qr.read；账户与扫码业务仍由原有模块提供。
Twitter 变体复用设置子页的紧凑返回头，样式消费 Twitter 设计 Token；默认 UI 保留原布局。
-->

<template>
<TwitterSettingsShell v-if="isTwitterUi" :title="i18n.ts.qr">
	<div :class="$style.twitter" data-testid="twitter-qr-page">
		<div :class="$style.tabs" role="tablist" :aria-label="i18n.ts.qr">
			<button
				:id="`${tabId}-show`" ref="showTabEl" type="button" class="_button"
				:class="[$style.tab, { [$style.selected]: !read }]"
				role="tab" :aria-selected="!read" :aria-controls="`${tabId}-panel`" :tabindex="read ? -1 : 0"
				@click="showQr" @keydown="onTabKeydown"
			>
				<span :class="$style.tabLabel"><i class="ti ti-qrcode" aria-hidden="true"></i>{{ i18n.ts._qr.showTabTitle }}</span>
			</button>
			<button
				:id="`${tabId}-read`" ref="readTabEl" type="button" class="_button"
				:class="[$style.tab, { [$style.selected]: read }]"
				role="tab" :aria-selected="read" :aria-controls="`${tabId}-panel`" :tabindex="read ? 0 : -1"
				@click="readQr" @keydown="onTabKeydown"
			>
				<span :class="$style.tabLabel"><i class="ti ti-scan" aria-hidden="true"></i>{{ i18n.ts._qr.readTabTitle }}</span>
			</button>
		</div>
		<div :id="`${tabId}-panel`" :class="$style.panel" role="tabpanel" :aria-labelledby="`${tabId}-${read ? 'read' : 'show'}`" tabindex="0">
			<MkQrRead v-if="read"/>
			<MkQrShow v-else/>
		</div>
	</div>
</TwitterSettingsShell>
<div v-else :class="$style.root" class="_pageScrollable">
	<div class="_spacer" :class="$style.main">
		<MkButton v-if="read" :class="$style.button" rounded @click="showQr"><i class="ti ti-qrcode" aria-hidden="true"></i> {{ i18n.ts._qr.showTabTitle }}</MkButton>
		<MkButton v-else :class="$style.button" rounded @click="readQr"><i class="ti ti-scan" aria-hidden="true"></i> {{ i18n.ts._qr.readTabTitle }}</MkButton>

		<MkQrRead v-if="read"/>
		<MkQrShow v-else/>
	</div>
	<MkPolkadots v-if="!read" accented revered :height="200" style="position: sticky; bottom: 0; margin-top: -200px;"/>
</div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, ref, useId, useTemplateRef } from 'vue';
import type { Component, ComputedRef, Ref, ShallowRef } from 'vue';
import MkQrShow from './qr.show.vue';
import type { PageMetadata } from '@/page.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import MkButton from '@/components/MkButton.vue';
import MkPolkadots from '@/components/MkPolkadots.vue';
import { TwitterSettingsShell } from '@/ui/twitter/index.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

// 路由已要求登录，在页面入口沿用账户前置条件。
ensureSignin();

const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const read: Ref<boolean> = ref(false);
const tabId: string = useId();
const showTabEl: Readonly<ShallowRef<HTMLButtonElement | null>> = useTemplateRef<HTMLButtonElement>('showTabEl');
const readTabEl: Readonly<ShallowRef<HTMLButtonElement | null>> = useTemplateRef<HTMLButtonElement>('readTabEl');

/** 仅在切换到扫描视图时加载相机与图片识别组件。 */
const MkQrRead: Component = defineAsyncComponent(
	/** 将扫描页模块交给 Vue 异步组件加载器。 */
	(): Promise<typeof import('./qr.read.vue')> => import('./qr.read.vue'),
);

/** 将临时视图状态切换为个人二维码展示。 */
function showQr(): void {
	read.value = false;
}

/** 将临时视图状态切换为二维码识别。 */
function readQr(): void {
	read.value = true;
}

/** 处理水平页签键盘导航，使选中状态与键盘焦点始终指向同一视图。 */
function onTabKeydown(event: KeyboardEvent): void {
	if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
	event.preventDefault();
	read.value = event.key === 'Home' ? false : event.key === 'End' ? true : !read.value;
	if (read.value) {
		readTabEl.value?.focus();
	} else {
		showTabEl.value?.focus();
	}
}

definePage(
	/** 向路由元数据接收者提供二维码页标题与图标。 */
	(): PageMetadata => ({
		/** 页面标题沿用二维码语言键。 */
		title: i18n.ts.qr,
		/** 导航元数据沿用二维码图标。 */
		icon: 'ti ti-qrcode',
	}),
);
</script>

<style lang="scss" module>
.root {
	height: 100%;
}

.main {
	min-height: 100%;
	display: flex;
	flex-direction: column;
	position: relative;
	z-index: 1;
}

.button {
	margin: 0 auto 16px auto;
}

.twitter {
	min-width: 0;
	color: var(--twitter-fg);
	background: var(--twitter-bg);
}

.tabs {
	display: flex;
	border-bottom: 1px solid var(--twitter-border);
	background: var(--twitter-panel);
}

.tab {
	flex: 1;
	display: flex;
	justify-content: center;
	min-width: 0;
	min-height: var(--twitter-touch-target);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	font-weight: 600;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: var(--twitter-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}

	&.selected {
		color: var(--twitter-fg);
		font-weight: 800;

		.tabLabel::after {
			content: '';
			position: absolute;
			inset: auto 0 0;
			height: var(--twitter-space-1);
			border-radius: var(--twitter-radius-pill);
			background: var(--twitter-accent);
		}
	}
}

.tabLabel {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-2);
	padding: var(--twitter-space-3) var(--twitter-space-2);
}

.panel {
	min-width: 0;

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}
</style>
