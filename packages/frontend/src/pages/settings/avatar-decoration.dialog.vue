<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：头像挂件 · 试戴业务弹窗。
作用：保存局部变换草稿，提供可访问的旋转／位移／翻转控件，等待页面写入回执后关闭。
数据链：目录与账户只读模型 → 局部预览 → 可等待提交命令 → 页面提交权威账户事实。
不直接修改 props 或账户；取消只丢弃草稿，已发出的写入不伪装成已撤销。
-->

<template>
<MkModalWindow ref="dialog" :width="440" :height="620" :withCloseButton="!busy" @close="cancel" @click="cancel" @esc="cancel" @closed="emit('closed')">
	<template #header>{{ i18n.ts._avatarDecorationSettings.tryOn }}</template>
	<div :class="$style.root" :aria-busy="busy" data-testid="decoration-editor">
		<div :class="$style.heading"><h2>{{ decoration.name }}</h2><span>{{ i18n.ts._avatarDecorationSettings.previewOnly }}</span></div>
		<label v-if="isTwitterUi" :class="$style.sceneSelector">
			<span>{{ i18n.ts._avatarDecorationManager.previewTitle }}</span>
			<select v-model="previewContext" :disabled="busy" data-testid="decoration-preview-context">
				<option value="note">{{ i18n.ts._avatarDecorationSettings.notePreview }}</option>
				<option value="profile">{{ i18n.ts._avatarDecorationSettings.profilePreview }}</option>
			</select>
		</label>
		<div :key="previewKey" :class="isTwitterUi ? $style.targetPreview : $style.preview" data-testid="decoration-draft-preview" @error.capture="onPreviewError">
			<TwitterAvatarDecorationPreview v-if="isTwitterUi" :user="$i" :decorations="decorationsForPreview" :context="previewContext"/>
			<MkAvatar v-else :class="$style.avatar" :user="$i" :decorations="decorationsForPreview" forceShowDecoration/>
		</div>
		<p v-if="isTwitterUi" :class="$style.description">{{ i18n.ts._avatarDecorationSettings.previewGeometryHint }}</p>
		<p v-if="decoration.description" :class="$style.description">{{ decoration.description }}</p>
		<p v-if="locked" :class="$style.warning" role="status" data-testid="decoration-locked">{{ i18n.ts._avatarDecorationSettings.roleRequiredDescription }}</p>
		<p v-if="exceeded" :class="$style.warning" role="status" data-testid="decoration-limit">{{ i18n.ts._avatarDecorationSettings.limitReached }}</p>
		<div v-if="previewFailed" :class="$style.error" role="status"><span>{{ i18n.ts._avatarDecorationSettings.imageFailed }}</span> <button type="button" class="_textButton" :disabled="busy" @click="retryPreview">{{ i18n.ts.retry }}</button></div>
		<fieldset :disabled="busy" :class="$style.controls">
			<label :class="$style.control"><span>{{ i18n.ts.angle }} <output>{{ formatAngle(angle) }}</output></span><input v-model.number="angle" data-testid="decoration-angle" type="range" min="-0.5" max="0.5" step="0.025"></label>
			<div :class="$style.control">
				<label><span>{{ i18n.ts._avatarDecorationSettings.horizontalPosition }} <output>{{ formatOffset(offsetX) }}</output></span><input v-model.number="offsetX" data-testid="decoration-offset-x" type="range" min="-0.25" max="0.25" step="0.001"></label>
				<input :value="offsetX" :aria-label="i18n.ts._avatarDecorationSettings.horizontalPosition" data-testid="decoration-offset-x-number" type="number" min="-0.25" max="0.25" step="0.001" @change="onOffsetInput($event, 'x')">
			</div>
			<div :class="$style.control">
				<label><span>{{ i18n.ts._avatarDecorationSettings.verticalPosition }} <output>{{ formatOffset(offsetY) }}</output></span><input v-model.number="offsetY" data-testid="decoration-offset-y" type="range" min="-0.25" max="0.25" step="0.001"></label>
				<input :value="offsetY" :aria-label="i18n.ts._avatarDecorationSettings.verticalPosition" data-testid="decoration-offset-y-number" type="number" min="-0.25" max="0.25" step="0.001" @change="onOffsetInput($event, 'y')">
			</div>
			<MkSwitch v-model="flipH" :disabled="busy" data-testid="decoration-flip">{{ i18n.ts._avatarDecorationSettings.horizontalFlip }}</MkSwitch>
			<button type="button" class="_textButton" :class="$style.reset" :disabled="busy" data-testid="decoration-reset" @click="resetTransform">{{ i18n.ts._avatarDecorationSettings.resetPosition }}</button>
		</fieldset>
	</div>
	<template #footer>
		<p v-if="errorMessage" :class="$style.error" role="alert" data-testid="decoration-save-error">{{ errorMessage }}</p>
		<div :class="$style.actions">
			<MkButton rounded :disabled="busy" data-testid="decoration-cancel" @click="cancel">{{ i18n.ts.cancel }}</MkButton>
			<MkButton v-if="usingIndex !== null" rounded :disabled="busy" data-testid="decoration-editor-remove" @click="remove">{{ i18n.ts.detach }}</MkButton>
			<MkButton primary rounded :disabled="busy || exceeded || locked || previewFailed" :aria-busy="busy" data-testid="decoration-save" @click="save">{{ busy ? i18n.ts._avatarDecorationSettings.saving : usingIndex === null ? i18n.ts.attach : i18n.ts.save }}</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef, ref, computed, onBeforeUnmount } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkButton from '@/components/MkButton.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { TwitterAvatarDecorationPreview, useIsTwitterUi } from '@/ui/twitter/index.js';
import type { TwitterAvatarDecorationContext } from '@/ui/twitter/index.js';
import { canUseAvatarDecoration } from '@/utility/avatar-decoration/index.js';

const $i: ReturnType<typeof ensureSignin> = ensureSignin();
/** 复用既有目录和请求类型；提交返回用户可读的失败说明，null 表示已确认保存。 */
const props = defineProps<{
	usingIndex: number | null;
	decoration: Misskey.entities.GetAvatarDecorationsResponse[number];
	submit: (draft: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>[number] | null) => Promise<string | null>;
}>();
/** 仅通知宿主清理已经关闭的弹窗，不以事件派发冒充写入完成。 */
const emit = defineEmits<{ (ev: 'closed'): void }>();
const dialog = useTemplateRef<InstanceType<typeof MkModalWindow>>('dialog');
const busy: Ref<boolean> = ref(false);
const errorMessage: Ref<string | null> = ref(null);
const previewFailed: Ref<boolean> = ref(false);
const previewKey: Ref<number> = ref(0);
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
/** 试戴目标只改变预览，佩戴变换草稿与实际写入字段保持一致。 */
const previewContext: Ref<Exclude<TwitterAvatarDecorationContext, 'none'>> = ref('note');
let disposed: boolean = false;
const exceeded: ComputedRef<boolean> = computed(/** 调整已有项不增加数量；上限降低时仍需减少到合法数量。 */ (): boolean => $i.avatarDecorations.length + (props.usingIndex === null ? 1 : 0) > $i.policies.avatarDecorationLimit);
const locked: ComputedRef<boolean> = computed(/** 角色限制只派生 UI 提示，服务端始终执行最终校验。 */ (): boolean => !canUseAvatarDecoration(props.decoration, $i.roles));
const original: Misskey.entities.MeDetailed['avatarDecorations'][number] | undefined = props.usingIndex === null ? undefined : $i.avatarDecorations[props.usingIndex];
const angle: Ref<number> = ref(original?.angle ?? 0);
const flipH: Ref<boolean> = ref(original?.flipH ?? false);
const offsetX: Ref<number> = ref(original?.offsetX ?? 0);
const offsetY: Ref<number> = ref(original?.offsetY ?? 0);
const decorationsForPreview: ComputedRef<NonNullable<InstanceType<typeof MkAvatar>['$props']['decorations']>> = computed(
	/** 只读预览从账户派生；草稿只替换当前实例，保留其他佩戴项和叠加顺序。 */
	(): NonNullable<InstanceType<typeof MkAvatar>['$props']['decorations']> => {
		const decorations: NonNullable<InstanceType<typeof MkAvatar>['$props']['decorations']> = [...$i.avatarDecorations];
		const draft: NonNullable<InstanceType<typeof MkAvatar>['$props']['decorations']>[number] = { url: props.decoration.url, angle: angle.value, flipH: flipH.value, offsetX: offsetX.value, offsetY: offsetY.value };
		if (props.usingIndex === null) decorations.push(draft);
		else decorations[props.usingIndex] = draft;
		return decorations;
	},
);

/** 角度展示沿用既有一周为 1 的协议，不更改写入单位。 */
function formatAngle(value: number): string { return `${Math.round(value * 360)}°`; }

/** 百分比仅做展示精度处理，保留草稿中的原始比例，不把微小位移显示为整数零。 */
function formatOffset(value: number): string { return `${Number((value * 100).toPrecision(12))}%`; }

/** 数字输入只接受原协议范围内的有限值；无效输入还原为当前草稿，不生成第二份变换状态。 */
function onOffsetInput(event: Event, axis: 'x' | 'y'): void {
	if (busy.value || !(event.currentTarget instanceof HTMLInputElement)) return;
	const input: HTMLInputElement = event.currentTarget;
	const next: number = input.valueAsNumber;
	const target: Ref<number> = axis === 'x' ? offsetX : offsetY;
	if (Number.isFinite(next) && next >= -0.25 && next <= 0.25) target.value = next;
	else input.value = String(target.value);
}

/** 用户主动恢复默认位置，只修改未保存的临时参数。 */
function resetTransform(): void { if (busy.value) return; angle.value = 0; flipH.value = false; offsetX.value = 0; offsetY.value = 0; }

/** 捕获实际图片错误，不侵入基础头像组件。 */
function onPreviewError(event: Event): void { if (event.target instanceof HTMLImageElement) previewFailed.value = true; }

/** 只重建当前试戴图片，不丢失草稿参数。 */
function retryPreview(): void { previewFailed.value = false; previewKey.value++; }

/** 写入期间不能通过遮罩、Escape 或关闭按钮假装取消；其他时候取消只丢弃草稿。 */
function cancel(): void { if (!busy.value) dialog.value?.close(); }

/** 通过页面传入的可等待命令保存，失败保留控件及输入，成功才关闭。 */
async function commit(draft: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>[number] | null): Promise<void> {
	if (busy.value || disposed) return;
	busy.value = true;
	errorMessage.value = null;
	try {
		const message: string | null = await props.submit(draft);
		if (disposed) return;
		if (message !== null) errorMessage.value = message;
		else dialog.value?.close();
	} catch (error: unknown) {
		if (!disposed) errorMessage.value = i18n.ts._avatarDecorationSettings.saveFailed;
	} finally {
		if (!disposed) busy.value = false;
	}
}

/** 将草稿转换为现有写入字段，禁止锁定、满额或预览失败时新增佩戴。 */
async function save(): Promise<void> {
	if (exceeded.value || locked.value || previewFailed.value) return;
	await commit({ id: props.decoration.id, angle: angle.value, flipH: flipH.value, offsetX: offsetX.value, offsetY: offsetY.value });
}

/** 移除不受图片和角色提示限制，仍等待服务端回执。 */
async function remove(): Promise<void> { await commit(null); }

onBeforeUnmount(/** 页面离开后写入可以完成，但不能再操作已销毁弹窗。 */ (): void => { disposed = true; });
</script>

<style lang="scss" module>
.root { padding: var(--twitter-space-4, 16px); color: var(--twitter-fg, var(--MI_THEME-fg)); }
.heading { text-align: center; display: grid; gap: var(--twitter-space-2, 8px); }
.heading h2 { margin: 0; font-size: var(--twitter-font-size-title, 18px); overflow-wrap: anywhere; }
.heading span, .description { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); line-height: 1.6; }
.sceneSelector { display: grid; gap: var(--twitter-space-1, 4px); margin-top: var(--twitter-space-3, 12px); font-size: var(--twitter-font-size-meta, 13px); }
.sceneSelector select { width: 100%; min-height: var(--twitter-touch-target, 44px); padding: 0 var(--twitter-space-2, 8px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-medium, 8px); background: var(--twitter-panel, var(--MI_THEME-panel)); color: inherit; font: inherit; }
.sceneSelector select:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 2px; }
.targetPreview { margin: var(--twitter-space-3, 12px) 0; border: 1px solid var(--twitter-border); border-radius: var(--twitter-radius-medium); }
.preview { display: grid; place-items: center; min-height: calc(var(--twitter-decoration-editor-avatar-size, 64px) * 4); }
.avatar { width: var(--twitter-decoration-editor-avatar-size, 64px); height: var(--twitter-decoration-editor-avatar-size, 64px); }
.description { margin: 0 0 var(--twitter-space-3, 12px); white-space: pre-wrap; overflow-wrap: anywhere; }
.warning { color: var(--twitter-warning, var(--MI_THEME-warn)); line-height: 1.6; }
.controls { min-width: 0; margin: 0; padding: 0; border: 0; display: grid; gap: var(--twitter-space-3, 12px); }
.control { display: grid; gap: var(--twitter-space-1, 4px); font-size: var(--twitter-font-size-body, 14px); }
.control label { display: grid; gap: var(--twitter-space-1, 4px); }
.control span { display: flex; justify-content: space-between; }
.control output { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-variant-numeric: tabular-nums; }
.control input { width: 100%; min-height: var(--twitter-touch-target, 44px); margin: 0; accent-color: var(--twitter-accent, var(--MI_THEME-accent)); cursor: pointer; }
.control input:disabled { cursor: not-allowed; }
.control input[type='number'] { box-sizing: border-box; min-width: 0; padding-inline: var(--twitter-space-2, 8px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-small, 4px); background: var(--twitter-panel, var(--MI_THEME-panel)); color: inherit; font: inherit; cursor: text; }
.control input:focus-visible, .reset:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 2px; }
.reset { color: var(--twitter-accent, var(--MI_THEME-accent)); justify-self: start; min-height: var(--twitter-touch-target, 44px); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--twitter-space-2, 8px); }
.error { margin: 0 0 var(--twitter-space-2, 8px); color: var(--twitter-danger, var(--MI_THEME-error)); line-height: 1.6; }
</style>
