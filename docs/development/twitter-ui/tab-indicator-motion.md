# Twitter UI 横向标签指示条转场

## 范围与所有权

时间线、通知、频道入口首页／发现、频道详情及个人资料内容标签共用 `ui/twitter/components/TwitterTabIndicator.vue`，由 `ui/twitter/index.ts` 对外导出。每排仅有一个绝对定位的视觉指示条。

组件只接收 `activeKey: string | null`，保存 DOM 引用、测量结果及过渡所需的临时 UI 状态。现有页面或头部继续拥有选中值、路由、筛选、请求和业务交互；视觉组件不读取原始接口响应，也不新增业务状态副本。接口原始响应、路由字段或 DOM 几何不会反向参与业务决策。

原标签仍为现有按钮或 `MkA` 链接，保留点击范围、键盘焦点、ARIA 和导航语义。个人资料继续由现有路由派生选中态；频道详情继续消费 domain 给出的可见标签。重选当前标签的回顶和正文转场仍在各自所有者内处理；首页的 [正文与加载交接](./timeline-body-motion.md) 使用同一个已提交来源，指示条不驱动正文、请求或滚动时序。

## DOM 与几何契约

指示条和标签位于同一个定位容器内。各标签通过 `data-twitter-tab-key` 标记唯一展示键；指示条根据 `activeKey` 匹配节点。标记只用于 UI 定位，不承载业务模型。指示条设置 `aria-hidden="true"`、`pointer-events: none`，不增加交互或可访问性节点。

测量使用 `getBoundingClientRect()` 并保留 CSS 小数像素。水平方向按以下关系换算到容器的内容坐标：

```text
x = 标签.left − 容器.left − 容器.clientLeft + 容器.scrollLeft + 内缩
width = max(0, 标签.width − 2 × 内缩)
```

| 标签栏 | 双侧内缩 | 所有者 |
| --- | --- | --- |
| 时间线 | `12px` | `ui/twitter/TimelineHeader.vue` |
| 通知 | `14px` | `ui/twitter/NotificationsHeader.vue` |
| 频道入口 | `12px` | `pages/TwitterCommunities.vue` |
| 频道详情 | `12px` | `pages/TwitterChannel.vue` |
| 个人资料 | `12px` | `pages/user/TwitterUserTimeline.vue` |
| 私信收件箱（三个筛选按钮） | `12px` | `ui/twitter/messages/pages/MessagesPage.vue`；选中值来自 `state.inbox.kind`，筛选仍经原 Store Action |

内缩由现有标签栏的局部 CSS 参数提供；共享指示条统一使用 `var(--twitter-radius-pill) var(--twitter-radius-pill) 0 0`，仅上角圆、下角直，不提供页面级圆角覆盖参数。高度保持 `4px`、颜色保持 `--twitter-accent`。标签布局与命中区域不参与动画；个人资料容器保留 `position: sticky`，不被共享组件改为相对定位。横向溢出只调整标签栏自身的滚动范围，不移动 Shell 主滚动宿主。连续切换先中止该容器上一次未完成的平滑滚动，再以最新目标计算可见范围，避免旧目标将新选中标签滚出视口。

## 转场与生命周期

指示条通过 `transform` 横移并通过 `width` 适配目标长度，使用 `--twitter-duration-normal`（默认 `180ms`）和 `--twitter-ease`。连续点击时，浏览器从当前显示位置直接转向最新目标，不排队播放。内容和路由按原业务逻辑立即更新，不等待动画结束。

| 触发 | 呈现行为 |
| --- | --- |
| 同一有效标签集合中选中键变化 | 动画移动到最新目标 |
| 首次挂载或重新挂载 | 直接定位到目标 |
| 标签增删、容器／标签尺寸或字体变化 | 无动画校准 |
| 隐藏、离开文档或尺寸不可测量 | 不以无效几何覆盖已测量终态 |
| KeepAlive 停用／组件卸载 | 释放观察器并取消待执行任务 |
| KeepAlive 激活 | DOM 恢复后无动画校准 |

DOM 提交后使用合并的动画帧任务测量，不用固定延时猜测渲染完成。尺寸及节点观察只服务 UI 几何；不承担环境探测、前端 readiness 或制品身份判断。

关闭 Misskey 动画设置或系统启用 `prefers-reduced-motion` 时，直接更新正确终态。默认时长和缓动是当前项目参数，其依据与历史方案见 [ADR-0027](./adr/0027-shared-tab-indicator-motion.md)。

## 验证入口

终态检查固定视口、DPR、缩放、字体、主题及数据，确认标签按钮和主列位置保持一致，指示条落点与宽度符合原有内缩规则，并检查五排指示条的四角与高度一致。运动检查单独采样开始、中间和结束位置，避免将动画被截图工具快进后的终态当成转场证明。端点统一的决策见 [ADR-0029](./adr/0029-tab-indicator-shape-consistency.md)。

覆盖桌面和移动宽度、快速往返切换、动画关闭、频道动态标签、搜索关闭恢复及缓存回访。个人资料需保持真实链接、历史导航和 sticky；频道需同时核对选中值、ARIA、键盘焦点和面板关联。业务回归继续使用现有真实后端夹具，Mock 仅能证明协议或映射。用例是否通过以本次实际执行记录为准；局部视觉差异不自动成为正式视觉基线。
