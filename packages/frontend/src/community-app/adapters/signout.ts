/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 退出交互接缝：阻止复用页面清空 App 同源存储或注销其全部 Service Worker。 */
import { requireCommunitySession } from '../bootstrap/index.js';

/** 真实宿主撤销流程尚未接入时明确拒绝，不伪装已经退出。 */
export const signout: typeof import('@/signout.js').signout = async (): Promise<never> => {
	return requireCommunitySession();
};
