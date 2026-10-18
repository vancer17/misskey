/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 身份展示适配单元测试：只证明既有引用的选择与输入不变性。
 * 不模拟业务保存成功；真实头像保存与多轮交互由 twitter-profile.spec.ts 证明。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { computed, createApp, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { useTwitterDisplayUser } from '@/ui/twitter/composables/use-twitter-display-user.js';
import { DI } from '@/di.js';
import { $i } from '@/i.js';

vi.mock('@/i.js', /** 只提供适配器引用选择需要的用户字段，不用于证明领域行为。 */ async () => {
	const { reactive } = await import('vue');
	const user: Misskey.entities.UserLite = {
		id: 'self', username: 'self', host: null, name: 'Old', avatarUrl: '/old.png',
		avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'unknown',
	};
	return { $i: reactive(user) };
});

/** 输入样本使用现有权威类型，不另建字段镜像接口。 */
function sample(id: string): Misskey.entities.UserLite {
	return { id, username: id, host: null, name: 'Snapshot', avatarUrl: '/snapshot.png', avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'unknown' };
}

beforeEach(/** 每个引用映射场景从相同输入开始。 */ (): void => {
	if ($i != null) { $i.name = 'Old'; $i.avatarUrl = '/old.png'; }
});

describe('Twitter display-user reference adapter', /** 不访问网络、不更改业务模型。 */ (): void => {
	test('self identity follows existing account without modifying input', /** 本人展示引用与帖子快照保持分离。 */ (): void => {
		const source: Misskey.entities.UserLite = sample('self');
		const view: ComputedRef<Readonly<Misskey.entities.UserLite>> = createApp({}).runWithContext(
			/** 在真实 Vue 注入上下文中构建适配。 */ (): ComputedRef<Readonly<Misskey.entities.UserLite>> => useTwitterDisplayUser(source),
		);
		expect(view.value).toBe($i);
		if ($i != null) { $i.name = 'New'; $i.avatarUrl = '/new.png'; }
		expect(view.value.name).toBe('New');
		expect(view.value.avatarUrl).toBe('/new.png');
		expect(source).toEqual(sample('self'));
	});
	test('other author is not replaced by current account', /** 转发/引用作者始终按实际 ID 选择。 */ (): void => {
		const source: Ref<Misskey.entities.UserLite> = ref(sample('other'));
		const view: ComputedRef<Readonly<Misskey.entities.UserLite>> = createApp({}).runWithContext(
			/** 直接消费调用方用户引用。 */ (): ComputedRef<Readonly<Misskey.entities.UserLite>> => useTwitterDisplayUser(source),
		);
		expect(view.value).toBe(source.value);
		source.value = sample('third');
		expect(view.value.id).toBe('third');
	});
	test('explicit and inherited mock inputs remain isolated', /** 保持既有样本展示，不把样本变为账户事实。 */ (): void => {
		const source: Misskey.entities.UserLite = sample('self');
		const explicit: ComputedRef<Readonly<Misskey.entities.UserLite>> = createApp({}).runWithContext(
			/** 显式 mock 为原有样本协议。 */ (): ComputedRef<Readonly<Misskey.entities.UserLite>> => useTwitterDisplayUser(source, true),
		);
		const inherited: ComputedRef<Readonly<Misskey.entities.UserLite>> = createApp({}).provide(DI.mock, true).runWithContext(
			/** 引用卡等后代消费原有注入标记。 */ (): ComputedRef<Readonly<Misskey.entities.UserLite>> => useTwitterDisplayUser(source),
		);
		expect(explicit.value).toBe(source);
		expect(inherited.value).toBe(source);
	});
	test('null input stays null and getter updates follow source', /** 不创建用于填补缺失状态的伪用户。 */ (): void => {
		const source: Ref<Misskey.entities.UserLite | null> = ref(null);
		const view: ComputedRef<Readonly<Misskey.entities.UserLite> | null> = createApp({}).runWithContext(
			/** getter 输入与 ref 输入具有相同映射契约。 */ (): ComputedRef<Readonly<Misskey.entities.UserLite> | null> => useTwitterDisplayUser(computed(
				/** 只读派生当前输入。 */ (): Misskey.entities.UserLite | null => source.value,
			)),
		);
		expect(view.value).toBeNull();
		source.value = sample('self');
		expect(view.value).toBe($i);
	});
});
