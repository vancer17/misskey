/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 嵌入组合组件公共入口：只组合原展示能力，不复制业务 Store。 */
export { default as CommunitySystemHost } from './CommunitySystemHost.vue';
export { default as CommunityAuthBoundary } from './CommunityAuthBoundary.vue';
