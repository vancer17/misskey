# Twitter UI 移植保真审计（第二轴泄漏）

审计基线：`feature/twitter-ui-profile-settings@156a2e6b55`（P-00～P-15 + R-1～R-4 全部合入后）。

## 定位

[leak-audit.md](./leak-audit.md) 审计的是**第一轴泄漏**（Misskey 旧样式漏进 twitter UI）。本文件审计**第二轴泄漏**：**X-behavior / AI 发明值漏进本应由 nitter 权威的布局与尺度域**。

触发事件：P-11 身份卡在 nitter 存在适用真值（`profile/card.scss` 头像卡惯例）的情况下被实现为 X 式相机角标 + 叠压布局，且容器底色遮蔽了头像图片层（见 #21 fix commit）。该事件暴露的不是孤例，而是三个过程性缺口：

1. **"nitter 无对应物"判定未经源码检索验证**——判定本身没有证据要求；
2. **偏离记录只校验"是否成文"，不校验"成文前提是否成立"**；
3. **值级比对看不见关系级偏差**（叠压、对齐、命中区）。

本审计是 P-19 视觉回归基线的**前置门槛**：A/D 类清零、B 类全部成文后，基线才允许建立，否则偏差会被固化为期望快照。

## 审计方法

### 比对来源

- nitter 侧：`external/app/nitter/src/sass/`（`include/_variables.scss`、`include/_mixins.scss`、`index.scss`、`navbar.scss`、`timeline.scss`、`tweet/{_base,card,quote,poll,media,thread}.scss`、`profile/{_base,card,about-account}.scss`、`search.scss`、`general.scss`、`inputs.scss`）+ `public/css/themes/twitter{,_dark}.css`。
- 实现侧：`ui/twitter/tokens.scss`、`ui/twitter/**`（组件）、页面变体（`pages/Twitter*.vue`、`pages/user/Twitter*.vue`、`pages/{search.note,search.user,notifications}.vue` twitter 分支）、`ui/twitter/overlay.scss`、Mk* 组件 twitter 变体块。

### 三阶段

1. **值级比对**：逐值核对尺寸、间距、字号、行高、圆角、边框、列宽（token 值与组件字面量 ↔ nitter 源值）；
2. **关系级走查**：叠压、对齐、命中区、层级结构——归入走查矩阵人工项，本文件只登记已确认的关系级偏差；
3. **来源标注核验**：所有"X-behavior 来源"标注须附 nitter 检索范围证据。

### 分类定义与判定标记

| 类 | 定义 | 处置 |
| --- | --- | --- |
| **A** | nitter 有对应物，实现用了 X-behavior / 发明值，且无记录 | 修复对齐 nitter，或走 ADR 补记（须给产品理由） |
| **B** | nitter 无对应物（需检索证据），实现取 X-behavior | 补成文记录（ADR / 本文件即可作载体） |
| **C** | 已在 ADR-0001 偏离表或既有 PR 记录内 | 合规，不重审 |
| **D** | 实现级 bug（与设计决策无关的抄写 / 移植错误） | 直接修 |

判定标记：❌ 确认偏差 ｜ ⚠️ 待裁决 / 待复核 ｜ ✅ 合规。

## 一、Token 层（`ui/twitter/tokens.scss`）

| # | 项 | nitter 源值 | 实现值 | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| T-1 | 色板（bg/panel/hover/fg/secondary/border/accent 明暗） | `themes/twitter{,_dark}.css` 精确值 | 精确复刻 ✓ | ✅ | C |
| T-2 | 主列宽 600px | `timeline.scss` `panel(100%, 600px)` | `--twitter-main-width: 600px` | ✅ | C |
| T-3 | 字号阶梯 12/13/14/15/16/18/20/24 | nitter 档位：辅助 12 / 次要 13 / 全名 14 / 正文 15 / 编辑器 16 / 主帖 18 / more-replies 20 | R-4 已落地且注明来源 | ✅ | C |
| T-4 | 间距阶梯 4/8/12/16/32 | nitter 主峰值档 | R-4 已落地，例外值（5/6/10px）保留字面量并注明 | ✅ | C |
| T-5 | **圆角阶梯缺 10px 档** | quote / card / community-note / unavailable-box = **10px**；attachments = 7px；poll = 5px | ~~阶梯仅 4/8/16~~ → PF-1 已补 `--twitter-radius-embed: 10px` | ✅ 已修复 | A→闭合 |
| T-6 | 动效 120/180/240ms | 无对应物（nitter 无动效） | 自定 motion spec，待 X 录屏校准 | ✅ | C（ADR-0001） |
| T-7 | 侧栏 275/72、右栏 350 | nitter 无侧栏（单列 600 / inner-nav 920） | X 信息架构（见 S-1） | ⚠️ | B |
| T-8 | 触控 44 / 底栏 56 / FAB 56 | 无对应物 | X-behavior，P-10 已入 ADR-0001 决策 7 | ✅ | C |

## 二、Shell 与导航（P-00 / P-10）

| # | 项 | nitter 源值 | 实现值（锚点） | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| S-1 | Shell 信息架构 | 顶部横向 navbar（`navbar.scss`：高 50px、font 16px、inner-nav 920px） | 左侧栏三栏 Shell（`ui/twitter.vue`） | ⚠️ | B |
| S-2 | **头部高度体系混用** | navbar / sticky 统一 **50px** | ~~50/53 混用~~ → PF-1 已统一 50px | ✅ 已修复 | A→闭合 |
| S-3 | 头部高度字面量 | 50px | ~~散落字面量~~ → PF-1 已入 `--twitter-header-height` 权威 token（8 处消费点迁移） | ✅ 已修复 | A→闭合 |
| S-4 | 侧栏导航项 52px / 图标 32px / 字 20px | 无对应物（顶部导航） | X-behavior（`Sidebar.vue`） | ⚠️ | B |
| S-5 | 移动底栏 / FAB | 无对应物 | X-behavior，P-10 记录 | ✅ | C |
| S-6 | **pages/ 断点媒体查询残留** | — | ~~5 处媒体查询~~ → PF-1 已全部迁移 `&.mobile` class 驱动（3 文件接入 `useTwitterLayout`） | ✅ 已修复 | A→闭合 |

S-1 裁决建议：三栏 Shell 是 phase-1 P-00 的产品决策（总表原文"三栏桌面 Shell"），本审计不推翻；但应在 ADR 明确边界——**Shell 骨架（列制、侧栏、底栏）= X 信息架构；nitter 权威范围 = 主列内容区（帖子卡、列表、表单、面板）**。此前该边界仅隐含在总表与 PR 描述中。

## 三、帖子卡片（P-02 / R-2）

| # | 项 | nitter 源值（锚点） | 实现值（锚点） | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| N-1 | **卡片头像 44px** | `tweet/_base.scss` `.tweet-avatar img` **48×48** | ~~44×44~~ → PF-1 已修 48×48（移动端 40px 仍按 N-9 待裁决） | ✅ 已修复 | A→闭合 |
| N-2 | 行内边距 | `timeline.scss` `.timeline-item` `0.75em` = **12px 四向一致** | ~~12px 16px~~ → PF-2 裁决**对齐 nitter**：Note / UserResult / ThreadNote 行内距统一 12px 四向 | ✅ 已修复 | A→闭合 |
| N-3 | 正文行高 | `index.scss` body / `tweet-content` **1.3** | ~~1.4~~ → PF-2 裁决**对齐 nitter**：Note / NoteQuote / UserResult / ThreadNote / TwitterHome bio 全部 1.3 | ✅ 已修复 | A→闭合 |
| N-4 | hairline | `timeline.scss` `1px border_grey` | ~~全线 0.5px~~ → PF-2 裁决**对齐 nitter**：twitter 作用域 59 处 `var(--twitter-border)` 边框统一 1px（28 文件；Mk* 基础样式不属 twitter 作用域，未动） | ✅ 已修复 | B→闭合 |
| N-5 | 全名 / 用户名字号 | `.fullname` **14px/700**；`.username` 继承 body **15px**（twitter 主题 `fg_dark=fg_faded`，颜色 ✓） | ~~name 15/acct 14 对调~~ → PF-2 裁决**对齐 nitter**：name=body(14)/700、acct=content(15)（NoteHeader + UserResult） | ✅ 已修复 | A→闭合 |
| N-6 | 转发 / 统计行 | `.retweet-header`/`.tweet-stats` 14px/600/line-height 22px | repost 标签 / 操作栏 13px（`NoteActions`）——操作栏本体无对应物（nitter 只读） | ⚠️ | B（操作栏）+ A（repost 标签字号） |
| N-7 | 回复上下文行 | `.replying-to` fg_faded、margin -2/4 | impl token 化 ✓ | ✅ | C |
| N-8 | **线程连线** | `thread.scss` `.thread-line` **3px accent_dark**（twitter 主题 accent_dark = accent） | ~~2px border 色~~ → PF-1 已修 3px + `--twitter-accent`（Note.vue 与 ThreadNote.vue 两处） | ✅ 已修复 | A→闭合 |
| N-9 | 移动卡片头像 40px | nitter 无移动专项（48px 恒定） | ~~40px~~ → PF-2 裁决**对齐 nitter**：Note / UserResult 移动端头像 48px | ✅ 已修复 | B→闭合 |
| N-10 | 操作栏（reply/repost/like/menu 按钮） | 无对应物 | X-behavior，32/34px 命中 + 44px 纵向命中（P-10） | ✅ | C |
| N-11 | 详情页线程行头像 40px（PF-1 实施中新登记） | thread 行复用 `.tweet-avatar img` **48×48** | ~~40px~~ → PF-2 裁决**对齐 nitter**：ThreadNote（桌面 + 移动）/ NoteDetail mobile 头部 48px | ✅ 已修复 | B→闭合 |

## 四、嵌入件（R-2：quote / card / poll / media）

| # | 项 | nitter 源值（锚点） | 实现值（锚点） | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| E-1 | 引用卡整体 | `quote.scss`：margin-top **10px** ✓、border **1px dark_grey**、radius **10px**、bg_elements；name-row padding **8/10/6/10**、正文 **10px** | `NoteQuote.vue`：margin 10 ✓、radius **10px**（PF-1）、border **1px**（PF-2 N-4 连带）；padding 10/12 属 nitter 实测例外档（4/8/10/12 并存），保留并已注明 | ✅ 已修复 | A→闭合 |
| E-2 | 链接卡 | `card.scss`：border 1px dark_grey、radius **10px** | `MkUrlPreview.vue` twitter 块 radius ~~16px~~ → **PF-1 已修 10px**（含播放器容器） | ✅ radius 已修复 | A→闭合 |
| E-3 | 媒体组 | `media.scss`：attachments radius **7px**、margin-top 0.35em、gallery max **379.5/533px** | `MkMediaList.vue`：radius 8px（ladder 舍入）、gap 4px（≈0.25em ✓）、max 379.5 已注明 ✓ | ⚠️ | B（7→8 舍入补记） |
| E-4 | 投票 | `poll.scss`：meter 高 **26px** ✓、margin **6px 0** ✓、radius **5px**、bar dark_grey / 领先 accent_dark | `MkPoll.vue` twitter 块：26/6 ✓、radius 4px（small）、bar = accent 35% color-mix | ⚠️ | B（4 vs 5、色值 token 派生补记） |
| E-5 | unavailable / community-note | radius 10px、border dark_grey | Misskey 无等价物（帖子删除态走本地终态件） | — | N/A |

## 五、帖子详情（P-03）

| # | 项 | nitter 源值（锚点） | 实现值（锚点） | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| D-1 | 主帖正文字号 | `thread.scss` `.main-tweet .tweet-content` **18px**（≤600px → 16px） | `NoteDetail.vue` `.text` = `--twitter-font-size-title`（18px）✓；移动端是否降 16 待走查 | ⚠️ | 复核项 |
| D-2 | 详情头部高度 | navbar 50px | `NoteDetailShell` 53px（并入 S-2/S-3） | ❌ | A |
| D-3 | 回复排序条 | `reply-sort` padding 8/12、fg_faded、tab 下划线 0.1rem | 排序 UI 为 Misskey 特有扩展，走查复核 | ⚠️ | B |

## 六、用户主页 / 关注列表 / 资料（P-04 / P-12 / P-13 / P-11）

| # | 项 | nitter 源值（锚点） | 实现值（锚点） | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| U-1 | 主页头像叠压 banner | follow 页卡**不叠压**（banner 下缘 4px 后卡身独立，`profile/_base.scss`） | `TwitterHome` 头像 -44px 叠压 banner（X 信息架构） | ⚠️ | B（P-04 PR 有描述，ADR 未汇总） |
| U-2 | **头像 ring 色** | `profile/card.scss` img `border 4px darker_grey` + bg_panel（移动 2px） | `--twitter-bg`（`TwitterHome`、P-11 编辑器） | ⚠️ | B（裁决：补 darker_grey token 或记录 bg 融色理由） |
| U-3 | 主页头像尺寸 | about-account 72px / 卡 mobile 80px / 桌面全宽 | 112px / 移动 80px（X） | ⚠️ | B（并入 U-1 记录） |
| U-4 | banner | 33.34% padding-top = 3:1 ✓、margin-bottom 4px ✓ | 3:1 + max-height 200px（X 上限） | ✅ | C（#21 已修） |
| U-5 | 关注列表行 | `.timeline-item` 12px、`.profile-result` min-height **54**、头像 48、hairline 1px | `UserResult`：48 ✓（P-12）、padding 12 四向（N-2）、hairline 1px（N-4）、min-height ~~60~~ → **54**（PF-2 裁决对齐） | ✅ 已修复 | A→闭合 |
| U-6 | 关注页 IA | banner + 用户卡 + 双 tab | 紧凑返回头 + 双 tab（无用户卡） | ✅ | C（#19 已记录偏离） |
| U-7 | 资料编辑器身份卡 | `profile/card` 惯例：卡身 12px、头像入流 ring、无控件叠压 | #21 fix commit 已还原 ✓ | ✅ | C（留档为方法论案例） |
| U-8 | P-11 次要控件 | nitter 无编辑器（检索范围：views/preferences.nim 为 cookie 偏好表单，不适用） | Mk 控件基础兼容（Core 定义） | ✅ | C（#21 已记录） |

## 七、搜索 / Hashtag（P-07 / P-15）

| # | 项 | nitter 源值（锚点） | 实现值（锚点） | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| H-1 | **搜索框** | `general.scss` `.search-bar`：button 30×30、input font 16、radius 4px | ~~44px pill / title 18px~~ → PF-2 裁决**对齐 nitter**：30px 紧凑条 / radius 4px / panel 底 / 输入 16px（emphasis 档） | ✅ 已修复 | A→闭合 |
| H-2 | 搜索 tabs | `search.nim` Top/Latest/Media/Users + `.tab-item` | 双 tab（Notes/Users）下划线模式 ✓；无 Media/Top（无数据源，#19/#20 范式） | ✅ | C |
| H-3 | hashtag 页 | 复用搜索时间线结构（600px + tab + 行） | `TwitterTag` 壳 + MkNotesTimeline ✓；无 tab 偏离已记录 | ✅ | C（#20） |
| H-4 | 搜索页头部 | 无对应物（nitter 无 sticky 返回头） | 53px（并入 S-2）；`@media 500px`（并入 S-6） | ❌ | A |

## 八、通知 / 状态件 / Composer / 覆盖层（P-06 / P-09 / P-05 / P-08 / R-1 / R-3 / R-4）

| # | 项 | nitter 对应物检索结论 | 实现结论 | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| O-1 | 通知页 / 行 / 图标 | 无（只读查看器，无通知域） | X-behavior（P-06 PR 记录） | ✅ | C |
| O-2 | 骨架屏 / 终态件（P-09） | 无 | X-behavior（ADR-0001 决策 6） | ✅ | C |
| O-3 | Composer 全链（P-05 / R-3） | 无（无发帖能力） | X-behavior（PR 记录）。**产品决策（2026-10-09）**：twitter UI 时间线不设内联发帖表单（X 桌面行为不予采纳，方向与 nitter 一致）；发帖入口 = 桌面侧栏「ノート」按钮 + 移动 FAB；`showFixedPostForm` 偏好开关在 twitter UI 菜单中隐藏（default UI 不受影响） | ✅ 已裁决 | C |
| O-4 | 菜单 / 对话框 / tooltip / emoji 内部（P-08 / R-1 / R-4） | 无（服务端渲染查看器，检索范围：全部 sass/ 无 overlay 体系） | X-behavior token 组（ADR-0001 决策 5） | ✅ | C |
| O-5 | 17px 字面量档 | nitter 无 17px 档位（14/15/16/18/20） | back/标题 icon 17px 散布 5 处（NotificationsHeader / SettingsShell / NoteDetailShell / TwitterTag / TwitterFollowList）——R-4 阶梯外遗留 | ⚠️ | C→收敛候选（ADR-0001 暂缓条款允许，登记待 P-19 后收敛） |

## 九、滚动登记 · P-25 Channels 页（基线后新增实现）

依「审计局限」第 3 条，本节为基线 `156a2e6b55` 之后新增实现（P-25，ADR-0002 决策 D4：Channels 页 Compatible 化，帖子卡频道链接 A5 保留）自带的 nitter 映射表与「无对应物」检索证据。

### 检索证据

- `grep -ril channel external/app/nitter/src/sass/` → **0 命中**（sass 全目录）。
- nitter 为只读 Twitter 镜像，路由 / 视图（views/*.nim）无 Communities / 频道概念；Twitter Communities 在 nitter 中无对应实现。
- 结论：**频道域整体为 nitter 无对应物**，仅下列子结构存在可映射的同构物。

### nitter 映射表

| P-25 实现件 | nitter 对应物 | 采用真值 |
| --- | --- | --- |
| `MkChannelPreview` `.twitter` 变体 | `tweet/card.scss` `.card-container`（结构同构：图 + 标题卡） | border 1px dark_grey、radius 10px（`--twitter-radius-embed`）、bg_elements → `--twitter-panel` |
| `MkChannelPreview` 标题字 | `.card-title` bold **1.1em**（≈16.5px） | → emphasis 16px 档（舍入登记，比照 E-3 范式） |
| 频道详情身份卡（`TwitterChannel` overview） | `profile/card.scss` `.profile-card` / `-fullname` / `.profile-bio` | 卡身 12px、fullname 16px/700、bio 15px 行高 1.3（N-3 既有裁决） |
| 频道详情 banner | `profile/_base.scss` 3:1（U-4 先例） | aspect-ratio 3/1 + max-height 200px |
| 频道时间线（timeline tab） | `timeline.scss`（P-01 既有覆盖） | `MkStreamingNotesTimeline` 既有 twitter 分支，无新增工作 |
| 返回头 / tab 行 / 搜索表单 / 编辑器表单 / follow 按钮 | 无对应物 | X-behavior 表现层 + Misskey IA（B 类登记如下） |

### B 类登记（X-behavior / Misskey IA，成文于本节）

| # | 项 | 处置 |
| --- | --- | --- |
| CH-1 | 列表页 5 tab / 详情页 4 tab 信息架构 | Misskey 特有 IA，Compatible 等级保留；tab 行视觉与 TwitterSearch / S-2 同构（50px、下划线 active） |
| CH-2 | 600px 主列内频道卡网格退化单列 | 沿用 legacy `minmax(360px, 1fr)` 列定义（IA 保留，零发明值）；窄视口行为为派生结果 |
| CH-3 | banner 上统计 / sensitive chip 叠加 | Misskey IA 保留；图上信息用深底白字（与 MkChannelPreview 同构惯例） |
| CH-4 | `MkChannelFollowButton` `.twitter` 变体 | X follow button 语义：未关注 = accent 实心 pill、已关注 = hairline 描边、悬停转危险色 |
| CH-5 | O-3 裁决延伸 | twitter UI 频道时间线不渲染内联表单与 legacy 页脚发帖按钮；发帖入口 = 头部 pencil（`os.post` 带 channel 上下文）；移动 FAB 无频道上下文为已知限制 |
| CH-6 | card-title 1.1em(≈16.5px) → 16px 舍入；preview hover 边框 grey → `--twitter-secondary-fg` 近似派生 | 无独立 grey token，登记待 token 阶梯复审 |
| CH-7 | 列表页 5 tab 窄视口横向滚动 | tab 行 `flex + overflow-x`（TwitterSearch originBar 同构） |
| CH-8 | `MkFoldableSection` / `MkRadios` / `MkInput` / `MkColorInput` / `MkSwitch` / `MkFolder` / `MkDraggable` | Compatible 定义的基础兼容（U-8 范式），不做变体；走查发现问题再补 |
| CH-9 | 频道卡媒体查询断点（550/500px banner 高度收缩） | Mk* 基础样式不属 twitter 作用域（N-4 附注范式），twitter 上下文继承该收缩行为 |
| CH-10 | 侧栏频道入口（`Sidebar.vue` チャンネル 项 → `/channels`，位于 Profile 前） | X-behavior 来源（X Help Center：Communities 为 x.com 侧栏项）；**两点已记录偏离**：① X 仅对已加入 ≥1 Community 的用户显示入口（否则收 More 菜单），此处按"Misskey 频道为实例核心功能 + default UI チャンネル 项常驻"常驻显示，不复刻条件显示逻辑；② 移动端不加底栏项——X 移动端 Communities 亦不在底栏（在抽屉菜单），本项目移动端无抽屉，移动入口待账号菜单/drawer 裁决（归 A7/P-20）。nitter 侧无入口设计可借鉴（导航仅 搜索/RSS/Open in X/About/Preferences，社区页仅 URL 深链），检索证据见本节上文 |
| CH-11 | **频道详情页 Communities IA**（P-26 / ADR-0005 D7；即 ADR-0002 补记所裁事项的落地） | 社区头映射 nitter `views/community.nim` + `profile/card.scss`（banner 3:1、卡身 12px、fullname 16px/700、bio 15/1.3、控件入流 U-7）；**join-gate 与 Home / Explore / About 命名为 X-behavior**（nitter 社区页 tab 为 Top/Latest/Media/About/Members，无按关注态派生的 tab 集合）。数据映射：ホーム = 频道时间线（既有流式）+ 置顶帖；みつける = `notes/featured` + channelId；情報 = 身份卡统计行；検索 = 频道内笔记搜索。Join/Leave 按钮落在页面层回调（`channels/follow`/`unfollow` + 软刷新回填，规范 12），不复用 MkChannelFollowButton（无状态外发信号；组件保留供 legacy 分支使用） |
| CH-12 | **频道列表页 Communities IA**（P-26 / ADR-0005 D1–D4） | 整体 X-behavior（nitter 无 Communities 入口设计）；常驻搜索条为 nitter `general.scss` search-bar 真值（PF-2 H-1 裁决复用）；ホーム = 已关注频道横条（X Communities joined 横条行为）+ `channels/followed-timeline` 聚合流（**新端点**，ADR-0005 B-1）；みつける = 注目频道条（featured 复用）+ 管理/收藏折叠区（P-25 旧列表能力收敛安置，D3）+ `channels/global-timeline` 聚合流（**新端点**，B-2）。搜索类型固定 nameAndDescription（X 行为，legacy 单选保留 default UI）。旧五 tab twitter 变体（TwitterChannels.vue）退役；default UI 不受影响 |

**CH-12 增补登记（P-26 样式走查修复，对齐 X 参照 `/home/vancer17/x.com` + 用户提供的 Home/Discover 目标截图）**：

| # | 修复项 | 登记类 |
| --- | --- | --- |
| CH-12a | 聚合流（列表页 Home/Explore、详情页みつける/検索）补 `withControl="false"`——`MkNotesTimeline` 默认 true 会渲染 Misskey 排序/控制条，X 参照无此控件 | B 类（X 无对应控件；twitter 变体收敛） |
| CH-12b | ホーム关注横条：pill chip（12px 色点 + 名称）→ **圆形标识行**（56px banner 缩略圆，无 banner 回退频道色 + 名称下置） | B 类（X joined 行为；nitter 无对应物） |
| CH-12c | ホーム空关注引导卡：X 冷启动为推荐流，此处**简化为纯 CTA**（文案 + みつける按钮；不复用 featured paginator——同实例双处挂载会引入切 tab 重拉），**已记录偏离**；新增 locale key `_channel.noFollowing`（仅 ja-JP） | B 类（简化偏离登记） |
| CH-12d | みつける注目频道：chip 横条 → **MkChannelPreview 双列卡片网格**（minmax(220px,1fr)；X Discover 双列卡片形态；组件 twitter 变体映射 tweet/card.scss 真值已有）；featured 与关注 paginator 的 MkPagination 内建空态以空 `#empty` 覆写（空列表不渲染 MkResult，由引导卡/无内容接管） | B 类（X Discover 形态）+ 派生行为登记 |
| CH-12e | 管理/收藏折叠区移至みつける流**之后**（Misskey 能力安置，非 X 元素；边线改上缘分隔） | B 类（能力安置登记） |


## 九、右栏固定内容（P-23，滚动登记）

按审计局限 #3 义务，基线后新增实现自带 nitter 映射表与检索证据进入本节。

**"无对应物"检索证据（2026-10-09）**：`external/app/nitter/src/sass/` 全量检索 `trend` / `recommend` / 挂件类关键字，零命中；nitter 为单列只读查看器（主列 600px / inner-nav 920px），无右栏信息架构，亦无趋势 / 推荐关注域。右栏整体落入 S-1 裁决边界的 X 信息架构侧，形制参数成文于 [ADR-0004](./adr/0004-right-rail-fixed-content.md)。

| # | 项 | nitter 对应物检索结论 | 实现结论 | 判定 | 类 |
| --- | --- | --- | --- | --- | --- |
| RR-1 | 右栏信息架构（搜索 + 趋势卡 + 推荐关注卡，移除自配挂件） | 无（见上检索证据） | X-behavior；ADR-0002 决策 D2 + ADR-0004 成文；leak-audit D1 闭合 | ✅ | C |
| RR-2 | 卡容器与标题（panel 底 / radius 16 / 标题 20px 档 / 行内距 8-16、hairline 1px） | 无 | 阶梯内取值（radius-large / heading / space-2~4），无阶梯外新值 | ✅ | C（ADR-0004） |
| RR-3 | 趋势行（tag 15px/700 + 计数 13px secondary；条目 → /tags/:tag） | 无 | N-5 裁决派生字号；`usersCount` 语义保真为「Nユーザー」，不虚构投稿数 | ✅ | C（ADR-0004） |
| RR-4 | 推荐行（头像 40px、name 14/700、acct 15 secondary、无 bio） | 无 | X 右栏紧凑形制（B 类成文）；主列用户行仍为 nitter 权威 48px（U-5），两域并存 | ✅ | C（ADR-0004） |
| RR-5 | 「显示更多」入口 | 无 | **省略**：目标页 explore（P-14）未 Twitter 化，设入口将制造新 A 类路由泄漏；移除条件 = P-14 转正 | ✅ | C（ADR-0004） |
| RR-6 | 数据源降级链（trend 无备源静默收起；recommendation → pinned-users → 收起） | 无 | ADR-0004 §1；右栏不产生错误 / 空态噪声 | ✅ | C（ADR-0004） |

## 汇总

| 类 | 数量 | 明细 |
| --- | --- | --- |
| **A（未记录偏离 / 规则违反）** | ~~11~~ → **0** | 全部闭合：PF-1 修复 T-5、S-2、S-3、S-6、N-1、N-8、E-1、E-2；PF-2 裁决（2026-10-09：**全部对齐 nitter**）修复 N-2、N-3、N-5、H-1、U-5 |
| **B（待成文的 X-behavior）** | ~~12~~ → **8** | N-4、N-9、N-11 已按裁决对齐闭合；剩余 T-7、S-1、S-4、N-6（操作栏）、E-3、E-4、U-1、U-2、U-3、D-3 中，T-7/S-1/S-4/U-1/U-3 属 Shell 信息架构族（PF-3），N-6/E-3/E-4/D-3 为派生色与舍入登记项 |
| **C（已合规 / 已记录）** | 17+ | T-1~T-4、T-6、T-8、S-5、N-7、N-10、D-1（待走查）、U-4、U-6、U-7、U-8、H-2、H-3、O-1~O-5、RR-1~RR-6（P-23 滚动登记，2026-10-09） |
| **D（实现级 bug，已修复留档）** | 2 | UserResult 头像 44（P-12 批次修复）；P-11 相机角标 + 叠压 + 容器底色（#21 fix） |

## 修复批次建议

| 批次 | 内容 | 性质 |
| --- | --- | --- |
| **PF-1 值级对齐（机械修，无需裁决）** | ~~待实施~~ → **已实施（2026-10-09）**：N-1 头像 48；N-8 连线 3px+accent；T-5/E-1/E-2 `--twitter-radius-embed: 10px`；S-2/S-3 `--twitter-header-height`（8 处消费点 + TwitterSearch tab 53→50 孤值对齐）；S-6 三文件断点迁移 `&.mobile`；实施中新增发现 N-11（线程行头像 40px，并入 N-9 裁决） | 已完成，待提交 |
| **PF-2 裁决项（产品决策前置）** | ~~待裁决~~ → **已裁决并实施（2026-10-09：全部对齐 nitter）**：N-2 行内距 12 四向；N-3 行高 1.3；N-4 hairline 1px（59 处）；N-5 name 14/acct 15；H-1 搜索条 30px/4px/16px；U-5 min-height 54；N-9/N-11 头像恒 48px（含移动端） | 已完成 |
| **PF-3 ADR 汇总补记** | S-1 Shell 骨架边界声明（X 信息架构 vs nitter 内容区权威范围）；U-1/U-2/U-3 主页头像体系；S-4/N-9 移动与侧栏 X 度量；N-6/E-3/E-4 派生色与舍入 | ADR-0001 偏离表扩充或新开 ADR-0004。**右栏部分已由 ADR-0004 成文（2026-10-09，随 P-23）**；Shell 骨架边界声明与主页头像体系仍待成文 |

## 出口条件（P-19 门槛）

1. PF-1 全部合入；
2. PF-2 每项完成裁决（对齐或成文）；
3. PF-3 成文合入；
4. 关系级走查矩阵（页面 × 交互 × 视口 × 明暗）通过，重点覆盖本文件 ⚠️ 项；
5. 之后方可建立 P-19 视觉回归基线。

## 审计局限

1. 本审计为**样式层值级 + 已确认关系级**审计；未覆盖的运行时关系（滚动行为、焦点顺序、命中区实际尺寸）依赖走查矩阵；
2. R-1 覆盖层组件族未逐值审计（nitter 无对应物，仅核对了成文性与 ADR-0001 决策 5 的覆盖范围）；
3. 基线 `156a2e6b55` 之后的新增实现（P-23 / P-25 / P-20）不在此列，**必须自带 nitter 映射表 + "无对应物"检索证据**进入本文件滚动登记。
