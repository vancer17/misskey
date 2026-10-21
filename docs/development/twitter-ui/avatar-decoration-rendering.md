# Twitter 头像挂件显示与素材坐标

本文描述 Twitter UI 当前的静态图片挂件显示规则。管理与佩戴流程见 [头像挂件管理](avatar-decoration-management.md)，决策及被替代方案见 [ADR-0013](adr/0013-avatar-decoration-rendering.md)。

## 组件和数据归属

`ui/twitter/components/TwitterAvatar.vue` 组合既有 `MkAvatar` 与独立挂件层，模块公共入口为 `ui/twitter/index.ts`。基础头像接收 `decorations=[]`，继续承担头像图片、链接、用户悬浮卡、猫耳和在线状态；挂件层不接收点击。包装组件不修改基础头像内部实现，不建立账户或佩戴状态副本。

用户模型与佩戴参数复用 `misskey-js`。`domain/avatar-decoration.ts` 只定义头像展示角色和从原佩戴类型派生的只读预览类型。本人身份通过现有 `useTwitterDisplayUser` 读取账户单例；样本预览沿用已有 `mock` 约定。图片加载失败仅影响该图片的临时显示，不移除已佩戴事实。

## 显示场景

| 头像位置 | `decorationContext` | 行为 |
| --- | --- | --- |
| 经 `MkNotesTimeline`、`MkStreamingNotesTimeline`、`TwitterUserTimeline` 接入的独立帖卡主作者 | `note` | 按用户偏好显示 |
| 纯转发实际展示的原帖作者 | 继承宿主的 `note` | 递归透传，不从 `embedded` 推断 |
| 独立时间线回复卡片的作者 | `note` | 不以 `replyId` 排除 |
| 帖子详情当前主帖作者 | `note` | 按用户偏好显示 |
| 个人资料横幅下的主头像 | `profile` | 按用户偏好显示 |
| 引用卡片、转发提示、折叠摘要、回复上下文 | `none` | 无挂件图层 |
| 侧栏、移动时间线头、通知、用户搜索和推荐 | `none` | 无挂件图层 |
| 用户悬浮卡、选择器、头像组、菜单、二维码、编辑资料等共享身份头像 | Twitter 分支传入空挂件 | 默认 UI 继续保留其既有行为 |
| 目录、管理编辑器和试戴 | 显式目标场景 | 强制预览只绕过隐藏挂件偏好，仍遵守静态图片和头像节流偏好 |

`none` 是包装组件默认值。独立列表宿主明确传入 `note`，纯转发保持这个展示角色；展示角色不参与转发、回复、权限或其他业务判断。

## 几何与裁剪

以下尺寸保持原页面基线，正式头像与预览共同消费 `tokens.scss`：

| 参数 | 桌面 | 移动 |
| --- | --- | --- |
| 帖子头像 | 48 × 48px | 48 × 48px |
| 帖子头像至正文 | 12px | 10px |
| 资料头像内容尺寸 | 112 × 112px | 80 × 80px |
| 资料头像边框 | 四边各 4px | 四边各 4px |

挂件画布保持原来的两倍头像宽度、向左和向上各偏移半个头像。单独的裁剪盒限制最终可见区域，头像本体和帖卡不增加裁剪规则。外溢额度如下：

| 场景 | 上 | 右 | 下 | 左 |
| --- | --- | --- | --- | --- |
| 帖子桌面 | 8px | 8px | 4px | 8px |
| 帖子移动 | 8px | 6px | 4px | 8px |
| 资料桌面 | 32px | 8px | 8px | 12px |
| 资料移动 | 32px | 8px | 8px | 8px |

帖子上、左边界来自 12px 内距减去 4px 保护间距，右边界来自现有正文间距减去 4px。下边界不越过距头像 4px 的线程连接线起点。资料左边界来自现有 16/12px 内距减去 4px，右、下边界来自 12px 间距减去 4px；上方使用横幅区域的 32px。参数只约束装饰，不推动文字起点、操作按钮或列宽。

图层顺序保持头像图像在下、挂件居中、在线状态在上。挂件上的 `rotate`、`scale`、`translate` 继续使用原有独立 CSS 属性，避免重写成组合 `transform` 改变变换顺序。旋转以一圈为 1，位移百分比仍相对于图片画布；重复佩戴按原列表顺序绘制。

## 素材制作

1. 使用正方形透明画布，中央头像参考区域的宽、高各为画布的一半。例如 1024 × 1024 画布中央放置 512 × 512 的头像参考圆；参考圆只用于制作，导出的挂件文件不包含参考圆和头像。
2. 图案围绕参考圆绘制，外部留白保留在文件中。原图画布的中心是位置原点，不能按非透明像素包围盒自动裁边、重新居中。
3. 仅上半部有图案的挂件仍保留完整画布及透明下半部。文件尺寸无需固定为 1024，必须保留画布与头像参考区域的比例。
4. 在帖子和资料两种目标预览中核对裁剪边界、邻接文字及 48px 下的清晰度。大幅旋转或位移超出边界时会被裁剪，佩戴参数本身仍保持原协议值。
5. 更换素材使用新的资源 URL，再更新原挂件 ID；不全局改变所有存量素材的缩放比例。

已校准的月亮圆环样例位于 [avatar-decoration-moon-calibrated.png](assets/avatar-decoration-moon-calibrated.png)。它保留完整透明画布，适用于原有两倍画布约定。运行时无需读取像素或推断图案锚点。

### 开发实例的已有素材更新

2026-10-21 已将 `vancer17` 正在佩戴的“紫色星月”替换为上述校准 PNG。挂件 ID `ask2kktrwg2t001m` 保持不变，文件沿用 1254 × 1254 的完整透明画布。通过既有网盘上传与挂件更新 API 写入新资源地址后，重新读取真实 `i` 投影确认同一 ID 已引用新图；匿名资料页也完成实际图片解码和截图检查。原素材文件保留，不覆盖旧 URL。

| 记录 | 值 |
| --- | --- |
| 原资源路径 | `/files/26213b2e-bc3c-49ba-bc0d-2e1369eb9ef0` |
| 新资源路径 | `/files/78435198-a243-4967-a81d-ee0f891ea3cd` |
| 新网盘文件 ID | `asl3vppax87p0006` |
| 校准 PNG SHA-256 | `c49f9fc5ea6a42e36c63065552050161df3f90f5f77ae037a003387ff6b98757` |

这些标识只记录本次开发实例操作，不进入组件、测试或业务配置。完整旧目录字段和新资源回执保存在本轮验收目录的 `live-material-backup.json`、`live-material-update.json`，不包含账户凭据。真实管理页面换图后的账户同步由下述隔离 E2E 单独验证。

## 预览与保存反馈

Twitter 管理编辑器及试戴提供“帖子头像预览”和“个人资料主头像预览”，共用 `TwitterAvatarDecorationPreview`。浅色、深色背景继续标注为预览；边界提示明确虚线以外的挂件不会显示。目录卡片使用正式帖子头像尺寸。

管理页写入后重新读取目录。若修改或删除的挂件正在当前账户上佩戴，再读取真实 `i` 回执，经既有 `updateCurrentAccountPartial` 更新账户的 `avatarDecorations`。不从表单 URL 拼出已更新的用户事实。账户刷新失败独立提示，不能把已成功的目录写入重新报为保存失败。

## 验证

真实后端验证使用 `packages/frontend/test/e2e/avatar-decoration-rendering.spec.ts`，与已有管理、佩戴回归共同运行。成功业务数据由隔离后端创建、上传、佩戴并读取，网络故障场景只中断真实请求。测试基础设施由外部运行脚本准备，不进入组件、领域模型或业务测试逻辑。

新增套件包含八项：真实佩戴／移除的 SPA 回访；纯转发、独立回复、引用与详情上下文范围；1440px、390px、320px 的正式／试戴精确几何与既有变换；隐藏及静态图片偏好；已佩戴素材换图后的同会话回访；换图已保存但账户读取失败的提示与重试。既有佩戴套件只调整侧栏关闭和可见裁剪边界两处预期。

视觉检查记录桌面、390px、320px 的明暗主题以及真实图片解码、头像和裁剪盒边界、正文位置。截图用于审阅当前目标结果；新截图本身不意味着视觉基线已被用户批准。

本轮范围限于已接入的消费点；47 项通过不代表所有遗留路由均已验收。

### 校准素材的最终外观

下列截图使用校准后的完整 PNG，由隔离后端真实创建、上传和佩戴素材。资料页同时展示主头像与独立帖卡，侧栏和移动导航不带挂件；管理编辑器切换到个人资料主头像场景。

| 宽度 | 资料页浅色 | 资料页深色 | 管理编辑器双背景预览 |
| --- | --- | --- | --- |
| 1440px | [浅色](assets/avatar-decoration-calibrated-profile-1440-light.png) | [深色](assets/avatar-decoration-calibrated-profile-1440-dark.png) | [桌面预览](assets/avatar-decoration-calibrated-manager-profile-1440.png) |
| 320px | [浅色](assets/avatar-decoration-calibrated-profile-320-light.png) | [深色](assets/avatar-decoration-calibrated-profile-320-dark.png) | [窄屏预览](assets/avatar-decoration-calibrated-manager-profile-320.png) |

320px 管理预览的内容宽度与滚动宽度均为 256px，两张背景卡片各为 122px，没有横向溢出。桌面对应为 408px、408px 和 198px。

真实开发账户资料头像的[素材替换前](assets/avatar-decoration-live-material-before.png)与[素材替换后](assets/avatar-decoration-live-material-after.png)均在本轮新渲染实现下截图，用于比较素材坐标校准，不代表旧代码与新代码的视觉基线对比。新截图保留头像在线状态在挂件上层的实际结果。

### 本轮执行记录（2026-10-21）

工作分支为 `fix/twitter-avatar-decoration-scope`，基线为 `6caad7ecfa27c76c19efbaf67732d851b88123a4`。前端工具链使用 Node 24.22.0；隔离后端使用与现有原生依赖匹配的 Node 22.23.3。后端、数据库和 Redis 分别使用 61812、54312、56312，测试没有连接开发数据库 5433 或开发 Redis 6379。

| 检查 | 结果 |
| --- | --- |
| i18n 类型生成 | PASS |
| 最终前端类型检查 | PASS |
| 前端生产构建与全部语言内联 | PASS |
| 变更源码及生成 i18n 类型 Lint | PASS |
| 两个变更 E2E 文件 Lint | PASS，沿用 `test/tsconfig.json` |
| 相关单元测试 | PASS，`avatar-decoration.test.ts` 3 项、`twitter-display-user.test.ts` 4 项，共 7/7 |
| 管理页 E2E | PASS，17/17 |
| 新展示范围／几何／偏好／账户同步 E2E | PASS，8/8 |
| 既有佩戴及回访 E2E | PASS，22/22 |
| 四个套件最终合并运行 | PASS，47/47，约 2.9 分钟 |
| Vue 组件审查 | PASS，修正包装层与基础头像的方形偏好初始化时机后，无未处理的阻塞问题 |
| SPDX | PASS |
| Locale safety | FAIL，仅报告本轮已授权的 `locales/zh-CN.yml` 修改 |

交付检查命令为 `node scripts/check-shipping.mjs --base 6caad7ecfa27c76c19efbaf67732d851b88123a4`，退出码为 1：Lint 与 SPDX 通过，Locale safety 失败。按已确认的中文界面要求保留文案，未修改或绕过检查器，也不把此结果记作整套交付检查全通过。

最终 E2E 同时运行 `avatar-decoration-manager.spec.ts`、`avatar-decoration-rendering.spec.ts`、`avatar-decoration-revisit.spec.ts`、`avatar-decoration.spec.ts`。临时运行配置继承仓库 `playwright.config.ts`，仅指定中文语言、现有 Chromium 可执行文件及输出目录；保留原有时限、单 worker、断言与真实后端协议。

首轮测试修正了三个测试时序／入口问题：等待纯转发卡片出现再检查默认折叠；轮询模态入场结束后的精确几何；偏好验证整页加载时保留显式 `ui=twitter`。新增展示套件没有放宽尺寸、关闭动画或伪造成功响应，其截图等待真实字体和有限动画完成；既有套件沿用原有截图策略。

日志、运行配置与完整截图位于开发工作区 `tmp/twitter-avatar-rendering-20261021/`。现有 backend 和 frontend-embed 构建没有代码改动，本轮沿用既有隔离运行资源；未声称重新构建这些未改动包。

验收完成后已关闭本轮启动的 61812、54312、56312 隔离服务，并恢复隔离运行目录原有的前端构建链接。开发服务 3000、5173、5174、5433、6379 均保持可达。收尾记录位于同一目录的 `final-cleanup.json`；该验收时点的工作区 `git diff --check` 通过，基础 `MkAvatar.vue` 无改动，分支基线未移动。
