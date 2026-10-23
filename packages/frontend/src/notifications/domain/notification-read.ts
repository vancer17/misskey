/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通知领域的账户只读投影：派生既有权威账户字段，不定义或保存第二份未读事实。 */
import type { AccountWithToken } from '@/accounts/index.js';

/** 已读对账允许更新的账户字段；未读数量仍由服务端账户查询决定。 */
export type NotificationUnreadState = Readonly<Pick<AccountWithToken, 'hasUnreadNotification' | 'unreadNotificationsCount'>>;
