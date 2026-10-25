/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter Shell 的单份路由内容入场。
 * 作用：观察既有出口直接根的真实提交，仅对新进入的绘制节点轻淡入，不延长页面生命周期。
 * 数据链：现有导航标识／活动根身份 → 有界 DOM 观察与临时动画；不消费元信息、业务状态或 readiness。
 * 边界：不克隆节点、不挂载页面副本、不改变尺寸与滚动；私信的阅读租约仍由原页面负责。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { TWITTER_MOTION_DURATIONS } from '../domain/motion.js';
import { prefer } from '@/preferences.js';

/** 动画偏好只属于当前展示宿主；系统减少动画在运行中变化时立即通知消费者。 */
function useEntryMotionPolicy(enabled: ComputedRef<boolean>): ComputedRef<boolean> {
	/** 本地允许值只控制绘制，不参与页面就绪或业务权限判断。 */
	const allowed: Ref<boolean> = ref<boolean>(false);
	/** 系统偏好监听随宿主和 Misskey 动画设置启停。 */
	let query: MediaQueryList | null = null;
	/** 挂载前与卸载后均不建立浏览器订阅。 */
	let mounted: boolean = false;

	/** 释放系统监听，不在隐藏或禁用的宿主上保留无用资源。 */
	function release(): void {
		query?.removeEventListener('change', sync);
		query = null;
		allowed.value = false;
	}

	/** 启动时读取当前系统值，后续消费原生 change，不缓存环境能力。 */
	function sync(): void {
		if (!mounted || !enabled.value || !prefer.s.animation) { release(); return; }
		if (query == null) {
			query = window.matchMedia('(prefers-reduced-motion: reduce)');
			query.addEventListener('change', sync);
		}
		allowed.value = !query.matches;
	}

	watch([enabled, prefer.r.animation], sync, { flush: 'sync' });
	onMounted(/** 开始当前宿主的展示偏好订阅。 */ (): void => { mounted = true; sync(); });
	onBeforeUnmount(/** 停止订阅并同步撤销尚未完成的绘制。 */ (): void => { mounted = false; release(); });
	return computed(/** 只读偏好投影，调用方不得回写系统或账户设置。 */ (): boolean => allowed.value);
}

/** 原生取消恢复元素自身样式；只取消调用方登记的效果，不碰骨架或后代动画。 */
function cancelEntryAnimations(animations: Map<HTMLElement, Animation>): void {
	/** 先清所有权，使已排队的旧事件不能清理后续新动画。 */
	const previous: Animation[] = Array.from(animations.values());
	animations.clear();
	previous.forEach(/** 解除本模块的完成回调后撤销绘制。 */ (animation: Animation): void => {
		animation.onfinish = null;
		animation.oncancel = null;
		animation.cancel();
	});
}

/** 消费实际根继承的 Token 创建纯透明度效果，失败时直接保留页面正常终态。 */
function playEntryAnimations(elements: readonly HTMLElement[], id: string, animations: Map<HTMLElement, Animation>): void {
	const first: HTMLElement | undefined = elements[0];
	if (first == null) return;
	/** CSS 是透明度起点与缓动的唯一展示来源，JS 不再定义同值参数。 */
	const style: CSSStyleDeclaration = window.getComputedStyle(first);
	const opacitySource: string = style.getPropertyValue('--twitter-route-entry-opacity').trim();
	const opacity: number = Number(opacitySource);
	const easing: string = style.getPropertyValue('--twitter-ease').trim();
	if (opacitySource === '' || !Number.isFinite(opacity) || opacity <= 0 || opacity >= 1 || easing === '') return;
	if (elements.some(/** 无 WAAPI 时不写入替代样式，直接维持可见终态。 */ (element: HTMLElement): boolean => typeof element.animate !== 'function')) return;
	/** 仅透明度改变，真实几何、滚动和消息可见性观察保持原样。 */
	const keyframes: Keyframe[] = [{ opacity }, { opacity: 1 }];
	/** 复用标准时长与实际缓动；完成后不把动画终态残留为另一层样式所有者。 */
	const options: KeyframeAnimationOptions = { duration: TWITTER_MOTION_DURATIONS.normal, easing, fill: 'none' };
	try {
		elements.forEach(/** Fragment 不增加包装层，所有直接根共同入场。 */ (element: HTMLElement): void => {
			const animation: Animation = element.animate(keyframes, options);
			animation.id = id;
			animations.set(element, animation);
			/** 仅清理同一原生效果，旧事件不能误删快速切换后的新登记。 */
			const release: () => void = /** 原生完成与取消共用所有权检查。 */ (): void => {
				if (animations.get(element) === animation) animations.delete(element);
			};
			animation.onfinish = release;
			animation.oncancel = release;
		});
	} catch (_error: unknown) {
		// 浏览器拒绝绘制参数时恢复原页面，不把动画失败升级为导航或业务失败。
		cancelEntryAnimations(animations);
	}
}

/**
 * 为现有主出口添加纯绘制入场；宿主决定匿名／叠层等场景是否启用，不以动画阻塞导航。
 * 首次挂载及恢复动画偏好只记录当前根；fallback、实际页面及缓存回访按根身份变化交接。
 */
export function useTwitterRouteEntry(
	content: Readonly<Ref<HTMLElement | null>>,
	enabled: ComputedRef<boolean>,
	navigationKey: ComputedRef<string>,
): void {
	/** 系统和 Misskey 动画偏好共同决定当前展示资源是否启用。 */
	const motion: ComputedRef<boolean> = useEntryMotionPolicy(enabled);
	/** 当前主列只观察直接出口的替换，不深监听业务列表。 */
	let observedContent: HTMLElement | null = null;
	/** 唯一活动出口；嵌套路由出口不参与 Shell 入场。 */
	let outlet: HTMLElement | null = null;
	/** 直接根可有多个，以支持 Vue Fragment；不保存任何业务节点副本。 */
	let roots: readonly HTMLElement[] = [];
	/** 主列观察只负责既有 RouterView／StackingRouterView 的根替换。 */
	let contentObserver: MutationObserver | null = null;
	/** 出口观察只负责 Suspense 占位与页面直接根的提交。 */
	let outletObserver: MutationObserver | null = null;
	/** 当前入场只持有本模块创建的动画，不取消骨架或后代自己的动画。 */
	const animations: Map<HTMLElement, Animation> = new Map<HTMLElement, Animation>();
	/** 同一帧只消费最新实际根，快速路由切换不排队播放旧内容。 */
	let frame: number | null = null;
	/** 请求代次隔离被取消的帧及较早动画完成回调。 */
	let generation: number = 0;
	/** 首次真实导航之前只更新首屏基线，异步首屏的占位交接也不播放入场。 */
	let navigated: boolean = false;
	/** 组件实际挂载后才读取可见 DOM。 */
	let mounted: boolean = false;
	/** 卸载后所有迟到回调均不得建立新观察或动画。 */
	let disposed: boolean = false;

	/** 只识别主列的直接出口，避免把页内列表或嵌套页面当作另一个路由提交。 */
	function findOutlet(): HTMLElement | null {
		return observedContent?.querySelector<HTMLElement>(':scope > [data-twitter-route-outlet]') ?? null;
	}

	/** Fragment 的所有直接 HTML 根共同入场；注释、文本及隐藏根直接保留其正常终态。 */
	function readRoots(): readonly HTMLElement[] {
		return Array.from(outlet?.children ?? []).filter(
			/** 仅收集已提交到当前文档且存在布局盒子的真实根，不深入后代。 */
			(element: Element): element is HTMLElement => element instanceof HTMLElement && element.isConnected && element.getClientRects().length > 0,
		);
	}

	/** 作废待执行帧；不等待固定时间猜测组件或接口是否完成。 */
	function cancelFrame(): void {
		if (frame != null) window.cancelAnimationFrame(frame);
		frame = null;
	}

	/** 只在既有展示策略和动态动画偏好允许时维护局部观察。 */
	function canObserve(): boolean {
		return mounted && !disposed && motion.value;
	}

	/** 出口根改变时重新绑定直接子节点观察；保持既有页面的唯一实例。 */
	function bindOutlet(): void {
		const next: HTMLElement | null = findOutlet();
		if (outlet === next) return;
		outletObserver?.disconnect();
		outletObserver = null;
		outlet = next;
		if (outlet == null) return;
		outletObserver = new MutationObserver(schedule);
		outletObserver.observe(outlet, { childList: true });
	}

	/** 在一帧中读取最后提交的直接根，普通消息插入和元信息变化均不会重播。 */
	function schedule(): void {
		if (!canObserve() || observedContent == null || frame != null) return;
		const owner: number = generation;
		const key: string = navigationKey.value;
		const request: number = window.requestAnimationFrame(/** 只执行仍属于当前导航且尚未取消的帧。 */ (): void => {
			if (frame !== request) return;
			frame = null;
			if (!canObserve() || generation !== owner || navigationKey.value !== key) return;
			bindOutlet();
			const next: readonly HTMLElement[] = readRoots();
			const unchanged: boolean = roots.length === next.length && roots.every(
				/** 只比较真实 DOM 身份，不通过路由或响应内容推测页面是否就绪。 */
				(element: HTMLElement, index: number): boolean => element === next[index],
			);
			if (unchanged) return;
			cancelEntryAnimations(animations);
			roots = next;
			if (navigated) playEntryAnimations(next, 'twitter-route-entry', animations);
		});
		frame = request;
	}

	/** 禁用绘制时撤销直接 DOM 观察和所有待执行效果。 */
	function stopObservation(): void {
		generation++;
		cancelFrame();
		cancelEntryAnimations(animations);
		contentObserver?.disconnect();
		outletObserver?.disconnect();
		contentObserver = null;
		outletObserver = null;
		observedContent = null;
		outlet = null;
		roots = [];
	}

	/** 宿主及运行时偏好变化只管理展示资源，不作为页面或服务端的 readiness 信号。 */
	function syncObservation(): void {
		if (!canObserve() || content.value == null) { stopObservation(); return; }
		if (observedContent === content.value) return;
		stopObservation();
		observedContent = content.value;
		contentObserver = new MutationObserver(schedule);
		contentObserver.observe(observedContent, { childList: true });
		bindOutlet();
		roots = readRoots();
	}

	watch(content, syncObservation, { flush: 'post' });
	watch(motion, syncObservation, { flush: 'sync' });
	watch(navigationKey, /** 新导航立即取消旧绘制，真实根在 Vue 提交后由观察器消费。 */ (): void => {
		if (mounted) navigated = true;
		generation++;
		cancelFrame();
		cancelEntryAnimations(animations);
		schedule();
	}, { flush: 'sync' });
	onMounted(/** 首次挂载只建立当前 DOM 基线，避免把整页启动当成导航。 */ (): void => { mounted = true; syncObservation(); });
	onBeforeUnmount(/** Shell 销毁后不保留观察、系统偏好监听或动画回调。 */ (): void => { disposed = true; stopObservation(); });
}

/**
 * 为右栏等单元素提供首次显示及隐藏后恢复的轻淡入；隐藏立即取消，不延迟真实 display 切换。
 * 动画偏好恢复只确认当前可见基线，不能使已经显示的内容原地重播。
 */
export function useTwitterVisibilityEntry(
	element: Readonly<Ref<HTMLElement | null>>,
	visible: ComputedRef<boolean>,
	enabled: ComputedRef<boolean>,
): void {
	/** 与主出口共用偏好处理，不另建右栏专属的动效配置或监听协议。 */
	const motion: ComputedRef<boolean> = useEntryMotionPolicy(enabled);
	/** 单元素只登记本次宿主自己的绘制效果。 */
	const animations: Map<HTMLElement, Animation> = new Map<HTMLElement, Animation>();
	/** 最近确认的真实节点，仅比较身份，不保存界面内容。 */
	let previous: HTMLElement | null = null;
	/** 当前实际显示基线，不将动画偏好关闭误当作隐藏。 */
	let shown: boolean = false;
	/** 显示变更在一帧内合并，不为过期节点安排迟到入场。 */
	let frame: number | null = null;
	/** 父级 v-show 的实际提交必须完成；代次防止较早的 nextTick 回调操作新显示状态。 */
	let visibilityGeneration: number = 0;
	/** 挂载之前不读取布局，也不提前绘制。 */
	let mounted: boolean = false;
	/** 卸载后所有待执行展示任务作废。 */
	let disposed: boolean = false;

	/** 只消费宿主的展示事实和当前布局盒子，不判断业务能力。 */
	function isShown(): boolean {
		return visible.value && element.value != null && element.value.isConnected && element.value.getClientRects().length > 0;
	}

	/** 取消当前宿主全部绘制，元素的布局、可交互性由宿主原有属性负责。 */
	function cancel(): void {
		if (frame != null) window.cancelAnimationFrame(frame);
		frame = null;
		cancelEntryAnimations(animations);
	}

	/** DOM 显示提交后仅为实际进入的节点创建效果。 */
	function syncVisibility(): void {
		if (!mounted || disposed) return;
		const target: HTMLElement | null = element.value;
		const current: boolean = isShown();
		const entering: boolean = current && (!shown || previous !== target);
		previous = target;
		shown = current;
		if (!current || entering) cancel();
		if (!entering || !motion.value || target == null) return;
		const request: number = window.requestAnimationFrame(/** 只为仍显示的同一节点绘制，隐藏后不得复活旧任务。 */ (): void => {
			if (frame !== request) return;
			frame = null;
			if (disposed || !motion.value || element.value !== target || !isShown()) return;
			playEntryAnimations([target], 'twitter-rail-entry', animations);
		});
		frame = request;
	}

	/** 子组件的 post watcher 可能早于父级 v-show 更新，等待本轮完整 DOM 提交后再读取盒子。 */
	function scheduleVisibility(): void {
		const owner: number = ++visibilityGeneration;
		cancel();
		void nextTick(/** 只确认最新显示意图，不以固定延迟猜测父级指令完成。 */ (): void => {
			if (disposed || visibilityGeneration !== owner) return;
			syncVisibility();
		});
	}

	watch([element, visible], scheduleVisibility, { flush: 'post' });
	watch(motion, /** 偏好变化立即撤销效果，恢复时只记录当前显示基线。 */ (): void => {
		visibilityGeneration++;
		cancel();
		if (!mounted) return;
		previous = element.value;
		shown = isShown();
	}, { flush: 'sync' });
	onMounted(/** 首次实际显示也作为入场，隐藏挂载不启动动画。 */ (): void => { mounted = true; syncVisibility(); });
	onBeforeUnmount(/** 不延迟右栏销毁，不保留帧和原生动画。 */ (): void => { disposed = true; visibilityGeneration++; cancel(); });
}
