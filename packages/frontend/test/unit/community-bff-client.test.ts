/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区 BFF 适配协议测试。
 * 作用：验证授权、HTTP、multipart、票据及取消映射，不把 Mock 结果作为领域业务验收。
 * 数据链：受控宿主授权和响应 → 真实适配器 → 序列化与归属断言。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createCommunityEntityProtocolFixture } from '../../../community-bff-contract/test/index.js';
import { COMMUNITY_BFF_ERROR_CODES } from 'community-bff-contract';
import { createCommunityBffClient } from '@/community-app/adapters/bff/index.js';
import type { CommunityBffClient, CommunityBffClientOptions } from '@/community-app/adapters/bff/index.js';

/** SDK 已有独立真实重连测试；本套件捕获适配器每次向其提交的 URL 供应器。 */
const streamSuppliers: { providers: (() => Promise<string>)[]; closes: (() => void)[] } = vi.hoisted(/** 建立不含真实连接的协议观察容器。 */ (): { providers: (() => Promise<string>)[]; closes: (() => void)[] } => ({ providers: [], closes: [] }));
vi.mock('misskey-js', /** 只替换 WebSocket 构造边界，不伪造业务帧或实体事实。 */ (): Record<string, unknown> => {
	/** 保存适配器传入的供应器，用例主动执行每轮连接解析。 */
	class ProtocolStream {
		/** 捕获公开 SDK 接缝而不打开网络。 */
		constructor(_origin: string, _user: null, options: { urlProvider: () => Promise<string> }) { streamSuppliers.providers.push(options.urlProvider); streamSuppliers.closes.push(this.close); }
		/** 记录客户端释放所属连接。 */
		close: () => void = vi.fn<() => void>();
	}
	return { Stream: ProtocolStream };
});

/** 构造只用于控制协议的最小有效响应，未将它作为真实业务启动证明。 */
function sessionResponse(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	const me: Record<string, unknown> = { ...createCommunityEntityProtocolFixture('MeDetailed'), id: 'account-test-1', username: 'tester', isAdmin: false, isModerator: false, ...(typeof overrides.me === 'object' && overrides.me !== null ? overrides.me as Record<string, unknown> : {}) };
	const meta: Record<string, unknown> = { ...createCommunityEntityProtocolFixture('MetaDetailed'), uri: 'https://community.test', version: 'test', name: 'test', ...(typeof overrides.meta === 'object' && overrides.meta !== null ? overrides.meta as Record<string, unknown> : {}) };
	return { instanceId: 'instance-test-1', sessionId: 'session-test-1', accountId: 'account-test-1', canonicalInstanceUrl: 'https://community.test', accessToken: 'private-bff-credential', expiresAt: '2099-01-01T00:00:00.000Z', ...overrides, me, meta };
}

/** 返回原生 JSON Response，200/204/错误都由实际客户端解释。 */
function response(body: unknown, status: number = 200): Response { return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

/** 为用例创建确定的依赖，不触碰全局认证或持久化。 */
function clientWith(fetchRequest: typeof fetch, extras: Partial<CommunityBffClientOptions> = {}): CommunityBffClient {
	return createCommunityBffClient({ bffBaseUrl: 'https://bff.test/community/v1/', instanceId: 'instance-test-1', canonicalInstanceUrl: 'https://community.test', sessionPort: { getGrant: /** 模拟宿主协议，不交付长期 App token。 */ async (): Promise<string> => 'single-use-grant' }, fetch: fetchRequest, ...extras });
}

describe('community BFF protocol adapter', /** Mock 只证明协议、序列化、取消和映射。 */ (): void => {
	afterEach(/** 恢复真实浏览器方法并清空供应器观察，不保留测试实例。 */ (): void => { vi.restoreAllMocks(); streamSuppliers.providers.length = 0; streamSuppliers.closes.length = 0; });

	it('exchanges grants and publishes a credential-free session view', /** 授权只在兑换 body，Bearer 仅在后续传输头，公共投影移除凭据。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response({ id: 'note-1' }));
		const client: CommunityBffClient = clientWith(network);
		try {
			const view: Awaited<ReturnType<CommunityBffClient['start']>> = await client.start();
			expect(view).not.toHaveProperty('accessToken');
			expect(Object.isFrozen(view)).toBe(true);
			expect(JSON.parse(network.mock.calls[0][1]?.body as string)).toEqual({ instanceId: 'instance-test-1', grant: 'single-use-grant' });
			await client.request('notes/show', { noteId: 'note-1' });
			expect(network.mock.calls[1][0]).toBe('https://bff.test/community/v1/api/notes/show');
			expect(network.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer private-bff-credential', 'X-Community-Instance-Id': 'instance-test-1' });
			expect(JSON.parse(network.mock.calls[1][1]?.body as string)).toEqual({ noteId: 'note-1' });
			expect(network.mock.calls[1][1]?.redirect).toBe('error');
		} finally { client.dispose(); }
	});

	it('rejects explicit Misskey credentials before sending an API request', /** 原站 i 字段不能经 API body 或 query 泄漏给 BFF。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionResponse()));
		const client: CommunityBffClient = clientWith(network);
		try {
			await client.start();
			await expect(client.request('notes/show', { noteId: 'note-1', i: 'legacy-secret' })).rejects.toThrow('COMMUNITY_FORBIDDEN_API_CREDENTIAL');
			await expect(client.get('notes/show', { noteId: 'note-1', i: 'legacy-secret' })).rejects.toThrow('COMMUNITY_FORBIDDEN_API_CREDENTIAL');
			expect(network).toHaveBeenCalledTimes(1);
		} finally { client.dispose(); }
	});

	it('preserves GET query and HTTP 204 without fabricating JSON', /** SDK 查询参数与无正文响应保留原有语义。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response([], 200)).mockResolvedValueOnce(response(null, 204));
		const client: CommunityBffClient = clientWith(network);
		try {
			await client.start();
			await client.get('notes/timeline', { limit: 20 });
			expect(network.mock.calls[1][0]).toBe('https://bff.test/community/v1/api/notes/timeline?limit=20');
			expect(await client.request('notes/delete', { noteId: 'note-1' })).toBeUndefined();
		} finally { client.dispose(); }
	});

	it('single-flights renewal and never replays an uncertain write', /** 两个并发写请求收到过期错误只续期一次，各写请求不重发。 */ async (): Promise<void> => {
		let acceptGrant: ((grant: string) => void) | null = null;
		const getGrant: ReturnType<typeof vi.fn<CommunityBffClientOptions['sessionPort']['getGrant']>> = vi.fn<CommunityBffClientOptions['sessionPort']['getGrant']>().mockResolvedValueOnce('initial-grant').mockImplementationOnce(/** 暂停续期，确保两个过期响应同时合并。 */ (): Promise<string> => new Promise<string>(/** 保留唯一授权完成器。 */ (resolve: (grant: string) => void): void => { acceptGrant = resolve; }));
		const expired: { error: { code: string } } = { error: { code: COMMUNITY_BFF_ERROR_CODES.sessionExpired } };
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response(expired, 401)).mockResolvedValueOnce(response(expired, 401)).mockResolvedValueOnce(response(sessionResponse({ accessToken: 'rotated-private-credential' })));
		const client: CommunityBffClient = clientWith(network, { sessionPort: { getGrant } });
		try {
			await client.start();
			const first: Promise<unknown> = client.request('notes/create', { text: 'write one' });
			const second: Promise<unknown> = client.request('notes/create', { text: 'write two' });
			const outcomes: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([first, second]);
			await vi.waitFor(/** 两个调用共享同一个未完成的宿主授权。 */ (): void => { expect(getGrant).toHaveBeenCalledTimes(2); });
			if (acceptGrant == null) throw new Error('Missing renewal grant');
			(acceptGrant as (grant: string) => void)('renewal-grant');
			expect((await outcomes).map(/** 每个原始写请求仍返回失败。 */ (result: PromiseSettledResult<unknown>): string => result.status)).toEqual(['rejected', 'rejected']);
			expect(network).toHaveBeenCalledTimes(4);
			expect(network.mock.calls[3][1]?.headers).not.toHaveProperty('Authorization');
			expect(client.getSession()?.sessionId).toBe('session-test-1');
		} finally { client.dispose(); }
	});

	it.each([['post', 'sessionRevoked'], ['get', 'sessionRevoked'], ['preview', 'sessionRevoked'], ['ticket', 'sessionRevoked'], ['post', 'sessionExpired'], ['get', 'sessionExpired'], ['preview', 'sessionExpired'], ['ticket', 'sessionExpired']] as const)('ignores a stale credential failure from %s after renewal (%s)', /** 旧凭据请求的迟到 401 不得撤销已轮换的新凭据，或再申请一轮授权。 */ async (transport: 'post' | 'get' | 'preview' | 'ticket', code: 'sessionRevoked' | 'sessionExpired'): Promise<void> => {
		let complete: ((value: Response) => void) | null = null;
		const getGrant: ReturnType<typeof vi.fn<CommunityBffClientOptions['sessionPort']['getGrant']>> = vi.fn<CommunityBffClientOptions['sessionPort']['getGrant']>().mockResolvedValue('single-use-grant');
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockImplementationOnce(/** 旧凭据对应请求延迟到新凭据安装后完成。 */ (): Promise<Response> => new Promise<Response>(/** 保留旧请求的完成器。 */ (resolve: (value: Response) => void): void => { complete = resolve; })).mockResolvedValueOnce(response(sessionResponse({ accessToken: 'rotated-private-credential' })));
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const client: CommunityBffClient = clientWith(network, { sessionPort: { getGrant }, onSessionRequired: notify });
		try {
			await client.start();
			let pending: Promise<unknown>;
			if (transport === 'post') pending = client.request('notes/show', { noteId: 'note-1' });
			else if (transport === 'get') pending = client.get('notes/show', { noteId: 'note-1' });
			else if (transport === 'preview') pending = client.urlPreview('https://page.test', 'zh-CN');
			else { client.createStream(); pending = streamSuppliers.providers[0](); }
			const outcome: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([pending]);
			await vi.waitFor(/** 确认旧凭据请求已经发出。 */ (): void => { expect(network).toHaveBeenCalledTimes(2); });
			await client.renew();
			if (complete == null) throw new Error('Missing stale request');
			(complete as (value: Response) => void)(response({ error: { code: COMMUNITY_BFF_ERROR_CODES[code] } }, 401));
			expect((await outcome)[0].status).toBe('rejected');
			expect(client.getSession()).not.toBeNull();
			expect(getGrant).toHaveBeenCalledTimes(2);
			expect(notify).not.toHaveBeenCalled();
		} finally { client.dispose(); }
	});

	it.each([403, 502])('keeps session on HTTP %s without authentication failure', /** 权限不足和上游故障不会误判为全局退出。 */ async (status: number): Promise<void> => {
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response({ error: { code: status === 403 ? COMMUNITY_BFF_ERROR_CODES.forbidden : COMMUNITY_BFF_ERROR_CODES.upstreamUnavailable } }, status));
		const client: CommunityBffClient = clientWith(network, { onSessionRequired: notify });
		try {
			await client.start();
			await expect(client.request('notes/show', { noteId: 'note-1' })).rejects.toBeInstanceOf(Error);
			expect(client.getSession()).not.toBeNull();
			expect(notify).not.toHaveBeenCalled();
		} finally { client.dispose(); }
	});

	it.each([403, 500])('does not interpret a revoked code at HTTP %s as authentication failure', /** 认证决策同时校验状态与固定错误码，错误上游分类不能撤销会话。 */ async (status: number): Promise<void> => {
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response({ error: { code: COMMUNITY_BFF_ERROR_CODES.sessionRevoked } }, status));
		const client: CommunityBffClient = clientWith(network, { onSessionRequired: notify });
		try {
			await client.start();
			await expect(client.request('notes/show', { noteId: 'note-1' })).rejects.toBeInstanceOf(Error);
			expect(client.getSession()).not.toBeNull();
			expect(notify).not.toHaveBeenCalled();
		} finally { client.dispose(); }
	});

	it('rejects another account during renewal and invalidates the old identity', /** 真实账户变化不得原地复用已捕获原账户的业务单例。 */ async (): Promise<void> => {
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response(sessionResponse({ accountId: 'account-test-2', me: { id: 'account-test-2', username: 'other', isAdmin: false, isModerator: false } })));
		const client: CommunityBffClient = clientWith(network, { onSessionRequired: notify });
		await client.start();
		await expect(client.renew()).rejects.toThrow(COMMUNITY_BFF_ERROR_CODES.identityChanged);
		expect(client.getSession()).toBeNull();
		expect(notify).toHaveBeenCalledWith(COMMUNITY_BFF_ERROR_CODES.identityChanged);
	});

	it('aborts in-flight API requests when the owning instance is disposed', /** 关闭生命周期真正传递取消信号，迟到成功不能提交为有效结果。 */ async (): Promise<void> => {
		let requestSignal: AbortSignal | null = null;
		let complete: ((value: Response) => void) | null = null;
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockImplementationOnce(/** 保存取消信号并模拟迟到的网络完成。 */ (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			requestSignal = init?.signal ?? null;
			return new Promise<Response>(/** 用例决定何时返回迟到成功。 */ (resolve: (value: Response) => void): void => { complete = resolve; });
		});
		const client: CommunityBffClient = clientWith(network);
		await client.start();
		const pending: Promise<unknown> = client.request('notes/show', { noteId: 'note-1' });
		await vi.waitFor(/** 确认业务请求已经在途。 */ (): void => { expect(network).toHaveBeenCalledTimes(2); });
		client.dispose();
		expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
		if (complete == null) throw new Error('Missing request');
		(complete as (value: Response) => void)(response({ id: 'late-note' }));
		await expect(pending).rejects.toHaveProperty('name', 'AbortError');
	});

	it('ignores late authentication errors from a canceled caller', /** 外部 fetch 忽略取消时，迟到 401 不得续期或撤销仍有效的实例。 */ async (): Promise<void> => {
		let complete: ((value: Response) => void) | null = null;
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockImplementationOnce(/** 模拟忽略 signal 的外部网络实现。 */ (): Promise<Response> => new Promise<Response>(/** 保存迟到响应完成器。 */ (resolve: (value: Response) => void): void => { complete = resolve; }));
		const client: CommunityBffClient = clientWith(network, { onSessionRequired: notify });
		try {
			await client.start();
			const controller: AbortController = new AbortController();
			const pending: Promise<unknown> = client.request('notes/show', { noteId: 'note-1' }, controller.signal);
			await vi.waitFor(/** 确认请求已使用当前凭据发出。 */ (): void => { expect(network).toHaveBeenCalledTimes(2); });
			controller.abort();
			await expect(pending).rejects.toHaveProperty('name', 'AbortError');
			if (complete == null) throw new Error('Missing canceled request');
			(complete as (value: Response) => void)(response({ error: { code: COMMUNITY_BFF_ERROR_CODES.sessionRevoked } }, 401));
			await Promise.resolve();
			await Promise.resolve();
			expect(client.getSession()).not.toBeNull();
			expect(notify).not.toHaveBeenCalled();
			expect(network).toHaveBeenCalledTimes(2);
		} finally { client.dispose(); }
	});

	it('revokes only the current BFF session and always disposes local state', /** 撤销调用携带确切会话，不触发宿主全局登出。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response(null, 204));
		const client: CommunityBffClient = clientWith(network);
		await client.start();
		await client.revoke();
		expect(network.mock.calls[1][0]).toBe('https://bff.test/community/v1/session/revoke');
		expect(JSON.parse(network.mock.calls[1][1]?.body as string)).toEqual({ instanceId: 'instance-test-1', sessionId: 'session-test-1' });
		expect(client.getSession()).toBeNull();
	});

	it('invalidates revoked sessions and refuses late or future results', /** 撤销使当前实例同步失效，并通知宿主认证负责人。 */ async (): Promise<void> => {
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response({ error: { code: COMMUNITY_BFF_ERROR_CODES.sessionRevoked } }, 401));
		const client: CommunityBffClient = clientWith(network, { onSessionRequired: notify });
		await client.start();
		await expect(client.request('notes/show', { noteId: 'note-1' })).rejects.toBeInstanceOf(Error);
		expect(client.getSession()).toBeNull();
		expect(notify).toHaveBeenCalledWith(COMMUNITY_BFF_ERROR_CODES.sessionRevoked);
		await expect(client.request('notes/show', { noteId: 'note-2' })).rejects.toHaveProperty('code', COMMUNITY_BFF_ERROR_CODES.sessionRevoked);
		expect(network).toHaveBeenCalledTimes(2);
	});

	it('cancels a shared start waiter immediately and ignores a disposed exchange', /** 不配合取消的迟到响应也不能恢复已销毁的公共会话。 */ async (): Promise<void> => {
		let complete: ((value: Response) => void) | null = null;
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockImplementation(/** 模拟已经进入不可取消阶段的外部传输。 */ (): Promise<Response> => new Promise<Response>(/** 用例控制迟到响应。 */ (resolve: (value: Response) => void): void => { complete = resolve; }));
		const client: CommunityBffClient = clientWith(network);
		const controller: AbortController = new AbortController();
		const pending: Promise<unknown> = client.start(controller.signal);
		await vi.waitFor(/** 确认兑换已经在途。 */ (): void => { expect(network).toHaveBeenCalledTimes(1); });
		controller.abort();
		await expect(pending).rejects.toHaveProperty('name', 'AbortError');
		client.dispose();
		if (complete == null) throw new Error('Missing exchange');
		(complete as (value: Response) => void)(response(sessionResponse()));
		await Promise.resolve();
		expect(client.getSession()).toBeNull();
	});

	it('requests a fresh connection ticket for each SDK URL resolution', /** 不复用票据，不在 WebSocket URL 附加 accessToken 或 Misskey i。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response({ ticket: 'ticket-one', expiresAt: '2099-01-01T00:00:00.000Z' })).mockResolvedValueOnce(response({ ticket: 'ticket-two', expiresAt: '2099-01-01T00:00:00.000Z' }));
		const client: CommunityBffClient = clientWith(network);
		await client.start();
		client.createStream();
		expect(await streamSuppliers.providers[0]()).toBe('wss://bff.test/community/v1/stream?ticket=ticket-one');
		expect(await streamSuppliers.providers[0]()).toBe('wss://bff.test/community/v1/stream?ticket=ticket-two');
		expect(JSON.parse(network.mock.calls[1][1]?.body as string)).toEqual({ instanceId: 'instance-test-1', sessionId: 'session-test-1' });
		client.dispose();
		expect(streamSuppliers.closes[0]).toHaveBeenCalledOnce();
	});

	it('serializes multipart without i and preserves the cancellation result', /** 上传认证只在头中，文件字段沿用既有协议。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionResponse()));
		const send: MockInstance<XMLHttpRequest['send']> = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(/** 捕获原生 multipart 不发送网络。 */ (): void => {});
		const setHeader: MockInstance<XMLHttpRequest['setRequestHeader']> = vi.spyOn(XMLHttpRequest.prototype, 'setRequestHeader');
		const client: CommunityBffClient = clientWith(network);
		try {
			await client.start();
			const upload: ReturnType<CommunityBffClient['upload']> = client.upload(new File(['payload'], 'pet.jpg'), { caption: 'caption', folderId: 'folder', isSensitive: true });
			await vi.waitFor(/** 等待到期检查后真实创建 XHR。 */ (): void => { expect(send).toHaveBeenCalledOnce(); });
			const body: unknown = send.mock.calls[0][0];
			if (!(body instanceof FormData)) throw new Error('Expected multipart');
			expect(body.has('i')).toBe(false);
			expect(body.get('comment')).toBe('caption');
			expect(body.get('folderId')).toBe('folder');
			expect(body.get('isSensitive')).toBe('true');
			expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer private-bff-credential');
			upload.abort();
			await expect(upload.filePromise).rejects.toHaveProperty('name', 'UploadAbortedError');
		} finally { client.dispose(); }
	});

	it('ignores an old upload credential error after renewal', /** 已轮换凭据后旧 XHR 的迟到 401 只结束旧上传，不影响新会话。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sessionResponse())).mockResolvedValueOnce(response(sessionResponse({ accessToken: 'rotated-private-credential' })));
		const send: MockInstance<XMLHttpRequest['send']> = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(/** 捕获旧凭据 XHR，不发送网络。 */ (): void => {});
		const notify: ReturnType<typeof vi.fn<(code: string) => void>> = vi.fn<(code: string) => void>();
		const client: CommunityBffClient = clientWith(network, { onSessionRequired: notify });
		try {
			await client.start();
			const upload: ReturnType<CommunityBffClient['upload']> = client.upload(new File(['payload'], 'pet.jpg'));
			const outcome: Promise<PromiseSettledResult<unknown>[]> = Promise.allSettled([upload.filePromise]);
			await vi.waitFor(/** 确认旧凭据文件已在途。 */ (): void => { expect(send).toHaveBeenCalledOnce(); });
			await client.renew();
			const request: unknown = send.mock.contexts[0];
			if (!(request instanceof XMLHttpRequest)) throw new Error('Missing upload request');
			Object.defineProperty(request, 'status', { value: 401 });
			Object.defineProperty(request, 'responseText', { value: JSON.stringify({ error: { code: COMMUNITY_BFF_ERROR_CODES.sessionRevoked } }) });
			request.dispatchEvent(new ProgressEvent('load'));
			expect((await outcome)[0].status).toBe('rejected');
			expect(client.getSession()).not.toBeNull();
			expect(network).toHaveBeenCalledTimes(2);
			expect(notify).not.toHaveBeenCalled();
		} finally { client.dispose(); }
	});

	it('projects upload errors before exposing them to the original UI', /** 原始响应的额外字段与凭据不得沿上传提示路径流入业务组件。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionResponse()));
		const send: MockInstance<XMLHttpRequest['send']> = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(/** 拦截 multipart，错误响应由用例发布。 */ (): void => {});
		const client: CommunityBffClient = clientWith(network);
		try {
			await client.start();
			const upload: ReturnType<CommunityBffClient['upload']> = client.upload(new File(['payload'], 'pet.jpg'));
			const failure: Promise<unknown> = upload.filePromise.catch(/** 观察适配器实际交付的安全错误对象。 */ (error: unknown): unknown => error);
			await vi.waitFor(/** 等待真实 XHR 对象创建。 */ (): void => { expect(send).toHaveBeenCalledOnce(); });
			const request: unknown = send.mock.contexts[0];
			if (!(request instanceof XMLHttpRequest)) throw new Error('Missing upload request');
			Object.defineProperty(request, 'status', { value: 403 });
			Object.defineProperty(request, 'responseText', { value: JSON.stringify({ rawSecret: 'private-response-secret', error: { id: 'permission-id', code: 'PERMISSION_DENIED', kind: 'permission', message: 'Permission denied', accessToken: 'private-response-secret', info: { safe: true, token: 'private-response-secret' } } }) });
			request.dispatchEvent(new ProgressEvent('load'));
			const error: unknown = await failure;
			expect(JSON.stringify(error)).not.toContain('private-response-secret');
			expect(error).toHaveProperty('body.error.kind', 'permission');
			expect(error).toHaveProperty('body.error.info', { safe: true });
		} finally { client.dispose(); }
	});

	it('preserves a non-JSON HTTP 413 through the BFF upload mapping', /** 代理 HTML 超限错误经过 BFF 安全投影仍保留状态，不泄漏原始正文。 */ async (): Promise<void> => {
		const network: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>().mockResolvedValue(response(sessionResponse()));
		const send: MockInstance<XMLHttpRequest['send']> = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(/** 只观察上传协议，由用例交付代理错误回执。 */ (): void => {});
		const client: CommunityBffClient = clientWith(network);
		try {
			await client.start();
			const upload: ReturnType<CommunityBffClient['upload']> = client.upload(new File(['payload'], 'pet.jpg'));
			const failure: Promise<unknown> = upload.filePromise.catch(/** 观察真实适配器拒绝，不能以成功文件替代。 */ (error: unknown): unknown => error);
			await vi.waitFor(/** 确认 XHR 已建立，再发布真实形状代理 HTML。 */ (): void => { expect(send).toHaveBeenCalledOnce(); });
			const request: unknown = send.mock.contexts[0];
			if (!(request instanceof XMLHttpRequest)) throw new Error('Missing upload request');
			Object.defineProperty(request, 'status', { value: 413 });
			Object.defineProperty(request, 'responseText', { value: '<html>Request Entity Too Large: private-proxy-details</html>' });
			request.dispatchEvent(new ProgressEvent('load'));
			const error: unknown = await failure;
			expect(error).toHaveProperty('status', 413);
			expect(JSON.stringify(error)).not.toContain('private-proxy-details');
			expect(client.getSession()).not.toBeNull();
		} finally { client.dispose(); }
	});
});
