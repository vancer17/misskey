<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：通用主路由出口。
作用：沿用既有路由和页面缓存，仅允许宿主定制加载展示与出口背景。
数据链：路由解析结果 → 页面实例；加载插槽向嵌套出口传递，不产生业务事实。
-->

<template>
<div class="_pageContainer" :class="$style.root">
	<KeepAlive :max="prefer.s.numberOfPageCache">
		<Suspense :timeout="0">
			<component :is="currentPageComponent" :key="key" v-bind="Object.fromEntries(currentPageProps)"/>

			<template #fallback>
				<slot name="fallback">
					<component :is="routeFallback" v-if="routeFallback"/>
					<MkLoading v-else/>
				</slot>
			</template>
		</Suspense>
	</KeepAlive>
</div>
</template>

<script lang="ts" setup>
import { inject, provide, ref, shallowRef, useSlots } from 'vue';
import type { Slot, Slots } from 'vue';
import { routerViewFallbackKey } from './router-view-fallback.js';
import type { Router } from '@/router.js';
import { prefer } from '@/preferences.js';
import MkLoadingPage from '@/pages/_loading_.vue';
import { DI } from '@/di.js';
import { randomId } from '@/utility/random-id.js';
import { deepEqual } from '@/utility/deep-equal.js';

const props = defineProps<{
	router?: Router;
}>();

/** 宿主提供的展示插槽只沿当前出口子树继承，不改变路由解析及缓存。 */
const slots: Slots = useSlots();
/** 将当前宿主占位透传给后代出口，避免嵌套加载回落到另一套视觉风格。 */
const routeFallback: Slot | undefined = slots.fallback ?? inject(routerViewFallbackKey, undefined);
provide(routerViewFallbackKey, routeFallback);

const _router = props.router ?? inject(DI.router);

if (_router == null) {
	throw new Error('no router provided');
}

const router = _router;

const viewId = randomId();
provide(DI.viewId, viewId);

const currentDepth = inject(DI.routerCurrentDepth, 0);
provide(DI.routerCurrentDepth, currentDepth + 1);

const current = router.current;
const currentPageComponent = shallowRef('component' in current.route ? current.route.component : MkLoadingPage);
const currentPageProps = ref(current.props);
let currentRoutePath = current.route.path;
const key = ref(getPageViewKey(current.route, router.getCurrentFullPath()));

router.useListener('change', ({ resolved }) => {
	if (resolved == null || 'redirect' in resolved.route) return;
	if (resolved.route.path === currentRoutePath && deepEqual(resolved.props, currentPageProps.value)) return;

	currentPageComponent.value = resolved.route.component;
	currentPageProps.value = resolved.props;
	key.value = getPageViewKey(resolved.route, router.getCurrentFullPath());
	currentRoutePath = resolved.route.path;
});

function getPageViewKey(route: typeof current.route, fullPath: string): string {
	return route.viewKey ?? fullPath;
}
</script>

<style lang="scss" module>
.root {
	height: 100%;
	background-color: var(--MI-router-view-background, var(--MI_THEME-bg));

	/**
	 * FIXME: Safari 26 で contain: layout を指定するとバグるので、hotfixとして _pageContainer の content: strict を上書き
	 * https://github.com/misskey-dev/misskey/issues/16204#issuecomment-3265404776
	 * https://bugs.webkit.org/show_bug.cgi?id=297186
	 */
	contain: size style paint !important;
}
</style>
