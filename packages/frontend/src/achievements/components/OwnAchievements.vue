<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：本人成就业务容器。
作用：连接 Store 的只读状态、展示事件和可见生命周期，两种页面壳共用同一数据所有者。
数据链：页面生命周期 → Store 动作 → 权威成就模型 → 列表；容器不保存业务副本。
-->

<template>
<AchievementList :state="ownAchievementsStore.state.value" @claim="ownAchievementsStore.claim" @retry="ownAchievementsStore.retry"/>
</template>

<script lang="ts" setup>
import AchievementList from './AchievementList.vue';
import { ownAchievementsStore } from '../store/own-achievements.js';
import { useOwnAchievementsLifecycle } from '../adapters/lifecycle.js';

/** 默认界面与 Twitter 界面共用可见性、缓存回访及真实通知适配。 */
useOwnAchievementsLifecycle();
</script>
