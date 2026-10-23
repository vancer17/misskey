# ADR-0024：通知可达的本人成就页采用 Compatible 表现

## 状态

已采纳（2026-10-23，项目所有者要求按讨论方案实施）。

## 背景

人工核查发现，Twitter 通知页的成就通知进入 `/my/achievements` 后，主列出现 Misskey 原生页头、独立面板和成就卡片网格。通知链接指向既有本人成就路由，功能目标正确，但阶段清单没有覆盖这一可达页面的 Twitter 表现。

Nitter 不提供成就功能，无法直接取得对应页面。项目已有的 Nitter 布局参数与 Twitter Token 可用于主列、紧凑返回头、文字、间距和分隔列表；成就目录、徽章和申领行为仍来自 Misskey。

## 决策

1. 将 `/my/achievements` 纳入第二阶段 P-20 Compatible 面，并以泄漏审计 A9 登记“成就通知 → 本人成就页”。保留路由、登录要求和通知导航；不增加个人主页成就页签，不扩展其他用户的成就入口。
2. `pages/achievements.vue` 通过既有 `useIsTwitterUi()` 选择 `TwitterAchievementsShell`。新壳位于 `ui/twitter/components/`，经 `ui/twitter/index.ts` 导出，只负责紧凑返回头、标题、Twitter 背景、滚动和移动端留白；延续 `MkStickyContainer`、`_pageScrollable` 与既有滚动工具的归属。
3. `MkAchievements.vue` 通过轻量 `ui/twitter/context/index.ts` 的 `useIsTwitterUi()` 添加局部样式类，只调整呈现。Twitter 分支以单列铺满主列，使用 Token 文字、间距和 hairline 分隔，去掉独立面板底色、大圆角与网格间隙。沿用既有移动布局状态，不建立第二套断点或尺度常量。
4. 基础组件的 `users/achievements` 查询、`ACHIEVEMENT_TYPES` 顺序、徽章映射、锁定条目和 `clickedClickHere` 申领逻辑保持原有实现。登录检查、页面元数据、“查看成就三分钟”的计时器及其离页清理仍归原路由页面负责；不新建 Store、成就类型、业务状态副本或运行时配置。
5. 成就徽章保留为 Misskey 业务资产，图像槽位及列表布局映射到已落地的 Nitter 参数与 Token。这是无 Nitter 对应页面的 Compatible 映射，不声称存在 Nitter 成就页或 Twitter 实测成就页依据。界面文案复用既有 i18n，本次不修改 locale 文件。

## 未采用的方案

- 修改成就通知的目标或隐藏入口：正确的本人成就导航不应因表现遗漏而失去功能。
- 在 Twitter 业务层复制成就渲染、目录与请求：会产生第二套权威事实，并扩大维护范围。
- 重做基础组件查询、申领、错误恢复或刷新行为：本次是 Compatible 表现修复，没有这些业务改造的必要性。
- 增加完整成就中心或个人主页页签：超出修复通知可达页面的范围。

## 后果与验证边界

Twitter 本人成就页沿用 Misskey 的业务事实，在既有主列中呈现返回头与连续列表；默认 Misskey 页面继续使用原生表现。基础组件的局部样式变体可能覆盖其他已有 Twitter 消费位置，但不增加导航入口或改变其业务能力。

验收应使用真实后端证明申领产生通知、进入页面和展示真实成就，并复核直接访问、刷新、返回与滚动恢复、目录顺序、锁定占位、隐藏成就交互和原页计时器清理。截图覆盖桌面、390px、320px及明暗主题，逐项审阅成就页期望变化，以通知页和默认 Misskey 页面为不变对照。

既有组件只有加载与成功呈现，本次不将错误重试、空态或回访刷新记为已实现能力。Mock 只能证明协议与映射，不替代业务行为验证。本 ADR 不将尚未执行的验证或截图 diff 记为通过，P-19 正式视觉基线继续遵守阶段出口条件。

现行范围见 [第一阶段总表](../phase-1-page-inventory.md)、[第二阶段总表](../phase-2-page-inventory.md)，入口审计见 [leak-audit.md](../leak-audit.md) A9。
