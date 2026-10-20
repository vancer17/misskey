/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：网盘文件传输与选择工具。
 * 作用：复用既有网盘接口上传素材，并交付文件回执或明确的失败／取消结果。
 * 数据链：本地 File／Blob → 网盘上传协议 → DriveFile；业务保存由调用方独立完成。
 */

import { defineAsyncComponent } from 'vue';
import * as Misskey from 'misskey-js';
import { apiUrl } from '@@/js/config.js';
import type { UploaderFeatures } from '@/composables/use-uploader.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { globalEvents } from '@/events.js';
import { getProxiedImageUrl } from '@/utility/media-proxy.js';
import { genId } from '@/utility/id.js';

/** 上传传输句柄；文件回执与主动取消共享同一次请求。 */
type UploadReturnType = {
	filePromise: Promise<Misskey.entities.DriveFile>;
	abort: () => void;
};

/** 保留既有取消错误类型，供调用方区分用户取消与上传故障。 */
export class UploadAbortedError extends Error {
	/** 建立上传取消回执，不代表已经保存的网盘文件被删除。 */
	constructor() {
		super('Upload aborted');
	}
}

/** 原样提交文件及既有上传参数，所有传输终态均结束文件 Promise。 */
export function uploadFile(file: File | Blob, options: {
	name?: string;
	folderId?: string | null;
	isSensitive?: boolean;
	caption?: string | null;
	onProgress?: (ctx: { total: number; loaded: number; }) => void;
} = {}): UploadReturnType {
	const xhr: XMLHttpRequest = new XMLHttpRequest();
	const abortController: AbortController = new AbortController();
	const signal: AbortSignal = abortController.signal;

	const filePromise: Promise<Misskey.entities.DriveFile> = new Promise<Misskey.entities.DriveFile>(
		/** 将 XHR 回调收敛为一次性上传回执，迟到事件不得重复发布文件。 */
		(resolve: (value: Misskey.entities.DriveFile | PromiseLike<Misskey.entities.DriveFile>) => void, reject: (reason?: unknown) => void): void => {
			let settled: boolean = false;

			/** 释放本次请求的回调；终态后不再发布进度或文件事件。 */
			function finish(): boolean {
				if (settled) return false;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				xhr.onload = null;
				xhr.onerror = null;
				xhr.onabort = null;
				xhr.ontimeout = null;
				xhr.upload.onprogress = null;
				return true;
			}

			/** 失败只结束传输，由既有提示及调用方负责呈现可恢复状态。 */
			function fail(reason?: unknown): void {
				if (finish()) reject(reason);
			}

			/** 主动取消及浏览器中止事件都沿用既有取消错误。 */
			function onAbort(): void { fail(new UploadAbortedError()); }

			if ($i == null) return fail();

			// こっち側で検出するMIME typeとサーバーで検出するMIME typeは異なる場合があるため、こっち側ではやらないことにする
			// https://github.com/misskey-dev/misskey/issues/16091
			//const allowedMimeTypes = $i.policies.uploadableFileTypes;
			//const isAllowedMimeType = allowedMimeTypes.some(mimeType => {
			//	if (mimeType === '*' || mimeType === '*/*') return true;
			//	if (mimeType.endsWith('/*')) return file.type.startsWith(mimeType.slice(0, -1));
			//	return file.type === mimeType;
			//});
			//if (!isAllowedMimeType) {
			//	os.alert({
			//		type: 'error',
			//		title: i18n.ts.failedToUpload,
			//		text: i18n.ts.cannotUploadBecauseUnallowedFileType,
			//	});
			//	return reject();
			//}

			if ((file.size > instance.maxFileSize) || (file.size > ($i.policies.maxFileSizeMb * 1024 * 1024))) {
				os.alert({
					type: 'error',
					title: i18n.ts.failedToUpload,
					text: i18n.ts.cannotUploadBecauseExceedsFileSizeLimit,
				});
				return fail();
			}

			signal.addEventListener('abort', onAbort, { once: true });

			xhr.open('POST', apiUrl + '/drive/files/create', true);
			xhr.onerror = /** 网络错误必须交付拒绝，避免调用方永久等待上传。 */ (): void => { fail(new Error('Upload network error')); };
			xhr.onabort = onAbort;
			xhr.ontimeout = /** 收敛浏览器超时事件；不新增超时时长或运行配置。 */ (): void => { fail(new Error('Upload timed out')); };
			xhr.onload = /** 解析既有上传协议，异常响应也必须结束当前传输。 */ (): void => {
				if (settled) return;
				let driveFile: Misskey.entities.DriveFile;
				try {
					if (xhr.status !== 200 || xhr.response == null) {
						if (xhr.status === 413) {
							os.alert({
								type: 'error',
								title: i18n.ts.failedToUpload,
								text: i18n.ts.cannotUploadBecauseExceedsFileSizeLimit,
							});
						} else if (xhr.responseText) {
							const res: { error?: Partial<Misskey.api.APIError> } = JSON.parse(xhr.responseText) as { error?: Partial<Misskey.api.APIError> };
							if (res.error?.id === 'bec5bd69-fba3-43c9-b4fb-2894b66ad5d2') {
								os.alert({
									type: 'error',
									title: i18n.ts.failedToUpload,
									text: i18n.ts.cannotUploadBecauseInappropriate,
								});
							} else if (res.error?.id === 'd08dbc37-a6a9-463a-8c47-96c32ab5f064') {
								os.alert({
									type: 'error',
									title: i18n.ts.failedToUpload,
									text: i18n.ts.cannotUploadBecauseNoFreeSpace,
								});
							} else if (res.error?.id === '4becd248-7f2c-48c4-a9f0-75edc4f9a1ea') {
								os.alert({
									type: 'error',
									title: i18n.ts.failedToUpload,
									text: i18n.ts.cannotUploadBecauseUnallowedFileType,
								});
							} else {
								os.alert({
									type: 'error',
									title: i18n.ts.failedToUpload,
									text: `${res.error?.message}\n${res.error?.code}\n${res.error?.id}`,
								});
							}
						} else {
							os.alert({
								type: 'error',
								title: 'Failed to upload',
								text: JSON.stringify(xhr.response),
							});
						}

						fail();
						return;
					}

					driveFile = JSON.parse(xhr.responseText) as Misskey.entities.DriveFile;
				} catch (error: unknown) {
					fail(error);
					return;
				}
				if (!finish()) return;
				resolve(driveFile);
				globalEvents.emit('driveFileCreated', driveFile);
			};

			if (options.onProgress) {
				xhr.upload.onprogress = /** 只交付当前传输仍有效的真实字节进度。 */ (ev: ProgressEvent<EventTarget>): void => {
					if (!settled && ev.lengthComputable && options.onProgress != null) {
						options.onProgress({
							total: ev.total,
							loaded: ev.loaded,
						});
					}
				};
			}

			const formData: FormData = new FormData();
			formData.append('i', $i.token);
			formData.append('force', 'true');
			formData.append('file', file);
			formData.append('name', options.name ?? (file instanceof File ? file.name : 'untitled'));
			formData.append('isSensitive', options.isSensitive ? 'true' : 'false');
			if (options.caption != null) formData.append('comment', options.caption);
			if (options.folderId) formData.append('folderId', options.folderId);

			xhr.send(formData);
		},
	);

	/** 取消底层传输并结束等待；已成功上传的文件不由此删除。 */
	const abort: () => void = (): void => {
		xhr.abort();
		abortController.abort();
	};

	return { filePromise, abort };
}

export function chooseFileFromPcAndUpload(
	options: {
		multiple?: boolean;
		features?: UploaderFeatures;
		folderId?: string | null;
	} = {},
): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		os.chooseFileFromPc({ multiple: options.multiple }).then(files => {
			if (files.length === 0) return;
			os.launchUploader(files, {
				folderId: options.folderId,
				features: options.features,
			}).then(driveFiles => {
				res(driveFiles);
			});
		});
	});
}

export function chooseDriveFile(options: {
	multiple?: boolean;
} = {}): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((resolve, rej) => {
		let dispose: () => void;
		os.popupAsyncWithDialog(import('@/components/MkDriveFileSelectDialog.vue').then(x => x.default), {
			multiple: options.multiple ?? false,
		}, {
			done: files => {
				if (files) {
					resolve(files);
				}
			},
			closed: () => dispose(),
		}).then((d) => dispose = d.dispose, rej);
	});
}

export function chooseFileFromUrl(): Promise<Misskey.entities.DriveFile> {
	return new Promise((res, rej) => {
		os.inputText({
			title: i18n.ts.uploadFromUrl,
			type: 'url',
			placeholder: i18n.ts.uploadFromUrlDescription,
		}).then(({ canceled, result: url }) => {
			if (canceled || url == null) return;

			const marker = genId();

			// TODO: no websocketモード対応
			const connection = useStream().useChannel('main');
			connection.on('urlUploadFinished', urlResponse => {
				if (urlResponse.marker === marker) {
					res(urlResponse.file);
					connection.dispose();
				}
			});

			misskeyApi('drive/files/upload-from-url', {
				url: url,
				folderId: prefer.s.uploadFolder,
				marker,
			});

			os.alert({
				title: i18n.ts.uploadFromUrlRequested,
				text: i18n.ts.uploadFromUrlMayTakeTime,
			});
		});
	});
}

function select(anchorElement: HTMLElement | EventTarget | null, label: string | null, multiple: boolean, features?: UploaderFeatures): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		os.popupMenu([label ? {
			text: label,
			type: 'label',
		} : null, {
			text: i18n.ts.upload,
			icon: 'ti ti-upload',
			action: () => chooseFileFromPcAndUpload({ multiple, features }).then(files => res(files)),
		}, {
			text: i18n.ts.fromDrive,
			icon: 'ti ti-cloud',
			action: () => chooseDriveFile({ multiple }).then(files => res(files)),
		}, {
			text: i18n.ts.fromUrl,
			icon: 'ti ti-link',
			action: () => chooseFileFromUrl().then(file => res([file])),
		}], anchorElement);
	});
}

type SelectFileOptions<M extends boolean> = {
	anchorElement: HTMLElement | EventTarget | null;
	multiple: M;
	label?: string | null;
	features?: UploaderFeatures;
};

export async function selectFile<
	M extends boolean,
	MR extends M extends true ? Misskey.entities.DriveFile[] : Misskey.entities.DriveFile,
>(opts: SelectFileOptions<M>): Promise<MR> {
	const files = await select(opts.anchorElement, opts.label ?? null, opts.multiple ?? false, opts.features);
	return opts.multiple ? (files as MR) : (files[0]! as MR);
}

export async function createCroppedImageDriveFileFromImageDriveFile(imageDriveFile: Misskey.entities.DriveFile, options: {
	aspectRatio: number | null;
}): Promise<Misskey.entities.DriveFile> {
	return new Promise((resolve, reject) => {
		const imgUrl = getProxiedImageUrl(imageDriveFile.url, undefined, true);
		const image = new Image();
		image.src = imgUrl;
		image.onload = () => {
			const canvas = window.document.createElement('canvas');
			const ctx = canvas.getContext('2d')!;
			canvas.width = image.width;
			canvas.height = image.height;
			ctx.drawImage(image, 0, 0);
			canvas.toBlob(blob => {
				if (blob == null) {
					reject();
					return;
				}

				os.cropImageFile(blob, {
					aspectRatio: options.aspectRatio,
				}).then(croppedImageFile => {
					const { filePromise } = uploadFile(croppedImageFile, {
						name: imageDriveFile.name,
						folderId: imageDriveFile.folderId,
					});

					filePromise.then(driveFile => {
						resolve(driveFile);
					});
				});
			});
		};
	});
}

export async function selectDriveFolder(initialFolder: Misskey.entities.DriveFolder['id'] | null): Promise<{
	canceled: false;
	folders: (Misskey.entities.DriveFolder | null)[];
} | {
	canceled: true;
	folders: undefined;
}> {
	return new Promise((resolve, reject) => {
		let dispose: () => void;
		os.popupAsyncWithDialog(import('@/components/MkDriveFolderSelectDialog.vue').then(x => x.default), {
			initialFolder,
		}, {
			done: folders => {
				resolve(folders == null ? {
					canceled: true,
					folders: undefined,
				} : {
					canceled: false,
					folders,
				});
			},
			closed: () => dispose(),
		}).then(d => dispose = d.dispose, reject);
	});
}
