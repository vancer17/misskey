<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI 私信 · 群聊管理展示。
作用：读取 Store 的群信息、成员与邀请；名称编辑仅保存临时表单，确认后交由 Store 写入。
数据链：权威群模型 → 管理表单／成员展示 → Store 命令，不直接请求聊天接口。
-->

<template>
<section :class="$style.details" :aria-label="i18n.ts._twitterMessages.roomDetails">
	<div :class="$style.heading">
		<h2>{{ i18n.ts._twitterMessages.roomDetails }}</h2>
		<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts.close" @click="emit('close')"><i class="ti ti-x" aria-hidden="true"></i></button>
	</div>
	<p v-if="state.roomStatus === 'loading'" role="status">{{ i18n.ts.loading }}</p>
	<div v-if="state.roomError" role="alert" :class="$style.error">{{ i18n.ts._twitterMessages.operationFailed }} <button type="button" class="_textButton" @click="reload">{{ i18n.ts._twitterMessages.retry }}</button></div>
	<form :class="$style.form" @submit.prevent="save">
		<label>{{ i18n.ts._twitterMessages.roomName }}<input v-model="name" :class="$style.input" :disabled="!isOwner || busy" maxlength="100" required></label>
		<label>{{ i18n.ts._twitterMessages.roomDescription }}<textarea v-model="description" :class="$style.input" :disabled="!isOwner || busy" rows="3" maxlength="2048"></textarea></label>
		<button v-if="isOwner" type="submit" class="_button" :class="$style.primary" :disabled="busy || name.trim().length === 0">{{ i18n.ts.save }}</button>
	</form>
	<div :class="$style.actions">
		<button v-if="isOwner" type="button" class="_button" :class="$style.outline" :disabled="busy" @click="inviteUser"><i class="ti ti-user-plus" aria-hidden="true"></i> {{ i18n.ts._chat.inviteUser }}</button>
		<button v-if="!isOwner && canRead" type="button" class="_button" :class="$style.outline" :disabled="busy" @click="toggleMuted"><i class="ti ti-bell-off" aria-hidden="true"></i> {{ room.isMuted ? i18n.ts._twitterMessages.unmuteRoom : i18n.ts._twitterMessages.muteRoom }}</button>
		<button v-if="!canRead && room.invitationExists" type="button" class="_button" :class="$style.outline" :disabled="busy" @click="ignoreInvitation">{{ i18n.ts._twitterMessages.ignoreInvitation }}</button>
		<button v-if="!canRead && room.invitationExists" type="button" class="_button" :class="$style.primary" :disabled="busy" @click="join">{{ i18n.ts._twitterMessages.joinRoom }}</button>
		<button v-if="!isOwner && canRead" type="button" class="_button" :class="$style.danger" :disabled="busy" @click="leave">{{ i18n.ts._twitterMessages.leaveRoom }}</button>
		<button v-if="isOwner" type="button" class="_button" :class="$style.danger" :disabled="busy" @click="remove">{{ i18n.ts._chat.deleteRoom }}</button>
	</div>
	<h3>{{ i18n.ts._twitterMessages.members }}</h3>
	<div :class="$style.member"><MkAvatar :decorations="[]" :user="room.owner" :class="$style.avatar" :link="true"/><MkUserName :user="room.owner"/><i class="ti ti-crown" aria-hidden="true"></i></div>
	<div v-for="membership in state.members" :key="membership.id" :class="$style.member">
		<template v-if="membership.user"><MkAvatar :decorations="[]" :user="membership.user" :class="$style.avatar" :link="true"/><MkUserName :user="membership.user"/></template>
	</div>
	<p v-if="state.roomStatus === 'ready' && state.members.length === 0" :class="$style.secondary">{{ i18n.ts._twitterMessages.roomNoMembers }}</p>
	<template v-if="isOwner && state.sentInvitations.length > 0">
		<h3>{{ i18n.ts._twitterMessages.sentInvitations }}</h3>
		<div v-for="invitation in state.sentInvitations" :key="invitation.id" :class="$style.member"><MkAvatar :decorations="[]" :user="invitation.user" :class="$style.avatar"/><MkUserName :user="invitation.user"/></div>
	</template>
</section>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { chatStore } from '../index.js';
import type { ChatRoom } from '../index.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import * as os from '@/os.js';
import { useRouter } from '@/router.js';

/** 群详情消费 Store 确认的模型与读取能力。 */
type RoomDetailsProps = Readonly<{ room: ChatRoom; canRead: boolean }>;
/** 详情输入保持只读。 */
const props: RoomDetailsProps = defineProps<RoomDetailsProps>();
/** 关闭仅切换临时展示，不清除 Store 的群状态。 */
const emit: (event: 'close') => void = defineEmits<{ (event: 'close'): void }>();
/** 只读业务状态保持同一个所有者。 */
const state: typeof chatStore.state = chatStore.state;
/** 当前账户只用于拥有者操作入口展示。 */
const $i: Misskey.entities.MeDetailed = ensureSignin();
/** 路由返回只携带位置，不保存群实体。 */
const router: ReturnType<typeof useRouter> = useRouter();
/** 稳定身份派生仅影响管理入口展示，服务端仍负责授权。 */
const isOwner: ComputedRef<boolean> = computed(/** 对比已有群拥有者标识。 */ (): boolean => props.room.ownerId === $i.id);
/** 未提交的名称是临时表单状态。 */
const name: Ref<string> = ref<string>(props.room.name);
/** 未提交的说明是临时表单状态。 */
const description: Ref<string> = ref<string>(props.room.description);
/** 防止同一表单产生重复管理命令。 */
const busy: Ref<boolean> = ref<boolean>(false);
/** 弹窗等待期间确认原账户与原群仍然处于当前管理页。 */
const accountAtMount: string | null = state.accountId;
/** 销毁后不允许迟到的选择回执提交管理命令。 */
let alive: boolean = true;

/** 异步 UI 回执只有仍归属于原群时才生效。 */
function isCurrent(roomId: string): boolean { return alive && state.accountId === accountAtMount && state.active.room?.id === roomId; }

onBeforeUnmount(/** 关闭详情即撤销未完成 UI 交互的提交资格。 */ (): void => { alive = false; });

watch(/** 群切换时重建临时表单。 */ (): string => props.room.id, /** 表单只从新权威模型初始化。 */ (): void => { name.value = props.room.name; description.value = props.room.description; });

/** 管理查询统一交给 Store，错误由其 roomError 提供。 */
async function reload(): Promise<void> {
	try { await chatStore.loadMembers(); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); }
}

/** 保存临时表单，成功后展示更新后的权威群模型。 */
async function save(): Promise<void> {
	busy.value = true;
	try { await chatStore.updateRoom(props.room.id, name.value.trim(), description.value); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}

/** 选择本地用户后提交邀请，不由组件缓存邀请事实。 */
async function inviteUser(): Promise<void> {
	const roomId: string = props.room.id;
	let user: Misskey.entities.UserDetailed;
	try { user = await os.selectUser({ includeSelf: false, localOnly: true }); } catch { return; }
	if (!isCurrent(roomId)) return;
	busy.value = true;
	try { await chatStore.inviteUser(roomId, user.id); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}

/** 静音的确认值来自 Store，组件不保存乐观副本。 */
async function toggleMuted(): Promise<void> {
	busy.value = true;
	try { await chatStore.setRoomMuted(props.room.id, !props.room.isMuted); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}

/** 接受邀请交给服务端验证，随后刷新唯一会话。 */
async function join(): Promise<void> {
	busy.value = true;
	try { await chatStore.joinRoom(props.room.id); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}

/** 拒绝邀请只撤销本人的服务端邀请，成功后返回收件箱。 */
async function ignoreInvitation(): Promise<void> {
	busy.value = true;
	try { await chatStore.ignoreInvitation(props.room.id); router.push('/chat'); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}

/** 退出前明确确认，成功回到收件箱。 */
async function leave(): Promise<void> {
	const roomId: string = props.room.id;
	const result: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({ type: 'warning', text: i18n.ts._twitterMessages.leaveRoomConfirm });
	if (result.canceled || !isCurrent(roomId)) return;
	busy.value = true;
	try { await chatStore.leaveRoom(roomId); router.push('/chat'); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}

/** 群删除使用服务端所有权校验，并且只在确认后执行。 */
async function remove(): Promise<void> {
	const roomId: string = props.room.id;
	const result: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({ type: 'warning', text: i18n.ts._twitterMessages.deleteRoomConfirm });
	if (result.canceled || !isCurrent(roomId)) return;
	busy.value = true;
	try { await chatStore.removeRoom(roomId); router.push('/chat'); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); } finally { busy.value = false; }
}
</script>

<style lang="scss" module>
.details { padding: var(--twitter-space-4); overflow-y: auto; overscroll-behavior: contain; }
.heading { display: flex; align-items: center; justify-content: space-between; }
.heading h2 { font-size: var(--twitter-font-size-title); margin: 0; }
.iconButton { display: grid; place-items: center; width: var(--twitter-touch-target); height: var(--twitter-touch-target); border-radius: var(--twitter-radius-pill); }
.iconButton:hover { background: var(--twitter-hover); }
.form { display: flex; flex-direction: column; gap: var(--twitter-space-4); margin-block: var(--twitter-space-4); }
.form label { display: flex; flex-direction: column; gap: var(--twitter-space-2); color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-meta); }
.input { box-sizing: border-box; width: 100%; border: 1px solid var(--twitter-border); border-radius: var(--twitter-radius-medium); padding: var(--twitter-space-3); font: inherit; color: var(--twitter-fg); background: var(--twitter-panel); }
.input:focus-visible { outline: 2px solid var(--twitter-accent); outline-offset: 2px; }
.actions { display: flex; flex-wrap: wrap; gap: var(--twitter-space-2); }
.primary, .outline, .danger { min-height: var(--twitter-touch-target); padding: var(--twitter-space-2) var(--twitter-space-4); border-radius: var(--twitter-radius-pill); font-weight: 700; }
.primary { color: var(--twitter-fg-on-accent); background: var(--twitter-accent); }
.outline { border: 1px solid var(--twitter-border); }
.danger, .error { color: var(--twitter-danger); }
.member { display: flex; align-items: center; gap: var(--twitter-space-3); padding-block: var(--twitter-space-2); }
.avatar { flex: none; width: 36px; height: 36px; }
.secondary { color: var(--twitter-secondary-fg); }
.details h3 { margin-top: var(--twitter-space-6); font-size: var(--twitter-font-size-emphasis); }
</style>
