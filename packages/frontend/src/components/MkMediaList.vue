<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Misskey 共享附件图库及其展示布局。
作用：保留附件分类、敏感揭示和完整灯箱链路，允许宿主传入纯数值样式选择横向展示。
数据链：原文件集合 → 既有媒体组件；自然尺寸事件只转交展示宿主，不回写文件或改变加载策略。
-->

<template>
<div :class="$style.root">
	<XBanner v-for="media in medias.nonPreviewable" :key="media.id" :media="media"/>
	<div v-if="count > 0" :class="$style.container">
		<div
			ref="gallery"
		:class="layout === 'strip' ? $style.strip : [
			$style.medias,
			...(prefer.s.showMediaListByGridInWideArea ? [$style.gridInWideArea] : []),
			{ [$style.twitter]: isTwitterUi },
			count === 1 ? [$style.n1, {
					[$style.n116_9]: prefer.s.mediaListWithOneImageAppearance === '16_9',
					[$style.n11_1]: prefer.s.mediaListWithOneImageAppearance === '1_1',
					[$style.n12_3]: prefer.s.mediaListWithOneImageAppearance === '2_3',
				}] : count === 2 ? $style.n2 : count === 3 ? $style.n3 : count === 4 ? $style.n4 : $style.nMany,
			]"
			:data-testid="layout === 'strip' ? 'media-strip' : undefined"
			:tabindex="layout === 'strip' ? 0 : undefined"
			:role="layout === 'strip' ? 'group' : undefined"
			:aria-label="layout === 'strip' ? galleryLabel : undefined"
		>
			<template v-for="media in medias.previewable">
				<XAudio
					v-if="media.type.startsWith('audio')"
					:key="`audio:${media.id}`"
					:class="$style.media"
					:style="mediaStyles?.[media.id]"
					:data-media-id="media.id"
					:audio="media"
					@mediaClick="onMediaClick(media)"
				/>
				<XVideo
					v-if="media.type.startsWith('video')"
					:key="`video:${media.id}`"
					:ref="(comp) => { mediaComponents.set(media.id, comp as InstanceType<typeof XVideo> | null); }"
					:class="$style.media"
					:style="mediaStyles?.[media.id]"
					:data-media-id="media.id"
					:video="media"
					v-on="intrinsicSizeListeners(media.id)"
					@mediaClick="onMediaClick(media)"
				/>
				<XImage
					v-else-if="media.type.startsWith('image')"
					:key="`image:${media.id}`"
					:ref="(comp) => { mediaComponents.set(media.id, comp as InstanceType<typeof XImage> | null); }"
					:marker="`${markerId}:${media.id}`"
					:disableImageLink="true"
					:class="$style.media"
					:style="mediaStyles?.[media.id]"
					:data-media-id="media.id"
					:image="media"
					:raw="raw"
					v-on="intrinsicSizeListeners(media.id)"
					@mediaClick="onMediaClick(media)"
				/>
			</template>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, onMounted, onUnmounted, useTemplateRef } from 'vue';
import type { CSSProperties } from 'vue';
import * as Misskey from 'misskey-js';
import type { Content } from '@/components/MkLightbox.item.vue';
import type { MediaComponentExposes } from '@/types/media-component.js';
import XBanner from '@/components/MkMediaBanner.vue';
import XAudio from '@/components/MkMediaAudio.vue';
import XImage from '@/components/MkMediaImage.vue';
import XVideo from '@/components/MkMediaVideo.vue';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { isPreviewable, getType } from '@/utility/lightbox.js';
import { genId } from '@/utility/id.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

/** 既有文件输入与可选的纯展示参数；默认仍使用原网格。 */
type MediaListProps = {
	mediaList: readonly Misskey.entities.DriveFile[];
	user?: Misskey.entities.User | null; // DriveFileのuserはnullになることがある。その場合に使用する所有者情報
	raw?: boolean;
	layout?: 'grid' | 'strip';
	mediaStyles?: Readonly<Record<string, CSSProperties>>;
	galleryLabel?: string;
};

/** 展示参数不改变附件实体或图库操作路径。 */
const props: MediaListProps = defineProps<MediaListProps>();
/** 向宿主报告已允许加载资源的自然尺寸，基础组件不解释业务策略。 */
const emit: (event: 'intrinsicSize', id: string, width: number, height: number) => void = defineEmits<{
	(event: 'intrinsicSize', id: string, width: number, height: number): void;
}>();

const isTwitterUi = useIsTwitterUi();

const gallery = useTemplateRef('gallery');
const medias = computed(() => {
	const previewable: Misskey.entities.DriveFile[] = [];
	const nonPreviewable: Misskey.entities.DriveFile[] = [];
	for (const file of props.mediaList) {
		if (isPreviewable(file.type)) {
			previewable.push(file);
		} else {
			nonPreviewable.push(file);
		}
	}

	return {
		previewable,
		nonPreviewable,
	};
});
const mediaComponents = new Map<string, MediaComponentExposes | null>();
const count = computed(() => medias.value.previewable.length);
const markerId = genId();

/** 原网格继续使用既有比例偏好；横向展示由宿主逐项提供比例。 */
async function calcAspectRatio(): Promise<void> {
	if (!gallery.value) return;
	if (props.layout === 'strip') return;

	const img: Misskey.entities.DriveFile = props.mediaList[0];

	if (props.mediaList.length !== 1 || !(img.properties.width && img.properties.height)) {
		gallery.value.style.aspectRatio = '';
		return;
	}

	/** 原单附件网格的最低比例，仅服务原有用户偏好。 */
	const ratioMax: (ratio: number) => string = (ratio: number): string => {
		if (img.properties.width == null || img.properties.height == null) return '';
		return `${Math.max(ratio, img.properties.width / img.properties.height).toString()} / 1`;
	};

	switch (prefer.s.mediaListWithOneImageAppearance) {
		case '16_9':
			gallery.value.style.aspectRatio = ratioMax(16 / 9);
			break;
		case '1_1':
			gallery.value.style.aspectRatio = ratioMax(1 / 1);
			break;
		case '2_3':
			gallery.value.style.aspectRatio = ratioMax(2 / 3);
			break;
		default:
			gallery.value.style.aspectRatio = '';
			break;
	}
}

/** 为当前文件绑定尺寸事件归属，既有点击与揭示仍使用原组件处理。 */
function intrinsicSizeListeners(id: string): { intrinsicSize: (width: number, height: number) => void } {
	return {
		/** 自然尺寸只投递给展示宿主，不修改图库的文件集合。 */
		intrinsicSize: (width: number, height: number): void => emit('intrinsicSize', id, width, height),
	};
}

/** 显式提供滚动节点，宿主无需读取基础组件私有类名或状态。 */
function getGalleryElement(): HTMLElement | null {
	return gallery.value;
}

onMounted(() => {
	calcAspectRatio();

	if (gallery.value == null) return; // TSを黙らすため
});

onUnmounted(() => {
	mediaComponents.clear();
});

function onMediaClick(file: Misskey.entities.DriveFile) {
	if (prefer.s.imageNewTab) {
		window.open(file.url, '_blank');
		return;
	}
	openGallery(file.id);
}

async function openGallery(id?: string) {
	if (id == null) {
		const firstImage = medias.value.previewable[0];
		if (firstImage == null) return;
		id = firstImage.id;
	}

	const getElementByMarker = (marker: string) => {
		if (gallery.value == null) return null;
		const found = gallery.value.querySelector(`[data-marker="${marker}"]`) as HTMLElement | null;
		if (found == null) return null;
		return markRaw(found);
	};

	const contents = medias.value.previewable.map<Content>(media => ({
		id: media.id,
		type: getType(media.type),
		url: media.url,
		thumbnailUrl: media.thumbnailUrl,
		width: media.properties.width,
		height: media.properties.height,
		filename: media.name,
		file: media,
		sourceElement: getElementByMarker(`${markerId}:${media.id}`),
	}));

	const initiallyRevealedContentIds = contents
		.filter(content => mediaComponents.get(content.id)?.isRevealed() === true)
		.map(content => content.id);

	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(x => x.default), {
		defaultIndex: contents.findIndex(conten => conten.id === id),
		contents: contents,
		initiallyRevealedContentIds,
		user: props.user,
	}, {
		closed: () => dispose(),
	});
}

defineExpose({
	openGallery,
	getGalleryElement,
});
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
}

.container {
	position: relative;
	width: 100%;
}

.medias {
	display: grid;
	grid-gap: 8px;

	height: 100%;
	width: 100%;

	&.n1 {
		grid-template-rows: 1fr;

		// default but fallback (expand)
		min-height: 64px;
		max-height: clamp(
			64px,
			50cqh,
			min(360px, 50vh)
		);

		&.n116_9 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 16 / 9; // fallback
		}

		&.n11_1{
			min-height: initial;
			max-height: initial;
			aspect-ratio: 1 / 1; // fallback
		}

		&.n12_3 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 2 / 3; // fallback
		}
	}

	&.n2 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr;
	}

	&.n3 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 0.5fr;
		grid-template-rows: 1fr 1fr;

		> .media:nth-child(1) {
			grid-row: 1 / 3;
		}

		> .media:nth-child(3) {
			grid-column: 2 / 3;
			grid-row: 2 / 3;
		}
	}

	&.n4 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	&.nMany {
		grid-template-columns: 1fr 1fr;

		> .media {
			aspect-ratio: 16/9;
		}
	}

	/* Twitter UI 表现变体：nitter media.scss 地面真值 —— 4px 间距 / 内层零圆角（外层容器统一裁切圆角），见 ADR-0001 */
	&.twitter {
		grid-gap: 4px;

		> .media {
			border-radius: 0;
		}

		&.n1 {
			/* nitter: still-image max-height 379.5px */
			max-height: clamp(64px, 50cqh, min(379.5px, 50vh));
		}
	}
}

.media {
	overflow: hidden; // clipにするとバグる
	border-radius: 8px;
	cursor: zoom-in;
}

/* 横向展示不挂载 n1..nMany 或宽区网格类，避免原比例和用户网格偏好反向覆盖宿主策略。 */
.strip {
	display: flex;
	flex-wrap: nowrap;
	align-items: flex-start;
	gap: var(--media-strip-gap, 8px);
	width: 100%;
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x proximity;
	scroll-behavior: var(--media-strip-scroll-behavior, auto);
	scrollbar-width: none;

	&::-webkit-scrollbar { display: none; }
	&:focus-visible {
		outline: 2px solid var(--media-strip-focus, var(--MI_THEME-accent));
		outline-offset: -2px;
	}

	> .media {
		flex: none;
		/* 宽度取正文宽度与比例化高度上限中的较小值，高度由同一比例单向派生。 */
		width: min(100cqw, calc(var(--media-strip-max-height, min(360px, 50svh)) * var(--media-aspect-ratio, 1)));
		height: auto;
		aspect-ratio: var(--media-aspect-ratio, 1);
		border-radius: var(--media-strip-radius, 8px);
		scroll-snap-align: start;
	}
}

@container (min-width: 500px) {
	.medias.gridInWideArea {
		display: grid;
		aspect-ratio: auto;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: auto;
		grid-gap: 8px;

		> .media {
			aspect-ratio: 1 / 1;
		}
	}
}
</style>
