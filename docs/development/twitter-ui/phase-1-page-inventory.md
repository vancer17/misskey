# Twitter UI 第一阶段页面总表

本文档只维护第一阶段 Twitter 风格 UI 的页面范围、路由、当前代码锚点、处理等级和依赖关系。阶段目标、实施排期、进度状态和验收细节不在本文档维护；实施拆分见 [Phase 1 development checklist](./phase-1-development-checklist.md)。

## 字段约定

### 页面分类

| 分类 | 含义 |
| --- | --- |
| **必做** | 第一阶段最小发布集合。全部完成后，`twitter` UI 才能进入默认 rollout 评估。 |
| **扩展** | 与第一阶段关系密切，但只能在必做集合完成后纳入。可按容量移入第二阶段。 |
| **阶段外** | 第一阶段不实施 Twitter 化，只记录处置方式，防止主导航意外进入旧样式页面。 |

### 处理等级

| 等级 | 含义 |
| --- | --- |
| **Full** | 完整处理布局、排版、间距、状态、操作和响应式行为。主用户路径必须达到该等级。 |
| **Core** | 主工作流完整处理，次要控件仅做基础兼容。 |
| **Compatible** | 复用 Twitter Shell、token、header、按钮和通用状态，不重做页面特有信息架构。 |
| **Legacy allowed** | 暂时保留当前 Misskey 样式。仅适用于低频运营 / 调试界面。 |
| **Hide** | 公司版导航暂不暴露入口，待后续产品决策。 |

## 第一阶段必做总表

| ID | 页面 / 界面 | 路由 / 范围 | 当前代码锚点 | 等级 | 依赖 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| **P-00** | 应用 Shell | 所有已登录 `twitter` UI 路由 | 新增 `packages/frontend/src/ui/twitter.vue`；`packages/frontend/src/boot/main-boot.ts`；`packages/frontend/src/ui/_common_/navbar.vue`；`packages/frontend/src/ui/_common_/mobile-footer-menu.vue`；`packages/frontend/src/ui/_common_/widgets.vue` | Full | 无 | 三栏桌面 Shell、移动 Shell、主题变量和全局导航容器。 |
| **P-01** | 首页时间线 | `/`、`/timeline` | `packages/frontend/src/pages/timeline.vue`；`packages/frontend/src/components/MkStreamingNotesTimeline.vue`；`packages/frontend/src/components/MkNotesTimeline.vue` | Full | P-00 | 时间线 tabs、连续列表、hairline 分隔、新帖提示和加载更多。 |
| **P-02** | Note / Post 卡片 | 时间线、搜索、列表、个人主页时间线等共享界面 | `packages/frontend/src/components/MkNote.vue`；`packages/frontend/src/components/MkNoteHeader.vue`；`packages/frontend/src/components/MkReactionsViewer.vue`；`packages/frontend/src/components/MkMediaList.vue`；`packages/frontend/src/components/MkNoteMediaGrid.vue`；`packages/frontend/src/components/MkPoll.vue`；`packages/frontend/src/components/MkUrlPreview.vue` | Full | P-00，宜与 P-01 同步 | 共享帖子卡片、头部、操作栏、renote / quote、媒体和富内容。 |
| **P-03** | 帖子详情与回复线程 | `/notes/:noteId/:initialTab?` | `packages/frontend/src/pages/note.vue`；`packages/frontend/src/components/MkNoteDetailed.vue`；`packages/frontend/src/components/MkNoteSub.vue` | Full | P-02 | 详情页大字号排版、metadata、回复列表和线程连接。 |
| **P-04** | 用户主页 | `/@:acct/:page?` | `packages/frontend/src/pages/user/index.vue`；`packages/frontend/src/pages/user/index.timeline.vue`；`packages/frontend/src/pages/user/notes.vue` | Full | P-02 | Banner、avatar、身份信息、follow / edit 操作、tabs 和用户时间线。 |
| **P-05** | 发帖 / 回复 / 引用 | 全局 composer；由时间线、详情页、FAB、菜单和快捷键打开 | `packages/frontend/src/components/MkPostForm.vue`；`packages/frontend/src/components/MkPostFormDialog.vue`；`packages/frontend/src/components/MkPostFormAttaches.vue`；`packages/frontend/src/os.ts` | Full | P-00 | 内联编辑器、全局对话框、回复、引用、可见性、媒体和提交状态。 |
| **P-06** | 通知 | `/my/notifications` | `packages/frontend/src/pages/notifications.vue` | Full | P-00、P-09 | 通知行、类型图标、已读 / 未读、跳转和分页状态。 |
| **P-07** | 搜索 | `/search` | `packages/frontend/src/pages/search.vue`；`packages/frontend/src/pages/search.note.vue`；`packages/frontend/src/pages/search.user.vue` | Full | P-02 | 搜索输入、结果 tabs、帖子结果、用户结果和无结果状态。 |
| **P-08** | 全局菜单与对话框 | Note 菜单、用户菜单、repost 菜单、reaction picker、确认 / 提示、tooltip | `packages/frontend/src/components/MkMenu.vue`；`packages/frontend/src/components/MkMenu.child.vue`；`packages/frontend/src/components/MkPopupMenu.vue`；`packages/frontend/src/components/MkContextMenu.vue`；`packages/frontend/src/components/MkModal.vue`；`packages/frontend/src/components/MkModalWindow.vue`；`packages/frontend/src/components/MkDialog.vue`；`packages/frontend/src/components/MkEmojiPickerDialog.vue`；`packages/frontend/src/utility/reaction-picker.ts` | Full | P-00、P-05 | 主路径覆盖层的容器、交互和视觉语言。 |
| **P-09** | 共享页面状态 | 必做页面的 empty / loading / error / no-results / not-found / retry | `packages/frontend/src/pages/_loading_.vue`；`packages/frontend/src/pages/_error_.vue`；`packages/frontend/src/pages/not-found.vue`；各页面使用的结果与加载组件 | Full | P-00 | 统一必做页面的基础状态和重试行为。 |
| **P-10** | 移动端布局 | 桌面阈值以下的所有必做界面 | 新增 Twitter 移动 Shell / 底部导航 / FAB；`packages/frontend/src/ui/_common_/mobile-footer-menu.vue` | Full | P-00 | 底部导航、发帖 FAB、safe area、sticky header 和移动触控目标。 |

## 第一阶段扩展总表

| ID | 页面 / 界面 | 路由 / 范围 | 当前代码锚点 | 等级 | 依赖 | 纳入条件 |
| --- | --- | --- | --- | --- | --- | --- |
| **P-11** | 个人资料设置 | `/settings/profile` | `packages/frontend/src/pages/settings/profile.vue` | Core | P-00 | 需要演示或完成账号身份配置时。 |
| **P-12** | 正在关注列表 | `/@:acct/following` | `packages/frontend/src/pages/user/following.vue`；`packages/frontend/src/pages/user/follow-list.vue` | Full | P-04 | 用户主页完成后纳入。 |
| **P-13** | 关注者列表 | `/@:acct/followers` | `packages/frontend/src/pages/user/followers.vue`；`packages/frontend/src/pages/user/follow-list.vue` | Full | P-04 | 用户主页完成后纳入。 |
| **P-14** | 探索 | `/explore` | `packages/frontend/src/pages/explore.vue`；`packages/frontend/src/pages/explore.featured.vue`；`packages/frontend/src/pages/explore.users.vue`；`packages/frontend/src/pages/explore.roles.vue` | Full 或 Core | P-00、P-02 | 第一阶段左侧导航暴露 Explore 入口时。 |
| **P-15** | Hashtag 结果页 | `/tags/:tag` | `packages/frontend/src/pages/tag.vue` | Full | P-07 | 搜索和共享帖子列表稳定后纳入。 |
| **P-16** | 用户标签结果页 | `/user-tags/:tag` | `packages/frontend/src/pages/user-tag.vue` | Full 或 Compatible | P-07 | 公司产品确认保留 user tags 时；否则隐藏。 |
| **P-17** | 收藏 | `/my/favorites` | `packages/frontend/src/pages/favorites.vue` | Compatible | P-02 | 作为 bookmark-like 功能暴露时。 |
| **P-18** | 列表时间线 | `/list/:listId`、`/timeline/list/:listId` | `packages/frontend/src/pages/list.vue`；`packages/frontend/src/pages/user-list-timeline.vue` | Compatible | P-01、P-02 | Lists 保留为第一阶段可见功能时。 |

## 阶段外路由处置

| 路由组 / 界面 | 当前代码区域 | 第一阶段处置 |
| --- | --- | --- |
| 未登录欢迎页 `/` | `packages/frontend/src/pages/welcome.vue` | 阶段外；已登录 `/` 属于 P-01。公开登录体验另行 scope。 |
| 登录 / 注册对话框 | `packages/frontend/src/components/MkSigninDialog.vue`；`packages/frontend/src/components/MkSignupDialog.vue` | 仅演示需要时做 Compatible。 |
| Profile 以外的设置页 | `packages/frontend/src/pages/settings/*` | Phase 2 Compatible。 |
| Drive | `packages/frontend/src/pages/drive*.vue` | Phase 2 Compatible。 |
| Admin | `packages/frontend/src/pages/admin/*` | Legacy allowed，不进入用户侧 rollout 验收。 |
| Chat | `packages/frontend/src/pages/chat/*` | Hide，除非 DM 是明确第一阶段需求。 |
| Channels | `packages/frontend/src/pages/channel*.vue`；`packages/frontend/src/pages/channels.vue` | Hide 或延后，待公司社群模型决策。 |
| Gallery | `packages/frontend/src/pages/gallery/*` | Hide，除非公司明确需要媒体画廊。 |
| Pages / Play | `packages/frontend/src/pages/page*`；`packages/frontend/src/pages/flash/*` | Hide。 |
| Clips | `packages/frontend/src/pages/my-clips/*`；`packages/frontend/src/pages/clip.vue` | 延后；后续可评估是否映射为 bookmark。 |
| Lists / Antennas 管理页 | `packages/frontend/src/pages/my-lists/*`；`packages/frontend/src/pages/my-antennas/*` | 延后；列表时间线见 P-18。 |
| Games | `packages/frontend/src/pages/games.vue`；`packages/frontend/src/pages/reversi/*`；`packages/frontend/src/pages/drop-and-fusion.vue`；`packages/frontend/src/pages/clicker.vue` | Hide。 |
| 开发者 / 调试 | `packages/frontend/src/pages/api-console.vue`；`packages/frontend/src/pages/scratchpad.vue`；`packages/frontend/src/pages/debug.vue`；registry 相关页面 | Legacy allowed，并从普通导航隐藏。 |
| OAuth / Miauth / auth | `packages/frontend/src/pages/auth.vue`；`packages/frontend/src/pages/miauth.vue`；`packages/frontend/src/pages/oauth.vue` | 仅保持功能基线，不做 Twitter 化。 |
| About / 实例信息 | `packages/frontend/src/pages/about*.vue`；`packages/frontend/src/pages/instance-info.vue` | Phase 2 Compatible。 |
| 公告 | `packages/frontend/src/pages/announcements*.vue` | Phase 2 Compatible，除非运营立即需要。 |
| 通用 404 | `packages/frontend/src/pages/not-found.vue` | 纳入 P-09。 |

## 依赖关系

```text
P-00 App Shell
├── P-01 Home Timeline
├── P-05 Composer
├── P-08 Menus / Dialogs
├── P-09 Shared States
└── P-10 Mobile Layout

P-01 + P-02
├── P-03 Note Detail
├── P-04 User Profile
├── P-07 Search
└── P-15 / P-17 / P-18 扩展项

P-04
├── P-12 Following
└── P-13 Followers

P-05
└── P-08 主路径对话框与菜单

P-00 + P-09
└── P-06 Notifications
```

依赖关系只表示实施前提，不表示排期顺序。排期应由独立计划或任务系统维护。

## 导航入口审计

将本总表转换为实施任务前后，应审计以下入口来源，确认没有可见入口指向未处置的旧样式页面：

```text
packages/frontend/src/router.definition.ts
packages/frontend/src/navbar.ts
packages/frontend/src/utility/get-note-menu.ts
packages/frontend/src/utility/get-user-menu.ts
packages/frontend/src/pages/settings/index.vue
packages/frontend/src/ui/_common_/navbar.vue
packages/frontend/src/ui/_common_/mobile-footer-menu.vue
```

第一阶段可见导航目标必须满足以下之一：

1. 属于必做总表 P-00 ～ P-10；
2. 属于已明确纳入的扩展项；
3. 属于阶段外处置表中的 Hide / Legacy allowed / Compatible 项；
4. 已从公司版导航隐藏。

该规则用于避免用户从 Twitter 风格主路径意外进入未处理的 Misskey 旧样式页面。
