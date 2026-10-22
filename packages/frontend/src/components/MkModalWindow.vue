<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：基础模态窗口的外框表现。
作用：提供固定或内容高度，并透传可选桌面水平中心，沿用 MkModal 的焦点、抽屉和关闭生命周期。
数据链：调用方原始尺寸与定位参数 → 模态布局 → 插槽内容；不读取或持有业务集合。
-->

<template>
<MkModal ref="modal" v-slot="{ type }" :preferType="deviceKind === 'smartphone' ? 'drawer' : 'dialog'" :dialogCenterX="dialogCenterX" @click="onBgClick" @closed="emit('closed')" @esc="emit('esc')">
	<div
		ref="rootEl"
		:class="[$style.root, type === 'drawer' ? $style.asDrawer : null, { [$style.twitter]: isTwitterUi, [$style.contentHeight]: type === 'dialog' && heightMode === 'content' }]"
		:style="{
			width: type === 'drawer' ? '' : `${width}px`,
			height: type === 'drawer' ? '' : type === 'dialog' && heightMode === 'content' ? 'auto' : `min(${height}px, 100%)`,
			maxHeight: type === 'dialog' && heightMode === 'content' ? `min(${height}px, 100%)` : '',
		}"
	>
		<div :class="$style.header">
			<button v-if="withCloseButton" :class="$style.headerButton" class="_button" :aria-label="i18n.ts.close" data-testid="modal-window-close" @click="emit('close')"><i class="ti ti-x"></i></button>
			<span :class="$style.title">
				<slot name="header"></slot>
			</span>
			<div v-if="withOkButton" style="padding: 0 16px; place-content: center;">
				<MkButton primary gradate small rounded :disabled="okButtonDisabled" @click="emit('ok')">{{ i18n.ts.done }} <i class="ti ti-check"></i></MkButton>
			</div>
		</div>
		<div :class="$style.body">
			<slot></slot>
		</div>
		<div v-if="$slots.footer" :class="$style.footer">
			<slot name="footer"></slot>
		</div>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, useTemplateRef, ref } from 'vue';
import MkModal from '@/components/MkModal.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n';
import { deviceKind } from '@/utility/device-kind.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

/** 只读窗口配置；内容高度仅用于桌面对话框，抽屉保持原有尺寸规则。 */
const props = withDefaults(defineProps<Readonly<{
	withOkButton?: boolean;
	withCloseButton?: boolean;
	okButtonDisabled?: boolean;
	width?: number;
	/** 固定模式下为窗口高度，内容模式下为窗口高度上限。 */
	height?: number;
	/** 默认固定高度；content 允许桌面窗口按插槽内容收敛。 */
	heightMode?: 'fixed' | 'content';
	/** 相对布局视口左缘的桌面对话框水平中心，单位为 CSS 像素。 */
	dialogCenterX?: number;
}>>(), {
	withOkButton: false,
	withCloseButton: true,
	okButtonDisabled: false,
	width: 400,
	height: 500,
	heightMode: 'fixed',
});

const emit = defineEmits<{
	(event: 'click'): void;
	(event: 'close'): void;
	(event: 'closed'): void;
	(event: 'ok'): void;
	(event: 'esc'): void;
}>();

const modal = useTemplateRef('modal');

const isTwitterUi = useIsTwitterUi();

/** 将关闭命令交给原模态层，保留过渡和焦点恢复链路。 */
function close(): void {
	modal.value?.close();
}

/** 向调用方转发遮罩点击，不在窗口外框中决定业务关闭行为。 */
function onBgClick(): void {
	emit('click');
}

defineExpose({
	close,
});
</script>

<style lang="scss" module>
.root {
	margin: auto;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	contain: content;
	border-radius: var(--MI-radius);

	--root-margin: 24px;

	--MI_THEME-headerHeight: 46px;
	--MI_THEME-headerHeightNarrow: 42px;

	@media (max-width: 500px) {
		--root-margin: 16px;
	}

	&.contentHeight {
		> .body {
			flex: 0 1 auto;
			min-height: 0;
			container-type: inline-size;
		}

		> .footer {
			flex-shrink: 0;
		}
	}

	&.asDrawer {
		height: calc(100dvh - 30px);
		border-radius: 0;

		.body {
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}

		.footer {
			padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
		}
	}

	/* Twitter UI 表现变体：X 窗口外铬（平面 panel + 大圆角），仅改视觉不改窗口交互 */
	&.twitter {
		border-radius: var(--twitter-radius-large);

		.header {
			background: var(--twitter-panel);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}

		.title {
			color: var(--twitter-fg);
		}

		.headerButton:hover {
			background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
		}

		.body {
			background: var(--twitter-panel);
		}

		.footer {
			background: var(--twitter-panel);
			border-top-color: var(--twitter-border);
		}

		&.asDrawer {
			border-radius: var(--twitter-sheet-radius) var(--twitter-sheet-radius) 0 0;
		}
	}
}

.header {
	display: flex;
	flex-shrink: 0;
	background: var(--MI_THEME-windowHeader);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}

.headerButton {
	height: var(--MI_THEME-headerHeight);
	width: var(--MI_THEME-headerHeight);

	@media (max-width: 500px) {
		height: var(--MI_THEME-headerHeightNarrow);
		width: var(--MI_THEME-headerHeightNarrow);
	}
}

.title {
	flex: 1;
	line-height: var(--MI_THEME-headerHeight);
	padding-left: 32px;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;

	@media (max-width: 500px) {
		line-height: var(--MI_THEME-headerHeightNarrow);
		padding-left: 16px;
	}
}

.headerButton + .title {
	padding-left: 0;
}

.body {
	flex: 1;
	overflow: auto;
	background: var(--MI_THEME-bg);
	container-type: size;
}

.footer {
	padding: 12px 16px;
	overflow: auto;
	background: var(--MI_THEME-bg);
	border-top: 1px solid var(--MI_THEME-divider);
}
</style>
