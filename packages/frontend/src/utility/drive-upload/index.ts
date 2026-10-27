/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：独立站网盘上传认证适配。
 * 作用：仅在原站构建为既有 XHR 协议绑定真实 Misskey 凭据；社区目标由编译接缝替换。
 * 数据链：原站账户 → multipart 认证字段 → 通用上传传输。
 */
import { apiUrl } from '@@/js/config.js';
import { $i } from '@/i.js';
import { createDriveUploadRequest } from '@/utility/upload-transport/index.js';
import type { DriveUploadHandle, DriveUploadOptions } from '@/utility/upload-transport/index.js';

/** 原站保留原有认证协议，业务选择与校验仍由 drive 模块处理。 */
export function uploadFileTransport(file: File | Blob, options: DriveUploadOptions): DriveUploadHandle {
	if ($i == null) return { filePromise: Promise.reject(new Error('Upload requires an account')), abort: /** 无请求时不必取消。 */ (): void => {} };
	return createDriveUploadRequest(file, options, { url: `${apiUrl}/drive/files/create`, fields: { i: $i.token } });
}
