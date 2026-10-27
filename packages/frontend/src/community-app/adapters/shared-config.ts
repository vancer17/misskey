/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：嵌入社区的共享配置构建接缝。
 * 作用：保留旧展示消费者所需导出，但禁止用本地来源推导远端业务地址。
 * 数据链：完整应用生命周期尚未接通时终止业务求值；轻量 Bootstrap 不导入此模块。
 */
import { requireCommunityApplication } from '../bootstrap/index.js';
import type { CommunityHostDependencies } from '../bootstrap/index.js';
import { createCommunityBffEndpoints } from 'community-bff-contract';
import defaultIconAssetUrl from '/static-assets/icons/512.png';

const dependencies: CommunityHostDependencies = requireCommunityApplication();
const endpoints: ReturnType<typeof createCommunityBffEndpoints> = createCommunityBffEndpoints(dependencies.bffBaseUrl);
const instanceAddress: URL = new URL(dependencies.canonicalInstanceUrl);

/** 公开实例主机，只能从显式装配依赖派生。 */
export const host: string = instanceAddress.host;
/** 公开实例域名，不使用本地 App 来源冒充实例。 */
export const hostname: string = instanceAddress.hostname;
/** 社区内容链接的权威实例基础地址。 */
export const url: string = instanceAddress.origin;
/** 公开实例端口。 */
export const port: string = instanceAddress.port;
/** 明确装配的 BFF HTTP 基础地址。 */
export const apiUrl: string = endpoints.apiBase;
/** 明确装配的 BFF WebSocket 基础地址。 */
export const wsOrigin: string = endpoints.stream;
/** 语言由 Bootstrap 选择，不读取同源 App 的语言缓存。 */
export const lang: string = dependencies.language;
/** 语言显示列表沿用构建器的既有权威常量。 */
export const langs: typeof _LANGS_ = _LANGS_;
/** 构建版本只用于制品与展示，不参与业务规则。 */
export const version: string = _VERSION_;
/** 会话接入前不会显示实例名称；后续由真实实例元数据提供。 */
export const instanceName: string = host;
/** 默认图标与社区代码一同打包，不请求 App 根路径或远端网页。 */
export const defaultIconUrl: string = defaultIconAssetUrl;
/** 嵌入产物固定为 Twitter，不从 URL 或持久化设置切换架构。 */
export const ui: string = 'twitter' as const;
/** 当前嵌入制品不消费遗留调试开关。 */
export const debug: boolean = false;
/** 当前嵌入入口不消费原生安全模式架构开关。 */
export const isSafeMode: boolean = false;
/** 减少运动偏好只保留平台原生读取，M09 的设备验收结论不在此改变。 */
export const prefersReducedMotion: boolean = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
