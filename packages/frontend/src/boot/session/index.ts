/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Bootstrap 会话恢复入口：在导入账户单例、Store 与页面之前验证本地凭据。
 * 只编排账户协议，不探测部署环境；临时失败保留缓存并等待用户重试。
 */
import { i18n } from '@/i18n.js';
import { getAccountErrorCode, getInvalidSessionReason, parseAccountCredentials, requestAccount } from '@/accounts/index.js';
import type { AccountCredentials, AccountWithToken, InvalidSession, InvalidSessionReason } from '@/accounts/index.js';

/**
 * 展示启动前的可重试状态，不依赖尚未加载的 Vue 弹窗或业务 Store。
 * 用户重试或其他标签页改变账户后继续验证；只显示脱敏错误码。
 */
function waitForRetry(error: unknown): Promise<void> {
	const panel: HTMLElement = window.document.createElement('section');
	panel.id = 'session-retry';
	panel.setAttribute('role', 'alert');
	panel.className = '_gaps';
	panel.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:var(--MI_THEME-bg);color:var(--MI_THEME-fg);';
	const heading: HTMLHeadingElement = window.document.createElement('h1');
	heading.textContent = i18n.ts.failedToFetchAccountInformation;
	const detail: HTMLParagraphElement = window.document.createElement('p');
	detail.textContent = getAccountErrorCode(error) ?? i18n.ts.failedToFetchAccountInformation;
	const button: HTMLButtonElement = window.document.createElement('button');
	button.type = 'button';
	button.className = '_button';
	button.textContent = i18n.ts.retry;
	panel.append(heading, detail, button);
	window.document.getElementById('splash')?.remove();
	window.document.body.appendChild(panel);
	button.focus();
	return new Promise<void>(
		/** 等待明确的重试动作，同时在结束时释放事件监听及临时界面。 */
		(resolve: () => void): void => {
			/** 用户操作或账户变化完成后关闭临时启动状态。 */
			function retry(): void {
				button.removeEventListener('click', retry);
				window.removeEventListener('storage', onAccountChange);
				panel.remove();
				resolve();
			}

			/** 其他标签页建立新会话后重新读取缓存，而不复用过期验证结果。 */
			function onAccountChange(event: StorageEvent): void {
				if (event.key === 'account' || event.key === null) retry();
			}

			button.addEventListener('click', retry);
			window.addEventListener('storage', onAccountChange);
		},
	);
}

/**
 * 以后端账户接口为权威恢复当前会话；返回需要由账户模块定向清理的失效快照。
 * 对请求前后的缓存做比较，旧请求失败不得覆盖其他标签页写入的新登录态。
 */
export async function prepareBootSession(): Promise<InvalidSession | null> {
	for (;;) {
		const raw: string | null = window.localStorage.getItem('account');
		if (raw === null) return null;
		const credentials: AccountCredentials | null = parseAccountCredentials(raw);
		if (credentials === null) {
			if (window.localStorage.getItem('account') !== raw) continue;
			window.localStorage.removeItem('account');
			console.warn('Removed malformed current-account cache; unrelated storage was retained.');
			return null;
		}
		try {
			const me: Awaited<ReturnType<typeof requestAccount>> = await requestAccount(credentials.token);
			if (window.localStorage.getItem('account') !== raw) continue;
			const account: AccountWithToken = { ...me, token: credentials.token };
			window.localStorage.setItem('account', JSON.stringify(account));
			return null;
		} catch (error: unknown) {
			if (window.localStorage.getItem('account') !== raw) continue;
			const reason: InvalidSessionReason | null = getInvalidSessionReason(error);
			if (reason !== null) {
				window.localStorage.removeItem('account');
				return Object.freeze({ credentials, reason });
			}
			console.warn('Account validation is unavailable; the credential was retained.', getAccountErrorCode(error));
			await waitForRetry(error);
		}
	}
}
