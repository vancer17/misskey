/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：包内 Twitter 社区的构建期路由装配。
 * 作用：复用现有真实页面与 loader，排除原登录、注册和默认前端入口。
 * 数据链：简单内部地址 → 原业务页面；此处不判定用户业务权限，也不存储实体。
 */
import { defineAsyncComponent } from 'vue';
import type { AsyncComponentLoader, Component } from 'vue';
import type { RouteDef } from '@/lib/nirax.js';
import { TWITTER_CHAT_ROUTE_NAMES } from '@/ui/twitter/context/index.js';
import { loadChannelPage, loadNotificationsPage, loadUserPage } from '@/ui/twitter/routing/index.js';

/** 沿用 Vue 的真实异步组件机制，不导入原全站路由定义及其认证页面。 */
export function page(loader: AsyncComponentLoader): Component {
	return defineAsyncComponent(loader);
}

/** 仅装配现有社区页面，认证和管理页面不进入当前制品路由图。 */
export const ROUTE_DEF: RouteDef[] = [{
	name: 'index',
	path: '/',
	component: page(/** 首页复用现有真实时间线。 */ (): Promise<typeof import('@/pages/timeline.vue')> => import('@/pages/timeline.vue')),
}, {
	path: '/timeline',
	component: page(/** 时间线别名复用同一个页面。 */ (): Promise<typeof import('@/pages/timeline.vue')> => import('@/pages/timeline.vue')),
}, {
	path: '/@:acct/following',
	component: page(/** 关注关系复用原列表页面。 */ (): Promise<typeof import('@/pages/user/following.vue')> => import('@/pages/user/following.vue')),
}, {
	path: '/@:acct/followers',
	component: page(/** 被关注关系复用原列表页面。 */ (): Promise<typeof import('@/pages/user/followers.vue')> => import('@/pages/user/followers.vue')),
}, {
	name: 'user',
	path: '/@:acct/:page?',
	viewKey: 'user',
	component: page(loadUserPage),
}, {
	name: 'note',
	path: '/notes/:noteId/:initialTab?',
	component: page(/** 帖子详情继续使用原权威查询链。 */ (): Promise<typeof import('@/pages/note.vue')> => import('@/pages/note.vue')),
}, {
	path: '/my/notifications',
	component: page(loadNotificationsPage),
	loginRequired: true,
}, {
	path: '/search',
	viewKey: 'search',
	component: page(/** 搜索继续使用原页面与查询状态。 */ (): Promise<typeof import('@/pages/search.vue')> => import('@/pages/search.vue')),
	query: { q: 'query', userId: 'userId', username: 'username', host: 'host', channel: 'channel', type: 'type', origin: 'origin' },
}, {
	path: '/explore',
	component: page(/** 发现继续复用原页面。 */ (): Promise<typeof import('@/pages/explore.vue')> => import('@/pages/explore.vue')),
	hash: 'initialTab',
}, {
	path: '/channels',
	component: page(/** 频道列表继续复用原页面。 */ (): Promise<typeof import('@/pages/channels.vue')> => import('@/pages/channels.vue')),
}, {
	path: '/channels/:channelId/edit',
	component: page(/** 已有频道编辑能力继续由原业务页面持有。 */ (): Promise<typeof import('@/pages/channel-editor.vue')> => import('@/pages/channel-editor.vue')),
	loginRequired: true,
}, {
	path: '/channels/new',
	component: page(/** 已有频道创建能力继续由原业务页面持有。 */ (): Promise<typeof import('@/pages/channel-editor.vue')> => import('@/pages/channel-editor.vue')),
	loginRequired: true,
}, {
	path: '/channels/:channelId',
	component: page(loadChannelPage),
}, {
	name: 'list',
	path: '/list/:listId',
	component: page(/** 用户列表时间线继续由原实现持有。 */ (): Promise<typeof import('@/pages/list.vue')> => import('@/pages/list.vue')),
}, {
	path: '/my/lists/:listId',
	component: page(/** 列表详情继续使用原页面。 */ (): Promise<typeof import('@/pages/my-lists/list.vue')> => import('@/pages/my-lists/list.vue')),
	loginRequired: true,
}, {
	path: '/my/lists',
	component: page(/** 列表管理复用原页面。 */ (): Promise<typeof import('@/pages/my-lists/index.vue')> => import('@/pages/my-lists/index.vue')),
	loginRequired: true,
}, {
	path: '/my/favorites',
	component: page(/** 收藏继续使用原有业务页面。 */ (): Promise<typeof import('@/pages/favorites.vue')> => import('@/pages/favorites.vue')),
	loginRequired: true,
}, {
	path: '/chat',
	name: TWITTER_CHAT_ROUTE_NAMES.inbox,
	component: page(/** 私信页面复用原入口，真实权限留在原领域与服务端。 */ (): Promise<typeof import('@/pages/chat/entry.vue')> => import('@/pages/chat/entry.vue')),
	loginRequired: true,
}, {
	path: '/chat/user/:userId',
	name: TWITTER_CHAT_ROUTE_NAMES.user,
	component: page(/** 私聊只序列化用户标识。 */ (): Promise<typeof import('@/pages/chat/entry.vue')> => import('@/pages/chat/entry.vue')),
	loginRequired: true,
}, {
	path: '/chat/room/:roomId',
	name: TWITTER_CHAT_ROUTE_NAMES.room,
	component: page(/** 群聊只序列化群标识。 */ (): Promise<typeof import('@/pages/chat/entry.vue')> => import('@/pages/chat/entry.vue')),
	loginRequired: true,
}, {
	path: '/chat/messages/:messageId',
	name: TWITTER_CHAT_ROUTE_NAMES.message,
	component: page(/** 消息深链只序列化消息标识。 */ (): Promise<typeof import('@/pages/chat/entry.vue')> => import('@/pages/chat/entry.vue')),
	loginRequired: true,
}, {
	path: '/settings/profile',
	component: page(/** 资料展示复用原设置页面，写入依赖真实 BFF。 */ (): Promise<typeof import('@/pages/settings/profile.vue')> => import('@/pages/settings/profile.vue')),
	loginRequired: true,
}, {
	path: '/announcements',
	component: page(/** 公告复用原业务页面。 */ (): Promise<typeof import('@/pages/announcements.vue')> => import('@/pages/announcements.vue')),
}, {
	path: '/announcements/:announcementId',
	component: page(/** 公告详情只序列化公告标识。 */ (): Promise<typeof import('@/pages/announcement.vue')> => import('@/pages/announcement.vue')),
}, {
	name: 'community-not-found',
	path: '/:communityUnknownPath(*)',
	component: page(/** 未知路径直接显示原缺失页面，不通过替换导航递归重试。 */ (): Promise<typeof import('@/pages/not-found.vue')> => import('@/pages/not-found.vue')),
}];
