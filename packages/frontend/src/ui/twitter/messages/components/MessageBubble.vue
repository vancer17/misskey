<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：Twitter UI 私信 · 消息展示。
作用：只读呈现 Store 交付的消息、附件和反应；删除与反应命令统一回交 Store。
数据链：领域消息 → 气泡和操作入口 → Store Action，不持有业务状态副本。
-->

<template>
<article :id="`chat-message-${message.id}`" :class="[$style.message, { [$style.mine]: isMine, [$style.highlight]: highlighted }]" :data-message-id="message.id">
	<MkAvatar v-if="!isMine" :decorations="[]" :user="message.fromUser" :class="$style.avatar" :link="true"/>
	<div :class="$style.body">
		<div v-if="showSender && !isMine" :class="$style.sender"><MkUserName :user="message.fromUser"/></div>
		<div :class="[$style.bubble, { [$style.withMedia]: message.file != null }]">
			<Mfm v-if="message.text" :class="$style.text" class="_selectable" :text="message.text" :i="$i" :nyaize="'respect'" :enableEmojiMenu="true"/>
			<MkMediaList v-if="message.file" :mediaList="[message.file]" :user="message.fromUser"/>
		</div>
		<div v-if="message.reactions.length > 0" :class="$style.reactions">
			<button v-for="record in message.reactions" :key="record.reaction + record.user.id" type="button" class="_button" :class="[$style.reaction, { [$style.myReaction]: record.user.id === $i.id }]" :disabled="!canInteract || isMine" :aria-label="`${i18n.ts.reaction}: ${record.reaction}`" :aria-pressed="record.user.id === $i.id" @click="toggleReaction(record.reaction)">
				<MkReactionIcon :reaction="record.reaction.replace(/^:(\w+):$/, ':$1@.:')" :noStyle="true" :class="$style.reactionIcon"/>
				<MkAvatar :decorations="[]" :user="record.user" :class="$style.reactionAvatar" :link="false"/>
			</button>
		</div>
		<div :class="$style.meta">
			<MkTime :time="message.createdAt"/>
			<button v-if="canInteract && !isMine" type="button" class="_button" :class="$style.action" :aria-label="i18n.ts.reaction" @click="chooseReaction"><i class="ti ti-mood-plus" aria-hidden="true"></i></button>
			<button type="button" class="_button" :class="$style.action" :aria-label="i18n.ts.more" @click="showMenu"><i class="ti ti-dots" aria-hidden="true"></i></button>
			<button v-if="searchResult" type="button" class="_textButton" @click="openMessage">{{ i18n.ts._twitterMessages.jumpToMessage }}</button>
		</div>
	</div>
</article>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import { chatStore } from '../index.js';
import type { ChatMessage } from '../index.js';
import MkMediaList from '@/components/MkMediaList.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { reactionPicker } from '@/utility/reaction-picker.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import type { MenuItem } from '@/types/menu.js';
import { useRouter } from '@/router.js';

/** 只读消息及展示参数；业务类型直接沿用服务端生成的权威实体。 */
type MessageBubbleProps = Readonly<{
	message: ChatMessage;
	canInteract: boolean;
	showSender?: boolean;
	highlighted?: boolean;
	searchResult?: boolean;
}>;
/** 展示输入保持只读。 */
const props: MessageBubbleProps = defineProps<MessageBubbleProps>();
/** 当前账户只用于消息归属展示；写入权限由 Store 的服务端事实决定。 */
const $i: Misskey.entities.MeDetailed = ensureSignin();
/** 路由只携带消息标识，不缓存消息实体。 */
const router: ReturnType<typeof useRouter> = useRouter();
/** 自己发出的消息在右侧展示，不据此计算发送权限。 */
const isMine: ComputedRef<boolean> = computed(/** 从权威发送者标识派生对齐。 */ (): boolean => props.message.fromUserId === $i.id);

/** 反应命令交给 Store，服务端回执更新唯一消息集合。 */
async function toggleReaction(reaction: string): Promise<void> {
	if (isMine.value || !props.canInteract) return;
	try { await chatStore.toggleReaction(props.message.id, reaction); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); }
}

/** 选择器只产生用户意图，不在组件内创建反应状态。 */
function chooseReaction(event: MouseEvent): void {
	if (isMine.value || !props.canInteract) return;
	if (!(event.currentTarget instanceof HTMLElement)) return;
	reactionPicker.show(event.currentTarget, null, /** 表情选择回交业务 Action。 */ (reaction: string): void => { void toggleReaction(reaction); });
}

/** 删除需明确确认，随后由 Store 处理命令与错误。 */
async function removeMessage(): Promise<void> {
	const confirmation: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({ type: 'warning', text: i18n.ts._twitterMessages.deleteMessageConfirm });
	if (confirmation.canceled) return;
	try { await chatStore.removeMessage(props.message.id); } catch { await os.alert({ type: 'error', text: i18n.ts._twitterMessages.operationFailed }); }
}

/** 操作菜单仅提供复制及当前用户可提交的删除命令。 */
function showMenu(event: MouseEvent): void {
	const menu: MenuItem[] = [{
		text: i18n.ts.copyContent,
		icon: 'ti ti-copy',
		/** 复制为 UI 行为，不更新业务事实。 */
		action: (): void => { void copyToClipboard(props.message.text ?? ''); },
	}, {
		text: i18n.ts._twitterMessages.messageLink,
		icon: 'ti ti-link',
		/** 既有深链继续仅序列化消息标识。 */
		action: (): void => { void copyToClipboard(`${url}/chat/messages/${props.message.id}`); },
	}];
	if (isMine.value && props.canInteract) menu.push({ text: i18n.ts.delete, icon: 'ti ti-trash', danger: true, action: removeMessage });
	os.popupMenu(menu, event.currentTarget ?? event.target);
}

/** 搜索结果跳入既有消息深链，由 Store 确认目标与历史。 */
function openMessage(): void {
	router.push('/chat/messages/:messageId', { params: { messageId: props.message.id } });
}
</script>

<style lang="scss" module>
.message {
	display: flex;
	align-items: flex-end;
	gap: var(--twitter-space-2);
	padding: var(--twitter-space-2) var(--twitter-space-4);
	scroll-margin-block: var(--twitter-space-4);
}
.mine { flex-direction: row-reverse; }
.highlight { background: color-mix(in srgb, var(--twitter-accent) 14%, transparent); border-radius: var(--twitter-radius-medium); }
.avatar { flex: none; width: 32px; height: 32px; margin-bottom: 30px; }
.body { min-width: 0; max-width: min(82%, 520px); }
.sender { font-size: var(--twitter-font-size-meta); color: var(--twitter-secondary-fg); margin-bottom: var(--twitter-space-1); }
.bubble {
	padding: var(--twitter-space-3) var(--twitter-space-4);
	border-radius: var(--twitter-radius-large) var(--twitter-radius-large) var(--twitter-radius-large) var(--twitter-radius-small);
	background: var(--twitter-hover);
	overflow-wrap: anywhere;
	line-height: 1.5;
}
.mine .bubble { background: var(--twitter-accent); color: var(--twitter-fg-on-accent); border-radius: var(--twitter-radius-large) var(--twitter-radius-large) var(--twitter-radius-small) var(--twitter-radius-large); }
.withMedia { min-width: 160px; overflow: hidden; }
.text { white-space: pre-wrap; }
.meta { display: flex; align-items: center; gap: var(--twitter-space-2); color: var(--twitter-secondary-fg); font-size: var(--twitter-font-size-caption); min-height: 30px; }
.mine .meta { justify-content: flex-end; }
.action { display: inline-grid; place-items: center; min-width: 30px; min-height: 30px; border-radius: var(--twitter-radius-pill); }
.action:hover { color: var(--twitter-accent); background: var(--twitter-hover); }
.reactions { display: flex; flex-wrap: wrap; gap: var(--twitter-space-1); margin-top: var(--twitter-space-1); }
.mine .reactions { justify-content: flex-end; }
.reaction { display: flex; align-items: center; gap: var(--twitter-space-1); padding: var(--twitter-space-1) var(--twitter-space-2); border: 1px solid var(--twitter-border); border-radius: var(--twitter-radius-pill); }
.myReaction { border-color: var(--twitter-accent); background: color-mix(in srgb, var(--twitter-accent) 10%, transparent); }
.reactionIcon { width: 20px; height: 20px; }
.reactionAvatar { width: 16px; height: 16px; }
</style>
