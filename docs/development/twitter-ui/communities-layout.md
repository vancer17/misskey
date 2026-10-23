# 频道入口布局与请求边界

`/channels` 的 Twitter UI 首页使用“顶部导航 → 关注频道卡片 → 帖子流”，发现页在顶部导航后直接展示全频道帖子流。频道详情和创建／编辑继续使用既有 `/channels/:id`、`/channels/new`、`/channels/:id/edit` 路径。页面展示由 `pages/TwitterCommunities.vue` 负责，所有查询仍由 `pages/channels.vue` 持有。

## 页面结构

| 区域 | 当前内容与数据源 |
| --- | --- |
| 顶部标题栏 | 返回、频道标题、搜索图标、管理菜单；打开搜索后，输入框占用同一标题栏内的标题位置 |
| 主标签 | 首页、发现；支持方向键与 Home／End，标签按钮和内容面板通过 ARIA 标识关联 |
| 首页 | `channels/followed` 频道横条 → `channels/followed-timeline` 聚合帖子流 |
| 发现 | `channels/global-timeline` 全频道帖子流 |
| 管理菜单 | 打开“我的频道”或“收藏”独立资料库窗口；创建入口位于“我的频道”内，沿用既有权限 |
| 搜索结果 | `channels/search` 频道实体列表，查询方式固定为 `nameAndDescription`，覆盖主标签内容区域 |

标题栏和主标签吸顶，频道横条随帖子区域滚走。搜索是标题栏内的按需展开入口；提交后显示结果，关闭搜索恢复原主标签。管理与收藏通过 `TwitterCommunityLibraryDialog` 包装既有 `MkModalWindow`，由 `os.popup` 的全局宿主承载，沿用桌面窗口和移动端抽屉表现。关闭或离开页面先执行基础窗口关闭流程，待 `closed` 后释放实例，防止焦点陷阱和 `inert` 残留。

首页横条对应 X 成员社区横条，频道集合严格来自真实关注关系。频道所属、收藏和参与人数分别表达不同事实。发现页只显示全频道帖子流，不请求 `channels/featured`；原界面的推荐标签继续使用该端点。

主标签采用两列等分布局，每个按钮保留完整半列点击区域。标签容器中唯一的共享指示条根据选中按钮测量位置，双侧内缩均为 `--twitter-space-3`（默认 `12px`），宽度由实际按钮宽度减去两侧内缩得到；高度保持 `4px`，颜色使用既有 Token，端点与其他共享指示条统一为上角圆、下角直。该几何规则与 `TimelineHeader`、`TwitterSearch` 的现行标签一致，空间关系参照 Nitter `timeline.scss` 的等分 tab 与随单元伸展的下划线。标签文字、字号和浏览器缩放不独立决定指示条宽度；点击、ARIA、焦点顺序及请求所有权仍由原标签实现负责。尺度来源见 [ADR-0021](./adr/0021-sidebar-capsules-and-community-tab-indicator.md)，端点统一见 [ADR-0029](./adr/0029-tab-indicator-shape-consistency.md)，共享指示条的横移、无动画校准和生命周期契约见 [横向标签指示条转场](./tab-indicator-motion.md)。

方向键、Home／End 从同一标签定义计算目标，将同一个目标值提交给页面所有者并用于定位焦点。选中标签、`aria-selected`、可进入 Tab 顺序的按钮与实际焦点应一致；组件不为键盘导航保留第二份选中状态。

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

横条禁止换行，采用原生横向滚动和滚动吸附；内容溢出且指针悬停或键盘聚焦时显示可用方向的箭头。触摸、Tab 聚焦和左右方向键均可访问超出视口的卡片，RTL 根据实际排版方向滚动。滚动动画同时尊重既有 `prefer.s.animation` 和 CSS `prefers-reduced-motion` 偏好。关注集合保留服务端游标，在末尾提供继续加载入口。

主横条只承担频道导航，统计、管理员信息和更新时间不进入紧凑卡片。搜索结果继续使用原有 `MkChannelPreview`；基础组件内部业务逻辑保持现有机制。

## 资料库窗口尺寸与状态

`TwitterCommunityLibraryDialog` 为“我的频道”和“收藏”共同提供只读列表。窗口调用 `MkModalWindow` 时使用 `width=600`、`height=650`、`heightMode="content"`。桌面对话框按内容自然撑高，并以 `min(650px, 100%)` 为上限；百分比约束来自原模态覆盖层的可用高度。列表较长时由窗口主体内部滚动，标题与关闭按钮留在主体之外。`650px` 是现有窗口参数作为上限的延续，不是 X 成功页面的实测高度。

基础窗口的 `heightMode` 默认仍为 `fixed`。只有实际类型为 `dialog` 且调用方显式选择 `content` 时，主体使用 `flex: 0 1 auto`、`min-height: 0` 和 `container-type: inline-size`，footer 不收缩；原根节点的 `contain: content` 保留。默认固定窗口和移动抽屉继续采用原尺寸与安全区规则。尺寸变化不介入焦点、Esc、遮罩点击、关闭过渡及 `os.popup` 实例释放。

### 我的频道定位

桌面“我的频道”水平对齐频道主列中心，纵向维持可用视口居中。`useCommunityDialogPosition` 在打开前读取页面根元素的 `getBoundingClientRect()`，以 `left + width / 2` 作为视口 CSS 横坐标，经响应式弹层参数传给 `MkModalWindow` 的可选数字参数 `dialogCenterX`，再由 `MkModal` 消费。收藏窗口沿用视口居中；真实手机继续使用原抽屉。

基础模态层通过非对称水平留白把可用区域中心放在目标坐标，窗口仍由原有 flex 与 auto margin 排版；狭窄空间自动收窄，安全留白沿用基础模态规则。缩放原点使用同一中心，不覆盖既有 `transform` 动画。遮罩仍覆盖全屏，业务组件不接管焦点或关闭机制。

窗口打开期间，尺寸观察器和祖先布局属性观察器，以及窗口／视觉视口事件驱动坐标重测；过渡或动画结束、中止时确认最终位置，同一帧内合并读取。关闭开始即停止观察并保留最后坐标供退出动画使用，页面销毁提供兜底清理。DOM 坐标仅是 UI 临时状态，不进入 domain、Store、路由或 Bootstrap。

标题、业务列表、紧凑状态和窗口主体统一消费 `--twitter-panel`，列表边界和交互继续使用 `--twitter-border`、`--twitter-hover` 等既有 Token。空态与错误态复用 `TwitterPageState`，由业务窗口在其公开根元素上局部设置 `min-height: 0`、紧凑内距和 panel 背景；不改变该组件在整页中的表现。

| 资料库状态 | 当前呈现 |
| --- | --- |
| 首次加载且无条目 | 紧凑加载指示，窗口标记 `aria-busy` |
| 成功空集合 | 仅显示对应的“没有我的频道”或“没有收藏”空态，不叠加结束提示 |
| 首拉失败 | 紧凑错误和显式重试，不显示空态 |
| 有条目且正在追加或刷新 | 保留原列表，状态区显示禁用的加载按钮 |
| 有条目且请求失败 | 保留列表；状态区提供错误说明和重试 |
| 已确认后续页 | 状态区显示“查看更多” |
| 非空且无后续页 | 状态区显示 `_channel.allShown` 对应的结束文案 |

原界面 owned 标签与资料库窗口共用 `useChannelLibraryFocus`。键盘触发追加后，加载期间先由稳定的状态容器承接被禁用按钮的焦点；完成后优先进入新增的第一条频道链接。失败时优先定位重试按钮，无新增条目时保留在当前操作或状态区域。仅记录触发时的 DOM 节点与阅读位置，不复制频道数据。用户已经移动焦点、窗口正在退出或页面已经隐藏时不抢回焦点。业务窗口在原生键盘事件上处理 Tab／Shift+Tab 的首尾循环，复用既有 `isFocusable` 判断可用控件；背景 `inert`、Esc 和关闭恢复仍交由基础窗口处理。

## 空状态与错误

| 查询结果 | 当前呈现 |
| --- | --- |
| 频道集合加载中 | 紧凑卡片骨架；首页不提前显示未关注引导 |
| 关注集合请求失败 | 紧凑错误和重试；不据此认定关注集合为空 |
| 关注集合成功且为空 | 仅显示一份未关注频道说明与“发现”入口；不挂载首页帖子空态 |
| 关注集合非空、帖子为空 | 保留频道横条，帖子区负责自己的单份空态 |
| 我的频道／收藏为空 | 仅在对应资料库窗口内显示具体集合的空态 |

首页、发现与搜索直接从原分页器的 `fetching`、`error` 和 `items` 单向派生状态。资料库从其唯一查询所有者派生共同的只读 `TwitterCommunityLibraryView`；需要空态的原分页器插槽提供实际业务组件，而不是空插槽。

## 请求与状态所有权

`channels.vue` 持有页面查询实例。Twitter 分支首页、发现、搜索及收藏仍使用既有分页器，页面统一负责其首次初始化；对应的 `MkPagination`、`MkNotesTimeline` 显式使用 `autoLoad=false`。展示组件只回传重试、继续分页及导航意图。

页面的分页器初始化集合只记录实例是否已经发起首拉，属于查询生命周期元数据；成功空集合与失败结果仍以原分页器事实为准。切标签、关闭搜索或重建窗口不会通过“集合为空”反复触发初始化。同参搜索复用已有搜索实例执行刷新，新参搜索创建新的原分页器。

### 所属频道的唯一查询

所属频道由 `ui/twitter/store/owned-channels.ts` 的 `createOwnedChannelsQuery()` 管理，实例只在 `channels.vue` 创建一次。原界面的 owned 标签和 Twitter 的“我的频道”窗口消费同一实例；页面不再同时持有另一个 `ownedPaginator`。原界面继续用 `MkChannelPreview` 展示实体，Twitter 窗口使用紧凑行，二者的首拉、追加和重试均交回这个所有者。

| 层 | 唯一职责 |
| --- | --- |
| `domain/communities.ts` | 导航、分页结果、请求状态和资料库只读投影；频道实体引用 `misskey-js` |
| `adapters/owned-channels.ts` | 调用 `channels/owned`，将预读结果映射为可见页和下一游标 |
| `store/owned-channels.ts` | 保存唯一已确认快照与当前请求，处理追加、刷新、失败及取消 |
| `pages/channels.vue` | 拥有查询生命周期，协调实际可见性、页面回访和交互意图 |
| `TwitterCommunities.vue`／`TwitterCommunityLibraryDialog.vue` | 传递及读取稳定的只读 computed ref，不复制实体数组、不发起请求 |

查询每页展示 10 条，接口请求 `limit=11`。返回超过 10 条才确认存在后续页；下一游标取最后展示的第 10 条 ID，后续请求使用排他的 `untilId`。预读的第 11 条不另建缓存，在下一页自然再次取得。返回不超过 10 条时，`nextCursor=null`；`hasMore` 由游标派生，不单独保存可变标记。此语义依赖 `channels/owned` 在应用所属用户与非归档过滤后取上限并完整打包响应，不新增后端端点。

已确认快照为 `null` 时表示尚无成功结果，成功的空数组则是一个有效快照。`initialize()` 仅处理 idle，初拉失败不会被窗口重开误当成尚未初始化；`retry()` 根据失败操作重放首拉／刷新或同游标追加。追加与刷新期间保留原列表，成功刷新才替换快照。重复追加被在途守卫拒绝；显式刷新建立新请求世代并取消旧请求，旧响应的成功、失败和清理均不能覆盖新请求。当前请求被取消时恢复此前已确认状态；页面卸载时取消请求并使旧响应失效。

资料库展示契约仅包含 `items`、`status` 和 `hasMore`。`os.popup` 的 props 接收稳定的 computed ref，窗口持续读取其 `.value`，不截取打开瞬间的值。收藏继续沿用 `channels/my-favorites` 的一次性原分页器，由宿主 computed 派生同一展示契约，`hasMore=false`，没有第二份收藏集合。

### 关闭、回访与其他查询

关闭资料库只结束展示窗口，不销毁所属频道查询；仅关闭再打开不会重新首拉。页面 KeepAlive 失活时停止当前入口初始化并留下回访意图；从创建或详情页返回后，相关查询在对应面板再次可见且空闲时刷新。

所属频道复用 `useTwitterRefresh`，其回调把 `AbortSignal` 交给 `reload`，`busy` 覆盖所有 loading 阶段，`initializing` 对应初拉，使已有首拉能够消费此前排队的回访意图。其他查询继续使用 `useTwitterPaginatorRefresh`。可见性条件对应实际主面板、搜索覆盖及资料库窗口，隐藏面板不消费其刷新意图；两种界面的所属频道只改变展示与可见性条件，不切换查询实现。

关注横条沿用共享分页器的保守耗尽判断。其 `limit` 探测使用内部固定阈值，因此例如关注数为 15～19 时，仍可能多显示一次加载入口；请求空页后收起，不截断频道。此处不修改基础分页器内部逻辑。

## 来源与验证

配色、主列和通用间距沿用 Nitter 来源的 Twitter Token。Nitter 的 `src/views/community.nim` 提供单个社区详情页，不能据此推导 Home／Explore 聚合入口布局。横条专用尺度来自本地 X 归档的 Communities 模块及主题定义，提取锚点与替代原因见 [ADR-0015](./adr/0015-community-strip-layout.md)，现行映射见 [port-fidelity-audit.md](./port-fidelity-audit.md) 的频道节。

资料库的查询和窗口高度决策见 [ADR-0016](./adr/0016-community-library-query-and-height.md)。X 归档不提供该管理窗口的成功 DOM，高度上限与状态表现按本节实现契约验收，不声称已有 X 像素级窗口基线。

首页专属横条和主列居中的定位决策见 [ADR-0017](./adr/0017-community-home-strip-and-column-dialog.md)。

验收要求覆盖空关注、请求失败、横条溢出和继续分页、首页／发现数据源、同参搜索、管理／收藏及创建后回访。主标签还需检查不同主列宽度、明暗主题及长文案下的等分点击区域和双侧 `12px` 指示条内缩，并保留方向键、Home／End 与搜索关闭后的标签恢复。所属频道分页使用以下稳定数据集核对可见数量与请求次数；若预读之后剩余频道被归档或删除，合法的空末页应保留原列表并进入结束状态。

| 所属频道总数 | 首屏条数 | 后续追加条数 | 完整读取请求数 |
| --- | --- | --- | --- |
| 0 | 0，显示空态 | 无 | 1 |
| 4 | 4，无更多按钮 | 无 | 1 |
| 10 | 10，无更多按钮 | 无 | 1 |
| 11 | 10 | 1 | 2 |
| 20 | 10 | 10 | 2 |
| 31 | 10 | 10、10、1 | 4 |

验收同时覆盖初拉失败后重开、追加失败及重试、快速重复点击、刷新替换追加、关闭重开、创建后回访和原界面 owned 标签。视觉验收包括桌面短列表自然高度、长列表内部滚动、矮视口不越界、明暗背景连续、移动抽屉安全区和代表性的默认固定高度窗口。使用键盘触发最后一页后，焦点应保持在当前模态内，下一次 Tab 能到达可见且可交互的元素；关闭后检查焦点恢复与 `inert` 释放。

业务交互使用真实隔离后端；Mock 只用于协议映射或故障边界。用例入口为 [twitter-community-library.spec.ts](../../../packages/frontend/test/e2e/twitter-community-library.spec.ts) 和 [twitter-communities.spec.ts](../../../packages/frontend/test/e2e/twitter-communities.spec.ts)，创建／收藏后的缓存回访见 [twitter-write-freshness.spec.ts](../../../packages/frontend/test/e2e/twitter-write-freshness.spec.ts)。这些链接标识验收入口，不代表用例已执行或通过；具体结果随交付记录保存。

视觉采样固定数据、视口、DPR 和缩放，覆盖桌面／移动及明暗主题。首页和发现结构的参考采样见[桌面首页](./assets/community-home-column/after-dark-1440-home.png)与[移动发现页](./assets/community-home-column/after-mobile-390-explore.png)；资料库窗口需按本节条件单独采样。截图与 diff 供人工审阅，不自动成为已批准基线，也不能以横条截图代替窗口验证证据。

资料库分页与内容高度的已执行结果见 [资料库验证记录](./community-library-validation.md)；当前首页／发现结构、主列居中、源码摘要及截图见 [首页与主列居中验证记录](./community-home-column-validation.md)。
