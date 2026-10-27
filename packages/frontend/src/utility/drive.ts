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
import { uploadFileTransport } from '@/utility/drive-upload/index.js';
import { DriveUploadHttpError } from '@/utility/upload-transport/index.js';
import type { DriveUploadHandle, DriveUploadOptions } from '@/utility/upload-transport/index.js';
export { UploadAbortedError } from '@/utility/upload-transport/index.js';

/** 展示既有网盘服务错误；传输适配器本身不处理业务提示。 */
function showUploadError(error: DriveUploadHttpError): void {
	const body: { error?: Partial<Misskey.api.APIError> } = error.body != null && typeof error.body === 'object' ? error.body as { error?: Partial<Misskey.api.APIError> } : {};
	let text: string;
	if (error.status === 413) text = i18n.ts.cannotUploadBecauseExceedsFileSizeLimit;
	else if (body.error?.id === 'bec5bd69-fba3-43c9-b4fb-2894b66ad5d2') text = i18n.ts.cannotUploadBecauseInappropriate;
	else if (body.error?.id === 'd08dbc37-a6a9-463a-8c47-96c32ab5f064') text = i18n.ts.cannotUploadBecauseNoFreeSpace;
	else if (body.error?.id === '4becd248-7f2c-48c4-a9f0-75edc4f9a1ea') text = i18n.ts.cannotUploadBecauseUnallowedFileType;
	else text = body.error != null ? `${body.error.message}\n${body.error.code}\n${body.error.id}` : JSON.stringify(error.body);
	void os.alert({ type: 'error', title: i18n.ts.failedToUpload, text });
}

/** 保留既有文件策略与成功事件，将网络与认证交给公开的上传适配器。 */
export function uploadFile(file: File | Blob, options: DriveUploadOptions = {}): DriveUploadHandle {
	if ($i == null) return { filePromise: Promise.reject(), abort: /** 尚未发起请求，无需中止网络。 */ (): void => {} };
	if (file.size > instance.maxFileSize || file.size > $i.policies.maxFileSizeMb * 1024 * 1024) {
		void os.alert({ type: 'error', title: i18n.ts.failedToUpload, text: i18n.ts.cannotUploadBecauseExceedsFileSizeLimit });
		return { filePromise: Promise.reject(), abort: /** 校验失败不产生底层上传。 */ (): void => {} };
	}
	const transport: DriveUploadHandle = uploadFileTransport(file, options);
	const filePromise: Promise<Misskey.entities.DriveFile> = transport.filePromise.then(
		/** 仅真实上传成功发布现有领域事件。 */ (driveFile: Misskey.entities.DriveFile): Misskey.entities.DriveFile => {
			globalEvents.emit('driveFileCreated', driveFile);
			return driveFile;
		},
		/** 保留错误提示与拒绝回执，禁止失败后伪造文件。 */ (error: unknown): never => {
			if (error instanceof DriveUploadHttpError) showUploadError(error);
			throw error;
		},
	);
	return { filePromise, abort: transport.abort };
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
