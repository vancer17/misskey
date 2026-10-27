/**
 * 文件领域：SDK 流地址供应器协议验证。
 * 作用：验证首次连接与重连均调用公开供应器，不改变频道消息格式。
 * 数据链：异步 URL 供应器 → 真实重连客户端 → 受控 WebSocket 服务；不证明后端业务认证。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';
import Stream from '../src/streaming.js';

describe('stream URL provider', /** 只验证连接 URL 解析与频道复用协议。 */ (): void => {
	afterEach(/** 释放受控服务，避免连接泄漏到其他用例。 */ (): void => { WS.clean(); });
	it('resolves an asynchronous URL for every connection attempt', /** 每次重连使用新票据，原凭据不被附加到供应器 URL。 */ async (): Promise<void> => {
		const first: WS = new WS('wss://bff.test/first?ticket=first');
		const second: WS = new WS('wss://bff.test/second?ticket=second');
		let calls: number = 0;
		const stream: Stream = new Stream('https://misskey.test', { token: 'must-not-appear' }, {
			urlProvider: /** 为每个独立连接生成不同地址。 */ async (): Promise<string> => `wss://bff.test/${++calls === 1 ? 'first' : 'second'}?ticket=${calls}`,
		});
		try {
			stream.useChannel('main');
			const connection: Awaited<typeof first.connected> = await first.connected;
			expect(new URL(connection.url).searchParams.has('i')).toBe(false);
			expect(JSON.parse(await first.nextMessage as string)).toMatchObject({ type: 'connect', body: { channel: 'main' } });
			first.close();
			await second.connected;
			expect(calls).toBe(2);
			expect(JSON.parse(await second.nextMessage as string)).toMatchObject({ type: 'connect', body: { channel: 'main' } });
		} finally { stream.close(); }
	});

	it.each(['throw', 'reject'] as const)('recovers from an initial provider %s', /** 供应器同步抛错或异步拒绝不锁死依赖库连接循环。 */ async (failure: 'throw' | 'reject'): Promise<void> => {
		const server: WS = new WS('wss://bff.test/recovered');
		let calls: number = 0;
		const stream: Stream = new Stream('https://misskey.test', null, {
			urlProvider: /** 每个失败重试都重新取得地址，不使用匿名回退。 */ (): string | Promise<string> => {
				calls++;
				if (calls > 1) return 'wss://bff.test/recovered?ticket=fresh';
				if (failure === 'throw') throw new Error('Temporary ticket failure');
				return Promise.reject(new Error('Temporary ticket failure'));
			},
		});
		try {
			await server.connected;
			expect(calls).toBe(2);
			expect(stream.state).toBe('connected');
		} finally { stream.close(); }
	});

	it('recovers when the next ticket fails during reconnection', /** 已建立的频道在票据临时失败后仍由原频道池重新订阅。 */ async (): Promise<void> => {
		const first: WS = new WS('wss://bff.test/before-failure');
		const second: WS = new WS('wss://bff.test/after-failure');
		let calls: number = 0;
		const stream: Stream = new Stream('https://misskey.test', null, {
			urlProvider: /** 第二轮票据失败后，下一次重新申请并建立连接。 */ async (): Promise<string> => {
				calls++;
				if (calls === 2) throw new Error('Temporary ticket failure');
				return calls === 1 ? 'wss://bff.test/before-failure?ticket=first' : 'wss://bff.test/after-failure?ticket=fresh';
			},
		});
		try {
			stream.useChannel('main');
			await first.connected;
			await first.nextMessage;
			first.close();
			await second.connected;
			expect(calls).toBe(3);
			expect(JSON.parse(await second.nextMessage as string)).toMatchObject({ type: 'connect', body: { channel: 'main' } });
		} finally { stream.close(); }
	});

	it('closes a pending provider without opening any fallback socket', /** 关闭后迟到票据或拒绝均不会打开连接或遗留重试计时器。 */ async (): Promise<void> => {
		const server: WS = new WS('wss://bff.test/must-stay-closed');
		let rejectTicket: ((reason: Error) => void) | null = null;
		let calls: number = 0;
		const stream: Stream = new Stream('https://misskey.test', null, {
			urlProvider: /** 模拟关闭时仍在等待的外部授权请求。 */ (): Promise<string> => {
				calls++;
				return new Promise<string>(/** 暂存拒绝器以模拟关闭后的迟到失败。 */ (_resolve: (url: string) => void, reject: (reason: Error) => void): void => { rejectTicket = reject; });
			},
		});
		await vi.waitFor(/** 确认外部供应器已经被调用。 */ (): void => { expect(calls).toBe(1); });
		stream.close();
		if (rejectTicket == null) throw new Error('Missing ticket request');
		(rejectTicket as (reason: Error) => void)(new Error('Late ticket rejection'));
		await new Promise<void>(/** 允许已排队的库回调运行，确认关闭标记先于解析终值生效。 */ (resolve: () => void): void => { setTimeout(resolve, 20); });
		expect(server.server.clients()).toHaveLength(0);
		expect(calls).toBe(1);
	});
});
