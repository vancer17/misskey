<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Misskey 既有成就列表的展示适配。
作用：在 Twitter 上下文呈现连续列表，默认界面保留原网格；不改变成就目录、数据查询和申领。
数据链：既有 users/achievements 查询 → 目录顺序与锁定项 → 只读展示；UI 上下文仅选择局部样式。
-->

<template>
<div data-testid="achievements" :class="{ [$style.twitter]: isTwitterUi }">
	<div v-if="achievements" :class="$style.root">
		<div v-for="achievement in achievements" :key="achievement.name" :data-achievement-name="achievement.name" data-achievement-locked="false" :class="$style.achievement" class="_panel">
			<div :class="$style.icon">
				<div
					:class="[$style.iconFrame, {
						[$style.iconFrame_bronze]: ACHIEVEMENT_BADGES[achievement.name].frame === 'bronze',
						[$style.iconFrame_silver]: ACHIEVEMENT_BADGES[achievement.name].frame === 'silver',
						[$style.iconFrame_gold]: ACHIEVEMENT_BADGES[achievement.name].frame === 'gold',
						[$style.iconFrame_platinum]: ACHIEVEMENT_BADGES[achievement.name].frame === 'platinum',
					}]"
				>
					<div :class="[$style.iconInner]" :style="{ background: ACHIEVEMENT_BADGES[achievement.name].bg ?? '' }">
						<img :class="$style.iconImg" :src="ACHIEVEMENT_BADGES[achievement.name].img" alt="">
					</div>
				</div>
			</div>
			<div :class="$style.body">
				<div :class="$style.header">
					<span data-testid="achievement-title" :class="$style.title">{{ i18n.ts._achievements._types[`_${achievement.name}`].title }}</span>
					<span data-testid="achievement-time" :class="$style.time">
						<time v-tooltip="new Date(achievement.unlockedAt).toLocaleString()">{{ new Date(achievement.unlockedAt).getFullYear() }}/{{ new Date(achievement.unlockedAt).getMonth() + 1 }}/{{ new Date(achievement.unlockedAt).getDate() }}</time>
					</span>
				</div>
				<div data-testid="achievement-description" :class="$style.description">{{ withDescription ? i18n.ts._achievements._types[`_${achievement.name}`].description : '???' }}</div>
				<div v-if="'flavor' in i18n.ts._achievements._types[`_${achievement.name}`] && withDescription" :class="$style.flavor">{{ (i18n.ts._achievements._types[`_${achievement.name}`] as { flavor: string; }).flavor }}</div>
			</div>
		</div>
		<template v-if="withLocked">
			<div v-for="achievement in lockedAchievements" :key="achievement" :data-achievement-name="achievement" data-achievement-locked="true" :class="[$style.achievement, $style.locked]" class="_panel" @click="achievement === 'clickedClickHere' ? clickHere() : () => {}">
				<div :class="$style.icon">
				</div>
				<div :class="$style.body">
					<div :class="$style.header">
						<span data-testid="achievement-title" :class="$style.title">???</span>
					</div>
					<div data-testid="achievement-description" :class="$style.description">???</div>
				</div>
			</div>
		</template>
	</div>
	<div v-else data-testid="achievements-loading" :class="$style.loading">
		<MkLoading :colored="!isTwitterUi"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { onMounted, ref, computed } from 'vue';
import type { ComputedRef } from 'vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { ACHIEVEMENT_TYPES, ACHIEVEMENT_BADGES, claimAchievement } from '@/utility/achievements.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

/** 仅消费轻量 UI 上下文，原查询和申领路径保持原有归属。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();

const props = withDefaults(defineProps<{
	user: Misskey.entities.User;
	withLocked?: boolean;
	withDescription?: boolean;
}>(), {
	withLocked: true,
	withDescription: true,
});

const achievements = ref<Misskey.entities.UsersAchievementsResponse | null>(null);
const lockedAchievements = computed(() => ACHIEVEMENT_TYPES.filter(x => !(achievements.value ?? []).some(a => a.name === x)));

function _fetch_() {
	misskeyApi('users/achievements', { userId: props.user.id }).then(res => {
		achievements.value = [];
		for (const t of ACHIEVEMENT_TYPES) {
			const a = res.find(x => x.name === t);
			if (a) achievements.value.push(a);
		}
		//achievements = res.sort((a, b) => b.unlockedAt - a.unlockedAt);
	});
}

function clickHere() {
	claimAchievement('clickedClickHere');
	_fetch_();
}

onMounted(() => {
	_fetch_();
});
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: repeat(auto-fill, min(380px, 100%));
	grid-gap: 12px;
	place-content: center;
}

.achievement {
	display: flex;
	padding: 16px;

	&.locked {
		opacity: 0.5;
	}
}

.icon {
	flex-shrink: 0;
	margin-right: 12px;
}

@keyframes shine {
	0% { translate: -30px; }
	100% { translate: -130px; }
}

.iconFrame {
	position: relative;
	width: 58px;
	height: 58px;
	padding: 6px;
	border-radius: 100%;
	box-sizing: border-box;
	pointer-events: none;
	user-select: none;
	filter: drop-shadow(0px 2px 2px #00000044);
	box-shadow: 0 1px 0px #ffffff88 inset;
	overflow: clip;
}
.iconFrame_bronze {
	background: linear-gradient(0deg, #703827, #d37566);

	> .iconInner {
		background: linear-gradient(0deg, #d37566, #703827);
	}
}
.iconFrame_silver {
	background: linear-gradient(0deg, #7c7c7c, #e1e1e1);

	> .iconInner {
		background: linear-gradient(0deg, #e1e1e1, #7c7c7c);
	}
}
.iconFrame_gold {
	background: linear-gradient(0deg, rgba(255,182,85,1) 0%, rgba(233,133,0,1) 49%, rgba(255,243,93,1) 51%, rgba(255,187,25,1) 100%);

	> .iconInner {
		background: linear-gradient(0deg, #ffee20, #eb7018);
	}

	&::before {
		content: "";
		display: block;
		position: absolute;
    top: 30px;
    width: 200px;
    height: 8px;
    rotate: -45deg;
    translate: -30px;
		background: #ffffff88;
		animation: shine 2s infinite;
	}
}
.iconFrame_platinum {
	background: linear-gradient(0deg, rgba(154,154,154,1) 0%, rgba(226,226,226,1) 49%, rgba(255,255,255,1) 51%, rgba(195,195,195,1) 100%);

	> .iconInner {
		background: linear-gradient(0deg, #e1e1e1, #7c7c7c);
	}

	&::before {
		content: "";
		display: block;
		position: absolute;
    top: 30px;
    width: 200px;
    height: 8px;
    rotate: -45deg;
    translate: -30px;
		background: #ffffffee;
		animation: shine 2s infinite;
	}
}

.iconInner {
	position: relative;
	width: 100%;
	height: 100%;
	border-radius: 100%;
	box-shadow: 0 1px 0px #ffffff88 inset;
}

.iconImg {
	width: calc(100% - 12px);
	height: calc(100% - 12px);
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	margin: auto;
	filter: drop-shadow(0px 1px 2px #000000aa);
}

.body {
	flex: 1;
	min-width: 0;
}

.header {
	margin-bottom: 8px;
	display: flex;
}

.title {
	font-weight: bold;
}

.time {
	margin-left: auto;
	font-size: 85%;
	opacity: 0.7;
}

.description {
	font-size: 85%;
}

.flavor {
	opacity: 0.7;
	transform: skewX(-15deg);
	font-size: 85%;
	margin-top: 8px;
}

/* 成就无 Nitter 对应页：沿用现有列表 Token，徽章仍为原业务资产（ADR-0024）。 */
.twitter {
	color: var(--twitter-fg);
	background: var(--twitter-bg);

	.root {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
		place-content: stretch;
	}

	.achievement {
		min-width: 0;
		padding: var(--twitter-space-3);
		border-bottom: 1px solid var(--twitter-border);
		border-radius: 0;
		background: var(--twitter-bg);
		color: var(--twitter-fg);
		font-size: var(--twitter-font-size-body);
		line-height: 1.3;

		&.locked {
			opacity: 1;
			color: var(--twitter-secondary-fg);
		}
	}

	.icon {
		/* 图像槽位映射 Nitter tweet-avatar 的 48px 尺度，不改变徽章图片或等级。 */
		width: 48px;
		margin-right: var(--twitter-space-3);
	}

	.iconFrame {
		width: 100%;
		height: 48px;
	}

	.header {
		flex-wrap: wrap;
		gap: var(--twitter-space-1) var(--twitter-space-2);
		margin-bottom: var(--twitter-space-1);
	}

	.title {
		min-width: 0;
		flex: 1 1 0;
		overflow-wrap: anywhere;
		font-size: var(--twitter-font-size-content);
	}

	.time {
		max-width: 100%;
		color: var(--twitter-secondary-fg);
		font-size: var(--twitter-font-size-meta);
		opacity: 1;
	}

	.description,
	.flavor {
		overflow-wrap: anywhere;
		font-size: var(--twitter-font-size-body);
	}

	.flavor {
		margin-top: var(--twitter-space-1);
		color: var(--twitter-secondary-fg);
		opacity: 1;
		transform: none;
	}

	.loading {
		color: var(--twitter-accent);
	}
}
</style>
