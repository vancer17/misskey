/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 账户应用层：协调既有账户 Store、登录交互与本地会话恢复；失效恢复不执行云备份或全量存储清理。 */

import { defineAsyncComponent, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { host } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import { showSuspendedDialog } from '@/utility/show-suspended-dialog.js';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { waiting, popup, popupMenu, success, alert } from '@/os.js';
import { unisonReload, reloadChannel } from '@/utility/unison-reload.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import { $i } from '@/i.js';
import { getAccountErrorCode, parseAccountCredentials, requestAccount } from '@/accounts/index.js';
import type { AccountCredentials, AccountWithToken } from '@/accounts/index.js';

export async function getAccounts(): Promise<{
	host: string;
	id: Misskey.entities.User['id'];
	username: Misskey.entities.User['username'];
	user?: Misskey.entities.MeDetailed | null;
	token: string | null;
}[]> {
	const tokens = store.s.accountTokens;
	const accountInfos = store.s.accountInfos;
	const accounts = prefer.s.accounts;
	return accounts.map(([host, user]) => ({
		host,
		id: user.id,
		username: user.username,
		user: accountInfos[host + '/' + user.id],
		token: tokens[host + '/' + user.id] ?? null,
	}));
}

/** 保存真实登录返回的凭据与账户信息；已有账户重新登录时也更新旧凭据。 */
async function addAccount(accountHost: string, user: Misskey.entities.MeDetailed, token: AccountWithToken['token']): Promise<void> {
	await store.ready;
	const key: string = accountHost + '/' + user.id;
	await Promise.all([
		store.set('accountTokens', { ...store.s.accountTokens, [key]: token }),
		store.set('accountInfos', { ...store.s.accountInfos, [key]: user }),
	]);
	const exists: boolean = prefer.s.accounts.some(
		/** 以实例与用户标识查找已保存账户，不把显示信息当作身份事实。 */
		([savedHost, savedUser]: (typeof prefer.s.accounts)[number]): boolean => savedHost === accountHost && savedUser.id === user.id,
	);
	if (!exists) prefer.commit('accounts', [...prefer.s.accounts, [accountHost, { id: user.id, username: user.username }]]);
}

/**
 * 经既有 Store 定向移除一个账户并等待持久化；可选凭据约束防止删除重新登录后的同名账户。
 * 不清理设备配置、不影响其他账户，也不执行需要认证的云端写入。
 */
export async function removeAccount(accountHost: string, id: AccountWithToken['id'], expectedToken?: string): Promise<boolean> {
	await store.ready;
	const key: string = accountHost + '/' + id;
	const savedToken: string | undefined = store.s.accountTokens[key];
	const current: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	if (expectedToken !== undefined && (
		(savedToken !== undefined && savedToken !== expectedToken)
		|| (current?.id === id && current.token !== expectedToken)
	)) return false;

	const tokens: typeof store.s.accountTokens = { ...store.s.accountTokens };
	const accountInfos: typeof store.s.accountInfos = { ...store.s.accountInfos };
	delete tokens[key];
	delete accountInfos[key];
	await Promise.all([store.set('accountTokens', tokens), store.set('accountInfos', accountInfos)]);
	const latest: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	if (expectedToken !== undefined && latest?.id === id && latest.token !== expectedToken) return false;
	prefer.commit('accounts', prefer.s.accounts.filter(
		/** 仅删除指定实例的目标账户，保留其他账户及所有设备偏好。 */
		([savedHost, savedUser]: (typeof prefer.s.accounts)[number]): boolean => savedHost !== accountHost || savedUser.id !== id,
	));
	return true;
}

/** 失效会话的本地恢复入口；旧请求只能移除自身凭据，不能覆盖其他标签页的新会话。 */
export async function removeInvalidAccount(credentials: AccountCredentials): Promise<boolean> {
	const removed: boolean = await removeAccount(host, credentials.id, credentials.token);
	if (!removed) return false;
	const current: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	if (current?.id === credentials.id && current.token === credentials.token) miLocalStorage.removeItem('account');
	return true;
}

/** 登录交互复用独立协议适配器，错误提示不再负责判定或清理当前会话。 */
async function fetchAccount(token: string, id?: string, forceShowDialog?: boolean): Promise<Misskey.entities.MeDetailed> {
	try {
		return await requestAccount(token);
	} catch (error: unknown) {
		const code: string | null = getAccountErrorCode(error);
		const show: boolean = forceShowDialog === true || ($i !== null && (token === $i.token || id === $i.id));
		if (show) {
			if (code === 'SUSPENDED') {
				await showSuspendedDialog();
			} else {
				await alert({
					type: 'error',
					title: code === 'AUTHENTICATION_FAILED' ? i18n.ts.tokenRevoked : code === 'USER_IS_DELETED' ? i18n.ts.accountDeleted : i18n.ts.failedToFetchAccountInformation,
					text: code === 'AUTHENTICATION_FAILED' ? i18n.ts.tokenRevokedDescription : code === 'USER_IS_DELETED' ? i18n.ts.accountDeletedDescription : code ?? i18n.ts.failedToFetchAccountInformation,
				});
			}
		}
		throw error;
	}
}

/** 将已验证账户同步到现有单例和保存账户列表；持久化完成前不结束本次更新。 */
export async function updateCurrentAccount(accountData: Misskey.entities.MeDetailed): Promise<void> {
	if (!$i) return;
	const current: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	if (current?.id !== $i.id || current.token !== $i.token) return;
	const account: AccountWithToken = { ...accountData, token: $i.token };
	for (const key of Object.keys($i)) Reflect.deleteProperty($i, key);
	Object.assign($i, account);
	await addAccount(host, accountData, account.token);
	const latest: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	if (latest?.id === account.id && latest.token === account.token) {
		miLocalStorage.setItem('account', JSON.stringify(account));
	}
}

export function updateCurrentAccountPartial(accountData: Partial<Misskey.entities.MeDetailed>) {
	if (!$i) return;
	for (const [key, value] of Object.entries(accountData)) {
		($i[key as keyof typeof accountData] as any) = value;
	}

	store.set('accountInfos', { ...store.s.accountInfos, [host + '/' + $i.id]: $i });

	miLocalStorage.setItem('account', JSON.stringify($i));
}

export async function login(token: AccountWithToken['token'], redirect?: string) {
	const showing = ref(true);
	const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkWaitingDialog.vue')), {
		success: false,
		showing: showing,
	}, {
		closed: () => dispose(),
	});

	const me = await fetchAccount(token, undefined, true).catch(reason => {
		showing.value = false;
		throw reason;
	});

	miLocalStorage.setItem('account', JSON.stringify({
		...me,
		token,
	}));

	await addAccount(host, me, token);

	if (redirect) {
		// 他のタブは再読み込みするだけ
		reloadChannel.postMessage(null);
		// このページはredirectで指定された先に移動
		window.location.href = redirect;
		return;
	}

	unisonReload();
}

export async function switchAccount(host: string, id: string) {
	const token = store.s.accountTokens[host + '/' + id];
	if (token) {
		login(token);
	} else {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), {}, {
			done: async (res: Misskey.entities.SigninFlowResponse & { finished: true }) => {
				store.set('accountTokens', { ...store.s.accountTokens, [host + '/' + res.id]: res.i });
				login(res.i);
			},
			closed: () => {
				dispose();
			},
		});
	}
}

export async function getAccountMenu(opts: {
	includeCurrentAccount?: boolean;
	withExtraOperation: boolean;
	active?: Misskey.entities.User['id'];
	onChoose?: (account: Misskey.entities.MeDetailed) => void;
}) {
	if ($i == null) throw new Error('No current account');
	const me = $i;

	const callback = opts.onChoose;

	function createItem(host: string, id: Misskey.entities.User['id'], username: Misskey.entities.User['username'], account: Misskey.entities.MeDetailed | null | undefined, token: string | null): MenuItem {
		if (account) {
			return {
				type: 'user' as const,
				user: account,
				active: opts.active != null ? opts.active === id : false,
				action: async () => {
					if (callback) {
						callback(account);
					} else {
						switchAccount(host, id);
					}
				},
			};
		} else if (token != null) {
			return {
				type: 'button' as const,
				text: username,
				active: opts.active != null ? opts.active === id : false,
				action: async () => {
					if (callback) {
						fetchAccount(token, id).then(account => {
							callback(account);
						});
					} else {
						switchAccount(host, id);
					}
				},
			};
		} else { // プロファイルを復元した場合などはアカウントのトークンや詳細情報はstoreにキャッシュされていない
			return {
				type: 'button' as const,
				text: username,
				active: opts.active != null ? opts.active === id : false,
				action: async () => {
					const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), {
						initialUsername: username,
					}, {
						done: async (res: Misskey.entities.SigninFlowResponse & { finished: true }) => {
							store.set('accountTokens', { ...store.s.accountTokens, [host + '/' + res.id]: res.i });

							if (callback) {
								fetchAccount(res.i, id).then(account => {
									callback(account);
								});
							} else {
								switchAccount(host, id);
							}
						},
						closed: () => {
							dispose();
						},
					});
				},
			};
		}
	}

	const menuItems: MenuItem[] = [];

	// TODO: $iのホストも比較したいけど通常null
	const accountItems = (await getAccounts().then(accounts => accounts.filter(x => x.id !== me.id))).map(a => createItem(a.host, a.id, a.username, a.user, a.token));

	if (opts.withExtraOperation) {
		menuItems.push({
			type: 'link',
			text: i18n.ts.profile,
			to: `/@${$i.username}`,
			avatar: $i,
		}, {
			type: 'divider',
		});

		if (opts.includeCurrentAccount) {
			menuItems.push(createItem(host, $i.id, $i.username, $i, $i.token));
		}

		menuItems.push(...accountItems);

		menuItems.push({
			type: 'parent',
			icon: 'ti ti-plus',
			text: i18n.ts.addAccount,
			children: [{
				text: i18n.ts.existingAccount,
				action: () => {
					getAccountWithSigninDialog().then(res => {
						if (res != null) {
							success();
						}
					});
				},
			}, {
				text: i18n.ts.createAccount,
				action: () => {
					getAccountWithSignupDialog().then(res => {
						if (res != null) {
							switchAccount(host, res.id);
						}
					});
				},
			}],
		}, {
			type: 'link',
			icon: 'ti ti-users',
			text: i18n.ts.manageAccounts,
			to: '/settings/accounts',
		});
	} else {
		if (opts.includeCurrentAccount) {
			menuItems.push(createItem(host, $i.id, $i.username, $i, $i.token));
		}

		menuItems.push(...accountItems);
	}

	return menuItems;
}

export function getAccountWithSigninDialog(): Promise<{ id: string, token: string } | null> {
	return new Promise((resolve) => {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSigninDialog.vue')), {}, {
			done: async (res: Misskey.entities.SigninFlowResponse & { finished: true }) => {
				const user = await fetchAccount(res.i, res.id, true);
				await addAccount(host, user, res.i);
				resolve({ id: res.id, token: res.i });
			},
			cancelled: () => {
				resolve(null);
			},
			closed: () => {
				dispose();
			},
		});
	});
}

export function getAccountWithSignupDialog(): Promise<{ id: string, token: string } | null> {
	return new Promise((resolve) => {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSignupDialog.vue')), {}, {
			done: async (res: Misskey.entities.SignupResponse) => {
				const user = JSON.parse(JSON.stringify(res));
				delete user.token;
				await addAccount(host, user, res.token);
				resolve({ id: res.id, token: res.token });
			},
			cancelled: () => {
				resolve(null);
			},
			closed: () => {
				dispose();
			},
		});
	});
}
