/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：成就查询协议适配。
 * 作用：将 users/achievements 响应映射成冻结的权威事实，保留既有目录顺序。
 * 数据链：真实 API 响应 → 目录约束映射 → Store；原响应不传给业务组件。
 */
import type { entities } from 'misskey-js';
import { ACHIEVEMENT_TYPES } from '../domain/index.js';
import type { Achievement } from '../domain/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { ownsAccountRequest } from '@/accounts/ownership/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/index.js';

/** 查询请求所属账户的服务端事实；取消与归属检查拒绝换号后的迟到协议结果。 */
export async function fetchOwnAchievements(owner: AccountRequestOwner, signal: AbortSignal): Promise<readonly Achievement[]> {
	if (!ownsAccountRequest(owner)) throw new Error('ACCOUNT_CHANGED');
	const response: entities.UsersAchievementsResponse = await misskeyApi('users/achievements', { userId: owner.accountId }, undefined, signal);
	if (!ownsAccountRequest(owner)) throw new Error('ACCOUNT_CHANGED');
	const achievements: Achievement[] = [];
	for (const name of ACHIEVEMENT_TYPES) {
		const found: entities.UsersAchievementsResponse[number] | undefined = response.find(/** 协议条目仅用于匹配目录，不将 API 列表作为展示状态。 */ (item: entities.UsersAchievementsResponse[number]): boolean => item.name === name);
		if (found != null) achievements.push(Object.freeze({ name, unlockedAt: found.unlockedAt }));
	}
	return Object.freeze(achievements);
}
