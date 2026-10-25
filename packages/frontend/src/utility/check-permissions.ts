/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：既有账户与实例策略的前端只读能力投影。
 * 作用：将启动后继续更新的策略转换为响应式搜索能力，不保存第二份权限事实。
 * 数据链：账户／实例策略 → 只读 computed → 搜索入口与页面；最终授权仍由后端执行。
 */

import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { instance } from '@/instance.js';
import { $i } from '@/i.js';

/** 账户策略优先；访客沿用实例策略，异步启动更新后自动重新派生帖子搜索入口。 */
export const notesSearchAvailable: ComputedRef<boolean> = computed(/** 仅消费既有策略，不探测搜索服务。 */ (): boolean => (
	// 沿用现有测试实例可能尚未提供 policies 的初始化边界。
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	($i == null && instance.policies != null && instance.policies.canSearchNotes) ||
	($i != null && $i.policies.canSearchNotes) ||
	false
));

/** 实例声明的搜索范围只读投影，菜单不能自行猜测远程索引覆盖范围。 */
export const canSearchNonLocalNotes: ComputedRef<boolean> = computed(/** 跟随既有实例资料更新。 */ (): boolean => (
	instance.noteSearchableScope === 'global'
));

/** 用户搜索独立消费同一权威策略，不从帖子搜索能力反推。 */
export const usersSearchAvailable: ComputedRef<boolean> = computed(/** 保留账户与访客原有授权选择。 */ (): boolean => (
	// 沿用现有测试实例可能尚未提供 policies 的初始化边界。
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	($i == null && instance.policies != null && instance.policies.canSearchUsers) ||
	($i != null && $i.policies.canSearchUsers) ||
	false
));
