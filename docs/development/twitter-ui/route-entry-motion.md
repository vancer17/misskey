# Twitter UI 路由进入与稳定布局

## Shell 几何

`ui/twitter/domain/layout.ts` 定义同步路由展示分类，Shell 经轻量公开入口消费当前已解析路由。普通内容、私信收件箱、私信会话和现有宽管理页在页面模块交付前即可确定列宽与右栏展示。页面 `definePage` 元信息继续提供标题等展示，不参与 Twitter Shell 列宽决策。

普通登录内容页沿用现有主列、侧栏和右栏 Token；私信使用 [messages.md](./messages.md) 的有界共享工作区。`/admin/emojis2` 与 `/admin/job-queue` 保留其既有不显示右栏的宽页约定，其他管理页不扩大该规则。布局策略不解释用户实体、业务权限、接口响应或环境探测。

目标路由的加载占位和最终内容使用相同的外框。导航宽度、主列起点和右栏占位不等待异步页面注册，也不由透明度变化驱动。主滚动位置、私信内部滚动和移动底栏的责任见 [scroll-layout.md](./scroll-layout.md)。

## 右栏实例

登录账户首次实际需要右栏时才挂载 `TwitterRightRail`。手机布局及首次直接进入私信不会为了隐藏右栏而启动其卡片查询。挂载后，当前账户内暂时不显示的右栏使用 `v-show` 保留，退出可见布局和交互范围；回到需要右栏的页面时复用搜索、趋势和推荐关注的既有实例。

换号或登出卸载旧账户的右栏。Shell 不另建推荐业务缓存，不将 DOM 可见性当成接口数据。右栏尺寸观察只消费可见元素的实际高度；隐藏产生的零高度不覆盖有效吸顶尺寸，恢复可见后重新测量。右栏仍随普通主视口滚动，不创建另一条页面滚动链。

右栏可见时经同一动效模块的 `useTwitterVisibilityEntry` 轻淡入，原生动画标识为 `twitter-rail-entry`，从隐藏恢复时可重新播放；隐藏立即退出布局，不等待离场动画。其卡片生命周期不随这段展示动画重建。

## 路由内容淡入

Twitter 主 Shell 的路由内容采用轻量透明度交接：从 `--twitter-route-entry-opacity`（当前 `0.7`）到 `1`，时长消费标准 `180ms`，缓动消费 `--twitter-ease`。起始内容仍可见；动效不修改位移、缩放、布局、滚动、指针命中或键盘焦点。

`ui/twitter/composables/use-twitter-route-entry.ts` 经模块顶层公开入口提供主内容与单元素显隐动效。主内容动效作用于当前活动的真实路由 DOM，使用公开的浏览器动画能力；动画标识为 `twitter-route-entry`。Shell 的 DOM 协调只保留目标节点、观察与当前动画等临时 UI 数据，不接收业务实体、不调用查询、不改变页面或 Store 租约。

| 情况 | 主内容呈现 |
| --- | --- |
| Shell 初次显示 | 直接终态，不补播放进入动画 |
| 路由变更后显示新的加载占位 | 对当前真实占位轻淡入 |
| 加载占位交接为新的最终页面根节点 | 对当前最终内容轻淡入 |
| KeepAlive 回访并交接为目标根节点 | 复用既有页面，允许轻淡入 |
| 同一路由通知、保持同根的 query 更新或仍为同一根节点 | 不重复播放 |
| 快速连续导航 | 取消旧目标动画和观察任务，只处理当前目标 |
| 动画完成或取消 | 恢复完整透明度，释放动画引用 |
| 动画偏好关闭或系统要求减少动态效果 | 直接完整透明度；正在执行的动画立即取消 |
| 偏好重新允许动画 | 不补播放已经显示的内容 |

不通过完整地址 key 重建 RouterView，不复制旧页面树、不读取 Vue 私有字段，也不因展示动效增加另一份业务查询、消息订阅或阅读租约。共享 RouterView 及其 KeepAlive 继续拥有原实例；路由、请求和用户操作不等待动画完成。

匿名入口、匿名内容、存量原生 UI、实验叠层和独立页面窗口不接入此主内容动效。首页来源切换继续由 [时间线正文转场](./timeline-body-motion.md) 负责；[标签指示条](./tab-indicator-motion.md)、骨架、媒体与其他后代动画也不成为路由淡入的结束条件。

## 验证结果与边界

2026-10-25 在 Linux Chromium 完成以下验证。浏览器交互使用独立真实后端；视觉矩阵使用开发实例的现有核查账户和数据。传输闸门只延迟真实页面模块或响应交付，不替换业务响应，也不以 Mock 证明业务生命周期。

| 项目 | 结果 | 证明范围 |
| --- | --- | --- |
| `twitter-route-entry.spec.ts` | PASS，12 个独立用例分组完成 | 最终补验 6 个断点和暖导航 7 项；另 5 项证明冷首屏、主内容中间帧、快速导航、动态及启动动画偏好 |
| `twitter-messages.spec.ts` | PASS，完整 23 项 | 私信业务、草稿、显式标读、移动发送与往返位置恢复 |
| `twitter-scroll.spec.ts` | PASS，完整 4 项 | 既有主宿主、位置恢复、底栏及局部滚动边界 |
| `router-view.test.ts` | PASS，4 项 | 原路由出口、缓存及占位基础行为 |
| 前端类型检查与隔离 Vite 生产构建 | PASS | 新协调模块及实际生产编译，输出不覆盖运行中的开发制品 |
| 最终 ESLint | PASS | 全部本轮源文件与两个浏览器专项文件 |
| 独立 Vue 审查 | PASS，无阻断项 | 仅本轮三个 Vue 文件相对完整私信快照的增量；可访问性、样式、唯一业务实例和同步布局来源 |
| 固定视觉矩阵 | PASS，12 组／24 张原图 | 390、1440、1920px，明暗主题，真实通知模块等待与最终页面各阶段 |

路由专项分别在 `390／500／501／1279／1280／1440px` 逐帧观测。最终 6 个断点各采样 18–26 帧，暖导航采样 59 帧，均未出现错误布局、主滚动宿主替换或空路由出口。右栏真实初始化请求数在私信往返前后保持 `3 → 3`；恢复时原生动画实测 `180ms`，透明度按 `0.7 → 0.932668 → 1` 经过中间帧。主内容占位与最终页面也分别采样原生动画，不以终态截图替代动效证明。

已执行的动画边界包括异步冷首屏不播放主内容入场、快速导航取消旧效果、运行时启用减少动态效果立即取消且恢复后不补播、启动时系统减少动态效果，以及 Misskey 动画偏好关闭。暖导航同时检查右栏节点身份、隐藏后的 `inert`／ARIA 边界、搜索输入和原草稿；主内容淡入不重建页面或控制业务请求。

视觉矩阵固定中文、字体、明暗主题、900px 高度、浏览器时钟与现有数据，两版仅切换静态源码。最终 24 次捕获均无页面异常、静态 HTTP 失败、可见破图或横向溢出；前后消息与时间线摘要相同。全部 6 组新实现的等待／最终横向几何一致。移动的 4 组和桌面的 4 组最终画面 diff 均为零；4 组桌面等待阶段呈现预期的同步导航和右栏变化。矩阵固定减少动画，实际动画帧由上述独立专项证明。

| 代表场景 | 前 | 后 | 差异 |
| --- | --- | --- | --- |
| 1440px 暗色，真实模块等待 | [图片](./screenshots/route-entry-notifications-loading-1440-dark-before.png) | [图片](./screenshots/route-entry-notifications-loading-1440-dark-after.png) | [图片](./screenshots/route-entry-notifications-loading-1440-dark-diff.png) |
| 1920px 明色，真实模块等待 | [图片](./screenshots/route-entry-notifications-loading-1920-light-before.png) | [图片](./screenshots/route-entry-notifications-loading-1920-light-after.png) | [图片](./screenshots/route-entry-notifications-loading-1920-light-diff.png) |
| 390px 明色，最终通知页 | [图片](./screenshots/route-entry-notifications-settled-390-light-before.png) | [图片](./screenshots/route-entry-notifications-settled-390-light-after.png) | [图片](./screenshots/route-entry-notifications-settled-390-light-diff.png) |

本地执行材料位于未跟踪的 `tmp/twitter-route-entry-20261025/`：`route-entry-e2e-final.log` 和 `artifacts-final/` 对应最终 7 项；其余 5 项见此前 `route-entry-e2e-second-attempt.log`、`route-entry-e2e-remaining.log` 的通过记录，不能将分组结果写成单次运行 12 项通过。`messages-regression.log`、`scroll-regression.log`、`composable-typecheck.log`、`frontend-build.log` 与 `final-eslint.log` 保存其余执行结果；RouterView 单元测试结果由实际工具输出确认，没有独立日志。`visual/` 保存完整索引、捕获及像素／几何报告，`vue-review-report.json` 与 `final-source-sha256.json` 保存增量审查和当前源码身份。

SKIPPED：真实换号／登出后的右栏隔离及两个管理宽页本轮仅作源码核查，尚未进行专门浏览器验证；Safari、Windows 常驻滚动条和移动真机软键盘／触摸惯性尚未核验。固定视觉材料用于本轮审阅，不自动成为 P-19 全站批准基线。决策及被替代做法见 [ADR-0035](./adr/0035-synchronous-shell-and-route-entry-motion.md)。
