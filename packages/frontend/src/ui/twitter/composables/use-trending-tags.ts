/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · composables 层 · 右栏趋势取数组合函数
 *
 * 作用：作为 hashtags/trend 接口的适配器，将原始响应单向投影为右栏
 * 领域权威条目（domain/right-rail.ts），供 TwitterTrending 组件只读消费。
 *
 * 数据链角色：hashtags/trend 接口（服务端 60s 缓存）→ 本组合函数
 * （取数 + 单向投影 + 静默降级）→ TwitterTrending 组件（展示）。
 *
 * 降级策略：取数失败或无趋势时条目清空、卡片静默收起，右栏内容不产生
 * 噪声态（X-behavior，ADR-0004）；组件随右栏可见性挂载 / 卸载，
 * 重新挂载时借服务端缓存低成本重取，不建前端轮询（代码规范第 9 条
 * 禁止悬空机制）。
 */

import { ref } from 'vue';
import type { Ref } from 'vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { RIGHT_RAIL_LIMITS } from '../domain/index.js';
import type { TwitterTrendItem } from '../domain/index.js';

/**
 * 右栏趋势取数状态：items 为领域权威条目（单向投影），组件只读消费。
 */
export type TwitterTrendingTagsState = {
	/** 趋势条目（空数组 = 无趋势或取数失败，卡片应静默收起）。 */
	items: Ref<TwitterTrendItem[]>;
	/** 是否处于取数中（驱动卡内骨架行）。 */
	isLoading: Ref<boolean>;
};

/**
 * 右栏趋势取数组合函数：挂载即取数一次，返回只读消费语义的响应式状态。
 *
 * @returns 趋势条目与取数中状态
 */
export function useTrendingTags(): TwitterTrendingTagsState {
	const items = ref<TwitterTrendItem[]>([]);
	const isLoading = ref(true);

	/**
	 * 拉取趋势条目：接口原始响应 → 截取右栏上限 → 单向投影为领域条目
	 * （代码规范第 12 条：投影不回写原始响应语义）。
	 */
	async function load(): Promise<void> {
		isLoading.value = true;
		try {
			const response = await misskeyApi('hashtags/trend', {});
			items.value = response
				.slice(0, RIGHT_RAIL_LIMITS.trendingTags)
				.map((item): TwitterTrendItem => ({
					tag: item.tag,
					usersCount: item.usersCount,
				}));
		} catch {
			items.value = [];
		} finally {
			isLoading.value = false;
		}
	}

	void load();

	return {
		items,
		isLoading,
	};
}
