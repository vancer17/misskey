/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通知业务公共入口：消费者仅使用已读动作及权威账户对账，不引用内部调度或协议实现。 */
export { confirmNotificationsRead, syncNotificationUnreadState } from './store/notification-read.js';
export { useNotificationsRead } from './composables/use-notifications-read.js';
