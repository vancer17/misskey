<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：既有页面标签的纯展示横向转场与触摸识别。
作用：根据宿主选中标识切换唯一当前面板，并将过渡生命周期交给宿主协调局部展示几何。
数据链：标签顺序与选中标识 → 横移方向／触摸距离 → 面板过渡；不请求数据或保存业务状态。
-->

<template>
<div
	ref="rootEl"
	data-mk-swiper
	:class="[$style.transitionRoot, { [$style.enableAnimation]: shouldAnimate, [$style.enableSwipe]: prefer.s.enableHorizontalSwipe }]"
	@touchstart.passive="touchStart"
	@touchmove.passive="touchMove"
	@touchend.passive="touchEnd"
>
	<Transition
		:class="[$style.transitionChildren, { [$style.swiping]: isSwipingForClass }]"
		:enterActiveClass="$style.swipeAnimation_enterActive"
		:leaveActiveClass="$style.swipeAnimation_leaveActive"
		:enterFromClass="transitionName === 'swipeAnimationLeft' ? $style.swipeAnimationLeft_enterFrom : $style.swipeAnimationRight_enterFrom"
		:leaveToClass="transitionName === 'swipeAnimationLeft' ? $style.swipeAnimationLeft_leaveTo : $style.swipeAnimationRight_leaveTo"
		:style="`--swipe: ${pullDistance}px;`"
		@beforeLeave="onBeforeLeave"
		@leave="onLeave"
		@afterLeave="onAfterLeave"
		@leaveCancelled="onLeaveCancelled"
		@beforeEnter="onBeforeEnter"
		@afterEnter="onAfterEnter"
		@enterCancelled="onEnterCancelled"
	>
		<div :key="tabModel" :data-mk-swiper-panel="tabModel">
			<slot></slot>
		</div>
	</Transition>
</div>
</template>
<script lang="ts" setup>
import { ref, useTemplateRef, computed, nextTick, onBeforeUnmount, watch } from 'vue';
import type { ComputedRef } from 'vue';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import { isHorizontalSwipeSwiping as isSwiping } from '@/utility/touch.js';
import { prefer } from '@/preferences.js';

const rootEl = useTemplateRef('rootEl');

const tabModel = defineModel<string>('tab');

/** 宿主可单独裁定点击动画，触摸识别继续遵守既有横向滑动偏好。 */
type SwiperProps = {
	tabs: Tab[];
	animationEnabled?: boolean;
};

const props: Readonly<SwiperProps> = withDefaults(defineProps<SwiperProps>(), {
	/** 缺省必须保持 undefined，避免 Boolean prop 自动转换后关闭存量消费者动画。 */
	animationEnabled: undefined,
});

/** 只中继面板生命周期，不在基础组件内接管宿主的滚动或数据归属。 */
const emit = defineEmits<{
	(ev: 'swiped', newKey: string, direction: 'left' | 'right'): void;
	(ev: 'beforeLeave', element: Element): void;
	(ev: 'afterLeave', element: Element): void;
	(ev: 'leaveCancelled', element: Element): void;
	(ev: 'beforeEnter', element: Element): void;
	(ev: 'afterEnter', element: Element): void;
	(ev: 'enterCancelled', element: Element): void;
}>();

/** 未指定展示裁定时保持原有消费者的动画规则。 */
const shouldAnimate: ComputedRef<boolean> = computed(
	/** 点击动画可由宿主关闭，且不反向修改用户的手势偏好。 */
	(): boolean => props.animationEnabled ?? (prefer.r.enableHorizontalSwipe.value || prefer.r.animation.value),
);

/** 仅保存 Vue 公开离场回调与本组件安排的帧，不接触 Vue 内部节点状态。 */
type PendingLeave = {
	done: () => void;
	frame: number | null;
};

/** 面板自身的未完成离场，宿主可以在下一次切换前统一结算。 */
const pendingLeaves: Map<Element, PendingLeave> = new Map<Element, PendingLeave>();

/** 移除局部观察任务，已完成或被取消的动画回调随后只会命中空记录。 */
function forgetLeaving(element: Element): void {
	const pending: PendingLeave | undefined = pendingLeaves.get(element);
	if (pending == null) return;
	pendingLeaves.delete(element);
	if (pending.frame != null) cancelAnimationFrame(pending.frame);
	pending.frame = null;
}

/** 仅结算仍对应当前元素身份的公开回调，让 Vue 自己清理 CSS 类与 DOM。 */
function completeLeaving(element: Element, pending: PendingLeave): void {
	if (pendingLeaves.get(element) !== pending) return;
	forgetLeaving(element);
	pending.done();
}

/** 通过公开回调结束全部旧离场，使宿主连续切换时最多保留一旧一新两个面板。 */
function finishLeaving(): void {
	for (const [element, pending] of pendingLeaves) completeLeaving(element, pending);
}

/** 离场 DOM 尚可读取时通知宿主登记本次可见几何。 */
function onBeforeLeave(element: Element): void { emit('beforeLeave', element); }

/** 等 Vue 提交离场样式后观察面板自身动画，以真实结束信号替代固定时长。 */
function onLeave(element: Element, done: () => void): void {
	const pending: PendingLeave = {
		/** 公开回调负责 Vue 的离场 CSS 清理与元素移除。 */
		done,
		/** 同时仅有一个尚未执行的样式测量帧。 */
		frame: null,
	};
	pendingLeaves.set(element, pending);
	pending.frame = requestAnimationFrame(
		/** Vue 先注册自己的第一帧，此帧只安排随后的动画测量。 */
		(): void => {
			if (pendingLeaves.get(element) !== pending) return;
			pending.frame = requestAnimationFrame(
				/** Vue 的第二帧已应用离场终态，仅读取面板本身的动画。 */
				(): void => {
					pending.frame = null;
					if (pendingLeaves.get(element) !== pending) return;
					const animations: Animation[] = element.getAnimations();
					if (animations.length === 0) {
						completeLeaving(element, pending);
						return;
					}
					void Promise.allSettled(animations.map(
						/** 取消同样代表该面板的原动画已经结束，不等待子元素动效。 */
						(animation: Animation): Promise<Animation> => animation.finished,
					)).then(
						/** 被宿主提前结算或被 Vue 取消的记录不能再次执行 done。 */
						(): void => { completeLeaving(element, pending); },
					);
				},
			);
		},
	);
}

/** 离场结束时通知宿主释放对应的临时几何约束。 */
function onAfterLeave(element: Element): void {
	forgetLeaving(element);
	emit('afterLeave', element);
}

/** 离场被打断时同样交回准确的元素身份供宿主清理。 */
function onLeaveCancelled(element: Element): void {
	forgetLeaving(element);
	emit('leaveCancelled', element);
}

/** 新面板进入前将真实元素交给宿主完成展示准备。 */
function onBeforeEnter(element: Element): void { emit('beforeEnter', element); }

/** 新面板进入完成后通知宿主提交当前展示终态。 */
function onAfterEnter(element: Element): void { emit('afterEnter', element); }

/** 新面板进入被打断时仅通知宿主，不触发业务回滚。 */
function onEnterCancelled(element: Element): void { emit('enterCancelled', element); }

// ▼ しきい値 ▼ //

// スワイプと判定される最小の距離
const MIN_SWIPE_DISTANCE = 20;

// スワイプ時の動作を発火する最小の距離
const SWIPE_DISTANCE_THRESHOLD = 70;

// スワイプできる最大の距離
const MAX_SWIPE_DISTANCE = 120;

// スワイプ方向を判定する角度の許容範囲（度数）
const SWIPE_DIRECTION_ANGLE_THRESHOLD = 50;

// ▲ しきい値 ▲ //

let startScreenX: number | null = null;
let startScreenY: number | null = null;

const currentTabIndex = computed(() => props.tabs.findIndex(tab => tab.key === tabModel.value));

const pullDistance = ref(0);
const isSwipingForClass = ref(false);
let swipeAborted = false;
let swipeDirectionLocked: 'horizontal' | 'vertical' | null = null;

function touchStart(event: TouchEvent) {
	if (!prefer.r.enableHorizontalSwipe.value) return;

	if (event.touches.length !== 1) return;

	if (hasSomethingToDoWithXSwipe(event.target as HTMLElement)) return;

	startScreenX = event.touches[0].screenX;
	startScreenY = event.touches[0].screenY;
	swipeDirectionLocked = null; // スワイプ方向をリセット
}

function touchMove(event: TouchEvent) {
	if (!prefer.r.enableHorizontalSwipe.value) return;

	if (event.touches.length !== 1) return;

	if (startScreenX == null || startScreenY == null) return;

	if (swipeAborted) return;

	if (hasSomethingToDoWithXSwipe(event.target as HTMLElement)) return;

	let distanceX = event.touches[0].screenX - startScreenX;
	let distanceY = event.touches[0].screenY - startScreenY;

	// スワイプ方向をロック
	if (!swipeDirectionLocked) {
		const angle = Math.abs(Math.atan2(distanceY, distanceX) * (180 / Math.PI));
		if (angle > 90 - SWIPE_DIRECTION_ANGLE_THRESHOLD && angle < 90 + SWIPE_DIRECTION_ANGLE_THRESHOLD) {
			swipeDirectionLocked = 'vertical';
		} else {
			swipeDirectionLocked = 'horizontal';
		}
	}

	// 縦方向のスワイプの場合は中断
	if (swipeDirectionLocked === 'vertical') {
		swipeAborted = true;
		pullDistance.value = 0;
		isSwiping.value = false;
		window.setTimeout(() => {
			isSwipingForClass.value = false;
		}, 400);
		return;
	}

	if (Math.abs(distanceX) < MIN_SWIPE_DISTANCE) return;
	if (Math.abs(distanceX) > MAX_SWIPE_DISTANCE) return;

	if (currentTabIndex.value === 0 || props.tabs[currentTabIndex.value - 1].onClick) {
		distanceX = Math.min(distanceX, 0);
	}
	if (currentTabIndex.value === props.tabs.length - 1 || props.tabs[currentTabIndex.value + 1].onClick) {
		distanceX = Math.max(distanceX, 0);
	}
	if (distanceX === 0) return;

	isSwiping.value = true;
	isSwipingForClass.value = true;
	nextTick(() => {
		// グリッチを控えるため、1.5px以上の差がないと更新しない
		if (Math.abs(distanceX - pullDistance.value) < 1.5) return;
		pullDistance.value = distanceX;
	});
}

function touchEnd(event: TouchEvent) {
	if (swipeAborted) {
		swipeAborted = false;
		return;
	}

	if (!prefer.r.enableHorizontalSwipe.value) return;

	if (event.touches.length !== 0) return;

	if (startScreenX == null) return;

	if (!isSwiping.value) return;

	if (hasSomethingToDoWithXSwipe(event.target as HTMLElement)) return;

	const distance = event.changedTouches[0].screenX - startScreenX;

	if (Math.abs(distance) > SWIPE_DISTANCE_THRESHOLD) {
		if (distance > 0) {
			if (props.tabs[currentTabIndex.value - 1] && !props.tabs[currentTabIndex.value - 1].onClick) {
				tabModel.value = props.tabs[currentTabIndex.value - 1].key;
				emit('swiped', props.tabs[currentTabIndex.value - 1].key, 'right');
			}
		} else {
			if (props.tabs[currentTabIndex.value + 1] && !props.tabs[currentTabIndex.value + 1].onClick) {
				tabModel.value = props.tabs[currentTabIndex.value + 1].key;
				emit('swiped', props.tabs[currentTabIndex.value + 1].key, 'left');
			}
		}
	}

	pullDistance.value = 0;
	isSwiping.value = false;
	window.setTimeout(() => {
		isSwipingForClass.value = false;
	}, 400);

	swipeDirectionLocked = null; // スワイプ方向をリセット
}

/** 横スワイプに関与する可能性のある要素を調べる */
function hasSomethingToDoWithXSwipe(el: HTMLElement) {
	if (['INPUT', 'TEXTAREA'].includes(el.tagName)) return true;
	if (el.isContentEditable) return true;
	if (el.scrollWidth > el.clientWidth) return true;

	const style = window.getComputedStyle(el);
	if (['absolute', 'fixed', 'sticky'].includes(style.position)) return true;
	if (['scroll', 'auto'].includes(style.overflowX)) return true;
	if (style.touchAction === 'pan-x') return true;

	if (el.parentElement && el.parentElement !== rootEl.value) {
		return hasSomethingToDoWithXSwipe(el.parentElement);
	} else {
		return false;
	}
}

const transitionName = ref<'swipeAnimationLeft' | 'swipeAnimationRight' | undefined>(undefined);

watch(tabModel,
	/** 方向只由最新标签顺序派生，旧定时任务不能清除后续切换的方向。 */
	(newTab: string | undefined, oldTab: string | undefined): void => {
		const newIndex: number = props.tabs.findIndex(
			/** 将新标识映射到宿主声明的展示顺序。 */
			(tab: Tab): boolean => tab.key === newTab,
		);
		const oldIndex: number = props.tabs.findIndex(
			/** 旧标识仅用于计算本次位移方向，不保存旧业务状态。 */
			(tab: Tab): boolean => tab.key === oldTab,
		);
		transitionName.value = oldIndex >= 0 && newIndex >= 0 && oldIndex < newIndex ? 'swipeAnimationLeft' : 'swipeAnimationRight';
	},
);

onBeforeUnmount(finishLeaving);

defineExpose({
	/** 宿主在下一次选中值提交前结算旧面板，不直接删除 DOM。 */
	finishLeaving,
});
</script>

<style lang="scss" module>
.transitionRoot {
	display: grid;
	grid-template-columns: 100%;
	overflow: clip;
}

.enableSwipe {
	touch-action: pan-y pinch-zoom;
}

.transitionChildren {
	grid-area: 1 / 1 / 2 / 2;
	transform: translateX(var(--swipe));
}

.enableAnimation .transitionChildren {
	&.swipeAnimation_enterActive,
	&.swipeAnimation_leaveActive {
		transition: transform var(--MI-swiper-duration, .3s) var(--MI-swiper-ease, cubic-bezier(0.65, 0.05, 0.36, 1));
	}

	&.swipeAnimationRight_leaveTo,
	&.swipeAnimationLeft_enterFrom {
		transform: translateX(calc(100% + var(--MI-swiper-gap, 24px)));
	}

	&.swipeAnimationRight_enterFrom,
	&.swipeAnimationLeft_leaveTo {
		transform: translateX(calc(-100% - var(--MI-swiper-gap, 24px)));
	}
}

.swiping {
	transition: transform .2s ease-out;
}
</style>
