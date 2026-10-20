/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：头像挂件的边界映射与只读可用性提示。
 * 作用：复用 misskey-js 权威类型，为挂件页及试戴卡片提供同一权限提示和请求序列化。
 * 数据链：服务端目录／账户 → 显示准入提示；已佩戴数据／编辑草稿 → i/update Schema。
 * 不持有账户副本、不探测环境；最终佩戴资格与写入结果仍由服务端决定。
 */
import type * as Misskey from 'misskey-js';

/** 从目录已经过滤的角色限制和当前账户角色派生界面提示，不替代服务端鉴权。 */
export function canUseAvatarDecoration(
	decoration: Misskey.entities.GetAvatarDecorationsResponse[number],
	roles: Misskey.entities.MeDetailed['roles'],
): boolean {
	return decoration.roleIdsThatCanBeUsedThisDecoration.length === 0 || roles.some(
		/** 仅比较权威角色标识，不复制角色权限定义。 */
		(role: Misskey.entities.MeDetailed['roles'][number]): boolean => decoration.roleIdsThatCanBeUsedThisDecoration.includes(role.id),
	);
}

/** 映射到既有写入 Schema，移除图片 URL 等展示字段并使用协议约定的默认变换。 */
export function serializeAvatarDecorations(
	decorations: readonly NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>[number][],
): NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']> {
	return decorations.map(
		/** 保留数量、顺序及重复 ID；同一挂件可在不同位置叠加。 */
		(decoration: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>[number]): NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']>[number] => ({
			id: decoration.id,
			angle: decoration.angle ?? 0,
			flipH: decoration.flipH ?? false,
			offsetX: decoration.offsetX ?? 0,
			offsetY: decoration.offsetY ?? 0,
		}),
	);
}
