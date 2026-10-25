<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 帖子附件展示。
作用：把原附件集合投影为等比缩放的单行可滚动列表，复用同一既有图库及其敏感内容和打开行为。
数据链：只读附件 → 比例样式；已允许加载的自然尺寸 → 临时 UI 几何；操作转交原图库。
滚动位置、观察器和未知尺寸缓存仅属于本组件的展示生命周期，不建立附件业务副本。
-->

<template>
<div
	:class="[$style.root, { [$style.animated]: prefer.s.animation }]"
	data-testid="twitter-note-media"
	data-twitter-note-interactive
	@scroll.capture.passive="updateScrollState"
	@keydown="onKeydown"
	@pointerdown.capture="beginGesture"
	@click.capture="guardSwipeClick"
>
	<MkMediaList
		ref="gallery"
		:mediaList="mediaList"
		:user="user"
		:raw="raw"
		layout="strip"
		:mediaStyles="mediaStyles"
		:galleryLabel="i18n.ts.files"
		@intrinsicSize="onIntrinsicSize"
	/>
	<div v-if="canScrollPrevious || canScrollNext" :class="$style.controls">
		<button
			class="_button"
			:class="$style.arrow"
			type="button"
			:aria-label="i18n.ts.goBack"
			:disabled="!canScrollPrevious"
			data-testid="media-previous"
			@click.stop="scrollPrevious"
		>
			<i class="ti ti-chevron-left" aria-hidden="true"></i>
		</button>
		<button
			class="_button"
			:class="$style.arrow"
			type="button"
			:aria-label="i18n.ts.next"
			:disabled="!canScrollNext"
			data-testid="media-next"
			@click.stop="scrollNext"
		>
			<i class="ti ti-chevron-right" aria-hidden="true"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { ComputedRef, CSSProperties, ShallowRef } from 'vue';
import type * as Misskey from 'misskey-js';
import { getTwitterMediaAspectRatio } from '../domain/index.js';
import type { TwitterMediaMeasurement } from '../domain/index.js';
import MkMediaList from '@/components/MkMediaList.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

/** 既有文件实体仅供读取，原图、拥有者及加载偏好仍交给原图库。 */
type NoteMediaProps = Readonly<{
	mediaList: readonly Misskey.entities.DriveFile[];
	user?: Misskey.entities.User | null;
	raw?: boolean;
}>;

/** 直接消费宿主的附件引用，不克隆实体。 */
const props: NoteMediaProps = defineProps<NoteMediaProps>();
/** 只有一个完整图库实例，保持跨附件导航和已揭示状态。 */
const gallery: ShallowRef<InstanceType<typeof MkMediaList> | null> = shallowRef(null);
/** 由原图库显式公开的滚动节点，不依赖子组件私有类名。 */
const viewport: ShallowRef<HTMLElement | null> = shallowRef(null);
/** 无元数据资源加载后的临时测量；不进入全局业务状态。 */
const measuredSizes: ShallowRef<ReadonlyMap<string, TwitterMediaMeasurement>> = shallowRef(new Map());
/** 向前按钮状态只由实际滚动边界派生。 */
const canScrollPrevious: ShallowRef<boolean> = shallowRef(false);
/** 向后按钮状态只由实际滚动边界派生。 */
const canScrollNext: ShallowRef<boolean> = shallowRef(false);
/** 仅观察已挂载节点及附件尺寸，不承担环境探测。 */
let resizeObserver: ResizeObserver | null = null;
/** 本次指针操作的滚动起点，用于阻止横滑后的意外轻点。 */
let gestureStart: number | null = null;

/** 资源切换只使旧测量失效，标识不作为文件业务事实使用。 */
function mediaSource(file: Misskey.entities.DriveFile): string {
	return JSON.stringify([file.type, file.url, file.thumbnailUrl]);
}

/** 元数据优先；缺失时使用同一资源已加载尺寸；最终只输出只读 CSS 比例。 */
const mediaStyles: ComputedRef<Readonly<Record<string, CSSProperties>>> = computed(
	/** 每次从宿主当前集合派生，不保存附件副本。 */
	(): Readonly<Record<string, CSSProperties>> => {
		const styles: Record<string, CSSProperties> = {};
		for (const file of props.mediaList) {
			const measured: TwitterMediaMeasurement | undefined = measuredSizes.value.get(file.id);
			const metadataRatio: number | null = getTwitterMediaAspectRatio(file.properties.width, file.properties.height);
			const measuredRatio: number | null = measured?.source === mediaSource(file)
				? getTwitterMediaAspectRatio(measured.width, measured.height)
				: null;
			styles[file.id] = { '--media-aspect-ratio': metadataRatio ?? measuredRatio ?? 1 };
		}
		return styles;
	},
);

/** 仅接收当前文件的有效自然尺寸，重复回调不会触发额外渲染。 */
function onIntrinsicSize(id: string, width: number, height: number): void {
	const file: Misskey.entities.DriveFile | undefined = props.mediaList.find(
		/** 保留原文件 ID 和资源归属，不以视图顺序反推实体。 */
		(candidate: Misskey.entities.DriveFile): boolean => candidate.id === id,
	);
	if (file == null || getTwitterMediaAspectRatio(width, height) == null || getTwitterMediaAspectRatio(file.properties.width, file.properties.height) != null) return;
	const source: string = mediaSource(file);
	const previous: TwitterMediaMeasurement | undefined = measuredSizes.value.get(id);
	if (previous?.source === source && previous.width === width && previous.height === height) return;
	const next: Map<string, TwitterMediaMeasurement> = new Map(measuredSizes.value);
	next.set(id, { source, width, height });
	measuredSizes.value = next;
}

/** 当前集合变化时淘汰离开组件或已切换资源的临时测量。 */
function pruneMeasurements(): void {
	const next: Map<string, TwitterMediaMeasurement> = new Map();
	for (const file of props.mediaList) {
		const measured: TwitterMediaMeasurement | undefined = measuredSizes.value.get(file.id);
		if (measured?.source === mediaSource(file)) next.set(file.id, measured);
	}
	if (next.size !== measuredSizes.value.size) measuredSizes.value = next;
}

/** 兼容既有阅读方向，只判断真实滚动范围及浏览器亚像素舍入。 */
function updateScrollState(): void {
	const element: HTMLElement | null = viewport.value;
	const offset: number = Math.abs(element?.scrollLeft ?? 0);
	const maximum: number = element == null ? 0 : element.scrollWidth - element.clientWidth;
	canScrollPrevious.value = offset > 1;
	canScrollNext.value = offset < maximum - 1;
}

/** 释放本组件创建的几何观察器。 */
function disconnectObserver(): void {
	resizeObserver?.disconnect();
	resizeObserver = null;
}

/** 挂载或比例变化后观察轨道和各项，覆盖异步封面解码及正文宽度变化。 */
function observeGallery(): void {
	disconnectObserver();
	viewport.value = gallery.value?.getGalleryElement() ?? null;
	const element: HTMLElement | null = viewport.value;
	if (element != null) {
		resizeObserver = new ResizeObserver(updateScrollState);
		resizeObserver.observe(element);
		for (const child of element.children) resizeObserver.observe(child);
	}
	updateScrollState();
}

/** 沿阅读方向滚动一屏，动画由 CSS 和用户已有动效偏好决定。 */
function scrollByPage(direction: -1 | 1): void {
	const element: HTMLElement | null = viewport.value;
	if (element == null) return;
	const readingDirection: number = getComputedStyle(element).direction === 'rtl' ? -1 : 1;
	element.scrollBy({ left: direction * readingDirection * element.clientWidth, behavior: 'auto' });
}

/** 仅在前方存在内容时接受前一屏意图。 */
function scrollPrevious(): void {
	if (canScrollPrevious.value) scrollByPage(-1);
}

/** 仅在后方存在内容时接受后一屏意图。 */
function scrollNext(): void {
	if (canScrollNext.value) scrollByPage(1);
}

/** 只有轨道自身焦点使用横向键；保留附件按钮及视频控件的键盘语义。 */
function onKeydown(event: KeyboardEvent): void {
	const element: HTMLElement | null = viewport.value;
	if (element == null || event.target !== element || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
	event.preventDefault();
	const isRtl: boolean = getComputedStyle(element).direction === 'rtl';
	scrollByPage((event.key === 'ArrowLeft') !== isRtl ? -1 : 1);
}

/** 不接管原生触控，仅记录本次操作开始时的实际位置。 */
function beginGesture(event: PointerEvent): void {
	const element: HTMLElement | null = viewport.value;
	gestureStart = element != null && event.target instanceof Node && element.contains(event.target) ? element.scrollLeft : null;
}

/** 原生横滑发生位移时阻止其后的意外点击，键盘确认仍直接放行。 */
function guardSwipeClick(event: MouseEvent): void {
	const previous: number | null = gestureStart;
	gestureStart = null;
	if (event.detail === 0 || previous == null || viewport.value == null || Math.abs(viewport.value.scrollLeft - previous) <= 1) return;
	event.preventDefault();
	event.stopPropagation();
}

/** 原有帖子快捷键继续打开同一完整附件集合。 */
async function openGallery(id?: string): Promise<void> {
	await gallery.value?.openGallery(id);
}

watch(
	/** 只追踪集合归属及资源身份，变化不生成业务状态。 */
	(): readonly string[] => props.mediaList.map(
		/** 当前文件的身份与资源联合决定测量有效期。 */
		(file: Misskey.entities.DriveFile): string => `${file.id}:${mediaSource(file)}`,
	),
	pruneMeasurements,
	{ flush: 'post' },
);
watch([gallery, mediaStyles], observeGallery, { flush: 'post' });
onBeforeUnmount(disconnectObserver);
defineExpose({ openGallery });
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	--media-preview-background: var(--twitter-panel);
	--media-preview-background-image: none;
	--media-placeholder-background: var(--twitter-panel);
	--media-placeholder-color: var(--twitter-fg);
	--media-strip-gap: var(--twitter-space-1);
	--media-strip-max-height: var(--twitter-media-max-height);
	--media-strip-radius: var(--twitter-radius-large);
	--media-strip-focus: var(--twitter-accent);
}

.animated {
	--media-strip-scroll-behavior: smooth;
	@media (prefers-reduced-motion: reduce) { --media-strip-scroll-behavior: auto; }
}

.controls {
	display: flex;
	justify-content: flex-end;
	gap: var(--twitter-space-1);
	margin-top: var(--twitter-space-1);
}

.arrow {
	display: grid;
	place-items: center;
	width: var(--twitter-touch-target);
	height: var(--twitter-touch-target);
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	background: var(--twitter-panel);
	border: 1px solid var(--twitter-border);

	&:hover:not(:disabled) { background: var(--twitter-hover); }
	&:disabled { color: var(--twitter-secondary-fg); }
	&:focus-visible { outline: 2px solid var(--twitter-accent); outline-offset: 2px; }
}
</style>
