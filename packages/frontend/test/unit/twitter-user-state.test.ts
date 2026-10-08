/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter UI · domain 层用户取数终态派生的单元测试
 *
 * 作用：证明 twitterUserErrorStateType 的错误码单向映射规则
 * （用户不存在 → notFound，其余 → error），锁定唯一权威派生的行为。
 *
 * 数据链角色：users/show 错误样本 → twitterUserErrorStateType（被测函数）
 * → 终态类型断言（呈现层不参与判定）。
 */

import { describe, expect, test } from 'vitest';
import { twitterUserErrorStateType } from '@/ui/twitter/index.js';

describe('twitterUserErrorStateType', () => {
	/** 用户不存在错误样本：misskey API 错误 id 权威值。 */
	const noSuchUserError: { id: string } = { id: '4362f8dc-731f-4ad8-a694-be5a88922a24' };

	/** 用户不存在（404 语义）应派生为不可重试的 notFound 终态。 */
	test('maps no-such-user error to notFound', () => {
		expect(twitterUserErrorStateType(noSuchUserError)).toBe('notFound');
	});

	/** 其他 API 错误应派生为可重试的 error 终态。 */
	test('maps other api errors to error', () => {
		expect(twitterUserErrorStateType({ id: 'other-error-id' })).toBe('error');
	});

	/** 空值与异常形态应保守派生为可重试 error，而非崩溃。 */
	test('maps null or malformed errors to error', () => {
		expect(twitterUserErrorStateType(null)).toBe('error');
		expect(twitterUserErrorStateType(undefined)).toBe('error');
		expect(twitterUserErrorStateType('invalid')).toBe('error');
	});
});
