/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 附件只读展示几何。
 * 作用：校验附件自然尺寸，向横向媒体列表单向派生宽高比。
 * 数据链：既有附件元数据或已允许加载资源的尺寸 → 临时展示投影；不回写文件实体或参与业务决策。
 */

/** 当前资源已加载后的临时尺寸；来源标识仅用于淘汰资源切换前的测量结果。 */
export type TwitterMediaMeasurement = Readonly<{
	source: string;
	width: number;
	height: number;
}>;

/** 将有限正数尺寸投影为比例，缺失或无效尺寸留给展示层使用中性占位。 */
export function getTwitterMediaAspectRatio(width: number | undefined, height: number | undefined): number | null {
	if (width == null || height == null || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	const ratio: number = width / height;
	return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}
