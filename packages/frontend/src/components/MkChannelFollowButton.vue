<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button
	class="_button"
	:class="[$style.root, { [$style.wait]: wait, [$style.active]: isFollowing, [$style.full]: full, [$style.twitter]: isTwitterUi }]"
	:disabled="wait"
	@click="onClick"
>
	<template v-if="!wait">
		<template v-if="isFollowing">
			<span v-if="full" :class="$style.text">{{ i18n.ts.unfollow }}</span><i class="ti ti-minus"></i>
		</template>
		<template v-else>
			<span v-if="full" :class="$style.text">{{ i18n.ts.follow }}</span><i class="ti ti-plus"></i>
		</template>
	</template>
	<template v-else>
		<span v-if="full" :class="$style.text">{{ i18n.ts.processing }}</span><MkLoading :em="true"/>
	</template>
</button>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const props = withDefaults(defineProps<{
	channel: Misskey.entities.Channel;
	full?: boolean;
}>(), {
	full: false,
});

/** Twitter UI 判定（Shell 注入；驱动关注按钮的 X 表现变体）。 */
const isTwitterUi = useIsTwitterUi();

const isFollowing = ref(props.channel.isFollowing);
const wait = ref(false);

async function onClick() {
	wait.value = true;

	try {
		if (isFollowing.value) {
			await misskeyApi('channels/unfollow', {
				channelId: props.channel.id,
			});
			isFollowing.value = false;
		} else {
			await misskeyApi('channels/follow', {
				channelId: props.channel.id,
			});
			isFollowing.value = true;
		}
	} catch (err) {
		console.error(err);
	} finally {
		wait.value = false;
	}
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: inline-block;
	font-weight: bold;
	color: var(--MI_THEME-accent);
	background: transparent;
	border: solid 1px var(--MI_THEME-accent);
	padding: 0;
	height: 31px;
	font-size: 16px;
	border-radius: 32px;
	background: #fff;

	&.full {
		padding: 0 8px 0 12px;
		font-size: 14px;
	}

	&:not(.full) {
		width: 31px;
	}

	&:focus-visible {
		outline-offset: 2px;
	}

	&:hover {
		//background: mix($primary, #fff, 20);
	}

	&:active {
		//background: mix($primary, #fff, 40);
	}

	&.active {
		color: var(--MI_THEME-fgOnAccent);
		background: var(--MI_THEME-accent);

		&:hover {
			background: hsl(from var(--MI_THEME-accent) h s calc(l + 10));
			border-color: hsl(from var(--MI_THEME-accent) h s calc(l + 10));
		}

		&:active {
			background: hsl(from var(--MI_THEME-accent) h s calc(l - 10));
			border-color: hsl(from var(--MI_THEME-accent) h s calc(l - 10));
		}
	}

	&.wait {
		cursor: wait !important;
		opacity: 0.7;
	}
}

/* Twitter UI 表现变体（P-25）：X follow button 行为——nitter 为只读查看器无关注能力（检索证据见
 * port-fidelity-audit 滚动章节），故取 X-behavior：未关注 = accent 实心 pill（fg-on-accent 文字）、
 * 已关注 = hairline 描边 pill、悬停转危险色提示取关。 */
.twitter {
	border-color: var(--twitter-accent);
	background: var(--twitter-accent);
	color: var(--twitter-fg-on-accent);
	border-radius: var(--twitter-radius-pill);

	&:hover {
		background: var(--twitter-accent-hover);
		border-color: var(--twitter-accent-hover);
	}

	&.active {
		background: transparent;
		border-color: var(--twitter-border);
		color: var(--twitter-fg);

		&:hover {
			background: color-mix(in srgb, var(--twitter-danger) 10%, transparent);
			border-color: var(--twitter-danger);
			color: var(--twitter-danger);
		}
	}
}

.text {
	margin-right: 6px;
}
</style>
