<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- 公共首页编排：复用实例权威状态，初始化优先；Twitter 入口与原欢迎页互斥，不复制认证业务。 -->
<template>
<div :class="{ [$style.twitter]: isTwitterUi }" data-testid="welcome-page">
	<MkLoading v-if="loading"/>
	<div v-else-if="failed" role="alert" :class="$style.failure">
		<p>{{ i18n.ts.somethingHappened }}</p>
		<MkButton @click="loadInstance">{{ i18n.ts.retry }}</MkButton>
	</div>
	<XSetup v-else-if="instance.requireSetup" data-testid="instance-setup"/>
	<TwitterWelcome v-else-if="isTwitterUi" :instance="instance"/>
	<XEntranceClassic v-else-if="(instance.clientOptions.entrancePageStyle ?? 'classic') === 'classic'"/>
	<XEntranceSimple v-else/>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import XSetup from './welcome.setup.vue';
import XEntranceClassic from './welcome.entrance.classic.vue';
import XEntranceSimple from './welcome.entrance.simple.vue';
import MkButton from '@/components/MkButton.vue';
import { definePage } from '@/page.js';
import type { PageMetadata } from '@/page.js';
import { fetchInstance, instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { TwitterWelcome, useIsTwitterUi } from '@/ui/twitter/index.js';

const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const loading: Ref<boolean> = ref(true);
const failed: Ref<boolean> = ref(false);

/** 刷新既有实例状态；组件仅持有加载／重试状态，不另存一份业务实例。 */
async function loadInstance(): Promise<void> {
	loading.value = true;
	failed.value = false;
	try {
		await fetchInstance(true);
	} catch {
		failed.value = true;
	} finally {
		loading.value = false;
	}
}

void loadInstance();
definePage(
	/** 首页标题沿用实例身份，不将页面元信息反向用作业务判断。 */
	(): PageMetadata => ({ title: instanceName, icon: null }),
);
</script>

<style lang="scss" module>
.twitter { height: 100%; }
.failure {
	display: grid;
	justify-items: center;
	gap: var(--MI-margin);
	padding: var(--MI-margin);
}
</style>
