/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区构建的既有 HTTP API 接缝。
 * 作用：保留原组件和 Store 使用的 SDK 泛型签名，固定转交 BFF 客户端。
 * 数据链：既有 API 调用 → 私有会话 BFF 传输 → 原 SDK 响应；禁止传入旧 token。
 */
import type * as Misskey from 'misskey-js';
import { ref } from 'vue';
import type { Ref } from 'vue';
import { requireCommunityBffClient } from '@/community-app/bootstrap/index.js';

/** 复用既有请求计数展示，不持有 API 实体或认证事实。 */
export const pendingApiRequestsCount: Ref<number> = ref<number>(0);

/** 将传输生命周期映射为原有请求计数；所有成功和失败均释放计数。 */
async function countRequest<T>(operation: () => Promise<T>): Promise<T> {
	pendingApiRequestsCount.value++;
	try { return await operation(); } finally { pendingApiRequestsCount.value--; }
}

/** SDK POST 兼容入口；显式旧凭据参数被拒绝，认证仅由 BFF 私有会话提供。 */
export function misskeyApi<ResT = void, E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'], _ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT>(
	endpoint: E,
	data: P & { i?: string | null } = {} as P & { i?: string | null },
	token?: string | null,
	signal?: AbortSignal,
): Promise<_ResT> {
	if (token !== undefined) return Promise.reject(new Error('Community API rejects explicit Misskey credentials'));
	return countRequest(/** 请求开始时取得当前实例客户端，不在模块求值阶段捕获未建立的会话。 */ async (): Promise<_ResT> => await requireCommunityBffClient().request(endpoint, data, signal) as _ResT);
}

/** SDK GET 兼容入口；保留查询语义并使用同一私有 BFF 会话。 */
export function misskeyApiGet<ResT = void, E extends keyof Misskey.Endpoints = keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req'] = Misskey.Endpoints[E]['req'], _ResT = ResT extends void ? Misskey.api.SwitchCaseResponseType<E, P> : ResT>(
	endpoint: E,
	data: P = {} as P,
): Promise<_ResT> {
	return countRequest(/** 仅消费公开 BFF 能力，不读取账户原始响应或本地 token。 */ async (): Promise<_ResT> => await requireCommunityBffClient().get(endpoint, data) as _ResT);
}
