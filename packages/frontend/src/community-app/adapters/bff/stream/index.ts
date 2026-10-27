/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区构建的实时连接所有者。
 * 作用：每个真实 BFF 客户端惰性共享一个 SDK 流，由客户端生命周期统一释放。
 * 数据链：既有频道消费者 → BFF 单次连接票据 → SDK 原频道池。
 */
import type { IStream } from 'misskey-js';
import type { CommunityBffClient } from '@/community-app/adapters/bff/index.js';
import { requireCommunityBffClient } from '@/community-app/bootstrap/index.js';

/** 不跨实例复用连接，客户端销毁负责同步终结所属流。 */
const streams: WeakMap<CommunityBffClient, IStream> = new WeakMap<CommunityBffClient, IStream>();

/** 沿用原 useStream 公共入口，只在真实会话具备后创建连接。 */
export function useStream(): IStream {
	const client: CommunityBffClient = requireCommunityBffClient();
	let stream: IStream | undefined = streams.get(client);
	if (stream == null) {
		stream = client.createStream();
		streams.set(client, stream);
	}
	return stream;
}
