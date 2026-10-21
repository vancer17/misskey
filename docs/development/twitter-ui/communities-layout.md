# 频道入口布局与请求边界

`/channels` 的 Twitter UI 使用“顶部导航 → 横向频道卡片 → 帖子流”结构。频道详情和创建／编辑继续使用既有 `/channels/:id`、`/channels/new`、`/channels/:id/edit` 路径。页面展示由 `pages/TwitterCommunities.vue` 负责，所有查询仍由 `pages/channels.vue` 持有。

## 页面结构

| 区域 | 当前内容与数据源 |
| --- | --- |
| 顶部标题栏 | 返回、频道标题、搜索图标、管理菜单；打开搜索后，输入框占用同一标题栏内的标题位置 |
| 主标签 | 首页、发现；支持方向键与 Home／End，标签按钮和内容面板通过 ARIA 标识关联 |
| 首页 | `channels/followed` 频道横条 → `channels/followed-timeline` 聚合帖子流 |
| 发现 | `channels/featured` 推荐频道横条 → `channels/global-timeline` 全频道帖子流 |
| 管理菜单 | 打开“我的频道”或“收藏”独立资料库窗口；创建入口位于“我的频道”内，沿用既有权限 |
| 搜索结果 | `channels/search` 频道实体列表，查询方式固定为 `nameAndDescription`，覆盖主标签内容区域 |

标题栏和主标签吸顶，频道横条随帖子区域滚走。搜索是标题栏内的按需展开入口；提交后显示结果，关闭搜索恢复原主标签。管理与收藏通过 `TwitterCommunityLibraryDialog` 包装既有 `MkModalWindow`，由 `os.popup` 的全局宿主承载，沿用桌面窗口和移动端抽屉表现。关闭或离开页面先执行基础窗口关闭流程，待 `closed` 后释放实例，防止焦点陷阱和 `inert` 残留。

首页横条对应 X 成员社区横条。X 归档的发现页采用主题入口；本项目将 Misskey 推荐频道排为同形横条，是对现有频道业务的数据映射。

## 横条尺度与交互

`ui/twitter/components/TwitterCommunityStrip.vue` 接收只读的既有 `Misskey.entities.Channel` 实体及请求状态，不创建频道副本或请求实例。卡片整体链接到频道详情，上方为装饰性横幅，下方为单行粗体名称；完整名称保留在链接标题与可访问文本中。无横幅时显示频道图标。

| 参数 | 实现契约 |
| --- | --- |
| 卡片宽度 | `--twitter-community-card-width: 132px` |
| 横幅比例 | `--twitter-community-banner-ratio: 2.5` |
| 卡片圆角 | `--twitter-community-card-radius: 12px` |
| 边框 | `1px`，使用既有 `--twitter-border` |
| 横条内距／卡片间距 | 既有 `--twitter-space-4`，默认 `16px` |
| 名称区内距 | 既有 `--twitter-space-2`，默认 `8px` |
| 名称字号 | 既有 `--twitter-font-size-meta`，默认 `13px`，字重 `700` |
| 名称行高 | `--twitter-community-name-line-height: 16px` |

横条禁止换行，采用原生横向滚动和滚动吸附；内容溢出且指针悬停或键盘聚焦时显示可用方向的箭头。触摸、Tab 聚焦和左右方向键均可访问超出视口的卡片，RTL 根据实际排版方向滚动。滚动动画同时尊重既有 `prefer.s.animation` 和 CSS `prefers-reduced-motion` 偏好。关注集合保留服务端游标，在末尾提供继续加载入口；推荐集合维持原端点固定集合语义。

主横条只承担频道导航，统计、管理员信息和更新时间不进入紧凑卡片。搜索结果继续使用原有 `MkChannelPreview`；基础组件内部业务逻辑保持现有机制。

## 空状态与错误

| 查询结果 | 当前呈现 |
| --- | --- |
| 频道集合加载中 | 紧凑卡片骨架；首页不提前显示未关注引导 |
| 关注集合请求失败 | 紧凑错误和重试；不据此认定关注集合为空 |
| 关注集合成功且为空 | 仅显示一份未关注频道说明与“发现”入口；不挂载首页帖子空态 |
| 关注集合非空、帖子为空 | 保留频道横条，帖子区负责自己的单份空态 |
| 推荐集合成功且为空 | 不渲染推荐横条；全频道帖子流独立展示 |
| 推荐集合请求失败 | 横条区域显示错误和重试；全频道帖子流保持自身请求状态 |
| 我的频道／收藏为空 | 仅在对应资料库窗口内显示具体集合的空态 |

页面直接从原分页器的 `fetching`、`error` 和 `items` 单向派生上述状态。需要空态的分页器插槽提供实际业务组件，而不是空插槽。

## 请求与状态所有权

`channels.vue` 统一负责 Twitter 分支首页、发现、搜索及资料库分页器的首次初始化。对应的 `MkPagination`、`MkNotesTimeline` 显式使用 `autoLoad=false`，展示组件只回传重试、继续分页及导航意图。

页面的初始化集合只记录实例是否已经发起首拉，属于查询生命周期元数据；成功空集合与失败结果仍以原分页器事实为准。切标签、关闭搜索或重建窗口不会通过“集合为空”反复触发初始化。同参搜索复用已有搜索实例执行刷新，新参搜索创建新的原分页器。

既有 `useTwitterPaginatorRefresh` 继续调度回访与失效刷新；可见性条件对应实际主面板、搜索覆盖和资料库窗口。隐藏主面板不会消费其刷新意图，页面 KeepAlive 失活时停止当前入口初始化。业务集合、错误、游标和帖子仍由既有分页器持有；导航标识使用 `ui/twitter/domain/communities.ts` 的唯一类型。

关注横条沿用共享分页器的保守耗尽判断。其 `limit` 探测使用内部固定阈值，因此例如关注数为 15～19 时，仍可能多显示一次加载入口；请求空页后收起，不截断频道。此处不修改基础分页器内部逻辑。

## 来源与验证

配色、主列和通用间距沿用 Nitter 来源的 Twitter Token。Nitter 的 `src/views/community.nim` 提供单个社区详情页，不能据此推导 Home／Explore 聚合入口布局。横条专用尺度来自本地 X 归档的 Communities 模块及主题定义，提取锚点与替代原因见 [ADR-0015](./adr/0015-community-strip-layout.md)，现行映射见 [port-fidelity-audit.md](./port-fidelity-audit.md) 的频道节。

验收覆盖空关注、请求失败、横条溢出和继续分页、首页／发现数据源、同参搜索、管理／收藏及创建后回访。业务交互使用真实隔离后端；Mock 只用于协议或故障边界。视觉采样固定数据、视口、DPR 和缩放，覆盖桌面／移动及明暗主题；截图与 diff 供人工审阅，不自动成为已批准基线。

真实后端用例入口为 [twitter-communities.spec.ts](../../../packages/frontend/test/e2e/twitter-communities.spec.ts)，创建／收藏后的缓存回访由 [twitter-write-freshness.spec.ts](../../../packages/frontend/test/e2e/twitter-write-freshness.spec.ts) 覆盖。具体运行结果与截图 diff 随交付记录保存，不能由用例存在推定验收通过。

当前布局的代表性截图：[桌面首页](./assets/communities/after-home-1440.png)、[移动发现页](./assets/communities/after-light-explore-390.png)、[移动管理抽屉](./assets/communities/after-library-drawer-390.png)。发现页改造前后的同数据对比见[调整前](./assets/communities/before-explore-1440.png)、[当前实现](./assets/communities/after-explore-1440.png)及[差异图](./assets/communities/diff-explore-1440.png)；差异用于审阅预期布局变更，不表示已批准 X 像素级基线。
