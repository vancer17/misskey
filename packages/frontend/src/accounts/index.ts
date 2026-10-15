/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 账户协议与领域类型的公共入口；不得从这里导入依赖 Store 的账户 UI 实现。 */
export type { AccountWithToken, AccountCredentials, InvalidSession, InvalidSessionReason } from './domain/session.js';
export { AccountRequestError, getAccountErrorCode, getInvalidSessionReason, parseAccountCredentials, requestAccount } from './session-api.js';
