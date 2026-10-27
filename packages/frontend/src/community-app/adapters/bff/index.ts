/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区 BFF 认证与传输适配。
 * 作用：在私有闭包中保管短期凭据，统一 HTTP、上传及流票据，不承担领域业务决策。
 * 数据链：宿主单次 grant → BFF 会话 → SDK 原协议；对外仅交付移除凭据的会话视图。
 */
import * as Misskey from 'misskey-js';
import {
	CommunityBffError,
	COMMUNITY_BFF_ERROR_CODES,
	createCommunityBffEndpoints,
	parseCommunityBffError,
	parseCommunityBffSession,
	parseCommunityBffStreamTicket,
	assertCommunityBffApiParameters,
	isCommunityBffEndpoint,
} from 'community-bff-contract';
import type { CommunityBffSession, CommunityBffSessionView } from 'community-bff-contract';
import { createDriveUploadRequest, DriveUploadHttpError, UploadAbortedError } from '@/utility/upload-transport/index.js';
import type { DriveUploadHandle, DriveUploadOptions } from '@/utility/upload-transport/index.js';

import type { CommunityBffClient, CommunityBffClientOptions } from './domain/index.js';

/** BFF 模块只通过本索引暴露权威外部能力与无凭据会话投影。 */
export type { CommunityBffClient, CommunityBffClientOptions, CommunityHostSessionPort, CommunityBffSessionView } from './domain/index.js';

/** 为单个 iframe 实例创建独立客户端；凭据与取消控制器不离开该闭包。 */
export function createCommunityBffClient(input: CommunityBffClientOptions): CommunityBffClient {
	const options: CommunityBffClientOptions = Object.freeze({ ...input, sessionPort: Object.freeze({ getGrant: input.sessionPort.getGrant.bind(input.sessionPort), notifyAuthRequired: input.sessionPort.notifyAuthRequired?.bind(input.sessionPort) }) });
	const endpoints: ReturnType<typeof createCommunityBffEndpoints> = createCommunityBffEndpoints(options.bffBaseUrl);
	const fetchRequest: typeof globalThis.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	const lifetime: AbortController = new AbortController();
	const streams: Set<Misskey.IStream> = new Set<Misskey.IStream>();
	let session: CommunityBffSession | null = null;
	let view: CommunityBffSessionView | null = null;
	let pendingStart: Promise<CommunityBffSessionView> | null = null;
	let pendingRenewal: Promise<CommunityBffSessionView> | null = null;
	let invalidated: boolean = false;
	let credentialGeneration: number = 0;

	/** 任何关闭或失效后的异步结果都不能再次取得会话或复活实例。 */
	function assertLive(signal?: AbortSignal): void {
		if (lifetime.signal.aborted) throw lifetime.signal.reason instanceof Error ? lifetime.signal.reason : new DOMException('Community request aborted', 'AbortError');
		if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Community request aborted', 'AbortError');
		if (invalidated) throw new Error('Community session is no longer valid');
	}

	/** 撤销当前实例并同步取消所有在途传输，网络错误不会调用此方法。 */
	function invalidate(code: string): void {
		if (invalidated || lifetime.signal.aborted) return;
		invalidated = true;
		session = null;
		view = null;
		lifetime.abort(new CommunityBffError(code === COMMUNITY_BFF_ERROR_CODES.identityChanged ? 409 : 401, code));
		for (const stream of streams) stream.close();
		streams.clear();
		options.onSessionRequired?.(code);
		options.sessionPort.notifyAuthRequired?.(code);
	}

	/** 合并实例与调用方取消信号，并在完成后释放临时监听。 */
	async function withSignal<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		assertLive(signal);
		const controller: AbortController = new AbortController();
		const abort: () => void = /** 任一所属生命周期结束都取消本次请求并保留固定认证失效原因。 */ (): void => { controller.abort(signal?.aborted ? signal.reason as unknown : lifetime.signal.reason as unknown); };
		lifetime.signal.addEventListener('abort', abort, { once: true });
		signal?.addEventListener('abort', abort, { once: true });
		try {
			const result: T = await new Promise<T>(/** 即使外部适配器忽略 signal，也立即终结调用方等待并观察迟到结果。 */ (resolve: (value: T) => void, reject: (reason?: unknown) => void): void => {
				const canceled: () => void = /** 取消原因只来自所属生命周期，不读取外部响应。 */ (): void => { reject(controller.signal.reason as unknown); };
				controller.signal.addEventListener('abort', canceled, { once: true });
				try {
					const task: Promise<T> = operation(controller.signal);
					void task.then(
						/** 只交付当前等待者，释放取消监听。 */ (value: T): void => { controller.signal.removeEventListener('abort', canceled); resolve(value); },
						/** 观察迟到拒绝，避免取消后出现未处理 Promise。 */ (error: unknown): void => { controller.signal.removeEventListener('abort', canceled); reject(error); },
					);
				} catch (error: unknown) {
					controller.signal.removeEventListener('abort', canceled);
					reject(error);
				}
			});
			assertLive(controller.signal);
			return result;
		} finally {
			lifetime.signal.removeEventListener('abort', abort);
			signal?.removeEventListener('abort', abort);
		}
	}

	/** 保留 HTTP 204；JSON 或网络故障不被伪装为认证错误。 */
	async function readResponse(response: Response): Promise<unknown> {
		if (response.status === 204) return undefined;
		try { return await response.json() as unknown; } catch (_error: unknown) { throw new CommunityBffError(response.status, COMMUNITY_BFF_ERROR_CODES.invalidError); }
	}

	/** 创建仅适用于 BFF 的认证头；凭据不写入 body、查询或业务模型。 */
	function headers(authenticated: boolean): Record<string, string> {
		const value: Record<string, string> = { 'X-Community-Instance-Id': options.instanceId };
		if (authenticated) {
			if (session == null) throw new Error('Community session required');
			value.Authorization = `Bearer ${session.accessToken}`;
		}
		return value;
	}

	/** 验证兑换／续期的真实归属，禁止续期将现有实例切换至另一账户。 */
	function acceptSession(input: unknown, previous: CommunityBffSession | null): CommunityBffSessionView {
		const next: CommunityBffSession = parseCommunityBffSession(input);
		if (next.instanceId !== options.instanceId || new URL(next.canonicalInstanceUrl).href !== new URL(options.canonicalInstanceUrl).href || next.accountId !== next.me.id || Date.parse(next.expiresAt) <= Date.now()) throw new Error('COMMUNITY_SESSION_OWNERSHIP_MISMATCH');
		if (previous != null && (next.sessionId !== previous.sessionId || next.accountId !== previous.accountId)) {
			invalidate(COMMUNITY_BFF_ERROR_CODES.identityChanged);
			throw new Error(COMMUNITY_BFF_ERROR_CODES.identityChanged);
		}
		session = next;
		credentialGeneration++;
		view = Object.freeze({ sessionId: next.sessionId, instanceId: next.instanceId, accountId: next.accountId, canonicalInstanceUrl: next.canonicalInstanceUrl, expiresAt: next.expiresAt, me: next.me, meta: next.meta });
		options.onSession?.(view);
		return view;
	}

	/** 只对权威 BFF 会话错误改变认证状态，普通权限错误和上游故障原样交付。 */
	async function rejectResponse(status: number, body: unknown, allowRenewal: boolean, requestGeneration: number): Promise<never> {
		const error: CommunityBffError = parseCommunityBffError(status, body);
		if (requestGeneration !== credentialGeneration) throw error.apiError ?? error;
		if (status === 401 && error.code === COMMUNITY_BFF_ERROR_CODES.sessionExpired && allowRenewal) {
			try { await renew(); } catch { /* 续期失败保留原写请求错误，不重放该操作。 */ }
		} else if ((status === 401 && (error.code === COMMUNITY_BFF_ERROR_CODES.sessionRevoked || error.code === COMMUNITY_BFF_ERROR_CODES.grantInvalid || (error.code === COMMUNITY_BFF_ERROR_CODES.sessionExpired && !allowRenewal))) || (status === 409 && error.code === COMMUNITY_BFF_ERROR_CODES.identityChanged)) invalidate(error.code);
		throw error.apiError ?? error;
	}

	/** 使用真实授权建立或续期会话；grant 不进入持久化与状态投影。 */
	async function establish(previous: CommunityBffSession | null, signal?: AbortSignal): Promise<CommunityBffSessionView> {
		return await withSignal(signal, /** grant 与交换请求共同受当前实例取消控制。 */ async (activeSignal: AbortSignal): Promise<CommunityBffSessionView> => {
			const grant: string = await options.sessionPort.getGrant({ instanceId: options.instanceId, ...(previous == null ? {} : { sessionId: previous.sessionId }), signal: activeSignal });
			assertLive(activeSignal);
			if (typeof grant !== 'string' || grant.length === 0) throw new Error('Missing community grant');
			const requestGeneration: number = credentialGeneration;
			const response: Response = await fetchRequest(previous == null ? endpoints.exchange : endpoints.renew, {
				method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: activeSignal,
				headers: { ...headers(false), 'Content-Type': 'application/json' },
				body: JSON.stringify({ instanceId: options.instanceId, grant, ...(previous == null ? {} : { sessionId: previous.sessionId }) }),
			});
			const body: unknown = await readResponse(response);
			assertLive(activeSignal);
			if (!response.ok) return await rejectResponse(response.status, body, false, requestGeneration);
			return acceptSession(body, previous);
		});
	}

	/** 并发启动只兑换一份授权；已启动时返回无凭据的当前会话。 */
	async function start(signal?: AbortSignal): Promise<CommunityBffSessionView> {
		assertLive(signal);
		if (view != null) return view;
		if (pendingStart == null) pendingStart = establish(null).finally(/** 清除已完成启动任务，不缓存失败。 */ (): void => { pendingStart = null; });
		return await waitForShared(pendingStart, signal);
	}

	/** 合并同会话续期；凭据轮换保持账户和不透明业务会话身份。 */
	async function renew(signal?: AbortSignal): Promise<CommunityBffSessionView> {
		assertLive(signal);
		if (session == null) throw new Error('Community session required');
		if (pendingRenewal == null) pendingRenewal = establish(session).finally(/** 完成后允许下一轮真实续期。 */ (): void => { pendingRenewal = null; });
		return await waitForShared(pendingRenewal, signal);
	}

	/** 调用方可以立即取消共享任务的等待，而不破坏其他等待者的续期。 */
	async function waitForShared<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
		return await withSignal(signal, /** 多调用方共享上游任务，各自保留立即取消等待的能力。 */ async (): Promise<T> => await promise);
	}

	/** 到期请求先合并续期，业务写入始终只发送一次。 */
	async function ready(signal?: AbortSignal): Promise<void> {
		assertLive(signal);
		if (session == null) throw new Error('Community session required');
		if (Date.parse(session.expiresAt) <= Date.now()) await renew(signal);
	}

	/** endpoint 仅允许 Misskey 命名路径，禁止成为任意 URL 代理。 */
	function apiUrl(endpoint: string): string {
		if (!isCommunityBffEndpoint(endpoint)) throw new Error('COMMUNITY_INVALID_ENDPOINT');
		return `${endpoints.apiBase}/${endpoint}`;
	}

	/** 沿用 SDK 的 endpoint、参数与响应投影，HTTP 失败不会自动重放业务操作。 */
	async function request<E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(endpoint: E, params: P, signal?: AbortSignal): Promise<Misskey.api.SwitchCaseResponseType<E, P>> {
		assertCommunityBffApiParameters(params);
		await ready(signal);
		return await withSignal(signal, /** 请求结果仅交付仍有效的实例。 */ async (activeSignal: AbortSignal): Promise<Misskey.api.SwitchCaseResponseType<E, P>> => {
			const requestGeneration: number = credentialGeneration;
			const response: Response = await fetchRequest(apiUrl(endpoint), { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { ...headers(true), 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: activeSignal });
			const body: unknown = await readResponse(response);
			assertLive(activeSignal);
			if (!response.ok) return await rejectResponse(response.status, body, true, requestGeneration);
			return body as Misskey.api.SwitchCaseResponseType<E, P>;
		});
	}

	/** 保留既有 GET 参数字符串化形式，认证仅通过 HTTP 头交付。 */
	async function get<E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(endpoint: E, params: P, signal?: AbortSignal): Promise<Misskey.api.SwitchCaseResponseType<E, P>> {
		assertCommunityBffApiParameters(params);
		await ready(signal);
		const query: URLSearchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
		return await withSignal(signal, /** GET 响应与 POST 使用相同会话归属及错误语义。 */ async (activeSignal: AbortSignal): Promise<Misskey.api.SwitchCaseResponseType<E, P>> => {
			const requestGeneration: number = credentialGeneration;
			const response: Response = await fetchRequest(`${apiUrl(endpoint)}?${query}`, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: headers(true), signal: activeSignal });
			const body: unknown = await readResponse(response);
			assertLive(activeSignal);
			if (!response.ok) return await rejectResponse(response.status, body, true, requestGeneration);
			return body as Misskey.api.SwitchCaseResponseType<E, P>;
		});
	}

	/** 上传使用相同会话与实例取消；保留真实进度，不在失败后重发文件。 */
	function upload(file: File | Blob, uploadOptions: DriveUploadOptions = {}): DriveUploadHandle {
		const controller: AbortController = new AbortController();
		let transport: DriveUploadHandle | null = null;
		const filePromise: Promise<Misskey.entities.DriveFile> = withSignal(controller.signal, /** 到期续期后才创建 multipart 请求。 */ async (signal: AbortSignal): Promise<Misskey.entities.DriveFile> => {
			const abort: () => void = /** 调用方取消只作用于这份文件。 */ (): void => { controller.abort(); };
			uploadOptions.signal?.addEventListener('abort', abort, { once: true });
			try {
				if (uploadOptions.signal?.aborted) throw new UploadAbortedError();
				await ready(signal);
				const requestGeneration: number = credentialGeneration;
				transport = createDriveUploadRequest(file, { ...uploadOptions, signal }, { url: endpoints.upload, headers: headers(true), createXhr: options.createXhr });
				try { return await transport.filePromise; } catch (error: unknown) {
					assertLive(signal);
					if (error instanceof DriveUploadHttpError) {
						const safeError: CommunityBffError = parseCommunityBffError(error.status, error.body);
						try { await rejectResponse(error.status, error.body, true, requestGeneration); } catch { /* 认证处理后仅交付安全错误投影，不重发或泄漏原始响应。 */ }
						throw new DriveUploadHttpError(error.status, { error: safeError.apiError ?? { code: safeError.code, message: safeError.code } });
					}
					if (error instanceof SyntaxError) throw new Error('COMMUNITY_INVALID_UPLOAD_RESPONSE');
					throw error;
				}
			} finally { uploadOptions.signal?.removeEventListener('abort', abort); }
		}).catch(/** 取消发生在续期前或 XHR 建立后都沿用既有上传取消回执。 */ (error: unknown): never => {
			if (controller.signal.aborted || uploadOptions.signal?.aborted || lifetime.signal.aborted) throw new UploadAbortedError();
			throw error;
		});
		return { filePromise, abort: /** 同步取消等待及已创建的 XHR。 */ (): void => { controller.abort(); transport?.abort(); } };
	}

	/** 每次连接前领取独立短票据，复用 SDK 频道池与重连协议。 */
	function createStream(): Misskey.IStream {
		assertLive();
		if (session == null) throw new Error('Community session required');
		const stream: Misskey.IStream = new Misskey.Stream(options.canonicalInstanceUrl, null, {
			urlProvider: /** 重连也重新认证票据，不复用上一次连接 URL。 */ async (): Promise<string> => {
				await ready();
				return await withSignal(undefined, /** 票据申请及迟到结果受实例释放控制。 */ async (signal: AbortSignal): Promise<string> => {
					const requestGeneration: number = credentialGeneration;
					const response: Response = await fetchRequest(endpoints.streamTicket, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { ...headers(true), 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: options.instanceId, sessionId: session?.sessionId }), signal });
					const body: unknown = await readResponse(response);
					assertLive(signal);
					if (!response.ok) return await rejectResponse(response.status, body, true, requestGeneration);
					const ticket: ReturnType<typeof parseCommunityBffStreamTicket> = parseCommunityBffStreamTicket(body);
					if (Date.parse(ticket.expiresAt) <= Date.now()) throw new Error('Expired community stream ticket');
					const url: URL = new URL(endpoints.stream);
					url.searchParams.set('ticket', ticket.ticket);
					return url.href;
				});
			},
		});
		streams.add(stream);
		return stream;
	}

	/** 链接预览使用 BFF 来源，返回原始 Response 供原组件保留既有解释。 */
	async function urlPreview(url: string, language: string, signal?: AbortSignal): Promise<Response> {
		await ready(signal);
		const address: URL = new URL(endpoints.urlPreview);
		address.searchParams.set('url', url);
		address.searchParams.set('lang', language);
		return await withSignal(signal, /** 辅助资源同样受短会话及取消约束。 */ async (activeSignal: AbortSignal): Promise<Response> => {
			const requestGeneration: number = credentialGeneration;
			const response: Response = await fetchRequest(address.href, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: headers(true), signal: activeSignal });
			assertLive(activeSignal);
			if (response.status === 401 || response.status === 409) {
				const body: unknown = await readResponse(response);
				assertLive(activeSignal);
				return await rejectResponse(response.status, body, true, requestGeneration);
			}
			return response;
		});
	}

	/** 返回凭据已剔除的当前会话，业务不能借此取得 Bearer。 */
	function getSession(): CommunityBffSessionView | null { return view; }

	/** 明确请求撤销社区短会话；即使远端失败也结束本地实例，调用方仍收到失败。 */
	async function revoke(signal?: AbortSignal): Promise<void> {
		try {
			await withSignal(signal, /** 撤销只作用于当前 BFF session，不触及宿主登录。 */ async (activeSignal: AbortSignal): Promise<void> => {
				if (session == null) return;
				const requestGeneration: number = credentialGeneration;
				const response: Response = await fetchRequest(endpoints.revoke, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { ...headers(true), 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: options.instanceId, sessionId: session.sessionId }), signal: activeSignal });
				assertLive(activeSignal);
				if (!response.ok) {
					const body: unknown = await readResponse(response);
					assertLive(activeSignal);
					await rejectResponse(response.status, body, false, requestGeneration);
				}
			});
		} finally { dispose(); }
	}

	/** 同步释放本地生命周期；不隐式注销宿主 App 或声称远端撤销成功。 */
	function dispose(): void {
		if (lifetime.signal.aborted) return;
		lifetime.abort();
		for (const stream of streams) stream.close();
		streams.clear();
		session = null;
		view = null;
	}

	return Object.freeze({ start, renew, revoke, request, get, upload, createStream, urlPreview, getSession, dispose });
}
