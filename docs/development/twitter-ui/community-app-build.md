# 社区专用构建与 App 装配交接

本文描述当前 P1 实现。架构决策见 [ADR-0037](./adr/0037-community-app-build-boundary.md)。

## 交付范围

`build:community-app` 从现有 Twitter 根、社区路由及基础组件生成独立静态子制品，不启动 Misskey 后端，不读取 `.config/default.yml`，不依赖服务端生成 HTML。原站点继续使用原有构建命令。

P1 包含真实业务代码图，入口仅执行轻量 Bootstrap。没有真实 BFF 会话时，页面停留在等待宿主或需要会话状态，不挂载 Twitter 业务根，不恢复 Misskey 本地账户，不发起 API／WebSocket 请求，不注册 Service Worker。当前不能据此宣称登录、私信、业务就绪或 App 桥接已联调通过。

本次未修改宠物 App 的入口、路由、导航或呈现层，也未自动接入其翻转容器。App 仓库已有 P0 本地装配验证与本制品的接口对接仍由 App 开发同事完成。

## 构建与校验

从 Misskey 仓库根目录执行，使用仓库声明的 Node 和 pnpm 环境、已有锁文件安装依赖：

```sh
pnpm build:community-app
pnpm --filter frontend typecheck:community-app
pnpm --filter frontend test:community-app
pnpm --filter frontend verify:community-app
```

根构建命令依次构建 i18n、misskey-js、reversi、bubble-game 和图标子集，再编译前端目标。仅在这些依赖已构建时，才可直接运行 `pnpm --filter frontend build:community-app`。不需要执行后端构建或传入实例凭据。

输出位于 `built/community-app/`，包含 `index.html`、轻量启动模块、按语言生成的真实应用模块、CSS、字体、实际依赖的 Worker 等静态资源，以及 `community-artifact.json`；需要 WASM 时也必须随包交付并通过闭包校验。当前支持 `zh-CN`、`en-US`、`ja-JP`，权威列表位于 Bootstrap 的 `artifact.ts`；语言内容沿用原项目资源。

构建会拒绝外置模块、原站点启动入口及其他根 UI、缺失或越界的资源引用。原始 Vite 中间清单与未内联语言模块不会留在最终制品中。资源使用相对路径，支持 `/community/` 和更深的挂载前缀。

`verify:community-app` 使用真实输出目录，逐文件校验摘要及 MIME，再以 Chromium 在 `/community/`、`/app/community/` 两种深度验证 Bootstrap。无会话启动必须不访问账户存储、数据库、业务广播、WebSocket 或 Service Worker；校验也会检查非法宿主参数、重复配置、旧实例释放、语言切换与宿主存储哨兵。该命令不模拟 BFF 或用户，不证明业务行为。

制品及验证记录分别写入已忽略的 `built/`、`tmp/community-app-verification/`。不要提交这些目录或将执行报告放入源码文档目录。CI 或发布系统可将它们作为独立附件保存。

## 制品清单

唯一类型定义由 `packages/frontend/src/community-app/bootstrap/index.ts` 公开：

| 字段 | 含义 |
| --- | --- |
| `formatVersion` | 当前静态制品协议版本 `1`，不是运行时业务架构开关 |
| `bootstrap` | 相对制品根目录的轻量启动模块 |
| `application` | 语言代码到真实应用入口的映射；P1 不执行这些入口 |
| `styles` | 静态样式路径 |
| `supportedLanguages`、`bootMessages` | 已随包交付的语言与启动标签 |
| `sourceRevision`、`sourceDirty` | 构建时 Git 提交及工作树状态，仅用于装配追踪 |
| `sourceFingerprint` | 实际构建输入的 SHA-256，覆盖未提交及未跟踪源码；构建期间输入变化会失败 |
| `version` | 根项目版本 |
| `files` | 全部有效载荷的相对路径、字节数和 SHA-256；排除清单自身 |

摘要用于发现损坏和装配错配，不等于可信签名。App 应从受控构建渠道获取制品和清单，校验完整文件集合及入口，在自身 Vite 构建完成、清空输出目录之后，原样复制到 `dist/community/`，随后执行其既有 Capacitor Android 同步流程。禁止只复制 `index.html`，或混合不同构建的清单与资源。不可把源代码中的应用入口直接当成 React 组件导入。

## 宿主配置接缝

App 在本地同源子文档加载完成后，通过该子窗口的冻结对象 `window.__MISSKEY_COMMUNITY_BOOTSTRAP__` 交付参数。该 API 是装配接缝，不替代既有翻转消息协议；当前没有为其发送 READY、认证成功或业务 ACK。

公开方法：

| 方法 | 行为 |
| --- | --- |
| `configure(input, source)` | 验证实际父窗口和装配参数，成功配置一次并返回冻结快照 |
| `getState()` | 返回冻结的当前启动状态 |
| `dispose(instanceId)` | 只允许当前实例释放；释放后必须重新创建子文档才能装配 |

`configure` 参数来自宿主，须符合 `CommunityHostDependencies`：

| 字段 | 约束 |
| --- | --- |
| `instanceId` | 非空且不超过 128 字符；对应当前子文档实例 |
| `hostOrigin` | 与当前本地子文档实际 origin 严格相同，不允许 `null` 或通配符 |
| `assetBase` | 与当前子文档所在目录的绝对地址完全一致，以 `/` 结尾 |
| `canonicalInstanceUrl` | 真实社区 HTTPS origin，不附带路径、query、片段或凭据 |
| `apiBase` | BFF 的 HTTPS API 基地址，不附带 query、片段或凭据 |
| `wsBase` | BFF 的 WSS 基地址，不附带 query、片段或凭据 |
| `language` | 上述三种已交付语言之一 |

调用的 `source` 必须是实际父窗口；直接顶层打开该页面不能配置为已嵌入实例。H5 与 Android 本地 WebView 使用实际本地 origin，不能预先硬编码成生产社区 origin。参数中不传 Me、Misskey token、完整业务实体或环境探测结果。

启动阶段如下：

1. 本地页面加载后为 `WAITING_HOST`，尚无配置与业务副作用。
2. 合法配置后为 `SESSION_REQUIRED`，错误码为 `COMMUNITY_BFF_ADAPTER_REQUIRED`；这表示 P2 依赖尚未实现，不代表用户已登录或业务已就绪。
3. 通过父窗口来源校验后，依赖参数校验失败或当前实例释放会进入 `FAILED`。非法依赖参数未锁定实例，可修正后再次配置。错误来源、重复配置与旧实例释放会被拒绝并保留原状态；已经合法配置的实例不能再次配置。

App 可以观察这些状态展示装配进度，但不能以 iframe `load`、文件可读、API 对象存在或 `SESSION_REQUIRED` 推导社群业务就绪。

## 与原站点的边界

专用 Vite 目标复用无环境读取的编译配置，以固定适配器接管账户恢复、登录意图、退出、地址配置、路由及存储。原站点 Bootstrap、完整路由表、认证按钮与全局副作用宿主不进入输出图。旧 UI 的业务逻辑没有改为包内模式分支。

社区路由使用内部导航，物理子文档保持本地路径；仅显式编译允许的社区页面，不复用完整设置、管理和认证路由。未知路径有受控落点。需要账户管理的产品行为留待 P2 明确宿主意图与允许范围。

社区 LocalStorage、IndexedDB、BroadcastChannel 使用专属命名空间，禁止清空整个同源宿主存储。IndexedDB 操作失败直接传播，不额外新增持久化兼容路径。P1 不加载业务入口，因此不会初始化这些业务设施。

## 后续真实对接与验收

P2 必须由 Bootstrap 接收真实 BFF 会话适配器，再装配权威账户状态、API、上传、流连接、到期与退出处理，解除当前明确的会话门槛，并将真实业务生命周期连接到已有翻转协议。不能直接删除门槛或用假 Me、静态 token、Mock ACK 掩盖缺失依赖。

业务挂载之后，需以真实 BFF／Misskey 后端验证登录身份、首页、私信收发、前后台重连、会话过期和退出清理，再在 H5 与 Android 真机验证完整翻转、焦点和返回行为。当前静态闭包与无会话 Bootstrap 校验不能替代这些验证。

iOS 真机验收按当前范围后置。M09「减少运动偏好映射」仍为未验收通过的技术债，本次构建不将其标记完成。
