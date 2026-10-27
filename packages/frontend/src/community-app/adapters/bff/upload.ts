/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区构建的网盘上传接缝。
 * 作用：将既有上传工具的网络阶段固定映射到 BFF，保留文件校验和成功事件。
 * 数据链：drive 工具 → 当前实例 BFF 客户端 → SDK DriveFile；不读取原站凭据。
 */
import type { DriveUploadHandle, DriveUploadOptions } from '@/utility/upload-transport/index.js';
import { requireCommunityBffClient } from '@/community-app/bootstrap/index.js';

/** 只在实际上传时取得已建立的 BFF 实例能力。 */
export function uploadFileTransport(file: File | Blob, options: DriveUploadOptions): DriveUploadHandle {
	return requireCommunityBffClient().upload(file, options);
}
