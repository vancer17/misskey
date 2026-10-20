<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：账户设置 · 头像挂件业务页。
作用：编排目录读取、当前佩戴展示、试戴入口及已确认写入；Twitter 分支只影响呈现。
数据链：目录 API → 分类视图；账户单例 → 当前预览；编辑命令 → i/update 回执 → 既有账户更新入口。
目录属于原设置页的数据归属，临时加载／提交状态不成为第二份账户事实；不包含运维探测。
-->

<template>
<SearchMarker path="/settings/avatar-decoration" :label="i18n.ts.avatarDecorations" :keywords="['avatar', 'icon', 'decoration']" icon="ti ti-sparkles">
	<div :class="[$style.root, { [$style.twitter]: isTwitterUi, [$style.mobile]: isMobile }]" data-testid="avatar-decoration-page">
		<section :class="$style.summary" :aria-label="i18n.ts._avatarDecorationSettings.currentAvatar">
			<div :class="$style.avatarStage" data-testid="decoration-current-avatar">
				<MkAvatar :class="$style.avatar" :user="$i" forceShowDecoration/>
			</div>
			<div :class="$style.summaryText">
				<h2>{{ i18n.ts._avatarDecorationSettings.currentAvatar }}</h2>
				<p :class="$style.count" data-testid="decoration-count">{{ i18n.tsx._avatarDecorationSettings.wearingCount({ count: $i.avatarDecorations.length, max: $i.policies.avatarDecorationLimit }) }}</p>
				<p :class="$style.secondary">{{ i18n.ts._avatarDecorationSettings.intro }}</p>
			</div>
		</section>

		<section v-if="$i.avatarDecorations.length > 0" :class="$style.section" data-testid="decoration-wearing">
			<div :class="$style.sectionHeading">
				<h2>{{ i18n.ts._avatarDecorationSettings.wearing }}</h2>
				<button type="button" class="_textButton" :class="$style.danger" :disabled="saving || confirming" data-testid="decoration-remove-all" @click="removeDecoration(null)">{{ i18n.ts.detachAll }}</button>
			</div>
			<p v-if="$i.avatarDecorations.length > $i.policies.avatarDecorationLimit" :class="$style.warning" role="status">{{ i18n.ts._avatarDecorationSettings.overLimit }}</p>
			<div :class="$style.wearingList">
				<div v-for="(worn, index) in $i.avatarDecorations" :key="`${index}:${worn.id}`" :class="$style.wearingRow" data-testid="decoration-wearing-row">
					<div :class="$style.wearingPreview"><MkAvatar :class="$style.wearingAvatar" :user="$i" :decorations="[worn]" forceShowDecoration/></div>
					<div :class="$style.wearingLabel">
						<strong>{{ catalogById.get(worn.id)?.name ?? (hasLoaded ? i18n.ts._avatarDecorationSettings.unavailable : i18n.ts._avatarDecorationSettings.directoryPending) }}</strong>
						<span v-if="hasLoaded && !catalogById.has(worn.id)" :class="$style.secondary">{{ i18n.ts._avatarDecorationSettings.unavailableDescription }}</span>
					</div>
					<div :class="$style.rowActions">
						<button type="button" class="_textButton" :disabled="saving || confirming || !catalogById.has(worn.id)" data-testid="decoration-adjust" @click="openAttachedDecoration(index)">{{ i18n.ts._avatarDecorationSettings.adjust }}</button>
						<button type="button" class="_textButton" :class="$style.danger" :disabled="saving || confirming" data-testid="decoration-remove" @click="removeDecoration(index)">{{ i18n.ts.detach }}</button>
					</div>
				</div>
			</div>
		</section>

		<section :class="$style.section" :aria-busy="loading" data-testid="decoration-directory">
			<div :class="$style.sectionHeading">
				<h2>{{ i18n.ts._avatarDecorationSettings.choose }} <span v-if="hasLoaded" :class="$style.directoryCount">{{ avatarDecorations.length }}</span></h2>
				<button type="button" class="_textButton" :disabled="loading" data-testid="decoration-refresh" @click="loadDirectory"><i class="ti ti-refresh" aria-hidden="true"></i> {{ i18n.ts.reload }}</button>
			</div>
			<div v-if="loading && !hasLoaded" :class="$style.loading" role="status"><MkLoading/><span>{{ i18n.ts.loading }}</span></div>
			<template v-else-if="loadFailed && !hasLoaded">
				<TwitterPageState v-if="isTwitterUi" :class="$style.pageState" type="error" :title="i18n.ts._avatarDecorationSettings.loadFailed" :description="i18n.ts._avatarDecorationSettings.loadFailedDescription" @retry="loadDirectory"/>
				<div v-else :class="$style.pageState" role="status"><h3>{{ i18n.ts._avatarDecorationSettings.loadFailed }}</h3><p>{{ i18n.ts._avatarDecorationSettings.loadFailedDescription }}</p><MkButton @click="loadDirectory">{{ i18n.ts.retry }}</MkButton></div>
			</template>
			<template v-else-if="hasLoaded">
				<MkInfo v-if="loadFailed" warn data-testid="decoration-refresh-error">{{ i18n.ts._avatarDecorationSettings.refreshFailed }}</MkInfo>
				<div v-if="avatarDecorations.length === 0" data-testid="decoration-empty">
					<TwitterPageState v-if="isTwitterUi" :class="$style.pageState" type="empty" :title="i18n.ts._avatarDecorationSettings.empty" :description="canManage ? i18n.ts._avatarDecorationSettings.emptyForManager : i18n.ts._avatarDecorationSettings.emptyDescription"/>
					<div v-else :class="$style.pageState" role="status"><h3>{{ i18n.ts._avatarDecorationSettings.empty }}</h3><p>{{ canManage ? i18n.ts._avatarDecorationSettings.emptyForManager : i18n.ts._avatarDecorationSettings.emptyDescription }}</p></div>
				</div>
				<section v-for="[category, decorations] in groupedDecorations" :key="category" :class="$style.category">
					<h3>{{ category || i18n.ts.other }}</h3>
					<div :class="$style.decorations">
						<XDecoration v-for="decoration in decorations" :key="decoration.id" :decoration="decoration" :disabled="saving || confirming" @click="openDecoration(decoration)"/>
					</div>
				</section>
			</template>
			<div v-if="canManage" :class="$style.manage"><MkA to="/avatar-decorations" class="_link" data-testid="decoration-manage"><i class="ti ti-settings" aria-hidden="true"></i> {{ i18n.ts._avatarDecorationSettings.manage }}</MkA></div>
		</section>
		<p v-if="pageMessage" :class="$style.message" role="status" data-testid="decoration-page-message">{{ pageMessage }}</p>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { ref, shallowRef, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue';
import type { Ref, ShallowRef, ComputedRef } from 'vue';
import type * as Misskey from 'misskey-js';
import XDecoration from './avatar-decoration.decoration.vue';
import XDialog from './avatar-decoration.dialog.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { ensureSignin, $i as currentAccount } from '@/i.js';
import { definePage } from '@/page.js';
import type { PageMetadata } from '@/page.js';
import { updateCurrentAccountPartial } from '@/accounts.js';
import { serializeAvatarDecorations } from '@/utility/avatar-decoration/index.js';
import { useIsTwitterUi, useTwitterLayout, TwitterPageState } from '@/ui/twitter/index.js';

/** 账户唯一来源：不把已佩戴数组复制到页面业务状态。 */
const $i: ReturnType<typeof ensureSignin> = ensureSignin();
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const { isMobile } = useTwitterLayout();
const loading: Ref<boolean> = ref(false);
const hasLoaded: Ref<boolean> = ref(false);
const loadFailed: Ref<boolean> = ref(false);
const saving: Ref<boolean> = ref(false);
const confirming: Ref<boolean> = ref(false);
const pageMessage: Ref<string | null> = ref(null);
const avatarDecorations: ShallowRef<Misskey.entities.GetAvatarDecorationsResponse> = shallowRef([]);
const canManage: ComputedRef<boolean> = computed(/** 沿用现有管理入口权限，不作为挂件佩戴权限。 */ (): boolean => $i.isAdmin || $i.policies.canManageAvatarDecorations);
const catalogById: ComputedRef<Map<string, Misskey.entities.GetAvatarDecorationsResponse[number]>> = computed(
	/** 只读索引直接指向目录对象，不复制挂件事实。 */
	(): Map<string, Misskey.entities.GetAvatarDecorationsResponse[number]> => new Map(avatarDecorations.value.map(
		/** 以权威实体 ID 关联佩戴条目。 */
		(decoration: Misskey.entities.GetAvatarDecorationsResponse[number]): [string, Misskey.entities.GetAvatarDecorationsResponse[number]] => [decoration.id, decoration],
	)),
);
const groupedDecorations: ComputedRef<Map<string, Misskey.entities.GetAvatarDecorationsResponse>> = computed(
	/** Map 允许任意分类名称，不将分类文本解释为对象原型属性。 */
	(): Map<string, Misskey.entities.GetAvatarDecorationsResponse> => {
		const groups: Map<string, Misskey.entities.GetAvatarDecorationsResponse> = new Map();
		for (const decoration of avatarDecorations.value) {
			const category: string = decoration.category ?? '';
			const group: Misskey.entities.GetAvatarDecorationsResponse = groups.get(category) ?? [];
			group.push(decoration);
			groups.set(category, group);
		}
		return groups;
	},
);
/** 请求句柄及弹窗句柄只控制临时执行，不进入业务模型或运行配置。 */
let request: AbortController | null = null;
let active: boolean = false;
let disposed: boolean = false;
let disposeDialog: (() => void) | null = null;

/** 首拉、刷新及回访共用读取入口；失败保留上一次成功目录，迟到响应不可回写。 */
async function loadDirectory(): Promise<void> {
	if (!active || disposed || request !== null) return;
	const current: AbortController = new AbortController();
	request = current;
	loading.value = true;
	loadFailed.value = false;
	try {
		const result: Misskey.entities.GetAvatarDecorationsResponse = await misskeyApi('get-avatar-decorations', {}, undefined, current.signal);
		if (request !== current || !active) return;
		avatarDecorations.value = result;
		hasLoaded.value = true;
	} catch (error: unknown) {
		if (request === current && !current.signal.aborted) loadFailed.value = true;
	} finally {
		if (request === current) {
			request = null;
			loading.value = false;
		}
	}
}

/** 挂载与首次激活合并；后续回访始终重新确认目录，包括原先为空的情况。 */
function activate(): void {
	if (active || disposed) return;
	active = true;
	void loadDirectory();
}

/** 离开时取消目录读取并释放业务弹窗；已经发出的写入仍按回执完成账户同步。 */
function deactivate(): void {
	active = false;
	const previous: AbortController | null = request;
	request = null;
	previous?.abort();
	loading.value = false;
	disposeDialog?.();
	disposeDialog = null;
}

/** 以现有已佩戴事实产生局部并发校验标识，防止重复 ID 或索引变化后覆盖其他项。 */
function appearanceRevision(): string {
	return JSON.stringify(serializeAvatarDecorations($i.avatarDecorations));
}

/** 唯一写入入口：只发送 Schema 字段，只提交回执中的挂件事实，不覆盖并发编辑的其他资料。 */
async function saveDecorations(next: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>, expected: string): Promise<string | null> {
	if (disposed || !active || saving.value || currentAccount !== $i || appearanceRevision() !== expected) return i18n.ts._avatarDecorationSettings.changedElsewhere;
	const accountId: string = $i.id;
	const token: string = $i.token;
	const payload: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']> = serializeAvatarDecorations(next);
	saving.value = true;
	pageMessage.value = null;
	try {
		const saved: Misskey.entities.MeDetailed = await misskeyApi('i/update', { avatarDecorations: payload }, token);
		if (currentAccount?.id !== accountId || currentAccount.token !== token || saved.id !== accountId) return i18n.ts._avatarDecorationSettings.changedElsewhere;
		updateCurrentAccountPartial({ avatarDecorations: saved.avatarDecorations });
		if (JSON.stringify(serializeAvatarDecorations(saved.avatarDecorations)) !== JSON.stringify(payload)) {
			return i18n.ts._avatarDecorationSettings.adjustedByServer;
		}
		return null;
	} catch (error: unknown) {
		return i18n.ts._avatarDecorationSettings.saveFailed;
	} finally {
		saving.value = false;
	}
}

/** 缺少目录信息的已佩戴项只能移除，不构造空 ID 实体进入调整流程。 */
function openAttachedDecoration(index: number): void {
	const worn: Misskey.entities.MeDetailed['avatarDecorations'][number] | undefined = $i.avatarDecorations[index];
	const decoration: Misskey.entities.GetAvatarDecorationsResponse[number] | undefined = worn ? catalogById.value.get(worn.id) : undefined;
	if (decoration) openDecoration(decoration, index);
}

/** 试戴弹窗通过可等待命令提交；只在成功回填账户后关闭，失败保留草稿。 */
function openDecoration(decoration: Misskey.entities.GetAvatarDecorationsResponse[number], index: number | null = null): void {
	if (!active || saving.value || confirming.value || disposeDialog || disposed) return;
	const expected: string = appearanceRevision();
	const popup: ReturnType<typeof os.popup> = os.popup(XDialog, {
		decoration,
		usingIndex: index,
		/** 点击保存时基于当前账户构造变更；revision 仅用于拒绝过期编辑。 */
		submit: async (draft: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>[number] | null): Promise<string | null> => {
			const next: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']> = serializeAvatarDecorations($i.avatarDecorations);
			if (index === null) {
				if (draft === null) return i18n.ts._avatarDecorationSettings.changedElsewhere;
				next.push(draft);
			} else if (draft === null) {
				next.splice(index, 1);
			} else {
				next[index] = draft;
			}
			const error: string | null = await saveDecorations(next, expected);
			if (error === null && active) pageMessage.value = i18n.ts._avatarDecorationSettings.saved;
			return error;
		},
	}, {
		/** 关闭释放全局弹窗，不残留阻止下一次打开的句柄。 */
		closed: (): void => { popup.dispose(); if (disposeDialog === popup.dispose) disposeDialog = null; },
	});
	disposeDialog = popup.dispose;
}

/** 移除命令复用确认窗口和同一写入边界，目录失败或条目失效仍可使用。 */
async function removeDecoration(index: number | null): Promise<void> {
	if (!active || saving.value || confirming.value || disposed) return;
	const expected: string = appearanceRevision();
	const next: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']> = serializeAvatarDecorations($i.avatarDecorations);
	if (index !== null) next.splice(index, 1);
	else next.length = 0;
	confirming.value = true;
	try {
		const confirmation: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({ type: 'warning', text: index === null ? i18n.ts._avatarDecorationSettings.removeAllConfirm : i18n.ts._avatarDecorationSettings.removeConfirm });
		if (confirmation.canceled || !active) return;
		const error: string | null = await saveDecorations(next, expected);
		if (active) pageMessage.value = error ?? i18n.ts._avatarDecorationSettings.saved;
	} finally {
		confirming.value = false;
	}
}

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(/** 永久释放本页临时资源，不取消已发出的服务端写入事实。 */ (): void => { disposed = true; deactivate(); });
definePage(/** 沿用设置页宿主提供的标准返回头。 */ (): PageMetadata => ({ title: i18n.ts.avatarDecorations, icon: 'ti ti-sparkles' }));
</script>

<style lang="scss" module>
.root {
	padding: var(--twitter-space-4, 16px);
	color: var(--twitter-fg, var(--MI_THEME-fg));
	font-size: var(--twitter-font-size-body, 14px);
	min-width: 0;
	h2, h3, p { margin: 0; }
	h2 { font-size: var(--twitter-font-size-emphasis, 16px); }
	h3 { font-size: var(--twitter-font-size-body, 14px); }
	button:focus-visible, a:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 3px; }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
}
.summary { display: flex; align-items: center; gap: var(--twitter-space-4, 16px); }
.avatarStage { display: grid; place-items: center; width: calc(var(--twitter-decoration-avatar-size, 72px) * 2); min-height: calc(var(--twitter-decoration-avatar-size, 72px) * 2); flex-shrink: 0; }
.avatar { width: var(--twitter-decoration-avatar-size, 72px); height: var(--twitter-decoration-avatar-size, 72px); }
.summaryText { display: grid; gap: var(--twitter-space-2, 8px); min-width: 0; line-height: 1.6; }
.count { color: var(--twitter-accent, var(--MI_THEME-accent)); font-weight: 700; }
.secondary { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); line-height: 1.6; }
.section { margin-top: var(--twitter-space-4, 16px); padding-top: var(--twitter-space-4, 16px); border-top: 1px solid var(--twitter-border, var(--MI_THEME-divider)); }
.sectionHeading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--twitter-space-2, 8px); margin-bottom: var(--twitter-space-3, 12px); }
.sectionHeading button, .rowActions button { min-height: var(--twitter-touch-target, 44px); }
.directoryCount { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-weight: 400; font-size: var(--twitter-font-size-meta, 13px); }
.wearingList { display: grid; gap: var(--twitter-space-2, 8px); }
.wearingRow { display: flex; align-items: center; gap: var(--twitter-space-3, 12px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-medium, 8px); padding: var(--twitter-space-2, 8px); }
.wearingPreview { display: grid; place-items: center; flex: 0 0 calc(var(--twitter-decoration-avatar-size, 72px) * 1.5); height: calc(var(--twitter-decoration-avatar-size, 72px) * 1.5); }
.wearingAvatar { width: calc(var(--twitter-decoration-avatar-size, 72px) / 2); height: calc(var(--twitter-decoration-avatar-size, 72px) / 2); }
.wearingLabel { flex: 1; min-width: 0; display: grid; gap: var(--twitter-space-1, 4px); overflow-wrap: anywhere; }
.rowActions { display: flex; flex-wrap: wrap; gap: var(--twitter-space-3, 12px); }
.danger { color: var(--twitter-danger, var(--MI_THEME-error)); }
.warning { color: var(--twitter-warning, var(--MI_THEME-warn)); line-height: 1.6; margin-bottom: var(--twitter-space-3, 12px) !important; }
.category { margin-top: var(--twitter-space-4, 16px); }
.category h3 { margin-bottom: var(--twitter-space-3, 12px); overflow-wrap: anywhere; }
.decorations { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--twitter-decoration-card-min, 140px)), 1fr)); gap: var(--twitter-space-3, 12px); }
.loading { display: grid; justify-items: center; gap: var(--twitter-space-3, 12px); padding: var(--twitter-space-6, 32px); color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); }
.root .pageState { min-height: 0; padding: var(--twitter-space-6, 32px) var(--twitter-space-4, 16px); background: transparent; text-align: center; }
.manage { text-align: center; padding: var(--twitter-space-3, 12px) 0; }
.message { margin-top: var(--twitter-space-4, 16px) !important; padding: var(--twitter-space-3, 12px); border-radius: var(--twitter-radius-medium, 8px); background: var(--twitter-hover, var(--MI_THEME-panel)); line-height: 1.6; }
.twitter {
	background: var(--twitter-bg);
	:global(._textButton), :global(._link) { color: var(--twitter-accent); }
	.danger { color: var(--twitter-danger); }
}
.mobile {
	.summary { flex-direction: column; gap: 0; text-align: center; }
	.wearingRow { flex-wrap: wrap; }
	.rowActions { margin-left: auto; }
	.decorations { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
