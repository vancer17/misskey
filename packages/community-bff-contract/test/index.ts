/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区 BFF 纯协议测试工具的公开索引。
 * 作用：为工作区内适配器测试复用Schema派生夹具；不属于生产协议包出口。
 * 数据链：权威SDK Schema → 测试结构样本；不得用于业务启动或真实身份装配。
 */
export { createCommunityEntityProtocolFixture } from './entity-fixture.js';
