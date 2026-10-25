<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI 私信 · 输入与附件交互。
作用：将文本、单附件、表情和快捷键意图交付消息 Store；仅保留焦点、上传等临时 UI 状态。
数据链：输入事件 → Store 草稿／发送 Action → 服务端回执；不持久化私信正文，不自动重发。
-->

<template>
<form data-testid="twitter-message-composer" :class="$style.composer" @submit.prevent="send" @dragover.prevent @drop.prevent="onDrop">
	<p v-if="disabledReason" :class="$style.reason" role="status">{{ disabledReason }}</p>
	<div v-if="state.command.status === 'uncertain'" :class="$style.warning" role="alert"><p>{{ i18n.ts._twitterMessages.sendUncertain }}</p><div :class="$style.uncertainActions"><button type="button" class="_textButton" @click="refreshConversation">{{ i18n.ts._twitterMessages.checkSendResult }}</button><button type="button" class="_textButton" @click="confirmSendResult">{{ i18n.ts._twitterMessages.allowSendAgain }}</button></div></div>
	<p v-else-if="state.command.status === 'failed'" :class="$style.warning" role="alert">{{ i18n.ts._twitterMessages.sendFailed }}</p>
	<div v-if="state.draft.file" :class="$style.attachment">
		<i class="ti ti-paperclip" aria-hidden="true"></i>
		<span>{{ state.draft.file.name }}</span>
		<button type="button" class="_button" :class="$style.tool" :disabled="sending" :aria-label="i18n.ts._twitterMessages.removeAttachment" @click="removeAttachment"><i class="ti ti-x" aria-hidden="true"></i></button>
	</div>
	<div :class="$style.inputRow">
		<textarea
			ref="textarea"
			v-model="text"
			:class="$style.textarea"
			:disabled="!canSend || sending"
			:readonly="emojiOpen"
			:placeholder="i18n.ts._twitterMessages.messagePlaceholder"
			:aria-label="i18n.ts._twitterMessages.messagePlaceholder"
			rows="1"
			@keydown="onKeydown"
			@paste="onPaste"
		></textarea>
		<button type="submit" data-testid="twitter-message-send" class="_button" :class="$style.send" :disabled="!canSubmit" :aria-label="sending ? i18n.ts._twitterMessages.sending : i18n.ts.send" :title="i18n.ts.send">
			<i :class="sending ? 'ti ti-loader-2' : 'ti ti-send'" aria-hidden="true"></i>
		</button>
	</div>
	<div :class="$style.toolbar">
		<button type="button" class="_button" :class="$style.tool" :disabled="!canSend || sending || uploading" :aria-label="i18n.ts._twitterMessages.attachment" @click="chooseFile"><i class="ti ti-photo-plus" aria-hidden="true"></i></button>
		<button type="button" class="_button" :class="$style.tool" :disabled="!canSend || sending" :aria-label="i18n.ts.emoji" @click="insertEmoji"><i class="ti ti-mood-happy" aria-hidden="true"></i></button>
		<span :class="$style.hint">{{ uploading ? i18n.ts.uploading : (prefer.s['chat.sendOnEnter'] ? i18n.ts._twitterMessages.sendHintEnter : i18n.ts._twitterMessages.sendHint) }}</span>
	</div>
</form>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import type { ComputedRef, Ref, WritableComputedRef } from 'vue';
import type * as Misskey from 'misskey-js';
import { chatStore } from '../index.js';
import type { ChatTarget } from '../index.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { selectFile } from '@/utility/drive.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { prefer } from '@/preferences.js';

/** 发送能力与原因均由上层权威会话事实派生，不在输入组件中重算策略。 */
type MessageComposerProps = Readonly<{ canSend: boolean; disabledReason: string | null }>;
/** 发送输入保持只读。 */
const props: MessageComposerProps = defineProps<MessageComposerProps>();
/** 组件仅引用全局唯一状态，不保存业务副本。 */
const state: typeof chatStore.state = chatStore.state;
/** 当前编辑器的原生节点，仅服务临时焦点与选择区。 */
const textarea: Readonly<Ref<HTMLTextAreaElement | null>> = useTemplateRef<HTMLTextAreaElement>('textarea');
/** 上传活动不代表消息已发送。 */
const uploading: Ref<boolean> = ref<boolean>(false);
/** 表情窗口打开期间避免移动端键盘抢占。 */
const emojiOpen: Ref<boolean> = ref<boolean>(false);
/** 组件销毁后禁止迟到附件和表情写入新会话。 */
let alive: boolean = true;
/** 原始会话标识只是异步交互归属，不参与业务决策。 */
const targetAtMount: ChatTarget | null = state.active.target;
/** 原账户标识防止异步文件回执跨账户泄漏。 */
const accountAtMount: string | null = state.accountId;
/** 双向绑定只向 Store 提交修改，不对只读草稿赋值。 */
const text: WritableComputedRef<string> = computed<string>({
	/** 文本由唯一草稿所有者提供。 */
	get: (): string => state.draft.text,
	/** 用户输入保留 Store 中已有附件。 */
	set: (value: string): void => { chatStore.setDraft(value, state.draft.file); },
});
/** 命令状态只是展示派生。 */
const sending: ComputedRef<boolean> = computed(/** 阻止同一编辑器重复点击。 */ (): boolean => state.command.status === 'sending');
/** 输入完整性与服务器发送能力共同约束提交按钮。 */
const canSubmit: ComputedRef<boolean> = computed(/** 不从文本内容推导联系人策略。 */ (): boolean => props.canSend && state.command.status !== 'uncertain' && !sending.value && !uploading.value && (text.value.trim().length > 0 || state.draft.file != null));

/** 检验迟到 UI 回执仍属于挂载时的账户和会话。 */
function isCurrent(): boolean {
	return alive && state.accountId === accountAtMount && state.active.target?.type === targetAtMount?.type && state.active.target?.id === targetAtMount?.id;
}

/** 单附件选择复用既有网盘／本地上传选择器，只提交服务端文件回执。 */
async function chooseFile(event: MouseEvent): Promise<void> {
	try {
		const file: Misskey.entities.DriveFile = await selectFile({ anchorElement: event.currentTarget, multiple: false, label: i18n.ts.selectFile });
		if (isCurrent()) chatStore.setDraft(text.value, file);
	} catch (error: unknown) {
		if (isCurrent() && error != null) await os.alert({ type: 'error', text: i18n.ts.failedToUpload });
	}
}

/** 上传入口统一限制单文件，上传失败不会清除草稿。 */
async function upload(files: readonly File[]): Promise<void> {
	if (!props.canSend || sending.value || uploading.value || files.length === 0) return;
	if (files.length !== 1) {
		await os.alert({ type: 'warning', text: i18n.ts.onlyOneFileCanBeAttached });
		return;
	}
	uploading.value = true;
	try {
		const uploaded: Misskey.entities.DriveFile[] = await os.launchUploader([...files], { multiple: false });
		if (isCurrent() && uploaded[0] != null) chatStore.setDraft(text.value, uploaded[0]);
	} catch (error: unknown) {
		if (isCurrent() && error != null) await os.alert({ type: 'error', text: i18n.ts.failedToUpload });
	} finally {
		if (alive) uploading.value = false;
	}
}

/** 粘贴图片交给统一上传入口，文本粘贴仍由 textarea 原生处理。 */
async function onPaste(event: ClipboardEvent): Promise<void> {
	const files: File[] = Array.from(event.clipboardData?.files ?? []);
	if (files.length === 0) return;
	event.preventDefault();
	await upload(files);
}

/** 拖入本地文件和粘贴共用同一单附件语义。 */
async function onDrop(event: DragEvent): Promise<void> {
	await upload(Array.from(event.dataTransfer?.files ?? []));
}

/** 移除只影响当前草稿引用，不删除网盘已上传的文件。 */
function removeAttachment(): void {
	chatStore.setDraft(text.value, null);
}

/** 表情按选择区插入 Store 草稿，关闭后恢复临时焦点。 */
function insertEmoji(event: MouseEvent): void {
	if (!(event.currentTarget instanceof HTMLElement)) return;
	let start: number = textarea.value?.selectionStart ?? text.value.length;
	let end: number = textarea.value?.selectionEnd ?? start;
	emojiOpen.value = true;
	emojiPicker.show(event.currentTarget,
		/** 表情回执只有仍属于当前会话时才写入。 */
		(emoji: string): void => {
			if (!isCurrent()) return;
			text.value = text.value.slice(0, start) + emoji + text.value.slice(end);
			start += emoji.length;
			end = start;
		},
		/** 关闭窗口不改变消息业务状态。 */
		(): void => {
			if (!isCurrent()) return;
			emojiOpen.value = false;
			void nextTick(/** DOM 更新后恢复选择区。 */ (): void => { textarea.value?.focus(); textarea.value?.setSelectionRange(start, end); });
		});
}

/** 沿用 Misskey 的 Enter 偏好，并排除中文输入法组合事件。 */
function onKeydown(event: KeyboardEvent): void {
	if (event.isComposing || event.key !== 'Enter') return;
	const shouldSend: boolean = prefer.s['chat.sendOnEnter'] ? !(event.ctrlKey || event.metaKey || event.shiftKey) : (event.ctrlKey || event.metaKey);
	if (!shouldSend) return;
	event.preventDefault();
	void send();
}

/** 不确定发送先显式重新同步历史，仍不产生重发请求。 */
async function refreshConversation(): Promise<void> { await chatStore.refreshActive(); }

/** 用户核对后显式解除保护；文本仍需再次点击发送，不自动重发。 */
async function confirmSendResult(): Promise<void> {
	const confirmation: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({ type: 'warning', text: i18n.ts._twitterMessages.allowSendAgainConfirm });
	if (!confirmation.canceled && isCurrent()) chatStore.confirmUncertainSend();
}

/** 不执行乐观清空或自动重试，发送终态由 Store 决定。 */
async function send(): Promise<void> {
	if (!canSubmit.value) return;
	await chatStore.send();
	if (isCurrent()) textarea.value?.focus();
}

onBeforeUnmount(/** 销毁只释放临时 UI 生命周期。 */ (): void => { alive = false; });
</script>

<style lang="scss" module>
.composer { flex: none; padding: var(--twitter-space-3) var(--twitter-space-4) max(var(--twitter-space-2), env(safe-area-inset-bottom)); border-top: 1px solid var(--twitter-border); background: var(--twitter-panel); }
.reason, .warning { margin: 0 0 var(--twitter-space-2); font-size: var(--twitter-font-size-meta); line-height: 1.4; color: var(--twitter-secondary-fg); }
.uncertainActions { display: flex; flex-wrap: wrap; gap: var(--twitter-space-3); margin-top: var(--twitter-space-2); }
.warning p { margin: 0; }
.warning { color: var(--twitter-warning); }
.inputRow { display: flex; align-items: flex-end; gap: var(--twitter-space-2); padding: var(--twitter-space-2) var(--twitter-space-3); border: 1px solid var(--twitter-border); border-radius: var(--twitter-radius-large); background: var(--twitter-hover); }
.inputRow:focus-within { border-color: var(--twitter-accent); }
.textarea { flex: 1; min-width: 0; min-height: 28px; max-height: 160px; field-sizing: content; padding: var(--twitter-space-1) 0; resize: none; border: none; outline: none; color: var(--twitter-fg); background: transparent; font: inherit; line-height: 1.5; }
.textarea:disabled { opacity: .6; }
.send { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--twitter-radius-pill); color: var(--twitter-fg-on-accent); background: var(--twitter-accent); }
.send:disabled { opacity: .45; }
.send:not(:disabled):hover { background: var(--twitter-accent-hover); }
.toolbar { display: flex; align-items: center; gap: var(--twitter-space-1); padding-top: var(--twitter-space-1); color: var(--twitter-accent); }
.tool { flex: none; display: inline-grid; place-items: center; min-width: 36px; min-height: 36px; border-radius: var(--twitter-radius-pill); }
.tool:hover { background: var(--twitter-hover); }
.tool:disabled { opacity: .5; }
.hint { margin-left: auto; color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-caption); text-align: right; }
.attachment { display: flex; align-items: center; gap: var(--twitter-space-2); margin-bottom: var(--twitter-space-2); padding-left: var(--twitter-space-2); font-size: var(--twitter-font-size-meta); }
.attachment span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
