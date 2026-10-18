/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 帖子统计只读展示类型。
 * 作用：从 misskey-js 唯一 Note 类型派生，不定义第二份业务实体或权限规则。
 */
import type * as Misskey from 'misskey-js';

/** 服务端帖子统计的只读投影，仅供渲染，禁止传回业务动作。 */
export type TwitterNoteCounters = Readonly<Pick<Misskey.entities.Note, 'id' | 'repliesCount' | 'renoteCount'>>;
