/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 静态挂件素材适配。
 * 数据链：可读取的原始图片 URL → 动画检查 → Cropper 完整透明画布 → 待上传 PNG。
 * 只准备临时文件，不写入网盘、挂件目录或账户，也不使用缩略图和静态代理替代原图。
 */
import type { CropperCanvas } from 'cropperjs';
import isAnimated from 'is-file-animated';
import { TWITTER_AVATAR_DECORATION_CALIBRATION } from '../domain/index.js';
import type { TwitterAvatarDecorationMaterialFailure } from '../domain/index.js';

/** 将素材适配失败交给业务界面解释，不把网络异常或库错误直接展示给用户。 */
export class AvatarDecorationMaterialError extends Error {
	/** 保留有限失败原因，避免界面依赖底层异常消息。 */
	constructor(public readonly reason: TwitterAvatarDecorationMaterialFailure) {
		super(reason);
	}
}

/** 读取原始字节并先识别动画，再校验静态格式；APNG 等媒体类型也获得准确提示，原地址保持不变。 */
export async function loadAvatarDecorationMaterial(sourceUrl: string, signal: AbortSignal): Promise<Blob> {
	let blob: Blob;
	try {
		const response: Response = await window.fetch(sourceUrl, { signal, mode: 'cors', credentials: 'same-origin' });
		if (!response.ok) throw new Error('Material request failed');
		blob = await response.blob();
	} catch (error: unknown) {
		throw new AvatarDecorationMaterialError('load');
	}
	try {
		if (await isAnimated(blob)) throw new AvatarDecorationMaterialError('animated');
	} catch (error: unknown) {
		if (error instanceof AvatarDecorationMaterialError) throw error;
		throw new AvatarDecorationMaterialError('load');
	}
	if (!TWITTER_AVATAR_DECORATION_CALIBRATION.staticMimeTypes.includes(blob.type)) throw new AvatarDecorationMaterialError('unsupported');
	return blob;
}

/** 使用 Cropper 公共导出 API 绘制完整正方形；参考圆、头像及背景均位于绘制树之外。 */
export async function exportAvatarDecorationMaterial(canvas: CropperCanvas): Promise<File> {
	try {
		const rendered: HTMLCanvasElement = await canvas.$toCanvas({
			width: TWITTER_AVATAR_DECORATION_CALIBRATION.canvasSize,
			height: TWITTER_AVATAR_DECORATION_CALIBRATION.canvasSize,
		});
		if (rendered.width !== TWITTER_AVATAR_DECORATION_CALIBRATION.canvasSize || rendered.height !== TWITTER_AVATAR_DECORATION_CALIBRATION.canvasSize) throw new Error('Unexpected export dimensions');
		const blob: Blob = await new Promise<Blob>(
			/** 编码失败必须拒绝等待，避免表单停留在导出中。 */
			(resolve: (value: Blob) => void, reject: (reason: Error) => void): void => {
				rendered.toBlob(
					/** PNG 保留透明度，空结果交付明确失败。 */
					(result: Blob | null): void => { if (result === null) reject(new Error('PNG export failed')); else resolve(result); },
					'image/png',
				);
			},
		);
		if (blob.size === 0 || blob.type !== 'image/png') throw new Error('Invalid PNG export');
		return new File([blob], 'avatar-decoration-calibrated.png', { type: 'image/png' });
	} catch (error: unknown) {
		throw new AvatarDecorationMaterialError('export');
	}
}
