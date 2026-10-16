# 匿名入口与业务应用外壳

本文描述当前实现。背景、取舍及有意偏离见 [ADR-0007](adr/0007-anonymous-entry-layout.md)。页面范围登记为 P-26；账户恢复机制仍见 [session-recovery.md](session-recovery.md)。

## 布局边界

`ui/twitter.vue` 是稳定的 UI 根宿主，提供路由、元信息、`DI.uiStyle`、`body[data-ui='twitter']` 及唯一的 `XCommon` 全局弹层宿主。`twitter` 表示视觉风格，不再意味着所有路由都挂载三栏业务布局。

- 未登录且当前路由名称为 `index`：挂载独立入口布局。布局在子页面创建前由现有 `$i` 与路由结果单向派生；不等待子页面上报元信息，也不保存第二份身份状态。
- 已登录内容路由：保留三栏／移动 Shell、原业务导航与发帖入口。
- 未登录公开内容路由：保留 RouterView 与公开内容；只挂载精简品牌链接及登录／注册按钮，不挂载登录专属侧栏、推荐栏、移动业务导航或发帖 FAB。

布局切换使用互斥挂载而非 CSS 隐藏。匿名入口不会因右栏、访客仪表盘而请求趋势、推荐、访客统计、联邦实例列表或访客本地时间线。共享宿主原有连接与错误提示机制保留，不承诺页面完全没有网络或 WebSocket 连接。

只有已选择 Twitter UI 的页面使用上述布局；原默认 UI 与其他 UI 不被切换成 Twitter。`?ui=twitter` 仍是既有展示选择，不构成登录凭据或权限依据。

## 欢迎页与认证

`pages/welcome.vue` 复用 `instance.ts` 的权威实例模型，仅持有本次信息加载与失败重试状态。先等待信息获取完成，再按以下顺序呈现：

1. `instance.requireSetup`：保留原 `welcome.setup.vue` 的管理员创建及实例初始化流程。
2. Twitter 上下文：渲染 `TwitterWelcome`。
3. 其他上下文：保留原 classic／simple 欢迎页选择。

`TwitterWelcome` 只读接收 Misskey 既有 `MetaDetailed`，呈现实例名称、品牌、简短入口说明、邀请码注册提示、登录／注册及关于／已配置条款链接。默认品牌使用项目已有的高分辨率 `backend/assets/icons/512.png`，不复用白色 Powered-by 字标。

`TwitterAuthButtons` 只持有防重复打开弹窗的临时 UI 状态。登录调用既有 `MkSigninDialog`，注册调用既有 `MkSignupDialog`，均使用原 `autoSet` 行为。用户名、密码、TOTP、Passkey、邀请码、服务器规则、邮箱确认和 token 持久化仍由原认证流程负责。本次不复制认证状态机、不增加登录接口、不修改基础组件内部业务逻辑。

没有增加归档中的手机号、Google、Apple 等未接入能力，也没有把原生用户名登录改称邮箱登录。`disableRegistration` 保留邀请码注册语义，而非无依据隐藏注册能力。联邦限制等完整注册说明继续位于原注册规则步骤。

## 设计参数来源

Nitter 的 `src/routes/unsupported.nim` 将 `/login` 路由映射到不支持功能页，无实际登录布局。因此本页使用用户提供的 `tmp/login_for_x` 作为有范围的补充来源；不改变时间线、帖子卡片等已有 Nitter 地面真值。

主要归档文件为 `x.com/index.html` 与 `abs.twimg.com/x-web/x-web/assets/styles-BA2hjDdO.css`。HTML 第 79／116 行包含宽屏／窄屏结构。可追溯映射如下：

| 归档对象 | 当前入口语义 Token／权威项 |
| --- | --- |
| `max-w-7xl`（1280px） | `--twitter-entry-max-width` |
| `max-w-[400px]` | `--twitter-entry-panel-width` |
| `max-w-96`（384px） | `--twitter-entry-actions-width` |
| `gap-5`（20px） | `--twitter-entry-action-gap` |
| `h-12`／`h-11`（48／44px） | `--twitter-entry-primary-height`／`secondary-height` |
| `text-[50px]`／`md:text-[64px]` | `--twitter-entry-title-size`／`title-size-wide` |
| `py-10`／`md:ps-9`（40／36px） | `--twitter-entry-block-padding`／`start-padding` |
| 内联 140px、紧凑 250px、宽屏 480px 品牌 | `--twitter-entry-inline-logo-width`／`compact-logo-width`／`brand-width` |
| `max-sm`／`md`（512／768px） | `TWITTER_LAYOUT_BREAKPOINTS.entryCompact`／`entrySplit` |

入口断点由 `domain/layout.ts` 单点定义，经 `use-entry-layout.ts` 提供只读派生值。现有业务布局的 500／1280px 断点没有变更，组件样式没有另写布局媒体查询。

入口颜色使用独立 Token 范围。实例品牌、文案、按钮能力、既有字体、描边颜色与页脚链接属于明确适配，不主张与 X 全页逐像素一致。两种布局复用一个表单入口内容，不为未提供的第三方能力保留 440px 空槽。

运行时代码不引用 `tmp/login_for_x`，不导入归档脚本、整套压缩 CSS、第三方登录资源或字体。归档只用于提取参数；取证重放需禁用脚本并限制为本地已保存资源。

## 验证

在隔离测试后端（固定测试入口 `http://localhost:61812`，测试数据库及 Redis）运行：

```sh
pnpm --filter frontend exec playwright test --config playwright.config.ts anonymous-entry.spec.ts session-recovery.spec.ts
```

测试会重置该测试实例并创建／撤销真实账户，不能指向开发或生产实例。范围包括初始化分支、匿名页面 DOM 排除与请求排除、宽度与断点切换、公开用户／帖子访问、真实登录、邀请码注册、失效缓存恢复、实例信息网络错误重试及原会话恢复回归。

匿名页面还检查完整可用高度、页脚位置、品牌资源和横向溢出，避免只凭“主应用已挂载”判断通过。截图保存到测试输出目录，包含桌面／窄屏及中文明暗候选。候选不是已批准的视觉基线；P-19 仍需人工确认后建立正式基线，后续用 diff 检验非预期变化。截图、源值测量和结构／真实业务断言不能相互替代。
