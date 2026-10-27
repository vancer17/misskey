/**
 * 文件领域：Misskey SDK 实时流。
 * 作用：管理频道池、消息分发与断线重连；可由外部认证边界供应每次连接地址。
 * 数据链：调用方频道订阅 → WebSocket → 原 Misskey 流事件，不解释外部认证票据。
 */
import { EventEmitter } from 'eventemitter3';
import _ReconnectingWebSocket from 'reconnecting-websocket';
import type { Options, UrlProvider } from 'reconnecting-websocket';
import type { BroadcastEvents, Channels } from './streaming.types.js';

// コンストラクタとクラスそのものの定義が上手く解決出来ないため再定義
const ReconnectingWebSocketConstructor = _ReconnectingWebSocket as unknown as typeof _ReconnectingWebSocket.default;
type ReconnectingWebSocket = _ReconnectingWebSocket.default;

export function urlQuery(obj: Record<string, string | number | boolean | undefined>): string {
	const params = Object.entries(obj)
		.filter(([, v]) => Array.isArray(v) ? v.length : v !== undefined)
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		.reduce((a, [k, v]) => (a[k] = v!, a), {} as Record<string, string | number | boolean>);

	return Object.entries(params)
		.map((e) => `${e[0]}=${encodeURIComponent(e[1])}`)
		.join('&');
}

type AnyOf<T extends Record<PropertyKey, unknown>> = T[keyof T];

export type StreamEvents = {
	_connected_: void;
	_disconnected_: void;
} & BroadcastEvents;

export interface IStream extends EventEmitter<StreamEvents> {
	state: 'initializing' | 'reconnecting' | 'connected';

	useChannel<C extends keyof Channels>(channel: C, params?: Channels[C]['params'], name?: string): IChannelConnection<Channels[C]>;
	removeSharedConnection(connection: SharedConnection): void;
	removeSharedConnectionPool(pool: Pool): void;
	disconnectToChannel(connection: NonSharedConnection): void;
	send(typeOrPayload: string): void;
	send(typeOrPayload: string, payload: unknown): void;
	send(typeOrPayload: Record<string, unknown> | unknown[]): void;
	send(typeOrPayload: string | Record<string, unknown> | unknown[], payload?: unknown): void;
	ping(): void;
	heartbeat(): void;
	close(): void;
}

/**
 * Misskey stream connection
 */
// eslint-disable-next-line import/no-default-export
export default class Stream extends EventEmitter<StreamEvents> implements IStream {
	private stream: ReconnectingWebSocket;
	public state: 'initializing' | 'reconnecting' | 'connected' = 'initializing';
	private sharedConnectionPools: Pool[] = [];
	private sharedConnections: SharedConnection[] = [];
	private nonSharedConnections: NonSharedConnection[] = [];
	private idCounter = 0;
	private readonly urlProviderLifetime: AbortController = new AbortController();

	/** 建立原站默认连接或调用方供应的连接地址，重连和频道行为保持一致。 */
	constructor(origin: string, user: { token: string; } | null, options?: {
		WebSocket?: Options['WebSocket'];
		binaryType?: ReconnectingWebSocket['binaryType'];
		/** 每次连接及重连重新解析地址，供外部认证适配器领取一次性连接票据。 */
		urlProvider?: UrlProvider;
	}) {
		super();

		this.genId = this.genId.bind(this);
		this.useChannel = this.useChannel.bind(this);
		this.useSharedConnection = this.useSharedConnection.bind(this);
		this.removeSharedConnection = this.removeSharedConnection.bind(this);
		this.removeSharedConnectionPool = this.removeSharedConnectionPool.bind(this);
		this.connectToChannel = this.connectToChannel.bind(this);
		this.disconnectToChannel = this.disconnectToChannel.bind(this);
		this.onOpen = this.onOpen.bind(this);
		this.onClose = this.onClose.bind(this);
		this.onMessage = this.onMessage.bind(this);
		this.send = this.send.bind(this);
		this.close = this.close.bind(this);

		// eslint-disable-next-line no-param-reassign
		options = options ?? { };

		const query: string = urlQuery({
			i: user?.token,

			// To prevent cache of an HTML such as error screen
			_t: Date.now(),
		});

		const wsOrigin: string = origin.replace('http://', 'ws://').replace('https://', 'wss://');

		const provider: UrlProvider | undefined = options.urlProvider;
		const connectionUrl: UrlProvider = provider === undefined ? `${wsOrigin}/streaming?${query}` :
			/** 外部票据解析失败必须由 SDK 捕获，避免依赖库锁住连接且产生未处理拒绝。 */ (): Promise<string> => this.resolveConnectionUrl(provider);
		this.stream = new ReconnectingWebSocketConstructor(connectionUrl, '', {
			minReconnectionDelay: 1, // https://github.com/pladaria/reconnecting-websocket/issues/91
			WebSocket: options.WebSocket,
		});
		if (options.binaryType) {
			this.stream.binaryType = options.binaryType;
		}
		this.stream.addEventListener('open', this.onOpen);
		this.stream.addEventListener('close', this.onClose);
		this.stream.addEventListener('message', this.onMessage);
	}

	/**
	 * 只为可选外部地址供应器收敛失败及关闭，不复制频道或 WebSocket 重连协议。
	 * 适配 reconnecting-websocket 4.4.0 未捕获 URL Promise 拒绝的真实行为；
	 * 依赖原生正确支持可取消供应器及失败恢复后，应重新评估并移除此局部路径。
	 */
	private resolveConnectionUrl(provider: UrlProvider): Promise<string> {
		return new Promise<string>(/** 供应器重试与关闭共享唯一结算句柄。 */ (resolve: (url: string) => void): void => {
			let retryTimer: ReturnType<typeof setTimeout> | null = null;
			let retryDelay: number = 1000;
			let settled: boolean = false;
			const signal: AbortSignal = this.urlProviderLifetime.signal;

			/** 清理重试与监听，任何迟到票据都不能再次开启连接。 */
			function finish(url: string): void {
				if (settled) return;
				settled = true;
				if (retryTimer !== null) clearTimeout(retryTimer);
				signal.removeEventListener('abort', closed);
				resolve(url);
			}

			/** 底层 close 已先设置关闭标记，空终值仅释放 Promise，不会创建无票据连接。 */
			function closed(): void { finish(''); }

			/** 每轮重新取得一次性票据，临时故障只退避重试该解析操作。 */
			async function attempt(): Promise<void> {
				if (signal.aborted) { closed(); return; }
				try {
					const url: string = typeof provider === 'string' ? provider : await provider();
					if (signal.aborted) { closed(); return; }
					const address: URL = new URL(url);
					if (address.protocol !== 'wss:' && address.protocol !== 'ws:') throw new Error('Invalid stream URL protocol');
					finish(url);
				} catch (_error: unknown) {
					if (signal.aborted) { closed(); return; }
					retryTimer = setTimeout(/** 失败后重新调用供应器，不复用旧票据或回退匿名地址。 */ (): void => { void attempt(); }, retryDelay);
					retryDelay = Math.min(retryDelay * 2, 10000);
				}
			}

			if (signal.aborted) { closed(); return; }
			signal.addEventListener('abort', closed, { once: true });
			void attempt();
		});
	}

	private genId(): string {
		return (++this.idCounter).toString();
	}

	public useChannel<C extends keyof Channels>(channel: C, params?: Channels[C]['params'], name?: string): Connection<Channels[C]> {
		if (params) {
			return this.connectToChannel(channel, params);
		} else {
			return this.useSharedConnection(channel, name);
		}
	}

	private useSharedConnection<C extends keyof Channels>(channel: C, name?: string): SharedConnection<Channels[C]> {
		let pool = this.sharedConnectionPools.find(p => p.channel === channel);

		if (pool == null) {
			pool = new Pool(this, channel, this.genId());
			this.sharedConnectionPools.push(pool);
		}

		const connection = new SharedConnection<Channels[C]>(this, channel, pool, name);
		this.sharedConnections.push(connection as unknown as SharedConnection);
		return connection;
	}

	public removeSharedConnection(connection: SharedConnection): void {
		this.sharedConnections = this.sharedConnections.filter(c => c !== connection);
	}

	public removeSharedConnectionPool(pool: Pool): void {
		this.sharedConnectionPools = this.sharedConnectionPools.filter(p => p !== pool);
	}

	private connectToChannel<C extends keyof Channels>(channel: C, params: Channels[C]['params']): NonSharedConnection<Channels[C]> {
		const connection = new NonSharedConnection(this, channel, this.genId(), params);
		this.nonSharedConnections.push(connection as unknown as NonSharedConnection);
		return connection;
	}

	public disconnectToChannel(connection: NonSharedConnection): void {
		this.nonSharedConnections = this.nonSharedConnections.filter(c => c !== connection);
	}

	/**
	 * Callback of when open connection
	 */
	private onOpen(): void {
		const isReconnect = this.state === 'reconnecting';

		this.state = 'connected';
		this.emit('_connected_');

		// チャンネル再接続
		if (isReconnect) {
			for (const p of this.sharedConnectionPools) p.connect();
			for (const c of this.nonSharedConnections) c.connect();
		}
	}

	/**
	 * Callback of when close connection
	 */
	private onClose(): void {
		if (this.state === 'connected') {
			this.state = 'reconnecting';
			this.emit('_disconnected_');
		}
	}

	/**
	 * Callback of when received a message from connection
	 */
	private onMessage(message: { data: string; }): void {
		const { type, body } = JSON.parse(message.data);

		if (type === 'channel') {
			const id = body.id;

			let connections: Connection[];

			connections = this.sharedConnections.filter(c => c.id === id);

			if (connections.length === 0) {
				const found = this.nonSharedConnections.find(c => c.id === id);
				if (found) {
					connections = [found];
				}
			}

			for (const c of connections) {
				c.emit(body.type, body.body);
				c.inCount++;
			}
		} else {
			this.emit(type, body);
		}
	}

	/**
	 * Send a message to connection
	 * ! ストリーム上のやり取りはすべてJSONで行われます !
	 */
	public send(typeOrPayload: string): void;
	public send(typeOrPayload: string, payload: unknown): void;
	public send(typeOrPayload: Record<string, unknown> | unknown[]): void;
	public send(typeOrPayload: string | Record<string, unknown> | unknown[], payload?: unknown): void {
		if (typeof typeOrPayload === 'string') {
			this.stream.send(JSON.stringify({
				type: typeOrPayload,
				...(payload === undefined ? {} : { body: payload }),
			}));
			return;
		}

		this.stream.send(JSON.stringify(typeOrPayload));
	}

	public ping(): void {
		this.stream.send('ping');
	}

	public heartbeat(): void {
		this.stream.send('h');
	}

	/**
	 * 关闭底层连接并同步释放可选地址解析器；关闭后迟到票据不能建立新连接。
	 */
	public close(): void {
		this.stream.close();
		this.urlProviderLifetime.abort();
	}
}

// TODO: これらのクラスを Stream クラスの内部クラスにすれば余計なメンバをpublicにしないで済むかも？
// もしくは @internal を使う？ https://www.typescriptlang.org/tsconfig#stripInternal
class Pool {
	public channel: string;
	public id: string;
	protected stream: Stream;
	public users = 0;
	private disposeTimerId: ReturnType<typeof setTimeout> | null = null;
	private isConnected = false;

	constructor(stream: Stream, channel: string, id: string) {
		this.onStreamDisconnected = this.onStreamDisconnected.bind(this);
		this.inc = this.inc.bind(this);
		this.dec = this.dec.bind(this);
		this.connect = this.connect.bind(this);
		this.disconnect = this.disconnect.bind(this);

		this.channel = channel;
		this.stream = stream;
		this.id = id;

		this.stream.on('_disconnected_', this.onStreamDisconnected);
	}

	private onStreamDisconnected(): void {
		this.isConnected = false;
	}

	public inc(): void {
		if (this.users === 0 && !this.isConnected) {
			this.connect();
		}

		this.users++;

		// タイマー解除
		if (this.disposeTimerId) {
			clearTimeout(this.disposeTimerId);
			this.disposeTimerId = null;
		}
	}

	public dec(): void {
		this.users--;

		// そのコネクションの利用者が誰もいなくなったら
		if (this.users === 0) {
			// また直ぐに再利用される可能性があるので、一定時間待ち、
			// 新たな利用者が現れなければコネクションを切断する
			this.disposeTimerId = setTimeout(() => {
				this.disconnect();
			}, 3000);
		}
	}

	public connect(): void {
		if (this.isConnected) return;
		this.isConnected = true;
		this.stream.send('connect', {
			channel: this.channel,
			id: this.id,
		});
	}

	private disconnect(): void {
		this.stream.off('_disconnected_', this.onStreamDisconnected);
		this.stream.send('disconnect', { id: this.id });
		this.stream.removeSharedConnectionPool(this);
	}
}

export interface IChannelConnection<Channel extends AnyOf<Channels> = AnyOf<Channels>> extends EventEmitter<Channel['events']> {
	id: string;
	name?: string;
	inCount: number;
	outCount: number;
	channel: string;

	send<T extends keyof Channel['receives']>(type: T, body: Channel['receives'][T]): void;
	dispose(): void;
}

export abstract class Connection<Channel extends AnyOf<Channels> = AnyOf<Channels>> extends EventEmitter<Channel['events']> implements IChannelConnection<Channel> {
	public channel: string;
	protected stream: Stream;
	public abstract id: string;

	public name?: string; // for debug
	public inCount = 0; // for debug
	public outCount = 0; // for debug

	constructor(stream: Stream, channel: string, name?: string) {
		super();

		this.send = this.send.bind(this);

		this.stream = stream;
		this.channel = channel;
		if (name !== undefined) {
			this.name = name;
		}
	}

	public send<T extends keyof Channel['receives']>(type: T, body: Channel['receives'][T]): void {
		this.stream.send('ch', {
			id: this.id,
			type: type,
			body: body,
		});

		this.outCount++;
	}

	public abstract dispose(): void;
}

class SharedConnection<Channel extends AnyOf<Channels> = AnyOf<Channels>> extends Connection<Channel> {
	private pool: Pool;

	public get id(): string {
		return this.pool.id;
	}

	constructor(stream: Stream, channel: string, pool: Pool, name?: string) {
		super(stream, channel, name);

		this.dispose = this.dispose.bind(this);

		this.pool = pool;
		this.pool.inc();
	}

	public dispose(): void {
		this.pool.dec();
		this.removeAllListeners();
		this.stream.removeSharedConnection(this as unknown as SharedConnection);
	}
}

class NonSharedConnection<Channel extends AnyOf<Channels> = AnyOf<Channels>> extends Connection<Channel> {
	public id: string;
	protected params: Channel['params'];

	constructor(stream: Stream, channel: string, id: string, params: Channel['params']) {
		super(stream, channel);

		this.connect = this.connect.bind(this);
		this.dispose = this.dispose.bind(this);

		this.params = params;
		this.id = id;

		this.connect();
	}

	public connect(): void {
		this.stream.send('connect', {
			channel: this.channel,
			id: this.id,
			params: this.params,
		});
	}

	public dispose(): void {
		this.removeAllListeners();
		this.stream.send('disconnect', { id: this.id });
		this.stream.disconnectToChannel(this as unknown as NonSharedConnection);
	}
}
