/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 协议寻址。
 * 作用：从已验证的单一 HTTPS 协议基址派生 HTTP 与 WSS 端点。
 * 数据链：Bootstrap 冻结配置 → 传输适配器端点，不读取环境或本地持久化配置。
 */

/** 固定 v1 协议路径；版本属于接口 Schema，不用于切换前端业务架构。 */
export const COMMUNITY_BFF_PATHS = {
	/** 宿主申请单次授权。 */
	grant: 'grants',
	/** 社区兑换短会话。 */
	exchange: 'session/exchange',
	/** 同身份续期。 */
	renew: 'session/renew',
	/** 撤销社区会话。 */
	revoke: 'session/revoke',
	/** Misskey 兼容 API 转发。 */
	api: 'api',
	/** 带进度和取消语义的文件上传。 */
	upload: 'upload',
	/** 单次流连接票据签发。 */
	streamTicket: 'stream-ticket',
	/** Misskey 兼容 WebSocket 流。 */
	stream: 'stream',
	/** 链接预览辅助资源。 */
	urlPreview: 'url-preview',
} as const;

/** 当前 Misskey 逻辑 endpoint 的权威路径模式；排除协议、查询和目录穿越。 */
export const COMMUNITY_BFF_ENDPOINT_PATTERN: string = '^[a-z0-9-]+(?:/[a-z0-9-]+)*$';

/** 校验逻辑 endpoint 形状；是否有权调用仍必须由真实 BFF 清单决定。 */
export function isCommunityBffEndpoint(endpoint: string): boolean {
	return new RegExp(COMMUNITY_BFF_ENDPOINT_PATTERN).test(endpoint);
}

/** 冻结传输端点，无认证信息也不承载业务状态。 */
export type CommunityBffEndpoints = Readonly<{
	grants: string;
	exchange: string;
	renew: string;
	revoke: string;
	apiBase: string;
	upload: string;
	streamTicket: string;
	stream: string;
	urlPreview: string;
}>;

/** 接受完整协议基目录，例如 https://bff.example/community/v1/，并冻结全部同源端点。 */
export function createCommunityBffEndpoints(baseUrl: string): CommunityBffEndpoints {
	let base: URL;

	try {
		base = new URL(baseUrl);
	} catch (_error: unknown) {
		throw new Error('COMMUNITY_INVALID_BFF_BASE');
	}

	if (base.protocol !== 'https:' || base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') throw new Error('COMMUNITY_INVALID_BFF_BASE');
	base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
	if (!base.pathname.endsWith('/community/v1/')) throw new Error('COMMUNITY_INVALID_BFF_BASE');

	/** 按相对协议路径生成同源地址，调用方不能覆盖 host。 */
	function endpoint(relativePath: string): string {
		return new URL(relativePath, base).href;
	}

	const stream: URL = new URL(endpoint(COMMUNITY_BFF_PATHS.stream));
	stream.protocol = 'wss:';
	return Object.freeze({
		grants: endpoint(COMMUNITY_BFF_PATHS.grant),
		exchange: endpoint(COMMUNITY_BFF_PATHS.exchange),
		renew: endpoint(COMMUNITY_BFF_PATHS.renew),
		revoke: endpoint(COMMUNITY_BFF_PATHS.revoke),
		apiBase: endpoint(COMMUNITY_BFF_PATHS.api),
		upload: endpoint(COMMUNITY_BFF_PATHS.upload),
		streamTicket: endpoint(COMMUNITY_BFF_PATHS.streamTicket),
		stream: stream.href,
		urlPreview: endpoint(COMMUNITY_BFF_PATHS.urlPreview),
	});
}
