<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：本人已登录成就路由页面。
作用：按当前 UI 选择页面壳，保留既有登录要求、页面元数据和查看成就计时器。
数据链：当前账户 → 成就业务 Store 查询与呈现；页面仅协调展示入口和原有计时生命周期。
-->

<template>
<TwitterAchievementsShell v-if="isTwitterUi">
	<OwnAchievements/>
</TwitterAchievementsShell>
<PageWithHeader v-else>
	<div class="_spacer" style="--MI_SPACER-w: 1200px;">
		<OwnAchievements/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue';
import type { ComputedRef } from 'vue';
import { OwnAchievements, ownAchievementsStore } from '@/achievements/index.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { ensureSignin } from '@/i.js';
import { TwitterAchievementsShell } from '@/ui/twitter/index.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

/** 原路由登录要求在进入业务容器前确认，不保存页面级账户副本。 */
ensureSignin();
/** 页面只选择展示壳，不改变成就数据或申领规则。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();

/** 原查看时长任务由路由页面唯一持有，离页时清理。 */
let timer: number | null;

/** 保留既有查看三分钟成就的申领入口。 */
function viewAchievements3min(): void {
	void ownAchievementsStore.claim('viewAchievements3min');
}

onMounted(/** 首次挂载沿用原计时起点。 */ (): void => {
	if (timer == null) timer = window.setTimeout(viewAchievements3min, 1000 * 60 * 3);
});

onUnmounted(/** 路由销毁后不保留查看计时任务。 */ (): void => {
	if (timer != null) {
		window.clearTimeout(timer);
		timer = null;
	}
});

onActivated(/** 缓存页面恢复时仅补回已清理的任务。 */ (): void => {
	if (timer == null) timer = window.setTimeout(viewAchievements3min, 1000 * 60 * 3);
});

onDeactivated(/** 缓存离页停止计时，不把后台停留计入本次查看。 */ (): void => {
	if (timer != null) {
		window.clearTimeout(timer);
		timer = null;
	}
});

definePage(/** 两种界面共用原页面标题和图标元数据。 */ (): { title: string; icon: string } => ({
	title: i18n.ts.achievements,
	icon: 'ti ti-medal',
}));
</script>

<style lang="scss" module>

</style>
