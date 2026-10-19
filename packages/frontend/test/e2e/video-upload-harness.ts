/*
 * 共享上传器真实浏览器测试入口：使用真实 Vue、媒体适配器和上传 API 验证取消后的重新处理。
 * 此模块仅由 E2E 通过 Vite 加载，不进入产品入口，不替换媒体或网络行为。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, nextTick } from 'vue';
import type { App } from 'vue';
import type * as Misskey from 'misskey-js';
import { useUploader } from '@/composables/use-uploader.js';
import type { UploaderItem } from '@/composables/use-uploader.js';

/** 真实取消、上传和释放操作产生的观察结果。 */
export type VideoCancellationResult = {
	uploaded: Misskey.entities.DriveFile;
	abortedBeforeRetry: boolean;
	clearedBeforeRetry: boolean;
	uploadedEvents: number;
	retainedOtherItem: boolean;
	itemsAfterDispose: number;
};

/** 在已登录的真实页面中取消预处理并明确重试，随后验证删除与组件卸载。 */
export async function exerciseVideoCancellation(file: File): Promise<VideoCancellationResult> {
	const holder: { uploader?: ReturnType<typeof useUploader> } = {};
	const element: HTMLDivElement = document.createElement('div');
	document.body.appendChild(element);
	const app: App = createApp({
		/** 创建绑定真实组件生命周期的共享上传器。 */
		setup: (): (() => null) => {
			holder.uploader = useUploader({ multiple: true });
			return /** 测试只观察共享逻辑，不渲染额外业务视图。 */ (): null => null;
		},
	});
	app.mount(element);
	if (holder.uploader == null) throw new Error('Uploader did not initialize.');
	const uploader: ReturnType<typeof useUploader> = holder.uploader;
	let uploadedEvents: number = 0;
	let unmounted: boolean = false;
	uploader.events.on('itemUploaded', /** 只计数服务端确认后的成功事件。 */ (): void => { uploadedEvents++; });

	try {
		uploader.addFiles([file]);
		const item: UploaderItem = uploader.items.value[0];
		const oldAbort: UploaderItem['abortPreprocess'] = item.abortPreprocess;
		oldAbort?.();
		const abortedBeforeRetry: boolean = item.aborted;
		const clearedBeforeRetry: boolean = item.preprocessedFile == null && item.compressedSize == null && item.suffix === '';
		const retry: Promise<void> = uploader.upload();
		// 旧句柄再次触发也不能取消已经开始的新尝试。
		oldAbort?.();
		await retry;
		if (item.uploaded == null) throw new Error('Explicit retry did not upload the file.');
		const uploaded: Misskey.entities.DriveFile = item.uploaded;
		uploader.reset();

		uploader.addFiles([file, file]);
		const removed: UploaderItem = uploader.items.value[0];
		const retained: UploaderItem = uploader.items.value[1];
		uploader.removeItem(removed);
		uploader.removeItem(removed);
		const retainedOtherItem: boolean = uploader.items.value.length === 1 && uploader.items.value[0] === retained;
		app.unmount();
		unmounted = true;
		await nextTick();

		return { uploaded, abortedBeforeRetry, clearedBeforeRetry, uploadedEvents, retainedOtherItem, itemsAfterDispose: uploader.items.value.length };
	} finally {
		if (!unmounted) app.unmount();
		element.remove();
	}
}
