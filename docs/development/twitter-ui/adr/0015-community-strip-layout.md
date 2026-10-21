# ADR-0015：频道入口采用紧凑横条并分离管理列表

- 日期：2026-10-21
- 状态：采纳
- 范围：Twitter UI 的 `/channels` 入口展示与分页器初始化协调
- 当前实现：[频道入口布局与请求边界](../communities-layout.md)
- 替代：[ADR-0005](./0005-communities-ia-convergence.md) D1／D3／D4 的入口呈现细节；Home／Explore 数据源与详情页决策继续有效

## 背景

人工走查发现首页同时显示通用“无”、未关注引导与帖子空态；发现页混合推荐卡片网格、聚合帖子、完整管理列表与收藏空态，频道卡片还在两种网格中重复出现。搜索输入独立放在标题栏之后，与预期的顶部盒内搜索入口不一致。

此前首页从 pill 迭代为圆形缩略标识，发现推荐采用双列 `MkChannelPreview` 网格，管理／收藏通过默认展开的 `MkFoldableSection` 放在发现流之后。这些展示没有形成清晰的导航与内容层级。空 `<template #empty></template>` 也不能可靠屏蔽 `MkPagination` 的后备空态：Vue 将没有有效内容的插槽按缺省处理，仍渲染 `MkResult`。分页器又依赖展示组件自动首拉，重建展示子树会增加初始化冲突的风险。

此前“nitter 无 Communities／频道域”的宽泛结论也不准确：仓库中 `external/app/nitter/src/views/community.nim` 实现了单个社区的头部、导航和内容。当前未找到同本入口相同的 Home／Explore 聚合页；因此需要分别标记详情页可复用依据与入口的 X 行为依据。

## 决策

1. 频道入口使用“标题栏 → Home／Explore 标签 → 紧凑频道横条 → 聚合帖子流”。首页横条使用关注集合，发现横条使用推荐集合。两条帖子流继续使用 ADR-0005 已有的 `channels/followed-timeline` 与 `channels/global-timeline`，不新增后端端点或客户端聚合逻辑。
2. 紧凑卡片使用横幅与单行名称，宽 `132px`、横幅比例 `2.5`、圆角 `12px`，通过专用 Token 定义。颜色、主列与通用间距继续使用 Nitter 来源的既有 Token。卡片单行横向滚动，保留键盘、RTL、溢出箭头及原关注游标分页能力。
3. X 成员社区横条作为首页结构参考。X 归档中的 Explore 是主题入口；Misskey 推荐频道使用同形横条属于显式业务适配，不宣称其为 X Explore 的逐项复刻。截图物理像素受到页面缩放与 DPR 影响，不直接用作 CSS 卡宽。
4. 我的频道与收藏从主帖子流移到标题菜单开启的独立业务窗口。包装既有 `MkModalWindow`，沿用移动抽屉；创建入口仍受原权限约束，位于我的频道窗口内。基础 `Mk*` 组件内部业务逻辑不变。
5. 搜索由标题栏图标展开，输入保留在同一顶部盒子内。搜索结果继续使用频道实体端点与现有预览卡，不扩展为跨频道帖子全文搜索。
6. 页面从原分页器事实统一协调空状态。关注失败不派生为空集合；成功空关注只显示一份发现引导；关注非空才展示首页帖子区域。推荐成功为空时隐藏推荐横条；推荐失败和全频道帖子各自负责错误及请求状态。资料库空态只在对应窗口内显示。
7. `channels.vue` 为 Twitter 分支唯一首拉所有者，展示组件统一 `autoLoad=false`。实例初始化集合只表达生命周期，不存业务状态，也不由空集合反推初始化。保留既有回访刷新机制，依据实际可见面板合并刷新；同参搜索刷新原实例。

## 参数提取与证据限制

本地归档位于 `tmp/community_for_x`。以下锚点均来自保存的源文件，而非在线页面的当前版本：

| 源文件与锚点 | 可复核参数 |
| --- | --- |
| `abs.twimg.com/responsive-web/client-web/bundle.Communities.31d7158ad87d7faca.js`，模块 `119474` 的 `eE.container` | 卡宽为 `space36 × 3 + space24`；默认主题下 `36 × 3 + 24 = 132px`；圆角 `borderRadii.large`；边框 `borderWidths.small` |
| 同模块的 `eE.name`、`eM` | 名称区横纵内距 `space8`，`subtext2`、粗体、单行；横幅使用 `theme.aspectRatios.communityBanner` |
| 同模块的 `eO`、`eP.carousel` | 成员社区以 carousel 展示，并有底部分隔线；外部包装的 margin／padding 共同形成可见卡间距 |
| `abs.twimg.com/responsive-web/client-web/main.3df9dbfbc9c6567ba.js`，主题 `size.cornerRadius`、`size.spaces`、`aspectRatios` | `large=12`、`space36=36`、`space24=24`、`space8=8`、`communityBanner=2.5` |

归档 HTML `x.com/vancer17cfs/communities.html` 保存的是失败状态，不能提供成功页面的完整 DOM 测量。当前布局证据为脚本中的默认主题参数与用户截图；本轮 Misskey 浏览器截图、实际几何及 diff 用于验证实施结果。X 成功 DOM 的像素级对比仍不在现有证据范围内。

## 后果

频道列表回到帖子流上方的导航角色，管理／收藏具有独立内容边界。关注成功为空时不再叠加三份提示，标题搜索位置也由结构保证。参数来源可追溯到归档模块；后续若拿到不同字体或缩放条件下的实测结果，应先更新参数依据及验收记录，再调整 Token。

横条不包含大预览卡的统计浮层、管理员标记和更新时间；这些信息仍可在频道详情及原有搜索结果中查看。移动窗口行为和请求正确性继续依赖既有基础组件与分页器，真实后端回访及多轮操作必须纳入验收，不能用组件 Mock 测试代替。
