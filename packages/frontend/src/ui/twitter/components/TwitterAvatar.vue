<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 业务头像组合。
数据链：既有用户／账户展示引用与临时预览素材 → 场景和偏好 → 独立挂件绘制层。
保持头像本体的尺寸、链接、悬浮预览、猫耳和在线状态；仅挂件层裁剪，不修改 MkAvatar。
-->

<template>
<span
	:class="[$style.root, { [$style.mobile]: isMobile, [$style.square]: squareAvatars }]"
	:data-twitter-avatar-context="decorationContext"
>
	<MkAvatar
		:class="$style.avatar"
		:user="displayUser"
		:target="target"
		:link="link"
		:preview="preview"
		:indicator="indicator"
		:decorations="[]"
		@click="onClick"
	/>
	<span v-if="visibleDecorations.length > 0" :class="$style.decorations" data-twitter-avatar-decoration-layer aria-hidden="true">
		<span :class="$style.canvas">
			<img
				v-for="(decoration, index) in visibleDecorations"
				:key="`${index}:${decoration.id ?? ''}:${getDecorationUrl(decoration)}`"
				:class="[$style.decoration, { [$style.blink]: decoration.blink && allowBlink }]"
				:src="getDecorationUrl(decoration)"
				:style="getDecorationStyle(decoration)"
				:data-decoration-id="decoration.id"
				data-twitter-avatar-decoration
				alt=""
				draggable="false"
				decoding="async"
				@error="onDecorationError"
			>
		</span>
	</span>
</span>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { ComputedRef, CSSProperties, ShallowRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import { prefer } from '@/preferences.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import { useTwitterDisplayUser } from '../composables/use-twitter-display-user.js';
import { useTwitterLayout } from '../composables/use-twitter-layout.js';
import type { TwitterAvatarDecoration, TwitterAvatarDecorationContext } from '../domain/index.js';

/** 只读宿主输入；none 是所有未显式授权展示场景的默认值。 */
const props = withDefaults(defineProps<{
	user: Misskey.entities.User;
	decorationContext?: TwitterAvatarDecorationContext;
	target?: string | null;
	link?: boolean;
	preview?: boolean;
	indicator?: boolean;
	mock?: boolean;
	decorations?: readonly TwitterAvatarDecoration[];
	forceShowDecoration?: boolean;
}>(), {
	decorationContext: 'none',
	target: null,
	link: false,
	preview: false,
	indicator: false,
	mock: false,
	decorations: undefined,
	forceShowDecoration: false,
});

/** 非链接头像的点击仍由既有头像命中区域发出，装饰层不截获事件。 */
const emit = defineEmits<{
	(ev: 'click', event: PointerEvent): void;
}>();
const { isMobile } = useTwitterLayout();
/** 与 MkAvatar 的挂载时形状快照保持一致，避免只改变外层边框。 */
const squareAvatars: boolean = prefer.s.squareAvatars;
const displayUser: ComputedRef<Readonly<Misskey.entities.UserLite>> = useTwitterDisplayUser(
	/** 本人头像只读跟随既有账户，其他用户保持宿主实体。 */
	(): Misskey.entities.User => props.user,
	/** 独立帖卡样本沿用其显式 mock 语义，不被当前账户替换。 */
	(): boolean => props.mock,
);
const failedUrls: ShallowRef<ReadonlySet<string>> = shallowRef(new Set<string>());
const staticImages: ComputedRef<boolean> = computed(
	/** 沿用既有减少动态图片与头像节流策略，不探测运行环境。 */
	(): boolean => prefer.s.disableShowingAnimatedImages || prefer.s.dataSaver.avatar,
);
const allowBlink: ComputedRef<boolean> = computed(
	/** 编辑提示同样服从用户动画和节流偏好。 */
	(): boolean => prefer.s.animation && !staticImages.value,
);
const candidateDecorations: ComputedRef<readonly TwitterAvatarDecoration[]> = computed(
	/** 显式预览只绕过显示偏好，不能让紧凑头像启用挂件。 */
	(): readonly TwitterAvatarDecoration[] => props.decorationContext !== 'none' && (props.forceShowDecoration || prefer.s.showAvatarDecorations)
		? (props.decorations ?? displayUser.value.avatarDecorations)
		: [],
);
const visibleDecorations: ComputedRef<readonly TwitterAvatarDecoration[]> = computed(
	/** 失败只隐藏对应图片，不改变服务端佩戴事实或其他挂件顺序。 */
	(): readonly TwitterAvatarDecoration[] => candidateDecorations.value.filter(
		/** 用实际图片地址关联局部加载状态，允许同一挂件重复佩戴。 */
		(decoration: TwitterAvatarDecoration): boolean => !failedUrls.value.has(getDecorationUrl(decoration)),
	),
);

/** 保持 MkAvatar 的静态代理选择，静态偏好不能被预览强制显示覆盖。 */
function getDecorationUrl(decoration: TwitterAvatarDecoration): string {
	return staticImages.value ? (decoration.staticUrl ?? getStaticImageUrl(decoration.url)) : decoration.url;
}

/** 保留旧画布上的独立 rotate／scale／translate 属性语义及其浏览器变换顺序。 */
function getDecorationStyle(decoration: TwitterAvatarDecoration): CSSProperties {
	const angle: number = decoration.angle ?? 0;
	const offsetX: number = decoration.offsetX ?? 0;
	const offsetY: number = decoration.offsetY ?? 0;
	return {
		/** 角度仍以一整圈为单位。 */
		rotate: angle === 0 ? undefined : `${angle * 360}deg`,
		/** 水平翻转不改变素材参考原点。 */
		scale: decoration.flipH ? '-1 1' : undefined,
		/** 位移百分比相对于原有两倍图片画布。 */
		translate: offsetX === 0 && offsetY === 0 ? undefined : `${offsetX * 100}% ${offsetY * 100}%`,
	};
}

/** 只记录当前图片的失败状态；素材地址或静态策略变化后允许重新加载。 */
function onDecorationError(event: Event): void {
	if (!(event.currentTarget instanceof HTMLImageElement)) return;
	const failedUrl: string | null = event.currentTarget.getAttribute('src');
	if (failedUrl !== null) failedUrls.value = new Set([...failedUrls.value, failedUrl]);
}

/** 转发基础头像已确认的点击，保留 link=true 时由 MkA 负责导航的约定。 */
function onClick(event: PointerEvent): void {
	emit('click', event);
}

watch(
	/** 仅观察地址列表；调整角度与位移不会不断重试已经失败的资源。 */
	(): string => JSON.stringify(candidateDecorations.value.map(
		/** 按当前静态偏好取得实际传输地址。 */
		(decoration: TwitterAvatarDecoration): string => getDecorationUrl(decoration),
	)),
	/** 新素材重新开始图片加载，旧失败记录不泄漏到其他用户。 */
	(): void => { failedUrls.value = new Set<string>(); },
);
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: inline-block;
	vertical-align: bottom;
	flex-shrink: 0;
	border-radius: 100%;
	line-height: 16px;
	isolation: isolate;

	&.square {
		border-radius: 20%;
	}

	&[data-twitter-avatar-context='note'] {
		--avatar-bleed-top: var(--twitter-avatar-note-bleed-top);
		--avatar-bleed-left: var(--twitter-avatar-note-bleed-left);
		--avatar-bleed-right: var(--twitter-avatar-note-bleed-right);
		--avatar-bleed-bottom: var(--twitter-avatar-note-bleed-bottom);

		&.mobile {
			--avatar-bleed-right: var(--twitter-avatar-note-mobile-bleed-right);
		}
	}

	&[data-twitter-avatar-context='profile'] {
		--avatar-bleed-top: var(--twitter-avatar-profile-bleed-top);
		--avatar-bleed-left: var(--twitter-avatar-profile-bleed-left);
		--avatar-bleed-right: var(--twitter-avatar-profile-bleed-right);
		--avatar-bleed-bottom: var(--twitter-avatar-profile-bleed-bottom);

		&.mobile {
			--avatar-bleed-left: var(--twitter-avatar-profile-mobile-bleed-left);
		}
	}
}

.avatar {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

.decorations {
	position: absolute;
	z-index: 1;
	top: calc(-1 * var(--avatar-bleed-top));
	left: calc(-1 * var(--avatar-bleed-left));
	right: calc(-1 * var(--avatar-bleed-right));
	bottom: calc(-1 * var(--avatar-bleed-bottom));
	overflow: clip;
	pointer-events: none;
	user-select: none;
}

.canvas {
	position: absolute;
	top: var(--avatar-bleed-top);
	left: var(--avatar-bleed-left);
	right: var(--avatar-bleed-right);
	bottom: var(--avatar-bleed-bottom);
}

.decoration {
	position: absolute;
	top: -50%;
	left: -50%;
	width: 200%;
	max-width: none;
	pointer-events: none;
	-webkit-user-drag: none;
}

.blink {
	animation: blink 1s infinite;
}

@keyframes blink {
	0%, 100% { filter: brightness(2); }
	50% { filter: brightness(1); }
}
</style>
