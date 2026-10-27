/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 嵌入适配公共入口：生产认证和传输尚未提供时仅公开明确拒绝能力。 */
export { pleaseLogin } from './authentication.js';
export { signout } from './signout.js';
