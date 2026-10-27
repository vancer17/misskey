/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：嵌入社区的实例事实适配。
 * 作用：复用真实会话安装的实例模型，不从 App DOM、部署来源或缓存构造业务策略。
 * 数据链：BFF 权威实例 → 唯一状态 → 只读展示；刷新经同一 BFF 与归属校验提交。
 */
import type { entities } from 'misskey-js';
import { parseCommunityBffInstance } from 'community-bff-contract';
import { requireCommunityBffClient } from '../../bootstrap/index.js';
import { getCommunityInstance, updateCommunityInstance } from '../../state/session/index.js';
import { captureAccountOwnership, ownsAccountRequest } from '@/accounts/ownership/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/index.js';

/** 在真实实例安装前明确拒绝业务求值，不提供空对象或缓存策略。 */
function requireInstance(): Readonly<entities.MetaDetailed> {
	const value: Readonly<entities.MetaDetailed> | null = getCommunityInstance();
	if (value === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	return value;
}

/** 唯一实例的只读投影，不持有原始响应副本。 */
export const instance: Readonly<entities.MetaDetailed> = requireInstance();

/** 显式刷新只提交当前会话的服务器确认结果，旧实例响应不得修改业务策略。 */
export async function fetchInstance(force: boolean = false): Promise<Readonly<entities.MetaDetailed>> {
	if (!force) return requireInstance();
	const owner: AccountRequestOwner | null = captureAccountOwnership();
	if (owner === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	const meta: entities.MetaDetailed = parseCommunityBffInstance(await requireCommunityBffClient().request('meta', { detail: true }));
	if (!ownsAccountRequest(owner)) throw new Error('COMMUNITY_SESSION_CHANGED');
	updateCommunityInstance(meta);
	return requireInstance();
}
