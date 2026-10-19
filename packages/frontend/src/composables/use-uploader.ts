/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 共享附件上传领域：管理原文件、预处理候选结果与上传任务。
 * 仅允许当前附件的有效任务提交媒体结果，保证取消、重试与移除不会复用失效产物。
 */

import * as Misskey from 'misskey-js';
import { readAndCompressImage } from '@misskey-dev/browser-image-resizer';
import isAnimated from 'is-file-animated';
import { EventEmitter } from 'eventemitter3';
import { computed, markRaw, onUnmounted, ref, triggerRef } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { WatermarkLayers, WatermarkPreset } from '@/utility/watermark/WatermarkRenderer.js';
import type { ImageFrameParams, ImageFramePreset } from '@/utility/image-frame-renderer/ImageFrameRenderer.js';
import { genId } from '@/utility/id.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { isWebpSupported } from '@/utility/isWebpSupported.js';
import { uploadFile, UploadAbortedError } from '@/utility/drive.js';
import type { Content } from '@/components/MkLightbox.item.vue';
import * as os from '@/os.js';
import { isPreviewable, getType } from '@/utility/lightbox.js';
import { ensureSignin } from '@/i.js';
import { compressVideo } from '@/utility/video-preprocessing/index.js';

export type UploaderFeatures = {
	imageEditing?: boolean;
	watermark?: boolean;
};

const THUMBNAIL_SUPPORTED_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/svg+xml',
	'image/gif',
];

const IMAGE_EDITING_SUPPORTED_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
];

const VIDEO_COMPRESSION_SUPPORTED_TYPES = [ // TODO
	'video/mp4',
	'video/quicktime',
	'video/x-matroska',
];

const IMAGE_PREPROCESS_NEEDED_TYPES = [
	...IMAGE_EDITING_SUPPORTED_TYPES,
];

const VIDEO_PREPROCESS_NEEDED_TYPES = [
	...VIDEO_COMPRESSION_SUPPORTED_TYPES,
];

const mimeTypeMap = {
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
	'image/png': 'png',
} as const;

export type UploaderItem = {
	id: string;
	name: string;
	suffix: string;
	progress: { max: number; value: number } | null;
	thumbnail: string | null;
	preprocessing: boolean;
	preprocessProgress: number | null;
	uploading: boolean;
	uploaded: Misskey.entities.DriveFile | null;
	uploadFailed: boolean;
	aborted: boolean;
	compressionLevel: 0 | 1 | 2 | 3;
	compressedSize?: number | null;
	preprocessedFile?: Blob | null;
	file: File;
	objectUrl: string;
	watermarkPreset: WatermarkPreset | null;
	watermarkLayers: WatermarkLayers | null;
	imageFrameParams: ImageFrameParams | null;
	isSensitive?: boolean;
	caption?: string | null;
	abort?: (() => void) | null;
	abortPreprocess?: (() => void) | null;
};

/** 附件操作的临时执行上下文；对象身份用于隔离同一附件的不同尝试。 */
type UploaderTask = {
	controller: AbortController;
	promise: Promise<void>;
};

export function getUploadName(item: UploaderItem): string {
	return item.name + (item.name.endsWith(item.suffix) ? '' : item.suffix);
}

function getCompressionSettings(level: 0 | 1 | 2 | 3) {
	if (level === 1) {
		return {
			maxWidth: 2000,
			maxHeight: 2000,
		};
	} else if (level === 2) {
		return {
			maxWidth: 2000 * 0.75, // =1500
			maxHeight: 2000 * 0.75, // =1500
		};
	} else if (level === 3) {
		return {
			maxWidth: 2000 * 0.75 * 0.75, // =1125
			maxHeight: 2000 * 0.75 * 0.75, // =1125
		};
	} else {
		return null;
	}
}

/** 创建共享上传器，由现有附件状态承载界面数据，由私有任务上下文控制异步提交。 */
export function useUploader(options: {
	folderId?: string | null;
	multiple?: boolean;
	features?: UploaderFeatures;
} = {}) {
	const $i = ensureSignin();

	const events = new EventEmitter<{
		'itemUploaded': (ctx: { item: UploaderItem; }) => void;
	}>();

	const uploaderFeatures = computed<Required<UploaderFeatures>>(() => {
		return {
			imageEditing: options.features?.imageEditing ?? true,
			watermark: options.features?.watermark ?? true,
		};
	});

	const items = ref<UploaderItem[]>([]);
	const preprocessTasks: Map<UploaderItem['id'], UploaderTask> = new Map();
	const uploadTasks: Map<UploaderItem['id'], UploaderTask> = new Map();
	let uploadBatch: UploaderTask | null = null;
	let disposed: boolean = false;

	/** 检查回调仍属于未销毁上传器中的同一个附件和同一次尝试。 */
	function isCurrentTask(item: UploaderItem, task: UploaderTask, tasks: Map<UploaderItem['id'], UploaderTask>): boolean {
		return !disposed && !task.controller.signal.aborted && tasks.get(item.id) === task && items.value.includes(item);
	}

	/** 先使预处理失效，再请求取消，防止旧任务在清理期间回写状态。 */
	function invalidatePreprocess(item: UploaderItem): void {
		const task: UploaderTask | undefined = preprocessTasks.get(item.id);
		preprocessTasks.delete(item.id);
		task?.controller.abort();
		item.abortPreprocess = null;
		item.preprocessing = false;
		item.preprocessProgress = null;
	}

	/** 丢弃压缩产物并恢复原文件的名称、大小与预览来源。 */
	function restoreOriginal(item: UploaderItem): void {
		item.preprocessedFile = null;
		item.compressedSize = null;
		item.suffix = '';
		updateItemObjectUrls(item, item.file);
	}

	/** 取消附件及其所在上传批次；原文件只在下一次明确上传时重新处理。 */
	function cancelItem(item: UploaderItem): void {
		if (item.uploaded != null) return;
		invalidatePreprocess(item);
		const task: UploaderTask | undefined = uploadTasks.get(item.id);
		uploadTasks.delete(item.id);
		task?.controller.abort();
		uploadBatch?.controller.abort();
		uploadBatch = null;
		item.abort = null;
		item.uploading = false;
		item.aborted = true;
		item.uploadFailed = true;
		item.progress = null;
		if (items.value.includes(item)) restoreOriginal(item);
	}

	function initializeFile(file: File) {
		const id = genId();
		const filename = file.name ?? 'untitled';
		const extension = filename.split('.').length > 1 ? '.' + filename.split('.').pop() : '';
		const watermarkPreset = uploaderFeatures.value.watermark && $i.policies.watermarkAvailable ? (prefer.s.watermarkPresets.find(p => p.id === prefer.s.defaultWatermarkPresetId) ?? null) : null;
		const objectUrl = window.URL.createObjectURL(file);
		items.value.push({
			id,
			name: prefer.s.keepOriginalFilename ? filename : id + extension,
			suffix: '',
			progress: null,
			thumbnail: THUMBNAIL_SUPPORTED_TYPES.includes(file.type) ? objectUrl : null,
			preprocessing: false,
			preprocessProgress: null,
			uploading: false,
			aborted: false,
			uploaded: null,
			uploadFailed: false,
			compressionLevel: IMAGE_EDITING_SUPPORTED_TYPES.includes(file.type) ? prefer.s.defaultImageCompressionLevel : VIDEO_COMPRESSION_SUPPORTED_TYPES.includes(file.type) ? prefer.s.defaultVideoCompressionLevel : 0,
			watermarkPreset,
			watermarkLayers: watermarkPreset?.layers ?? null,
			imageFrameParams: null,
			file: markRaw(file),
			objectUrl,
		});
		const reactiveItem = items.value.at(-1)!;
		preprocess(reactiveItem).then(() => {
			triggerRef(items);
		});
	}

	/** 将新文件交给当前上传器；已释放实例不再接收附件。 */
	function addFiles(newFiles: File[]): void {
		if (disposed) return;
		for (const file of newFiles) {
			initializeFile(file);
		}
	}

	function revokeItemObjectUrls(item: UploaderItem) {
		if (item.thumbnail != null) URL.revokeObjectURL(item.thumbnail);
		URL.revokeObjectURL(item.objectUrl);
	}

	function createItemObjectUrl(item: UploaderItem, file: Blob | File): string {
		revokeItemObjectUrls(item);
		return window.URL.createObjectURL(file);
	}

	function updateItemObjectUrls(item: UploaderItem, file: Blob | File) {
		const newObjectUrl = createItemObjectUrl(item, file);
		item.objectUrl = newObjectUrl;
		item.thumbnail = THUMBNAIL_SUPPORTED_TYPES.includes(file.type) ? newObjectUrl : null;
	}

	/** 按既有附件标识移除当前项，先取消任务，避免迟到回调及重复移除误删其他附件。 */
	function removeItem(item: UploaderItem): void {
		const index: number = items.value.findIndex(/** 找到当前数组中的权威附件。 */ (current: UploaderItem): boolean => current.id === item.id);
		if (index < 0) return;
		const current: UploaderItem = items.value[index];
		cancelItem(current);
		revokeItemObjectUrls(current);
		items.value.splice(index, 1);
	}

	function getMenu(item: UploaderItem): MenuItem[] {
		const menu: MenuItem[] = [];

		if (
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			menu.push({
				icon: 'ti ti-forms',
				text: i18n.ts.rename,
				action: async () => {
					const { result, canceled } = await os.inputText({
						type: 'text',
						title: i18n.ts.rename,
						placeholder: item.name,
						default: item.name,
					});
					if (canceled) return;
					if (result.trim() === '') return;

					item.name = result;
				},
			}, {
				type: 'switch',
				text: i18n.ts.sensitive,
				icon: 'ti ti-eye-exclamation',
				ref: computed({
					get: () => item.isSensitive ?? false,
					set: (value) => item.isSensitive = value,
				}),
			}, {
				text: i18n.ts.describeFile,
				icon: 'ti ti-text-caption',
				action: async () => {
					const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkFileCaptionEditWindow.vue').then(x => x.default), {
						default: item.caption ?? null,
					}, {
						done: caption => {
							if (caption != null) {
								item.caption = caption.trim().length === 0 ? null : caption;
							}
						},
						closed: () => dispose(),
					});
				},
			});

			if (isPreviewable(item.file.type)) {
				menu.push({
					text: i18n.ts.preview,
					icon: 'ti ti-photo-search',
					action: async () => {
						const contents = items.value
							.filter(item => isPreviewable(item.file.type))
							.map<Content>(item => ({
								id: item.id,
								type: getType(item.file.type),
								url: item.objectUrl,
								thumbnail: item.thumbnail,
								filename: getUploadName(item),
								caption: item.caption ?? null,
							}));

						const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(x => x.default), {
							defaultIndex: contents.findIndex(x => x.id === item.id),
							contents,
						}, {
							closed: () => dispose(),
						});
					},
				});
			}

			menu.push({
				type: 'divider',
			});
		}

		if (
			uploaderFeatures.value.imageEditing &&
			IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type) &&
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			menu.push({
				type: 'parent',
				icon: 'ti ti-photo-edit',
				text: i18n.ts._uploader.editImage,
				children: [{
					icon: 'ti ti-crop',
					text: i18n.ts.cropImage,
					/** 仅向仍在上传器中的可编辑附件提交裁剪结果。 */
					action: async (): Promise<void> => {
						const cropped: File = await os.cropImageFile(item.file, { aspectRatio: null });
						if (disposed || !items.value.includes(item) || item.uploading || item.uploaded != null) return;
						item.file = markRaw(cropped);
						preprocess(item).then(/** 通知既有附件视图刷新处理结果。 */ (): void => {
							triggerRef(items);
						});
					},
				}, /*{
					icon: 'ti ti-resize',
					text: i18n.ts.resize,
					action: async () => {
						// TODO
					},
				},*/ {
					icon: 'ti ti-sparkles',
					text: i18n.ts._imageEffector.title,
					action: async () => {
						const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkImageEffectorDialog.vue').then(x => x.default), {
							image: item.file,
						}, {
							/** 仅向仍可编辑的原附件提交图片效果，保持附件身份不变。 */
							ok: (file: File): void => {
								if (disposed || !items.value.includes(item) || item.uploading || item.uploaded != null) return;
								item.file = markRaw(file);
								preprocess(item).then(/** 通知既有附件视图刷新处理结果。 */ (): void => {
									triggerRef(items);
								});
							},
							closed: () => dispose(),
						});
					},
				}],
			});
		}

		if (
			uploaderFeatures.value.watermark &&
			$i.policies.watermarkAvailable &&
			IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type) &&
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			function change(layers: WatermarkLayers | null, preset?: WatermarkPreset | null) {
				item.watermarkPreset = preset ?? null;
				item.watermarkLayers = layers;
				preprocess(item).then(() => {
					triggerRef(items);
				});
			}

			menu.push({
				icon: 'ti ti-copyright',
				text: i18n.ts.watermark,
				caption: computed(() => item.watermarkPreset != null ? item.watermarkPreset.name : item.watermarkLayers != null ? i18n.ts.custom : null),
				type: 'parent',
				children: [{
					type: 'button' as const,
					icon: 'ti ti-pencil',
					text: i18n.ts.edit,
					action: async () => {
						const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkWatermarkEditorDialog.vue').then(x => x.default), {
							layers: item.watermarkLayers,
							image: item.file,
						}, {
							ok: (layers) => {
								change(layers);
							},
							closed: () => dispose(),
						});
					},
				}, {
					type: 'button' as const,
					icon: 'ti ti-x',
					text: i18n.ts.remove,
					action: () => change(null),
				}, {
					type: 'divider',
				}, {
					type: 'label',
					text: i18n.ts.presets,
				}, ...prefer.s.watermarkPresets.map(preset => ({
					type: 'radioOption' as const,
					text: preset.name,
					active: computed(() => item.watermarkPreset?.id === preset.id),
					action: () => change(preset.layers, preset),
				}))],
			});
		}

		if (
			uploaderFeatures.value.imageEditing &&
			IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type) &&
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			function change(params: ImageFrameParams | null) {
				item.imageFrameParams = params;
				preprocess(item).then(() => {
					triggerRef(items);
				});
			}

			menu.push({
				icon: 'ti ti-device-ipad-horizontal',
				text: i18n.ts.frame,
				type: 'parent' as const,
				children: [{
					type: 'button' as const,
					icon: 'ti ti-pencil',
					text: i18n.ts.edit,
					action: async () => {
						const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkImageFrameEditorDialog.vue').then(x => x.default), {
							params: item.imageFrameParams,
							image: item.file,
							imageCaption: item.caption ?? null,
							imageFilename: item.name,
						}, {
							ok: (params) => {
								change(params);
							},
							closed: () => dispose(),
						});
					},
				}, ...(item.imageFrameParams != null ? [{
					type: 'button' as const,
					icon: 'ti ti-x',
					text: i18n.ts.remove,
					action: () => change(null),
				}] : []), {
					type: 'divider' as const,
				}, {
					type: 'label' as const,
					text: i18n.ts.presets,
				}, ...prefer.s.imageFramePresets.map(preset => ({
					type: 'button' as const,
					text: preset.name,
					action: async () => {
						const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkImageFrameEditorDialog.vue').then(x => x.default), {
							params: preset.params,
							image: item.file,
							imageCaption: item.caption ?? null,
							imageFilename: item.name,
						}, {
							ok: (params) => {
								change(params);
							},
							closed: () => dispose(),
						});
					},
				}))],
			});
		}

		if (
			(IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type) || VIDEO_COMPRESSION_SUPPORTED_TYPES.includes(item.file.type)) &&
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			function changeCompressionLevel(level: 0 | 1 | 2 | 3) {
				item.compressionLevel = level;
				preprocess(item).then(() => {
					triggerRef(items);
				});
			}

			menu.push({
				icon: 'ti ti-leaf',
				text: computed(() => {
					let text = i18n.ts.compress;

					if (item.compressionLevel === 0 || item.compressionLevel == null) {
						text += `: ${i18n.ts.none}`;
					} else if (item.compressionLevel === 1) {
						text += `: ${i18n.ts.low}`;
					} else if (item.compressionLevel === 2) {
						text += `: ${i18n.ts.medium}`;
					} else if (item.compressionLevel === 3) {
						text += `: ${i18n.ts.high}`;
					}

					return text;
				}),
				type: 'parent',
				children: [{
					type: 'radioOption',
					text: i18n.ts.none,
					active: computed(() => item.compressionLevel === 0 || item.compressionLevel == null),
					action: () => changeCompressionLevel(0),
				}, {
					type: 'divider',
				}, {
					type: 'radioOption',
					text: i18n.ts.low,
					active: computed(() => item.compressionLevel === 1),
					action: () => changeCompressionLevel(1),
				}, {
					type: 'radioOption',
					text: i18n.ts.medium,
					active: computed(() => item.compressionLevel === 2),
					action: () => changeCompressionLevel(2),
				}, {
					type: 'radioOption',
					text: i18n.ts.high,
					active: computed(() => item.compressionLevel === 3),
					action: () => changeCompressionLevel(3),
				}],
			});
		}

		if (!item.preprocessing && !item.uploading && !item.uploaded) {
			menu.push({
				type: 'divider',
			}, {
				icon: 'ti ti-upload',
				text: i18n.ts.upload,
				action: () => {
					uploadOne(item);
				},
			}, {
				icon: 'ti ti-x',
				text: i18n.ts.remove,
				danger: true,
				action: () => {
					removeItem(item);
				},
			});
		} else if (item.preprocessing && item.abortPreprocess != null) {
			menu.push({
				type: 'divider',
			}, {
				icon: 'ti ti-player-stop',
				text: i18n.ts.abort,
				danger: true,
				action: () => {
					if (item.abortPreprocess != null) {
						item.abortPreprocess();
					}
				},
			});
		} else if (item.uploading) {
			menu.push({
				type: 'divider',
			}, {
				icon: 'ti ti-cloud-pause',
				text: i18n.ts.abort,
				danger: true,
				action: () => {
					if (item.abort != null) {
						item.abort();
					}
				},
			});
		}

		return menu;
	}

	/** 处理同一附件的重复上传请求，保留原对象并在显式重试时重新准备文件。 */
	function uploadOne(item: UploaderItem): Promise<void> {
		if (disposed || !items.value.includes(item)) return Promise.reject(new UploadAbortedError());
		if (item.uploaded != null) return Promise.resolve();
		const existing: UploaderTask | undefined = uploadTasks.get(item.id);
		if (existing != null) return existing.promise;

		const retry: boolean = item.aborted || item.uploadFailed;
		const task: UploaderTask = { controller: new AbortController(), promise: Promise.resolve() };
		uploadTasks.set(item.id, task);
		item.aborted = false;
		item.uploadFailed = false;
		item.progress = null;
		task.promise = executeUpload(item, task, retry);
		// 菜单和通用上传弹窗允许不等待；保留原 Promise 的拒绝供发帖调用方中止提交。
		void task.promise.catch(/** 消费无人等待的失败，不改变调用方收到的原 Promise。 */ (): void => {});
		return task.promise;
	}

	/** 等待当前预处理完成后上传，并以任务身份保护所有网络回调。 */
	async function executeUpload(item: UploaderItem, task: UploaderTask, retry: boolean): Promise<void> {
		let abortNetwork: (() => void) | null = null;
		try {
			if (retry || (item.preprocessedFile == null && !preprocessTasks.has(item.id))) {
				await preprocess(item);
			}
			while (preprocessTasks.has(item.id)) {
				if (!isCurrentTask(item, task, uploadTasks)) throw new UploadAbortedError();
				await preprocessTasks.get(item.id)!.promise;
			}
			if (!isCurrentTask(item, task, uploadTasks) || item.aborted) throw new UploadAbortedError();

			item.uploading = true;
			const uploadResult: ReturnType<typeof uploadFile> = uploadFile(item.preprocessedFile ?? item.file, {
				name: getUploadName(item),
				folderId: options.folderId === undefined ? prefer.s.uploadFolder : options.folderId,
				isSensitive: item.isSensitive ?? false,
				caption: item.caption ?? null,
				/** 仅把当前请求的传输进度写入附件。 */
				onProgress: (progress: { total: number; loaded: number }): void => {
					if (!isCurrentTask(item, task, uploadTasks)) return;
					item.progress = { max: progress.total, value: progress.loaded };
				},
			});
			abortNetwork = uploadResult.abort;
			task.controller.signal.addEventListener('abort', abortNetwork, { once: true });
			/** 用户取消同步失效该请求，迟到响应不能提交。 */
			item.abort = (): void => {
				if (isCurrentTask(item, task, uploadTasks)) cancelItem(item);
			};

			const file: Misskey.entities.DriveFile = await uploadResult.filePromise;
			if (!isCurrentTask(item, task, uploadTasks)) throw new UploadAbortedError();
			item.uploaded = file;
			item.abort = null;
			item.uploading = false;
			uploadTasks.delete(item.id);
			// 消费者可能在事件中立即移除已上传项，成功事实必须先提交。
			events.emit('itemUploaded', { item });
		} catch (err: unknown) {
			if (isCurrentTask(item, task, uploadTasks)) {
				item.uploadFailed = true;
				item.progress = null;
			}
			if (task.controller.signal.aborted) throw new UploadAbortedError();
			throw err;
		} finally {
			if (abortNetwork != null) task.controller.signal.removeEventListener('abort', abortNetwork);
			if (uploadTasks.get(item.id) === task) {
				uploadTasks.delete(item.id);
				if (items.value.includes(item)) {
					item.uploading = false;
					item.abort = null;
				}
			}
		}
	}

	/** 复用正在执行的批次，逐项上传；取消或缺少附件时拒绝，阻止缺附件发帖。 */
	function upload(): Promise<void> {
		if (disposed) return Promise.reject(new UploadAbortedError());
		if (uploadBatch != null) return uploadBatch.promise;
		const task: UploaderTask = { controller: new AbortController(), promise: Promise.resolve() };
		const pending: UploaderItem[] = items.value.filter(/** 仅选择本次需要上传的附件。 */ (item: UploaderItem): boolean => item.uploaded == null);
		uploadBatch = task;
		task.promise = executeBatch(pending, task);
		void task.promise.catch(/** 保留拒绝语义，同时兼容不等待结果的既有上传入口。 */ (): void => {});
		return task.promise;
	}

	/** 执行固定附件集合，旧批次取消后不得继续上传后续附件。 */
	async function executeBatch(pending: UploaderItem[], task: UploaderTask): Promise<void> {
		try {
			for (const item of pending) {
				if (item.uploaded != null) continue;
				if (disposed || task.controller.signal.aborted) throw new UploadAbortedError();
				if (!items.value.includes(item)) throw new UploadAbortedError();
				await uploadOne(item);
			}
			// 上传期间追加的附件必须留给下一次明确上传，不能把当前批次作为全部成功返回。
			if (items.value.some(/** 检查仍在上传器中等待提交的附件。 */ (item: UploaderItem): boolean => item.uploaded == null)) {
				throw new UploadAbortedError();
			}
		} finally {
			if (uploadBatch === task) uploadBatch = null;
		}
	}

	/** 同步取消整个批次和所有未上传附件，不把取消解释为原文件回退。 */
	function abortAll(): void {
		uploadBatch?.controller.abort();
		uploadBatch = null;
		for (const item of items.value) cancelItem(item);
	}

	/** 为附件创建新预处理尝试；清除旧产物后只在本地候选对象中计算结果。 */
	function preprocess(item: UploaderItem): Promise<void> {
		if (disposed || !items.value.includes(item) || item.uploading || item.uploaded != null) return Promise.resolve();
		invalidatePreprocess(item);
		restoreOriginal(item);
		item.aborted = false;
		item.uploadFailed = false;
		item.preprocessing = true;
		const task: UploaderTask = { controller: new AbortController(), promise: Promise.resolve() };
		const candidate: UploaderItem = { ...item };
		preprocessTasks.set(item.id, task);
		/** 取消入口只失效当前任务，由下次明确上传重新预处理。 */
		item.abortPreprocess = (): void => {
			if (isCurrentTask(item, task, preprocessTasks)) cancelItem(item);
		};
		task.promise = executePreprocess(item, candidate, task);
		return task.promise;
	}

	/** 分离候选计算和最终提交；失败回退原文件，过期任务不更新数据或预览 URL。 */
	async function executePreprocess(item: UploaderItem, candidate: UploaderItem, task: UploaderTask): Promise<void> {
		try {
			try {
				if (IMAGE_PREPROCESS_NEEDED_TYPES.includes(candidate.file.type)) {
					await preprocessForImage(candidate);
				} else if (VIDEO_PREPROCESS_NEEDED_TYPES.includes(candidate.file.type)) {
					await preprocessForVideo(candidate, task.controller.signal,
						/** 进度只属于仍然有效的预处理尝试。 */
						(progress: number): void => {
							if (isCurrentTask(item, task, preprocessTasks)) item.preprocessProgress = progress;
						});
				}
			} catch (err: unknown) {
				if (!isCurrentTask(item, task, preprocessTasks)) return;
				candidate.preprocessedFile = null;
				candidate.compressedSize = null;
				candidate.suffix = '';
				console.error('Failed to preprocess attachment; keeping original file', err);
				if (VIDEO_PREPROCESS_NEEDED_TYPES.includes(candidate.file.type)) {
					os.toast(i18n.tsx._uploader.videoCompressionFallback({ name: item.name }));
				}
			}

			if (!isCurrentTask(item, task, preprocessTasks)) return;
			const file: Blob = candidate.preprocessedFile ?? candidate.file;
			updateItemObjectUrls(item, file);
			item.preprocessedFile = markRaw(file);
			item.compressedSize = candidate.compressedSize;
			item.suffix = candidate.suffix;
		} finally {
			if (isCurrentTask(item, task, preprocessTasks)) {
				preprocessTasks.delete(item.id);
				item.preprocessing = false;
				item.preprocessProgress = null;
				item.abortPreprocess = null;
			}
		}
	}

	/** 在未提交的候选附件上完成既有图片处理，预览 URL 由公共入口统一提交。 */
	async function preprocessForImage(item: UploaderItem): Promise<void> {
		const imageBitmap = await window.createImageBitmap(item.file);

		let preprocessedFile: Blob | File = item.file;

		const needsWatermark = item.watermarkLayers != null && IMAGE_EDITING_SUPPORTED_TYPES.includes(preprocessedFile.type) && $i.policies.watermarkAvailable;
		if (needsWatermark && item.watermarkLayers != null) {
			const canvas = window.document.createElement('canvas');
			const WatermarkRenderer = await import('@/utility/watermark/WatermarkRenderer.js').then(x => x.WatermarkRenderer);
			const renderer = new WatermarkRenderer({
				canvas: canvas,
				renderWidth: imageBitmap.width,
				renderHeight: imageBitmap.height,
				image: imageBitmap,
			});

			await renderer.render(item.watermarkLayers);

			preprocessedFile = await new Promise<Blob>((resolve) => {
				canvas.toBlob((blob) => {
					if (blob == null) {
						throw new Error('Failed to convert canvas to blob');
					}
					resolve(blob);
					renderer.destroy();
				}, 'image/png');
			});
		}

		const needsImageFrame = item.imageFrameParams != null && IMAGE_EDITING_SUPPORTED_TYPES.includes(preprocessedFile.type);
		if (needsImageFrame && item.imageFrameParams != null) {
			const canvas = window.document.createElement('canvas');
			const ExifReader = await import('exifreader');
			const exif = await ExifReader.load(await item.file.arrayBuffer());
			const ImageFrameRenderer = await import('@/utility/image-frame-renderer/ImageFrameRenderer.js').then(x => x.ImageFrameRenderer);
			const frameRenderer = new ImageFrameRenderer({
				canvas: canvas,
				image: await window.createImageBitmap(preprocessedFile),
				exif,
				caption: item.caption ?? null,
				filename: item.name,
			});

			await frameRenderer.render(item.imageFrameParams);

			preprocessedFile = await new Promise<Blob>((resolve) => {
				canvas.toBlob((blob) => {
					if (blob == null) {
						throw new Error('Failed to convert canvas to blob');
					}
					resolve(blob);
					frameRenderer.destroy();
				}, 'image/png');
			});
		}

		const compressionSettings = getCompressionSettings(item.compressionLevel);
		const needsCompress = item.compressionLevel !== 0 && compressionSettings && IMAGE_EDITING_SUPPORTED_TYPES.includes(preprocessedFile.type) && !(await isAnimated(preprocessedFile));

		if (needsCompress) {
			const config = {
				mimeType: (isWebpSupported() ? 'image/webp' : 'image/jpeg') as 'image/webp' | 'image/jpeg',
				maxWidth: compressionSettings.maxWidth,
				maxHeight: compressionSettings.maxHeight,
				quality: isWebpSupported() ? 0.85 : 0.8,
			};

			try {
				const result = await readAndCompressImage(preprocessedFile, config);
				if (result.size < preprocessedFile.size || preprocessedFile.type === 'image/webp') {
					// The compression may not always reduce the file size
					// (and WebP is not browser safe yet)
					preprocessedFile = result;
					item.compressedSize = result.size;
					item.suffix = '.' + mimeTypeMap[config.mimeType];
				}
			} catch (err) {
				console.error('Failed to resize image', err);
			}
		} else {
			item.compressedSize = null;
			item.suffix = '';
		}

		imageBitmap.close();

		item.preprocessedFile = markRaw(preprocessedFile);
	}

	/** 调用共享媒体适配器，仅向候选对象写入完整压缩结果。 */
	async function preprocessForVideo(item: UploaderItem, signal: AbortSignal, onProgress: (progress: number) => void): Promise<void> {
		if (item.compressionLevel === 0) {
			item.preprocessedFile = item.file;
			return;
		}

		const mediabunny: typeof import('mediabunny') = await import('mediabunny');
		signal.throwIfAborted();
		const file: Blob = await compressVideo(item.file, {
			bitrate: item.compressionLevel === 1 ? mediabunny.QUALITY_VERY_HIGH : item.compressionLevel === 2 ? mediabunny.QUALITY_MEDIUM : mediabunny.QUALITY_VERY_LOW,
			signal,
			onProgress,
		});
		item.preprocessedFile = markRaw(file);
		item.compressedSize = file.size;
		item.suffix = '.mp4';
	}

	/** 清空当前附件和任务，保留上传器供下一次使用。 */
	function reset(): void {
		abortAll();
		for (const item of items.value) revokeItemObjectUrls(item);
		items.value = [];
	}

	/** 永久关闭上传器；显式释放与卸载钩子重复调用时保持幂等。 */
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		reset();
	}

	onUnmounted(() => {
		dispose();
	});

	return {
		items,
		addFiles,
		removeItem,
		abortAll,
		reset,
		dispose,
		upload,
		getMenu,
		uploading: computed(() => items.value.some(item => item.uploading)),
		readyForUpload: computed(() => items.value.length > 0 && items.value.some(item => item.uploaded == null) && !items.value.some(item => item.uploading || item.preprocessing)),
		allItemsUploaded: computed(() => items.value.every(item => item.uploaded != null)),
		events,
	};
}

