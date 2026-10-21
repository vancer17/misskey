<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 头像挂件静态素材校准。
作用：以原生中央头像参考圆约定编辑图片，通过 Cropper 等比缩放和平移输出透明 PNG。
数据链：只读用户与原素材 URL → 临时编辑坐标 → 临时 PNG → 宿主真实上传命令。
不保存目录或账户事实；辅助头像、参考线和背景只用于显示，不参与图片导出。
-->

<template>
<MkModalWindow ref="dialog" :width="560" :height="780" :withCloseButton="!submitting" @close="cancel" @click="cancel" @esc="cancel" @closed="emit('closed')">
	<template #header>{{ i18n.ts._avatarDecorationCalibration.title }}</template>
	<div :class="$style.root" :aria-busy="loading || submitting" data-testid="decoration-calibration">
		<p :class="$style.hint">{{ i18n.ts._avatarDecorationCalibration.description }}</p>
		<p :class="$style.hint">{{ i18n.ts._avatarDecorationCalibration.originalPreserved }}</p>
		<p v-if="loading" role="status">{{ i18n.ts._avatarDecorationCalibration.loading }}</p>
		<div :class="$style.editor">
			<MkAvatar :class="$style.referenceAvatar" :style="referenceStyle" :user="user" :decorations="[]" aria-hidden="true"/>
			<div ref="canvasHost" :class="$style.canvasHost" data-testid="decoration-calibration-canvas"></div>
			<span :class="$style.referenceCircle" :style="referenceStyle" aria-hidden="true"></span>
		</div>
		<fieldset :class="$style.controls" :disabled="!ready || submitting">
			<label :class="$style.control">
				<span>{{ i18n.ts._avatarDecorationCalibration.scale }}</span>
				<input :value="rounded(transform.scale)" type="number" :min="specification.minimumScale" :max="specification.maximumScale" step="0.1" data-testid="decoration-calibration-scale" @input="changeScale" @change="finishNumber($event, 'scale')">
			</label>
			<label :class="$style.control">
				<span>{{ i18n.ts._avatarDecorationCalibration.horizontalPosition }}</span>
				<input :value="rounded(transform.offsetX)" type="number" step="0.1" data-testid="decoration-calibration-x" @input="changeHorizontalPosition" @change="finishNumber($event, 'offsetX')">
			</label>
			<label :class="$style.control">
				<span>{{ i18n.ts._avatarDecorationCalibration.verticalPosition }}</span>
				<input :value="rounded(transform.offsetY)" type="number" step="0.1" data-testid="decoration-calibration-y" @input="changeVerticalPosition" @change="finishNumber($event, 'offsetY')">
			</label>
			<button type="button" class="_textButton" :disabled="!ready || submitting" data-testid="decoration-calibration-reset" @click="reset">{{ i18n.ts._avatarDecorationCalibration.reset }}</button>
		</fieldset>
		<section v-if="previewUrl !== null" :class="$style.previews" data-testid="decoration-calibration-preview">
			<h2>{{ i18n.ts._avatarDecorationCalibration.preview }}</h2>
			<TwitterAvatarDecorationPreview :user="user" :decorations="previewDecorations" context="note"/>
			<TwitterAvatarDecorationPreview :user="user" :decorations="previewDecorations" context="profile"/>
		</section>
		<p v-if="errorMessage" :class="$style.error" role="alert" data-testid="decoration-calibration-error">{{ errorMessage }}</p>
	</div>
	<template #footer>
		<div :class="$style.actions">
			<MkButton rounded :disabled="submitting" data-testid="decoration-calibration-cancel" @click="cancel">{{ i18n.ts.cancel }}</MkButton>
			<MkButton primary rounded :disabled="!ready || submitting" :aria-busy="submitting" data-testid="decoration-calibration-apply" @click="apply">{{ submitting ? i18n.ts._avatarDecorationCalibration.applying : i18n.ts._avatarDecorationCalibration.apply }}</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, ref, useTemplateRef } from 'vue';
import type { ComputedRef, CSSProperties, Ref, ShallowRef } from 'vue';
import Cropper from 'cropperjs';
import type { CropperCanvas, CropperImage } from 'cropperjs';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';
import TwitterAvatarDecorationPreview from './TwitterAvatarDecorationPreview.vue';
import { AvatarDecorationMaterialError, exportAvatarDecorationMaterial, loadAvatarDecorationMaterial } from '../adapters/avatar-decoration-material.js';
import { TWITTER_AVATAR_DECORATION_CALIBRATION } from '../domain/index.js';
import type { TwitterAvatarDecoration, TwitterAvatarDecorationCalibrationTransform } from '../domain/index.js';

/** 宿主只提供原图及真实上传命令；null 回执表示新图片地址已经进入宿主草稿。 */
const props = defineProps<{
	user: Misskey.entities.User;
	sourceUrl: string;
	submit: (file: File) => Promise<string | null>;
}>();
/** 模态退出后通知宿主释放实例，不用关闭事件冒充上传成功。 */
const emit = defineEmits<{ (ev: 'closed'): void }>();
const dialog: Readonly<ShallowRef<InstanceType<typeof MkModalWindow> | null>> = useTemplateRef<InstanceType<typeof MkModalWindow>>('dialog');
const canvasHost: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('canvasHost');
const specification: typeof TWITTER_AVATAR_DECORATION_CALIBRATION = TWITTER_AVATAR_DECORATION_CALIBRATION;
const loading: Ref<boolean> = ref(true);
const ready: Ref<boolean> = ref(false);
const submitting: Ref<boolean> = ref(false);
const errorMessage: Ref<string | null> = ref(null);
const previewUrl: Ref<string | null> = ref(null);
const transform: ShallowRef<TwitterAvatarDecorationCalibrationTransform> = shallowRef({ scale: 100, offsetX: 0, offsetY: 0 });
const previewDecorations: ComputedRef<readonly TwitterAvatarDecoration[]> = computed(
	/** 预览仅消费当前导出文件，不回写账户已佩戴列表。 */
	(): readonly TwitterAvatarDecoration[] => previewUrl.value === null ? [] : [{ url: previewUrl.value, staticUrl: previewUrl.value }],
);
/** 参考头像与圆线共享制作规格的只读几何投影，辅助图层不进入 Cropper 输出。 */
const referenceStyle: CSSProperties = {
	/** 中央头像参考范围的宽度。 */
	width: `${specification.avatarSize / specification.canvasSize * 100}%`,
	/** 正方形头像参考范围的高度。 */
	height: `${specification.avatarSize / specification.canvasSize * 100}%`,
	/** 完整画布两侧保留相同透明区域。 */
	left: `${(1 - specification.avatarSize / specification.canvasSize) * 50}%`,
	/** 完整画布上下保留相同透明区域。 */
	top: `${(1 - specification.avatarSize / specification.canvasSize) * 50}%`,
};
const request: AbortController = new AbortController();
let cropper: Cropper | null = null;
let cropperImage: CropperImage | null = null;
let cropperCanvas: CropperCanvas | null = null;
let sourceObjectUrl: string | null = null;
let resizeObserver: ResizeObserver | null = null;
let previewFrame: number | null = null;
let previewRunning: boolean = false;
let previewRevision: number = 0;
let disposed: boolean = false;
let closing: boolean = false;
let naturalWidth: number = 0;
let naturalHeight: number = 0;

/** 控件只舍入显示值，Cropper 与导出仍保留完整浮点坐标。 */
function rounded(value: number): number { return Number(value.toFixed(1)); }

/** 统一映射有限素材失败原因，上传错误说明由宿主提供。 */
function materialError(error: unknown): string {
	if (!(error instanceof AvatarDecorationMaterialError)) return i18n.ts._avatarDecorationCalibration.loadFailed;
	if (error.reason === 'unsupported') return i18n.ts._avatarDecorationCalibration.unsupportedFormat;
	if (error.reason === 'animated') return i18n.ts._avatarDecorationCalibration.animatedNotSupported;
	if (error.reason === 'export') return i18n.ts._avatarDecorationCalibration.exportFailed;
	return i18n.ts._avatarDecorationCalibration.loadFailed;
}

/** 从未受模态 CSS 动画缩放影响的局部布局尺寸计算初始等比容纳倍率。 */
function containScale(): number {
	if (cropperCanvas === null || naturalWidth === 0 || naturalHeight === 0) return 0;
	return Math.min(cropperCanvas.clientWidth / naturalWidth, cropperCanvas.clientHeight / naturalHeight);
}

/** 将唯一临时坐标应用到 Cropper；头像参考圆和输出均使用同一完整画布。 */
function updateTransform(value: TwitterAvatarDecorationCalibrationTransform): void {
	if (cropperCanvas === null || cropperImage === null || containScale() === 0) return;
	const scale: number = containScale() * value.scale / 100;
	const horizontal: number = (cropperCanvas.clientWidth - naturalWidth) / 2 + value.offsetX * (cropperCanvas.clientWidth / specification.canvasSize);
	const vertical: number = (cropperCanvas.clientHeight - naturalHeight) / 2 + value.offsetY * (cropperCanvas.clientHeight / specification.canvasSize);
	if (!Number.isFinite(scale) || !Number.isFinite(horizontal) || !Number.isFinite(vertical)) return;
	cropperImage.$setTransform(scale, 0, 0, scale, horizontal, vertical);
}

/** 失效旧预览后按帧合并导出，拖动不会创建无上限的并发编码。 */
function schedulePreview(): void {
	previewRevision++;
	if (previewFrame !== null || previewRunning || disposed || closing) return;
	previewFrame = requestAnimationFrame(
		/** 只让最新一次临时变换交付预览。 */
		(): void => { previewFrame = null; void renderPreview(previewRevision); },
	);
}

/** 导出与正式上传共用 PNG 路径，旧帧或关闭后的结果不替换预览。 */
async function renderPreview(revision: number): Promise<void> {
	if (cropperCanvas === null || !ready.value) return;
	previewRunning = true;
	try {
		const file: File = await exportAvatarDecorationMaterial(cropperCanvas);
		if (disposed || closing || revision !== previewRevision) return;
		const previous: string | null = previewUrl.value;
		previewUrl.value = URL.createObjectURL(file);
		await nextTick();
		if (previous !== null) URL.revokeObjectURL(previous);
	} catch (error: unknown) {
		if (!disposed && !closing && revision === previewRevision) errorMessage.value = materialError(error);
	} finally {
		previewRunning = false;
		if (!disposed && !closing && revision !== previewRevision) schedulePreview();
	}
}

/** Cropper 拖动与滚轮事件只派生控件显示，不建立第二份业务事实。 */
function onTransform(event: Event): void {
	const detail: unknown = (event as CustomEvent<unknown>).detail;
	if (typeof detail !== 'object' || detail === null || !('matrix' in detail) || !Array.isArray(detail.matrix)) return;
	const matrix: unknown[] = detail.matrix;
	if (matrix.length !== 6 || !matrix.every(/** 拒绝库边界上的无效浮点坐标。 */ (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item))) { event.preventDefault(); return; }
	const scale: number = matrix[0] / containScale() * 100;
	/** 等比矩阵往返只容忍浮点计算误差，保证合法最小值和最大值仍可输入。 */
	const tolerance: number = Number.EPSILON * specification.maximumScale * 8;
	if (!Number.isFinite(scale) || scale < specification.minimumScale - tolerance || scale > specification.maximumScale + tolerance || cropperCanvas === null) { event.preventDefault(); return; }
	const offsetX: number = (matrix[4] - (cropperCanvas.clientWidth - naturalWidth) / 2) / cropperCanvas.clientWidth * specification.canvasSize;
	const offsetY: number = (matrix[5] - (cropperCanvas.clientHeight - naturalHeight) / 2) / cropperCanvas.clientHeight * specification.canvasSize;
	if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) { event.preventDefault(); return; }
	transform.value = {
		scale: Math.min(specification.maximumScale, Math.max(specification.minimumScale, scale)),
		offsetX,
		offsetY,
	};
	schedulePreview();
}

/** 数字输入只接受有限值；空值与浏览器非法输入不改变当前变换。 */
function inputNumber(event: Event): number | null {
	if (!(event.target instanceof HTMLInputElement) || !Number.isFinite(event.target.valueAsNumber)) return null;
	return event.target.valueAsNumber;
}

/** 输入提交时恢复实际已接受的值；编辑中的负号或空值可以暂留，不能冒充最终导出参数。 */
function finishNumber(event: Event, field: keyof TwitterAvatarDecorationCalibrationTransform): void {
	if (!(event.currentTarget instanceof HTMLInputElement)) return;
	event.currentTarget.value = String(rounded(transform.value[field]));
}

/** 通过等比矩阵更新缩放，禁止分别改变横纵倍率。 */
function changeScale(event: Event): void {
	const value: number | null = inputNumber(event);
	if (!ready.value || submitting.value || value === null || value < specification.minimumScale || value > specification.maximumScale) return;
	updateTransform({ ...transform.value, scale: value });
}

/** 水平位移使用导出画布像素，不依赖当前模态窗口宽度。 */
function changeHorizontalPosition(event: Event): void {
	const value: number | null = inputNumber(event);
	if (!ready.value || submitting.value || value === null) return;
	updateTransform({ ...transform.value, offsetX: value });
}

/** 垂直位移使用导出画布像素，透明留白不会被自动移除。 */
function changeVerticalPosition(event: Event): void {
	const value: number | null = inputNumber(event);
	if (!ready.value || submitting.value || value === null) return;
	updateTransform({ ...transform.value, offsetY: value });
}

/** 恢复等比容纳完整原图，不使用非透明像素推断图案中心。 */
function reset(): void {
	if (!ready.value || submitting.value) return;
	updateTransform({ scale: 100, offsetX: 0, offsetY: 0 });
}

/** 读取可访问原图并创建库实例；取消只中止本地准备，不改变宿主素材。 */
async function initialize(): Promise<void> {
	try {
		const source: Blob = await loadAvatarDecorationMaterial(props.sourceUrl, request.signal);
		if (disposed || closing || canvasHost.value === null) return;
		sourceObjectUrl = URL.createObjectURL(source);
		const image: HTMLImageElement = new Image();
		image.src = sourceObjectUrl;
		await image.decode();
		if (disposed || closing || canvasHost.value === null) return;
		naturalWidth = image.naturalWidth;
		naturalHeight = image.naturalHeight;
		cropper = new Cropper(image, {
			container: canvasHost.value,
			template: '<cropper-canvas><cropper-image scalable translatable></cropper-image><cropper-handle action="move" plain></cropper-handle></cropper-canvas>',
		});
		cropperImage = cropper.getCropperImage();
		cropperCanvas = cropper.getCropperCanvas();
		if (cropperImage === null || cropperCanvas === null) throw new AvatarDecorationMaterialError('load');
		await cropperImage.$ready();
		await new Promise<void>(
			/** 库的图片加载回调先完成尺寸写入，再等待浏览器交付实际局部布局。 */
			(resolve: () => void): void => { requestAnimationFrame(/** 下一绘制帧完成库元素布局。 */ (): void => { requestAnimationFrame(/** 布局稳定后交付编辑器。 */ (): void => { resolve(); }); }); },
		);
		if (disposed || closing) return;
		cropperImage.addEventListener('transform', onTransform);
		ready.value = true;
		updateTransform(transform.value);
		resizeObserver = new ResizeObserver(
			/** 局部布局变化只重投影现有坐标，不重置管理员的编辑。 */
			(): void => { if (ready.value && !disposed && !closing) updateTransform(transform.value); },
		);
		resizeObserver.observe(canvasHost.value);
		schedulePreview();
	} catch (error: unknown) {
		if (!disposed && !closing && !request.signal.aborted) errorMessage.value = materialError(error);
	} finally {
		if (!disposed) loading.value = false;
	}
}

/** 完整导出及宿主上传成功后才关闭；失败保留变换，并恢复全部操作。 */
async function apply(): Promise<void> {
	if (!ready.value || submitting.value || disposed || closing || cropperCanvas === null) return;
	submitting.value = true;
	cropperCanvas.disabled = true;
	errorMessage.value = null;
	try {
		const file: File = await exportAvatarDecorationMaterial(cropperCanvas);
		if (disposed || closing) return;
		const error: string | null = await props.submit(file);
		if (disposed || closing) return;
		if (error !== null) errorMessage.value = error;
		else { closing = true; dialog.value?.close(); }
	} catch (error: unknown) {
		if (!disposed && !closing) errorMessage.value = error instanceof AvatarDecorationMaterialError ? materialError(error) : i18n.ts._avatarDecorationCalibration.uploadFailed;
	} finally {
		if (!disposed) { submitting.value = false; if (cropperCanvas !== null) cropperCanvas.disabled = false; }
	}
}

/** 读取及编辑阶段允许取消；已提交上传等待宿主回执，防止误导为撤销成功。 */
function cancel(): void {
	if (submitting.value || disposed || closing) return;
	closing = true;
	request.abort();
	dialog.value?.close();
}

onMounted(initialize);
onBeforeUnmount(
	/** 先失效异步交付，再释放网络、对象 URL、观察器和库实例。 */
	(): void => {
		disposed = true;
		request.abort();
		previewRevision++;
		if (previewFrame !== null) cancelAnimationFrame(previewFrame);
		resizeObserver?.disconnect();
		cropperImage?.removeEventListener('transform', onTransform);
		cropper?.destroy();
		if (sourceObjectUrl !== null) URL.revokeObjectURL(sourceObjectUrl);
		if (previewUrl.value !== null) URL.revokeObjectURL(previewUrl.value);
	},
);
</script>

<style lang="scss" module>
.root {
	--MI_THEME-bg: var(--twitter-panel);
	--MI_THEME-panel: var(--twitter-panel);
	--MI_THEME-fg: var(--twitter-fg);
	--MI_THEME-divider: var(--twitter-border);
	--MI_THEME-accent: var(--twitter-accent);
	padding: var(--twitter-space-4, 16px);
	color: var(--twitter-fg, var(--MI_THEME-fg));
	min-width: 0;
	display: grid;
	gap: var(--twitter-space-3, 12px);
}
.hint { margin: 0; line-height: 1.6; color: var(--twitter-secondary-fg, var(--MI_THEME-fg)); font-size: var(--twitter-font-size-meta, 13px); }
.editor { position: relative; width: 100%; aspect-ratio: 1; overflow: clip; border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); background: repeating-conic-gradient(var(--twitter-hover, var(--MI_THEME-panelHighlight)) 0% 25%, var(--twitter-panel, var(--MI_THEME-panel)) 0% 50%) 0 0 / 24px 24px; }
.canvasHost { position: absolute; inset: 0; z-index: 1;
	:global(cropper-canvas) { display: block; width: 100%; height: 100%; }
}
.referenceAvatar { position: absolute; object-fit: cover; border-radius: 50%; opacity: .4; pointer-events: none; }
.referenceCircle { position: absolute; z-index: 2; border: 1px dashed var(--twitter-accent, var(--MI_THEME-accent)); box-sizing: border-box; border-radius: 50%; pointer-events: none; }
.controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--twitter-space-2, 8px); padding: 0; margin: 0; border: 0; min-width: 0;
	button { grid-column: 1 / -1; justify-self: start; min-height: var(--twitter-touch-target, 44px); }
}
.control { display: grid; gap: var(--twitter-space-1, 4px); font-size: var(--twitter-font-size-meta, 13px); min-width: 0;
	input { width: 100%; min-width: 0; box-sizing: border-box; min-height: var(--twitter-touch-target, 44px); border: 1px solid var(--twitter-border, var(--MI_THEME-inputBorder)); border-radius: var(--twitter-radius-small, 4px); background: var(--twitter-panel, var(--MI_THEME-panel)); color: inherit; padding: var(--twitter-space-1, 4px); }
}
.previews { min-width: 0; display: grid; gap: var(--twitter-space-3, 12px);
	h2 { margin: 0; font-size: var(--twitter-font-size-body, 14px); }
}
.error { margin: 0; color: var(--twitter-danger, var(--MI_THEME-error)); line-height: 1.6; }
.actions { display: flex; gap: var(--twitter-space-2, 8px); justify-content: flex-end; padding: var(--twitter-space-3, 12px); }
</style>
