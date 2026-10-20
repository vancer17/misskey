/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：头像挂件的请求 Schema 映射测试。
 * 作用：仅证明边界序列化和缺省参数，不以模拟账户替代实际佩戴行为验收。
 * 业务许可、保存、并发与跨页面显示由 avatar-decoration.spec.ts 连接真实后端证明。
 */
import { describe, it, expect } from 'vitest';
import type * as Misskey from 'misskey-js';
import { serializeAvatarDecorations } from '@/utility/avatar-decoration/index.js';

/** 按既有请求 Schema 比较输出，不复制另一套领域类型定义。 */
describe('头像挂件请求序列化', (): void => {
	it('空佩戴集合保持为空', /** 清空请求不添加占位挂件。 */ (): void => { expect(serializeAvatarDecorations([])).toEqual([]); });
	it('移除展示字段并填充协议默认值', /** 不将图片 URL 或视图名称混入写入。 */ (): void => {
		const source: Misskey.entities.MeDetailed['avatarDecorations'] = [{ id: 'decoration', url: 'https://example.invalid/frame.png' }];
		expect(serializeAvatarDecorations(source)).toEqual([{ id: 'decoration', angle: 0, flipH: false, offsetX: 0, offsetY: 0 }]);
		expect(source).toEqual([{ id: 'decoration', url: 'https://example.invalid/frame.png' }]);
	});
	it('保留重复标识的顺序与独立参数且不修改输入', /** 索引对应实例，不将重复 ID 去重。 */ (): void => {
		const source: NonNullable<Misskey.Endpoints['i/update']['req']['avatarDecorations']> = [{ id: 'same', angle: 0.125, flipH: true, offsetX: -0.25, offsetY: 0.25 }, { id: 'same', angle: -0.5, flipH: false, offsetX: 0, offsetY: 0 }];
		const output: ReturnType<typeof serializeAvatarDecorations> = serializeAvatarDecorations(source);
		expect(output).toEqual(source);
		expect(output).not.toBe(source);
		expect(output[0]).not.toBe(source[0]);
	});
});
