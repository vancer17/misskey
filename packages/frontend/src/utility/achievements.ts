/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：既有全局成就申领入口。
 * 作用：保留存量调用者的资格判断与排队，真实请求成功后发送定向失效信号。
 * 数据链：既有交互 → 申领请求完成 → 成就 Store 重新查询；排重缓存不作为解锁事实。
 */
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { globalEvents } from '@/events.js';
import { ACHIEVEMENT_TYPES } from '@/achievements/domain/index.js';
import type { Achievement, AchievementName } from '@/achievements/domain/index.js';
import { parseAccountCredentials } from '@/accounts/index.js';
import type { AccountCredentials } from '@/accounts/index.js';
import { miLocalStorage } from '@/local-storage.js';

/** 存量消费者继续从原路径读取同一目录；待其统一迁移后删除本重导出。 */
export { ACHIEVEMENT_TYPES, ACHIEVEMENT_BADGES } from '@/achievements/domain/index.js';

/** 存量申领排重缓存；不供成就页面推导已解锁状态。 */
export const claimedAchievements: AchievementName[] = ($i && $i.achievements) ? $i.achievements.map(/** 仅沿用登录时已确认的排重标识。 */ (achievement: Achievement): AchievementName => achievement.name) : [];

/** 原申领节流队列只持有当前排队标识。 */
const claimingQueue: Set<AchievementName> = new Set<AchievementName>();

/** 已落盘会话与内存账户必须同时拥有请求，换号到重载之间不复用旧凭据。 */
function ownsClaimSession(credentials: AccountCredentials): boolean {
	const saved: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	return $i?.id === credentials.id && $i.token === credentials.token && saved?.id === credentials.id && saved.token === credentials.token;
}

/** 保留原申领条件和排队间隔；返回成功仅代表真实 HTTP 已完成，失败由调用方选择重试。 */
export async function claimAchievement(type: AchievementName): Promise<boolean> {
	if ($i == null || $i.movedTo || claimedAchievements.includes(type)) return false;
	const credentials: AccountCredentials = Object.freeze({ id: $i.id, token: $i.token });
	if (!ownsClaimSession(credentials)) return false;
	claimingQueue.add(type);
	claimedAchievements.push(type);
	await new Promise<void>(/** 沿用队列长度决定相邻申领的间隔。 */ (resolve: () => void): void => {
		window.setTimeout(resolve, (claimingQueue.size - 1) * 500);
	});
	window.setTimeout(/** 排重队列沿用原延迟释放策略。 */ (): void => {
		claimingQueue.delete(type);
	}, 500);
	let confirmed: boolean = false;
	try {
		if (!ownsClaimSession(credentials)) return false;
		await misskeyApi('i/claim-achievement', { name: type }, credentials.token);
		confirmed = true;
		if (ownsClaimSession(credentials)) globalEvents.emit('achievementClaimed', credentials.id);
		return true;
	} catch (_error: unknown) {
		// 原消费者多为 fire-and-forget；在此观察拒绝，且不把失败发布为成功。
		return false;
	} finally {
		if (!confirmed) {
			const index: number = claimedAchievements.indexOf(type);
			if (index !== -1) claimedAchievements.splice(index, 1);
		}
	}
}

if (_DEV_) {
	(window as Window & { unlockAllAchievements?: () => void }).unlockAllAchievements = /** 开发入口仍复用正式申领边界，不直接改领域状态。 */ (): void => {
		for (const type of ACHIEVEMENT_TYPES) void claimAchievement(type);
	};
}
