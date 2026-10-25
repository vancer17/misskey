/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI 启动层公共入口。
 * 作用：向 Shell 暴露浏览器生命周期与既有运行依赖的展示协调能力。
 * 数据链：共享运行事实 → 启动层观察者 → 只读展示状态；领域与业务组件不消费探测实现。
 */
export { createTwitterStreamNotice } from './stream-notice.js';
export type { TwitterStreamNoticeController } from './stream-notice.js';
