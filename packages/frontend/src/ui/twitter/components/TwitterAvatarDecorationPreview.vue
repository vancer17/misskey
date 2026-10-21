<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI · 头像挂件场景预览。
作用：将未保存素材放入正式头像尺寸及邻接文字布局，供管理编辑器与试戴共用。
数据链：只读账户／素材草稿和目标场景 → TwitterAvatar → 实际绘制边界辅助线。
仅保存展示输入，不读写佩戴事实；辅助线复用正式场景 Token，不改变挂件画布或变换。
-->

<template>
<div :class="[$style.root, $style[context], { [$style.mobile]: isMobile }]" :data-decoration-preview-context="context">
	<div v-if="context === 'profile'" :class="$style.banner" aria-hidden="true"></div>
	<div :class="$style.scene">
		<TwitterAvatar :class="[$style.avatar, { [$style.guides]: guides }]" :user="user" :decorations="decorations" :decorationContext="context" forceShowDecoration/>
		<div :class="$style.identity">
			<strong :class="$style.name">{{ user.name || user.username }}</strong>
			<div v-if="context === 'note'" :class="$style.textSample" aria-hidden="true"><span></span><span></span></div>
			<span v-else :class="$style.account">@{{ user.username }}</span>
		</div>
	</div>
</div>
</template>

<script setup lang="ts">
import type * as Misskey from 'misskey-js';
import TwitterAvatar from './TwitterAvatar.vue';
import { useTwitterLayout } from '../composables/use-twitter-layout.js';
import type { TwitterAvatarDecoration, TwitterAvatarDecorationContext } from '../domain/index.js';

/** 目标场景直接复用权威展示语义；预览草稿只覆盖本次图片输入。 */
withDefaults(defineProps<{
	user: Misskey.entities.User;
	decorations?: readonly TwitterAvatarDecoration[];
	context: Exclude<TwitterAvatarDecorationContext, 'none'>;
	guides?: boolean;
}>(), {
	decorations: undefined,
	guides: true,
});
const { isMobile } = useTwitterLayout();
</script>

<style lang="scss" module>
.root {
	width: 100%;
	min-width: 0;
	background: var(--twitter-panel);
	color: var(--twitter-fg);
	text-align: left;
}
.scene { min-width: 0; }
.identity { min-width: 0; }
.name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--twitter-font-size-body); line-height: 1.5; }
.account { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-meta); line-height: 1.5; }
.guides::after { content: ''; position: absolute; border: 1px dashed var(--twitter-secondary-fg); pointer-events: none; z-index: 3; }
.note {
	.scene { display: flex; gap: var(--twitter-avatar-note-gap); padding: var(--twitter-space-3); }
	.avatar { width: var(--twitter-avatar-note-size); height: var(--twitter-avatar-note-size); }
	.guides::after { inset: calc(-1 * var(--twitter-avatar-note-bleed-top)) calc(-1 * var(--twitter-avatar-note-bleed-right)) calc(-1 * var(--twitter-avatar-note-bleed-bottom)) calc(-1 * var(--twitter-avatar-note-bleed-left)); }
	.identity { flex: 1; }
	&.mobile {
		.scene { gap: var(--twitter-avatar-note-mobile-gap); }
		.guides::after { right: calc(-1 * var(--twitter-avatar-note-mobile-bleed-right)); }
	}
}
.textSample { display: grid; gap: var(--twitter-space-1); margin-top: var(--twitter-space-1); }
.textSample span { display: block; height: var(--twitter-space-1); background: var(--twitter-border); border-radius: var(--twitter-radius-small); }
.textSample span:last-child { width: 70%; }
.profile {
	.banner { height: calc(var(--twitter-avatar-profile-bleed-top) + var(--twitter-space-3)); background: var(--twitter-hover); }
	.scene { padding: 0 var(--twitter-space-4) var(--twitter-space-3); }
	.avatar { width: var(--twitter-avatar-profile-size); height: var(--twitter-avatar-profile-size); margin-top: calc(-1 * var(--twitter-space-3)); border: solid var(--twitter-avatar-profile-border-width) var(--twitter-panel); background: var(--twitter-panel); }
	.guides::after { inset: calc(-1 * var(--twitter-avatar-profile-bleed-top)) calc(-1 * var(--twitter-avatar-profile-bleed-right)) calc(-1 * var(--twitter-avatar-profile-bleed-bottom)) calc(-1 * var(--twitter-avatar-profile-bleed-left)); }
	.identity { padding-top: var(--twitter-space-3); }
	&.mobile {
		.scene { padding-inline: var(--twitter-space-3); }
		.avatar { width: var(--twitter-avatar-profile-mobile-size); height: var(--twitter-avatar-profile-mobile-size); }
		.guides::after { left: calc(-1 * var(--twitter-avatar-profile-mobile-bleed-left)); }
	}
}
</style>
