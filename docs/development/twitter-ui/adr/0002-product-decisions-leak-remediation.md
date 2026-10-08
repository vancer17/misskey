# ADR-0002：泄漏修复的四项产品决策

## 状态

已采纳（2026-10-08，项目所有者裁决；裁决原文同步记录于 [leak-audit.md](../leak-audit.md) 决策记录节）

## 背景

第一阶段合并（develop@a8804fcddc）后的全量泄漏审计确认 20 项泄漏，其中 4 项无法由工程侧单方决定处置方案，提交项目所有者裁决。

## 决策

### D1：初始设定向导（B1）

twitter UI 下 `MkUserSetupDialog` **继续弹出**，按 Compatible 等级改造外观（复用 Shell / Token / 覆盖层变体，不重做向导信息架构）。并入修复批次 1。

### D2：右栏（D1）

**移除** Misskey 自配挂件系统（含编辑入口），右栏改为 Twitter 式**固定内容**：趋势（Trending）与推荐关注（Who to follow）。

范围影响：从"样式修复"升级为**新功能件**——需新增 TwitterTrending / TwitterWhoToFollow 组件与数据源接入（候选：`hashtags/trend`、用户推荐类 API），并从 Shell 移除 widgets 挂载。列为第二阶段必做 **P-23**。

### D3：公告 / 捐赠弹窗（B3/B4）

**保留**（运营与项目支持通道），外观改为 twitter 风格。并入修复批次 1。

### D4：频道链接（A5）

帖子卡片频道链接**保留**；Channels 页按 Compatible 等级纳入第二阶段（修正第一阶段清单中 Channels"Hide/延后"的处置）。列为第二阶段必做 **P-25**。

## 对第二阶段必做集合的影响

在既有设计（P-19 验收基建、P-11/P-12/P-13/P-15 转正、P-20 Compatible 面、P-21 债务清偿、P-22 复审与 rollout 评估）之上新增：

| 新增项 | 来源 | 性质 |
| --- | --- | --- |
| P-23 右栏固定内容（趋势 + 推荐关注） | 本决策 D2 | 新功能件（组件 + 数据源） |
| P-25 Channels 页 Compatible 化 | 本决策 D4 | 新页面项 |
