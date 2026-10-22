<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：通用嵌套路由出口。
作用：沿用子路由解析，加载期间优先消费 UI 宿主传入的展示插槽。
数据链：父出口加载上下文 → 子路由占位；不持有页面或业务状态副本。
-->

<template>
<Suspense :timeout="0">
	<component :is="currentPageComponent" :key="key" v-bind="Object.fromEntries(currentPageProps)"/>

	<template #fallback>
		<slot name="fallback">
			<component :is="routeFallback" v-if="routeFallback"/>
			<MkLoading v-else/>
		</slot>
	</template>
</Suspense>
</template>

<script lang="ts" setup>
import { inject, provide, ref, shallowRef, useSlots } from 'vue';
import type { Slot, Slots } from 'vue';
import { routerViewFallbackKey } from './router-view-fallback.js';
import type { Router } from '@/router.js';
import type { PathResolvedResult } from '@/lib/nirax.js';
import MkLoadingPage from '@/pages/_loading_.vue';
import { DI } from '@/di.js';

const props = defineProps<{
	router?: Router;
}>();

/** 局部展示插槽可覆盖继承的加载画面，其他情况沿用父出口契约。 */
const slots: Slots = useSlots();
/** 继承与透传仅影响展示，不新增路径判断或页面注册表。 */
const routeFallback: Slot | undefined = slots.fallback ?? inject(routerViewFallbackKey, undefined);
provide(routerViewFallbackKey, routeFallback);

const router = props.router ?? inject(DI.router);

if (router == null) {
	throw new Error('no router provided');
}

const currentDepth = inject(DI.routerCurrentDepth, 0);
provide(DI.routerCurrentDepth, currentDepth + 1);

function resolveNested(current: PathResolvedResult, d = 0): PathResolvedResult | null {
	if (d === currentDepth) {
		return current;
	} else {
		if (current.child) {
			return resolveNested(current.child, d + 1);
		} else {
			return null;
		}
	}
}

const current = resolveNested(router.current)!;
const currentPageComponent = shallowRef('component' in current.route ? current.route.component : MkLoadingPage);
const currentPageProps = ref(current.props);
const key = ref(router.getCurrentFullPath());

router.useListener('change', ({ resolved }) => {
	const current = resolveNested(resolved);
	if (current == null || 'redirect' in current.route) return;
	currentPageComponent.value = current.route.component;
	currentPageProps.value = current.props;
	key.value = router.getCurrentFullPath();
});
</script>
