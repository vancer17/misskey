# ADR-0005：频道域 Communities IA 收敛（列表页 Home / Explore 重构与聚合数据源）

## 状态

已采纳（2026-10-14，项目所有者指示实施；P-26 全批次实施完成。排期按 D6 选项 a 执行：phase-2 出口不受本项阻塞，频道域 P-19 基线待 P-26 验收后增量更新——见 F-6）。

**呈现细节已被替代（2026-10-21）**：[ADR-0015](./0015-community-strip-layout.md) 将首页／发现频道导航统一为横幅卡片横条，将管理／收藏移至独立窗口，并把常驻搜索改为标题栏内按需展开；本篇保留原始决策与实施历史。Home／Explore 聚合数据源、详情页决策继续有效。当前契约见 [频道入口布局与请求边界](../communities-layout.md)。

**T-0 核对结论（2026-10-14）**：ADR-0002 补记所述详情页 Communities IA 实现与本工作区失联（代码仍为 P-25 Compatible 形态、audit 无 CH-11）——判定为**未落地**，P-26 F-4 按新实施处理，CH-11 登记已由本 ADR 实施补齐。编号说明：0003 按 phase-2 总表预留 rollout 评估结论，0004 已用于右栏固定内容，故本篇为 0005。

## 背景

1. **现状**：P-25 将 `/channels` 列表页按 Compatible 等级 Twitter 化——五 tab（検索 / 注目 / お気に入り / フォロー中 / 管理）**全部为频道实体列表**，内容消费路径为"列表 → 进频道 → 看帖"两层跳转。走查反馈：业务形态过于单一。
2. **参照系**：
   - X 实测（用户走查截图 + `/home/vancer17/x.com` 静态资源镜像）：Communities 为 **Home**（顶部已加入频道横条 + 下方聚合内容流）/ **Explore**（发现）/ **常驻搜索** 三件套；
   - nitter 无 Communities 入口与频道域（检索证据见 [port-fidelity-audit.md](../port-fidelity-audit.md) 第九节）——本决策整体落在 X-behavior 轴，无布局地面真值约束（组件内部尺度仍受 token 阶梯与既有组件变体约束）。
3. **数据源现状**（决策的硬约束）：
   - 已关注频道帖子聚合流：**无端点**——`notes/timeline` 为"关注用户 + 关注频道"混合流（`timeline.ts:170`），不可过滤拆分；
   - 全频道帖子流：**无端点**——LTL / GTL 按 `channelId IS NULL` 结构性排除频道帖（上游设计）；
   - 频道实体搜索：`channels/search` 现成；跨频道**帖子**全文搜索无端点（`notes/search` 仅单频道或全笔记）。
4. **既有相关裁决**：[ADR-0002](./0002-product-decisions-leak-remediation.md) 补记（2026-10-14）已将频道**详情页**升级为 X Communities IA 对齐（Full：社区头 + join-gate + Home / Explore / About / Search tab）。**但本工作区核查结论：该补记所述实现代码与 audit CH-11 登记均不存在**（详情页 twitter 变体仍为 P-25 Compatible 四 tab 实现）——状态失联，P-26 含核对 / 补齐任务（见拆解 T-0 / F-4）。

## 决策

### D1：列表页 IA 收敛为 Home / Explore 双模块 + 常驻搜索

`/channels` 的 twitter 变体重构为双 tab（Home / Explore），搜索为页内常驻模块。旧五 tab 形态在 P-26 完成后从 twitter 变体移除；**default UI 与 legacy 分支不动**（路由页面层保持双分支，legacy 五 tab 原样）。

### D2：Home = 已关注频道横条 + 聚合流

顶部横条列出已关注频道（数据源 `channels/followed` 现成），下方为已关注频道帖子的**聚合流**，数据源为**新增后端端点** `channels/followed-timeline`（见 D5 / 拆解 B-1）。客户端合并多频道流不可行（破坏分页正确性），必须服务端聚合。

### D3：Explore = 全频道聚合流 + 注目频道卡 + 管理 / 收藏入口

数据源为**新增后端端点** `channels/global-timeline`（拆解 B-2）；推荐频道卡复用 `channels/featured`；P-25 旧 tab 中"管理（owned）"与"お気に入り（favorites）"的能力入口安置于 Explore 顶部（创建 / 编辑经频道详情，与现状一致）。

### D4：常驻搜索 = 频道实体搜索（现成端点）

复用 `channels/search`（频道实体），形态对齐既有 SearchBox / 返回头惯例。跨频道帖子全文搜索**不纳入首期**（无端点，收益待产品确认），登记为后续可选扩展。

### D5：后端先行，纯增量变更

两个新端点均为新增（不动既有端点语义）；实施顺序 = B-1/B-2 → misskey-js 再生成 → 前端重构。首次触及本项目后端变更面：须走 `working-on-backend` 流程 + `misskey-api-reviewer` 审查 + `pnpm build-misskey-js-with-types`。

### D6：排期（待裁决）

| 选项 | 内容 | 取舍 |
| --- | --- | --- |
| **a（推荐）** | phase-2 按现状出口（P-25 Compatible 形态即过渡形态），P-26 作为独立阶段（phase-3 或插入项） | phase-2 出口不延期；P-19 基线按阶段各自建立——phase-2 基线覆盖既有面，P-26 完成后对频道域做**基线增量更新**（拆解 F-6） |
| b | P-26 前置于 phase-2 收尾，P-19 / P-22 顺延 | 频道域基线一次到位；但 phase-2 出口被产品重构阻塞 |

### D7：详情页 Communities IA 纳入 P-26 同批

ADR-0002 补记裁决的详情页重构（join-gate、关注态派生 tab、社区头，nitter `views/community.nim` + `profile/_community.scss` 映射）与列表页收敛**同批实施**，保证频道域 IA 一次成型；并补齐 CH-11 登记（或经 T-0 核实其下落后并轨）。

### D8：流式与冷启动的首期边界

聚合流首期为**纯分页 + 手动刷新**（Misskey streaming 无聚合 channel，逐频道订阅 N 连接留作后续扩展）；Home / Explore 的空态与冷启动（频道少、featured 有 `lastNotedAt` 门槛）按 P-09 终态件设计。

## 影响面

- **正面**：内容流前置、频道列表退为导航；与详情页补记模型（Home / Explore 命名）一致，频道域 IA 统一；
- **代价 / 风险**：首次打开后端变更面（2 端点 + misskey-js 再生成）；P-19 基线顺序耦合（见 D6）；聚合端点的分页正确性（游标合并）为后端实现核心风险；旧五 tab twitter 变体（TwitterChannels.vue）退役带来一次性迁移成本；
- **方法论义务**：全 B 类登记（X-behavior 来源，nitter 无对应物），audit 第九节滚动登记扩编（列表页新条目 + 补记 CH-11）。

## 备选方案（未采纳）

1. **维持 P-25 形态**：零成本，但业务单一问题留存，且与详情页补记模型割裂；
2. **轻量 tab 收敛**（仅合并 管理 / 收藏入口、不加内容流）：纯前端、无后端依赖，但不解决"列表前置、内容两层跳转"的根本问题。

---

## 附：P-26 拆解（Communities IA 收敛）

**等级 Full；依赖：本 ADR 采纳、B-1/B-2 端点；锚点：`pages/channels.vue`（twitter 分支重写）、`pages/TwitterChannels.vue`（退役）、`pages/TwitterChannel.vue`（D7 重构）、`ui/twitter/` 新组件。**

| # | 任务 | 内容 | 验收 |
| --- | --- | --- | --- |
| **T-0** | 状态核对 | 核实 ADR-0002 补记所述详情页工作下落（他工作区 / 未实施）；结论回写本 ADR | 失联状态闭环 |
| **B-1** | `channels/followed-timeline` 端点 | Schema 草案：`req { limit?: 1–100 (默认 10), sinceId?, untilId? }` / `res: Note[]`；`loginRequired`；实现要点：channelFollowingService 取关注集 → `note.channelId IN (...)` + 游标排序 + ChannelMutingService 过滤 + visibility 过滤 | 单元测试（分页 / mute / 空关注集）+ API reviewer |
| **B-2** | `channels/global-timeline` 端点 | 同型 Schema；可未登录；范围 = 本实例全部未归档频道的帖子；mute 过滤同上 | 同上 |
| **B-3** | misskey-js 再生成 | `pnpm build-misskey-js-with-types`，autogen 差异入 commit | CI |
| **F-1** | 列表页 Home 模块 | 关注频道横条组件（`channels/followed`）+ 聚合流（`Paginator<'channels/followed-timeline'>` + `MkNotesTimeline variant="twitter"`）+ KeepAlive 激活刷新（沿用审计通用约定） | 走查矩阵 |
| **F-2** | 列表页 Explore 模块 | 聚合流（global-timeline）+ 注目频道卡（featured 复用）+ 管理 / 收藏入口行 | 同上 |
| **F-3** | 常驻搜索 | SearchBox 形态常驻头部 + `channels/search` 结果（复用既有 twitter 搜索结果件） | 同上 |
| **F-4** | 详情页 Communities IA（D7） | join-gate、tab 按关注态派生（Home / Explore / About / Search）、社区头；nitter `views/community.nim` 映射表 + 偏离登记 | 走查矩阵 + audit 登记 |
| **F-5** | 旧形态退役与入口迁移 | TwitterChannels.vue 退役；侧栏 / 移动栏 / A5 卡片链接目标路由不变（`/channels`、`/channels/:id`）；legacy 分支与 default UI 不动 | 回归走查 |
| **F-6** | 登记与基线 | audit 第九节扩编（列表页 B 类 + CH-11）；按 D6 选项 a 对频道域做 P-19 基线增量更新 | 审计完整性 |

**风险表**：聚合端点游标合并正确性（B-1/B-2 核心）；关注频道极多时的 IN 查询规模（上限截断策略需在 B-1 实现时裁决）；P-19 基线顺序（D6）；补记失联工作的合并冲突（T-0）。
