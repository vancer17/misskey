/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 认证交互接缝：保留旧调用签名，在宿主认证尚未接入时拒绝打开 Misskey 登录 UI。 */
import { requireCommunitySession } from '../bootstrap/index.js';

/** 从原认证意图派生类型，不复制外部链接或用户定义。 */
export type OpenOnRemoteOptions = import('@/utility/please-login.js').OpenOnRemoteOptions;
/** 复用页面必须等待真实宿主会话，不能退回原登录弹窗。 */
export const pleaseLogin: typeof import('@/utility/please-login.js').pleaseLogin = async (): Promise<never> => {
	return requireCommunitySession();
};
