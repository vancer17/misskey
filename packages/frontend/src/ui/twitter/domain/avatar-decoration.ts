/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 头像挂件展示语义。
 * 数据链：宿主声明头像角色 → TwitterAvatar 选择绘制边界；佩戴实体复用 misskey-js。
 * 此处只定义展示位置和只读预览投影，不保存佩戴事实，也不参与帖子关系或权限判断。
 */
import type * as Misskey from 'misskey-js';

/** 宿主显式声明展示角色；紧凑身份默认关闭，纯转发继承主内容角色。 */
export type TwitterAvatarDecorationContext = 'none' | 'note' | 'profile';

/** 现有佩戴实体的只读图片预览投影；管理草稿尚无 ID，blink 仅用于选中项提示。 */
export type TwitterAvatarDecoration = Readonly<Omit<Misskey.entities.UserDetailed['avatarDecorations'][number], 'id'> & {
	/** 已佩戴实体保留标识，未保存素材预览无需伪造标识。 */
	id?: Misskey.entities.UserDetailed['avatarDecorations'][number]['id'];
	/** 编辑器选中提示，不进入佩戴提交协议。 */
	blink?: boolean;
	/** 已确认静态的本地预览表示，避免将浏览器私有 URL 交给服务端图片代理；不进入佩戴协议。 */
	staticUrl?: string;
}>;

/** 原生挂件的静态制作规格；只约束新导出文件，不改变存量佩戴坐标。 */
export const TWITTER_AVATAR_DECORATION_CALIBRATION: Readonly<{
	canvasSize: number;
	avatarSize: number;
	minimumScale: number;
	maximumScale: number;
	staticMimeTypes: readonly string[];
}> = {
	/** 完整透明导出画布的边长。 */
	canvasSize: 1024,
	/** 画布中央头像参考圆的直径。 */
	avatarSize: 512,
	/** 相对初始等比容纳尺寸的最小百分比。 */
	minimumScale: 1,
	/** 相对初始等比容纳尺寸的最大百分比。 */
	maximumScale: 800,
	/** 已有动画检测器能够识别且浏览器能够绘制的静态素材类型。 */
	staticMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
} as const;

/** 校准的临时坐标；位移使用导出画布像素，缩放使用初始等比容纳尺寸的百分比。 */
export type TwitterAvatarDecorationCalibrationTransform = Readonly<{
	scale: number;
	offsetX: number;
	offsetY: number;
}>;

/** 素材边界的有限失败原因，由业务弹窗映射为本地化提示。 */
export type TwitterAvatarDecorationMaterialFailure = 'load' | 'unsupported' | 'animated' | 'export';
