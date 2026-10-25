# 前端启动会话恢复

本文描述当前共享启动与账户恢复实现；决策背景见 [ADR-0006](adr/0006-startup-session-recovery.md)。该机制同时覆盖主页面与 `/share` 等子启动入口，不属于 Twitter 布局或设计 Token 实现。

## 启动顺序

`_boot_.ts` 在导入 `main-boot`、`sub-boot` 或账户应用模块之前调用 `boot/session` 的公共入口。此时只加载账户协议适配器、类型、翻译及样式，不创建 `$i` 或账户 Store。

无账户缓存时直接匿名启动。有缓存时，由同源 `POST /api/i` 验证显式提供的凭据；验证成功后更新当前账户缓存，再动态导入应用模块。`common()` 将已验证账户同步至既有保存账户列表，不再额外请求一次 `/api/i`。

每次验证均比较请求前后的账户缓存。期间其他标签页改变账户时，丢弃旧结果并重新读取当前会话。损坏的当前账户缓存仅移除该记录。

## 错误与恢复语义

| 结果 | 行为 |
| --- | --- |
| 无缓存 | 不发送账户验证请求，匿名启动 |
| `/api/i` 成功 | 使用后端账户信息与本次凭据恢复既有账户单例 |
| 明确的 `401 / AUTHENTICATION_FAILED` | 移除当前失效会话，调用既有账户模块清理对应保存记录，再匿名启动并提示重新登录 |
| 明确的 `USER_IS_DELETED` | 使用独立的账户删除提示，定向清理该会话 |
| `SUSPENDED`、权限不足或其他非撤销错误 | 不推断凭据已失效，不自动删除凭据；启动前展示脱敏错误码及重试入口 |
| 网络中断、超时、5xx、不可解析响应 | 保留账户缓存，展示可重试的启动状态 |

账户请求的网络等待上限为 10 秒。重试界面位于 Bootstrap，不导入 Vue 弹窗、业务组件或 Store；用户重试或其他标签页改变账户后重新验证。

失效恢复只处理目标账户的 `account`、`accountTokens`、`accountInfos` 与保存账户列表记录。清理前检查目标凭据，等待 Store 持久化完成，且不覆盖已变更的当前会话。其他账户、主题、语言、设备偏好及无关本地内容保留。

恢复不调用普通 `signout()`，不执行云端偏好备份，不调用 `localStorage.clear()`，也不删除整库 IndexedDB。重新登录已有账户时，同样更新其保存的凭据及账户信息。

## 配置加载生命周期

`Pizzax.ready` 保持既有本地初始化语义。`Pizzax.loaded` 对应远端账户配置加载，网络请求、状态映射与缓存持久化处于同一异步链中；网络失败或超时会拒绝，不伪装为成功，也不会因内部请求脱离外层 Promise 而永久 pending。

构造阶段立即观察并记录加载失败，防止消费方尚未挂载时产生未处理拒绝；原始 `loaded` 仍保持 rejected。`common()` 汇合基础 Store 与 Deck Store 的加载结果。若凭据在启动前验证之后被撤销，则定向恢复并受控重载，停止当前页面挂载。

其他配置加载失败保留本地设置并允许页面启动；账户向导仅在远端配置加载成功后执行，其失败链也被明确处理。未分类的真实启动错误仍由原有全局错误页处理，没有关闭 `unhandledrejection` 兜底。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `packages/frontend/src/_boot_.ts` | 会话验证与动态导入顺序、恢复后的提示 |
| `packages/frontend/src/boot/session/index.ts` | 启动前会话验证及可重试界面 |
| `packages/frontend/src/accounts/index.ts` | 无 Store 副作用的账户协议与类型公共入口 |
| `packages/frontend/src/accounts/domain/session.ts` | 复用 Misskey 权威模型的会话类型与只读凭据投影 |
| `packages/frontend/src/accounts/session-api.ts` | 显式凭据请求、响应校验及错误映射 |
| `packages/frontend/src/accounts.ts` | 既有保存账户列表、定向清理、登录与账户信息同步 |
| `packages/frontend/src/lib/pizzax.ts` | 本地及远端加载的 Promise 生命周期 |
| `packages/frontend/src/boot/common.ts`、`main-boot.ts`、`sub-boot.ts` | 共享启动结果及后续初始化的消费 |

不新增 Pinia、运行时架构切换配置、后端鉴权豁免或组件内环境探测。本修复针对启动与账户恢复链路，不提供所有业务 API 的透明自动重试。

## 运行中实时连接提示

Twitter Shell 通过共享系统宿主的 `streamIndicator` 插槽挂载专用提示，其他 UI 继续使用原默认组件。启动层 `ui/twitter/bootstrap` 观察既有 Stream 单例，只有已登录、开启实时模式且断线偏好为 `quiet` 时启用提示观察；`reload` / `dialog` 仍由原启动逻辑处理。

提示在页面前台持续处于 `reconnecting` 满 3 秒后显示。后台会取消等待并收起提示；回到前台时重新读取当前连接状态，连接已恢复则保持隐藏。连接恢复会清除本轮关闭标记，手动关闭只抑制当前连续断线；关闭观察门控结束当前展示观察。Shell 卸载时释放全部监听和定时任务。

该提示只表示传输连接状态。私信仍由原 Store 在前台恢复和 `_connected_` 时合并刷新收件箱、已加载消息窗口、群列表及未读事实，隐藏期间的对账不取得阅读租约。提示组件不执行业务请求，也不将连接恢复解释为业务数据已经同步。

展示生命周期单元测试为 `twitter-stream-notice.test.ts`；真实后端回归位于 `twitter-messages.spec.ts` 的 `stream recovery` 用例。测试只注入传输故障，业务响应来自隔离后端。真实后台可见性用例需要显示服务，通过原生 Chromium 与无默认焦点模拟的 CDP 连接验证；未设置 `DISPLAY` 时跳过这部分，普通传输回归仍执行。Android 后台冻结与网络回收行为需要另行真机验收。

[390px 持续断线提示截图](./assets/stream-recovery/mobile-disconnected.png)来自隔离实例的合成账户，用于检查提示和操作按钮的视口边界，不作为 P-19 正式视觉基线。

## 聚焦回归

协议与缓存解析单元测试：

```sh
pnpm --filter frontend test account-session-api.test.ts
```

真实后端浏览器回归：

```sh
pnpm --filter frontend exec playwright test --config playwright.config.ts session-recovery.spec.ts
```

浏览器测试必须运行在既有固定测试入口 `http://localhost:61812` 的隔离实例，使用测试数据库与 Redis；测试会重置该测试实例并签发、撤销测试账户凭据，不得指向开发或生产数据库。测试环境的部署及工具安装不属于业务代码职责。

回归覆盖匿名启动、有效缓存单次验证、真实失效缓存恢复、其他账户及设备设置保留、重新登录、网络中断后重试、配置加载失败、验证后立即撤销、旧失败响应晚于另一标签页的新会话，以及分享子入口。

Mock 单元测试只证明协议序列化与映射；失效会话和重新登录的结论来自真实后端。网络中断场景只注入传输故障，不伪造账户有效或无效的业务响应。
