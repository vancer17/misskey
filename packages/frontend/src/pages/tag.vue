<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<TwitterTag
	v-if="isTwitterUi"
	:tag="tag"
	:paginator="paginator"
	:actions="twitterActions"
/>
<PageWithHeader v-else :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkNotesTimeline :paginator="paginator"/>
	</div>
	<template v-if="$i" #footer>
		<div :class="$style.footer">
			<div class="_spacer" style="--MI_SPACER-w: 800px; --MI_SPACER-min: 16px; --MI_SPACER-max: 16px;">
				<MkButton rounded primary :class="$style.button" @click="post()"><i class="ti ti-pencil"></i>{{ i18n.ts.postToHashtag }}</MkButton>
			</div>
		</div>
	</template>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, inject, markRaw, ref } from 'vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { store } from '@/store.js';
import * as os from '@/os.js';
import { genEmbedCode } from '@/utility/get-embed-code.js';
import { Paginator } from '@/utility/paginator.js';
import { DI } from '@/di.js';

/** Twitter UI 页面变体（异步加载，default UI 不承担其分包成本）。 */
const TwitterTag = defineAsyncComponent(() => import('./TwitterTag.vue'));

const props = defineProps<{
	tag: string;
}>();

const paginator = markRaw(new Paginator('notes/search-by-tag', {
	limit: 10,
	computedParams: computed(() => ({
		tag: props.tag,
	})),
}));

async function post() {
	store.set('postFormHashtags', props.tag);
	store.set('postFormWithHashtags', true);
	await os.post();
	store.set('postFormHashtags', '');
	store.set('postFormWithHashtags', false);
	paginator.reload();
}

/** 当前 UI 样式（由 Twitter Shell 注入；非 Twitter 场景回退 'default'）。 */
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');

/** 打开 ⋯ 菜单（embed 等低频动作；legacy 头部与 Twitter 变体共用，避免复制菜单定义）。 */
function openMoreMenu(ev: PointerEvent): void {
	os.popupMenu([{
		text: i18n.ts.embed,
		icon: 'ti ti-code',
		action: () => {
			genEmbedCode('tags', props.tag);
		},
	}], ev.currentTarget ?? ev.target);
}

/** legacy 头部动作。 */
const headerActions = computed<PageHeaderItem[]>(() => [{
	icon: 'ti ti-dots',
	text: i18n.ts.more,
	handler: openMoreMenu,
}]);

/** Twitter 变体头部动作：发帖预填（替换 legacy 页脚按钮）+ ⋯ 菜单；业务 handler 留在页面层。 */
const twitterActions = computed<PageHeaderItem[]>(() => [{
	icon: 'ti ti-pencil',
	text: i18n.ts.postToHashtag,
	handler: () => {
		void post();
	},
}, {
	icon: 'ti ti-dots',
	text: i18n.ts.more,
	handler: openMoreMenu,
}]);

const headerTabs = computed(() => []);

definePage(() => ({
	title: props.tag,
	icon: 'ti ti-hash',
}));
</script>

<style lang="scss" module>
.footer {
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	border-top: solid 0.5px var(--MI_THEME-divider);
	display: flex;
}

.button {
	margin: 0 auto;
}
</style>
