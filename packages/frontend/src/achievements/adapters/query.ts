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

/** 查询当前账户的服务端事实；凭据与取消信号绑定本次请求，不能随账户变化漂移。 */
export async function fetchOwnAchievements(userId: string, token: string, signal: AbortSignal): Promise<readonly Achievement[]> {
	const response: entities.UsersAchievementsResponse = await misskeyApi('users/achievements', { userId }, token, signal);
	const achievements: Achievement[] = [];
	for (const name of ACHIEVEMENT_TYPES) {
		const found: entities.UsersAchievementsResponse[number] | undefined = response.find(/** 协议条目仅用于匹配目录，不将 API 列表作为展示状态。 */ (item: entities.UsersAchievementsResponse[number]): boolean => item.name === name);
		if (found != null) achievements.push(Object.freeze({ name, unlockedAt: found.unlockedAt }));
	}
	return Object.freeze(achievements);
}
