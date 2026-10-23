/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：本人成就全局查询状态。
 * 作用：唯一持有已确认列表，合并失效意图，以账户和修订号隔离迟到响应。
 * 数据链：真实成功／回访意图 → 串行查询 → 只读状态；组件与账户快照均不保存解锁副本。
 */
import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import type { Achievement, AchievementName, OwnAchievementsState } from '../domain/index.js';
import { fetchOwnAchievements } from '../adapters/query.js';
import { $i } from '@/i.js';
import { globalEvents } from '@/events.js';
import { claimAchievement } from '@/utility/achievements.js';
import { parseAccountCredentials } from '@/accounts/index.js';
import type { AccountCredentials } from '@/accounts/index.js';
import { miLocalStorage } from '@/local-storage.js';

/** 模块私有唯一快照；应用只通过公开 computed 和动作访问。 */
const snapshot: ShallowRef<OwnAchievementsState> = shallowRef<OwnAchievementsState>({ userId: null, status: 'idle', items: null });
/** 可见业务容器的引用计数，只参与请求调度。 */
const consumers: Set<symbol> = new Set<symbol>();
/** 失效序号隔离请求开始后发生的新事实。 */
let revision: number = 0;
/** 同一账户在途请求保持串行，不并发覆盖。 */
let running: boolean = false;
/** 在途期间的新意图必须保留到下一次查询。 */
let pending: boolean = false;
/** 微任务合并同轮挂载与成功事件。 */
let scheduled: boolean = false;
/** 当前协议请求用于账户范围切换时取消。 */
let controller: AbortController | null = null;

/** 全局 Store 只公开只读派生值，不泄露可写 ref。 */
const state: ComputedRef<OwnAchievementsState> = computed(/** 组件读取唯一快照，无复制列表。 */ (): OwnAchievementsState => snapshot.value);

/** 只有当前登录账户仍拥有此快照和请求，才允许提交事实。 */
function isCurrentAccount(userId: string, token: string): boolean {
	const saved: AccountCredentials | null = parseAccountCredentials(miLocalStorage.getItem('account'));
	return $i?.id === userId && $i.token === token && saved?.id === userId && saved.token === token && snapshot.value.userId === userId;
}

/** 串行消费最新失效意图；错误停在当前状态，不自动循环重试。 */
async function flush(): Promise<void> {
	scheduled = false;
	if (running || !pending || consumers.size === 0 || $i == null) return;
	const userId: string = $i.id;
	const token: string = $i.token;
	if (!isCurrentAccount(userId, token)) { pending = false; return; }
	const requestRevision: number = revision;
	const request: AbortController = new AbortController();
	pending = false;
	running = true;
	controller = request;
	snapshot.value = { ...snapshot.value, status: 'loading' };
	try {
		const items: readonly Achievement[] = await fetchOwnAchievements(userId, token, request.signal);
		if (isCurrentAccount(userId, token) && requestRevision === revision && !request.signal.aborted) {
			snapshot.value = { userId, status: 'ready', items };
		}
	} catch (_error: unknown) {
		if (isCurrentAccount(userId, token) && requestRevision === revision && !request.signal.aborted) {
			snapshot.value = { ...snapshot.value, status: 'error' };
		}
	} finally {
		running = false;
		if (controller === request) controller = null;
		if (pending) schedule();
	}
}

/** 合并同轮请求；新意图发生在在途请求中时，由其 finally 继续消费。 */
function schedule(): void {
	if (scheduled || running || consumers.size === 0) return;
	scheduled = true;
	queueMicrotask(/** 在同一轮挂载结束后启动唯一请求。 */ (): void => { void flush(); });
}

/** 成功信号只使已选择账户失效，不直接写入成就事实。 */
function invalidate(userId: string): void {
	if ($i?.id !== userId || snapshot.value.userId !== userId) return;
	revision += 1;
	pending = true;
	schedule();
}

/** 可见页面开始消费；第一次挂载与首次 activated 共用同一个租约。 */
function activate(): () => void {
	const consumer: symbol = Symbol('own-achievements');
	const first: boolean = consumers.size === 0;
	consumers.add(consumer);
	if ($i != null) {
		if (snapshot.value.userId !== $i.id) {
			controller?.abort();
			snapshot.value = { userId: $i.id, status: 'idle', items: null };
		}
		if (first) invalidate($i.id);
	}
	return /** 暂停后保留快照；回访会重新确认，不把后台停留作为可见。 */ (): void => {
		consumers.delete(consumer);
	};
}

/** 页面计时与组件交互共用申领动作；资格条件仍由原 utility 负责。 */
async function claim(name: AchievementName): Promise<void> {
	await claimAchievement(name);
}

/** 显式重试再次查询服务端，不能以通知或旧账户列表恢复事实。 */
function retry(): void {
	if ($i != null) invalidate($i.id);
}

globalEvents.on('achievementClaimed', invalidate);

/** 成就业务唯一状态与动作；沿用 Misskey 响应式 Store 架构，不建立第二套状态框架。 */
export const ownAchievementsStore: Readonly<{
	state: ComputedRef<OwnAchievementsState>;
	activate: () => () => void;
	invalidate: (userId: string) => void;
	claim: (name: AchievementName) => Promise<void>;
	retry: () => void;
}> = Object.freeze({ state, activate, invalidate, claim, retry });
