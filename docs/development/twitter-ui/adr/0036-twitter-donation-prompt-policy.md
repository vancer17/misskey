# ADR-0036：Twitter UI 取消自动捐赠提示

## 状态

已采纳（2026-10-25，项目所有者明确要求按方案实施）。本决策替代 [ADR-0002](./0002-product-decisions-leak-remediation.md) D3 中 B4 捐赠弹窗的保留处置；B3 公告决策继续有效。

## 背景

启动链会在账户注册超过三天、未选择永久关闭且未进入 `/miauth` 时检查捐赠提醒记录：记录为空或超过三十天便创建 `MkDonation`。提醒记录和永久关闭选择保存在当前浏览器本地，无痕新会话没有普通窗口中的记录，因此老账户登录也会触发提示。

此前 D3 将公告与捐赠弹窗一并保留并适配 Twitter 外观。当前产品要求取消 Twitter UI 的自动捐赠提示；原生 Misskey UI 继续沿用既有行为。

## 决策

1. 在 `boot/main-boot.ts` 的 Bootstrap 层，从实际选择根组件的 `switch (uiStyle)` 派生局部布尔策略；仅实际选择 Twitter 根组件时跳过整个捐赠提醒分支。保存的 UI、`zen` 和 `?ui=` 等入口覆盖均遵守原有选择顺序，不在组件内重复判断。
2. Twitter UI 不读取或写入捐赠提醒分支中的 `latestDonationInfoShownAt`、`neverShowDonationInfo`，也不创建 `MkDonation`。取消触发不伪装为用户选择永久关闭。
3. 保留 `MkDonation.vue` 及其他 UI 的原触发条件，不修改其内部业务逻辑。公告、更新提示、初始设定向导与源码可用提示继续由各自既有分支处理。
4. 不增加运行配置、feature flag、Store、领域类型或策略接口。捐赠弹窗是否自动创建是启动展示策略，由 Bootstrap 负责。

## 未采用的方案

- 用 CSS 隐藏弹窗：弹窗仍被创建，生命周期和遮罩等副作用仍然存在。
- 自动写入 `neverShowDonationInfo=true`：将产品策略持久化为用户选择，并影响同一浏览器切换到其他 UI 的行为。
- 删除所有 UI 的捐赠入口或修改共享组件：扩大本次 Twitter UI 修复范围。
- 在 Vue 业务组件内解释环境或重复选择 UI：启动策略与根组件选择可能不一致。

## 验证边界

使用真实后端账户和全新浏览器上下文，账户须满足原触发条件（注册超过三天），检查 Twitter UI 首次登录、刷新、重新登录及再次创建无痕上下文均不弹出捐赠提示；检查保存的 UI 与 `?ui=` 不一致时按实际根 UI 决定。

同条件进入原生 UI 应仍能触发捐赠提示，作为正向对照，避免新账户未达到三天门槛造成假阳性。Twitter UI 验证应同时确认两个捐赠提醒键未被自动写入；其他启动弹窗的存在不等同于捐赠提示回归。以上为验收要求，实际执行结果由本轮验证记录提供。

隔离实例的合成账户截图：[Twitter UI 无提示](../assets/donation-prompt/twitter-without-prompt.png)、[原生 UI 正向对照](../assets/donation-prompt/native-positive-control.png)。截图展示各自 UI 的验收结果，不作为 P-19 正式视觉基线。
