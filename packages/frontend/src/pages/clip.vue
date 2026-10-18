<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：保留的 Clip 实体和成员集合。
作用：在原命令成功后更新原数据源，回访仍保留当前显示上下文。
数据链：命令确认 → 原分页器／实体 → 只读组件；不写入第二份业务事实。
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div v-if="clip" class="_gaps">
			<div class="_panel">
				<div class="_gaps_s" :class="$style.description">
					<div v-if="clip.description">
						<Mfm :text="clip.description" :isNote="false"/>
					</div>
					<div v-else>({{ i18n.ts.noDescription }})</div>
					<div>
						<MkButton v-if="favorited" v-tooltip="i18n.ts.unfavorite" asLike rounded primary @click="unfavorite()"><i class="ti ti-heart"></i><span v-if="clip.favoritedCount > 0" style="margin-left: 6px;">{{ clip.favoritedCount }}</span></MkButton>
						<MkButton v-else v-tooltip="i18n.ts.favorite" asLike rounded @click="favorite()"><i class="ti ti-heart"></i><span v-if="clip.favoritedCount > 0" style="margin-left: 6px;">{{ clip.favoritedCount }}</span></MkButton>
					</div>
				</div>
				<div :class="$style.user">
					<MkAvatar :user="clip.user" :class="$style.avatar" indicator link preview/> <MkUserName :user="clip.user" :nowrap="false"/>
				</div>
			</div>

			<MkNotesTimeline :paginator="paginator" :detail="true"/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import type { Ref } from 'vue';
import { onBeforeUnmount } from 'vue';
import { useGlobalEvent } from '@/events.js';
import { useTwitterRefresh, useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { computed, watch, provide, ref, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import { clipsCache } from '@/cache.js';
import { isSupportShare } from '@/utility/navigator.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { genEmbedCode } from '@/utility/get-embed-code.js';
import { assertServerContext, serverContext } from '@/server-context.js';
import { Paginator } from '@/utility/paginator.js';

// contextは非ログイン状態の情報しかないためログイン時は利用できない
const CTX_CLIP = !$i && assertServerContext(serverContext, 'clip') ? serverContext.clip : null;

const props = defineProps<{
	clipId: string,
}>();

const clip = ref<Misskey.entities.Clip | null>(CTX_CLIP);
const favorited = ref(false);
const paginator = markRaw(new Paginator('clips/notes', {
	limit: 10,
	canSearch: true,
	computedParams: computed(() => ({
		clipId: props.clipId,
	})),
}));

const isOwned = computed<boolean | null>(() => $i && clip.value && ($i.id === clip.value.userId));

/** 当前 Clip 实体请求归属，不建立第二个缓存。 */
let clipRequest: AbortController | null = null;
const clipLoading: Ref<boolean> = ref<boolean>(false);

/** 首拉及回访共用真实读取，成功回填，失败保留最后实体。 */
async function loadClip(): Promise<boolean> {
	const clipId: string = props.clipId;
	clipRequest?.abort();
	const request: AbortController = new AbortController();
	clipRequest = request;
	clipLoading.value = true;
	try {
		const fetched: Misskey.entities.Clip = await misskeyApi('clips/show', { clipId }, undefined, request.signal);
		if (request.signal.aborted || props.clipId !== clipId || clipRequest !== request) return false;
		clip.value = fetched;
		favorited.value = fetched.isFavorited ?? false;
		return true;
	} catch (error: unknown) {
		if (!request.signal.aborted) console.error(error);
		return false;
	} finally {
		if (clipRequest === request) { clipRequest = null; clipLoading.value = false; }
	}
}

watch(/** Clip 路由 ID 切换是实体范围切换。 */ (): string => props.clipId,
	/** 原匿名上下文仅可用于匹配的首次实体。 */ (): void => {
		clip.value = CTX_CLIP?.id === props.clipId ? CTX_CLIP : null;
		void loadClip();
	}, { immediate: true });
onBeforeUnmount(/** 取消独立实体请求。 */ (): void => { clipRequest?.abort(); });
const invalidateClip: () => void = useTwitterRefresh(/** 原实体读取。 */ async (): Promise<boolean> => loadClip(),
	{ busy: /** 尊重首拉。 */ (): boolean => clipLoading.value });
const invalidateClipNotes: () => void = useTwitterPaginatorRefresh(/** 原成员集合。 */ (): typeof paginator => paginator);
useGlobalEvent('clipNotesChanged', /** 只有当前 Clip 的成员变化才重新确认。 */ (id: string): void => {
	if (id === props.clipId) { invalidateClip(); invalidateClipNotes(); }
});

provide('currentClip', clip);

function favorite() {
	os.apiWithDialog('clips/favorite', {
		clipId: props.clipId,
	}).then(() => {
		favorited.value = true;
	});
}

async function unfavorite() {
	const confirm = await os.confirm({
		type: 'warning',
		text: i18n.ts.unfavoriteConfirm,
	});
	if (confirm.canceled) return;
	os.apiWithDialog('clips/unfavorite', {
		clipId: props.clipId,
	}).then(() => {
		favorited.value = false;
	});
}

const headerActions = computed<PageHeaderItem[] | null>(() => clip.value && isOwned.value ? [{
	icon: 'ti ti-pencil',
	text: i18n.ts.edit,
	handler: async (): Promise<void> => {
		if (clip.value == null) return;

		const editedClipId: string = clip.value.id;
		const { canceled, result } = await os.form(clip.value.name, {
			name: {
				type: 'string',
				label: i18n.ts.name,
				default: clip.value.name,
			},
			description: {
				type: 'string',
				required: false,
				multiline: true,
				treatAsMfm: true,
				label: i18n.ts.description,
				default: clip.value.description,
			},
			isPublic: {
				type: 'boolean',
				label: i18n.ts.public,
				default: clip.value.isPublic,
			},
		});

		if (canceled) return;

		await os.apiWithDialog('clips/update', {
			clipId: editedClipId,
			...result,
		}).then(
			/** 保存真实成功后才失效，不能更新已切换的其他 Clip。 */ (): void => {
				clipsCache.delete();
				if (props.clipId === editedClipId) invalidateClip();
			},
			/** 原对话框已呈现拒绝，保留最后确认的 Clip 实体。 */ (): void => {},
		);
	},
}, ...(clip.value.isPublic ? [{
	icon: 'ti ti-share',
	text: i18n.ts.share,
	handler: (ev): void => {
		const menuItems: MenuItem[] = [];

		menuItems.push({
			icon: 'ti ti-link',
			text: i18n.ts.copyUrl,
			action: () => {
				copyToClipboard(`${url}/clips/${clip.value!.id}`);
			},
		}, {
			icon: 'ti ti-code',
			text: i18n.ts.embed,
			action: () => {
				genEmbedCode('clips', clip.value!.id);
			},
		});

		if (isSupportShare()) {
			menuItems.push({
				icon: 'ti ti-share',
				text: i18n.ts.share,
				action: async () => {
					navigator.share({
						title: clip.value!.name,
						text: clip.value!.description ?? '',
						url: `${url}/clips/${clip.value!.id}`,
					});
				},
			});
		}

		os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
	},
}] satisfies PageHeaderItem[] : []), {
	icon: 'ti ti-trash',
	text: i18n.ts.delete,
	danger: true,
	handler: async (): Promise<void> => {
		if (clip.value == null) return;

		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.tsx.deleteAreYouSure({ x: clip.value.name }),
		});
		if (canceled) return;

		await os.apiWithDialog('clips/delete', {
			clipId: clip.value.id,
		});

		clipsCache.delete();
	},
}] satisfies PageHeaderItem[] : null);

definePage(() => ({
	title: clip.value ? clip.value.name : i18n.ts.clip,
	icon: 'ti ti-paperclip',
}));
</script>

<style lang="scss" module>
.description {
	padding: 16px;
}

.user {
	--height: 32px;
	padding: 16px;
	border-top: solid 0.5px var(--MI_THEME-divider);
	line-height: var(--height);
}

.avatar {
	width: var(--height);
	height: var(--height);
}
</style>
