/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 通知状态协调：合并 HTTP 与实时事件的对账意图，不持有未读数量副本。
 * 数据链：已读确认／实时失效 → 同会话账户查询 → 既有账户状态的两个未读字段。
 * 请求不绑定页面生命周期；已开始的已读操作在离页后仍完成，失败等待下一次明确意图。
 */
import type * as Misskey from 'misskey-js';
import { captureAccountOwnership, ownsAccountRequest } from '@/accounts/ownership/index.js';
import type { AccountRequestOwner } from '@/accounts/ownership/index.js';
import { updateCurrentAccountPartial } from '@/accounts.js';
import type { NotificationUnreadState } from '../domain/notification-read.js';
import { acknowledgeNotifications, requestNotificationsAccount } from '../adapters/notification-read-api.js';

/** 单次合并批次仅保存会话与调度信息，不包含任何通知实体或未读业务事实。 */
type NotificationReadRequest = {
	owner: AccountRequestOwner;
	markAsRead: boolean;
	generation: number;
	resolvers: Array<(success: boolean) => void>;
};

/** 下一轮待确认的账户批次，不保存任何凭据。 */
let pending: NotificationReadRequest | null = null;
/** 现有串行调度器的运行状态。 */
let running: boolean = false;
/** 每次新意图推进代次，拒绝迟到快照。 */
let generation: number = 0;

/** 校验两个请求使用同一不透明身份，跨会话批次不共享完成结果。 */
function sameSession(left: AccountRequestOwner, right: AccountRequestOwner): boolean {
	return left.accountId === right.accountId && left.identity === right.identity;
}

/** 完成本批调用者；结果只描述确认与对账是否成功，不派生任何未读事实。 */
function settle(request: NotificationReadRequest, success: boolean): void {
	for (const resolve of request.resolvers) resolve(success);
}

/** 串行消费批次，后到的失效意图阻止旧快照提交并保留下一轮查询。 */
async function flush(): Promise<void> {
	while (pending !== null) {
		const request: NotificationReadRequest = pending;
		pending = null;
		if (!ownsAccountRequest(request.owner)) {
			settle(request, false);
			continue;
		}
		let succeeded: boolean = false;
		try {
			if (request.markAsRead) await acknowledgeNotifications(request.owner);
			if (!ownsAccountRequest(request.owner)) {
				settle(request, false);
				continue;
			}
			const afterWrite: NotificationReadRequest | null = pending as NotificationReadRequest | null;
			if (afterWrite !== null && sameSession(request.owner, afterWrite.owner)) {
				if (afterWrite.markAsRead) {
					// 在途写入期间的新读意图需要推进自己的水位，直接交给下一批，避免冗余查询。
					afterWrite.resolvers.unshift(...request.resolvers);
					continue;
				}
				// 写入确认产生的实时失效信号可由紧接着的查询覆盖，无需再读一次账户。
				request.generation = afterWrite.generation;
				request.resolvers.push(...afterWrite.resolvers);
				pending = null;
			}
			const account: Misskey.entities.MeDetailed = await requestNotificationsAccount(request.owner);
			succeeded = ownsAccountRequest(request.owner) && account.id === request.owner.accountId;
			if (succeeded && request.generation === generation) {
				const unread: NotificationUnreadState = {
					hasUnreadNotification: account.hasUnreadNotification,
					unreadNotificationsCount: account.unreadNotificationsCount,
				};
				updateCurrentAccountPartial(unread);
			}
		} catch (error: unknown) {
			// 保留最后成功账户值；不将网络失败解释为全部已读，也不自动无限重试。
			console.error(error);
		}
		// await 期间事件入口可以写入 pending；显式恢复异步边界之后的联合类型。
		const next: NotificationReadRequest | null = pending as NotificationReadRequest | null;
		if (succeeded && next !== null && sameSession(request.owner, next.owner)) {
			// 当前查询失效时，调用者等待已经排队的新查询，避免把跳过提交当作完成。
			next.resolvers.unshift(...request.resolvers);
		} else {
			settle(request, succeeded && request.generation === generation);
		}
	}
	running = false;
}

/** 将动作加入唯一调度队列；同轮意图合并，已读写入优先于本批账户查询。 */
function enqueue(markAsRead: boolean): Promise<boolean> {
	const owner: AccountRequestOwner | null = captureAccountOwnership();
	if (owner === null) return Promise.resolve(false);
	generation++;
	return new Promise<boolean>(/** 注册本次完成结果，不保留调用组件或页面实体。 */ (resolve: (success: boolean) => void): void => {
		if (pending !== null && sameSession(pending.owner, owner)) {
			pending.markAsRead ||= markAsRead;
			pending.generation = generation;
			pending.resolvers.push(resolve);
		} else {
			if (pending !== null) settle(pending, false);
			pending = { owner, markAsRead, generation, resolvers: [resolve] };
		}
		if (!running) {
			running = true;
			queueMicrotask(/** 同一同步轮次只创建一个任务，初次挂载与激活不会重复请求。 */ (): void => { void flush(); });
		}
	});
}

/** 确认已读并从服务端对账；组件不得自行归零账户角标。 */
export async function confirmNotificationsRead(): Promise<boolean> {
	return await enqueue(true);
}

/** 实时消息只声明账户未读状态失效，HTTP 快照作为唯一提交依据。 */
export async function syncNotificationUnreadState(): Promise<boolean> {
	return await enqueue(false);
}
