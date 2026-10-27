<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：嵌入社区认证展示接缝。
作用：从专用制品剔除原登录和注册组件；账户根仅能在真实会话验证之后进入。
数据链：构建期组件装配 → 不提供独立认证界面，不产生认证成功信号。
-->
<template>
<span hidden aria-hidden="true"></span>
</template>

<script lang="ts" setup>
/** 接受既有展示参数以保留组合契约，不将其用于认证或业务状态。 */
defineProps<{ compact?: boolean }>();
</script>
