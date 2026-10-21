# ADR-0014：头像挂件在素材管理入口完成静态校准

- 日期：2026-10-21
- 状态：采纳
- 范围：Twitter 头像挂件管理、静态素材导出与佩戴微调
- 当前实现：[头像挂件显示与素材坐标](../avatar-decoration-rendering.md)

## 背景

ADR-0013 保留原生两倍画布并限制绘制边界，解决了外溢与展示场景问题。后续人工检查仍发现圆环与头像视觉上不贴合。实际浏览器测量确认头像内容框与挂件画布中心一致；画布对齐不能证明图案内孔的中心和直径正确。存量试戴滑块每步为两倍画布的 2.5%，也不能精调约一像素的偏差。

直接换回原生 MkAvatar 使用同样的素材坐标，不能消除该问题。PAG 提供动画制作及播放能力，仍需正确的素材参考位置，并带来 Web 时间线多实例的资源管理工作，不能替代现有目录、权限、佩戴及账户事实。

## 决策

1. 保留原生目录、权限、上传、佩戴 Schema 和账户更新机制。在 Twitter 管理编辑器增加显式“校准当前素材”，复用仓库已有 Cropper.js 2.1.1；不修改基础 MkAvatar 或 MkCropperDialog 的内部逻辑。
2. 管理员对完整正方形画布内的原图做等比缩放和平移，导出 1024×1024 透明 PNG。中央头像参考圆直径为 512px。参考头像、圆线及棋盘只存在于编辑视图，不进入导出像素；不依据 alpha 包围盒自动裁边、居中。
3. 校准参数只是临时 UI 草稿，最终写入新图片像素。应用校准先导出、再上传；真实上传回执到达后只替换表单 URL，目录仍由原保存入口提交。保留原图及挂件 ID，不新增运行时 scale/anchor、持久化校准参数或新状态管理依赖。
4. 校准只接受可读取原始字节、且通过既有动画检测的静态 PNG/JPEG/WebP。动图、未知格式与跨域不可读资源保留既有使用路径；不静默展平动画，不用缩略图或静态代理充当原图，也不新增远程抓取服务。
5. 个人佩戴位移步长细化为 0.001，并提供数值输入。保持角度、位移、翻转的原协议单位和变换顺序；显示格式不反写或量化存量佩戴值。
6. 校准预览复用正式头像组件。已生成 PNG 的本地地址作为只读静态预览地址传入，使减少动态图片／节流偏好无需请求服务器代理浏览器 Blob；该投影不进入佩戴写入 Schema。
7. 本轮验证使用真实隔离后端，并检查服务端实际保存图片的透明度、尺寸、锚点和页面回访。截图及像素 diff 作为人工审阅材料；未经确认的截图不自动成为视觉基线。

## 后果

素材制作不再要求管理员在外部软件中预先计算透明留白，但仍需人工确认圆环内孔或其他佩戴位置与参考头像的关系。非圆形、非对称图案不会被自动改造成圆环。静态校准不承担动画转换或背景去除；PAG 在明确动态需求并验证列表及设备性能后另行决策。

## 前置素材及验收记录（历史）

以下为 ADR-0013 阶段的素材处理和验收记录，仅保留历史证据，不代表本轮校准编辑器的执行结果。

### 开发实例的已有素材更新

2026-10-21 已将 `vancer17` 正在佩戴的“紫色星月”替换为上述校准 PNG。挂件 ID `ask2kktrwg2t001m` 保持不变，文件沿用 1254 × 1254 的完整透明画布。通过既有网盘上传与挂件更新 API 写入新资源地址后，重新读取真实 `i` 投影确认同一 ID 已引用新图；匿名资料页也完成实际图片解码和截图检查。原素材文件保留，不覆盖旧 URL。

| 记录 | 值 |
| --- | --- |
| 原资源路径 | `/files/26213b2e-bc3c-49ba-bc0d-2e1369eb9ef0` |
| 新资源路径 | `/files/78435198-a243-4967-a81d-ee0f891ea3cd` |
| 新网盘文件 ID | `asl3vppax87p0006` |
| 校准 PNG SHA-256 | `c49f9fc5ea6a42e36c63065552050161df3f90f5f77ae037a003387ff6b98757` |

这些标识只记录本次开发实例操作，不进入组件、测试或业务配置。完整旧目录字段和新资源回执保存在本轮验收目录的 `live-material-backup.json`、`live-material-update.json`，不包含账户凭据。真实管理页面换图后的账户同步由下述隔离 E2E 单独验证。

### 校准素材的最终外观

下列截图使用校准后的完整 PNG，由隔离后端真实创建、上传和佩戴素材。资料页同时展示主头像与独立帖卡，侧栏和移动导航不带挂件；管理编辑器切换到个人资料主头像场景。

| 宽度 | 资料页浅色 | 资料页深色 | 管理编辑器双背景预览 |
| --- | --- | --- | --- |
| 1440px | [浅色](../assets/avatar-decoration-calibrated-profile-1440-light.png) | [深色](../assets/avatar-decoration-calibrated-profile-1440-dark.png) | [桌面预览](../assets/avatar-decoration-calibrated-manager-profile-1440.png) |
| 320px | [浅色](../assets/avatar-decoration-calibrated-profile-320-light.png) | [深色](../assets/avatar-decoration-calibrated-profile-320-dark.png) | [窄屏预览](../assets/avatar-decoration-calibrated-manager-profile-320.png) |

320px 管理预览的内容宽度与滚动宽度均为 256px，两张背景卡片各为 122px，没有横向溢出。桌面对应为 408px、408px 和 198px。

真实开发账户资料头像的[素材替换前](../assets/avatar-decoration-live-material-before.png)与[素材替换后](../assets/avatar-decoration-live-material-after.png)均在本轮新渲染实现下截图，用于比较素材坐标校准，不代表旧代码与新代码的视觉基线对比。新截图保留头像在线状态在挂件上层的实际结果。

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
