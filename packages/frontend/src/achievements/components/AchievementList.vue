<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：本人成就只读业务展示。
作用：从权威模型派生锁定项，沿用原徽章、文字、目录顺序与两种界面样式。
数据链：Store 唯一快照 → 只读 props → DOM；申领和重试仅以事件提交，不直接请求接口。
-->

<template>
<div data-testid="achievements" :style="badgeEffectStyle" :class="{ [$style.twitter]: isTwitterUi }">
	<div v-if="state.items != null" :class="$style.root">
		<div v-for="achievement in state.items" :key="achievement.name" :data-achievement-name="achievement.name" data-achievement-locked="false" :class="$style.achievement" class="_panel">
			<div :class="$style.icon">
				<div :class="[$style.iconFrame, { [$style.shining]: ACHIEVEMENT_FRAME_STYLES[ACHIEVEMENT_BADGES[achievement.name].frame].shine != null }]" :style="badgeFrameStyle(achievement.name)">
					<div :class="$style.iconInner" :style="{ background: ACHIEVEMENT_BADGES[achievement.name].bg ?? ACHIEVEMENT_FRAME_STYLES[ACHIEVEMENT_BADGES[achievement.name].frame].inner }">
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
				<div data-testid="achievement-description" :class="$style.description">{{ i18n.ts._achievements._types[`_${achievement.name}`].description }}</div>
				<div v-if="flavor(achievement.name) != null" :class="$style.flavor">{{ flavor(achievement.name) }}</div>
			</div>
		</div>
		<template v-for="name in lockedAchievements" :key="name">
			<button v-if="name === 'clickedClickHere'" type="button" :data-achievement-name="name" data-achievement-locked="true" :class="[$style.achievement, $style.locked]" class="_button _panel" @click="requestHiddenClaim">
				<div :class="$style.icon"></div>
				<div :class="$style.body">
					<div :class="$style.header"><span data-testid="achievement-title" :class="$style.title">???</span></div>
					<div data-testid="achievement-description" :class="$style.description">???</div>
				</div>
			</button>
			<div v-else :data-achievement-name="name" data-achievement-locked="true" :class="[$style.achievement, $style.locked]" class="_panel">
				<div :class="$style.icon"></div>
				<div :class="$style.body">
					<div :class="$style.header"><span data-testid="achievement-title" :class="$style.title">???</span></div>
					<div data-testid="achievement-description" :class="$style.description">???</div>
				</div>
			</div>
		</template>
	</div>
	<MkError v-if="state.status === 'error'" @retry="requestRetry"/>
	<div v-else-if="state.items == null" data-testid="achievements-loading" :class="$style.loading">
		<MkLoading :colored="!isTwitterUi"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { ComputedRef, CSSProperties } from 'vue';
import type { Achievement, AchievementBadge, AchievementName, OwnAchievementsState } from '../domain/index.js';
import { ACHIEVEMENT_TYPES, ACHIEVEMENT_BADGES, ACHIEVEMENT_FRAME_STYLES, ACHIEVEMENT_BADGE_EFFECTS } from '../domain/index.js';
import { i18n } from '@/i18n.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

/** 只读权威查询状态；组件不可修改列表或派生解锁事实。 */
const props: Readonly<{ state: OwnAchievementsState }> = defineProps<{ state: OwnAchievementsState }>();
/** 业务交互只提交意图，Store 决定是否执行与何时刷新。 */
const emit: ((event: 'claim', name: AchievementName) => void) & ((event: 'retry') => void) = defineEmits<{
	claim: [name: AchievementName];
	retry: [];
}>();
/** UI 上下文只选择已有样式，不改变业务规则或数据入口。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
/** 锁定项从唯一目录和已确认列表派生，不存放组件状态。 */
const lockedAchievements: ComputedRef<readonly AchievementName[]> = computed(/** 已解锁名称只从权威事实读取。 */ (): readonly AchievementName[] => ACHIEVEMENT_TYPES.filter(/** 匹配目录中尚未获得的名称。 */ (name: AchievementName): boolean => !props.state.items?.some(/** API 之外不产生另一份解锁字段。 */ (item: Achievement): boolean => item.name === name)));

/** 原徽章光影的局部展示变量，精确保留存量资产颜色。 */
const badgeEffectStyle: CSSProperties = {
	'--achievement-frame-shadow': ACHIEVEMENT_BADGE_EFFECTS.frameShadow,
	'--achievement-inner-shadow': ACHIEVEMENT_BADGE_EFFECTS.innerShadow,
	'--achievement-image-shadow': ACHIEVEMENT_BADGE_EFFECTS.imageShadow,
};

/** 徽章框资产沿用原值；局部 CSS 消费变量，不引入新的主题颜色。 */
function badgeFrameStyle(name: AchievementName): CSSProperties {
	const frame: (typeof ACHIEVEMENT_FRAME_STYLES)[AchievementBadge['frame']] = ACHIEVEMENT_FRAME_STYLES[ACHIEVEMENT_BADGES[name].frame];
	return { background: frame.frame, '--achievement-shine': frame.shine ?? 'transparent' };
}

/** 文案是权威成就的只读展示投影，不决定业务是否解锁。 */
function flavor(name: AchievementName): string | null {
	const text: (typeof i18n.ts._achievements._types)[`_${AchievementName}`] = i18n.ts._achievements._types[`_${name}`];
	return 'flavor' in text ? text.flavor : null;
}

/** 隐藏交互提交原成就标识；是否申领由 Store Action 处理。 */
function requestHiddenClaim(): void { emit('claim', 'clickedClickHere'); }

/** 重试按钮只触发 Store 查询动作。 */
function requestRetry(): void { emit('retry'); }
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
	text-align: left;

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
	filter: var(--achievement-frame-shadow);
	box-shadow: var(--achievement-inner-shadow);
	overflow: clip;
}

.shining::before {
	content: "";
	display: block;
	position: absolute;
	top: 30px;
	width: 200px;
	height: 8px;
	rotate: -45deg;
	translate: -30px;
	background: var(--achievement-shine);
	animation: shine 2s infinite;
}

.iconInner {
	position: relative;
	width: 100%;
	height: 100%;
	border-radius: 100%;
	box-shadow: var(--achievement-inner-shadow);
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
	filter: var(--achievement-image-shadow);
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
