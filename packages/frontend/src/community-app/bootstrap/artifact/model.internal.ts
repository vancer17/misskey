/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：社区本地制品 Bootstrap 清单的纯模型。
 * 作用：统一构建器与本地加载器使用的路径、版本和摘要类型；不承载账户或业务策略。
 * 数据链：构建输入 → 不含自摘要的文件清单 → App 装配校验与社区启动。
 */

/** 社区首版随包交付的语言权威列表，构建器与启动校验共同消费。 */
export const COMMUNITY_SUPPORTED_LANGUAGES = [
	/** 中文界面资源。 */
	'zh-CN',
	/** 英文界面资源。 */
	'en-US',
	/** 日文上游权威资源。 */
	'ja-JP',
] as const;

/** 从唯一语言列表派生可接受的启动语言。 */
export type CommunitySupportedLanguage = typeof COMMUNITY_SUPPORTED_LANGUAGES[number];

/** 描述相对于社区制品根目录的单个有效载荷文件，不包含清单文件自身。 */
export type CommunityArtifactFile = Readonly<{
	path: string;
	sha256: string;
	bytes: number;
}>;

/** 从已有语言权威资源派生的轻量启动标签，不加载业务语言单例。 */
export type CommunityBootMessages = Readonly<{
	waitingHost: string;
	sessionRequired: string;
	sessionEstablished: string;
	failed: string;
}>;

/** 描述本地资源的装配身份与入口，语言入口只由 Bootstrap 使用。 */
export type CommunityRuntimeManifest = Readonly<{
	formatVersion: 1;
	bootstrap: string;
	application: Readonly<Record<string, string>>;
	styles: readonly string[];
	supportedLanguages: readonly string[];
	bootMessages: Readonly<Record<string, CommunityBootMessages>>;
	sourceRevision: string;
	sourceFingerprint: string;
	sourceDirty: boolean;
	version: string;
}>;

/** 在运行装配清单上附加完整载荷摘要，供 App 构建阶段核验文件闭包。 */
export type CommunityArtifactManifest = CommunityRuntimeManifest & Readonly<{
	files: readonly CommunityArtifactFile[];
}>;
