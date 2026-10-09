# Twitter UI 第二阶段页面总表

本文档只维护第二阶段 Twitter 风格 UI 的范围、路由、当前代码锚点、处理等级和依赖关系。阶段目标、实施排期、进度状态和验收细节不在本文档维护；泄漏明细见 [leak-audit.md](./leak-audit.md)，产品决策见 [ADR-0002](./adr/0002-product-decisions-leak-remediation.md)。

## 阶段定位与出口

- **目标**：默认 rollout 就绪——泄漏清零、扩展页面转正、验收基建落地。
- **出口**：P-22（走查矩阵复审 + rollout 评估）通过；评估结论与默认 UI 切换决策另行记入 ADR-0003。
- **开工门槛（G0）**：develop 全量校验（`pnpm build` + 全量 lint）。第一阶段清单要求的导航入口审计已由泄漏审计 A 类覆盖，不再单列。

## 字段约定

页面分类与处理等级沿用 [第一阶段总表](./phase-1-page-inventory.md) 定义（必做 / 扩展 / 阶段外；Full / Core / Compatible / Legacy allowed / Hide）。本阶段另含 **R 系列（组件级修复项）**：来自泄漏审计的跨页面修复批次，不对应单一页面，等级含义为其覆盖组件的既有处理等级。

## 必做组件修复总表（R 系列）

| ID | 范围 | 当前代码锚点 | 架构路径 | 来源 |
| --- | --- | --- | --- | --- |
| **R-1** | 交互选择器/窗口与启动弹窗、Shell 系统层：VisibilityPicker、UserSelect、DriveFileSelect、AbuseReport、UserSetup（决策 D1：保留弹出）、Updated、Announcement×2、Donation（决策 D3：保留）、SourceCodeAvailable、systemChrome 五件 | `MkVisibilityPicker.vue`；`MkUserSelectDialog.vue`；`MkDriveFileSelectDialog.vue`；`MkAbuseReportWindow.vue`；`MkUserSetupDialog.vue`；`MkUpdated.vue`；`MkAnnouncementDialog.vue`；`MkDonation.vue`；`MkSourceCodeAvailablePopup.vue`；`ui/_common_/{announcements,statusbars,ReloadSuggestion,PreferenceRestore,ThemePreviewing}.vue` | P-08 三层模式（useIsTwitterUi 变体 + overlay.scss） | 审计 C5-C8 / B1-B5 / D4 |
| **R-2** | 帖子卡片内容内嵌件：投票、链接卡、CW、反应条、远程实例条、媒体网格 | `MkPoll.vue`；`MkUrlPreview.vue`；`MkCwButton.vue`；`MkReactionsViewer.vue`；`MkInstanceTicker.vue`；`MkMediaList.vue` | 组件变体 | 审计 D3 |
| **R-3** | 发帖表单内嵌件：上传列表、预览、投票编辑、简化帖、信息条、涟漪 | `MkUploaderItems.vue`；`MkNotePreview.vue`；`MkPollEditor.vue`；`MkNoteSimple.vue`；`MkInfo.vue`；`MkRippleEffect.vue` | 组件变体（Ripple 在 twitter 上下文禁用或替换） | 审计 D2 |
| **R-4** | 动效与尺度债务：MkModal 过渡校准、涟漪、Tooltip 时长、emoji 选择器内部、字号/间距阶梯收敛 | `MkModal.vue`；`MkTooltip.vue`；`MkEmojiPickerDialog.vue` 内部；各组件字面量字号 | motion token / 阶梯收敛 | 审计 E1/E2/E4/C4 + ADR-0001 暂缓项 |

## 第二阶段必做总表（P 系列）

| ID | 页面 / 界面 | 路由 / 范围 | 当前代码锚点 | 等级 | 依赖 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| **P-12** | 正在关注列表 | `/@:acct/following` | `pages/user/following.vue`；`pages/user/follow-list.vue` | Full | P-04 ✅ | 泄漏 A1 转正；与 P-13 共享锚点，宜同 PR |
| **P-13** | 关注者列表 | `/@:acct/followers` | `pages/user/followers.vue`；`pages/user/follow-list.vue` | Full | P-04 ✅ | 泄漏 A2 转正 |
| **P-15** | Hashtag 结果页 | `/tags/:tag` | `pages/tag.vue` | Full | P-07 ✅ | 泄漏 A3 转正；消费 P-09 状态件 |
| **P-11** | 个人资料设置 | `/settings/profile` | `pages/settings/profile.vue` | Core | P-00 ✅ | 泄漏 A4 转正 |
| **P-23** | 右栏固定内容：趋势 + 推荐关注 | RightRail 整体替换 | `ui/twitter/RightRail.vue`（移除 widgets 挂载）；新增 `ui/twitter/components/TwitterTrending.vue`、`TwitterWhoToFollow.vue`；数据源 `hashtags/trend`、`users/recommendation` | 新功能件 | 决策 D2；R-1 | `MkWidgets` 本体不动（其他 UI 继续使用）；推荐数据源实现前先 spike，fallback：meta.pinnedUsers / explore featured；权威类型入 `ui/twitter/domain/` |
| **P-25** | Channels 页 | `/channels`、`/channels/:id` | `pages/channels.vue`；`pages/channel.vue`；`pages/channel-editor.vue` | Compatible | 决策 D4；P-00 ✅ | 修正第一阶段"Hide/延后"处置；帖子卡频道链接（A5）保留 |
| **P-20** | Compatible 面：设置首页、About、公告、Drive | `/settings`、`/about*`、`/announcements*`、`/drive*` | `pages/settings/*`；`pages/about*.vue`；`pages/announcements.vue`、`announcement.vue`；`pages/drive*.vue` | Compatible | P-00 ✅ | 复用 Shell/Token/header/按钮，不重做信息架构；含审计 A6（`/notes/:id/reactions` 为 note.vue 的 `initialTab` 标签，作详情页标签复核而非独立页面） |
| **P-19** | 视觉回归 + 验收测试基线 | Playwright 截图基线（页面 × 视口 × 明暗） | 新增测试基建 | 基建 | R-1~R-4、P-11~P-25 全部完成 + 走查复核通过 | **位置后置**：在泄漏清零前建基线会把泄漏固化为期望快照 |
| **P-22** | 走查矩阵复审 + rollout 评估 | 审计走查矩阵（页面 × 交互 × 视口 × 主题） | — | 出口 | P-19 | 评估结论与默认 UI 切换决策 → ADR-0003 |

## 不纳入项（维持既有裁决）

| 项 | 裁决 | 依据 |
| --- | --- | --- |
| P-14 Explore | 不纳入（导航无入口） | 第一阶段清单纳入条件未触发 |
| P-16 user-tags | 不纳入，待产品确认 | 同上 |
| P-17 favorites / P-18 lists | 不纳入（无可见入口） | 同上 |
| 其余阶段外路由（Chat/Gallery/Pages/Play/Clips/Games/Admin 等） | 沿用第一阶段处置表 | [phase-1-page-inventory.md](./phase-1-page-inventory.md) |

## 依赖关系

```text
G0 develop 全量校验
└── 修复主线（可与页面线并行）
    ├── R-1 选择器/弹窗/系统层
    ├── R-2 帖子卡内嵌件
    └── R-3 发帖内嵌件
└── 页面线
    ├── P-12 + P-13（同 PR）
    ├── P-15
    ├── P-11
    ├── P-23（依赖 R-1；spike → 组件 → Shell 替换）
    └── P-25 / P-20（Compatible 面）
└── R-4 动效与阶梯债务（收尾打磨）
└── 走查矩阵复核
    └── P-19 视觉回归基线
        └── P-22 rollout 评估 → ADR-0003
```

依赖只表示实施前提，不表示排期顺序。

## 验收约定

1. 每项合并前：`check-shipping` 全 PASS + 对应走查点；
2. P-19 建立前：[port-fidelity-audit.md](./port-fidelity-audit.md) 的 A/D 类清零、B 类全部成文（第二轴泄漏不固化进基线）；
3. P-19 建立后：所有后续变更追加视觉回归 diff 为零（或显式说明期望变更）；
4. 走查矩阵复核范围：页面（时间线/详情/主页/通知/搜索/404/新增页）× 交互（浏览/发帖全工具链/回复/引用/菜单/选择器/举报/设置入口）× 视口（桌面 / ≤500px）× 主题（明/暗）。

## 与第一阶段的衔接

- R 系列映射 [leak-audit.md](./leak-audit.md) 修复批次 1-3 与批次 6；
- P-23 / P-25 来源于 [ADR-0002](./adr/0002-product-decisions-leak-remediation.md) 决策 D2 / D4；
- Token 与架构契约（ADR-0001）继续作为全部第二阶段实现的唯一地基。
