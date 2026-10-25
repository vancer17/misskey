# 私信工作区专项验证

验证日期：2026-10-25。范围为本地私信、已有群聊和 Twitter Shell 边界。开发实例与测试实例使用独立运行根目录；测试的 reset-db 仅作用于独立 PostgreSQL、Redis 和端口 61812，开发实例端口为 3000。

## 私信接入阶段自动化结果

本节记录私信初次接入的已执行结果；后续 Shell 尺度和导航一致性调整的专项结果单独列于下节，不由这些结果推定通过。

| 验证 | 结果与范围 |
| --- | --- |
| 后端真实集成 | PASS，`test/e2e/chat.ts` 8 项；105 个会话的聚合分页、权限 4xx、并发未读／全部已读／删除回退、实时事件、附件归属、搜索、群生命周期和成员深链 |
| 前端真实浏览器 | PASS，`twitter-messages.spec.ts` 最终完整运行 14／14，通过真实 Chromium 和真实后端验证，耗时约 1.6 分钟 |
| 普通 Shell 回归 | PASS，`twitter-scroll.spec.ts` 4 项：全宽视口、资料／详情返回锚点、移动底栏、存量叠层偏好 |
| 前端单元测试 | PASS，22 项；9 项适配器协议测试和 13 项语言发布验证，不作为业务行为证明 |
| TypeScript | PASS，后端源码／测试及前端 `vue-tsc --noEmit` |
| SDK | PASS，`pnpm build-misskey-js-with-types`；包括新端点、标读／搜索参数、群成员事实及错误协议 |
| 生产打包 | PASS，隔离输出及全量语言内联，不覆盖开发制品；既有动态导入／插件耗时警告不阻断构建 |
| Shipping | PASS，最终 changed-file ESLint、SPDX 与 locale safety；新增测试另外单独执行 ESLint，仅手动编辑日文源 YAML 和 fork 自有中文 JSON |

14 项浏览器场景包括 320／390／1440px 空态及主页入口、直接点击发送、双向实时与同账户另一设备未读、反应／删除、草稿隔离与返回、接收范围／拉黑／只读、历史与搜索分页及深链、真实账户策略更新、网盘附件、群邀请／加入／消息／静音／退出、收件箱分页深度、原生聊天，以及时间线／私信滚动边界。

发送不确定用例先通过 `route.fetch()` 完成真实后端写入，再仅丢弃传输回执。实际历史始终只有一条消息；页面保留草稿，重取历史和取消确认都不解锁重发，只有用户明确确认才解锁，解锁本身不会发送。没有伪造业务响应或直接注入 Store 状态。

群聊动态策略用例使用真实角色变更及真实 `i/update` 产生 `meUpdated`，验证当前页面停用发送／撤销阅读，而非宣称角色分配本身具有全站自动推送。

## Shell 一致性调整专项

本次范围为 [ADR-0034](./adr/0034-messages-shared-shell.md) 的导航、宽度、页头和收件箱筛选表现。以下均为调整后的实际执行结果；私信测试的 23 个用例按新增布局 9 项、原有业务 14 项分组覆盖，不记为一次完整运行 `23／23`。

| 验证 | 结果与范围 |
| --- | --- |
| 共享 Shell 与断点 | PASS，8 项真实浏览器布局用例覆盖 `320／390／500／501／1279／1280／1440／1920px`；与同视口时间线的居中外框和导航对齐、无横向溢出、宽桌面 `275px` 导航与最多 `950px` 工作区、`350px` 收件箱、紧凑桌面 `72px` 导航和最多 `600px` 单栏 |
| 跨断点调整窗口 | PASS，1 项 resize 用例保留草稿和 65 条历史的可见锚点；布局变化期间会话选择查询为 0、显式标读请求为 0，服务端未读仍为 true |
| 真实私信业务 | PASS，原有 14 项用例另行完整运行 `14／14`；覆盖收发、未读、权限、历史／搜索、深链、附件、群聊、草稿、原生聊天和不确定发送 |
| 普通 Shell 回归 | PASS，4 项分两次运行覆盖；全宽视口、资料／详情返回锚点、移动底栏，以及真实叠层偏好和设置往返 |
| 页头与筛选终态 | PASS，布局用例检查收件箱 `50px` 页头、三按钮唯一选中态和指示条终态中心；视觉几何报告确认页头标题 `18px`。共享指示条内缩 `12px` |
| 筛选键盘、快速切换与减少动画 | PASS，真实开发实例 `390／1440px × no-preference／reduce` 四组合；Tab 聚焦、可见焦点环、Enter 选择、三组同轮快速切换后的终态，以及实际筛选请求 `200`。系统减少动画时，按钮与指示条过渡时长均为 `0s`；无页面异常和聊天写操作 |
| 可视视口与 SPA 草稿 | PASS，`320／390／500／1440px` 各检查正常、缩小、上移三组 VisualViewport 几何，发送按钮仍在可视区域；四次真实 SPA 主页往返保留草稿，`pageErrors` 均为空 |
| TypeScript 与生产打包 | PASS，`vue-tsc --noEmit` 和隔离输出的生产 Vite 构建均退出 `0`；不覆盖开发制品，既有动态导入和插件耗时提示仍保留 |
| 视觉对比 | PASS，18 组场景成功采集，共 36 张 before／after 和 18 张 diff，已目视核对；同视口时间线的 6 组差异均为 `0%`，具体范围见下文 |
| Shipping | PASS，最终 changed-file ESLint、SPDX、locale safety；私信和滚动两份 spec 最后另行执行 ESLint 退出 `0` |
| 运行实例收尾 | PASS，已确认进程归属后停止隔离测试服务和基线 Vite；`runtime-health.json` 记录开发实例首页 `3000` 与 Vite 客户端 `5173` 均返回 `200` |
| 全部工作区空白检查 | BASELINE，`git diff --check` 仅报告此前未提交 SDK 生成物中 3 个 JSDoc 空行；保持生成器输出，不在此次样式修复中改写 |

新增布局和 resize 的 9 项均已覆盖通过。首次尝试完整私信用例时，`501px` 用例错误地把桌面侧栏的普通发帖按钮当作移动 FAB，运行在 6 项通过后停止。仅修正测试，区分桌面侧栏按钮与移动悬浮按钮，再聚焦运行其余 6 项并全部通过；之后原有业务 14 项完整运行通过。

普通 Shell 首轮为 3 项通过、1 项叠层断言失败。失败断言假设叠层不存在路由出口标记，但调整前 HEAD 同样带有该标记。仅更新测试以验证真实边界，未修改产品逻辑；聚焦回归确认偏好保持 true、出口高度为有界 `900px`、卡片数量随设置往返按 `1 → 2 → 1` 变化、新增卡片绝对定位且主滚动宿主 overflow 为 clip。

可视视口检查只合成浏览器几何，不模拟聊天 API，也不替代真机软键盘、输入法组合输入或 Safari。编辑器发送键偏好和输入法处理源码未因此次布局修复变更，不据此宣称这些设备行为已重新通过。筛选补验覆盖系统 `prefers-reduced-motion`，未单独核验 Misskey 内部动画开关；快速切换证明最终选中态与指示条一致，没有将终态截图作为正常动画中间帧的证明。

本次日志根目录为 `tmp/twitter-messages-shell-20261025/`：`messages-e2e.log`、`messages-layout-remaining.log`、`messages-business.log`、`scroll-regression.log`、`scroll-stacking-regression.log`、`viewport-geometry-report.json`、`typecheck.log`、`frontend-build.log`、`shipping.log` 和 `test-eslint.log`。筛选四组合证据为 `visual/filter-interaction-report.json`。

### 本次视觉材料

基线是共享 Shell 调整前的**完整、尚未提交的私信实现快照**，包含当时新增文件；对应 `baseline-manifest.json` 记录源文件哈希。它与下节从 HEAD 原生页面起步的初次接入对比不同。对比只转发 `/vite/**` 静态资源，聊天接口始终连接开发实例 `3000`，不伪造 API 响应、不新增消息、不重置数据库。

矩阵为时间线、收件箱、私聊 × `390／1440／1920px` × 明／暗，共 18 组 before／after／diff，固定同一账户、数据、字体、DPR、视口和时间。所有 36 张 before／after 已通过六张联系表目视核查，并放大检查代表场景；时间线 6 组 diff 均为 `0%`。保留测试账户的时间线在两版均为空，这部分视觉对照证明 Shell、头部和空态未变，真实帖子与滚动行为另由浏览器用例验证。变化比例只描述差异，不是自动批准视觉基线的阈值。

完整索引为 `tmp/twitter-messages-shell-20261025/visual/index.html`，采集、几何、差异和目视结果分别保存在同目录的 `capture-report.json`、`geometry-report.json` 和 `diff-report.json`；代表性材料随文档保存如下。本次对比不建立 P-19 正式全站视觉基线。

| 代表场景 | 调整前 | 调整后 | 差异 |
| --- | --- | --- | --- |
| 桌面收件箱，1440px 暗色 | [before](./screenshots/messages-shared-shell-inbox-1440-dark-before.png) | [after](./screenshots/messages-shared-shell-inbox-1440-dark-after.png) | [diff](./screenshots/messages-shared-shell-inbox-1440-dark-diff.png) |
| 桌面会话，1440px 暗色 | [before](./screenshots/messages-shared-shell-conversation-1440-dark-before.png) | [after](./screenshots/messages-shared-shell-conversation-1440-dark-after.png) | [diff](./screenshots/messages-shared-shell-conversation-1440-dark-diff.png) |
| 移动收件箱，390px 明色 | [before](./screenshots/messages-shared-shell-inbox-390-light-before.png) | [after](./screenshots/messages-shared-shell-inbox-390-light-after.png) | [diff](./screenshots/messages-shared-shell-inbox-390-light-diff.png) |
| 宽桌面会话，1920px 明色 | [before](./screenshots/messages-shared-shell-conversation-1920-light-before.png) | [after](./screenshots/messages-shared-shell-conversation-1920-light-after.png) | [diff](./screenshots/messages-shared-shell-conversation-1920-light-diff.png) |

## 私信初次接入视觉材料

专项对比使用私信初次接入前的 HEAD `f7570ee563298732c3950de85fddc14af07bc24a` 源码及该阶段实现。基线源码只在忽略目录归档，通过独立 Vite 5175 提供静态模块；两版访问同一个开发后端及同一组授权测试账户，固定浏览器时间。静态模块转发不替换聊天、用户或权限接口响应。

矩阵为收件箱、私聊、用户主页 × 390／1440px × 明／暗，共 12 组 before／after／diff。差异图用于审阅预期改版：聊天采用独立工作区，主页增加联系按钮，导航增加私信。它们没有被预先批准为 P-19 正式全站视觉基线。

本地完整索引：`tmp/twitter-messages-20261025/visual/index.html`。该目录包含运行日志及完整材料，不随代码提交；代表性截图随本文档保存在 `screenshots/`。

| 代表场景 | 变更前 | 变更后 | 差异 |
| --- | --- | --- | --- |
| 移动私聊，390px 暗色 | [before](./screenshots/messages-conversation-390-dark-before.png) | [after](./screenshots/messages-conversation-390-dark-after.png) | [diff](./screenshots/messages-conversation-390-dark-diff.png) |
| 桌面收件箱，1440px 暗色 | [before](./screenshots/messages-inbox-1440-dark-before.png) | [after](./screenshots/messages-inbox-1440-dark-after.png) | [diff](./screenshots/messages-inbox-1440-dark-diff.png) |
| 用户主页，390px 明色 | [before](./screenshots/messages-profile-390-light-before.png) | [after](./screenshots/messages-profile-390-light-after.png) | [diff](./screenshots/messages-profile-390-light-diff.png) |

## 人工核查与平台边界

开发实例保留普通测试账户 `dm_audit_alice`、`dm_audit_bob` 及一组核查群聊，便于从主页按钮或 `/chat` 进入。登录信息仅保存在权限 0600 的本地忽略文件 `tmp/twitter-dm-audit-20261025/manual-accounts.txt`，没有进入源码、文档或截图。

Linux Chromium 的实际点击与几何检查覆盖 320／390／500／501／1279／1280／1440／1920px。可视视口缩小和上移的补充检查仅合成 VisualViewport 几何，没有伪造聊天 API，不能代替真机软键盘、输入法和 Safari 核验。全仓库构建、全量广域测试及这些设备检查未在本专项中声明通过。

后端 Vitest 退出码 0，仍报告既有测试框架关闭等待提示；没有 Redis 关闭后继续执行聊天延迟通知的异常。自动生成的 SDK JSDoc 保留原生成器的空行格式，没有手动改写生成物。

初次接入的本地复查日志位于 `tmp/twitter-dm-audit-20261025/`：`frontend-e2e-final.log`、`scroll-regression.log`、`frontend-unit.log`、`frontend-build.log`、`production-locales.log`、`sdk-build-final.log`、`shipping.log`；该阶段后端最终日志为 `/tmp/dm-backend-e2e-final.log`。

CHANGELOG 候选：Enhance: 统一 Twitter UI 私信的导航、工作区宽度、页头和筛选标签样式。
