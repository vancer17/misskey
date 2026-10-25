/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 连接提示的展示时序单元测试。
 * 作用：通过受控连接事件与浏览器生命周期验证宽限、关闭和资源释放。
 * 数据链：受控 SDK 状态及展示门控 → 真实启动层观察者 → 只读 visible。
 * 本文件不模拟业务数据，也不证明真实连接重试或私信恢复；后者由真实后端集成验证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import type { Ref } from 'vue';
import type { IStream, StreamEvents } from 'misskey-js';
import { createTwitterStreamNotice } from '@/ui/twitter/bootstrap/index.js';
import type { TwitterStreamNoticeController } from '@/ui/twitter/bootstrap/index.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import { useStream } from '@/stream.js';

/** 仅派生观察器需要的现有账户字段，不定义账户业务事实。 */
type AccountGateFixture = Pick<NonNullable<typeof $i>, 'id' | 'token'>;

const accountGate: { state: Ref<AccountGateFixture | null> | null } = vi.hoisted(
	/** 在 mock 初始化时接入真实 Vue ref，使登录边界可被 watch 观察。 */ (): { state: Ref<AccountGateFixture | null> | null } => ({ state: null }),
);

vi.mock('@/i.js', /** 仅提供账户门控输入，不构造或验证账户业务模型。 */ async (): Promise<{ readonly $i: AccountGateFixture | null }> => {
	const vueModule: typeof import('vue') = await import('vue');
	accountGate.state = vueModule.ref<AccountGateFixture | null>({ id: 'account', token: 'token' });
	return {
		/** 模拟现有账户模块的当前引用，允许只验证匿名边界的订阅清理。 */
		get $i(): AccountGateFixture | null { return accountGate.state?.value ?? null; },
	};
});
vi.mock('@/store.js', /** 使用真实 Vue 响应式输入验证实时模式观察者的生命周期。 */ async (): Promise<{ store: { s: { realtimeMode: boolean } } }> => {
	const vueModule: typeof import('vue') = await import('vue');
	return { store: { s: vueModule.reactive({ realtimeMode: true }) } };
});
vi.mock('@/preferences.js', /** 只替换现有展示偏好来源，类型从原偏好权威定义派生。 */ async (): Promise<{ prefer: { s: Pick<typeof prefer.s, 'serverDisconnectedBehavior'> } }> => {
	const vueModule: typeof import('vue') = await import('vue');
	return { prefer: { s: vueModule.reactive<Pick<typeof prefer.s, 'serverDisconnectedBehavior'>>({ serverDisconnectedBehavior: 'quiet' }) } };
});
vi.mock('@/stream.js', /** 仅替换共享连接获取入口，禁止测试启动真实网络连接。 */ (): { useStream: typeof useStream } => ({
	/** 实际事件源由各用例提供，只观察调用次数和订阅关系。 */
	useStream: vi.fn<typeof useStream>(),
}));

/** 测试连接只实现提示使用的事件机制和 SDK 权威 state 属性。 */
type NoticeStreamFixture = EventEmitter<StreamEvents> & Pick<IStream, 'state'>;

let stream: NoticeStreamFixture;
let notice: TwitterStreamNoticeController | null = null;

/** 同步可见性输入并派发真实 DOM 事件，不把环境结果写入业务状态。 */
function setVisibility(visibility: DocumentVisibilityState): void {
	vi.spyOn(window.document, 'visibilityState', 'get').mockReturnValue(visibility);
	window.document.dispatchEvent(new Event('visibilitychange'));
}

/** 依 SDK 顺序先更新权威状态再发事件，测试仅覆盖 UI 对事件的反应。 */
function setConnection(state: IStream['state']): void {
	stream.state = state;
	if (state === 'connected') stream.emit('_connected_');
	if (state === 'reconnecting') stream.emit('_disconnected_');
}

/** 统一保存待释放租约，失败场景也不会泄漏 DOM 或 Stream 监听。 */
function startNotice(): TwitterStreamNoticeController {
	notice = createTwitterStreamNotice();
	return notice;
}

beforeEach(/** 每个场景独占 fake timer、SDK 事件源和展示门控。 */ (): void => {
	vi.useFakeTimers();
	stream = Object.assign(new EventEmitter<StreamEvents>(), { state: 'connected' as IStream['state'] });
	vi.mocked(useStream).mockReset().mockReturnValue(stream as IStream);
	store.s.realtimeMode = true;
	prefer.s.serverDisconnectedBehavior = 'quiet';
	if (accountGate.state == null) throw new Error('missing account gate fixture');
	accountGate.state.value = { id: 'account', token: 'token' };
	setVisibility('visible');
});

afterEach(/** 释放被测租约并恢复浏览器时间与可见性 getter。 */ (): void => {
	notice?.dispose();
	notice = null;
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('Twitter 连接提示展示生命周期', /** 不将受控事件源视作真实业务恢复证明。 */ (): void => {
	it('连接正常或初始化中时不显示历史断线提示', /** 首次连接未就绪不等同于已连接后的断线。 */ (): void => {
		stream.state = 'initializing';
		const controller: TwitterStreamNoticeController = startNotice();
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
		setConnection('connected');
		expect(controller.visible.value).toBe(false);
	});

	it('挂载前已经断线时从当前状态启动宽限，重连后自动隐藏', /** 监听绑定后的首次读取覆盖已经丢失的断线事件。 */ (): void => {
		stream.state = 'reconnecting';
		const controller: TwitterStreamNoticeController = startNotice();
		vi.advanceTimersByTime(2999);
		expect(controller.visible.value).toBe(false);
		vi.advanceTimersByTime(1);
		expect(controller.visible.value).toBe(true);
		setConnection('connected');
		expect(controller.visible.value).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('短暂断线在宽限内恢复不会弹出提示', /** 已取消的宽限不能在恢复后留下旧提示。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(2999);
		setConnection('connected');
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
	});

	it('后台取消旧宽限，回前台时为仍断开的连接重新计时', /** 后台时间不累计为前台展示等待时间。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(2500);
		setVisibility('hidden');
		vi.advanceTimersByTime(10000);
		expect(controller.visible.value).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		setVisibility('visible');
		vi.advanceTimersByTime(2999);
		expect(controller.visible.value).toBe(false);
		vi.advanceTimersByTime(1);
		expect(controller.visible.value).toBe(true);
	});

	it('后台恢复连接后回访不会显示提示', /** 隐藏期间的恢复也会清除当前轮次的关闭标记。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setVisibility('hidden');
		setConnection('reconnecting');
		vi.advanceTimersByTime(10000);
		setConnection('connected');
		setVisibility('visible');
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
	});

	it('关闭抑制同一轮断线，后台切换不重置，恢复后的新一轮可以展示', /** 关闭标记只归属连续断线轮次，不复制连接事实。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(3000);
		controller.dismiss();
		setVisibility('hidden');
		setVisibility('visible');
		setConnection('reconnecting');
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
		setConnection('connected');
		setConnection('reconnecting');
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(true);
	});

	it('重复断线或前台事件不会无限推迟既有宽限', /** 当前前台等待只会创建一个有效计时任务。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(2500);
		setConnection('reconnecting');
		setVisibility('visible');
		vi.advanceTimersByTime(500);
		expect(controller.visible.value).toBe(true);
	});

	it('计时回调重读连接事实，缺失恢复事件也不能错误弹出提示', /** SDK 当前 state 优先于之前收到的断线事件。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		stream.state = 'connected';
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('展示偏好和实时门控动态释放监听，重新启用读取当前状态', /** quiet 以外的行为保留给原启动层，不新增共享连接消费者。 */ (): void => {
		store.s.realtimeMode = false;
		const controller: TwitterStreamNoticeController = startNotice();
		expect(useStream).not.toHaveBeenCalled();
		store.s.realtimeMode = true;
		expect(stream.listenerCount('_connected_')).toBe(1);
		setConnection('reconnecting');
		prefer.s.serverDisconnectedBehavior = 'dialog';
		expect(stream.listenerCount('_connected_')).toBe(0);
		expect(stream.listenerCount('_disconnected_')).toBe(0);
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
		prefer.s.serverDisconnectedBehavior = 'reload';
		expect(stream.listenerCount('_disconnected_')).toBe(0);
		prefer.s.serverDisconnectedBehavior = 'quiet';
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(true);
		store.s.realtimeMode = false;
		expect(controller.visible.value).toBe(false);
		expect(stream.listenerCount('_disconnected_')).toBe(0);
	});

	it('关闭观察后丢弃旧关闭标记，重新启用不能抑制期间产生的新断线', /** 停止订阅期间的恢复事实不可从旧 UI 标记反推。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(3000);
		controller.dismiss();
		prefer.s.serverDisconnectedBehavior = 'dialog';
		setConnection('connected');
		setConnection('reconnecting');
		prefer.s.serverDisconnectedBehavior = 'quiet';
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(true);
	});

	it('匿名入口不获取连接，登录后观察，退出后立即清理', /** 认证状态仅门控展示观察，不建立匿名额外连接。 */ (): void => {
		if (accountGate.state == null) throw new Error('missing account gate fixture');
		accountGate.state.value = null;
		const controller: TwitterStreamNoticeController = startNotice();
		expect(useStream).not.toHaveBeenCalled();
		accountGate.state.value = { id: 'account', token: 'token' };
		expect(stream.listenerCount('_disconnected_')).toBe(1);
		setConnection('reconnecting');
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(true);
		accountGate.state.value = null;
		expect(controller.visible.value).toBe(false);
		expect(stream.listenerCount('_disconnected_')).toBe(0);
	});

	it('账户边界释放旧租约并清除前一账户的关闭标记', /** 不将旧账户的临时 UI 选择传给另一账户。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(3000);
		controller.dismiss();
		if ($i == null) throw new Error('missing account gate fixture');
		$i.id = 'other';
		expect(stream.listenerCount('_disconnected_')).toBe(1);
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(true);
	});

	it('pagehide 收起提示，pageshow 只恢复展示观察', /** 缓存恢复不创建第二套连接或触发业务 API。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		vi.advanceTimersByTime(3000);
		window.dispatchEvent(new Event('pagehide'));
		expect(controller.visible.value).toBe(false);
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
		window.dispatchEvent(new Event('pageshow'));
		vi.advanceTimersByTime(3000);
		expect(controller.visible.value).toBe(true);
		expect(useStream).toHaveBeenCalledTimes(1);
	});

	it('dispose 幂等清理计时器、连接监听和响应式观察', /** Shell 卸载后任何旧事件或偏好变化均不能重新激活提示。 */ (): void => {
		const controller: TwitterStreamNoticeController = startNotice();
		setConnection('reconnecting');
		controller.dispose();
		controller.dispose();
		expect(stream.listenerCount('_connected_')).toBe(0);
		expect(stream.listenerCount('_disconnected_')).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		store.s.realtimeMode = false;
		store.s.realtimeMode = true;
		prefer.s.serverDisconnectedBehavior = 'dialog';
		prefer.s.serverDisconnectedBehavior = 'quiet';
		setVisibility('hidden');
		setVisibility('visible');
		window.dispatchEvent(new Event('pageshow'));
		setConnection('connected');
		setConnection('reconnecting');
		controller.dismiss();
		vi.advanceTimersByTime(6000);
		expect(controller.visible.value).toBe(false);
		expect(useStream).toHaveBeenCalledTimes(1);
	});
});
