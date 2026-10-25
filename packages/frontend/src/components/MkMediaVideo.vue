<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Misskey 基础视频预览。负责保留现有敏感内容控制、封面展示与附件菜单。
自然尺寸观测仅使用当前已允许加载的封面或视频元数据，向上层提供临时布局参数。
-->

<template>
<div
	ref="playerEl"
	tabindex="0"
	:class="[
		$style.root,
		(video.isSensitive && prefer.s.highlightSensitiveMedia) && $style.sensitive,
	]"
	@contextmenu.stop="onContextmenu"
	@load.capture="onIntrinsicMediaLoad"
	@loadedmetadata.capture="onIntrinsicMediaLoad"
>
	<button v-if="hide" :class="$style.hidden" @click="reveal">
		<div :class="$style.hiddenTextWrapper">
			<b v-if="video.isSensitive" style="display: block;"><i class="ti ti-eye-exclamation"></i> {{ i18n.ts.sensitive }}{{ prefer.s.dataSaver.media ? ` (${i18n.ts.video}${video.size ? ' ' + bytes(video.size) : ''})` : '' }}</b>
			<b v-else style="display: block;"><i class="ti ti-movie"></i> {{ prefer.s.dataSaver.media && video.size ? bytes(video.size) : i18n.ts.video }}</b>
			<span style="display: block;">{{ i18n.ts.clickToShow }}</span>
		</div>
	</button>

	<div v-else :class="$style.videoRoot" @click="emit('mediaClick', $event)">
		<img
			v-if="video.thumbnailUrl"
			:class="$style.video"
			:src="video.thumbnailUrl"
			:alt="video.comment ?? undefined"
			draggable="false"
		/>
		<video
			v-else
			:class="$style.video"
			:alt="video.comment"
			preload="metadata"
		>
			<source :src="video.url">
		</video>
		<div :class="$style.playIconWrapper">
			<div :class="$style.playIcon">
				<i class="ti ti-player-play"></i>
			</div>
		</div>
		<button :class="[$style.menu, $style.menuBottom]" class="_button" @click.stop="showMenu"><i class="ti ti-dots" style="vertical-align: middle;" aria-hidden="true"></i></button>
		<button :class="[$style.menu, $style.menuTop]" class="_button" @click.stop="hide = true"><i class="ti ti-eye-off" style="vertical-align: middle;" aria-hidden="true"></i></button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import type { Ref } from 'vue';
import * as Misskey from 'misskey-js';
import type { MediaComponentExposes } from '@/types/media-component.js';
import bytes from '@/filters/bytes.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import * as os from '@/os.js';
import { getFileMenu } from '@/utility/get-file-menu.js';
import { shouldHideFileByDefault, canRevealFile } from '@/utility/sensitive-file.js';

const props = defineProps<{
	video: Misskey.entities.DriveFile;
}>();

const emit = defineEmits<{
	(event: 'mediaClick', ev: PointerEvent): void;
	/** 将当前已揭示封面或视频的自然尺寸传递给上层布局。 */
	(event: 'intrinsicSize', width: number, height: number): void;
}>();

/** 视频预览容器，仅用于读取既有媒体元素的展示尺寸。 */
const playerEl: Ref<HTMLDivElement | null> = ref<HTMLDivElement | null>(null);

// eslint-disable-next-line vue/no-setup-props-reactivity-loss
const hide = ref(shouldHideFileByDefault(props.video));

/** 返回当前预览已有资源的地址，驱动资源切换后的展示观测。 */
function currentPreviewUrl(): string {
	return props.video.thumbnailUrl || props.video.url;
}

/** 确认资源与揭示状态仍有效后，将浏览器取得的尺寸传入展示链。 */
function reportIntrinsicMediaSize(mediaElement: HTMLImageElement | HTMLVideoElement): void {
	if (hide.value || !playerEl.value?.contains(mediaElement)) return;
	/** 当前元素对应的附件资源地址，用于拒绝过期加载事件。 */
	const expectedSource: string | null = mediaElement instanceof HTMLImageElement ? props.video.thumbnailUrl : props.video.url;
	if (!expectedSource) return;
	/** 浏览器实际读取的资源地址，不从附件外部创建测量请求。 */
	const loadedSource: string = mediaElement.currentSrc || mediaElement.src;
	if (loadedSource !== new URL(expectedSource, window.document.baseURI).href) return;
	/** 已加载封面或视频的自然宽度，只用于临时几何派生。 */
	const width: number = mediaElement instanceof HTMLImageElement ? mediaElement.naturalWidth : mediaElement.videoWidth;
	/** 已加载封面或视频的自然高度，只用于临时几何派生。 */
	const height: number = mediaElement instanceof HTMLImageElement ? mediaElement.naturalHeight : mediaElement.videoHeight;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
	emit('intrinsicSize', width, height);
}

/** 捕获已有封面或视频的加载事件，不改变敏感内容或省流加载权限。 */
function onIntrinsicMediaLoad(event: Event): void {
	if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) reportIntrinsicMediaSize(event.target);
}

/** 预览揭示或资源切换后，读取当前已经完成加载的媒体元素。 */
function reportRenderedMediaSize(): void {
	/** 当前预览实际存在的图片或视频元素。 */
	const mediaElement: HTMLImageElement | HTMLVideoElement | null | undefined = playerEl.value?.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
	if (mediaElement) reportIntrinsicMediaSize(mediaElement);
}

watch([hide, currentPreviewUrl, playerEl], reportRenderedMediaSize, { flush: 'post' });

async function reveal() {
	if (!(await canRevealFile(props.video))) {
		return;
	}

	hide.value = false;
}

function showMenu(ev: PointerEvent) {
	os.popupMenu(getFileMenu(props.video, (newHide) => { hide.value = newHide; }), (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

function onContextmenu(ev: PointerEvent) {
	os.contextMenu(getFileMenu(props.video, (newHide) => { hide.value = newHide; }), ev);
}

defineExpose<MediaComponentExposes>({
	isRevealed: () => !hide.value,
});
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
	position: relative;
	overflow: clip;

	&:focus-visible {
		outline: none;
	}

	&:hover {
		.playIcon {
			scale: 1.2;
		}
	}
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

.hidden {
	width: 100%;
	height: 100%;
	background: var(--media-placeholder-background, #000);
	border: none;
	outline: none;
	font: inherit;
	color: inherit;
	cursor: pointer;
	padding: 12px 0;
	display: flex;
	align-items: center;
	justify-content: center;
}

.hiddenTextWrapper {
	text-align: center;
	font-size: 0.8em;
	color: var(--media-placeholder-color, #fff);
}

.videoRoot {
	background: var(--media-preview-background, #000);
	position: relative;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.video {
	display: block;
	height: 100%;
	width: 100%;
	object-fit: contain;
}

.playIconWrapper {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	display: grid;
	place-items: center;
}

.playIcon {
	display: grid;
	place-items: center;
	width: 50px;
	height: 50px;
	border-radius: 100%;
	font-size: 120%;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	scale: 1;
	transition: scale 100ms ease;
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
</style>
