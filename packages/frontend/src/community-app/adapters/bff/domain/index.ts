/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * 文件领域：社区 BFF 外部适配能力契约。
 * 作用：声明宿主授权与传输依赖，业务事实直接引用权威契约和 SDK 类型。
 * 数据链：宿主能力 → 实例级客户端 → 既有 SDK 响应，不定义平行业务实体。
 */
import type * as Misskey from 'misskey-js';
import type { CommunityBffGrantRequest, CommunityBffSessionView } from 'community-bff-contract';
import type { DriveUploadHandle, DriveUploadOptions } from '@/utility/upload-transport/index.js';

/** 宿主授权能力；长期 App 凭据和外部登录始终留在宿主。 */
export type CommunityHostSessionPort = Readonly<{
	/** 为当前实例及可选既有会话申请一次性授权。 */
	getGrant: (request: CommunityBffGrantRequest & { signal: AbortSignal }) => Promise<string>;
	/** 认证失效时向宿主提交意图，由宿主处理重新登录。 */
	notifyAuthRequired?: (code: string) => void;
}>;

export type { CommunityBffSessionView } from 'community-bff-contract';

/** 外部传输依赖允许替换，账户与业务规则由真实后端决定。 */
export type CommunityBffClientOptions = Readonly<{
	bffBaseUrl: string;
	instanceId: string;
	canonicalInstanceUrl: string;
	sessionPort: CommunityHostSessionPort;
	/** 替换外部 HTTP 实现时必须遵守相同的请求与取消协议。 */
	fetch?: typeof globalThis.fetch;
	/** 替换外部 XHR 实现时仍保留同一上传协议与取消控制。 */
	createXhr?: () => XMLHttpRequest;
	/** 仅权威会话失效触发此通知，不接收凭据。 */
	onSessionRequired?: (code: string) => void;
	/** 发布凭据已移除的真实会话投影。 */
	onSession?: (session: CommunityBffSessionView) => void;
}>;

/** 单个社区实例拥有的公开传输能力，不提供原始凭据读取入口。 */
export type CommunityBffClient = Readonly<{
	/** 以宿主授权启动真实 BFF 会话。 */
	start: (signal?: AbortSignal) => Promise<CommunityBffSessionView>;
	/** 合并同身份续期，不重放业务写请求。 */
	renew: (signal?: AbortSignal) => Promise<CommunityBffSessionView>;
	/** 撤销远端社区会话，并释放本地实例。 */
	revoke: (signal?: AbortSignal) => Promise<void>;
	/** 保留 SDK POST 参数和响应投影。 */
	request: <E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(endpoint: E, params: P, signal?: AbortSignal) => Promise<Misskey.api.SwitchCaseResponseType<E, P>>;
	/** 保留 SDK GET 参数和响应投影。 */
	get: <E extends keyof Misskey.Endpoints, P extends Misskey.Endpoints[E]['req']>(endpoint: E, params: P, signal?: AbortSignal) => Promise<Misskey.api.SwitchCaseResponseType<E, P>>;
	/** 带真实进度及取消的 multipart 上传。 */
	upload: (file: File | Blob, options?: DriveUploadOptions) => DriveUploadHandle;
	/** 复用 SDK 频道池，连接及重连前分别申请票据。 */
	createStream: () => Misskey.IStream;
	/** 返回现有组件消费的链接预览响应。 */
	urlPreview: (url: string, language: string, signal?: AbortSignal) => Promise<Response>;
	/** 读取剔除短期凭据的会话投影。 */
	getSession: () => CommunityBffSessionView | null;
	/** 同步结束本地实例，不隐式注销整个宿主 App。 */
	dispose: () => void;
}>;
