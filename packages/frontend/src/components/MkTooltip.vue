<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Transition
	:enterActiveClass="prefer.s.animation ? $style.transition_tooltip_enterActive : ''"
	:leaveActiveClass="prefer.s.animation ? $style.transition_tooltip_leaveActive : ''"
	:enterFromClass="prefer.s.animation ? $style.transition_tooltip_enterFrom : ''"
	:leaveToClass="prefer.s.animation ? $style.transition_tooltip_leaveTo : ''"
	appear :css="prefer.s.animation"
	@afterLeave="emit('closed')"
>
	<div v-show="showing" ref="el" :class="[$style.root, { [$style.twitter]: isTwitterUi }]" class="_acrylic _shadow" :style="{ zIndex, maxWidth: maxWidth + 'px' }">
		<slot>
			<template v-if="text">
				<Mfm v-if="asMfm" :text="text"/>
				<span v-else>{{ text }}</span>
			</template>
		</slot>
	</div>
</Transition>
</template>

<script lang="ts" setup>
import { nextTick, onMounted, onUnmounted, useTemplateRef } from 'vue';
import * as os from '@/os.js';
import { calcPopupPosition } from '@/utility/popup-position.js';
import { prefer } from '@/preferences.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';

const props = withDefaults(defineProps<{
	showing: boolean;
	anchorElement?: HTMLElement;
	x?: number;
	y?: number;
	text?: string;
	asMfm?: boolean;
	maxWidth?: number;
	direction?: 'top' | 'bottom' | 'right' | 'left';
	innerMargin?: number;
}>(), {
	maxWidth: 250,
	direction: 'top',
	innerMargin: 0,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

// タイミングによっては最初から showing = false な場合があり、その場合に closed 扱いにしないと永久にDOMに残ることになる
if (!props.showing) emit('closed');

const el = useTemplateRef('el');
const zIndex = os.claimZIndex('high');
const isTwitterUi = useIsTwitterUi();

function setPosition() {
	if (el.value == null) return;
	const data = calcPopupPosition(el.value, {
		anchorElement: props.anchorElement,
		direction: props.direction,
		align: 'center',
		innerMargin: props.innerMargin,
		x: props.x,
		y: props.y,
	});

	el.value.style.transformOrigin = data.transformOrigin;
	el.value.style.left = data.left + 'px';
	el.value.style.top = data.top + 'px';
}

let loopHandler: number | null = null;

onMounted(() => {
	nextTick(() => {
		setPosition();

		const loop = () => {
			setPosition();
			loopHandler = window.requestAnimationFrame(loop);
		};

		loop();
	});
});

onUnmounted(() => {
	if (loopHandler != null) window.cancelAnimationFrame(loopHandler);
});
</script>

<style lang="scss" module>
.transition_tooltip_enterActive,
.transition_tooltip_leaveActive {
	opacity: 1;
	transform: scale(1);
	transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.transition_tooltip_enterFrom,
.transition_tooltip_leaveTo {
	opacity: 0;
	transform: scale(0.75);
}

.root {
	position: absolute;
	font-size: 0.8em;
	padding: 8px 12px;
	box-sizing: border-box;
	text-align: center;
	border-radius: 4px;
	border: solid 0.5px var(--MI_THEME-divider);
	pointer-events: none;
	transform-origin: center center;

	/* Twitter UI 表现变体：X 深色 pill，无毛玻璃与边框 */
	&.twitter {
		background: var(--twitter-tooltip-bg);
		color: var(--twitter-tooltip-fg);
		border: none;
		border-radius: var(--twitter-radius-pill);
		padding: 6px 12px;
		font-size: var(--twitter-font-size-caption);
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}
}

/* Twitter UI 表现变体：X tooltip 动效（泄漏审计 E4：200ms 硬编码收敛为 motion token 快速档；微缩放 0.97 替换 Misskey 0.75 弹跳，X-behavior 来源） */
.twitter.transition_tooltip_enterActive,
.twitter.transition_tooltip_leaveActive {
	transition: transform var(--twitter-duration-fast) var(--twitter-ease), opacity var(--twitter-duration-fast) var(--twitter-ease);
}

.twitter.transition_tooltip_enterFrom,
.twitter.transition_tooltip_leaveTo {
	transform: scale(0.97);
}
</style>
