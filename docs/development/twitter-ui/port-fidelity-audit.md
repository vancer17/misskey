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

### 侧栏内部空间登记（2026-10-22）

本项只登记 `Sidebar.vue` 的当前内部呈现，不替代 T-7／S-1 对整个 Shell 的来源汇总。Nitter `navbar.scss` 是顶部横向导航，不提供左侧纵向主导航或发帖入口；因此这一局部采用本地 X 归档补充。当前契约见 [主滚动布局](./scroll-layout.md)，选择依据与历史替代见 [ADR-0021](./adr/0021-sidebar-capsules-and-community-tab-indicator.md)。

| 当前实现件 | 来源锚点 | 当前映射 |
| --- | --- | --- |
| 侧栏根节点与发帖按钮 | X `loader.SideNav.abc2a60017aefc0ea.js` 模块 `634040` 的 `rootPaddingNormal`／`button` | 根横向内距 `8px`；完整侧栏按钮占内宽 `90%` 并沿起点对齐；图标模式继续使用既有 `52px` 控件 |
| 导航命中区与视觉胶囊 | X `sharedbundle.Composebundle.ComposeGrokMediabundle.ComposeMediabundle.Delegatebundle.Grokbundle.Payments.517af20de8a4bcaaa.js` 模块 `829598` 的外层 `vertical` 与内层 `base`／`vertical` | 整行链接包含受最大宽度约束的内容胶囊；胶囊承接悬停、选中和焦点反馈，图标／字号／内距仍消费现有 Token |

上述文件均位于本地 `tmp/community_for_x/abs.twimg.com/responsive-web/client-web/`。归档源码能证明结构与默认样式，不代替完整导航的运行时像素测量；`275px`／`72px`／`600px`／`350px` 仍按既有布局契约消费。

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

频道入口当前契约见 [频道入口布局与请求边界](./communities-layout.md)。[ADR-0005](./adr/0005-communities-ia-convergence.md) 记录聚合数据源与详情页决策；[ADR-0015](./adr/0015-community-strip-layout.md) 记录横条参数与窗口选择，[ADR-0017](./adr/0017-community-home-strip-and-column-dialog.md) 明确首页专属横条及管理窗口主列居中。

### 检索证据与来源范围

- `external/app/nitter/src/views/community.nim` 的 `renderCommunity` 实现**单个社区详情页**，包含 banner、名称、分类、描述和成员数；因此“nitter 无 Communities／频道域”不能作为检索结论。
- 对应社区路由与视图未提供同本项目 `/channels` 相同的 Home／Explore 聚合入口。入口采用 X 行为与 Misskey 数据映射，社区详情继续消费 Nitter 的适用结构。
- X 入口参考为 `tmp/community_for_x` 的 Communities bundle 模块 `119474`、主主题脚本及用户截图。归档 HTML 为失败状态；脚本默认参数能作为尺度依据，不能充当成功 DOM 的像素测量。完整锚点见 ADR-0015。

### 来源映射表

| 当前实现件 | 适用来源 | 采用真值 |
| --- | --- | --- |
| 首页／发现标签与选中指示条 | Nitter `timeline.scss` 的 `.tab-item` 等分和单元下划线；现行 `TimelineHeader`／`TwitterSearch` | 两列等分，指示条逻辑两侧各内缩 `--twitter-space-3`（`12px`），宽度随按钮变化；`4px` 高度、颜色与圆角沿用现有 Token；来源选择见 ADR-0021 |
| `TwitterCommunityStrip` 横幅卡片 | X 归档 Communities `119474`：`eE.container`／`eE.name`／`eM`，主脚本主题 | 卡宽 `36×3+24=132px`、banner `2.5:1`、圆角 `12px`、边框 `1px`、名称内距 `8px`；通过 `--twitter-community-*` 与既有 Token 消费 |
| 横条配色与通用间距 | Nitter `themes/twitter{,_dark}.css`、既有 Token 阶梯 | 背景／文字／边框继承 `--twitter-*`；横条内距与可见卡间距 `16px` |
| 搜索结果 `MkChannelPreview` `.twitter` 变体 | Nitter `tweet/card.scss` `.card-container`（图与标题同构） | border `1px`、radius `10px`（`--twitter-radius-embed`）、`--twitter-panel` |
| 搜索结果预览卡标题 | Nitter `.card-title` bold `1.1em`（约 `16.5px`） | emphasis `16px` 档；舍入登记见 CH-6 |
| 频道详情社区头 | Nitter `views/community.nim`、`profile/card.scss` | 卡身 `12px`、fullname `16px/700`、bio `15px/1.3`，控件入流 |
| 频道详情 banner | Nitter `profile/_base.scss`（U-4 先例） | `aspect-ratio: 3/1`、`max-height: 200px` |
| 频道帖子流 | Nitter `timeline.scss`（P-01 既有覆盖） | 继续使用既有 Twitter 帖卡与分页／流式组件 |
| 入口标题搜索、管理窗口、加入按钮与编辑表单 | X-behavior／Misskey IA | 按下表登记；复用既有 `Mk*` 业务逻辑 |

### B 类登记（X-behavior／Misskey IA，当前契约）

| # | 项 | 处置 |
| --- | --- | --- |
| CH-1 | 列表页 Home／Explore 双标签 | 标题栏与主标签吸顶；标签支持方向键、Home／End 与正确的 ARIA 关联；详情页按关注态派生标签，见 CH-11 |
| CH-2 | 600px 主列内频道导航 | 仅首页以单行横幅卡片位于帖子流上方；原生横向滚动、吸附、触摸／键盘、RTL 与可用方向箭头；关注集合保留游标分页 |
| CH-3 | 统计／敏感内容／管理员标记 | 沿用频道详情及原有搜索预览卡的业务呈现；紧凑主横条只保留横幅与名称 |
| CH-4 | 关注按钮 | `MkChannelFollowButton` 的原 Twitter 变体继续保留；详情页 Join／Leave 使用页面回调，见 CH-11 |
| CH-5 | O-3 裁决延伸 | Twitter 频道时间线不渲染内联表单与 legacy 页脚发帖按钮；详情头部 pencil 使用带频道上下文的 `os.post`；移动 FAB 无频道上下文为已知限制 |
| CH-6 | 预览卡标题舍入与 hover 边框 | 搜索预览卡的 `1.1em`（约 `16.5px`）映射到 `16px`；hover 边框沿用 `--twitter-secondary-fg` 近似派生，待 Token 阶梯复审 |
| CH-7 | 顶部搜索 | 搜索图标位于标题栏末端，展开后输入位于同一标题盒内；提交频道实体搜索、关闭后恢复主标签；类型固定 `nameAndDescription` |
| CH-8 | 基础组件边界 | 管理窗口包装 `MkModalWindow`，分页和帖子继续使用 `MkPagination`／`MkNotesTimeline`；编辑器沿用原表单组件，其内部业务逻辑保持既有机制 |
| CH-9 | 预览卡响应式边界 | 搜索结果继续继承原 `MkChannelPreview` 的媒体查询；主横条使用固定宽卡片与容器溢出，不借用大预览卡断点 |
| CH-10 | 侧栏频道入口（`Sidebar.vue` → `/channels`） | 桌面频道入口常驻，属于 Misskey 实例能力的显式选择；移动底栏不新增频道项。Nitter 的单社区深链没有提供本入口的导航设计 |
| CH-11 | 频道详情 Communities IA（ADR-0005 D7） | 社区头映射 Nitter `views/community.nim` + `profile/card.scss`；join-gate 与 Home／Explore／About 为 X-behavior。Home 使用频道流及置顶帖，Explore 使用 `notes/featured` + `channelId`，About 展示身份统计，Search 为频道内笔记搜索；Join／Leave 经页面 `channels/follow`／`unfollow` 回填 |
| CH-12 | 频道列表 Communities IA（ADR-0017） | Home 为关注横条 + `channels/followed-timeline`；Explore 直接展示 `channels/global-timeline`。管理／收藏由头部菜单打开独立窗口，移动端继承抽屉。入口数据源均为现有端点；默认 UI 继续原机制 |

### CH-12 展示与生命周期登记

| # | 当前行为 | 登记类 |
| --- | --- | --- |
| CH-12a | 聚合流继续 `withControl=false`，不额外显示排序／控制条 | B 类（X 入口内容层级） |
| CH-12b | 首页关注横条卡宽 `132px`、横幅 `2.5:1`、圆角 `12px`；发现仅显示全频道帖子，X 主题入口没有对应的分类数据源 | B 类（归档参数与适配边界） |
| CH-12c | 关注加载、失败、成功空集合分别处理；成功空关注只显示发现引导，关注非空后才展示首页帖子空态。发现不创建推荐横条消费者 | D 类空态协调修复；业务冷启动简化见 ADR-0015 |
| CH-12d | `channels.vue` 负责 Twitter 主面板、搜索及资料库唯一首拉；展示组件 `autoLoad=false`。初始化集合仅表达请求生命周期，既有回访刷新按实际面板可见性执行 | D 类请求生命周期修复；不复制分页器业务事实 |
| CH-12e | 我的频道／收藏各自使用独立业务窗口；我的频道在桌面水平对齐主列，收藏维持视口居中，手机沿用抽屉；窗口内显示集合专用空态和重试；创建入口复用既有权限及路由 | B 类（Misskey 能力安置） |

类型检查、真实后端集成与视觉采样的具体结果随交付记录保存；本节的来源映射不代替验证结果。


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
