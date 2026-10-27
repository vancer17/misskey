/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * 文件领域：社区控制协议测试的Schema样本生成。
 * 作用：从同一SDK Schema派生结构样本，避免手写缺失必填字段的账户副本。
 * 数据链：现行OpenAPI → 纯协议夹具；样本不证明真实用户、会话或领域行为。
 */
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

/** 将Schema节点收窄为记录，仅用于可信仓库生成输入。 */
function record(input: unknown): Record<string, unknown> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('INVALID_SCHEMA_FIXTURE');
	return input as Record<string, unknown>;
}

/** 当前SDK OpenAPI输入；测试不维护另一套业务字段或枚举。 */
const upstream: Record<string, unknown> = record(JSON.parse(readFileSync(new NodeURL('../../misskey-js/generator/api.json', import.meta.url), 'utf8')) as unknown);
/** 从SDK输入直接取权威业务实体Schema。 */
const schemas: Record<string, unknown> = record(record(upstream.components).schemas);

/** 递归生成最小结构样本；只覆盖当前SDK Schema使用的通用节点。 */
function schemaValue(input: unknown, depth: number = 0): unknown {
	if (depth > 32) throw new Error('RECURSIVE_SCHEMA_FIXTURE');
	const schema: Record<string, unknown> = record(input);
	if (typeof schema.$ref === 'string') return schemaValue(schemas[schema.$ref.split('/').at(-1) ?? ''], depth + 1);
	if (Object.hasOwn(schema, 'const')) return schema.const;
	if (Array.isArray(schema.enum)) return schema.enum[0];
	if (Array.isArray(schema.allOf)) {
		const result: Record<string, unknown> = {};
		for (const child of schema.allOf) Object.assign(result, record(schemaValue(child, depth + 1)));
		return result;
	}
	const union: unknown = schema.oneOf ?? schema.anyOf;
	if (Array.isArray(union)) return schemaValue(union[0], depth + 1);
	const type: unknown = Array.isArray(schema.type) ? (schema.type.includes('null') ? 'null' : schema.type[0]) : schema.type;
	if (type === 'null') return null;
	if (type === 'boolean') return false;
	if (type === 'number' || type === 'integer') return typeof schema.minimum === 'number' ? schema.minimum : 0;
	if (type === 'string') return 'a'.repeat(typeof schema.minLength === 'number' ? Math.max(schema.minLength, 1) : 1);
	if (type === 'array') {
		const result: unknown[] = [];
		const count: number = typeof schema.minItems === 'number' ? schema.minItems : 0;
		for (let index: number = 0; index < count; index += 1) result.push(schemaValue(schema.items, depth + 1));
		return result;
	}
	if (type === 'object' || schema.properties !== undefined) {
		const result: Record<string, unknown> = {};
		const properties: Record<string, unknown> = schema.properties === undefined ? {} : record(schema.properties);
		if (Array.isArray(schema.required)) {
			for (const key of schema.required) {
				if (typeof key !== 'string') throw new Error('INVALID_SCHEMA_FIXTURE');
				result[key] = schemaValue(properties[key], depth + 1);
			}
		}
		return result;
	}
	return null;
}

/** 为指定权威实体生成独立协议夹具，不提供生产身份事实。 */
export function createCommunityEntityProtocolFixture(name: 'MeDetailed' | 'MetaDetailed'): Record<string, unknown> {
	return record(schemaValue(schemas[name]));
}
