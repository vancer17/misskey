/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 身份展示适配：从既有账户单例或调用方用户模型派生只读展示引用。
 * 不保存用户副本、不请求 API、不改写帖子作者；Mock 上下文保持样本输入。
 */
import { computed, inject, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import type * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';

/** 非空用户输入保留非空展示契约，供头像和帖子身份组件消费。 */
export function useTwitterDisplayUser(
	source: MaybeRefOrGetter<Misskey.entities.UserLite>,
	mock?: MaybeRefOrGetter<boolean>,
): ComputedRef<Readonly<Misskey.entities.UserLite>>;
/** 尚未加载或不存在的用户保持空值，不创造占位业务实体。 */
export function useTwitterDisplayUser(
	source: MaybeRefOrGetter<Misskey.entities.UserLite | null>,
	mock?: MaybeRefOrGetter<boolean>,
): ComputedRef<Readonly<Misskey.entities.UserLite> | null>;
/** 以真实作者 ID 选择展示来源；只读投影不得传回帖子动作或权限判断。 */
export function useTwitterDisplayUser(
	source: MaybeRefOrGetter<Misskey.entities.UserLite | null>,
	mock: MaybeRefOrGetter<boolean> = false,
): ComputedRef<Readonly<Misskey.entities.UserLite> | null> {
	const inheritedMock: boolean = inject(DI.mock, false);
	return computed(
		/** 当前账户更新自然传播到所有本人身份展示，其他作者保持输入模型。 */
		(): Readonly<Misskey.entities.UserLite> | null => {
			const user: Misskey.entities.UserLite | null = toValue(source);
			if (!inheritedMock && !toValue(mock) && user != null && $i?.id === user.id) return $i;
			return user;
		},
	);
}
