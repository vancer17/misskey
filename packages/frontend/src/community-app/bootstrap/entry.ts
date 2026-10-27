/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：包内社区的轻量 HTML 启动入口。
 * 作用：安装冻结的宿主依赖接缝并显示真实启动状态；不导入账户、语言单例或业务模块。
 * 数据链：静态 HTML → Bootstrap API；业务就绪留待真实 BFF 会话装配，不发送 READY 或假 ACK。
 */
import { COMMUNITY_SUPPORTED_LANGUAGES, createCommunityBootstrapApi } from './index.js';
import type { CommunityBootMessages, CommunityBootSnapshot, CommunityBootstrapApi, CommunitySupportedLanguage } from './index.js';

declare global {
	/** 仅由受信任的包内 App 装配层消费，不属于双面容器消息协议。 */
	interface Window {
		__MISSKEY_COMMUNITY_BOOTSTRAP__?: CommunityBootstrapApi;
	}
}

const panel: HTMLElement | null = window.document.querySelector('[data-testid="community-app-bootstrap"]');
const message: HTMLElement | null = panel?.querySelector('[data-community-boot-message]') ?? null;

/** 校验随 HTML 内联的现有语言标签，不接受业务代码或可执行内容。 */
function readBootMessages(): Readonly<Record<CommunitySupportedLanguage, CommunityBootMessages>> {
	const raw: string | null = window.document.getElementById('community-boot-messages')?.textContent ?? null;
	if (raw === null) throw new Error('COMMUNITY_BOOT_MESSAGES_REQUIRED');
	const parsed: unknown = JSON.parse(raw) as unknown;
	if (typeof parsed !== 'object' || parsed === null) throw new Error('COMMUNITY_INVALID_BOOT_MESSAGES');
	const source: Record<string, unknown> = parsed as Record<string, unknown>;
	const result: Partial<Record<CommunitySupportedLanguage, CommunityBootMessages>> = {};
	for (const language of COMMUNITY_SUPPORTED_LANGUAGES) {
		const candidate: unknown = source[language];
		if (typeof candidate !== 'object' || candidate === null) throw new Error('COMMUNITY_INVALID_BOOT_MESSAGES');
		const labels: Record<string, unknown> = candidate as Record<string, unknown>;
		if (typeof labels.waitingHost !== 'string' || typeof labels.sessionRequired !== 'string' || typeof labels.failed !== 'string') throw new Error('COMMUNITY_INVALID_BOOT_MESSAGES');
		result[language] = Object.freeze({ waitingHost: labels.waitingHost, sessionRequired: labels.sessionRequired, failed: labels.failed });
	}
	return Object.freeze(result) as Readonly<Record<CommunitySupportedLanguage, CommunityBootMessages>>;
}

const bootMessages: Readonly<Record<CommunitySupportedLanguage, CommunityBootMessages>> = readBootMessages();

/** 只更新静态 HTML 已提供的语言标签，不触发原语言、账户或资源加载链。 */
function renderState(state: CommunityBootSnapshot): void {
	if (panel === null) return;
	panel.dataset.phase = state.phase;
	const language: CommunitySupportedLanguage = state.language ?? 'zh-CN';
	window.document.documentElement.lang = language;
	const labels: CommunityBootMessages = bootMessages[language];
	const label: string = state.phase === 'WAITING_HOST' ? labels.waitingHost : state.phase === 'SESSION_REQUIRED' ? labels.sessionRequired : labels.failed;
	if (message !== null) message.textContent = label;
}

if (window.__MISSKEY_COMMUNITY_BOOTSTRAP__ !== undefined) throw new Error('COMMUNITY_BOOTSTRAP_ALREADY_INSTALLED');
const bootstrapApi: CommunityBootstrapApi = createCommunityBootstrapApi(window.parent, window, renderState);
Object.defineProperty(window, '__MISSKEY_COMMUNITY_BOOTSTRAP__', { value: bootstrapApi, configurable: false, writable: false });
renderState(bootstrapApi.getState());
