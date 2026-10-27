# 社区 BFF 契约与适配交接

本文面向 BFF 和宠物 App 对接开发者，描述当前社区专用构建中的控制协议、客户端适配与接入门槛。代码权威入口为：

- [协议包公开 API](../../../packages/community-bff-contract/src/index.ts)：控制 DTO、Schema、解析器、错误与端点。
- [Bootstrap 公开 API](../../../packages/frontend/src/community-app/bootstrap/index.ts)：宿主配置、启动、状态订阅和释放。
- [BFF 客户端公开 API](../../../packages/frontend/src/community-app/adapters/bff/index.ts)：HTTP、上传、流票据与链接预览。
- [唯一账户／实例状态](../../../packages/frontend/src/community-app/state/session/index.ts)：无凭据的权威事实与请求归属。

当前客户端可以通过宿主授权能力建立真实 BFF 会话，成功状态为 `SESSION_ESTABLISHED`，同时保留 `COMMUNITY_APPLICATION_ADAPTER_REQUIRED` 门槛。Twitter 业务应用尚未挂载；`requireCommunityApplication()` 仍明确拒绝。因此会话成功不表示页面、消息、未读、活动交接或翻转业务验收完成，也不能据此发送业务 READY／ACK。本仓库没有实现 BFF 服务或宠物 App 登录。

## 构建与交付

在仓库根目录执行：

```sh
pnpm build:community-bff-contract
pnpm --filter community-bff-contract typecheck
pnpm --filter community-bff-contract test
pnpm --filter frontend test:community-app
pnpm build:community-app
pnpm --filter frontend verify:community-app
```

首条命令必须先于依赖实体校验器的测试／类型检查执行。`pnpm build:community-app` 已将协议包构建加入依赖构建顺序。完整本地装配说明见 [社区专用构建](./community-app-build.md)。

生成物及用途：

| 路径 | 用途 |
| --- | --- |
| `built/community-bff-contract/openapi.json` | BFF v1 控制及转发接口说明 |
| `built/community-bff-contract/community-bff.schema.json` | 控制 DTO 的 JSON Schema |
| `built/community-bff-contract/misskey.openapi.json` | 当前 SDK 的权威操作、参数、响应及业务实体 Schema；移除本地服务地址 |
| `packages/community-bff-contract/built/entities.js`、`entities.d.ts` | 自包含实体校验器，供生产适配与状态入口复用 |
| `built/community-app/` | App 本地装配的社区静态制品 |

生成目录受 Git 忽略规则保护，不提交制品、测试报告、截图或验收结论。BFF 同事应使用同一源码版本生成的三份 JSON，不混用不同版本的 Misskey 定义。

控制类型、运行解析器及交接 Schema 均从 [domain Schema](../../../packages/community-bff-contract/src/domain/schema.ts) 单向派生。`MeDetailed`、`MetaDetailed`、`DriveFile` 等业务模型引用 `misskey-js`，不另建字段副本。实体校验器在构建时读取 `packages/misskey-js/generator/api.json`，经 Ajv standalone 和打包生成；生产运行不编译 Schema、不执行动态 eval，也不依赖 Ajv 运行时。

账户与实例执行完整结构、必填项、类型、枚举及组合 Schema 校验，不进行类型转换、补默认值或删除附加字段。实体通用格式检查关闭；控制协议另外检查 ISO 时间、规范实例 origin，以及 `me.id === accountId`、`meta.uri === canonicalInstanceUrl`。BFF 仍须执行完整上游语义及权限验证。控制 Schema 的自定义 `format: origin` 表示精确 HTTPS origin，BFF 校验器须注册等价检查：无凭据、路径、查询、片段及结尾 `/`。

## 认证职责与会话协议

App／现有认证后端负责登录、外部认证、重新登录与换号。BFF 持久化 App 用户到 Misskey 用户的唯一映射并保管 Misskey 凭据；重复申请授权、续期及重连不能重复创建 Misskey 用户。社区只使用专用短会话。

`bffBaseUrl` 是完整 HTTPS 协议目录，例如 `https://bff.example/community/v1/`；允许部署前缀，规范化后的目录须以 `/community/v1/` 结束，输入可省略末尾 `/`。协议版本属于接口路径，不作为前端架构开关。以下路径均相对此目录：

| 请求 | 授权与请求体 | 成功响应 |
| --- | --- | --- |
| `POST grants` | **宿主调用**，使用现有 App 认证；JSON `{ instanceId, sessionId? }` | `{ grant, expiresAt }` |
| `POST session/exchange` | **社区调用**，无 Bearer；JSON `{ instanceId, grant }` | `CommunityBffSession` |
| `POST session/renew` | **社区调用**，无旧 Bearer；JSON `{ instanceId, sessionId, grant }` | 同身份的 `CommunityBffSession` |
| `POST session/revoke` | 社区 Bearer；JSON `{ instanceId, sessionId }` | `204`，无正文 |
| `POST stream-ticket` | 社区 Bearer；JSON `{ instanceId, sessionId }` | `{ ticket, expiresAt }` |

这些 HTTP 请求均携带 `X-Community-Instance-Id`，JSON 请求携带 `Content-Type: application/json`。BFF 必须核对头、请求体、grant 与会话的绑定关系；实例标识本身不是授权依据。

grant 必须短时、单次使用，绑定宿主用户、装配实例及经验证的受众。`grants` 的宿主认证具体形式由现有 App／BFF 适配，社区不取得 App 长期 token。BFF 不得仅凭客户端声明的实例头或 Origin 决定身份。

续期使用宿主重新申请的单次 grant 重新授权，**不发送旧 Bearer，也不依赖其有效期**。通用 Bearer 到期中间件不能先行拦截该接口。`sessionId`、`instanceId` 只用于绑定核验；续期必须保持原 `sessionId`、`accountId`、`instanceId` 和规范实例不变。身份变化返回 `409 COMMUNITY_IDENTITY_CHANGED`；已撤销会话不可通过续期恢复。

会话响应包含 `sessionId`、`instanceId`、`accountId`、`canonicalInstanceUrl`、`accessToken`、ISO 字符串 `expiresAt`，以及完整真实 `me: MeDetailed`、`meta: MetaDetailed`。客户端拒绝已过期响应或身份不匹配。控制 DTO 禁止未声明字段，不能附带旧 `i`、token 或其他长期凭据。

社区 access token 仅保存在传输闭包内。Bootstrap 收到 `CommunityBffSessionView`，即剔除 `accessToken` 的只读投影；唯一状态所有者只安装账户、实例和不透明请求归属，不保存 BFF DTO、凭据或本地账户缓存。

## 业务传输

| 能力 | 当前请求约定 | BFF 处理要求 |
| --- | --- | --- |
| `POST api/{endpoint}` | 社区 Bearer、实例头；JSON 为原 Misskey 参数 | 校验准入与资源权限后注入服务端 Misskey 凭据，保留原始 `200` JSON／`204` 无正文，不增加 `data/result` 包装 |
| `GET api/{endpoint}` | 同样的头；省略 `undefined`，其余参数沿用 SDK `String(value)` 查询序列化 | 仅开放实际需要的 GET 操作，按当前上游 Schema 解释参数 |
| `POST upload` | 社区 Bearer、实例头；真实 XHR multipart | 接收 `file`、`name`、`isSensitive`、`force`，以及可选 `folderId`、`comment`；成功 `200` 返回原 `DriveFile` |
| `GET url-preview?url=…&lang=…` | 社区 Bearer、实例头 | 返回现有 Misskey `/url`／Summaly 响应结构；服务端执行外部 URL 访问与重定向策略 |
| `WSS stream?ticket=…` | 每次建立／重连先申请新票据，URL 只携一次性 ticket | 校验票据、来源、用户及会话；绑定真实上游后才完成可用连接，复用 Misskey 流协议 |

业务参数顶层拒绝 [统一禁止字段](../../../packages/community-bff-contract/src/domain/credential-fields.ts)，包括 `i`、token 类、`authorization`、`cookie`、`grant`、`ticket`、`password` 及原型入口。BFF 应执行相同约束，不能依赖前端检查。逻辑 endpoint 仅接受小写字母、数字、连字符及分段 `/`；路径形状检查不等于业务授权。

HTTP 使用 `credentials: omit`、`cache: no-store`、`redirect: error`。上传保留实际字节进度、取消句柄和原有文件校验；取消不证明服务端文件已删除。浏览器自动生成 multipart boundary，宿主不要手工设置 multipart `Content-Type`。链接预览的 `401/409` 执行认证错误映射，其他响应仍交原预览组件解释。

SDK 保留原频道池、订阅、心跳及重连行为，通过异步 URL provider 在每次连接前领票。浏览器 WebSocket 不使用 HTTP Bearer 自定义头；access token、App token、Misskey token 不得进入流 URL。BFF 必须在真实上游身份绑定完成后才让客户端连接进入可用状态，不得以仅建立 BFF 空壳连接宣称上游就绪。

图片、头像、附件、缩略图及预览资源沿用真实响应 URL，必须可由浏览器／Android WebView 实际读取。当前没有通用私有媒体授权适配；需要私有资源时另定义资源授权契约，不能通过在 URL 附加社区／App／Misskey token 临时绕过。

### 首期资源组与授权清单

以下是当前专用路由和共享组件实际使用的资源组，供 BFF 从现行 Misskey OpenAPI 核定逐项 allowlist。表中的分组不代表授权通配符，也不是全量路径自动开放清单。

| 资源组 | 当前调用端点或能力 |
| --- | --- |
| 账户、实例、用户与关系 | `i`、`meta`、`emojis`、`users/show`、`users/notes`、`users/featured-notes`、`users/following`、`users/followers`、`i/update`、`i/pin`、`i/unpin`；关注创建、取消及请求处理 |
| 时间线与帖子 | `notes/timeline`、`notes/local-timeline`、`notes/hybrid-timeline`、`notes/global-timeline`、`notes/user-list-timeline`；`notes/show`、`notes/replies`、`notes/conversation`、`notes/children`、`notes/state`；创建、删除、反应、收藏、投票等现有帖子动作 |
| 搜索与发现 | `notes/search`、`users/search`、`notes/featured`、`users/recommendation`、`pinned-users`、`hashtags/list`、`hashtags/trend` |
| 通知、公告与未读 | `i/notifications`、`i/notifications-grouped`、`notifications/mark-all-as-read`、`announcements`、`announcements/show`、`i/read-announcement`；未读状态回查 `i` |
| 频道、列表与收藏 | `channels/show`、`channels/search`、`channels/featured`、`channels/followed`、`channels/my-favorites`、`channels/timeline`、`channels/followed-timeline`、`channels/global-timeline`、频道创建／更新；`users/lists/show`、`users/lists/get-memberships`、列表成员动作与 `i/favorites` |
| 私聊与群聊 | `chat/conversations/list`、`chat/conversations/read`、`chat/contacts/show`；`chat/messages/user-timeline`、`room-timeline`、`show`、`search`、`create-to-user`、`create-to-room`、`delete`、`react`、`unreact`；群的 owned／joining／show／members、创建／更新／删除、邀请、加入／退出和静音 |
| 附件与辅助资源 | 上述专用 upload、url-preview；已使用的 `drive/files/show`、`drive/files/update`、`drive/files/delete`，以及响应携带的头像／媒体／缩略图 URL |

实时频道同样需要服务端准入与参数权限校验：

| 频道 | 归属及参数约束 |
| --- | --- |
| `main` | 当前认证账户的通知、未读、账户及聊天事件 |
| `chatUser` | `{ otherId }`，校验真实会话用户及私聊权限 |
| `chatRoom` | `{ roomId }`，校验群成员与实际权限 |
| `homeTimeline`、`localTimeline`、`hybridTimeline`、`globalTimeline` | 保留 SDK 当前过滤参数与实例策略 |
| `userList`、`channel` | 分别核对 `listId`、`channelId` 的读取权限 |
| `antenna`、`roleTimeline` | 共享时间线组件存在对应分支；只有产品实际启用且 BFF 核准时开放，核对 `antennaId`、`roleId` |

BFF 必须形成可执行的 endpoint／method／channel allowlist，并保留 Misskey 的账户、可见性、成员和资源归属校验。配套全量 OpenAPI 只是 Schema 参考；其中包含管理和认证操作，不构成社区授权范围。原 Misskey 登录、注册、OAuth／MiAuth 与管理 API 不因出现在共享代码或 OpenAPI 中自动开放。

## 错误、重试和隔离

BFF 控制错误严格采用 `{ "error": { "code": "COMMUNITY_…" } }`，不添加认证值、原始请求或自由正文。上游业务错误保留 Misskey `error` envelope 的 `id/code/message/kind/info` 消费语义；实际 `kind` 包括 `client`、`server`、`permission`。客户端仅生成安全投影，并移除 info 中的凭据／危险字段，不把整个原始错误正文写入 `Error.message`。BFF 也必须保证业务 message/info 不含秘密。

| HTTP 与错误码 | 当前客户端行为 |
| --- | --- |
| `401 COMMUNITY_SESSION_EXPIRED`，来自业务请求 | 合并续期任务；原请求仍失败，不重放原操作 |
| `401 COMMUNITY_SESSION_REVOKED`／`COMMUNITY_GRANT_INVALID` | 使身份失效、取消在途传输、关闭流并通知宿主 |
| `401 COMMUNITY_SESSION_EXPIRED`，来自不允许续期的控制请求 | 使当前会话失效 |
| `409 COMMUNITY_IDENTITY_CHANGED` | 结束当前身份，要求宿主新建实例／文档 |
| 普通 `403`、`429 COMMUNITY_RATE_LIMITED`、`5xx COMMUNITY_UPSTREAM_UNAVAILABLE` 或离线 | 保留身份并交付失败，不隐式退出 |
| 非 JSON 或无效错误 envelope | 固定协议错误，不回显原正文 |

客户端按状态和错误码组合决策；普通 `403/5xx` 即使带同名会话错误码，也不能触发注销。旧凭据代次的迟到错误不会破坏已经续期的当前会话。

客户端不自动重放发帖、消息、上传等写操作。到期时可在发送前续期；发送后的错误、断网或取消不能被解释为“服务端一定未写入”。业务层需查询真实后端确认结果，再决定用户后续动作。共享续期的单个等待者取消不会取消其他等待者；实例释放则同步取消其全部传输并拒绝迟到结果。

日志与诊断不得记录 Authorization、grant、access token、App／Misskey 凭据及含 ticket 的流 URL。上述凭据不进入 Store、账户模型、LocalStorage、路由、翻转消息或可序列化运行身份。

## 实际业务挂载前的已知待办

当前提供 BFF 控制与传输接缝，尚不能称整个业务图的网络已全部经 BFF 封闭。后续应用挂载需先处理以下实际存在的分支：

- [RSS 状态栏](../../../packages/frontend/src/ui/_common_/statusbar-rss.vue) 仍直接请求宿主根路径 `/api/fetch-rss`；本轮业务未挂载，因此尚不触发。启用该功能前应定义对应资源适配，不能让它落到 App 本地服务。
- [声音加载](../../../packages/frontend/src/utility/sound.ts) 仍动态拼接 `/client-assets/sounds/{type}.mp3`。后续须映射到社区本地制品目录，并验证网盘声音 URL；不能仅凭静态 import 资源闭包断言此路径已覆盖。
- [发帖表单](../../../packages/frontend/src/components/MkPostForm.vue) 存在可选多账户发帖的显式 token 分支。社区 `getAccounts` 已拒绝旧账户管理，默认发帖 token 为 `undefined`；多账户选择仍需宿主接管，不得恢复本地 Misskey token 或放宽 BFF 参数边界。
- [资料设置](../../../packages/frontend/src/pages/settings/profile.vue) 仍有头像装饰入口，但 `/settings/avatar-decoration` 未纳入当前专用路由；业务挂载前需明确该入口的宿主／社区路由处置。
- 公共媒体可能使用规范实例及 `meta.mediaProxy` 返回的远程来源，当前允许此类真实资源 URL。须按图片、音频、fetch 和 canvas 的实际使用验证 HTTPS、可达性与所需 CORS；它们不等于已改为 BFF 资源代理。

## 宿主接入顺序

当前覆盖同源 iframe 装配：父窗口与社区文档 origin 必须精确一致，不能使用 opaque／`null` origin。跨域 BFF 是网络传输边界，不是跨域父子文档直接控制。

1. 加载本地制品，取得子文档冻结的 `window.__MISSKEY_COMMUNITY_BOOTSTRAP__`。等待 iframe 加载完成后再调用，不修改 App 页面呈现。
2. 从真实父窗口调用 `configure(input, window)`，只提交下列字段：

   ```json
   {
     "instanceId": "community-instance-1",
     "hostOrigin": "https://app.example",
     "assetBase": "https://app.example/app/community/",
     "canonicalInstanceUrl": "https://social.example",
     "bffBaseUrl": "https://bff.example/community/v1/",
     "language": "zh-CN"
   }
   ```

   `assetBase` 必须精确等于当前社区文档所在目录；语言支持 `zh-CN`、`en-US`、`ja-JP`。配置不接受附加字段或任何凭据，成功进入 `SESSION_REQUIRED`。
3. 使用 `subscribe(listener, window)` 观察冻结快照；返回函数只取消本次订阅。快照仅包含 phase、instanceId、errorCode、language。`getState()` 可读取当前快照。
4. 调用 `start(sessionPort, window)`。`getGrant(request)` 必须返回 `Promise<string>`：宿主使用现有认证申请 grant 并只返回 `grant` 字符串。请求含 `instanceId`、可选 `sessionId` 及调用取消 `signal`；**signal 用于宿主网络取消，不序列化进 grants 请求体**。可选 `notifyAuthRequired(code)` 只提交宿主重新认证意图。
5. 启动经过 `ESTABLISHING_SESSION`，真实会话校验与状态安装成功后进入 `SESSION_ESTABLISHED`。当前仍带 `COMMUNITY_APPLICATION_ADAPTER_REQUIRED`；不要自动翻到尚未挂载的业务面，也不要把它改成 flip 协议 READY。
6. 首次成功建立会话前，启动失败可以在补齐真实授权后重试；并发启动共享同一任务。已经建立后，不在当前文档重新绑定另一账户。退出、撤销或换号使用当前实例 `dispose(instanceId)` 释放本地资源，并由宿主销毁 iframe；换号必须新 `instanceId` 与新文档。

`dispose` 同步结束本地生命周期，不能声称远端会话已撤销。需要远端退出时，社区内部公开 `revokeCommunitySession()` 发起撤销，远端失败仍清理本地并向调用方报告失败。App 登录是否注销始终由宿主决定。

当前安装的是文档内单一 realm：账户／语言等原模块存在单例捕获，不支持在原 iframe 原地切换用户。旧请求及流回执不得重新安装身份或写入新文档状态。

宠物 App 现有 peer 的 `prepare()` 仍只等待 flip 控制通道 READY，尚未对接本文的 configure／start／subscribe 接缝。App 同事需接入独立的会话及业务挂载屏障：在 iframe 加载后完成装配；未来实际业务挂载成功后，才允许该屏障放行翻转。现有 READY 继续仅表示控制通道及初始活动状态交接，不修改其语义、不复制另一套 flip 协议；当前 `SESSION_ESTABLISHED` 本身不能满足业务挂载屏障。

### H5／Android 网络配置

BFF 按实际 H5 站点与 Android WebView Origin 逐项配置 CORS，拒绝 `null`／任意通配来源。允许 `GET`、`POST`、`OPTIONS` 及 `Authorization`、`Content-Type`、`X-Community-Instance-Id` 预检头；错误响应同样返回正确的 CORS 头。当前客户端不依赖跨站 cookie。WebSocket 另行核对 Origin、ticket 受众与会话绑定，不能以 HTTP CORS 配置替代流授权。

Android 本地静态页面访问远程 BFF 时仍受实际 WebView 网络规则约束，不能假定宿主原生 HTTP 插件会接管 iframe 的 fetch／XHR／WebSocket。以实际安装包验证来源、证书、预检、multipart 和 WSS。

## 真实联调验收

协议单测只证明 Schema、参数序列化、取消及适配映射。生成完整结构的测试夹具不是真实用户，也不证明领域行为。本轮未提供真实 BFF／Misskey 业务验收结论。

BFF 服务可用后，按以下顺序对 H5 和 Android 安装包执行真实联调，记录后端请求与持久化结果：

1. 验证真实 App 认证到单次 grant、兑换与唯一 Misskey 用户映射；重放、过期和错误实例／受众全部被服务端拒绝。
2. 验证双用户隔离、同用户并发续期、过期后无旧 Bearer 续期、撤销、换号与迟到响应；旧会话不能更新新实例。
3. 验证完整账户／实例字段、权限与未读事实，正常业务 `403`、限流、断网及上游 `5xx` 不误退出。
4. 验证真实帖子／回复／反应／收藏、附件进度与取消、重复点击及不确定写入结果；核对真实落库，不以 Mock 成功代替。
5. 验证私聊、群成员权限、邀请、消息分页／搜索／发送／删除／反应、已读与未读对账，以及服务端 endpoint／channel 越权拒绝。
6. 验证流票据单次消费、首次／重连领票失败恢复、上游真正就绪、后台返回、断线重连和无重复事件；核对无长期凭据泄露。
7. 完成实际业务挂载、翻转应用就绪屏障与活动门控后，再验证隐藏社区的已读／通知／声音行为、实际翻转、取消及焦点交接。当前会话成功不能替代此步骤。

当前端侧范围是 H5 与 Android；iOS 真机验收后置。减少运动偏好映射 M09 仍为未通过技术债，不标记通过，也不以本次协议或构建测试消除。
