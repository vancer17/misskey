/*
 * 开发语言资源协议测试：验证最终文件事件到 locale-update 消息的映射与监听生命周期。
 * EventEmitter 只替代 Vite 的监听器接口；真实文件发布和浏览器刷新由集成验证覆盖。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import meta from '../../../../package.json';
import pluginWatchLocales from '../../lib/vite-plugin-watch-locales.js';

/** 记录插件消费的监听器及 WebSocket 协议，不构造完整开发服务器。 */
type LocaleWatcherFixture = {
	events: EventEmitter;
	add: Mock<ViteDevServer['watcher']['add']>;
	send: Mock<ViteDevServer['ws']['send']>;
	server: ViteDevServer;
};

const plugins: Plugin[] = [];
const localesDir: string = path.resolve(__dirname, '../../../../built/_frontend_dist_/locales');
const zhPath: string = path.join(localesDir, `zh-CN.${meta.version}.json`);
const jaPath: string = path.join(localesDir, `ja-JP.${meta.version}.json`);

/** 使用真实事件注册行为提供 Vite 接口替身，记录外发参数而不启动服务。 */
function createFixture(): LocaleWatcherFixture {
	const events: EventEmitter = new EventEmitter();
	const add: LocaleWatcherFixture['add'] = vi.fn<ViteDevServer['watcher']['add']>();
	const send: LocaleWatcherFixture['send'] = vi.fn<ViteDevServer['ws']['send']>();
	const server: ViteDevServer = {
		// 仅补足插件消费的 add 方法，on/off 使用 Node 的真实事件注册实现。
		watcher: Object.assign(events, { add }),
		// 外发消息只记录现有 Vite 协议参数。
		ws: { send },
	} as unknown as ViteDevServer;
	return { events, add, send, server };
}

/** 通过公共 Vite 钩子安装插件，避免测试依赖插件内部回调名称。 */
async function configure(plugin: Plugin, fixture: LocaleWatcherFixture): Promise<void> {
	const hook: Plugin['configureServer'] = plugin.configureServer;
	if (typeof hook !== 'function') throw new Error('Expected a configureServer hook.');
	await hook.call({} as ThisParameterType<typeof hook>, fixture.server);
}

/** 调用 Vite 的插件关闭钩子释放监听，复用实际关闭协议。 */
async function close(plugin: Plugin): Promise<void> {
	const hook: Plugin['closeBundle'] = plugin.closeBundle;
	if (typeof hook !== 'function') throw new Error('Expected a closeBundle hook.');
	await hook.call({} as ThisParameterType<typeof hook>);
}

afterEach(/** 保证断言失败时也释放本用例安装的事件监听。 */ async (): Promise<void> => {
	await Promise.all(plugins.splice(0).map(/** 关闭已登记的插件实例。 */ (plugin: Plugin): Promise<void> => close(plugin)));
});

describe('generated locale watcher', /** 限定测试为文件事件与现有 HMR 消息之间的协议。 */ (): void => {
	it('watches current generated JSON and forwards the affected locale', /** 不从源 YAML 名称推算继承语言。 */ async (): Promise<void> => {
		const plugin: Plugin = pluginWatchLocales();
		plugins.push(plugin);
		const fixture: LocaleWatcherFixture = createFixture();
		await configure(plugin, fixture);

		expect(fixture.add).toHaveBeenCalledWith(expect.arrayContaining([zhPath, jaPath]));
		fixture.events.emit('change', zhPath);
		expect(fixture.send).toHaveBeenCalledExactlyOnceWith({ type: 'custom', event: 'locale-update', data: 'zh-CN' });
	});

	it('accepts an atomic add and ignores sources, temporary files and other versions', /** 只有完整最终路径能触发刷新通知。 */ async (): Promise<void> => {
		const plugin: Plugin = pluginWatchLocales();
		plugins.push(plugin);
		const fixture: LocaleWatcherFixture = createFixture();
		await configure(plugin, fixture);

		fixture.events.emit('change', path.resolve(localesDir, '../../../locales/ja-JP.yml'));
		fixture.events.emit('change', `${zhPath}.tmp`);
		fixture.events.emit('add', path.join(localesDir, 'zh-CN.previous-version.json'));
		fixture.events.emit('unlink', zhPath);
		expect(fixture.send).not.toHaveBeenCalled();

		fixture.events.emit('add', zhPath);
		expect(fixture.send).toHaveBeenCalledExactlyOnceWith({ type: 'custom', event: 'locale-update', data: 'zh-CN' });
	});

	it('detaches its callbacks during reconfiguration and close', /** 重配不重复发消息，关闭不影响共享监听器的其他消费者。 */ async (): Promise<void> => {
		const plugin: Plugin = pluginWatchLocales();
		plugins.push(plugin);
		const first: LocaleWatcherFixture = createFixture();
		const second: LocaleWatcherFixture = createFixture();
		const otherListener: Mock<(filePath: string) => void> = vi.fn<(filePath: string) => void>();
		second.events.on('change', otherListener);

		await configure(plugin, first);
		await configure(plugin, first);
		first.events.emit('change', zhPath);
		expect(first.send).toHaveBeenCalledTimes(1);

		await configure(plugin, second);
		first.events.emit('change', zhPath);
		expect(first.send).toHaveBeenCalledTimes(1);
		second.events.emit('change', zhPath);
		expect(second.send).toHaveBeenCalledTimes(1);

		await close(plugin);
		second.events.emit('change', zhPath);
		expect(second.send).toHaveBeenCalledTimes(1);
		expect(otherListener).toHaveBeenCalledTimes(2);
	});
});
