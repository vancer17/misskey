# ADR-0004：右栏固定内容的 X 形制参数与降级策略

## 状态

已采纳（2026-10-09，P-23 实施随附；属 [port-fidelity-audit.md](../port-fidelity-audit.md) PF-3 批次 Shell 信息架构族成文）

## 背景

[ADR-0002](./0002-product-decisions-leak-remediation.md) 决策 D2 裁定右栏移除 Misskey 自配挂件系统，改为 Twitter 式固定内容（趋势 + 推荐关注），列为 Phase 2 必做 P-23。

本项目方法论规定 nitter 为布局与设计参数的地面真值，但 nitter 为单列（600px 主列 / 920px inner-nav）只读查看器，**无右栏信息架构，也无趋势 / 推荐关注域**。检索证据：`external/app/nitter/src/sass/` 全量检索 `trend` / `recommend` / 右栏挂件零命中（登记于 port-fidelity-audit.md P-23 节）。右栏因此整体落入 S-1 裁决边界的 **X 信息架构侧**，形制参数无法从 nitter 取值，必须成文固定，防止 AI 发明值进入（第二轴泄漏）。

## 决策

### 1. 数据源与降级链

| 层 | 来源 | 说明 |
| --- | --- | --- |
| 趋势主源（唯一） | `hashtags/trend` | 无凭证、服务端 60s 缓存、Top 10，右栏取前 5 条；无备源（无等价数据），失败静默收起 |
| 推荐主源 | `users/recommendation` | 需凭证 + `read:account`；仅本地、7 日活跃、未关注用户，稀疏实例可能为空 |
| 推荐备源 | `pinned-users` | 实例置顶用户，无凭证要求；主源为空或失败时回退 |
| 终态 | 静默收起 | 主备源均空时整卡不渲染，右栏不产生错误 / 空态噪声 |

### 2. 形制参数（全部落在既有 token 阶梯内）

| 项 | 值 | 来源标注 |
| --- | --- | --- |
| 卡容器 | panel 底 + `--twitter-radius-large`（16px）圆角 | X 右栏卡（B 类） |
| 卡标题 | `--twitter-font-size-heading`（20px）/ 700、内距 12/16 | X 右栏卡（B 类） |
| 卡行 | 内距 8/16、hairline 1px 分隔、hover `--twitter-hover` | 阶梯内取值 |
| 趋势条目主文字 | `--twitter-font-size-content`（15px）/ 700 | N-5 裁决派生 |
| 趋势计数行 | `--twitter-font-size-meta`（13px）secondary | nitter 13px 档派生 |
| 推荐行头像 | 40px | X 右栏紧凑行（B 类）；主列用户行仍为 nitter 权威 48px，两域并存不冲突 |
| 推荐行 name / acct | 14px / 700 与 15px secondary | PF-2 N-5 裁决派生 |
| 骨架行 | `--twitter-skeleton-block` + 1.2s pulse（respect prefers-reduced-motion） | 既有共享状态 token（O-2 族） |

### 3. 入口纪律

- 趋势条目 → `/tags/:tag`（P-15 已 Twitter 化，#20）。
- 推荐行身份区 → 用户主页（P-04）；关注操作复用 `MkFollowButton` twitter 变体。
- **两卡均不设「显示更多」入口**：X 的 Show more 目标为 explore / connect 页，P-14 explore 未 Twitter 化，设置入口将制造新的 A 类路由级泄漏。移除条件：P-14 转正后随该页补入口。

### 4. 语义保真

`hashtags/trend` 的 `usersCount` 为统计窗口内参与用户数峰值，展示文案复用 `nUsers`（"{n}ユーザー"），**不得**表述为投稿数（X 的 "N posts" 语义不可移植）。

## 后果

- 右栏全部参数有唯一成文出处，后续视觉回归基线（P-19）可据此判定 diff 是否为回归。
- `users/recommendation` 的实际供给量依赖实例规模，公司实例预期以备源为主——运行表现属预期行为而非缺陷。
- MkWidgets 与 `ui/_common_/widgets.vue` 保持不动，default UI 不受影响。
