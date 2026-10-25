/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 私信与 Misskey API、流式通道之间的适配边界。
 * 负责认证账户校验、取消请求与服务端实体的冻结归一化；不读取运行环境、交付身份或运维探测。
 */
import type { Endpoints, entities, api } from 'misskey-js';
import { $i } from '@/i.js';
import { updateCurrentAccountPartial } from '@/accounts.js';
import { parseAccountCredentials } from '@/accounts/index.js';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import type { ChatFailure, ChatMessage } from '../domain/index.js';

/** 递归冻结 JSON 实体，阻止视图反向修改服务端事实。 */
export function freezeEntity<T>(value: T): Readonly<T> {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		for (const child of Object.values(value) as unknown[]) freezeEntity(child);
		Object.freeze(value);
	}
	return value as Readonly<T>;
}

/** 读取当前认证账户的只读业务快照，拒绝跨账户请求。 */
export function accountSnapshot(accountId: string): Readonly<NonNullable<typeof $i>> {
	if (!$i || $i.id !== accountId) throw new Error('ACCOUNT_CHANGED');
	return freezeEntity(JSON.parse(JSON.stringify($i)) as NonNullable<typeof $i>);
}

/** 检查只读依赖仍属于同一认证会话，拒绝同账户换令牌后的迟到结果。 */
export function isCurrentAccount(accountId: string, token: string): boolean {
	return $i?.id === accountId && $i.token === token;
}

/** 在固定认证账户下执行类型化 API；传入取消信号并显式绑定该账户令牌。 */
export async function request<E extends keyof Endpoints, P extends Endpoints[E]['req']>(accountId: string, endpoint: E, params: P, signal: AbortSignal): Promise<api.SwitchCaseResponseType<E, P>> {
	if (!$i || $i.id !== accountId) throw new Error('ACCOUNT_CHANGED');
	const data: P & { i?: string | null } = { ...params } as P & { i?: string | null };
	return await misskeyApi<void, E, P, api.SwitchCaseResponseType<E, P>>(endpoint, data, $i.token, signal);
}

/** 将接口失败转换为只读展示状态；不在客户端重建服务端权限规则。 */
export function failureFrom(error: unknown): ChatFailure {
	if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
		const info: unknown = 'info' in error ? error.info : null;
		const reason: string | null = typeof info === 'object' && info !== null && 'reason' in info && typeof info.reason === 'string' ? info.reason : null;
		return Object.freeze({ code: error.code, message: 'message' in error && typeof error.message === 'string' ? error.message : error.code, reason });
	}
	return Object.freeze({ code: error instanceof Error ? error.name : 'UNKNOWN', message: error instanceof Error ? error.message : 'UNKNOWN', reason: null });
}

/** 网络取消与传输失败可能发生在服务端已写入之后，必须等待人工确认而不能重发。 */
export function isUncertainFailure(error: unknown): boolean {
	return !(typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string');
}

/** 将私聊省略的用户字段补齐为权威实体，群聊必须保留服务端携带的成员。 */
export function normalizeMessage(message: entities.ChatMessageLite | entities.ChatMessage, actor: Readonly<entities.UserLite>, other: Readonly<entities.UserLite> | null): ChatMessage {
	const sender: Readonly<entities.UserLite> | undefined = message.fromUser ?? (message.fromUserId === actor.id ? actor : other?.id === message.fromUserId ? other : undefined);
	if (!sender) throw new Error('MESSAGE_SENDER_MISSING');
	const reactions: entities.ChatMessage['reactions'] = message.reactions.map(/** 补齐私聊协议省略的反应者。 */ (item: entities.ChatMessageLite['reactions'][number]): entities.ChatMessage['reactions'][number] => {
		const user: Readonly<entities.UserLite> | undefined = item.user ?? (message.toRoomId ? undefined : message.fromUserId === actor.id ? other ?? undefined : actor);
		if (!user) throw new Error('REACTION_USER_MISSING');
		return { reaction: item.reaction, user: user as entities.UserLite };
	});
	return freezeEntity({ ...message, fromUser: sender as entities.UserLite, reactions });
}

/** 正在同步的账户未读查询；多事件共用一次请求链。 */
let unreadPending: Promise<boolean> | null = null;
/** 请求期间再次发生失效时补查，避免迟到快照覆盖后续消息。 */
let unreadDirty: boolean = false;

/** 从账户权威快照更新全局未读点，绝不从不完整会话分页推算未读总数。 */
export function syncChatUnreadState(): Promise<boolean> {
	if (!$i) return Promise.resolve(false);
	unreadDirty = true;
	if (unreadPending) return unreadPending;
	unreadPending = refreshUnread();
	return unreadPending;
}

/** 合并连续的未读失效，并拒绝账户变化后的迟到结果。 */
async function refreshUnread(): Promise<boolean> {
	try {
		while (unreadDirty) {
			unreadDirty = false;
			const accountId: string | undefined = $i?.id;
			const token: string | undefined = $i?.token;
			if (!accountId) return false;
			const controller: AbortController = new AbortController();
			const account: Endpoints['i']['res'] = await request(accountId, 'i', {}, controller.signal);
			if (!$i || $i.id !== accountId || $i.token !== token) return false;
			if (unreadDirty) continue;
			const saved: ReturnType<typeof parseAccountCredentials> = parseAccountCredentials(miLocalStorage.getItem('account'));
			if (!saved || saved.id !== accountId || saved.token !== token) return false;
			updateCurrentAccountPartial({ hasUnreadChatMessages: account.hasUnreadChatMessages });
		}
		return true;
	} catch {
		return false;
	} finally {
		unreadPending = null;
	}
}
