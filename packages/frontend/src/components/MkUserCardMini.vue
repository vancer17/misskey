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
<div v-adaptive-bg :class="[$style.root]">
	<MkAvatar :decorations="isTwitterUi ? [] : undefined" :class="$style.avatar" :user="user" indicator/>
	<div :class="$style.body">
		<span :class="$style.name"><MkUserName :user="user"/></span>
		<span :class="$style.sub"><slot name="sub"><span class="_monospace">@{{ acct(user) }}</span></slot></span>
	</div>
	<MkMiniChart v-if="chartValues" :class="$style.chart" :src="chartValues"/>
</div>
</template>

<script lang="ts" setup>
import type { ComputedRef } from 'vue';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';
import * as Misskey from 'misskey-js';
import { onMounted, ref } from 'vue';
import MkMiniChart from '@/components/MkMiniChart.vue';
import { misskeyApiGet } from '@/utility/misskey-api.js';
import { acct } from '@/filters/user.js';

/** 共享紧凑头像只在 Twitter 展示上下文关闭挂件，保留原 UI 的既有偏好行为。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();

const props = withDefaults(defineProps<{
	user: Misskey.entities.User;
	withChart?: boolean;
}>(), {
	withChart: true,
});

const chartValues = ref<number[] | null>(null);

onMounted(() => {
	if (props.withChart) {
		misskeyApiGet('charts/user/notes', { userId: props.user.id, limit: 16 + 1, span: 'day' }).then(res => {
			// 今日のぶんの値はまだ途中の値であり、それも含めると大抵の場合前日よりも下降しているようなグラフになってしまうため今日は弾く
			res.inc.splice(0, 1);
			chartValues.value = res.inc;
		});
	}
});
</script>

<style lang="scss" module>
$bodyTitleHieght: 18px;
$bodyInfoHieght: 16px;

.root {
	display: flex;
	align-items: center;
	padding: 16px;
	background: var(--MI_THEME-panel);
	border-radius: 8px;
}

.avatar {
	display: block;
	width: ($bodyTitleHieght + $bodyInfoHieght);
	height: ($bodyTitleHieght + $bodyInfoHieght);
	margin-right: 12px;
}

.body {
	flex: 1;
	overflow: hidden;
	font-size: 0.9em;
	color: var(--MI_THEME-fg);
	padding-right: 8px;
}

.name {
	display: block;
	width: 100%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	line-height: $bodyTitleHieght;
}

.sub {
	display: block;
	width: 100%;
	font-size: 95%;
	opacity: 0.7;
	line-height: $bodyInfoHieght;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.chart {
	height: 30px;
}
</style>
