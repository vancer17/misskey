<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only

文件领域：聊天路由的界面边界。
作用：Twitter 私信工作区与真实存量原生页面只挂载其中一方，避免双重查询和标读。
数据链：路由实体标识及既有 UI 上下文 → 展示入口；不复制消息、权限或账户事实。
原生分支服务现有 Misskey UI 用户，只有停止支持该 UI 后才能移除。
-->

<template>
<TwitterMessagesPage v-if="isTwitterUi" v-bind="props"/>
<component :is="nativePage" v-else v-bind="props"/>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent } from 'vue';
import type { Component, ComputedRef } from 'vue';
import { useIsTwitterUi } from '@/ui/twitter/context/index.js';
import { loadTwitterMessagesPage } from '@/ui/twitter/messages/index.js';

/** 路由只传入原始标识，不携带完整业务实体。 */
type ChatEntryProps = Readonly<{
	userId?: string;
	roomId?: string;
	messageId?: string;
}>;

/** 路由输入在此只读转交被选中的页面。 */
const props: ChatEntryProps = defineProps<ChatEntryProps>();
/** 既有界面选择只决定展示分支，不修改聊天领域规则。 */
const isTwitterUi: ComputedRef<boolean> = useIsTwitterUi();
/** Twitter 页面代码按实际展示加载，原生路由不触发其业务生命周期。 */
const TwitterMessagesPage: Component = defineAsyncComponent(loadTwitterMessagesPage);
/** 原页面保持独立实例与既有行为，不创建无消费者的兼容接口。 */
const nativeHome: Component = defineAsyncComponent(/** 只在原生首页分支挂载时加载。 */ (): Promise<typeof import('./home.vue')> => import('./home.vue'));
/** 原生个人与群聊继续使用同一既有页面。 */
const nativeRoom: Component = defineAsyncComponent(/** 在原生会话分支按需加载。 */ (): Promise<typeof import('./room.vue')> => import('./room.vue'));
/** 消息深链由原生页面保留自己的业务生命周期。 */
const nativeMessage: Component = defineAsyncComponent(/** 保留原生消息深链的页面与操作。 */ (): Promise<typeof import('./message.vue')> => import('./message.vue'));
/** 页面种类只从路由标识形状派生。 */
const nativePage: ComputedRef<Component> = computed(
	/** 标识形状只决定页面展示，不反向推断会话能力。 */
	(): Component => props.messageId != null ? nativeMessage : props.userId != null || props.roomId != null ? nativeRoom : nativeHome,
);
</script>
