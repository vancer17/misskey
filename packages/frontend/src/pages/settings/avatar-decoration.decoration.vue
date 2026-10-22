<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：头像挂件选择卡片。
作用：呈现真实目录条目与当前用户头像的组合预览，提供键盘可达的试戴入口。
数据链：只读目录模型／账户 → 预览与角色限制提示；点击事件交回页面，不直接执行写入。
图片错误属于单卡片的临时 UI 状态，不改变目录或账户事实。
-->

<template>
<div :class="[$style.root, { [$style.twitter]: isTwitterUi }]" :data-decoration-id="decoration.id" data-testid="decoration-card">
	<button type="button" class="_button" :class="$style.choose" :disabled="disabled" :aria-label="i18n.tsx._avatarDecorationSettings.previewName({ name: decoration.name })" @click="emit('click')">
		<span :key="previewKey" :class="$style.preview" @error.capture="onPreviewError">
			<TwitterAvatar v-if="isTwitterUi" :class="$style.avatar" :user="$i" :decorations="[{ url: decoration.url }]" decorationContext="note" forceShowDecoration/>
			<MkAvatar v-else :class="$style.avatar" :user="$i" :decorations="[{ url: decoration.url }]" forceShowDecoration/>
		</span>
		<span :class="$style.name">{{ decoration.name }}</span>
		<span :class="[$style.caption, { [$style.locked]: locked }]">
			<i :class="locked ? 'ti ti-lock' : 'ti ti-sparkles'" aria-hidden="true"></i>
			{{ locked ? i18n.ts._avatarDecorationSettings.roleRequired : i18n.ts._avatarDecorationSettings.tryOn }}
		</span>
	</button>
	<div v-if="previewFailed" :class="$style.imageError" role="status" data-testid="decoration-image-error">
		<span>{{ i18n.ts._avatarDecorationSettings.imageFailed }}</span>
		<button type="button" class="_textButton" :disabled="disabled" @click="retryPreview">{{ i18n.ts.retry }}</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { canUseAvatarDecoration } from '@/utility/avatar-decoration/index.js';
import { TwitterAvatar } from '@/ui/twitter/index.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

const $i: ReturnType<typeof ensureSignin> = ensureSignin();
/** 业务卡片直接接收既有权威目录类型；不复制实体字段声明。 */
const props = defineProps<{
	decoration: Misskey.entities.GetAvatarDecorationsResponse[number];
	disabled?: boolean;
}>();
/** 选择事件只表达打开试戴的 UI 意图。 */
const emit = defineEmits<{ (ev: 'click'): void }>();
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const locked: ComputedRef<boolean> = computed(/** 多个消费点使用同一权限提示映射。 */ (): boolean => !canUseAvatarDecoration(props.decoration, $i.roles));
const previewFailed: Ref<boolean> = ref(false);
const previewKey: Ref<number> = ref(0);

/** 捕获组合预览中实际图片的失败，保持其余卡片可用，不访问基础头像内部实现。 */
function onPreviewError(event: Event): void {
	if (event.target instanceof HTMLImageElement) previewFailed.value = true;
}

/** 用户显式重试时只重建当前预览，不重载业务目录或追加防缓存参数。 */
function retryPreview(): void {
	previewFailed.value = false;
	previewKey.value++;
}

watch(/** 目录刷新替换图片 URL 后重新显示真实图片结果。 */ (): string => props.decoration.url, retryPreview);
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	border: 1px solid var(--twitter-border, var(--MI_THEME-divider));
	border-radius: var(--twitter-radius-medium, 8px);
	background: var(--twitter-panel, var(--MI_THEME-panel));
	transition: border-color var(--twitter-duration-fast, 120ms) ease, background-color var(--twitter-duration-fast, 120ms) ease;
	&:hover { border-color: var(--twitter-accent, var(--MI_THEME-accent)); background: var(--twitter-hover, var(--MI_THEME-panelHighlight)); }
}
.choose {
	display: grid;
	width: 100%;
	box-sizing: border-box;
	padding: var(--twitter-space-3, 12px);
	gap: var(--twitter-space-2, 8px);
	text-align: center;
	border-radius: inherit;
	&:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 3px; }
	&:disabled { opacity: 0.5; cursor: not-allowed; }
}
.preview { display: grid; place-items: center; width: 100%; aspect-ratio: 1; }
.avatar { width: min(var(--twitter-decoration-card-avatar-size, 60px), 50%); aspect-ratio: 1; }
.name { display: block; font-weight: 700; font-size: var(--twitter-font-size-body, 14px); overflow-wrap: anywhere; }
.caption { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-caption, 12px); line-height: 1.5; }
.locked { color: var(--twitter-warning, var(--MI_THEME-warn)); }
.imageError { display: grid; justify-items: center; gap: var(--twitter-space-1, 4px); padding: 0 var(--twitter-space-2, 8px) var(--twitter-space-2, 8px); color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-caption, 12px); }
.imageError button { color: var(--twitter-accent, var(--MI_THEME-accent)); min-height: var(--twitter-touch-target, 44px); }
.twitter { color: var(--twitter-fg);
	.avatar { width: var(--twitter-avatar-note-size); height: var(--twitter-avatar-note-size); }
}
@media (prefers-reduced-motion: reduce) { .root { transition: none; } }
</style>
