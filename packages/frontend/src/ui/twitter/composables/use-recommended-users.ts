/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · composables 层 · 右栏推荐关注取数组合函数
 *
 * 作用：作为推荐关注数据源的适配器，实现 phase-2 清单规定的降级链——
 * 主源 users/recommendation（稀疏实例可能为空、token 缺 read:account
 * 时报错）→ 备源 pinned-users（实例置顶用户，无凭证要求）→ 仍为空则
 * 卡片静默收起；产出 misskey-js 权威类型 UserDetailed 列表供
 * TwitterWhoToFollow 组件只读消费。
 *
 * 数据链角色：users/recommendation | pinned-users 接口 → 本组合函数
 * （降级链 + 本人过滤 + 上限截取）→ TwitterWhoToFollow 组件（展示）。
 */

import { ref } from 'vue';
import type { Ref } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { RIGHT_RAIL_LIMITS } from '../domain/index.js';

/**
 * 右栏推荐关注取数状态：users 为 misskey-js 权威类型条目，组件只读消费。
 */
export type TwitterRecommendedUsersState = {
	/** 推荐用户（空数组 = 主备源均无结果，卡片应静默收起）。 */
	users: Ref<Misskey.entities.UserDetailed[]>;
	/** 是否处于取数中（驱动卡内骨架行）。 */
	isLoading: Ref<boolean>;
};

/**
 * 将候选用户列表整理为右栏展示形态：过滤登录者本人并截取显示上限。
 *
 * @param candidates 主源或备源返回的候选用户列表
 * @returns 过滤并截取后的展示列表
 */
function toDisplayUsers(candidates: Misskey.entities.UserDetailed[]): Misskey.entities.UserDetailed[] {
	return candidates
		.filter((user): boolean => $i == null || user.id !== $i.id)
		.slice(0, RIGHT_RAIL_LIMITS.recommendedUsers);
}

/**
 * 右栏推荐关注取数组合函数：挂载即沿降级链取数一次。
 *
 * @returns 推荐用户与取数中状态
 */
export function useRecommendedUsers(): TwitterRecommendedUsersState {
	const users = ref<Misskey.entities.UserDetailed[]>([]);
	const isLoading = ref(true);

	/**
	 * 备源取数：实例置顶用户（pinned-users）。
	 * 主源在稀疏实例上可能为空（仅本地、7 日活跃、未关注用户不足），
	 * 或因 token 缺少 read:account 权限失败，此时回退到备源。
	 */
	async function fetchFallbackUsers(): Promise<Misskey.entities.UserDetailed[]> {
		const pinned = await misskeyApi('pinned-users', {});
		return toDisplayUsers(pinned);
	}

	/**
	 * 沿降级链取数：主源为空或失败时回退备源，备源亦失败时清空
	 * （静默收起，右栏内容不产生噪声态——X-behavior，ADR-0004）。
	 */
	async function load(): Promise<void> {
		isLoading.value = true;
		try {
			const recommended = await misskeyApi('users/recommendation', {
				limit: RIGHT_RAIL_LIMITS.recommendationQueryLimit,
			});
			users.value = toDisplayUsers(recommended);
			if (users.value.length === 0) {
				users.value = await fetchFallbackUsers();
			}
		} catch {
			try {
				users.value = await fetchFallbackUsers();
			} catch {
				users.value = [];
			}
		} finally {
			isLoading.value = false;
		}
	}

	void load();

	return {
		users,
		isLoading,
	};
}
