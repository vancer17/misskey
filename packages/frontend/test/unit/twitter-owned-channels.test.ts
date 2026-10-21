/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：所属频道查询的请求取消与故障边界测试。
 * 作用：以真实端点类型的空响应控制请求完成顺序，核对失效响应隔离和适配器参数。
 * 数据链：受控传输 Promise → 真实适配器与查询 → 公开只读状态；频道业务由真实后端 E2E 验证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Endpoints } from 'misskey-js';
import { createOwnedChannelsQuery } from '@/ui/twitter/store/owned-channels.js';
import type { OwnedChannelsQuery } from '@/ui/twitter/store/owned-channels.js';
import { fetchOwnedChannelsPage } from '@/ui/twitter/adapters/owned-channels.js';
import type { OwnedChannelsPage, OwnedChannelsState } from '@/ui/twitter/domain/index.js';
import { misskeyApi } from '@/utility/misskey-api.js';

vi.mock('@/utility/misskey-api.js', /** 只替换传输边界，保留被测查询与映射实现。 */ (): Pick<typeof import('@/utility/misskey-api.js'), 'misskeyApi'> => ({
	/** 请求参数和取消信号由真实适配器传入，响应完成顺序由各用例控制。 */
	misskeyApi: vi.fn(),
}));

/** 沿用端点响应类型的延迟结果，不构造频道实体或模拟频道资格。 */
type DeferredOwnedResponse = Readonly<{
	promise: Promise<Endpoints['channels/owned']['res']>;
	resolve: (value: Endpoints['channels/owned']['res']) => void;
	reject: (error: unknown) => void;
}>;

/** 让测试明确安排传输完成时间，用于验证取消后仍迟到的成功或失败。 */
function deferredOwnedResponse(): DeferredOwnedResponse {
	let resolve!: DeferredOwnedResponse['resolve'];
	let reject!: DeferredOwnedResponse['reject'];
	const promise: Promise<Endpoints['channels/owned']['res']> = new Promise<Endpoints['channels/owned']['res']>(
		/** Promise 执行器同步提供控制句柄，不增加计时器或环境等待。 */
		(resolvePromise: (value: Endpoints['channels/owned']['res'] | PromiseLike<Endpoints['channels/owned']['res']>) => void, rejectPromise: (error?: unknown) => void): void => {
			resolve = resolvePromise;
			reject = rejectPromise;
		},
	);
	return { promise, resolve, reject };
}

describe('所属频道请求的取消与故障边界', /** 所有数据响应均为空，业务分页另由真实后端验证。 */ (): void => {
	beforeEach(/** 每个用例独占传输记录与预设结果。 */ (): void => {
		vi.mocked(misskeyApi).mockReset();
	});

	it('首拉在途及失败后 initialize 均不重复发起请求', /** 失败不能因再次显示窗口被当作未初始化。 */ async (): Promise<void> => {
		const response: DeferredOwnedResponse = deferredOwnedResponse();
		const query: OwnedChannelsQuery = createOwnedChannelsQuery();
		const failure: Error = new Error('initial transport failure');
		vi.mocked(misskeyApi).mockReturnValueOnce(response.promise);

		const initial: Promise<boolean> = query.initialize();
		expect(query.state.value.status).toBe('loading');
		await expect(query.initialize()).resolves.toBe(false);
		response.reject(failure);
		await expect(initial).resolves.toBe(false);
		const failedState: OwnedChannelsState = query.state.value;
		expect(failedState).toEqual({ status: 'error', operation: 'initial', snapshot: null, error: failure });
		await expect(query.initialize()).resolves.toBe(false);
		expect(query.state.value).toBe(failedState);
		expect(vi.mocked(misskeyApi)).toHaveBeenCalledTimes(1);
		query.dispose();
	});

	it('新刷新取消旧请求，旧 reject 和 finally 不清除新 loading', /** 既验证取消传递，也验证旧请求清理的世代隔离。 */ async (): Promise<void> => {
		const older: DeferredOwnedResponse = deferredOwnedResponse();
		const newer: DeferredOwnedResponse = deferredOwnedResponse();
		const query: OwnedChannelsQuery = createOwnedChannelsQuery();
		vi.mocked(misskeyApi).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
		const initial: Promise<boolean> = query.initialize();
		const initialSignal: AbortSignal | undefined = vi.mocked(misskeyApi).mock.calls[0]?.[3];
		const cancelled: AbortController = new AbortController();
		cancelled.abort();
		await expect(query.reload(cancelled.signal)).resolves.toBe(false);
		expect(initialSignal?.aborted).toBe(false);
		expect(vi.mocked(misskeyApi)).toHaveBeenCalledTimes(1);

		const refresh: Promise<boolean> = query.reload();
		expect(initialSignal?.aborted).toBe(true);
		older.reject(new Error('late obsolete failure'));
		await expect(initial).resolves.toBe(false);
		expect(query.state.value.status).toBe('loading');
		expect(vi.mocked(misskeyApi).mock.calls[1]?.[3]?.aborted).toBe(false);
		newer.resolve([]);
		await expect(refresh).resolves.toBe(true);
		expect(query.state.value.status).toBe('ready');
		query.dispose();
	});

	it.each(['resolve', 'reject'] as const)('新刷新成功后忽略迟到旧请求的 %s', /** 用状态身份验证旧成功或错误均未重新发布快照。 */ async (outcome: 'resolve' | 'reject'): Promise<void> => {
		const older: DeferredOwnedResponse = deferredOwnedResponse();
		const newer: DeferredOwnedResponse = deferredOwnedResponse();
		const query: OwnedChannelsQuery = createOwnedChannelsQuery();
		vi.mocked(misskeyApi).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
		const initial: Promise<boolean> = query.initialize();
		const refresh: Promise<boolean> = query.reload();
		newer.resolve([]);
		await expect(refresh).resolves.toBe(true);
		const current: OwnedChannelsState = query.state.value;
		expect(current).toEqual({ status: 'ready', snapshot: { items: [], nextCursor: null } });

		if (outcome === 'resolve') older.resolve([]);
		else older.reject(new Error('late obsolete failure'));
		await expect(initial).resolves.toBe(false);
		expect(query.state.value).toBe(current);
		query.dispose();
	});

	it.each(['ready', 'error'] as const)('外部取消当前刷新后保留此前 %s 状态', /** 取消应恢复稳定状态而非挂起、清空或重新初始化。 */ async (previousStatus: 'ready' | 'error'): Promise<void> => {
		const first: DeferredOwnedResponse = deferredOwnedResponse();
		const pending: DeferredOwnedResponse = deferredOwnedResponse();
		const query: OwnedChannelsQuery = createOwnedChannelsQuery();
		vi.mocked(misskeyApi).mockReturnValueOnce(first.promise).mockReturnValueOnce(pending.promise);
		const initial: Promise<boolean> = query.initialize();
		if (previousStatus === 'ready') first.resolve([]);
		else first.reject(new Error('retained initial failure'));
		await expect(initial).resolves.toBe(previousStatus === 'ready');
		const previous: OwnedChannelsState = query.state.value;
		const controller: AbortController = new AbortController();
		const refresh: Promise<boolean> = query.reload(controller.signal);
		expect(query.state.value.status).toBe('loading');
		controller.abort();
		expect(vi.mocked(misskeyApi).mock.calls[1]?.[3]?.aborted).toBe(true);
		pending.reject(new Error('transport aborted'));
		await expect(refresh).resolves.toBe(false);
		expect(query.state.value).toBe(previous);
		expect(query.view.value.status).toBe(previousStatus);
		await expect(query.initialize()).resolves.toBe(false);
		expect(vi.mocked(misskeyApi)).toHaveBeenCalledTimes(2);
		query.dispose();
	});

	it('dispose 取消请求并拒绝迟到写入及后续动作', /** 页面销毁后任何完成结果都不能恢复查询。 */ async (): Promise<void> => {
		const response: DeferredOwnedResponse = deferredOwnedResponse();
		const query: OwnedChannelsQuery = createOwnedChannelsQuery();
		vi.mocked(misskeyApi).mockReturnValueOnce(response.promise);
		const initial: Promise<boolean> = query.initialize();
		query.dispose();
		const disposedState: OwnedChannelsState = query.state.value;
		expect(vi.mocked(misskeyApi).mock.calls[0]?.[3]?.aborted).toBe(true);
		response.resolve([]);
		await expect(initial).resolves.toBe(false);
		expect(query.state.value).toBe(disposedState);
		await expect(query.initialize()).resolves.toBe(false);
		await expect(query.reload()).resolves.toBe(false);
		await expect(query.loadMore()).resolves.toBe(false);
		await expect(query.retry()).resolves.toBe(false);
		expect(vi.mocked(misskeyApi)).toHaveBeenCalledTimes(1);
	});

	it('适配器请求 11 条并透明传递游标与取消信号', /** 空响应只验证协议映射，不模拟频道分页业务。 */ async (): Promise<void> => {
		const controller: AbortController = new AbortController();
		vi.mocked(misskeyApi).mockResolvedValue([]);
		const page: OwnedChannelsPage = await fetchOwnedChannelsPage('cursor-boundary', controller.signal);
		expect(page).toEqual({ items: [], nextCursor: null });
		expect(vi.mocked(misskeyApi)).toHaveBeenNthCalledWith(1, 'channels/owned', { limit: 11, untilId: 'cursor-boundary' }, undefined, controller.signal);
		await fetchOwnedChannelsPage(null, controller.signal);
		expect(vi.mocked(misskeyApi)).toHaveBeenNthCalledWith(2, 'channels/owned', { limit: 11 }, undefined, controller.signal);
		expect(vi.mocked(misskeyApi)).toHaveBeenCalledTimes(2);
	});
});
