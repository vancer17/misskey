<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div style="position: relative;">
	<MkA :to="`/channels/${channel.id}`" class="eftoefju _panel" :class="{ twitter: isTwitterUi }" @click="updateLastReadedAt">
		<div class="banner" :style="bannerStyle">
			<div class="fade"></div>
			<div class="name"><i class="ti ti-device-tv"></i> {{ channel.name }}</div>
			<div v-if="channel.isSensitive" class="sensitiveIndicator">{{ i18n.ts.sensitive }}</div>
			<div class="status">
				<div>
					<i class="ti ti-users ti-fw"></i>
					<I18n :src="i18n.ts._channel.usersCount" tag="span" style="margin-left: 4px;">
						<template #n>
							<b>{{ channel.usersCount }}</b>
						</template>
					</I18n>
				</div>
				<div>
					<i class="ti ti-pencil ti-fw"></i>
					<I18n :src="i18n.ts._channel.notesCount" tag="span" style="margin-left: 4px;">
						<template #n>
							<b>{{ channel.notesCount }}</b>
						</template>
					</I18n>
				</div>
				<div v-if="$i != null && $i.id === channel.userId" style="color: var(--MI_THEME-warn)">
					<i class="ti ti-user-star ti-fw"></i>
					<span style="margin-left: 4px;">{{ i18n.ts.youAreAdmin }}</span>
				</div>
			</div>
		</div>
		<article v-if="channel.description">
			<p :title="channel.description">{{ channel.description.length > 85 ? channel.description.slice(0, 85) + '…' : channel.description }}</p>
		</article>
		<footer>
			<span v-if="channel.lastNotedAt">
				{{ i18n.ts.updatedAt }}: <MkTime :time="channel.lastNotedAt"/>
			</span>
		</footer>
	</MkA>
	<div
		v-if="channel.lastNotedAt && (channel.isFavorited || channel.isFollowing) && (!lastReadedAt || Date.parse(channel.lastNotedAt) > lastReadedAt)"
		class="indicator"
	></div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const props = defineProps<{
	channel: Misskey.entities.Channel;
}>();

/** Twitter UI 判定（Shell 注入；驱动频道预览卡的 token 表现变体，R-2 组件变体路径）。 */
const isTwitterUi = useIsTwitterUi();

const getLastReadedAt = (): number | null => {
	return miLocalStorage.getItemAsJson(`channelLastReadedAt:${props.channel.id}`) ?? null;
};

const lastReadedAt = ref(getLastReadedAt());

watch(() => props.channel.id, () => {
	lastReadedAt.value = getLastReadedAt();
});

const updateLastReadedAt = () => {
	lastReadedAt.value = props.channel.lastNotedAt ? Date.parse(props.channel.lastNotedAt) : Date.now();
};

const bannerStyle = computed(() => {
	if (props.channel.bannerUrl) {
		return { backgroundImage: `url(${props.channel.bannerUrl})` };
	} else if (isTwitterUi.value) {
		/* twitter 变体：无 banner 时回退面板 token（内联样式优先级高于类，须在此分流） */
		return { backgroundColor: 'var(--twitter-panel)' };
	} else {
		return { backgroundColor: '#4c5e6d' };
	}
});
</script>

<style lang="scss" scoped>
.eftoefju {
	display: block;
	position: relative;
	overflow: hidden;
	width: 100%;

	&:hover {
		text-decoration: none;
	}

	&:focus-within {
		outline: none;

		&::after {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			border-radius: inherit;
			pointer-events: none;
			box-shadow: inset 0 0 0 2px var(--MI_THEME-focus);
		}
	}

	> .banner {
		position: relative;
		width: 100%;
		height: 200px;
		background-position: center;
		background-size: cover;

		> .fade {
			position: absolute;
			bottom: 0;
			left: 0;
			width: 100%;
			height: 64px;
			background: linear-gradient(0deg, var(--MI_THEME-panel), color(from var(--MI_THEME-panel) srgb r g b / 0));
		}

		> .name {
			position: absolute;
			top: 16px;
			left: 16px;
			max-width: calc(100% - 32px);
			padding: 12px 16px;
			box-sizing: border-box;
			background: rgba(0, 0, 0, 0.7);
			color: #fff;
			font-size: 1.2em;
		}

		> .status {
			position: absolute;
			z-index: 1;
			bottom: 16px;
			right: 16px;
			padding: 8px 12px;
			font-size: 80%;
			background: rgba(0, 0, 0, 0.7);
			border-radius: 6px;
			color: #fff;
		}

		> .sensitiveIndicator {
			position: absolute;
			z-index: 1;
			bottom: 16px;
			left: 16px;
			background: rgba(0, 0, 0, 0.7);
			color: var(--MI_THEME-warn);
			border-radius: 6px;
			font-weight: bold;
			font-size: 1em;
			padding: 4px 7px;
		}
	}

	> article {
		padding: 16px;

		> p {
			margin: 0;
			font-size: 1em;
		}
	}

	> footer {
		padding: 12px 16px;
		border-top: solid 0.5px var(--MI_THEME-divider);

		> span {
			opacity: 0.7;
			font-size: 0.9em;
		}
	}

	/* Twitter UI 表现变体（P-25 / D4 裁决：Channels 页 Compatible 化）。
	 * 地面真值映射 nitter tweet/card.scss 链接卡（结构同构：图 + 标题卡）：
	 * card-container border 1px dark_grey / radius 10px / bg_elements → twitter token；
	 * card-title bold 1.1em(≈16.5px) → emphasis 16px 档（舍入登记见 port-fidelity-audit 滚动章节）；
	 * hover 边框 grey → secondary-fg 近似派生（无独立 grey token）。 */
	&.twitter {
		border: solid 1px var(--twitter-border);
		border-radius: var(--twitter-radius-embed);
		background: var(--twitter-panel);
		color: var(--twitter-fg);
		/* 根字号对齐 nitter 正文 15px 档，使内部 em 值自阶梯派生 */
		font-size: var(--twitter-font-size-content);

		&:hover {
			border-color: var(--twitter-secondary-fg);
		}

		&:focus-within::after {
			box-shadow: inset 0 0 0 2px var(--twitter-accent);
		}

		> .banner {
			> .fade {
				background: linear-gradient(0deg, var(--twitter-panel), color(from var(--twitter-panel) srgb r g b / 0));
			}

			> .name {
				font-size: var(--twitter-font-size-emphasis);
				font-weight: 700;
			}
		}

		> article > p {
			color: var(--twitter-fg);
		}

		> footer {
			border-top: solid 1px var(--twitter-border);

			> span {
				font-size: var(--twitter-font-size-meta);
			}
		}
	}

	@media (max-width: 550px) {
		font-size: 0.9em;

		> .banner {
			height: 80px;

			> .status {
				display: none;
			}
		}

		> article {
			padding: 12px;
		}

		> footer {
			display: none;
		}
	}

	@media (max-width: 500px) {
		font-size: 0.8em;

		> .banner {
			height: 70px;
		}

		> article {
			padding: 8px;
		}
	}
}

.indicator {
	position: absolute;
	top: 0;
	right: 0;
	transform: translate(25%, -25%);
	background-color: var(--MI_THEME-accent);
	border: solid var(--MI_THEME-bg) 4px;
	border-radius: 100%;
	width: 1.5rem;
	height: 1.5rem;
	aspect-ratio: 1 / 1;
}

</style>
