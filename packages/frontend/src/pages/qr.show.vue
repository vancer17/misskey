<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：二维码页面 · 当前账户二维码展示。
作用：以账户标识生成可扫码的个人资料入口，并沿用 Web Share 分享资料链接。
数据链角色：既有账户与实例信息 → 二维码内容 / 分享信息 → Canvas 与用户展示；不复制账户业务状态。
Twitter 变体以固定深色二维码和浅色底保持识别对比度，颜色从设计 Token 解析后写入 Canvas。
默认 UI 的实例配色、Misskey 标识和设备翻转交互保留。
-->

<template>
<div :class="[$style.root, { [$style.twitter]: isTwitterUi }]">
	<div :class="$style.content">
		<div
			ref="qrCodeEl" v-flip="!isTwitterUi" :class="[$style.qr, { [$style.shareable]: !isTwitterUi && canShare }]"
			:role="!isTwitterUi && canShare ? 'button' : 'img'"
			:tabindex="!isTwitterUi && canShare ? 0 : undefined"
			:aria-label="!isTwitterUi && canShare ? i18n.ts.share : i18n.ts.qr"
			data-testid="profile-qr-code"
			@click="shareFromQr" @keydown.enter="shareFromQr" @keydown.space.prevent="shareFromQr"
		></div>
		<div v-flip="!isTwitterUi" :class="$style.user">
			<MkAvatar :decorations="isTwitterUi ? [] : undefined" :class="$style.avatar" :user="$i" :indicator="false"/>
			<div>
				<div :class="$style.name"><MkCondensedLine :minScale="2 / 3"><MkUserName :user="$i" :nowrap="true"/></MkCondensedLine></div>
				<div :class="$style.account"><MkCondensedLine :minScale="2 / 3">{{ acct }}</MkCondensedLine></div>
			</div>
		</div>
		<template v-if="isTwitterUi">
			<p :class="$style.description">{{ i18n.ts._qr.showDescription }}</p>
			<button v-if="canShare" class="_button" :class="$style.share" type="button" @click="share">
				<i class="ti ti-share" aria-hidden="true"></i>{{ i18n.ts.share }}
			</button>
		</template>
		<template v-else>
			<button v-if="deviceMotionPermissionNeeded" v-flip="true" class="_button" :class="$style.logoButton" type="button" @click="requestDeviceMotion">
				<img :class="$style.logo" :src="misskeysvg" alt="Misskey Logo"/>
			</button>
			<img v-else v-flip="true" :class="$style.logo" :src="misskeysvg" alt="Misskey Logo"/>
		</template>
	</div>
</div>
</template>

<script lang="ts" setup>
import tinycolor from 'tinycolor2';
import QRCodeStyling from 'qr-code-styling';
import { computed, ref, watch, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { url, host } from '@@/js/config.js';
import type { ComputedRef, Directive, DirectiveBinding, Ref, ShallowRef } from 'vue';
import { instance } from '@/instance.js';
import { ensureSignin } from '@/i.js';
import { userPage, userName } from '@/filters/user.js';
import misskeysvg from '/client-assets/misskey.svg';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import { i18n } from '@/i18n.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';
import * as os from '@/os.js';

const $i: ReturnType<typeof ensureSignin> = ensureSignin();
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();

/** 从当前账户派生跨实例可识别的显示账号。 */
const acct: ComputedRef<string> = computed(
	/** 组合账户名和当前实例域名，仅用于显示与分享。 */
	(): string => `@${$i.username}@${host}`,
);
/** 沿用个人资料页面链接生成规则。 */
const userProfileUrl: ComputedRef<string> = computed(
	/** 取得账户可公开访问的完整资料链接。 */
	(): string => userPage($i, undefined, true),
);
/** 由当前账户展示信息派生原有 Web Share 载荷。 */
const shareData: ComputedRef<ShareData> = computed(
	/** 将账户展示信息与资料链接映射为浏览器分享参数。 */
	(): ShareData => ({
		/** 分享标题包含名称与完整账号。 */
		title: i18n.tsx._qr.shareTitle({ name: userName($i), acct: acct.value }),
		/** 分享附言沿用二维码页面现有文案。 */
		text: i18n.ts._qr.shareText,
		/** 分享链接沿用用户资料链接。 */
		url: userProfileUrl.value,
	}),
);
/** 沿用当前页面既有的 Web Share 支持判定。 */
const canShare: ComputedRef<boolean> = computed(
	/** 检查浏览器能否处理原有分享载荷。 */
	(): boolean => Boolean(navigator.canShare && navigator.canShare(shareData.value)),
);

const qrCodeEl: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('qrCodeEl');

/** 通过现有 Web Share 入口分享资料，主动取消不作为错误提示。 */
async function share(): Promise<void> {
	if (!canShare.value) return;
	try {
		await navigator.share(shareData.value);
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') return;
		await os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	}
}

/** 保留默认 UI 点击二维码分享的行为；Twitter UI 使用显式分享按钮。 */
async function shareFromQr(): Promise<void> {
	if (isTwitterUi.value) return;
	await share();
}

/** 将设计层已解析的颜色写入二维码画布，二维码编码和实例图标沿用原规则。 */
function renderQrCode(): void {
	const element: HTMLDivElement | null = qrCodeEl.value;
	if (!element) return;
	let foregroundColor: string;
	let backgroundColor: string;
	if (isTwitterUi.value) {
		const style: CSSStyleDeclaration = getComputedStyle(element);
		foregroundColor = style.color;
		backgroundColor = style.backgroundColor;
	} else {
		const hue: number = tinycolor(instance.themeColor ?? '#86b300').toHsl().h;
		foregroundColor = tinycolor(`hsl(${hue}, 100, 18)`).toRgbString();
		backgroundColor = tinycolor(`hsl(${hue}, 100, 97)`).toRgbString();
	}
	/** 二维码绘制配置：保留原编码参数，只在展示层选择配色。 */
	const qrCodeInstance: QRCodeStyling = new QRCodeStyling({
		/** 原始画布宽度保证缩放后图案清晰。 */
		width: 600,
		/** 画布保持正方形。 */
		height: 600,
		/** 保留原静区宽度。 */
		margin: 42,
		/** 沿用 Canvas 输出。 */
		type: 'canvas',
		/** 编码内容沿用稳定用户标识链接。 */
		data: `${url}/users/${$i.id}`,
		/** 中心图标仍表示当前实例，不引入其他平台品牌。 */
		image: instance.iconUrl ? getStaticImageUrl(instance.iconUrl) : '/favicon.ico',
		/** 沿用二维码版本、编码与纠错参数。 */
		qrOptions: {
			/** 由二维码库选择容量版本。 */
			typeNumber: 0,
			/** 以字节编码用户链接。 */
			mode: 'Byte',
			/** 高等级纠错支持实例图标遮盖区域。 */
			errorCorrectionLevel: 'H',
		},
		/** 沿用中心图标的布局与跨域加载方式。 */
		imageOptions: {
			/** 图标区域隐藏背后的码点。 */
			hideBackgroundDots: true,
			/** 限制图标相对尺寸。 */
			imageSize: 0.3,
			/** 图标与码点留出间隔。 */
			margin: 16,
			/** 使用可绘制到画布的匿名跨域图像。 */
			crossOrigin: 'anonymous',
		},
		/** 将展示层解析出的前景色交给码点绘制器。 */
		dotsOptions: {
			/** 保留原圆点图案。 */
			type: 'dots',
			/** Twitter 固定深色，默认 UI 沿用实例配色。 */
			color: foregroundColor,
		},
		/** 沿用定位点内部形状。 */
		cornersDotOptions: {
			/** 圆形定位点。 */
			type: 'dot',
		},
		/** 沿用定位点外框形状。 */
		cornersSquareOptions: {
			/** 圆角外框。 */
			type: 'extra-rounded',
		},
		/** 将展示层解析出的浅色背景写入实际画布。 */
		backgroundOptions: {
			/** Twitter 明暗主题下均保留浅色静区。 */
			color: backgroundColor,
		},
	});
	qrCodeInstance.append(element);
}

onMounted(renderQrCode);

//#region flip
/** 既有设备翻转判定角度，默认 UI 沿用原交互。 */
const THRESHOLD: number = -3;
/** 部分浏览器为设备运动事件构造器增加的权限请求接口。 */
type MotionPermissionConstructor = typeof DeviceMotionEvent & {
	/** 用户主动点击后请求设备运动权限。 */
	requestPermission?: () => Promise<PermissionState>;
};
const motionEvent: MotionPermissionConstructor | undefined = window.DeviceMotionEvent as MotionPermissionConstructor | undefined;
const deviceMotionPermissionNeeded: boolean = typeof motionEvent?.requestPermission === 'function';
const flipEls: Set<Element> = new Set();
const flip: Ref<boolean> = ref(false);
let disposed: boolean = false;

/** 将默认 UI 的设备角度输入转换为临时翻转展示状态。 */
function handleOrientationChange(event: DeviceOrientationEvent): void {
	const isUpsideDown: boolean = event.beta ? event.beta < THRESHOLD : false;
	flip.value = isUpsideDown;
}

watch(flip,
	/** 将翻转状态投影到已注册的默认 UI 展示节点。 */
	(newState: boolean): void => {
		flipEls.forEach(
			/** 为单个展示节点同步原有翻转样式。 */
			(element: Element): void => {
				element.classList.toggle('_qrShowFlipFliped', newState);
			},
		);
	},
);

/** 延续默认 UI 的主动设备运动授权，离页后的迟到授权不再注册监听器。 */
async function requestDeviceMotion(): Promise<void> {
	if (!motionEvent?.requestPermission || isTwitterUi.value) return;
	try {
		const response: PermissionState = await motionEvent.requestPermission();
		if (response === 'granted' && !disposed) {
			window.addEventListener('deviceorientation', handleOrientationChange);
		}
	} catch (error: unknown) {
		console.error(error);
	}
}

onMounted(
	/** 默认 UI 挂载时接续原有设备翻转展示，Twitter 码卡保持静止。 */
	(): void => {
		if (!isTwitterUi.value) window.addEventListener('deviceorientation', handleOrientationChange);
	},
);

onUnmounted(
	/** 页面离开时释放设备事件，并使尚未完成的授权回调失效。 */
	(): void => {
		disposed = true;
		window.removeEventListener('deviceorientation', handleOrientationChange);
	},
);

/** 仅将默认 UI 节点注册到设备翻转展示，不影响 Twitter 二维码识别方向。 */
const vFlip: Directive<Element, boolean> = {
	/** 指令挂载时收集被允许翻转的展示节点。 */
	mounted(element: Element, binding: DirectiveBinding<boolean>): void {
		if (!binding.value) return;
		flipEls.add(element);
		element.classList.add('_qrShowFlip');
	},
	/** 指令卸载时移除节点登记及原有翻转样式。 */
	unmounted(element: Element): void {
		element.classList.remove('_qrShowFlip');
		flipEls.delete(element);
	},
};
//#endregion
</script>

<style lang="scss" module>
$s1: 14px;
$s2: 21px;
$s3: 28px;
$avatarSize: 58px;

.root {
	position: relative;
	flex: 1;
	display: flex;
	flex-direction: column;
	justify-content: center;
}

.content {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.qr {
	position: relative;
	margin: 0 auto;
	width: 100%;
	max-width: 230px;
	border-radius: 12px;
	overflow: clip;
	aspect-ratio: 1;

	&.shareable {
		cursor: pointer;
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: 2px;
	}

	> svg,
	> canvas {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}
}

.user {
	display: flex;
	flex-direction: column;
	margin: $s3 auto;
	justify-content: center;
	align-items: center;
	text-align: center;
	overflow: visible;
	width: fit-content;
	max-width: 100%;
}

.avatar {
	width: $avatarSize;
	height: $avatarSize;
	margin-bottom: 16px;
}

.name {
	font-weight: bold;
	font-size: 110%;
}

.logo {
	width: 100px;
	margin: $s3 auto 0;
	filter: drop-shadow(0 0 6px #0007);
}

.logoButton {
	display: flex;

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: 2px;
	}
}

.twitter {
	box-sizing: border-box;
	justify-content: flex-start;
	padding: var(--twitter-space-6) var(--twitter-space-4);

	.content {
		box-sizing: border-box;
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
		padding: var(--twitter-space-6) var(--twitter-space-4);
		border: 1px solid var(--twitter-border);
		border-radius: var(--twitter-radius-large);
		background: var(--twitter-panel);
	}

	.qr {
		max-width: 280px;
		border: 1px solid var(--twitter-border);
		border-radius: var(--twitter-radius-large);
		color: var(--twitter-qr-fg);
		background: var(--twitter-qr-bg);
	}

	.user {
		margin: var(--twitter-space-4) 0 0;
	}

	.avatar {
		margin-bottom: var(--twitter-space-3);
	}

	.name {
		color: var(--twitter-fg);
		font-size: var(--twitter-font-size-emphasis);
	}

	.account {
		margin-top: var(--twitter-space-1);
		color: var(--twitter-secondary-fg);
		font-size: var(--twitter-font-size-meta);
	}
}

.description {
	margin: var(--twitter-space-4) 0 0;
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-body);
	line-height: 1.5;
	text-align: center;
}

.share {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-2);
	min-height: var(--twitter-touch-target);
	margin-top: var(--twitter-space-4);
	padding: var(--twitter-space-2) var(--twitter-space-4);
	border-radius: var(--twitter-radius-pill);
	background: var(--twitter-accent);
	color: var(--twitter-fg-on-accent);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: var(--twitter-accent-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}
</style>

<style lang="scss">
/*
 * useCssModuleで$styleを読み込みたかったが、rollupでのunwindが壊れてしまうらしく失敗。
 * グローバルにクラスを定義することでお茶を濁す。
 */
._qrShowFlip {
	transition: rotate .3s linear, scale .3s .15s step-start;
}

._qrShowFlipFliped {
	scale: -1 1;
  rotate: x 180deg;
}
</style>
