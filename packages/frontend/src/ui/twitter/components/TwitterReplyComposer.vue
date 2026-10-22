<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Twitter 帖子详情的回复入口。
作用：在原帖下嵌入共享表单，匿名访客沿用既有认证入口。
数据链：当前帖子 → MkPostForm 回复目标与原草稿键 → 既有创建接口及发布事件。
-->

<template>
<section
	:class="$style.root"
	:aria-label="i18n.ts.reply"
	:data-note-id="note.id"
	data-testid="twitter-reply-composer"
>
	<MkPostForm
		v-if="$i != null"
		:key="note.id"
		ref="form"
		:reply="note"
		:channel="note.channel"
		variant="twitter"
		fixed
		:autofocus="false"
		:showReplyContext="false"
	/>
	<TwitterAuthButtons v-else compact :class="$style.auth"/>
</section>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { entities } from 'misskey-js';
import MkPostForm from '@/components/MkPostForm.vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import TwitterAuthButtons from './TwitterAuthButtons.vue';

/** 宿主提供真实原帖，表单内部保留权限、上传和草稿所有权。 */
defineProps<{ note: entities.Note }>();

/** 仅持有表单实例，以转发输入焦点；不复制表单业务状态。 */
const form: Readonly<ShallowRef<InstanceType<typeof MkPostForm> | null>> = useTemplateRef('form');

/** 主帖回复动作聚焦同一份内联表单。 */
function focus(): void {
	form.value?.focus();
}

defineExpose({ focus });
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	border-bottom: solid 1px var(--twitter-border);
	background: var(--twitter-bg);
}

.auth {
	padding: var(--twitter-space-4);
}
</style>
