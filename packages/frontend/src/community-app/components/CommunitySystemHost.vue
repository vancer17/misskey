<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：嵌入社区的系统展示组合宿主。
作用：复用原弹层集合和连接提示插槽，不挂载原抽屉、自动标读与声音订阅。
数据链：既有弹层展示 → 原基础展示组件；真实通知活动适配留待 BFF 集成阶段完成。
-->
<template>
<component
	:is="popup.component"
	v-for="popup in popups"
	:key="popup.id"
	v-bind="popup.props"
	v-on="popup.events"
/>
<slot name="streamIndicator"></slot>
</template>

<script lang="ts" setup>
import { popups } from '@/os.js';
</script>
