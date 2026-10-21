<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：共享身份组件的 Twitter 表现适配。
作用：通过公开头像属性关闭 Twitter 紧凑场景的挂件，保留原组件交互及默认 UI 表现。
数据链：UI 展示上下文 → 头像装饰属性；不参与用户状态与业务判断。
-->

<template>
<div>
	<div v-for="user in users.slice(0, limit)" :key="user.id" style="display:inline-block;width:32px;height:32px;margin-right:8px;">
		<MkAvatar :decorations="isTwitterUi ? [] : undefined" :user="user" style="width:32px; height:32px;" indicator link preview/>
	</div>
	<div v-if="users.length > limit" style="display: inline-block;">...</div>
</div>
</template>

<script lang="ts" setup>
import type { ComputedRef } from 'vue';
import { useIsTwitterUi } from '@/ui/twitter/index.js';
import { onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 共享紧凑头像只在 Twitter 展示上下文关闭挂件，保留原 UI 的既有偏好行为。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();

const props = withDefaults(defineProps<{
	userIds: string[];
	limit?: number;
}>(), {
	limit: Infinity,
});

const users = ref<Misskey.entities.UserLite[]>([]);

onMounted(async () => {
	users.value = await misskeyApi('users/show', {
		userIds: props.userIds,
	});
});
</script>
