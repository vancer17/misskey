/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · 时间线真实读取协议适配。
 * 作用：将既有分页器的端点及 Schema 参数交给真实 API，完整保留请求失败与取消。
 * 数据链：查询所有者的端点／参数 → Misskey API → 本次请求窗口；不缓存业务列表。
 */
import type { MisskeyEntity, PaginatorCompatibleEndpointPaths, PaginatorCompatibleEndpoints } from '@/utility/paginator.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 读取单个真实窗口；调用方提交前仍需校验查询及页面归属。 */
export function fetchTwitterTimelineWindow<Endpoint extends PaginatorCompatibleEndpointPaths>(
	endpoint: Endpoint,
	parameters: PaginatorCompatibleEndpoints[Endpoint]['req'],
	signal: AbortSignal,
): Promise<(PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[]> {
	return misskeyApi<(PaginatorCompatibleEndpoints[Endpoint]['res'][number] & MisskeyEntity)[], Endpoint, PaginatorCompatibleEndpoints[Endpoint]['req']>(endpoint, { ...parameters }, undefined, signal);
}
