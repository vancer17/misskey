<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：头像挂件管理 · 新增／编辑业务弹窗。
作用：复用模态窗口的正文滚动区和独立操作区，维护未保存表单与角色选择草稿。
数据链：管理页只读实体 → 局部草稿 → 可等待写入命令 → 管理页确认回执并刷新目录。
素材链：本地文件上传／网盘选择／手动地址 → 唯一 URL 草稿 → 双背景佩戴预览。
上传只准备素材；取消草稿不删除已上传文件，挂件目录仍由父页的写入回执确认。
角色 ID 是选择的唯一依据；角色展示信息加载失败不得改变待保存的可用角色。
-->

<template>
<MkModalWindow ref="dialog" :width="440" :height="620" :withCloseButton="!busy" @close="cancel" @click="cancel" @esc="cancel" @closed="emit('closed')">
	<template #header>{{ props.avatarDecoration ? i18n.ts._avatarDecorationManager.editTitle : i18n.ts._avatarDecorationManager.createTitle }}</template>
	<form :id="formId" :class="[$style.root, { [$style.twitter]: isTwitterUi }]" :aria-busy="busy" data-testid="decoration-manager-editor" @submit.prevent="save">
		<section :class="$style.material" :aria-labelledby="materialHeadingId">
			<h2 :id="materialHeadingId" :class="$style.sectionHeading">{{ i18n.ts._avatarDecorationManager.materialTitle }}</h2>
			<p :class="$style.hint">{{ i18n.ts._avatarDecorationManager.materialHint }}</p>
			<input ref="fileInput" type="file" accept="image/*" hidden :disabled="busy" :aria-label="i18n.ts._avatarDecorationManager.uploadMaterial" data-testid="decoration-manager-file-input" @change="uploadMaterial" @cancel="cancelFileSelection">
			<div :class="$style.materialActions">
				<MkButton primary rounded type="button" :disabled="busy" data-testid="decoration-manager-upload" @click="chooseLocalMaterial"><i class="ti ti-upload" aria-hidden="true"></i> {{ hasMaterial ? i18n.ts._avatarDecorationManager.replaceMaterial : i18n.ts._avatarDecorationManager.uploadMaterial }}</MkButton>
				<MkButton rounded type="button" :disabled="busy" data-testid="decoration-manager-drive" @click="chooseDriveMaterial"><i class="ti ti-cloud" aria-hidden="true"></i> {{ i18n.ts._avatarDecorationManager.chooseFromDrive }}</MkButton>
			</div>
			<div v-if="operation === 'uploading-material'" :class="$style.uploadState" role="status" data-testid="decoration-manager-material-status">
				<span>{{ i18n.ts._avatarDecorationManager.uploadingMaterial }}<span v-if="uploadProgress !== null"> {{ uploadProgress }}%</span></span>
				<progress :class="$style.uploadProgress" :value="uploadProgress ?? undefined" :max="100" :aria-label="i18n.ts._avatarDecorationManager.uploadingMaterial"></progress>
				<MkButton rounded type="button" data-testid="decoration-manager-upload-cancel" @click="cancelMaterialUpload">{{ i18n.ts._avatarDecorationManager.cancelUpload }}</MkButton>
			</div>
			<p v-else-if="materialStatus" :class="$style.notice" role="status" data-testid="decoration-manager-material-status">{{ materialStatus }}</p>
			<p v-if="materialError" :class="$style.error" role="alert" data-testid="decoration-manager-material-error">{{ materialError }}</p>
			<details :class="$style.urlDetails" data-testid="decoration-manager-url-toggle">
				<summary>{{ i18n.ts._avatarDecorationManager.useImageUrl }}</summary>
				<label :class="$style.field">
					<MkInput v-model="url" inputmode="url" autocapitalize="off" :spellcheck="false" :disabled="busy" data-testid="decoration-manager-url">
						<template #label>{{ i18n.ts.imageUrl }}</template>
					</MkInput>
				</label>
			</details>
		</section>
		<section :class="$style.previewSection" :aria-labelledby="previewHeadingId">
			<h2 :id="previewHeadingId" :class="$style.sectionHeading" data-testid="decoration-manager-preview-title">{{ i18n.ts._avatarDecorationManager.previewTitle }}</h2>
			<p :class="$style.hint">{{ i18n.ts._avatarDecorationManager.previewDescription }}</p>
			<p v-if="!hasMaterial" :class="$style.previewEmpty" role="status" data-testid="decoration-manager-preview-empty">{{ i18n.ts._avatarDecorationManager.previewEmpty }}</p>
			<div v-else :key="previewKey" :class="$style.preview" data-testid="decoration-manager-preview" @error.capture="onPreviewError">
				<section :class="[$style.previewItem, $style.light]" :aria-label="i18n.ts._avatarDecorationManager.lightPreview">
					<div :class="$style.previewCanvas"><MkAvatar :class="$style.avatar" :user="$i" :decorations="previewDecorations" :link="false" forceShowDecoration/></div>
					<p :class="$style.previewLabel">{{ i18n.ts._avatarDecorationManager.lightPreview }}</p>
				</section>
				<section :class="[$style.previewItem, $style.dark]" :aria-label="i18n.ts._avatarDecorationManager.darkPreview">
					<div :class="$style.previewCanvas"><MkAvatar :class="$style.avatar" :user="$i" :decorations="previewDecorations" :link="false" forceShowDecoration/></div>
					<p :class="$style.previewLabel">{{ i18n.ts._avatarDecorationManager.darkPreview }}</p>
				</section>
			</div>
			<p v-if="previewFailed" :class="$style.notice" role="status" data-testid="decoration-manager-image-error">
				{{ i18n.ts._avatarDecorationManager.imageFailed }}
				<button type="button" class="_textButton" :disabled="busy" @click="retryPreview">{{ i18n.ts.retry }}</button>
			</p>
		</section>
		<p :class="$style.hint">{{ i18n.ts._avatarDecorationManager.requiredFields }}</p>
		<fieldset :class="$style.controls" :disabled="busy">
			<label :class="$style.field">
				<MkInput v-model="name" required :disabled="busy" data-testid="decoration-manager-name">
					<template #label>{{ i18n.ts.name }}</template>
				</MkInput>
			</label>
			<label :class="$style.field">
				<MkInput v-model="category" :datalist="categories" :disabled="busy" data-testid="decoration-manager-category">
					<template #label>{{ i18n.ts.category }}</template>
				</MkInput>
			</label>
			<label :class="$style.field">
				<MkTextarea v-model="description" :disabled="busy" data-testid="decoration-manager-description">
					<template #label>{{ i18n.ts.description }}</template>
				</MkTextarea>
			</label>
			<fieldset :class="$style.roles" data-testid="decoration-manager-roles">
				<legend :class="$style.roleHeading">{{ i18n.ts.availableRoles }} <span>{{ selectedRoleIds.length === 0 ? i18n.ts.all : selectedRoleIds.length }}</span></legend>
				<MkButton rounded :disabled="busy || rolesLoading" data-testid="decoration-manager-role-add" @click="addRole"><i class="ti ti-plus" aria-hidden="true"></i> {{ i18n.ts.add }}</MkButton>
				<p v-if="rolesLoading" :class="$style.hint" role="status">{{ i18n.ts._avatarDecorationManager.loadingRoles }}</p>
				<p v-if="roleMessage" :class="$style.notice" role="status" data-testid="decoration-manager-role-error">
					{{ roleMessage }}
					<button type="button" class="_textButton" :disabled="busy || rolesLoading" @click="retryRoles">{{ i18n.ts.retry }}</button>
				</p>
				<ul v-if="selectedRoleIds.length > 0" :class="$style.roleList">
					<li v-for="roleId in selectedRoleIds" :key="roleId" :class="$style.roleItem" :data-role-id="roleId" data-testid="decoration-manager-role-row">
						<span :class="$style.roleName">{{ roleName(roleId) }}</span>
						<button type="button" class="_button" :class="$style.roleRemove" :disabled="busy" :aria-label="i18n.tsx._avatarDecorationManager.removeRole({ name: roleName(roleId) })" data-testid="decoration-manager-role-remove" @click="removeRole(roleId)"><i class="ti ti-x" aria-hidden="true"></i></button>
					</li>
				</ul>
			</fieldset>
		</fieldset>
	</form>
	<template #footer>
		<div :class="{ [$style.twitter]: isTwitterUi }" data-testid="decoration-manager-footer">
			<p v-if="errorMessage" :class="$style.error" role="alert" data-testid="decoration-manager-save-error">{{ errorMessage }}</p>
			<div :class="$style.actions">
				<MkButton v-if="props.remove" rounded danger :class="$style.action" :disabled="busy" data-testid="decoration-manager-delete" @click="deleteDecoration">{{ operation === 'deleting' ? i18n.ts._avatarDecorationManager.deleting : i18n.ts.delete }}</MkButton>
				<MkButton rounded :class="$style.action" :disabled="busy" data-testid="decoration-manager-cancel" @click="cancel">{{ i18n.ts.cancel }}</MkButton>
				<MkButton primary rounded type="submit" :form="formId" :class="$style.action" :disabled="busy || !canSubmit" :aria-busy="operation === 'saving'" data-testid="decoration-manager-save">{{ operation === 'saving' ? i18n.ts._avatarDecorationManager.saving : props.avatarDecoration ? i18n.ts.save : i18n.ts._avatarDecorationManager.addDecoration }}</MkButton>
			</div>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkButton from '@/components/MkButton.vue';
import MkDriveFileSelectDialog from '@/components/MkDriveFileSelectDialog.vue';
import MkInput from '@/components/MkInput.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { useIsTwitterUi } from '@/ui/twitter/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { uploadFile, UploadAbortedError } from '@/utility/drive.js';

/** 直接复用现有实体和创建请求类型；持久化命令由目录所属页面提供。 */
const props = defineProps<{
	avatarDecoration?: Misskey.entities.AdminAvatarDecorationsListResponse[number];
	categories?: readonly string[];
	submit: (draft: Misskey.Endpoints['admin/avatar-decorations/create']['req']) => Promise<void>;
	remove?: () => Promise<void>;
}>();
/** 仅通知宿主回收已经关闭的模态实例。 */
const emit = defineEmits<{ (ev: 'closed'): void }>();
const $i: ReturnType<typeof ensureSignin> = ensureSignin();
const isTwitterUi: ReturnType<typeof useIsTwitterUi> = useIsTwitterUi();
const dialog: Readonly<ShallowRef<InstanceType<typeof MkModalWindow> | null>> = useTemplateRef<InstanceType<typeof MkModalWindow>>('dialog');
const fileInput: Readonly<ShallowRef<HTMLInputElement | null>> = useTemplateRef<HTMLInputElement>('fileInput');
const formId: string = useId();
const materialHeadingId: string = useId();
const previewHeadingId: string = useId();
const name: Ref<string> = ref(props.avatarDecoration?.name ?? '');
const url: Ref<string> = ref(props.avatarDecoration?.url ?? '');
const category: Ref<string> = ref(props.avatarDecoration?.category ?? '');
const description: Ref<string> = ref(props.avatarDecoration?.description ?? '');
const selectedRoleIds: Ref<string[]> = ref([...(props.avatarDecoration?.roleIdsThatCanBeUsedThisDecoration ?? [])]);
/** 角色对象仅供展示和候选选择，不能反向决定已选择的 ID。 */
const roleMetadata: ShallowRef<readonly Misskey.entities.Role[]> = shallowRef([]);
const rolesLoading: Ref<boolean> = ref(false);
const roleMessage: Ref<string | null> = ref(null);
const errorMessage: Ref<string | null> = ref(null);
const previewFailed: Ref<boolean> = ref(false);
const previewKey: Ref<number> = ref(0);
const materialStatus: Ref<string | null> = ref(null);
const materialError: Ref<string | null> = ref(null);
const uploadProgress: Ref<number | null> = ref(null);
/** 单一临时操作状态同时约束提交、嵌套确认和关闭动画，防止重复写入。 */
const operation: Ref<'saving' | 'confirming-delete' | 'deleting' | 'selecting-role' | 'selecting-material' | 'uploading-material' | 'closing' | null> = ref(null);
const busy: ComputedRef<boolean> = computed(/** 从当前交互阶段派生统一禁用状态。 */ (): boolean => operation.value !== null);
const hasMaterial: ComputedRef<boolean> = computed(/** 三种素材入口共享同一地址草稿，预览有无素材也由该地址派生。 */ (): boolean => url.value.trim().length > 0);
const canSubmit: ComputedRef<boolean> = computed(/** 仅约束现有协议的非空名称和素材地址，不追加图片可访问性规则。 */ (): boolean => name.value.trim().length > 0 && hasMaterial.value);
const categories: ComputedRef<string[]> = computed(/** 基础输入组件接收独立候选数组，不持有只读 props 的可变引用。 */ (): string[] => [...(props.categories ?? [])]);
const previewDecorations: ComputedRef<NonNullable<InstanceType<typeof MkAvatar>['$props']['decorations']>> = computed(
	/** 预览只读取当前图片草稿，不改动管理员已佩戴的真实挂件。 */
	(): NonNullable<InstanceType<typeof MkAvatar>['$props']['decorations']> => url.value.trim() === '' ? [] : [{ url: url.value.trim() }],
);
let roleRequest: AbortController | null = null;
let disposed: boolean = false;

let activeUpload: ReturnType<typeof uploadFile> | null = null;
let disposeDriveDialog: (() => void) | null = null;

/** 选择文件尚未开始传输；原生选择器取消时不锁定表单，也不丢弃当前素材。 */
function chooseLocalMaterial(): void {
	if (busy.value || disposed || fileInput.value === null) return;
	materialError.value = null;
	fileInput.value.value = '';
	fileInput.value.click();
}

/** 清空本轮取消的输入引用，使同一个文件仍可再次选择。 */
function cancelFileSelection(event: Event): void {
	if (event.target instanceof HTMLInputElement) event.target.value = '';
}

/** 仅采纳真实网盘文件的原图地址；非图片候选不覆盖现有表单素材。 */
function applyMaterial(file: Misskey.entities.DriveFile, uploaded: boolean): void {
	if (disposed) return;
	if (!file.type.startsWith('image/') || file.url.trim().length === 0) {
		materialError.value = i18n.ts._avatarDecorationManager.imageOnly;
		return;
	}
	url.value = file.url;
	materialError.value = null;
	materialStatus.value = uploaded ? i18n.ts._avatarDecorationManager.materialUploaded : i18n.ts._avatarDecorationManager.materialSelected;
}

/** 上传选中的原始素材；真实上传回执只更新地址草稿，挂件创建仍由保存命令负责。 */
async function uploadMaterial(event: Event): Promise<void> {
	if (!(event.target instanceof HTMLInputElement)) return;
	const file: File | undefined = event.target.files?.[0];
	event.target.value = '';
	if (file === undefined || busy.value || disposed) return;
	materialError.value = null;
	if (file.type !== '' && !file.type.startsWith('image/')) {
		materialError.value = i18n.ts._avatarDecorationManager.imageOnly;
		return;
	}
	operation.value = 'uploading-material';
	uploadProgress.value = null;
	let currentUpload: ReturnType<typeof uploadFile> | null = null;
	try {
		currentUpload = uploadFile(file, {
			folderId: prefer.s.uploadFolder,
			/** 只展示当前上传的可计算进度，取消后迟到的回调不得写回。 */
			onProgress: (progress: { total: number; loaded: number }): void => {
				if (disposed || currentUpload === null || activeUpload !== currentUpload) return;
				uploadProgress.value = progress.total > 0 ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : null;
			},
		});
		activeUpload = currentUpload;
		const result: Misskey.entities.DriveFile = await currentUpload.filePromise;
		if (!disposed && activeUpload === currentUpload) applyMaterial(result, true);
	} catch (error: unknown) {
		if (!disposed && activeUpload === currentUpload && !(error instanceof UploadAbortedError)) materialError.value = i18n.ts._avatarDecorationManager.uploadFailed;
	} finally {
		if (activeUpload === currentUpload) {
			activeUpload = null;
			if (!disposed) {
				uploadProgress.value = null;
				if (operation.value === 'uploading-material') operation.value = null;
			}
		}
	}
}

/** 用户主动取消只中止本次传输，保留原素材；先失效身份以隔离已排队的响应。 */
function cancelMaterialUpload(): void {
	if (disposed || operation.value !== 'uploading-material' || activeUpload === null) return;
	const previous: ReturnType<typeof uploadFile> = activeUpload;
	activeUpload = null;
	previous.abort();
	uploadProgress.value = null;
	operation.value = null;
	materialStatus.value = i18n.ts._avatarDecorationManager.uploadCanceled;
}

/** 复用网盘选择弹窗的公开事件；选中、取消和关闭均收尾，不等待存量悬空 Promise。 */
function chooseDriveMaterial(): void {
	if (busy.value || disposed || disposeDriveDialog !== null) return;
	operation.value = 'selecting-material';
	materialError.value = null;
	let handled: boolean = false;
	try {
		const popup: ReturnType<typeof os.popup> = os.popup(MkDriveFileSelectDialog, { multiple: false }, {
			/** 只处理一次明确的选择结果；取消事件不改变任何素材草稿。 */
			done: (files?: Misskey.entities.DriveFile[]): void => {
				if (disposed || handled || disposeDriveDialog !== popup.dispose) return;
				handled = true;
				const file: Misskey.entities.DriveFile | undefined = files?.[0];
				if (file !== undefined) applyMaterial(file, false);
			},
			/** 关闭动画结束后释放选择器并恢复表单，包含取消及未选择文件的情况。 */
			closed: (): void => {
				popup.dispose();
				if (disposeDriveDialog !== popup.dispose) return;
				disposeDriveDialog = null;
				if (!disposed && operation.value === 'selecting-material') operation.value = null;
			},
		});
		disposeDriveDialog = popup.dispose;
	} catch (error: unknown) {
		if (!disposed) {
			materialError.value = i18n.ts._avatarDecorationManager.materialSelectionFailed;
			operation.value = null;
		}
	}
}

/** 显示后端角色名称；元数据暂不可读时仍保留明确可移除的原始选择。 */
function roleName(roleId: string): string {
	const role: Misskey.entities.Role | undefined = roleMetadata.value.find(/** 按权威角色标识关联只读展示信息。 */ (item: Misskey.entities.Role): boolean => item.id === roleId);
	return role?.name ?? i18n.tsx._avatarDecorationManager.unknownRole({ id: roleId });
}

/** 读取真实角色目录作为展示信息，取消和失败均不删除选择草稿。 */
async function loadRoles(): Promise<readonly Misskey.entities.Role[] | null> {
	if (disposed) return null;
	roleRequest?.abort();
	const request: AbortController = new AbortController();
	roleRequest = request;
	rolesLoading.value = true;
	roleMessage.value = null;
	try {
		const roles: Misskey.entities.Role[] = await misskeyApi('admin/roles/list', {}, $i.token, request.signal);
		if (disposed || request.signal.aborted || roleRequest !== request) return null;
		roleMetadata.value = roles;
		return roles;
	} catch (error: unknown) {
		if (!disposed && !request.signal.aborted && roleRequest === request) roleMessage.value = i18n.ts._avatarDecorationManager.roleLoadFailed;
		return null;
	} finally {
		if (!disposed && roleRequest === request) {
			roleRequest = null;
			rolesLoading.value = false;
		}
	}
}

/** 用户主动重试角色展示读取，不自动更改任何可用角色。 */
async function retryRoles(): Promise<void> { if (!busy.value && !rolesLoading.value) await loadRoles(); }

/** 从最新真实目录选择一个公开角色，选择取消或失败不会修改原草稿。 */
async function addRole(): Promise<void> {
	if (busy.value || rolesLoading.value || disposed) return;
	operation.value = 'selecting-role';
	try {
		const roles: readonly Misskey.entities.Role[] | null = await loadRoles();
		if (roles === null || disposed) return;
		const candidates: readonly Misskey.entities.Role[] = roles.filter(/** 只排除已选择项；沿用公开角色作为新增候选的既有范围。 */ (role: Misskey.entities.Role): boolean => role.isPublic && !selectedRoleIds.value.includes(role.id));
		if (candidates.length === 0) {
			roleMessage.value = i18n.ts._avatarDecorationManager.noAvailableRoles;
			return;
		}
		const selection: Awaited<ReturnType<typeof os.select>> = await os.select({
			title: i18n.ts.availableRoles,
			items: candidates.map(/** 为既有选择弹窗生成只读标签与标识。 */ (role: Misskey.entities.Role): { label: string; value: string } => ({ label: role.name, value: role.id })),
		});
		if (disposed || selection.canceled || typeof selection.result !== 'string') return;
		if (!selectedRoleIds.value.includes(selection.result)) selectedRoleIds.value = [...selectedRoleIds.value, selection.result];
	} catch (error: unknown) {
		if (!disposed) roleMessage.value = i18n.ts._avatarDecorationManager.roleLoadFailed;
	} finally {
		if (!disposed && operation.value === 'selecting-role') operation.value = null;
	}
}

/** 移除挂件的可用角色选择，不涉及该角色的成员分配。 */
function removeRole(roleId: string): void {
	if (busy.value) return;
	selectedRoleIds.value = selectedRoleIds.value.filter(/** 只丢弃用户明确移除的标识，保留未知元数据项。 */ (id: string): boolean => id !== roleId);
}

/** 捕获当前挂件图片的实际错误；用户头像错误和迟到的旧地址错误不影响提示。 */
function onPreviewError(event: Event): void {
	if (event.target instanceof HTMLImageElement && event.target.getAttribute('src') === url.value.trim()) previewFailed.value = true;
}

/** 重新挂载双主题预览，保留名称、描述、角色等表单草稿。 */
function retryPreview(): void {
	if (busy.value) return;
	previewFailed.value = false;
	previewKey.value++;
}

watch(url, /** 地址同步变化时撤销上一素材的反馈，新选择随后设置本次上传或网盘回执说明。 */ (): void => {
	previewFailed.value = false;
	previewKey.value++;
	materialStatus.value = null;
	materialError.value = null;
}, { flush: 'sync' });

/** 进入关闭动画仍保持禁用，防止成功回执后再次点击生成重复写入。 */
function closeConfirmed(): void { operation.value = 'closing'; dialog.value?.close(); }

/** 非写入阶段关闭只丢弃草稿；遮罩、Escape 与取消按钮执行同一边界。 */
function cancel(): void { if (!busy.value && !disposed) closeConfirmed(); }

/** 通过管理页提交现有请求字段，失败保留全部草稿，确认成功后关闭。 */
async function save(): Promise<void> {
	if (busy.value || disposed) return;
	if (!canSubmit.value) { errorMessage.value = i18n.ts._avatarDecorationManager.requiredFields; return; }
	operation.value = 'saving';
	errorMessage.value = null;
	const draft: Misskey.Endpoints['admin/avatar-decorations/create']['req'] = {
		name: name.value.trim(),
		url: url.value.trim(),
		description: description.value,
		category: category.value.trim() || null,
		roleIdsThatCanBeUsedThisDecoration: [...selectedRoleIds.value],
	};
	try {
		await props.submit(draft);
		if (!disposed) closeConfirmed();
	} catch (error: unknown) {
		if (!disposed) errorMessage.value = i18n.ts._avatarDecorationManager.saveFailed;
	} finally {
		if (!disposed && operation.value === 'saving') operation.value = null;
	}
}

/** 二次确认后等待删除回执；确认取消与删除失败都保留现有编辑内容。 */
async function deleteDecoration(): Promise<void> {
	const remove: typeof props.remove = props.remove;
	if (remove === undefined || busy.value || disposed) return;
	operation.value = 'confirming-delete';
	errorMessage.value = null;
	try {
		const confirmation: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({ type: 'warning', text: i18n.tsx.removeAreYouSure({ x: props.avatarDecoration?.name ?? name.value }) });
		if (confirmation.canceled || disposed) return;
		operation.value = 'deleting';
		await remove();
		if (!disposed) closeConfirmed();
	} catch (error: unknown) {
		if (!disposed) errorMessage.value = i18n.ts._avatarDecorationManager.deleteFailed;
	} finally {
		if (!disposed && (operation.value === 'confirming-delete' || operation.value === 'deleting')) operation.value = null;
	}
}

if (selectedRoleIds.value.length > 0) void loadRoles();
onBeforeUnmount(/** 销毁时先撤销交付身份，再中止本轮上传、角色读取和嵌套选择器。 */ (): void => {
	disposed = true;
	roleRequest?.abort();
	const upload: ReturnType<typeof uploadFile> | null = activeUpload;
	activeUpload = null;
	upload?.abort();
	disposeDriveDialog?.();
	disposeDriveDialog = null;
});
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	margin: 0;
	padding: var(--twitter-space-4, 16px);
	color: var(--twitter-fg, var(--MI_THEME-fg));
	font-size: var(--twitter-font-size-body, 14px);
}

/* 模态内容经全局弹层挂载，自行桥接基础输入组件需要的主题变量；滚动条沿用全局规则。 */
.twitter {
	--MI_THEME-bg: var(--twitter-panel);
	--MI_THEME-panel: var(--twitter-panel);
	--MI_THEME-fg: var(--twitter-fg);
	--MI_THEME-fgTransparentWeak: var(--twitter-secondary-fg);
	--MI_THEME-accent: var(--twitter-accent);
	--MI_THEME-divider: var(--twitter-border);
	--MI_THEME-inputBorder: var(--twitter-border);
	--MI_THEME-inputBorderHover: var(--twitter-secondary-fg);
	color: var(--twitter-fg);

	:deep(input), :deep(textarea) {
		border-color: var(--twitter-border);
		border-radius: var(--twitter-radius-medium);
	}
}

/* 新增素材操作沿用间距与触控 Token，正文仍由基础模态窗口提供滚动。 */
.material { display: grid; gap: var(--twitter-space-3, 12px); min-width: 0; }
.material .hint { margin: 0; }
.sectionHeading { margin: 0; font-size: var(--twitter-font-size-emphasis, 16px); line-height: 1.5; }
.materialActions { display: flex; flex-wrap: wrap; gap: var(--twitter-space-2, 8px); }
.materialActions > button { min-height: var(--twitter-touch-target, 44px); }
.uploadState { display: grid; gap: var(--twitter-space-2, 8px); justify-items: start; font-size: var(--twitter-font-size-meta, 13px); }
.uploadProgress { width: 100%; accent-color: var(--twitter-accent, var(--MI_THEME-accent)); }
.urlDetails { min-width: 0; }
.urlDetails > summary { width: fit-content; min-height: var(--twitter-touch-target, 44px); align-content: center; color: var(--twitter-accent, var(--MI_THEME-accent)); cursor: pointer; }
.urlDetails > summary:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 2px; border-radius: var(--twitter-radius-small, 4px); }
.urlDetails[open] > summary { margin-bottom: var(--twitter-space-2, 8px); }
.previewSection { margin-top: var(--twitter-space-4, 16px); }
.previewEmpty { margin: 0; padding: var(--twitter-space-4, 16px); border: 1px dashed var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-medium, 8px); color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); line-height: 1.6; }

.preview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--twitter-space-3, 12px); }
.previewItem { min-width: 0; margin: 0; background: var(--twitter-panel, Canvas); color: var(--twitter-fg, CanvasText); border: 1px solid var(--twitter-border, GrayText); border-radius: var(--twitter-radius-medium, 8px); }
.light { color-scheme: light; }
.dark { color-scheme: dark; }
/* 沿用旧编辑器 160px 预览空间，头像保持目录的 60px 尺度，给实际挂件留出四周空间。 */
.previewCanvas { display: grid; place-items: center; min-height: calc(var(--twitter-decoration-editor-avatar-size, 64px) * 2.5); }
.avatar { width: var(--twitter-decoration-card-avatar-size, 60px); height: var(--twitter-decoration-card-avatar-size, 60px); }
.previewLabel { margin: 0; padding: 0 var(--twitter-space-2, 8px) var(--twitter-space-2, 8px); text-align: center; font-size: var(--twitter-font-size-meta, 13px); }
.hint { margin: var(--twitter-space-3, 12px) 0; color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); line-height: 1.5; }
.controls { display: grid; gap: var(--twitter-space-3, 12px); min-width: 0; margin: 0; padding: 0; border: 0; }
.field { display: block; min-width: 0; }
.field :deep(input) { min-height: var(--twitter-touch-target, 44px); }
.roles { min-width: 0; margin: 0; padding: var(--twitter-space-3, 12px); border: 1px solid var(--twitter-border, var(--MI_THEME-divider)); border-radius: var(--twitter-radius-medium, 8px); }
.roleHeading { padding: 0 var(--twitter-space-1, 4px); }
.roleHeading span { margin-left: var(--twitter-space-1, 4px); color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); }
.roleList { display: grid; gap: var(--twitter-space-2, 8px); margin: var(--twitter-space-3, 12px) 0 0; padding: 0; list-style: none; }
.roleItem { display: flex; align-items: center; gap: var(--twitter-space-2, 8px); }
.roleName { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.roleRemove { display: grid; place-items: center; flex-shrink: 0; width: var(--twitter-touch-target, 44px); height: var(--twitter-touch-target, 44px); border-radius: var(--twitter-radius-pill, 999px); }
.roleRemove:not(:disabled):hover { background: var(--twitter-hover, var(--MI_THEME-buttonHoverBg)); }
.roleRemove:focus-visible { outline: 2px solid var(--twitter-accent, var(--MI_THEME-accent)); outline-offset: 2px; }
.notice { margin: var(--twitter-space-2, 8px) 0; color: var(--twitter-secondary-fg, var(--MI_THEME-fgTransparentWeak)); font-size: var(--twitter-font-size-meta, 13px); line-height: 1.5; overflow-wrap: anywhere; }
.notice button { color: var(--twitter-accent, var(--MI_THEME-accent)); }
.error { margin: 0 0 var(--twitter-space-2, 8px); color: var(--twitter-danger, var(--MI_THEME-error)); font-size: var(--twitter-font-size-meta, 13px); line-height: 1.5; overflow-wrap: anywhere; }
.actions { display: flex; gap: var(--twitter-space-2, 8px); }
.action { flex: 1; min-width: 0; width: auto; min-height: var(--twitter-touch-target, 44px); padding-inline: var(--twitter-space-2, 8px); }
</style>
