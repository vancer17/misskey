# ADR-0008：资料身份展示与缓存设置路由边界

- 状态：已采纳并实施。
- 日期：2026-10-16。
- 范围：个人资料编辑、Twitter 身份展示、用户主页回访和设置页容器。既有共享组件内部逻辑保持不变。

## 背景与历史判断修正

人工走查发现：头像编辑后个人资料头部更新而帖子头像不变；退出编辑页后第二次进入导致中心路由区域持续空白。

此前新鲜度审计将后者归因为 async setup 与 KeepAlive/Suspense 的恢复缺陷，并把移除顶层 await 登记为已修复。使用仓库 Vue 3.5.41 的五组渲染对照后，这个归因不成立：稳定容器的异步 setup 可以正常往返；依赖全局 child 切换根分支的同步 setup 仍然失败。缓存设置页在离开时切为旧布局，重新创建没有匹配子路由的 NestedRouterView，初始化访问 null.route；随后的 parentNode/subTree 错误是连锁反应。

同样，晚于父页面激活而挂载的时间线子组件，第一次 onActivated 可以发生在首次回访。“统一跳过首次 activated”会遗漏刷新；“只有 items.length > 0 才刷新”会把已加载的空列表误当成无须刷新。此前对 v-if 面板的经验不能直接应用于当前 v-show 用户时间线。

## 决策

### 1. 设置容器保留自己的展示上下文

`pages/settings/index.vue` 只在路由归属 settings 时更新本地子路由展示引用；离开设置页不会因为全局 child 消失而切换缓存布局。不存在有效子路由时不新建 NestedRouterView。尺寸处理和默认入口重定向仅在设置树内执行。保留原设置首页的中心栏宽度规则和既有草稿缓存行为。

不修改共享 RouterView/NestedRouterView，不用每次激活销毁子页、随机 key、整页刷新或捕获并吞掉渲染异常。

### 2. 身份展示单向派生自既有账户状态

`useTwitterDisplayUser` 只选择既有引用：非 Mock 的本人身份使用 `$i`，其他作者使用输入用户；空值保持空值。函数不请求 API、不持有用户表或账户副本、不引入 Pinia。

头像、昵称、账号和身份徽标接入 Twitter 业务组件；转发者、原作者与引用作者分别按实际用户 ID 解析。展示引用不合并回 note，不进入帖子操作或权限判断，不修改共享 useNote 和 MkAvatar。媒体归属仍使用原帖作者。

### 3. 保存结果经既有账户更新入口提交

编辑页保留现有选择文件、裁剪、上传确认及服务端校验。保存命令串行执行，等待真实响应，再调用 `updateCurrentAccountPartial` 更新既有账户状态及持久化；不只补写 avatarUrl，也不提交草稿作为事实。请求失败维持错误提示，不执行成功副作用，后续保存仍可继续。

### 4. 回访刷新独立负责集合新鲜度

主页以实际 deactivation 标记回访，资料成功回填，旧账户请求通过取消与归属校验失效。时间线协调活动面板、隐藏面板待刷新意图及既有分页器在途状态，空列表也参与回访刷新；首次加载仍由 MkPagination 负责。

`Paginator.reload()` 沿用原有先清空再加载语义，不冒充保留旧列表的软刷新。失败状态和手动重试归现有分页器；不额外实现全局列表状态机。

真实后端回归同时发现附件面板的 `withReplies: true` 与 `withFiles: true` 组合被 `users/notes` 拒绝。局部改为 `withReplies: false`，保持当前接口约束，不扩展后端能力。

## 被替代／未采纳方案

| 方案 | 不采用的原因 |
| --- | --- |
| 移除设置页 await 作为黑屏根治 | 与根分支重建导致的无效嵌套路由挂载无关；同步后台填充保留，但不再宣称解决缓存故障 |
| 回访时重载全部帖子来更新头像 | 身份更新不应依赖集合请求；置顶帖稳定实例、列表请求失败时仍需同步 |
| 修改 MkAvatar 或 useNote 以自动拉取／合并账户 | 侵入共享基础组件及业务事实，不符合本项目局部变更边界 |
| 全局禁止 KeepAlive、随机 key、整页刷新 | 隐藏而非修复挂载条件，且破坏草稿、滚动及页面缓存语义 |
| 所有 onActivated 都跳过第一回 | 不覆盖异步晚挂载后代的实际生命周期 |
| 所有标签切换都同时 reload/init | v-if 与 v-show 生命周期不同，会产生重复请求及初始化竞争 |
| 新建用户缓存或新增状态管理框架 | 已有账户入口足以支持本次本人身份展示，不需要第二份权威事实 |

## 证据与界限

可重复真实后端回归：`packages/frontend/test/e2e/twitter-profile.spec.ts`。
引用选择适配测试：`packages/frontend/test/unit/twitter-display-user.test.ts`。后者仅证明引用映射及输入不变性，不替代前者的资料保存和多轮交互。

机制取证记录在 `tmp/profile-diagnosis-20261016/`，实施验证产物在 `tmp/profile-fix-20261016/`。临时产物不是被批准的长期视觉基线。

不承诺其他用户跨会话即时资料同步，也未将全部 settings/admin 页面或实验 StackingRouterView 宣布通过。正式 P-19 视觉基线及 P-22 全量走查仍保持原范围。

## 历史审计快照（已被现行说明替代）

以下保存实施前的审计原文以供追溯，包含已被本 ADR 否定的 async setup 归因、首次激活假设及旧进度统计，**不得作为当前实现指引或验收结论**。现行状态见 `../keepalive-freshness-audit.md`。

<details>
<summary>展开实施前审计快照（历史）</summary>

# Twitter UI KeepAlive 状态新鲜度审计

审计基线：`feature/twitter-ui-timeline-composer@ef4fb426b2` + P-25 工作树（未提交）。

## 定位

[leak-audit.md](./leak-audit.md) 审计第一轴（Misskey 旧样式漏进 twitter UI），[port-fidelity-audit.md](./port-fidelity-audit.md) 审计第二轴（AI 发明值漏进 nitter 权威布局域）。本文件审计**第三轴：行为正确性**——KeepAlive 页面缓存下的**状态新鲜度**缺陷：缓存页回访时列表不刷新、表单不重置。

**上游事实**：该缺陷类别为 Misskey 全局机制与页面的交互结果，default UI 与 twitter UI 同样存在，**不是 twitter 化引入的回归**。修复页面为两 UI 共享文件，修法（`onActivated`）为上游既有范式，对 default UI 安全。

## 缺陷机制

- `components/global/RouterView.vue:8`：页面组件包在 `<KeepAlive :max="prefer.s.numberOfPageCache">` 中（默认 **3**，`preferences/def.ts:291-293`，LRU 驱逐；`experimental.stackingRouterView` 开启时 StackingRouterView 行为类同）；
- 缓存 key = `route.viewKey ?? fullPath`（`RouterView.vue:63-65`）——同 key 回访**恢复缓存实例，setup 不重跑**；
- 被 KeepAlive 保活的页面切走不卸载：setup 期创建的 Paginator / 表单 refs 原样保留；
- 组件被 LRU 驱逐或浏览器刷新才真正重新挂载（解释了"绕经第 4 个页面再回来就刷新"的现象：创建流程恰好占满 3 页缓存）。

**触发事件**：人工走查报告 channels 三页两处缺陷（创建后列表不刷新；`/channels/new` 回访残留上次创建的表单）。

## 审计方法

1. **静态扫描**：全 pages/ 枚举含 setup 期 `new Paginator` 的页面（55）与含 `onActivated` 的页面（12），差集 43 为候选；
2. **可达性判定**：twitter UI 实际入口 = 侧栏/移动栏常驻项 + 内容链接（帖子卡、RightRail、用户页）+ TwitterHome 编辑资料 + 账号菜单（实测仅 `/@acct` 与 `/settings/accounts` 两目标，`accounts.ts:290-331`）；
3. **写路径分析**：页面的显示数据是否会被其他界面/其他会话写变（write-then-revisit 流），无写路径的页面不构成缺陷。

判定标记：❌ 确认缺陷 ｜ ⚠️ 待复核 / 低影响 ｜ ✅ 已有对策 ｜ ➖ 条件可达或不可达（范围外）。

## 一、主表（twitter UI 常驻 / 内容链接可达）

| # | 页面 | 路由 | setup 状态 | prop 响应性 | onActivated | 写路径（数据被谁改） | 判定 | 等级 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K-01 | 首页时间线 | `/` | streaming 时间线 + src 切换 | ✓ | ✓（`timeline.vue:218` switchTlIfNeeded） | 流式连接存续持续 prepend | ✅ | — |
| K-02 | 通知 | `/my/notifications` | 主 tab = `MkStreamingNotificationsTimeline`（流式 + 未读回补）；mentions / directNotes tab = Paginator | ✓（tab / excludeTypes） | ✗ | 新 mention / DM 外部到达；主 tab 依赖流式回补 | ⚠️（mentions/direct 回访陈旧，主 tab 待走查复核流式回补） | P2 |
| K-03 | 帖子详情 | `/notes/:id` | note 拉取（watch ✓）+ 前后线程 Paginator（computedParams ✓） | ✓ | ✗ | 新回复、帖子编辑 / 删除在别处发生 | ⚠️（同帖回访线程陈旧；note 对象本身不重取） | P1 |
| K-04 | 用户主页 | `/@acct` | fetchUser（watch ✓）+ 时间线 Paginator（computedParams ✓） | ✓ | ✗ | 用户新帖 / 资料变更（他处或他会话） | ⚠️（回访陈旧） | P1 |
| K-05 | 关注 / 关注者列表 | `/@acct/following`、`/@acct/followers` | Paginator（computedParams ✓，页面层持有） | ✓ | ✗ | 任意界面的 follow / unfollow / 账号变动 | ❌（回访列表陈旧；P-12/13 自有页面） | P1 |
| K-06 | 搜索 | `/search` | 每次提交新建 Paginator（`search.note.vue:372,391`） | ✓（query 驱动重建） | ✗ | 外部新内容 | ⚠️（搜索结果陈旧可接受） | P2 |
| K-07 | Hashtag | `/tags/:tag` | Paginator（computedParams ✓） | ✓ | ✗ | 新带 tag 帖子 | ⚠️ | P2 |
| K-08 | 频道列表 | `/channels` | 4 个 Paginator（静态参数，setup 创建） | — | ✗ | 建 / 删 / 关注 / 收藏频道（本页编辑器与频道页） | ❌（**用户报告实锤**：创建后回访不刷新） | **P0** |
| K-09 | 频道详情 | `/channels/:id` | channel 拉取（watch ✓）+ featured Paginator（静态）+ streaming 时间线 | ✓ | ✗ | follow / mute 态他处变更；featured 集合变化；streaming 连接在 KeepAlive 下存续（断线补齐待复核） | ❌（featured tab 与 follow 态回访陈旧）/ ⚠️（timeline tab 待复核） | P1 |
| K-10 | 频道编辑器 | `/channels/new`、`/channels/:id/edit` | 表单 refs（name / description / banner / color / sensitive / pinned）+ fetchChannel 仅 setup 执行 | ✗（channelId 变更不重取，但被 key=fullPath 机制掩盖：不同频道 = 不同缓存实例） | ✗ | 上次创建的表单残留 | ❌（**用户报告实锤**：`/channels/new` 回访残留频道 A 表单） | **P0** |
| K-11 | 资料设置 | `/settings/profile` | 表单 refs 初始化自 `$i`（响应式全局，save 写回 `$i`） | — | ✗ | 仅本页写入（正常）；他会话变更资料为边缘场景 | ✅（低风险登记） | P2 |
| K-12 | settings 面其余 | `/settings/*`（mute-block、apps、security 等） | 各列表 Paginator | — | ✗ | 本页 / 他处写入 | ⚠️（P-20 Compatible 面条件可达） | P2 |
| K-13 | 设置树容器 | `/settings/*`（settings/index.vue） | 原为 **async setup**（顶层 await：search-index 动态导入、storage 持久化状态） | — | — | 不适用（渲染缺陷，非数据陈旧） | ❌（**用户报告实锤**：/settings/profile 退出后再进入渲染空白——async setup 页面经 RouterView 的 KeepAlive > Suspense 缓存后再次激活子树空白，Vue 3.5.41 恢复缺陷；同步 setup 页面不受影响。**先前已存在**，非新鲜度修复引入） | **P0（已修复：去 async setup，改同步声明 + 异步填充）** |

**K-13 同类隐患登记（async setup × KeepAlive+Suspense，退出再进即空白）**：`settings/webhook.edit.vue:90`、`settings/profiles.vue:25`、`settings/other.vue:174`（P-20 settings 面，暴露前须同范式修复；other.vue 可直接复用 `getStoragePersistenceSharedRefSync`）；`admin/*` 与 `admin-user.vue`（Legacy allowed 面，不修）。

## 三、附：非 KeepAlive 轴缺陷登记（K-14，用户走查报告）

**缺陷类：paginator 换绑 × key 复用 → 无限加载**（与 KeepAlive / 新鲜度轴无关，独立登记）。

机制：`Paginator.fetching` 初始为 `true`（`paginator.ts:84`，假定挂载期被 `init()`）；`MkPagination` / `MkNotesTimeline` 仅在 `onMounted` 调用 `init()`，对 paginator **换绑**无反应；搜索流程用内容派生的字符串 key（`query + type`）驱动结果组件重渲染——**重复提交完全相同的搜索时 key 不变 → 结果组件不重挂载 → 新建 Paginator 无人 init → fetching 永停 true → 无限加载**。不限于未命中场景：重复搜索有结果的同一词同样挂起。

| # | 位置 | 状态 |
| --- | --- | --- |
| K-14a | `channels.vue` `search()`（频道列表 search tab） | **已修复**：同 key 重复提交改为对既有分页器 `reload()`，仅 key 变化时新建实例 |
| K-14b | `channel.vue` `search()`（频道详情 search tab，同型缺陷） | **已修复**：同型守卫 |
| 免疫参照 | `search.note.vue:393,410`——上游用自增计数器 key（`key.value++`），每次必重挂载故无此缺陷；反证两处为上游实现不一致造成的遗漏，属既有缺陷非本次引入 | 无需改动 |

上游级根治方案（**未采纳**，登记备查）：让 MkPagination / MkNotesTimeline 对 paginator prop 换绑 watch 并 init 新实例——覆盖所有同模式调用方，但波及全部消费组件，需上游级回归，超出本项目变更纪律。

## 二、条件可达登记（当前无入口；一旦暴露即转入主表复核）

| 页面 | 暴露条件（对应总表） | 现状 |
| --- | --- | --- |
| favorites（`/my/favorites`） | P-17"作为 bookmark-like 功能暴露时" | 不可达；Paginator 无 onActivated，暴露前须修 |
| explore（`/explore*`） | P-14 左侧导航暴露 Explore 时 | 不可达；同上 |
| 列表族（`/my/lists`、`/list/:id`、`/my-lists/list`） | P-18 Lists 保留可见时 | 不可达；`my-antennas/index` 已有 onActivated ✓ 可为范式，`my-lists/list`、`my-clips/index`、`clip.vue` 无 |
| follow-requests（`/my/follow-requests`） | 通知行暴露入口时（实测 twitter NotificationRow 无此链接） | 不可达 |
| announcements、drive、about | P-20 Compatible 面 | 条件可达，随 P-20 复核 |
| gallery / flash / pages / reversi / admin/* / instance-info / invite | Legacy allowed / Hide | ➖ 不修（上游同样缺，无谓扩大变更面） |

注：dialog 型界面（os.popup 家族、MkPostFormDialog、SchedulePostDialog 等）每次全新挂载，天然免疫本缺陷类别，不在审计范围。

## 汇总

| 判定 | 数量 | 明细 |
| --- | --- | --- |
| ❌ 确认缺陷 | 3 | K-08、K-10（用户实锤）、K-05 |
| ⚠️ 待复核 / 低影响 | 8 | K-02、K-03、K-04、K-06、K-07、K-09、K-12 + K-11 低风险登记 |
| ✅ 已有对策 | 1 | K-01 |
| 上游全量 | 43 页缺 onActivated（含不可达面） | 既有对策范式 12 处：`timeline.vue:218`、`my-lists/index.vue:76`、`my-antennas/index`、`settings/index`、`achievements`、`MkDrive`、`chat/home.home` 等 |

## 修复批次建议与实施状态

| 批次 | 内容 | 修法 | 状态 |
| --- | --- | --- | --- |
| **FB-1（P0）** | K-08：`channels.vue` `onActivated` 对当前 tab 的列表 Paginator 定向 reload（tab 状态经 `defineModel` 提升至页面层；首版曾叠加 `watch(tab)` 重载，因与 v-if 面板 MkPagination 重挂载自带的 `init()` 并发双 init 产生重复项而**回退**，教训留档）；K-10：编辑器**创建成功回调内 `resetForm()`**（`router.push` 前执行；刻意不用 onActivated 清空——保留"填一半切走再回来"的草稿场景）；K-13：`settings/index.vue` 去顶层 await（sync setup + 异步填充），消除 KeepAlive+Suspense 回访空白 | 上游 `onActivated` 范式 | **已实施** |
| **FB-2（P1）** | K-05：`follow-list.vue` + `TwitterFollowList.vue`（两套 paginator 各一处）激活条件 reload；K-09：`channel.vue` 激活重取 `channels/show` 回填 channel / favorited + featured 条件 reload（不沿用 watch 体：其含 tab 强切与已读回写副作用）；K-03：`note.vue` 激活重取主帖（拉取失败保留缓存）+ 已展开线程段条件 reload（保留展开状态）；K-04：`user/index.vue` 激活**软刷新**（独立函数，不沿用先置空的 fetchUser）+ `index.timeline.vue` / `notes.vue` / `TwitterUserTimeline.vue` 按 tab 激活条件 reload | 同上 | **已实施** |
| **FB-3（P2）** | K-02：`notifications.vue` 激活条件 reload mentions / directNotes（主 tab 流式不动）；K-06：`search.note.vue` 激活条件 reload 当前搜索结果（TwitterSearch 经 XNote 复用该组件，两 UI 一处生效）；K-07：`tag.vue` 激活条件 reload | 同上 | **已实施** |
| **不修（登记）** | K-11：`$i` 响应式全局单写者，接受；K-12：settings 面随 P-20 落地时按同范式逐页补 | — | 登记接受 / 移交 P-20 |
| **流程并入** | ① P-22 走查矩阵交互维度新增标准项"**写 → 离开 → 回访（含回访后切 tab）**"；② P-19 用例设计为 FB-1 / FB-2 覆盖页补交互序列用例（纯截图基线测不出本缺陷类别） | — | 待 P-19 / P-22 执行时纳入 |

### 实施通用约定（全部修复项共用）

- **首次激活跳过守卫**：KeepAlive 子树首挂载时 `onMounted` 与 `onActivated` 均触发，组件内 `skipNextActivation` 标志跳过第一次激活，防止双拉；
- **仅有条目才 reload**：`paginator.items.value.length > 0` 才执行——未加载过的列表由 MkPagination 首次渲染自然拉取，激活 / 切 tab 不预触发（防 API 风暴）；
- **刷新语义 = `paginator.reload()` 全量重取**（`utility/paginator.ts:256` 公开 API），不做增量补齐；
- **不与 MkPagination 的挂载自刷新并发**：tab 面板为 v-if 链的页面，切 tab 时目标面板 MkPagination 重挂载并自带 `paginator.init()`（`MkPagination.vue:121`）——激活刷新只覆盖"纯回访"（不重挂载）场景，**禁止**再叠 watch(tab) 类切 tab 重载（并发双 init 的两个响应先后 pushItems 产生重复项——K-08 首版实施引入过该回归，已回退并留档）；
- **回访软刷新语义**：重取类刷新（K-03 / K-04 / K-09）拉取成功才回填、失败保留缓存实体——不复用会先置空状态的硬刷新函数（如 fetchUser 先 `user.value = null` 会拆建子树闪空态；K-04 首版实施踩过，已改为独立软刷新函数）。

## 审计局限

1. 本审计为静态扫描 + 写路径推理；K-02 主 tab 流式回补、K-09 streaming 连接在 KeepAlive 存续期的断线补齐行为属运行时行为，留待 P-22 走查矩阵实测复核；
2. StackingRouterView（experimental 偏好）下的缓存语义未单独走查，机制同源，缺陷面不小于本表；
3. 条件可达页（第二节）未逐页取证，转入主表前须先补写路径分析。

</details>
