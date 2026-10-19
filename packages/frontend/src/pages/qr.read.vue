<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：二维码页面 · 摄像头与图片识别视图。
作用：通过设备适配层管理视频流，将设备失败映射为本地化状态，并沿用原有二维码解码与 ap/show 结果展示。
数据链角色：用户操作 → qr-camera 设备适配器 → QrScanner 解码 → 既有 ActivityPub 解析与结果组件。
本页只保留扫描会话和展示所需的临时状态；停止、离页和迟到请求均释放本页取得的媒体流。
-->

<template>
<div
	:class="[$style.root, { [$style.twitter]: isTwitterUi }]"
	:style="{
		'--MI-QrReadViewHeight': 'calc(100cqh - var(--MI-stickyTop, 0px) - var(--MI-stickyBottom, 0px))',
		'--MI-QrReadVideoHeight': 'min(calc(var(--MI-QrReadViewHeight) * 0.3), 512px)',
	}"
	data-testid="qr-reader"
>
	<MkStickyContainer>
		<template #header>
			<div :class="$style.camera">
				<div :class="[$style.view, { [$style.compact]: !qrStarted }]">
					<video ref="videoEl" :class="[$style.video, { [$style.inactive]: !qrStarted }]" data-testid="qr-video" autoplay muted playsinline></video>
					<div ref="overlayEl"></div>
					<div v-if="!qrStarted" :class="$style.status">
						<i :class="cameraState.status === 'starting' ? 'ti ti-loader-2' : 'ti ti-camera-off'" aria-hidden="true"></i>
						<div :class="$style.statusText">
							<strong>{{ cameraStatusTitle }}</strong>
							<p role="status" aria-live="polite" data-testid="qr-camera-status">{{ cameraStatusMessage }}</p>
						</div>
					</div>
				</div>
				<div :class="$style.controls">
					<MkButton v-tooltip="i18n.ts._qr.scanFile" :class="$style.imageUpload" :iconOnly="!isTwitterUi" :primary="isTwitterUi" :disabled="imageBusy" :aria-busy="imageBusy" :aria-label="i18n.ts._qr.scanFile" data-testid="qr-image-upload" @click="upload">
						<span :class="$style.buttonLabel"><i class="ti ti-photo-plus" aria-hidden="true"></i><span v-if="isTwitterUi">{{ i18n.ts._qr.scanFile }}</span></span>
					</MkButton>
					<div :class="$style.cameraActions">
						<MkButton v-if="qrStarted || cameraState.status === 'starting'" v-tooltip="i18n.ts._qr.stopQr" iconOnly :aria-label="i18n.ts._qr.stopQr" data-testid="qr-camera-stop" @click="stopQr">
							<i class="ti ti-player-pause" aria-hidden="true"></i>
						</MkButton>
						<MkButton v-else v-tooltip="cameraStartLabel" iconOnly :disabled="!canStartCamera" :aria-label="cameraStartLabel" data-testid="qr-camera-start" @click="startQr">
							<i class="ti ti-player-play" aria-hidden="true"></i>
						</MkButton>
						<MkButton v-tooltip="i18n.ts._qr.chooseCamera" iconOnly :disabled="!canChooseCamera" :aria-label="i18n.ts._qr.chooseCamera" data-testid="qr-camera-choose" @click="chooseCamera">
							<i class="ti ti-camera-rotate" aria-hidden="true"></i>
						</MkButton>
						<MkButton v-tooltip="flashActionLabel" iconOnly :disabled="!qrStarted || !flashCanToggle || flashBusy" :aria-label="flashActionLabel" :aria-pressed="flash" data-testid="qr-camera-flash" @click="toggleFlash">
							<i :class="flash ? 'ti ti-bolt-filled' : 'ti ti-bolt-off'" aria-hidden="true"></i>
						</MkButton>
					</div>
				</div>
				<div v-if="cameraChoiceMessage || showCameraRefresh" :class="$style.deviceHelp">
					<p v-if="cameraChoiceMessage" role="status">{{ cameraChoiceMessage }}</p>
					<MkButton v-if="showCameraRefresh" small :disabled="cameraListBusy || cameraState.status === 'starting'" data-testid="qr-camera-refresh" @click="handleRefreshCameras">
						<span :class="$style.buttonLabel"><i class="ti ti-refresh" aria-hidden="true"></i><span>{{ i18n.ts._qr.refreshCameras }}</span></span>
					</MkButton>
				</div>
				<p v-if="flashFailed" :class="$style.flashError" role="status">{{ i18n.ts._qr.flashFailed }}</p>
				<p v-if="processingStatusMessage" :class="$style.processing" role="status" aria-live="polite" data-testid="qr-processing-status">{{ processingStatusMessage }}</p>
			</div>
		</template>
		<div v-if="hasCompletedResults" class="_spacer" :class="$style.contents" style="--MI_SPACER-w: 800px;" data-testid="qr-results">
			<MkStickyContainer>
				<template #header>
					<MkTab
						:modelValue="tab"
						:tabs="[
							{ key: 'users', label: i18n.ts.users },
							{ key: 'notes', label: i18n.ts.notes },
							{ key: 'all', label: i18n.ts.all },
						]"
						:class="$style.tab"
						@update:modelValue="handleResultTabChange"
					/>
				</template>
				<div v-if="tab === 'users'" :class="[$style.users, '_margin']" style="padding-bottom: var(--MI-margin);">
					<p v-if="users.length === 0" :class="$style.empty">{{ i18n.ts._qr.noUsers }}</p>
					<div v-for="user in users" :key="user.id" data-testid="qr-user-result" :data-user-id="user.id">
						<TwitterUserResult v-if="isTwitterUi" :user="user"/>
						<MkUserInfo v-else :user="user"/>
					</div>
				</div>
				<div v-else-if="tab === 'notes'" class="_margin _gaps" style="padding-bottom: var(--MI-margin);">
					<p v-if="notes.length === 0" :class="$style.empty">{{ i18n.ts._qr.noNotes }}</p>
					<div v-for="note in notes" :key="note.id" data-testid="qr-note-result" :data-note-id="note.id">
						<MkNote :note="note" :class="$style.note"/>
					</div>
				</div>
				<div v-else-if="tab === 'all'" class="_margin _gaps" style="padding-bottom: var(--MI-margin);">
					<MkQrReadRawViewer v-for="result in Array.from(results).reverse()" :key="result" :data="result"/>
				</div>
			</MkStickyContainer>
		</div>
	</MkStickyContainer>
</div>
</template>

<script lang="ts" setup>
import QrScanner from 'qr-scanner';
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useTemplateRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { ApShowResponse, Note, UserDetailed } from 'misskey-js/entities.js';
import type { QrCameraDevice, QrCameraErrorCode } from '@/utility/qr-camera.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import MkUserInfo from '@/components/MkUserInfo.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkNote from '@/components/MkNote.vue';
import MkTab from '@/components/MkTab.vue';
import MkButton from '@/components/MkButton.vue';
import MkQrReadRawViewer from '@/pages/qr.read.raw-viewer.vue';
import { TwitterUserResult, useIsTwitterUi } from '@/ui/twitter/index.js';
import { getQrCameraErrorCode, getQrCameraFlashAvailable, listQrCameras, openQrCamera, setQrCameraFlash, stopQrCamera, subscribeQrCameraChanges, subscribeQrCameraEnded } from '@/utility/qr-camera.js';

/** 单个扫码视图的临时摄像头状态，错误原因直接使用设备适配层的权威分类。 */
type QrCameraState = { status: 'stopped' | 'starting' | 'running' } | { status: 'error'; reason: QrCameraErrorCode };

/** 结果区域的本地分类选择，不复制 ActivityPub 实体类型。 */
type QrResultTab = 'users' | 'notes' | 'all';

/** 一次图片任务的展示阶段，独立于摄像头启动和视频解码。 */
type QrImageTaskState = 'idle' | 'decoding' | 'resolving';

const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
const videoEl: Readonly<ShallowRef<HTMLVideoElement | null>> = useTemplateRef<HTMLVideoElement>('videoEl');
const overlayEl: Readonly<ShallowRef<HTMLDivElement | null>> = useTemplateRef<HTMLDivElement>('overlayEl');
const cameraState: Ref<QrCameraState> = ref({ status: 'stopped' });
const cameras: Ref<QrCameraDevice[] | null> = ref(null);
const cameraListBusy: Ref<boolean> = ref(false);
const cameraListFailed: Ref<boolean> = ref(false);
const flashCanToggle: Ref<boolean> = ref(false);
const flash: Ref<boolean> = ref(false);
const flashBusy: Ref<boolean> = ref(false);
const flashFailed: Ref<boolean> = ref(false);
let scannerInstance: QrScanner | null = null;
let ownedStream: MediaStream | null = null;
let selectedCameraId: string | undefined;
let initializeId: number = 0;
let cameraListId: number = 0;
let componentActive: boolean = false;
let resumeWhenVisible: boolean = false;
let alertLock: boolean = false;
let unsubscribeDevices: (() => void) | null = null;
let unsubscribeEnded: (() => void) | null = null;

/** 运行态由唯一摄像头状态派生，不能在异步操作之间维护另一份开关事实。 */
const qrStarted: ComputedRef<boolean> = computed(
	/** 仅完成视频播放后显示运行控制。 */
	(): boolean => cameraState.value.status === 'running',
);

/** 当前来源或浏览器能力不允许摄像头时，重复点击不能恢复设备。 */
const cameraEnvironmentBlocked: ComputedRef<boolean> = computed(
	/** 能力判断只消费适配器已经返回的错误，不在视图中探测媒体 API。 */
	(): boolean => cameraState.value.status === 'error' && (cameraState.value.reason === 'insecureContext' || cameraState.value.reason === 'unavailable'),
);

/** 将未知清单与没有可选择目标区分开，仅公开有效设备标识对应的选择项。 */
const selectableCameras: ComputedRef<QrCameraDevice[]> = computed(
	/** 空设备标识不能作为精确的镜头选择约束。 */
	(): QrCameraDevice[] => (cameras.value ?? []).filter(
		/** 浏览器尚未公开标识的条目只参与状态说明。 */
		(camera: QrCameraDevice): boolean => camera.id.length > 0,
	),
);

/** 对于可恢复错误保留启动入口，已确认无设备时先通过重新检测恢复能力。 */
const canStartCamera: ComputedRef<boolean> = computed(
	/** 正在运行或启动时由暂停操作接管，不允许并行发起摄像头请求。 */
	(): boolean => !cameraEnvironmentBlocked.value && cameraState.value.status !== 'starting' && cameraState.value.status !== 'running' && !(cameraState.value.status === 'error' && cameraState.value.reason === 'notFound'),
);

/** 切换能力由可选择设备数量和当前操作状态派生，单镜头与未知清单均禁用。 */
const canChooseCamera: ComputedRef<boolean> = computed(
	/** 权限拒绝时应先显式重试授权，设备读取失败仍可选择其他已知镜头。 */
	(): boolean => !cameraEnvironmentBlocked.value && !cameraListBusy.value && !cameraListFailed.value && cameraState.value.status !== 'starting' && !(cameraState.value.status === 'error' && (cameraState.value.reason === 'permissionDenied' || cameraState.value.reason === 'notFound')) && selectableCameras.value.length > 1,
);

/** 只有重试枚举能够带来新信息时才显示重新检测入口。 */
const showCameraRefresh: ComputedRef<boolean> = computed(
	/** 非安全来源和缺少媒体接口的环境不提供无效的重新检测。 */
	(): boolean => !cameraEnvironmentBlocked.value && cameraState.value.status !== 'starting' && (cameras.value === null || cameraListFailed.value || cameraState.value.status === 'error'),
);

/** 启动按钮在可恢复错误时明确表示重试，不把错误后的动作伪装成正常播放。 */
const cameraStartLabel: ComputedRef<string> = computed(
	/** 确认无设备或环境不支持时沿用禁用的启动标签。 */
	(): string => cameraState.value.status === 'error' && canStartCamera.value ? i18n.ts._qr.retryCamera : i18n.ts._qr.startQr,
);

/** 将设备适配错误转换为产品反馈，保留不同失败原因各自可执行的后续操作。 */
function getCameraErrorMessage(reason: QrCameraErrorCode): string {
	switch (reason) {
		case 'insecureContext': return i18n.ts._qr.cameraInsecure;
		case 'unavailable': return i18n.ts._qr.cameraUnavailable;
		case 'permissionDenied': return i18n.ts._qr.cameraPermissionDenied;
		case 'notFound': return i18n.ts._qr.cameraNotFound;
		case 'notReadable': return i18n.ts._qr.cameraNotReadable;
		case 'constraints': return i18n.ts._qr.cameraConstraints;
		case 'unknown': return i18n.ts._qr.cameraUnknown;
	}
}

/** 为紧凑状态区域提供简短标题，详细恢复步骤由独立说明承载。 */
const cameraStatusTitle: ComputedRef<string> = computed(
	/** 启动、暂停与不可用三种场景具有稳定的视觉层次。 */
	(): string => cameraState.value.status === 'starting' ? i18n.ts._qr.cameraStartingTitle : cameraState.value.status === 'error' ? i18n.ts._qr.cameraUnavailableTitle : i18n.ts._qr.cameraPausedTitle,
);

/** 由本次会话状态派生可被辅助技术播报的内联说明。 */
const cameraStatusMessage: ComputedRef<string> = computed(
	/** 预期设备错误在扫码页展示，不弹出第三方英文错误。 */
	(): string => {
		if (cameraState.value.status === 'error') return getCameraErrorMessage(cameraState.value.reason);
		return cameraState.value.status === 'starting' ? i18n.ts._qr.cameraStarting : i18n.ts._qr.cameraStopped;
	},
);

/** 在操作栏旁解释单摄像头、枚举中和枚举失败，触屏用户无需依赖悬浮提示。 */
const cameraChoiceMessage: ComputedRef<string> = computed(
	/** 摄像头主状态已经说明不可用原因时不重复渲染同样的错误。 */
	(): string => {
		if (cameraEnvironmentBlocked.value || cameraState.value.status === 'starting') return '';
		if (cameraListBusy.value) return i18n.ts._qr.cameraDetecting;
		if (cameraListFailed.value) return i18n.ts._qr.cameraListUnavailable;
		if (cameraState.value.status === 'error') return '';
		if (cameras.value?.length === 1) return i18n.ts._qr.cameraSingle;
		if (cameras.value === null || selectableCameras.value.length === 0) return i18n.ts._qr.cameraListUnavailable;
		return '';
	},
);

/** 按现有轨道能力和实际闪光灯状态派生按钮的可访问名称。 */
const flashActionLabel: ComputedRef<string> = computed(
	/** 不可用、开启与关闭三种状态各自使用现有语言键。 */
	(): string => !flashCanToggle.value ? i18n.ts._qr.cannotToggleFlash : flash.value ? i18n.ts._qr.turnOffFlash : i18n.ts._qr.turnOnFlash,
);

const tab: Ref<QrResultTab> = ref('users');
const results: Ref<Set<string>> = ref(new Set<string>());
const pendingResults: Ref<Map<string, Promise<void>>> = ref(new Map<string, Promise<void>>());
const uris: Ref<string[]> = ref([]);
const sources: Map<string, ApShowResponse> = new Map();
const users: Ref<UserDetailed[]> = ref([]);
const notes: Ref<Note[]> = ref([]);
const imageTaskState: Ref<QrImageTaskState> = ref('idle');
let resultSessionId: number = 0;
let resultSequence: number = 0;
let resultTabSelectionId: number = 0;

/** 只有完成解码及归类的内容才允许挂载结果分类与列表。 */
const hasCompletedResults: ComputedRef<boolean> = computed(
	/** 无二维码、取消选择和等待 ap/show 都不产生完成结果。 */
	(): boolean => results.value.size > 0,
);

/** 图片任务的忙碌状态仅由其阶段派生，摄像头错误不会禁用图片入口。 */
const imageBusy: ComputedRef<boolean> = computed(
	/** 选图对话框尚未返回文件时不显示识别进度。 */
	(): boolean => imageTaskState.value !== 'idle',
);

/** 轻量进度消息独立于结果区域，因此首次解析期间不会渲染空页签。 */
const processingStatusMessage: ComputedRef<string> = computed(
	/** 图片解码与 URL 归类分别描述当前等待的实际工作。 */
	(): string => imageTaskState.value === 'decoding' ? i18n.ts._qr.imageProcessing : pendingResults.value.size > 0 ? i18n.ts._qr.resultProcessing : '',
);

/** 从已经归类完成的最近 URI 派生会话内的用户与帖子列表。 */
function updateLists(): void {
	users.value = [];
	notes.value = [];
	for (const uri of uris.value) {
		const response: ApShowResponse | undefined = sources.get(uri);
		if (response?.type === 'User') users.value.push(response.object);
		if (response?.type === 'Note') notes.value.push(response.object);
	}
}

/** 记录用户主动选择，避免较早发起的网络请求覆盖当前阅读分类。 */
function handleResultTabChange(value: string | undefined): void {
	if (value !== 'users' && value !== 'notes' && value !== 'all') return;
	resultTabSelectionId++;
	tab.value = value;
}

/** 在一次归类完成后原子更新可展示内容，首次结果不会先暴露空实体列表。 */
function completeResult(value: string, response: ApShowResponse | null, sequence: number, selectionId: number, sessionId: number): void {
	if (!componentActive || sessionId !== resultSessionId) return;
	const hadResults: boolean = hasCompletedResults.value;
	if (response !== null) {
		sources.set(value, response);
		uris.value = [value, ...uris.value.filter(
			/** 保持最多三十个已归类 URI 的最近顺序。 */
			(uri: string): boolean => uri !== value,
		).slice(0, 29)];
		updateLists();
	}
	results.value.add(value);
	if (!hadResults || (sequence === resultSequence && selectionId === resultTabSelectionId)) {
		tab.value = response?.type === 'User' ? 'users' : response?.type === 'Note' ? 'notes' : 'all';
	}
}

/** 等待原有 ap/show 业务链，普通网址无法解析为联邦对象时仍作为有效原始结果展示。 */
async function resolveUrlResult(value: string, sequence: number, selectionId: number, sessionId: number): Promise<void> {
	let response: ApShowResponse | null = null;
	try {
		response = await misskeyApi('ap/show', { uri: value });
	} catch (error: unknown) {
		console.warn('QR URL could not be resolved as an ActivityPub object.', error);
	}
	completeResult(value, response, sequence, selectionId, sessionId);
}

/** 合并重复摄像头帧及图片输入：文本立即归类，URL 只保留一个进行中的解析请求。 */
async function processResult(result: QrScanner.ScanResult): Promise<void> {
	const trimmed: string = result.data.trim();
	if (!trimmed || !componentActive || results.value.has(trimmed)) return;
	const pending: Promise<void> | undefined = pendingResults.value.get(trimmed);
	if (pending) return pending;
	const sequence: number = ++resultSequence;
	const selectionId: number = resultTabSelectionId;
	const sessionId: number = resultSessionId;
	try {
		new URL(trimmed);
	} catch {
		completeResult(trimmed, null, sequence, selectionId, sessionId);
		return;
	}
	const request: Promise<void> = resolveUrlResult(trimmed, sequence, selectionId, sessionId);
	pendingResults.value.set(trimmed, request);
	try {
		await request;
	} finally {
		if (pendingResults.value.get(trimmed) === request) pendingResults.value.delete(trimmed);
	}
}

/** 选择本机图片并使用真实解码器识别，摄像头启动失败不影响此独立入口。 */
async function upload(): Promise<void> {
	if (!componentActive || imageBusy.value) return;
	const sessionId: number = resultSessionId;
	let ownsImageTask: boolean = false;
	try {
		const files: File[] = await os.chooseFileFromPc({ multiple: true });
		if (!componentActive || sessionId !== resultSessionId || imageBusy.value || files.length === 0) return;
		ownsImageTask = true;
		for (const file of files) {
			if (!componentActive || sessionId !== resultSessionId) return;
			imageTaskState.value = 'decoding';
			try {
				const result: QrScanner.ScanResult = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
				if (!componentActive || sessionId !== resultSessionId) return;
				imageTaskState.value = 'resolving';
				await processResult(result);
			} catch (error: unknown) {
				if (!componentActive || sessionId !== resultSessionId) return;
				if (error === QrScanner.NO_QR_CODE_FOUND) {
					await os.alert({ type: 'info', text: i18n.ts._qr.noQrCodeFound });
				} else {
					console.error(error);
					await os.alert({ type: 'error', text: i18n.ts._qr.scanFailed });
				}
			}
		}
	} catch (error: unknown) {
		if (!componentActive || sessionId !== resultSessionId) return;
		console.error('QR image could not be selected.', error);
		await os.alert({ type: 'error', text: i18n.ts._qr.scanFailed });
	} finally {
		if (ownsImageTask && sessionId === resultSessionId) {
			imageTaskState.value = 'idle';
		}
	}
}

/** 只有当前仍活动且可见的启动请求可以接管视频元素。 */
function isCurrentStart(id: number): boolean {
	return componentActive && !window.document.hidden && id === initializeId;
}

/** 同步停止解码器和现有流，先移除 ended 监听以区分主动关闭与设备自然断开。 */
function releaseCamera(): void {
	unsubscribeEnded?.();
	unsubscribeEnded = null;
	if (scannerInstance) {
		void scannerInstance.pause(true);
		scannerInstance.stop();
	}
	const stream: MediaStream | null = ownedStream;
	ownedStream = null;
	stopQrCamera(stream);
	if (videoEl.value?.srcObject === stream) videoEl.value.srcObject = null;
	flashCanToggle.value = false;
	flash.value = false;
	flashBusy.value = false;
}

/** 取消未完成的设备申请并释放流；释放动作保留已有不可用原因，不把错误误改成可启动。 */
function stopQr(): void {
	initializeId++;
	resumeWhenVisible = false;
	releaseCamera();
	if (cameraState.value.status !== 'error') cameraState.value = { status: 'stopped' };
	flashFailed.value = false;
}

/** 更新当前公开的设备清单；失败只影响切换能力，不停止仍然健康的视频流。 */
async function refreshCameraList(): Promise<QrCameraDevice[] | null> {
	if (!componentActive || window.document.hidden || cameraEnvironmentBlocked.value || cameraState.value.status === 'starting') return null;
	const currentId: number = ++cameraListId;
	const startId: number = initializeId;
	cameraListBusy.value = true;
	try {
		const devices: QrCameraDevice[] = await listQrCameras();
		if (!componentActive || window.document.hidden || currentId !== cameraListId || startId !== initializeId) return null;
		cameras.value = devices;
		cameraListFailed.value = false;
		if (selectedCameraId && !devices.some(
			/** 失效的精确设备约束不应困住后续人工重试。 */
			(camera: QrCameraDevice): boolean => camera.id === selectedCameraId,
		)) selectedCameraId = undefined;
		if (devices.length > 0 && cameraState.value.status === 'error' && cameraState.value.reason === 'notFound') {
			cameraState.value = { status: 'stopped' };
		}
		return devices;
	} catch (error: unknown) {
		if (!componentActive || window.document.hidden || currentId !== cameraListId || startId !== initializeId) return null;
		cameraListFailed.value = true;
		console.warn('QR cameras could not be listed.', error);
		return null;
	} finally {
		if (currentId === cameraListId) cameraListBusy.value = false;
	}
}

/** 手动重新检测只更新设备能力，由用户决定是否再次申请摄像头。 */
async function handleRefreshCameras(): Promise<void> {
	if (cameraListBusy.value || !showCameraRefresh.value) return;
	await refreshCameraList();
}

/** 设备插拔仅刷新公开清单，不因为事件自动打开另一条摄像头流。 */
function handleDevicesChanged(): void {
	void refreshCameraList();
}

/** 当前轨道自然结束时释放旧流并重查设备，无设备与可重试读取错误分别反馈。 */
async function handleCameraEnded(): Promise<void> {
	stopQr();
	cameraState.value = { status: 'error', reason: 'notReadable' };
	const currentId: number = initializeId;
	const devices: QrCameraDevice[] | null = await refreshCameraList();
	if (!isCurrentStart(currentId) || cameraState.value.status !== 'error' || cameraState.value.reason !== 'notReadable') return;
	if (devices?.length === 0) cameraState.value = { status: 'error', reason: 'notFound' };
}

/** 先由原生适配器申请媒体，再把已有流交给解码器，避免库重试吞掉原始失败原因。 */
async function startQr(): Promise<void> {
	const scanner: QrScanner | null = scannerInstance;
	const video: HTMLVideoElement | null = videoEl.value;
	if (!componentActive || window.document.hidden || !scanner || !video || !canStartCamera.value) return;
	const currentId: number = ++initializeId;
	resumeWhenVisible = false;
	cameraState.value = { status: 'starting' };
	flashFailed.value = false;
	let stream: MediaStream | null = null;
	try {
		stream = await openQrCamera(selectedCameraId);
		if (!isCurrentStart(currentId)) {
			stopQrCamera(stream);
			return;
		}
		ownedStream = stream;
		unsubscribeEnded = subscribeQrCameraEnded(stream,
			/** 旧轨道的结束事件不能释放随后申请的媒体流。 */
			(): void => {
				if (ownedStream === stream && isCurrentStart(currentId)) void handleCameraEnded();
			},
		);
		video.srcObject = stream;
		await scanner.start();
		if (!isCurrentStart(currentId)) {
			stopQrCamera(stream);
			return;
		}
		flashCanToggle.value = getQrCameraFlashAvailable(stream);
		cameraState.value = { status: 'running' };
		await refreshCameraList();
	} catch (error: unknown) {
		if (!isCurrentStart(currentId)) {
			stopQrCamera(stream);
			return;
		}
		releaseCamera();
		cameraState.value = { status: 'error', reason: getQrCameraErrorCode(error) };
		console.error('QR camera could not be started.', error);
		if (!cameraEnvironmentBlocked.value && cameraState.value.reason !== 'notFound') await refreshCameraList();
	}
}

/** 选择前复核设备清单；枚举失败或单镜头不弹选择器，也不关闭正在运行的摄像头。 */
async function chooseCamera(): Promise<void> {
	if (!componentActive || !canChooseCamera.value) return;
	const currentId: number = initializeId;
	const devices: QrCameraDevice[] | null = await refreshCameraList();
	if (!devices || !isCurrentStart(currentId) || !canChooseCamera.value) return;
	const selection: Awaited<ReturnType<typeof os.select<string>>> = await os.select({
		/** 设备选择弹窗沿用现有标题。 */
		title: i18n.ts._qr.chooseCamera,
		/** 设备 ID 原样传递，空标签仅在显示层补上序号。 */
		items: selectableCameras.value.map(
			/** 将设备列表映射为选择项，不为获取名称另开摄像头。 */
			(camera: QrCameraDevice, index: number): { label: string; value: string } => ({
				/** 未公开名称时仍提供可理解的本地化标签。 */
				label: camera.label || i18n.tsx._qr.cameraNumber({ number: index + 1 }),
				/** 选择的设备 ID 是下次原生请求的精确约束。 */
				value: camera.id,
			}),
		),
	});
	if (selection.canceled || selection.result == null || !isCurrentStart(currentId)) return;
	if (!selectableCameras.value.some(
		/** 选择弹窗打开期间已经移除的设备不能重新接管健康视频流。 */
		(camera: QrCameraDevice): boolean => camera.id === selection.result,
	)) return;
	selectedCameraId = selection.result;
	stopQr();
	await startQr();
}

/** 在现有流上开灯；关灯通过受控重启释放点亮的轨道，沿用扫码库原有的可靠熄灯语义。 */
async function toggleFlash(): Promise<void> {
	if (!qrStarted.value || !flashCanToggle.value || flashBusy.value) return;
	if (flash.value) {
		stopQr();
		await startQr();
		return;
	}
	const currentId: number = initializeId;
	flashBusy.value = true;
	flashFailed.value = false;
	try {
		await setQrCameraFlash(ownedStream, true);
		if (isCurrentStart(currentId)) flash.value = true;
	} catch (error: unknown) {
		if (!isCurrentStart(currentId)) return;
		flashFailed.value = true;
		console.error('QR camera flash could not be enabled.', error);
	} finally {
		if (isCurrentStart(currentId)) flashBusy.value = false;
	}
}

/** 在库的普通监听器之前停止活动状态，保留不可用原因并在可见时刷新设备。 */
function handleVisibilityChange(): void {
	if (!componentActive) return;
	if (window.document.hidden) {
		const shouldResume: boolean = cameraState.value.status === 'starting' || cameraState.value.status === 'running';
		stopQr();
		resumeWhenVisible = shouldResume;
		cameraListId++;
		cameraListBusy.value = false;
	} else if (componentActive) {
		if (resumeWhenVisible) {
			resumeWhenVisible = false;
			void startQr();
		} else {
			void refreshCameraList();
		}
	}
}

/** 将解码器的实时结果交给原有业务链，并消费异步回调错误以避免未处理拒绝。 */
function handleScanResult(result: QrScanner.ScanResult): void {
	if (!componentActive || !qrStarted.value) return;
	void processResult(result).catch(handleDecodeError);
}

/** 没有发现二维码是正常逐帧结果；其他解码失败使用单个本地化提示。 */
async function handleDecodeError(error: unknown): Promise<void> {
	if (error === QrScanner.NO_QR_CODE_FOUND || alertLock || !componentActive) return;
	alertLock = true;
	console.error(error);
	try {
		await os.alert({ type: 'error', text: i18n.ts._qr.scanFailed });
	} finally {
		alertLock = false;
	}
}

/** 订阅本次活动视图的设备变化；首次挂载与 KeepAlive 激活共用幂等入口。 */
function subscribeDevices(): void {
	if (unsubscribeDevices === null) unsubscribeDevices = subscribeQrCameraChanges(handleDevicesChanged);
}

/** 失活时取消设备订阅与未完成结果提交；已有完成结果留在缓存页面中。 */
function deactivateReader(): void {
	const shouldResume: boolean = cameraState.value.status === 'starting' || cameraState.value.status === 'running';
	componentActive = false;
	stopQr();
	resumeWhenVisible = shouldResume;
	unsubscribeDevices?.();
	unsubscribeDevices = null;
	cameraListId++;
	cameraListBusy.value = false;
	resultSessionId++;
	pendingResults.value.clear();
	imageTaskState.value = 'idle';
}

onMounted(
	/** 每个视图只创建一个解码器实例，并在首次挂载时发起受控摄像头申请。 */
	(): void => {
		componentActive = true;
		if (!videoEl.value || !overlayEl.value) {
			cameraState.value = { status: 'error', reason: 'unknown' };
			return;
		}
		scannerInstance = new QrScanner(videoEl.value, handleScanResult, {
			/** 保留原扫描范围高亮。 */
			highlightScanRegion: true,
			/** 保留识别到的二维码轮廓。 */
			highlightCodeOutline: true,
			/** 使用当前视图管理的覆盖层。 */
			overlay: overlayEl.value,
			/** 沿用全画面扫描与短边降采样，解码不依赖预览区域的显示大小。 */
			calculateScanRegion(video: HTMLVideoElement): QrScanner.ScanRegion {
				const aspectRatio: number = video.videoWidth / video.videoHeight;
				const shortSideSize: number = 360;
				return {
					/** 扫描区域从视频左上角开始。 */
					x: 0,
					/** 扫描区域从视频顶部开始。 */
					y: 0,
					/** 保留完整视频宽度。 */
					width: video.videoWidth,
					/** 保留完整视频高度。 */
					height: video.videoHeight,
					/** 横屏时按短边比例缩小宽度。 */
					downScaledWidth: aspectRatio > 1 ? Math.round(shortSideSize * aspectRatio) : shortSideSize,
					/** 竖屏时按短边比例缩小高度。 */
					downScaledHeight: aspectRatio > 1 ? shortSideSize : Math.round(shortSideSize / aspectRatio),
				};
			},
			/** 解码失败由页面统一处理，不透传英文库错误。 */
			onDecodeError: handleDecodeError,
		});
		window.document.addEventListener('visibilitychange', handleVisibilityChange, true);
		subscribeDevices();
		void startQr();
	},
);

onActivated(
	/** 缓存视图恢复时重新订阅设备；用户暂停和已有错误保持原态，首次挂载不重复开流。 */
	(): void => {
		if (componentActive) return;
		componentActive = true;
		subscribeDevices();
		if (resumeWhenVisible) {
			void startQr();
		} else {
			void refreshCameraList();
		}
	},
);

onDeactivated(deactivateReader);

onBeforeUnmount(
	/** 在 DOM 移除前停止媒体与库事件；迟到请求只能清理自身，不能更新新会话。 */
	(): void => {
		deactivateReader();
		window.document.removeEventListener('visibilitychange', handleVisibilityChange, true);
		scannerInstance?.destroy();
		scannerInstance = null;
	},
);
</script>

<style lang="scss" module>
.root {
	position: relative;
	min-width: 0;
}

.camera {
	position: relative;
}

.view {
	position: relative;
	background: var(--MI_THEME-bg);
	width: 100%;
	height: var(--MI-QrReadVideoHeight);
	min-height: 180px;

	&.compact {
		height: auto;
		min-height: 0;
	}
}

.video {
	width: 100%;
	height: 100%;
	object-fit: contain;

	&.inactive {
		position: absolute;
		inset: 0;
		opacity: 0;
		pointer-events: none;
	}
}

.status {
	position: relative;
	display: flex;
	align-items: flex-start;
	gap: var(--MI-margin);
	box-sizing: border-box;
	padding: var(--MI-margin);
	color: var(--MI_THEME-fg);

	> i {
		flex-shrink: 0;
		font-size: 32px;
	}
}

.statusText {
	min-width: 0;
	line-height: 1.6;

	> p {
		margin: 4px 0 0;
	}
}

.controls,
.cameraActions {
	display: flex;
	align-items: center;
	gap: 10px;
}

.controls {
	flex-wrap: wrap;
	justify-content: space-between;
	padding: var(--MI-margin);
}

.cameraActions {
	flex-shrink: 0;
	margin-inline-start: auto;
}

.buttonLabel {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.deviceHelp {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 0 var(--MI-margin) var(--MI-margin);
	color: var(--MI_THEME-fg);
	line-height: 1.5;

	> p {
		flex: 1 1 12em;
		margin: 0;
	}
}

.processing {
	margin: 0;
	padding: 0 var(--MI-margin) var(--MI-margin);
	color: var(--MI_THEME-fg);
	line-height: 1.5;
}

.flashError {
	margin: 0 var(--MI-margin) var(--MI-margin);
	color: var(--MI_THEME-error);
	line-height: 1.5;
}

.contents {
	padding-top: calc(var(--MI-margin) / 2);
}

.tab {
	padding: calc(var(--MI-margin) / 2) 0;
	background: var(--MI_THEME-bg);
}

.empty {
	grid-column: 1 / -1;
	margin: var(--MI-margin);
	color: var(--MI_THEME-fg);
	line-height: 1.6;
	text-align: center;
}

.users {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
	gap: var(--MI-margin);
}

.note {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}

.twitter {
	color: var(--twitter-fg);
	background: var(--twitter-panel);

	.camera {
		border-bottom: 1px solid var(--twitter-border);
		background: var(--twitter-panel);
	}

	.view {
		height: clamp(220px, 30cqh, 320px);
		background: var(--twitter-hover);

		&.compact {
			height: auto;
			background: var(--twitter-panel);
			padding: var(--twitter-space-4) var(--twitter-space-4) 0;
			box-sizing: border-box;
		}
	}

	.status {
		gap: var(--twitter-space-3);
		padding: var(--twitter-space-4);
		border: 1px solid var(--twitter-border);
		border-radius: var(--twitter-radius-large);
		background: var(--twitter-hover);
		color: var(--twitter-secondary-fg);
		font-size: var(--twitter-font-size-body);

		> i {
			display: grid;
			place-items: center;
			width: var(--twitter-touch-target);
			height: var(--twitter-touch-target);
			border-radius: var(--twitter-radius-pill);
			background: var(--twitter-panel);
			font-size: var(--twitter-font-size-display);
		}
	}

	.statusText {
		> strong {
			color: var(--twitter-fg);
			font-size: var(--twitter-font-size-emphasis);
		}

		> p {
			margin-top: var(--twitter-space-1);
		}
	}

	.controls {
		gap: var(--twitter-space-3);
		padding: var(--twitter-space-3) var(--twitter-space-4);

		> button {
			min-height: var(--twitter-touch-target);
		}
	}

	.cameraActions {
		gap: var(--twitter-space-2);

		> button {
			min-width: var(--twitter-touch-target);
			min-height: var(--twitter-touch-target);
		}
	}

	.buttonLabel {
		gap: var(--twitter-space-2);
	}

	.imageUpload {
		margin-inline-end: auto;
	}

	.deviceHelp {
		gap: var(--twitter-space-2);
		padding: 0 var(--twitter-space-4) var(--twitter-space-3);
		color: var(--twitter-secondary-fg);
		font-size: var(--twitter-font-size-meta);

		> button {
			min-height: var(--twitter-touch-target);
		}
	}

	.processing {
		padding: 0 var(--twitter-space-4) var(--twitter-space-4);
		color: var(--twitter-secondary-fg);
		font-size: var(--twitter-font-size-body);
	}

	.flashError {
		margin: 0 var(--twitter-space-4) var(--twitter-space-3);
		color: var(--twitter-danger);
		font-size: var(--twitter-font-size-body);
	}

	.contents {
		padding: 0 var(--twitter-space-4);
	}

	.tab {
		padding: var(--twitter-space-2) 0;
		background: var(--twitter-panel);

		> button {
			min-height: var(--twitter-touch-target);
			border-radius: 0;
			background: transparent;
			color: var(--twitter-secondary-fg);
			font-size: var(--twitter-font-size-body);

			&:not(:disabled):hover {
				background: var(--twitter-hover);
				color: var(--twitter-fg);
			}

			&:disabled {
				background: transparent;
				color: var(--twitter-fg);
				font-weight: 700;
				box-shadow: inset 0 -3px 0 var(--twitter-accent);
			}

			&:focus-visible {
				outline: 2px solid var(--twitter-accent);
				outline-offset: -2px;
			}
		}
	}

	// 库在 SVG 上写入固定描边；在实际轮廓元素上使用产品强调色。
	:global(.code-outline-highlight) > polygon {
		stroke: var(--twitter-accent);
	}

	.empty {
		margin: var(--twitter-space-6) var(--twitter-space-4);
		color: var(--twitter-secondary-fg);
		font-size: var(--twitter-font-size-body);
	}

	.users {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}

	.note {
		background: var(--twitter-panel);
		border: 1px solid var(--twitter-border);
		border-radius: var(--twitter-radius-large);
	}
}
</style>
