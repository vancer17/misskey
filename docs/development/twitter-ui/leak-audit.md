# Twitter UI 第一阶段泄漏点全量审计

审计基线：`develop@a8804fcddc`（P-00～P-10 全部合并后）。本审计先于视觉回归基线执行——基线必须建立在"无已知泄漏"的状态上，否则会把泄漏固化为期望快照。

## 审计方法

### twitter 可达文件集

- `packages/frontend/src/ui/twitter/**` 与 `ui/twitter.vue`（Shell）
- 含 `isTwitterUi / useIsTwitterUi / variant=twitter` 分支的页面：`timeline / notifications / note / not-found / search(.note/.user) / user/index / TwitterHome / TwitterUserTimeline`
- 上述路径消费的共享组件（MkPostForm、MkStreaming*、MkPagination、get-*-menu 等）与经 `os.popup` 家族打开的一切组件

### 五类泄漏面

A 路由级 / B 启动与全局弹窗链 / C 交互子层弹窗 / D 嵌入式 Misskey 组件 / E 动效

### 判定标记

✅ 已覆盖 ｜ ❌ 泄漏 ｜ ⚠️ 部分适配或待复核 ｜ ❓ 产品决策前置

## A. 路由级泄漏（twitter 可达链接 → 旧样式页面）

| # | 目标路由 | 锚点 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| A1 | `/@:acct/following` | `TwitterHome.vue:136` follow 计数 | ❌ | P-12（Phase 2 必做，已识别） |
| A2 | `/@:acct/followers` | `TwitterHome.vue:140` | ❌ | P-13（同上） |
| A3 | `/tags/:tag` | 帖子正文 MFM hashtag 链接 | ❌ | P-15（已识别） |
| A4 | `/settings/profile` | TwitterHome「编辑资料」 | ❌ | P-11（已识别） |
| A5 | `/channels/:id` | `Note.vue` 频道链接 | ❌ **新发现** | 阶段外处置冲突：清单判 Channels=Hide/延后，但卡片仍有直连链接 → ❓隐藏链接或 Compatible |
| A6 | `/notes/:id/reactions` | `Note.vue:230` 反应「更多」 | ❌ **新发现** | Compatible 化（反应列表页未 Twitter 化） |
| A7 | Sidebar 账户菜单项 → settings 等 | `Sidebar.vue` popupMenu（菜单本体✅） | ⚠️ | 菜单项目标逐一对照 P-20 Compatible 面，人工走查复核 |
| A8 | `/tags/:tag`（Twitter 简介标签入口） | `TwitterHome.vue`；`ui/twitter/UserResult.vue`；`TwitterChannel.vue` 的头部和“关于”页简介 | ✅ 代码入口已覆盖 | 三个业务组件通过 MFM 公开参数 `isNote=true` 统一进入 P-15；共享用户结果行覆盖搜索、关注／粉丝列表及二维码用户结果。P-16 仍不纳入；运行验收独立记录，决策见 [ADR-0023](./adr/0023-description-hashtag-navigation.md)。 |
| A9 | `/my/achievements`（成就通知） | `ui/twitter/NotificationRow.vue` → `pages/achievements.vue` → `TwitterAchievementsShell.vue` + `achievements/` | ✅ 代码表现已覆盖 | P-20 Compatible：原路由选择 Twitter 返回头与滚动壳，本人成就业务容器消费唯一 Store 并呈现单列分隔列表。目录、徽章和文案共源，成功申领／缓存回访更新事实，通知已读后对账角标；运行验收见 [同步契约](./achievement-notification-sync.md)，决策见 [ADR-0025](./adr/0025-achievement-notification-sync.md)。 |

## B. 启动与全局弹窗链（boot 期 `os.popup`，全部无 twitter 变体）

| # | 组件 | 锚点 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| B1 | MkUserSetupDialog（**用户报告的初始设定弹窗**） | `main-boot.ts:106` | ❌ | ❓产品决策：Compatible 化，或 twitter UI 下不弹 |
| B2 | MkUpdated（更新提示） | `main-boot.ts:71` | ❌ | Compatible（MkModal/MkDialog 变体可大范围覆盖） |
| B3 | MkAnnouncementDialog ×2（信息/情绪公告） | `main-boot.ts:113,123` | ❌ | ❓产品决策：公告为运营需求，建议 Compatible |
| B4 | MkDonation（捐赠） | `main-boot.ts:284` | ❌ | Compatible 或 Hide（公司版可关） |
| B5 | MkSourceCodeAvailablePopup | `main-boot.ts:292` | ❌ | Compatible |

## C. 交互子层弹窗（主路径交互打开的选择器/窗口）

| # | 组件 | 触发链 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| C1 | MkMenu 全家族（note/user/repost/context/页面菜单） | 各 `os.popupMenu` | ✅ | P-08 已变体 |
| C2 | MkDialog（alert/confirm/input/select） | `os.alert/confirm` | ✅ | P-08 已变体 |
| C3 | MkTooltip | `v-tooltip` | ✅ | P-08 已变体（时长留白→E4） |
| C4 | MkEmojiPickerDialog | reaction-picker / 发帖 emoji | ⚠️ | 外铬✅；**内部结构**（搜索框/网格）留白 → 批次6 |
| C5 | MkVisibilityPicker（**用户报告**） | MkPostForm `setVisibility:669` | ❌ | 组件变体 |
| C6 | MkUserSelectDialog（**用户报告：提及**） | `os.selectUser`（`os.ts:557`） | ❌ | 组件变体 |
| C7 | MkDriveFileSelectDialog（**用户报告：从网盘添加**） | `chooseDriveFile`（`utility/drive.ts:180`） | ❌ | 组件变体；同文件 `chooseFileFromUrl` 链上的 inputText/alert 已被 C2 覆盖 |
| C8 | MkAbuseReportWindow（举报窗口） | `get-note-menu.ts:147` | ❌ | 组件变体（低频但主路径菜单可达） |
| C9 | MkPostFormDialog（os.post） | ComposeFab / Sidebar | ⚠️ | P-05 部分适配（7 处 twitter 引用），人工走查复核 |
| C10 | MkFormDialog（os.form 族） | 部分设置流 | ❓ | twitter 路径是否可达待复核；可达则变体 |
| C11 | SchedulePostDialog | 定时发帖 | ✅ | 自有 Twitter 组件 |

## D. 嵌入式 Misskey 组件区

| # | 区域 | 组件 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| D1 | **右栏挂件系统（用户报告：时间、统计列表）** | `RightRail.vue` → `_common_/widgets.vue` → `MkWidgets` 全家：WidgetClock、server-metric、WidgetInstanceInfo、WidgetInstanceCloud、WidgetMemo、WidgetActivity.calendar…＋「编辑挂件」`_textButton` | ~~❌~~ → ✅（P-23 落地，2026-10-09） | 决策 D2：改为 X 式**固定右栏内容**（趋势 + 推荐关注）；widgets 挂载已从 `RightRail.vue` 移除，形制与数据源成文见 ADR-0004、保真登记见 port-fidelity-audit RR-1~RR-6 |
| D2 | 发帖表单内嵌 | MkUploaderItems、MkNotePreview、MkPollEditor、MkNoteSimple、MkInfo（部分已 twitterNotice）、MkRippleEffect | ❌ | 组件变体（批次3） |
| D3 | 帖子卡片内容内嵌 | MkPoll、MkUrlPreview、MkCwButton、MkReactionsViewer、MkInstanceTicker、MkMediaList | ❌ | 组件变体（批次2；MkNoteMediaGrid 在 P-02 清单锚点中但 PR 未触及） |
| D4 | Shell systemChrome | XAnnouncements、XStatusBars、XReloadSuggestion、XPreferenceRestore、XThemePreviewing | ❌ | Compatible 化或按需 Hide（批次1） |
| D5 | 通知/用户卡内嵌 | MkUserCardMini | ❌ | 组件变体或换 Twitter 行组件 |
| D6 | 关注按钮 | MkFollowButton（P-04 改 35 行） | ⚠️ | 部分适配，人工走查复核 |

## E. 动效泄漏

| # | 项 | 锚点 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| E1 | MkModal 过渡体系（modal / modal-popup / modal-drawer 曲线与时长） | `MkModal.vue:10-30` | ⚠️ | X 动效（fade+scale）校准 → 批次6（motion token 已备） |
| E2 | MkRippleEffect（涟漪，非 X 交互语言） | 多处嵌入 | ⚠️ | twitter 上下文禁用或替换 |
| E3 | `_transition_zoom` 等全局过渡类 | MkResult 等 | ⚠️ | twitter 分支未使用（当前无泄漏面），新页面注意 |
| E4 | Tooltip 200ms 硬编码 | `MkTooltip.vue` | ⚠️ | P-08 留白 → 批次6 |

## 汇总

| 判定 | 数量 | 明细 |
| --- | --- | --- |
| ❌ 确认泄漏 | 20 | A1-A6、B1-B5、C5-C8、D1-D5 |
| ⚠️ 部分/待复核 | 8 | A7、C4、C9、D6、E1-E4 |
| ❓ 产品决策前置 | 0（原 4 项，已全部裁决，见文末决策记录与 [ADR-0002](./adr/0002-product-decisions-leak-remediation.md)） | B1 / B3 / B4 / D1 / A5 |
| ✅ 已覆盖 | 7 | A8（代码入口）、A9（代码表现）、C1-C3、C11、E3（现状无面） |

## 修复批次建议

| 批次 | 内容 | 架构路径 |
| --- | --- | --- |
| 1 | C5-C8 四个选择器/窗口 + B1-B5 全部启动弹窗（决策 1/3：保留并 Compatible 化）+ D4 systemChrome | P-08 三层模式复用（useIsTwitterUi 变体 + overlay.scss） |
| 2 | D3 帖子卡内嵌件六件 | 组件变体 |
| 3 | D2 发帖内嵌件 | 组件变体 |
| 4 | A1-A4（=P-11/12/13/15 转正）+ A6 reactions + A9 成就页（P-20 Compatible） | 第二阶段必做主体 |
| 5 | ~~D1 右栏固定内容改造（决策 2：趋势 / 推荐关注，新建功能）~~ → **已完成（P-23，2026-10-09）** | 独立功能开发 |
| 6 | E1/E2/E4 + C4 emoji 内部 + 字号/间距阶梯（P-21 债务） | motion token / 阶梯收敛 |

批次 1-3 完成后执行人工走查矩阵复核；全部修复 + 复核通过后，方可建立视觉回归基线。

## 人工走查矩阵（修复后复核用）

页面（时间线/详情/主页/通知/搜索/404）× 交互（浏览/发帖全工具链/回复/引用/菜单/选择器/举报/设置入口）× 视口（桌面 / ≤500px）× 主题（明/暗）。

A8 的运行复核覆盖个人简介、搜索／关注／粉丝／二维码的共享用户结果行、频道头部和“关于”页：点击标签后进入编码后的 `/tags/:tag`，展示匹配帖子或帖子空态，返回导航和键盘激活可用；默认 Misskey 简介仍进入 `/user-tags/:tag`。真实后端集成结果和截图 diff 由实际验证记录提供，表内的代码覆盖不代表这些验证已经通过，也不替代 P-19 正式视觉基线。

A9 的运行复核覆盖真实成就申领与通知、点击和键盘进入、直接访问与刷新、返回通知页及滚动恢复；检查成就目录顺序、名称、日期、说明、锁定占位和隐藏成就交互，保留原页三分钟计时与离页清理。视觉复核覆盖桌面、390px、320px和明暗主题，关注主列滚动、safe area、横向溢出、旧面板与网格残留；成就页逐项审阅期望变化，通知页与默认 Misskey 页面作为不变对照。本人成就 Store 在加载失败时保留最后成功列表并提供显式重试；缓存回访与恢复可见后重新确认。同步复核必须在相同裸路径建立缓存，并覆盖实时／非实时模式的当前页解锁、角标对账、传输失败与迟到响应。真实后端结果与截图 diff 由实际验证记录提供，不替代 P-19 正式视觉基线。

## 产品决策记录（2026-10-08 已裁决）

1. **B1 初始设定向导**：twitter UI 场景内**继续弹出**，做 Compatible 化 → 并入批次 1。
2. **D1 右栏**：**不再保留** Misskey 自配挂件系统，改为 Twitter 式**固定内容**（趋势 / 推荐关注）→ 批次 5 独立功能开发。
3. **B3/B4 公告与捐赠弹窗**：**保留**，改为 twitter 风格 → 并入批次 1。
4. **A5 频道链接**：**保留链接**，Channels 页做 Compatible 化 → 并入批次 4。
