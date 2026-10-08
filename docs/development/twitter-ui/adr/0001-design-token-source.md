# ADR-0001：Twitter UI 设计 Token 的来源与色板策略

## 状态

已采纳（2026-10-07）

## 背景

- Twitter UI 第一阶段（P-00 ～ P-07）已实现应用 Shell、时间线、帖子卡片、详情、用户主页、发帖、通知与搜索，组件统一消费 `--twitter-*` 语义变量，定义内联于 `ui/twitter.vue`。
- 完全依赖 AI 凭空生成空间关系与尺度不可靠；后续以 nitter 模板项目（`external/app/nitter`，AGPL-3.0，与本项目许可兼容）作为布局与设计参数的地面真值进行比对复刻。
- 原实现的色值经 `--MI_THEME-*` 中转，跟随用户主题，无法保证 Twitter 视觉；断点在 TS 与 SCSS 中双份书写，属规范第 10 条禁止的复制维护。

## 决策

1. **Token 三层模型**：nitter 源值（不进组件）→ `ui/twitter/tokens.scss` 语义 Token（组件唯一契约）→ 组件消费。既有 `--twitter-*` 变量名全部保留，P-00 ～ P-07 组件零改动。
2. **色板策略采用 C（精确复刻 + 品牌覆盖入口）**：
   - 表面 / 文字 / 边框取 nitter 明暗双主题精确值（`twitter.css` / `twitter_dark.css`）；
   - 品牌色默认 nitter 蓝（明 `#1DA1F2` / 暗 `#1B95E0`），上游设置 `--twitter-accent-override` 即可整体覆盖且无需区分明暗；
   - 动作语义色（转发 / 错误 / 点赞 / 警告）沿用 `--MI_THEME-*`，保持 Misskey 跨 UI 动作一致性。
3. **明暗切换机制**：`light-dark()` + `theme.ts` 写入 `<html>` 的 `color-scheme`。跟随 Misskey 应用内主题明暗而非操作系统偏好，不引入 JS 切换逻辑。
4. **断点单权威**：`domain/layout.ts` 的 `TWITTER_LAYOUT_BREAKPOINTS`（as const）为唯一来源；`useTwitterLayout` 据此驱动 matchMedia 与响应式状态，Shell 经 class 绑定切换布局，且不新增断点一致性测试（规范第 10 条：禁止复制后靠测试维持一致）。**新增样式禁止书写布局断点媒体查询**。~~历史 PR 遗留的 11 个 `@media (max-width: 500px)` 块为既有债务~~ → 已于 P-10 专项全部迁移为 `&.mobile` class 驱动（`useTwitterLayout` 同步单例化，全部组件共享一份 matchMedia 状态），`ui/` 范围内断点字面量已归零。
5. **覆盖层 Token 组与三层改造策略（P-08）**：菜单 / 对话框 / tooltip / emoji 选择器在 nitter 中无对应物，本组 Token（背板遮罩、弹层投影、菜单行尺度、抽屉圆角、tooltip pill）全部为 X-behavior 来源。实现采用三层策略——业务逻辑层（`get-note-menu.ts` / `os.ts` 调度等）零改动；全局类外铬经 `overlay.scss` 在 `body[data-ui='twitter']` 作用域覆写 `._popup` / `._shadow` / `._modalBg`；组件内部结构由各 Mk 弹层组件经 `useIsTwitterUi()` 挂载 twitter 表现变体（仅视觉，不含业务分支）。
6. **共享页面状态统一（P-09）**：终态类型（empty / notFound / error）与骨架屏形态变体（timeline / notifications / detail / profile）由 `domain/page-state.ts` 单点权威定义（规范第 10 条）。loading 采用与内容同构的骨架屏（X-behavior），与终态文案块分离为两个基础组件；404 语义经错误码判定（`NO_SUCH_NOTE` / `NO_SUCH_USER` 的 id）单向派生为 `notFound` 终态且不提供重试。原 `TimelineState.vue` 与 `NotificationSkeleton.vue` 被收敛删除，不保留兼容层（消费点全部为栈内文件，规则 13）。
7. **移动布局专项（P-10）**：移动尺寸（触控命中区 / 底部栏高 / FAB 尺寸）入 Token；`useTwitterLayout` 单例化后全部组件共享一份 matchMedia 状态；11 处遗留断点媒体查询迁移为 `&.mobile` class 驱动。X 行为补强：重按当前 tab 回顶（Timeline / Notifications 经 `tabReselected` 事件上抛，业务回顶动作留在 Shell 层）、帖子操作栏纵向 44px 命中区（token 驱动、横向保守扩展避免相邻重叠）、横屏 safe-area 左右。sticky header 的毛玻璃效果经查已由既有实现常驻覆盖（82% 透底 + blur 12px，与 X 滚动态视觉等价），按规范第 7/9 条不引入滚动检测抽象。

## 有意偏离 nitter 的项

| 偏离项 | nitter 实际 | 本实现 | 理由 |
| --- | --- | --- | --- |
| 面板圆角 | `border-radius: 0` | 4 / 8 / 16 / 999px 阶梯 | 取向现代 X 的视觉语言，产品定位为"类 Twitter"而非 nitter 复古风 |
| 动效体系 | 无（服务端渲染查看器） | 120 / 180 / 240ms + 单一 ease 曲线 | nitter 无可抄动效；本组为自定 motion spec，待 X 行为录屏校准 |
| 次要文字色 | `fg_faded` 精确值 | 修正为精确值 `#657786` / `#8899A6` | 原实现为 `color-mix(fg 57%)` 估值，本次修正为对齐 |
| 覆盖层体系 | 无（无菜单 / 对话框 / tooltip） | X-behavior 来源 Token + 三层改造策略 | nitter 为只读查看器；覆盖层视觉只能取自 X 行为观察 |
| 实例来源条（MkInstanceTicker） | 无（单实例查看器） | 中性 chip：panel 底 + hairline 边 + 次要文字色 | nitter/X 均无对应物；按 X 视觉语言派生，功能保留（远程帖可见来源实例），R-2 实施 |
| 发帖完成动效（MkModal `send`） | 无 | 淡出 + 8px 下沉（180ms） | Misskey 原上飞 300px + 回弹曲线与 X 交互语言不符；X 发帖后对话框快速消退，R-4 实施 |

## 已落地的阶梯（原暂缓项，R-4 实施）

原暂缓原因：现存组件散布约 12 种字面量字号且混有图标尺寸，预置阶梯会产生无消费者悬空定义。R-4 落地方式：

- **排版阶梯**：`--twitter-font-size-caption/meta/body/content/emphasis/title/heading/display`（12/13/14/15/16/18/20/24px），档位对应 nitter 真值（正文 15 / 全名 14 / 次要 13 / 辅助 12）。迁移策略为**值恒等替换**——只替换与档位同值的字面量，不调整任何渲染结果；存量非阶梯字面量（10/11/17/22px 与 32px 图标尺寸）在 P-19 基线建立前保留，待基线可 diff 验证后再做近邻档位收敛。
- **间距阶梯**：`--twitter-space-1..4` 与 `--twitter-space-6`（4/8/12/16/32px；24px 暂无消费者，出现真实消费点后再入梯，规范第 9 条），仅迁移单值与全档位复合声明；nitter 实测例外值（5/6/10/14px 等）保留字面量并注明来源，属地面真值而非债务；calc / safe-area / 百分比构造不迁移。
- **动效时长双投影**：JS 侧唯一数值权威为 `domain/motion.ts` 的 `TWITTER_MOTION_DURATIONS`（供 Vue `<Transition :duration>` 消费），CSS 侧经 `tokens.scss` 的 `--twitter-duration-*` 投影；两者为跨介质单权威对，修改时长必须同步两处，禁止组件内出现第三份时长字面量。X 录屏校准到位后仅需各改一处数值。

## 后果

- Twitter UI 的表面观感不再跟随用户 Misskey 主题（仅明暗跟随），这是 `data-ui='twitter'` 独立样式的应有语义；
- `--twitter-duration-slow` 补齐定义（原 `NoteActions.vue` 消费但未定义，靠 fallback 兜底）；
- `--twitter-warning` 收敛至 tokens.scss（原在 `NotificationIcon.vue` 局部重复定义）；
- `use-twitter-layout.ts` 迁移至 `composables/` 并经模块索引 `ui/twitter/index.ts` 对外暴露，断点消费改走 `domain/layout.ts` 权威常量。
- R-4 后 MkModal（modal/popup/drawer/send 四类过渡）与 MkTooltip 过渡在 twitter 语境消费 motion token；emoji 选择器内部（搜索框/分组头/网格项，审计 C4）挂 twitter 变体；涟漪禁用已于 R-3 完成（审计 E2）。
