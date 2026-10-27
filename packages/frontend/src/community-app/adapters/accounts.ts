/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：嵌入社区与旧账户交互 API 的构建接缝。
 * 作用：从既有公共类型派生签名，并在真实 BFF 会话尚未接入时明确拒绝操作。
 * 数据链：复用页面调用 → 显式缺少会话错误；不提供假账户、假成功或原生登录弹窗。
 */
import { requireCommunitySession } from '../bootstrap/index.js';

/** 从既有账户模块派生 API 签名，避免复制其业务账户结构。 */
type AccountApi = typeof import('@/accounts.js');

/** 保留异步账户 API 的拒绝语义，而不是在 Promise 创建前同步抛出。 */
async function rejectAccountOperation(): Promise<never> {
	return requireCommunitySession();
}

/** 原账户枚举需等待真实 BFF 会话，不返回伪造的空业务结果。 */
export const getAccounts: AccountApi['getAccounts'] = rejectAccountOperation;
/** 原账户菜单由后续宿主账户意图适配接管，当前明确拒绝。 */
export const getAccountMenu: AccountApi['getAccountMenu'] = rejectAccountOperation;
/** 缺少真实账户权威状态时禁止更新账户。 */
export const updateCurrentAccount: AccountApi['updateCurrentAccount'] = rejectAccountOperation;
/** 缺少真实账户权威状态时禁止局部更新账户。 */
export const updateCurrentAccountPartial: AccountApi['updateCurrentAccountPartial'] = requireCommunitySession;
/** 不允许嵌入社区进入原生 Misskey 登录链。 */
export const login: AccountApi['login'] = rejectAccountOperation;
/** 不允许嵌入社区自行切换用户身份。 */
export const switchAccount: AccountApi['switchAccount'] = rejectAccountOperation;
/** 不允许嵌入社区移除宿主持有的账户身份。 */
export const removeAccount: AccountApi['removeAccount'] = rejectAccountOperation;
/** 缺少 BFF 会话实现时不能伪装完成失效账户清理。 */
export const removeInvalidAccount: AccountApi['removeInvalidAccount'] = rejectAccountOperation;
/** 从构建依赖图排除原登录对话框。 */
export const getAccountWithSigninDialog: AccountApi['getAccountWithSigninDialog'] = rejectAccountOperation;
/** 从构建依赖图排除原注册对话框。 */
export const getAccountWithSignupDialog: AccountApi['getAccountWithSignupDialog'] = rejectAccountOperation;
