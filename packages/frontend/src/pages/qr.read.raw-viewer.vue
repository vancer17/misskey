<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：二维码识别结果 · 文本展示。
作用：将既有扫描文本分别呈现为 MFM 与原始文本，保留链接预览及复制能力。
数据链角色：qr.read 的已识别字符串 → 只读 MFM / 链接投影 → 当前结果的临时展示页签。
Twitter 变体使用设计 Token 与原生可访问控件；默认 UI 保留 MkFolder、MkTabs 和 MkCode。
-->

<template>
<details v-if="isTwitterUi" :class="$style.twitter" open data-testid="qr-raw-result">
	<summary :id="`${viewerId}-title`" :class="$style.summary">
		<span :class="$style.summaryText">{{ firstLine }}</span>
		<i class="ti ti-chevron-down" :class="$style.chevron" aria-hidden="true"></i>
	</summary>
	<div :class="$style.tabs" role="tablist" :aria-labelledby="`${viewerId}-title`">
		<button
			:id="`${viewerId}-mfm`" ref="mfmTabEl" type="button" class="_button"
			:class="[$style.tab, { [$style.selected]: tab === 'mfm' }]"
			role="tab" :aria-selected="tab === 'mfm'" :aria-controls="`${viewerId}-panel`" :tabindex="tab === 'mfm' ? 0 : -1"
			@click="showMfm" @keydown="onTabKeydown"
		>
			<i class="ti ti-align-left" aria-hidden="true"></i>{{ i18n.ts._qr.mfm }}
		</button>
		<button
			:id="`${viewerId}-raw`" ref="rawTabEl" type="button" class="_button"
			:class="[$style.tab, { [$style.selected]: tab === 'raw' }]"
			role="tab" :aria-selected="tab === 'raw'" :aria-controls="`${viewerId}-panel`" :tabindex="tab === 'raw' ? 0 : -1"
			@click="showRaw" @keydown="onTabKeydown"
		>
			<i class="ti ti-code" aria-hidden="true"></i>{{ i18n.ts._qr.raw }}
		</button>
	</div>
	<div :id="`${viewerId}-panel`" :class="$style.panel" role="tabpanel" :aria-labelledby="`${viewerId}-${tab}`" tabindex="0">
		<div v-show="tab === 'mfm'" :class="$style.preview">
			<Mfm :text="data" :nyaize="false"/>
			<MkUrlPreview v-for="url in urls" :key="url" :url="url" :compact="true" :detail="false"/>
		</div>
		<div v-show="tab === 'raw'" :class="$style.raw">
			<button v-tooltip="i18n.ts.copyContent" type="button" class="_button" :class="$style.copy" :aria-label="i18n.ts.copyContent" @click="copyRaw">
				<i class="ti ti-copy" aria-hidden="true"></i>{{ i18n.ts.copy }}
			</button>
			<pre class="_selectable" :class="$style.text" data-testid="qr-raw-text">{{ data }}</pre>
		</div>
	</div>
</details>
<MkFolder v-else defaultOpen :withSpacer="false">
	<template #label>{{ firstLine }}</template>
	<template #header>
		<MkTabs
			v-model:tab="tab"
			:tabs="[
				{
					key: 'mfm',
					title: i18n.ts._qr.mfm,
					icon: 'ti ti-align-left',
				},
				{
					key: 'raw',
					title: i18n.ts._qr.raw,
					icon: 'ti ti-code',
				},
			]"
		/>
	</template>

	<div v-show="tab === 'mfm'" class="_spacer _gaps">
		<Mfm :text="data" :nyaize="false"/>
		<MkUrlPreview v-for="url in urls" :key="url" :url="url" :compact="true" :detail="false"/>
	</div>
	<div v-show="tab === 'raw'" class="_spacer" style="--MI_SPACER-min: 10px; --MI_SPACER-max: 16px;">
		<MkCode :code="data" lang="text"/>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { ref, computed, useId, useTemplateRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import * as mfm from 'mfm-js';
import MkFolder from '@/components/MkFolder.vue';
import MkTabs from '@/components/MkTabs.vue';
import { extractUrlFromMfm } from '@/utility/extract-url-from-mfm.js';
import MkCode from '@/components/MkCode.vue';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import { i18n } from '@/i18n.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';
import * as os from '@/os.js';

const props = defineProps<{
	/** 已识别的原始文本，视图不修改扫描结果。 */
	data: string;
}>();

const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const tab: Ref<'mfm' | 'raw'> = ref('mfm');
const viewerId: string = useId();
const mfmTabEl: Readonly<ShallowRef<HTMLButtonElement | null>> = useTemplateRef<HTMLButtonElement>('mfmTabEl');
const rawTabEl: Readonly<ShallowRef<HTMLButtonElement | null>> = useTemplateRef<HTMLButtonElement>('rawTabEl');

/** 首行继续作为单条扫描结果的折叠标题。 */
const firstLine: ComputedRef<string> = computed(
	/** 从只读结果文本取标题，不改变正文内容。 */
	(): string => props.data.split('\n', 1)[0] ?? '',
);
/** 保留既有 MFM 解析，供链接预览提取使用。 */
const parsed: ComputedRef<mfm.MfmNode[]> = computed(
	/** 将扫描文本交给既有 MFM 解析器。 */
	(): mfm.MfmNode[] => mfm.parse(props.data),
);
/** 沿用原链接去重与静默链接规则。 */
const urls: ComputedRef<string[]> = computed(
	/** 从已解析的 MFM 节点派生当前结果的链接预览列表。 */
	(): string[] => extractUrlFromMfm(parsed.value),
);

/** 切换当前结果的临时视图为 MFM。 */
function showMfm(): void {
	tab.value = 'mfm';
}

/** 切换当前结果的临时视图为完整原始文本。 */
function showRaw(): void {
	tab.value = 'raw';
}

/** 支持水平页签键盘导航，选中页签与焦点始终同步。 */
function onTabKeydown(event: KeyboardEvent): void {
	if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
	event.preventDefault();
	if (event.key === 'Home') {
		showMfm();
	} else if (event.key === 'End') {
		showRaw();
	} else {
		tab.value = tab.value === 'mfm' ? 'raw' : 'mfm';
	}
	if (tab.value === 'mfm') {
		mfmTabEl.value?.focus();
	} else {
		rawTabEl.value?.focus();
	}
}

/** 复制完整原始内容，实际写入成功后才提示完成，并消费浏览器的操作失败。 */
async function copyRaw(): Promise<void> {
	try {
		await navigator.clipboard.writeText(props.data);
		os.toast(i18n.ts.copiedToClipboard);
	} catch {
		await os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	}
}
</script>

<style lang="scss" module>
.twitter {
	min-width: 0;
	border: 1px solid var(--twitter-border);
	border-radius: var(--twitter-radius-large);
	background: var(--twitter-panel);
	color: var(--twitter-fg);
}

.summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--twitter-space-3);
	box-sizing: border-box;
	min-height: var(--twitter-touch-target);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-radius: var(--twitter-radius-large);
	font-size: var(--twitter-font-size-body);
	font-weight: 700;
	list-style: none;
	cursor: pointer;

	&::-webkit-details-marker {
		display: none;
	}

	&:hover {
		background: var(--twitter-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.summaryText {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chevron {
	flex-shrink: 0;
	color: var(--twitter-secondary-fg);
	transition: transform var(--twitter-duration-fast) ease;

	.twitter[open] & {
		transform: rotate(180deg);
	}
}

.tabs {
	display: flex;
	border-top: 1px solid var(--twitter-border);
	border-bottom: 1px solid var(--twitter-border);
}

.tab {
	position: relative;
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-2);
	min-width: 0;
	min-height: var(--twitter-touch-target);
	padding: var(--twitter-space-2) var(--twitter-space-3);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);
	font-weight: 600;

	&:hover {
		background: var(--twitter-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}

	&.selected {
		color: var(--twitter-fg);
		font-weight: 800;

		&::after {
			content: '';
			position: absolute;
			inset: auto var(--twitter-space-4) 0;
			height: var(--twitter-space-1);
			border-radius: var(--twitter-radius-pill);
			background: var(--twitter-accent);
		}
	}
}

.panel {
	min-width: 0;
	padding: var(--twitter-space-4);

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: -2px;
	}
}

.preview {
	display: flex;
	flex-direction: column;
	gap: var(--twitter-space-4);
	min-width: 0;
	overflow-wrap: anywhere;
}

.raw {
	display: flex;
	flex-direction: column;
	gap: var(--twitter-space-2);
	min-width: 0;
}

.copy {
	align-self: flex-end;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-2);
	min-height: var(--twitter-touch-target);
	padding: var(--twitter-space-2) var(--twitter-space-3);
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-secondary-fg);
	font-size: var(--twitter-font-size-meta);

	&:hover {
		background: var(--twitter-hover);
		color: var(--twitter-fg);
	}

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
}

.text {
	box-sizing: border-box;
	max-width: 100%;
	margin: 0;
	padding: var(--twitter-space-3);
	border: 1px solid var(--twitter-border);
	border-radius: var(--twitter-radius-medium);
	background: var(--twitter-hover);
	color: var(--twitter-fg);
	font-family: ui-monospace, Consolas, monospace;
	font-size: var(--twitter-font-size-meta);
	line-height: 1.6;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
</style>
