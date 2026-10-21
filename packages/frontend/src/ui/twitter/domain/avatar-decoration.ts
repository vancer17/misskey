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
}>;
