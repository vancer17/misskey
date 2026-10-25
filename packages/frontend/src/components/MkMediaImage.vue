<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Misskey 基础图片展示。负责复用现有图片加载、敏感内容控制与附件菜单。
自然尺寸观测只向上层提供已允许加载资源的展示参数，不参与附件业务状态判断。
-->

<template>
<div ref="mediaRoot" :class="[hide ? $style.hidden : $style.visible, (image.isSensitive && prefer.s.highlightSensitiveMedia) && $style.sensitive]" @click="onClick" @contextmenu.stop="onContextmenu" @load.capture="onIntrinsicImageLoad">
	<component
		:is="disableImageLink ? 'div' : 'a'"
		v-bind="disableImageLink ? {
			title: image.name,
			class: $style.imageContainer,
		} : {
			title: image.name,
			class: $style.imageContainer,
			href: image.url,
			style: 'cursor: zoom-in;'
		}"
	>
		<MkImgWithBlurhash
			v-if="prefer.s.enableHighQualityImagePlaceholders"
			:hash="image.blurhash"
			:src="(prefer.s.dataSaver.media && hide) ? null : url"
			:forceBlurhash="hide"
			:cover="hide || cover"
			:alt="image.comment || image.name"
			:title="image.comment || image.name"
			:width="image.properties.width"
			:height="image.properties.height"
			:style="hide ? 'filter: brightness(0.7);' : null"
			:class="$style.image"
			:marker="marker"
		/>
		<div
			v-else-if="prefer.s.dataSaver.media || hide"
			:title="image.comment || image.name"
			:style="hide ? 'background: #888;' : null"
			:class="$style.image"
		></div>
		<img
			v-else
			:src="url"
			:alt="image.comment || image.name"
			:title="image.comment || image.name"
			:class="$style.image"
			:data-marker="marker"
			draggable="false"
		/>
	</component>
	<template v-if="hide">
		<div :class="$style.hiddenText">
			<div :class="$style.hiddenTextWrapper">
				<b v-if="image.isSensitive" style="display: block;"><i class="ti ti-eye-exclamation"></i> {{ i18n.ts.sensitive }}{{ prefer.s.dataSaver.media ? ` (${i18n.ts.image}${image.size ? ' ' + bytes(image.size) : ''})` : '' }}</b>
				<b v-else style="display: block;"><i class="ti ti-photo"></i> {{ prefer.s.dataSaver.media && image.size ? bytes(image.size) : i18n.ts.image }}</b>
				<span v-if="controls" style="display: block;">{{ i18n.ts.clickToShow }}</span>
			</div>
		</div>
	</template>
	<template v-else-if="controls">
		<div :class="$style.indicators">
			<div v-if="['image/gif', 'image/apng'].includes(image.type)" :class="$style.indicator">GIF</div>
			<div v-if="image.comment" :class="$style.indicator">ALT</div>
			<div v-if="image.isSensitive" :class="$style.indicator" style="color: var(--MI_THEME-warn);" :title="i18n.ts.sensitive"><i class="ti ti-eye-exclamation"></i></div>
		</div>
		<button :class="[$style.menu, $style.menuBottom]" class="_button" @click.stop="showMenu"><i class="ti ti-dots" style="vertical-align: middle;" aria-hidden="true"></i></button>
		<button :class="[$style.menu, $style.menuTop]" class="_button" @click.stop="hide = true"><i class="ti ti-eye-off" style="vertical-align: middle;" aria-hidden="true"></i></button>
	</template>
</div>
</template>

<script lang="ts" setup>
import { watch, ref, computed } from 'vue';
import type { Ref } from 'vue';
import * as Misskey from 'misskey-js';
import type { MediaComponentExposes } from '@/types/media-component.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import bytes from '@/filters/bytes.js';
import MkImgWithBlurhash from '@/components/MkImgWithBlurhash.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { shouldHideFileByDefault, canRevealFile } from '@/utility/sensitive-file.js';
import { getFileMenu } from '@/utility/get-file-menu.js';

const props = withDefaults(defineProps<{
	image: Misskey.entities.DriveFile;
	raw?: boolean;
	cover?: boolean;
	disableImageLink?: boolean;
	controls?: boolean;
	marker?: string;
}>(), {
	cover: false,
	disableImageLink: false,
	controls: true,
});

const emit = defineEmits<{
	(event: 'mediaClick', ev: PointerEvent): void;
	/** 将当前已揭示图片的自然尺寸传递给上层布局，不改写附件模型。 */
	(event: 'intrinsicSize', width: number, height: number): void;
}>();

/** 当前图片的展示容器，仅用于观测既有 DOM 中已加载的图片。 */
const mediaRoot: Ref<HTMLDivElement | null> = ref<HTMLDivElement | null>(null);

const hide = ref(true);

const url = computed(() => (props.raw || prefer.s.loadRawImages)
	? props.image.url
	: prefer.s.disableShowingAnimatedImages
		? getStaticImageUrl(props.image.url)
		: props.image.thumbnailUrl!,
);

/** 校验图片仍属于当前资源后，向附件展示链上报有效的自然尺寸。 */
function reportIntrinsicImageSize(imageElement: HTMLImageElement): void {
	if (hide.value || !mediaRoot.value?.contains(imageElement) || !imageElement.complete || !url.value) return;
	/** 当前实际解码的资源地址，用于拒绝资源切换后迟到的加载事件。 */
	const loadedSource: string = imageElement.currentSrc || imageElement.src;
	if (loadedSource !== new URL(url.value, window.document.baseURI).href) return;
	/** 浏览器解码的宽度，只作为本次渲染的几何参数。 */
	const width: number = imageElement.naturalWidth;
	/** 浏览器解码的高度，只作为本次渲染的几何参数。 */
	const height: number = imageElement.naturalHeight;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
	emit('intrinsicSize', width, height);
}

/** 捕获现有图片的加载事件，不创建额外的图片请求或预加载。 */
function onIntrinsicImageLoad(event: Event): void {
	if (event.target instanceof HTMLImageElement) reportIntrinsicImageSize(event.target);
}

/** 揭示图片或切换资源后，补报浏览器已经缓存并加载完成的尺寸。 */
function reportRenderedImageSize(): void {
	/** 图片组件内部已有的图片元素，不包含任何额外测量资源。 */
	const renderedImage: HTMLImageElement | null | undefined = mediaRoot.value?.querySelector('img');
	if (renderedImage) reportIntrinsicImageSize(renderedImage);
}

watch([hide, url, mediaRoot], reportRenderedImageSize, { flush: 'post' });

async function onClick(ev: PointerEvent) {
	if (!props.controls) {
		emit('mediaClick', ev);
		return;
	}

	if (hide.value) {
		ev.stopPropagation();
		if (!(await canRevealFile(props.image))) {
			return;
		}

		hide.value = false;
	} else {
		emit('mediaClick', ev);
	}
}

// Plugin:register_note_view_interruptor を使って書き換えられる可能性があるためwatchする
watch(() => props.image, (newImage) => {
	hide.value = shouldHideFileByDefault(newImage);
}, {
	deep: true,
	immediate: true,
});

function showMenu(ev: PointerEvent) {
	os.popupMenu(getFileMenu(props.image, (newHide) => { hide.value = newHide; }), (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

function onContextmenu(ev: PointerEvent) {
	os.contextMenu(getFileMenu(props.image, (newHide) => { hide.value = newHide; }), ev);
}

defineExpose<MediaComponentExposes>({
	isRevealed: () => !hide.value,
});
</script>

<style lang="scss" module>
.hidden {
	position: relative;
}

.sensitive {
	position: relative;

	&::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		border-radius: inherit;
		box-shadow: inset 0 0 0 4px var(--MI_THEME-warn);
	}
}

.hiddenText {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	z-index: 1;
	display: flex;
	justify-content: center;
	align-items: center;
	cursor: pointer;
}

.hiddenTextWrapper {
	display: table-cell;
	text-align: center;
	font-size: 0.8em;
	color: #fff;
}

.visible {
	position: relative;
	//box-shadow: 0 0 0 1px var(--MI_THEME-divider) inset;
	background: var(--media-preview-background, var(--MI_THEME-bg));
	background-size: 16px 16px;
}

html[data-color-scheme=dark] .visible {
	--c: rgb(255 255 255 / 2%);
	background-image: var(--media-preview-background-image, linear-gradient(45deg, var(--c) 16.67%, var(--MI_THEME-bg) 16.67%, var(--MI_THEME-bg) 50%, var(--c) 50%, var(--c) 66.67%, var(--MI_THEME-bg) 66.67%, var(--MI_THEME-bg) 100%));
}

html[data-color-scheme=light] .visible {
	--c: rgb(0 0 0 / 2%);
	background-image: var(--media-preview-background-image, linear-gradient(45deg, var(--c) 16.67%, var(--MI_THEME-bg) 16.67%, var(--MI_THEME-bg) 50%, var(--c) 50%, var(--c) 66.67%, var(--MI_THEME-bg) 66.67%, var(--MI_THEME-bg) 100%));
}

.menu {
	display: block;
	position: absolute;
	background-color: rgba(0, 0, 0, 0.3);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
	color: #fff;
	font-size: 0.8em;
	width: 28px;
	height: 28px;
	text-align: center;
}

.menuBottom {
	border-radius: 8px 0 8px 0;
	bottom: 0;
	right: 0;
}

.menuTop {
	border-radius: 0 8px 0 8px;
	top: 0;
	right: 0;
}

.imageContainer {
	display: block;
	overflow: hidden;
	width: 100%;
	height: 100%;
	background-position: center;
	background-size: contain;
	background-repeat: no-repeat;
}

.indicators {
	display: inline-flex;
	position: absolute;
	top: 10px;
	left: 10px;
	pointer-events: none;
	opacity: .5;
	gap: 6px;
}

.indicator {
	/* Hardcode to black because either --MI_THEME-bg or --MI_THEME-fg makes it hard to read in dark/light mode */
	background-color: black;
	border-radius: 6px;
	color: hsl(from var(--MI_THEME-accent) h s calc(l + 10));
	display: inline-block;
	font-weight: bold;
	font-size: 0.8em;
	padding: 2px 5px;
}

.image {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: center;
}
</style>
