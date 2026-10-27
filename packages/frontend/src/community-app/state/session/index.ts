/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：嵌入社区的账户与实例状态所有者。
 * 作用：把已经校验的 BFF 会话投影为原 Misskey 可消费的唯一响应式事实，不保存凭据或原始 DTO。
 * 数据链：Bootstrap 安装真实会话 → 账户／实例只读模型与不透明归属 → 原业务 Store Action。
 * 边界：不读取环境、浏览器账户缓存或认证材料；换身份必须重建文档，续期仅更新同一事实容器。
 */
import { reactive, readonly, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { entities } from 'misskey-js';
import type { CommunityBffSessionView } from 'community-bff-contract';
import { isCommunityCredentialField, parseCommunityBffAccount, parseCommunityBffInstance } from 'community-bff-contract';
import type { AccountRequestOwner } from '@/accounts/ownership/domain/index.js';

/** 当前可写账户只在本模块内保留，组件不得取得写入引用。 */
let account: entities.MeDetailed | null = null;
/** 当前实例事实只从经过校验的真实 BFF 响应安装。 */
let instance: entities.MetaDetailed | null = null;
/** 外部账户投影与内部事实共享同一容器，不建立业务副本。 */
let accountView: Readonly<entities.MeDetailed> | null = null;
/** 外部实例投影沿用同一事实容器。 */
let instanceView: Readonly<entities.MetaDetailed> | null = null;
/** 服务器会话标识只用于比较，不从其中解析账户或运行策略。 */
let sessionId: string | null = null;
/** 当前实例的唯一请求归属；凭据轮换不替换该身份。 */
const scope: ShallowRef<AccountRequestOwner | null> = shallowRef(null);

/** 在网络边界复制 JSON 实体，断开适配器原始对象与唯一可写状态之间的别名。 */
function copyEntity<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** 账户事实不能携带认证材料或危险元属性；控制字段只在适配器内部消费。 */
function assertEntityFields(value: object): void {
	for (const key of Object.keys(value)) {
		if (isCommunityCredentialField(key)) throw new Error('COMMUNITY_INVALID_ACCOUNT_FIELDS');
	}
}

/** 把合法会话装入同一账户事实容器；不同身份不能复用已有文档。 */
export function installCommunitySession(session: CommunityBffSessionView): void {
	assertEntityFields(session.me);
	assertEntityFields(session.meta);
	parseCommunityBffAccount(session.me);
	parseCommunityBffInstance(session.meta);
	if (session.me.id !== session.accountId) throw new Error('COMMUNITY_IDENTITY_CHANGED');
	if (instance !== null && instance.uri !== session.meta.uri) throw new Error('COMMUNITY_INSTANCE_CHANGED');
	if (scope.value !== null && (scope.value.accountId !== session.accountId || sessionId !== session.sessionId)) throw new Error('COMMUNITY_REALM_REBUILD_REQUIRED');
	if (account === null || instance === null) {
		account = reactive(copyEntity(session.me));
		instance = reactive(copyEntity(session.meta));
		accountView = readonly(account) as Readonly<entities.MeDetailed>;
		instanceView = readonly(instance) as Readonly<entities.MetaDetailed>;
		sessionId = session.sessionId;
		const identity: object = Object.freeze({
			/** 不透明归属不能被序列化成路由或持久化业务状态。 */
			toJSON(): never { throw new Error('ACCOUNT_IDENTITY_NOT_SERIALIZABLE'); },
		});
		scope.value = Object.freeze({ accountId: session.accountId, identity });
		return;
	}
	updateCommunityAccount(session.me);
	updateCommunityInstance(session.meta);
}

/** 返回经过验证的账户只读模型，不交付 BFF DTO 或访问凭据。 */
export function getCommunityAccount(): Readonly<entities.MeDetailed> | null {
	return accountView;
}

/** 返回当前实例事实；部署地址和运行探测不在此解释。 */
export function getCommunityInstance(): Readonly<entities.MetaDetailed> | null {
	return instanceView;
}

/** 供账户归属适配器捕获不透明身份；失效后旧请求立即无法提交。 */
export function getCommunitySessionScope(): AccountRequestOwner | null {
	return scope.value;
}

/** 只接受同账户的服务器确认结果，不允许以账户更新实现身份切换。 */
export function updateCommunityAccount(value: entities.MeDetailed): void {
	if (account === null || scope.value === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	if (value.id !== scope.value.accountId) throw new Error('COMMUNITY_IDENTITY_CHANGED');
	assertEntityFields(value);
	parseCommunityBffAccount(value);
	for (const key of Object.keys(account)) if (!Object.hasOwn(value, key)) Reflect.deleteProperty(account, key);
	Object.assign(account, copyEntity(value));
}

/** 同一实例元数据的服务器确认更新，完整快照移除已不存在的可选字段。 */
export function updateCommunityInstance(value: entities.MetaDetailed): void {
	if (instance === null || scope.value === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	assertEntityFields(value);
	parseCommunityBffInstance(value);
	if (value.uri !== instance.uri) throw new Error('COMMUNITY_INSTANCE_CHANGED');
	for (const key of Object.keys(instance)) if (!Object.hasOwn(value, key)) Reflect.deleteProperty(instance, key);
	Object.assign(instance, copyEntity(value));
}

/** 既有领域动作在服务器确认后更新同一账户投影，不持久化凭据或建立未读数量副本。 */
export function updateCommunityAccountPartial(value: Partial<entities.MeDetailed>): void {
	if (account === null || scope.value === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	if (value.id !== undefined && value.id !== scope.value.accountId) throw new Error('COMMUNITY_IDENTITY_CHANGED');
	assertEntityFields(value);
	parseCommunityBffAccount({ ...account, ...copyEntity(value) });
	Object.assign(account, copyEntity(value));
}

/** 沿用帖子创建成功后的本地展示动作，写入仍由唯一账户状态所有者完成。 */
export function incrementCommunityNotesCount(): void {
	if (account === null || scope.value === null) throw new Error('COMMUNITY_SESSION_REQUIRED');
	account.notesCount++;
}

/** 同步撤销归属并移除模块持有的事实；既有模块单例由宿主销毁整个子文档释放。 */
export function invalidateCommunitySession(): void {
	scope.value = null;
	sessionId = null;
	accountView = null;
	instanceView = null;
	account = null;
	instance = null;
}
