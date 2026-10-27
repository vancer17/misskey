/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区跨窗口同步通道适配。
 * 作用：复用原依赖的完整公共实现，仅对通道名增加社区前缀。
 * 数据链：原 Store/偏好/重载消息 → 专属通道；不复制消息领域类型或修改全局构造器。
 */
import { BroadcastChannel as NativeBroadcastChannel } from 'broadcast-channel';
import type { BroadcastChannelOptions } from 'broadcast-channel';
import { COMMUNITY_STORAGE_PREFIX } from './index.js';

/** 复用原公共通道类及其事件类型，隔离本地同源 App 的同名通道。 */
export class BroadcastChannel<Message = unknown> extends NativeBroadcastChannel<Message> {
	/** 只改变资源命名，不改变原消息发送、接收及关闭语义。 */
	public constructor(name: string, options?: BroadcastChannelOptions) {
		super(COMMUNITY_STORAGE_PREFIX + name, options);
	}
}
