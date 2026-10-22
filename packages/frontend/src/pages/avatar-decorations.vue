<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：实例管理 · 头像挂件目录。
作用：复用 Twitter 设置页壳，编排目录加载、分类展示及新增／编辑／删除命令。
数据链：管理 API → 本页唯一目录 → 只读分类视图；弹窗草稿 → 写入回执 → 重新读取目录。
目录沿用原页面的数据归属，不引入第二份 Store；请求与弹窗句柄仅用于生命周期控制。
-->

<template>
<component :is="isTwitterUi ? TwitterSettingsShell : 'PageWithHeader'" v-bind="isTwitterUi ? { title: i18n.ts._avatarDecorationManager.title } : {}">
	<div :class="[$style.root, { [$style.twitter]: isTwitterUi }]" data-testid="avatar-decoration-manager">
		<template v-if="canManage">
			<div :class="$style.toolbar">
				<div :class="$style.summary">
					<p>{{ i18n.ts._avatarDecorationManager.intro }}</p>
					<span v-if="hasLoaded" :class="$style.count" data-testid="decoration-manager-count">{{ i18n.tsx._avatarDecorationManager.count({ count: avatarDecorations.length }) }}</span>
				</div>
				<div :class="$style.actions">
					<button type="button" class="_button" :class="$style.action" :disabled="loading || saving" data-testid="decoration-manager-refresh" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i> {{ i18n.ts.reload }}</button>
					<button type="button" class="_button" :class="[$style.action, $style.primary]" :disabled="saving" data-testid="decoration-manager-add" @click="openEditor()"><i class="ti ti-plus" aria-hidden="true"></i> {{ i18n.ts.add }}</button>
				</div>
			</div>

			<p v-if="pageMessage" :class="$style.message" role="status" data-testid="decoration-manager-feedback">{{ pageMessage }}</p>
			<div :aria-busy="loading" data-testid="decoration-manager-directory">
				<div v-if="loading && !hasLoaded" :class="$style.state" role="status" data-testid="decoration-manager-loading"><MkLoading/><p>{{ i18n.ts.loading }}</p></div>
				<div v-else-if="loadFailed && !hasLoaded" :class="$style.state" role="status" data-testid="decoration-manager-error">
					<i class="ti ti-alert-circle" :class="$style.stateIcon" aria-hidden="true"></i>
					<h2>{{ i18n.ts._avatarDecorationManager.loadFailed }}</h2>
					<p>{{ i18n.ts._avatarDecorationManager.loadFailedDescription }}</p>
					<button type="button" class="_button" :class="$style.action" :disabled="loading" @click="refresh">{{ i18n.ts.retry }}</button>
				</div>
				<template v-else-if="hasLoaded">
					<p v-if="loadFailed && !pageMessage" :class="$style.message" role="status" data-testid="decoration-manager-refresh-error">{{ i18n.ts._avatarDecorationManager.refreshFailed }}</p>
					<div v-if="avatarDecorations.length === 0" :class="$style.state" role="status" data-testid="decoration-manager-empty">
						<i class="ti ti-sparkles" :class="$style.stateIcon" aria-hidden="true"></i>
						<h2>{{ i18n.ts._avatarDecorationManager.empty }}</h2>
						<p>{{ i18n.ts._avatarDecorationManager.emptyDescription }}</p>
					</div>
					<section v-for="[category, decorations] in groupedDecorations" :key="category" :class="$style.category">
						<h2>{{ category || i18n.ts.other }} <span :class="$style.count">{{ decorations.length }}</span></h2>
						<div :class="$style.decorations">
							<button
								v-for="decoration in decorations"
								:key="decoration.id"
								type="button"
								class="_button"
								:class="$style.decoration"
								:disabled="saving"
								data-testid="decoration-manager-card"
								:data-decoration-id="decoration.id"
								@click="openEditor(decoration)"
							>
								<div :class="$style.preview">
									<TwitterAvatar v-if="isTwitterUi" :class="$style.avatar" :user="$i" :link="false" :decorations="[{ url: decoration.url }]" decorationContext="note" forceShowDecoration/>
									<MkAvatar v-else :class="$style.avatar" :user="$i" :link="false" :decorations="[{ url: decoration.url }]" forceShowDecoration/>
								</div>
								<strong :class="$style.decorationName">{{ decoration.name }}</strong>
								<span :class="$style.count">{{ decoration.roleIdsThatCanBeUsedThisDecoration.length === 0 ? i18n.ts._avatarDecorationManager.allRoles : i18n.tsx._avatarDecorationManager.roleCount({ count: decoration.roleIdsThatCanBeUsedThisDecoration.length }) }}</span>
							</button>
						</div>
					</section>
				</template>
			</div>
		</template>
		<div v-else :class="$style.state" role="status"><h2>{{ i18n.ts._avatarDecorationManager.permissionDenied }}</h2></div>
	</div>
</component>
</template>

<script lang="ts" setup>
import { shallowRef, ref, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue';
import type { ShallowRef, Ref, ComputedRef } from 'vue';
import type * as Misskey from 'misskey-js';
import XEditor from './avatar-decoration-edit-dialog.vue';
import { ensureSignin, $i as currentAccount } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { updateCurrentAccountPartial } from '@/accounts.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import type { PageMetadata } from '@/page.js';
import { TwitterAvatar, TwitterSettingsShell } from '@/ui/twitter/index.js';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';

/** 账号与管理策略沿用现有入口的权威来源，后端仍执行每次操作的权限校验。 */
const $i: ReturnType<typeof ensureSignin> = ensureSignin();
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const canManage: ComputedRef<boolean> = computed(/** 管理许可不由目录是否为空推断。 */ (): boolean => $i.isAdmin || $i.policies.canManageAvatarDecorations);
const avatarDecorations: ShallowRef<Misskey.entities.AdminAvatarDecorationsListResponse> = shallowRef([]);
const loading: Ref<boolean> = ref(false);
const hasLoaded: Ref<boolean> = ref(false);
const loadFailed: Ref<boolean> = ref(false);
const saving: Ref<boolean> = ref(false);
const pageMessage: Ref<string | null> = ref(null);
const groupedDecorations: ComputedRef<Map<string, Misskey.entities.AdminAvatarDecorationsListResponse>> = computed(
	/** 分类只读派生；Map 允许任意分类文本，不将名称解释为对象原型属性。 */
	(): Map<string, Misskey.entities.AdminAvatarDecorationsListResponse> => {
		const groups: Map<string, Misskey.entities.AdminAvatarDecorationsListResponse> = new Map();
		for (const decoration of avatarDecorations.value) {
			const category: string = decoration.category ?? '';
			const group: Misskey.entities.AdminAvatarDecorationsListResponse = groups.get(category) ?? [];
			group.push(decoration);
			groups.set(category, group);
		}
		return groups;
	},
);
let request: AbortController | null = null;
let active: boolean = false;
let disposed: boolean = false;
let disposeDialog: (() => void) | null = null;

/** 先撤销读取身份再中止传输，已排队的旧响应也不能写回目录。 */
function invalidateRead(): void {
	const previous: AbortController | null = request;
	request = null;
	previous?.abort();
	loading.value = false;
}

/** 首拉、刷新与回访共用读取边界；刷新失败保留已确认目录。 */
async function loadDirectory(): Promise<boolean> {
	if (!active || disposed || !canManage.value || currentAccount !== $i) return false;
	invalidateRead();
	const current: AbortController = new AbortController();
	request = current;
	loading.value = true;
	loadFailed.value = false;
	try {
		const result: Misskey.entities.AdminAvatarDecorationsListResponse = await misskeyApi('admin/avatar-decorations/list', {}, $i.token, current.signal);
		if (request !== current || !active || currentAccount !== $i) return false;
		avatarDecorations.value = result;
		hasLoaded.value = true;
		return true;
	} catch (error: unknown) {
		if (request === current && !current.signal.aborted && active) loadFailed.value = true;
		return false;
	} finally {
		if (request === current) {
			request = null;
			loading.value = false;
		}
	}
}

/** 从服务端读取最新佩戴投影；离开管理页后仍可完成已保存素材的账户刷新。 */
async function refreshWornAccount(): Promise<boolean> {
	const accountId: string = $i.id;
	const token: string = $i.token;
	if (currentAccount !== $i) return false;
	const appearance: string = JSON.stringify($i.avatarDecorations);
	try {
		const confirmed: Misskey.entities.MeDetailed = await misskeyApi('i', {}, token);
		if (currentAccount !== $i || currentAccount.id !== accountId || currentAccount.token !== token || confirmed.id !== accountId) return false;
		// 后到的读取不可覆盖其间已经确认的新佩戴或图片投影。
		if (JSON.stringify($i.avatarDecorations) !== appearance) return true;
		updateCurrentAccountPartial({ avatarDecorations: confirmed.avatarDecorations });
		return true;
	} catch (error: unknown) {
		return false;
	}
}

/** 用户主动刷新目录及当前佩戴图片；失败保留原事实，并提供可重复使用的重试入口。 */
async function refresh(): Promise<void> {
	if (loading.value || saving.value) return;
	pageMessage.value = null;
	await loadDirectory();
	const refreshed: boolean = $i.avatarDecorations.length === 0 || await refreshWornAccount();
	if (!refreshed && active && !disposed && currentAccount === $i) pageMessage.value = i18n.ts._avatarDecorationManager.accountRefreshFailed;
}

/** 所有写命令复用执行边界；写成功与后续读取失败分别提示，避免重复提交。 */
async function write(command: () => Promise<void>, deleted: boolean = false, decorationId?: string): Promise<void> {
	if (!active || disposed || saving.value || !canManage.value || currentAccount !== $i) throw new Error(i18n.ts._avatarDecorationManager.changedElsewhere);
	saving.value = true;
	pageMessage.value = null;
	invalidateRead();
	const refreshAccount: boolean = decorationId !== undefined && $i.avatarDecorations.some(
		/** 仅已佩戴的目录实体变更需要重新读取账户，目录草稿不参与账户事实。 */
		(decoration: Misskey.entities.MeDetailed['avatarDecorations'][number]): boolean => decoration.id === decorationId,
	);
	try {
		await command();
		const accountRefreshed: boolean = !refreshAccount || await refreshWornAccount();
		if (!active || disposed || currentAccount !== $i) return;
		const refreshed: boolean = await loadDirectory();
		if (!active || disposed || currentAccount !== $i) return;
		pageMessage.value = !accountRefreshed
			? i18n.ts._avatarDecorationManager.accountRefreshFailed
			: refreshed
			? (deleted ? i18n.ts._avatarDecorationManager.deleted : i18n.ts._avatarDecorationManager.saved)
			: (deleted ? i18n.ts._avatarDecorationManager.deletedRefreshFailed : i18n.ts._avatarDecorationManager.savedRefreshFailed);
	} catch (error: unknown) {
		// 写入可能打断首拉；失败仍恢复目录读取，避免关闭草稿后只剩空白区域。
		if (!hasLoaded.value && active && !disposed) void loadDirectory();
		throw error;
	} finally {
		saving.value = false;
	}
}

/** 弹窗只编辑草稿；父页绑定不可编辑的实体 ID，update 无实体回执时重新读取。 */
function openEditor(decoration?: Misskey.entities.AdminAvatarDecorationsListResponse[number]): void {
	if (!active || disposed || saving.value || disposeDialog || !canManage.value) return;
	const selectedId: string | undefined = decoration?.id;
	const popup: ReturnType<typeof os.popup> = os.popup(XEditor, {
		avatarDecoration: decoration,
		categories: Array.from(groupedDecorations.value.keys()),
		/** 创建使用后端完整实体，编辑不以请求参数伪造服务端回执。 */
		submit: async (draft: Misskey.Endpoints['admin/avatar-decorations/create']['req']): Promise<void> => write(
			/** 回执到达前不修改目录；旧读请求已在统一写入入口失效。 */
			async (): Promise<void> => {
				if (selectedId !== undefined) {
					await misskeyApi('admin/avatar-decorations/update', { ...draft, id: selectedId }, $i.token);
				} else {
					const created: Misskey.entities.AdminAvatarDecorationsListResponse[number] = await misskeyApi('admin/avatar-decorations/create', draft, $i.token);
					if (active && !disposed && currentAccount === $i) avatarDecorations.value = [created, ...avatarDecorations.value];
				}
			}, false, selectedId,
		),
		/** 删除只针对打开时的实体；成功回执后立即移除，随后重读确认目录。 */
		remove: selectedId === undefined ? undefined : async (): Promise<void> => write(
			/** 不把表单名称或草稿当作删除身份。 */
			async (): Promise<void> => {
				await misskeyApi('admin/avatar-decorations/delete', { id: selectedId }, $i.token);
				if (active && !disposed && currentAccount === $i) avatarDecorations.value = avatarDecorations.value.filter(/** 保留其他已确认实体。 */ (item: Misskey.entities.AdminAvatarDecorationsListResponse[number]): boolean => item.id !== selectedId);
			}, true, selectedId,
		),
	}, {
		/** 释放弹窗句柄后才允许再次打开，避免叠加多份草稿。 */
		closed: (): void => { popup.dispose(); if (disposeDialog === popup.dispose) disposeDialog = null; },
	});
	disposeDialog = popup.dispose;
}

/** 首次挂载与激活合并；后续回访重新获取包括空目录在内的最新事实。 */
function activate(): void {
	if (active || disposed) return;
	active = true;
	pageMessage.value = null;
	void loadDirectory();
}

/** 离开时取消读取及局部弹窗；已发出的写请求仍等待后端完成。 */
function deactivate(): void {
	active = false;
	invalidateRead();
	disposeDialog?.();
	disposeDialog = null;
}

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(/** 永久释放页面，不让旧请求写入后续页面。 */ (): void => { disposed = true; deactivate(); });
definePage(/** 两个现有路由共享同一管理标题与业务实现。 */ (): PageMetadata => ({ title: i18n.ts._avatarDecorationManager.title, icon: 'ti ti-sparkles' }));
</script>

<style lang="scss" module>
.root {
	box-sizing: border-box;
	min-width: 0;
	min-height: 100%;
	padding: var(--twitter-space-4, 16px);
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);
	font-size: var(--twitter-font-size-body, 14px);
	h2, p { margin: 0; }
	h2 { font-size: var(--twitter-font-size-emphasis, 16px); }
	button:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 3px; }
	button:disabled { cursor: not-allowed; opacity: 0.5; }
}
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--twitter-space-3, 12px); padding-bottom: var(--twitter-space-4, 16px); border-bottom: 1px solid var(--twitter-border, var(--MI_THEME-divider)); }
.summary { flex: 1 1 200px; display: grid; gap: var(--twitter-space-2, 8px); line-height: 1.6; }
.count { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); font-weight: 400; }
.actions { display: flex; gap: var(--twitter-space-2, 8px); }
.action { display: inline-flex; align-items: center; justify-content: center; gap: var(--twitter-space-1, 4px); min-height: var(--twitter-touch-target, 44px); padding: 0 var(--twitter-space-4, 16px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-pill, 999px); font-weight: 700; white-space: nowrap; }
.action:hover:not(:disabled) { background: var(--twitter-hover, var(--MI_THEME-buttonHoverBg)); }
.primary { border-color: transparent; background: var(--twitter-accent, var(--MI_THEME-accent)); color: var(--twitter-fg-on-accent, var(--MI_THEME-fgOnAccent)); }
.primary:hover:not(:disabled) { background: var(--twitter-accent-hover, var(--MI_THEME-accentDarken)); }
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--twitter-space-3, 12px); min-height: 240px; padding: var(--twitter-space-6, 32px) var(--twitter-space-4, 16px); text-align: center; line-height: 1.6; }
.state p { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); }
.stateIcon { color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-display, 24px); }
.message { margin-top: var(--twitter-space-4, 16px) !important; padding: var(--twitter-space-3, 12px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-medium, 8px); background: var(--twitter-hover, var(--MI_THEME-panel)); line-height: 1.6; }
.category { margin-top: var(--twitter-space-4, 16px); }
.category h2 { display: flex; align-items: baseline; gap: var(--twitter-space-2, 8px); margin-bottom: var(--twitter-space-3, 12px); overflow-wrap: anywhere; }
.decorations { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--twitter-decoration-card-min, 140px)), 1fr)); gap: var(--twitter-space-3, 12px); }
.decoration { display: grid; justify-items: center; align-content: start; gap: var(--twitter-space-2, 8px); min-width: 0; padding: var(--twitter-space-3, 12px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-medium, 8px); background: var(--twitter-panel, var(--MI_THEME-panel)); text-align: center; }
.decoration:hover:not(:disabled) { border-color: var(--twitter-accent, var(--MI_THEME-accent)); background: var(--twitter-hover, var(--MI_THEME-panelHighlight)); }
.preview { display: grid; place-items: center; width: 100%; height: calc(var(--twitter-decoration-card-avatar-size, 60px) * 2); pointer-events: none; }
.avatar { width: var(--twitter-decoration-card-avatar-size, 60px); height: var(--twitter-decoration-card-avatar-size, 60px); }
.decorationName { max-width: 100%; line-height: 1.5; overflow-wrap: anywhere; }
.twitter { background: var(--twitter-bg); color: var(--twitter-fg);
	.avatar { width: var(--twitter-avatar-note-size); height: var(--twitter-avatar-note-size); }
}
</style>
