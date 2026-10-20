# 头像挂件设置

## 页面与数据归属

入口为个人资料编辑页的“装饰”，路由 `/settings/avatar-decoration`。Twitter Shell 继续负责页面滚动，挂件页不添加独立主滚动区。

当前头像与已佩戴列表读取现有账户单例；目录读取 `get-avatar-decorations`，按类别分组。目录加载、加载失败或空列表不清空已佩戴事实。管理入口为 `/avatar-decorations`，显示条件是管理员或 `canManageAvatarDecorations` 策略许可。

目录刷新期间保留旧数据；失败时显示重试。首次挂载与激活合并一次读取，缓存回访重新获取。页面停用时先使读请求失效再取消，旧响应不能覆盖后来的目录。

## 试戴与保存

点击卡片进入试戴；旋转、水平／垂直位移、水平翻转只影响局部预览。范围控件支持键盘方向键，可恢复默认参数。预览沿用 `MkAvatar` 的变换，其他已佩戴条目及重复 ID 的顺序保留。

提交由设置页调用 `i/update`。弹窗等待回执，保存中不允许重复操作或以 Escape／遮罩关闭；失败保留输入。确认回执通过既有账户更新入口写入，仅更新挂件字段。目录或角色变化导致回执与请求不同，页面同步实际结果并说明差异。

角色限定和已达上限时仍可浏览／试戴，新佩戴按钮禁用。已有条目可调整或移除。若新策略令已有数量超限，仍需减少到允许范围或全部移除；没有后端绕过规则。

图片失败由各业务卡片和试戴窗口独立展示，可重试，不更改基础头像组件。目录找不到已佩戴项时不伪造空 ID，只说明不可用并保留移除入口。

## 实现位置

- `packages/frontend/src/pages/settings/avatar-decoration.vue`：目录状态、页面结构、写入回执和账户更新。
- 同目录 `avatar-decoration.decoration.vue`：可访问卡片与局部图片反馈。
- 同目录 `avatar-decoration.dialog.vue`：临时试戴及可等待保存。
- `packages/frontend/src/utility/avatar-decoration/index.ts`：既有类型上的许可展示与请求字段映射。
- `packages/frontend/src/ui/twitter/tokens.scss`：实际被消费的挂件尺度。
- `locales/ja-JP.yml`、`locales/zh-CN.yml`：基础及简体中文提示；生成类型由 i18n 构建提供。

## 验证

外部流程启动独立测试实例（与开发实例隔离的数据库和文件目录），再运行：

```sh
pnpm --filter frontend test test/unit/avatar-decoration.test.ts
pnpm --filter frontend exec playwright test --config playwright.config.ts avatar-decoration
pnpm --filter frontend typecheck
```

单元测试仅验证写入字段、默认值、重复项及空集合。端到端用例创建真实账号、角色和透明 PNG 文件，覆盖空目录、管理回访、实际图片、试戴、失败重试、权限变化、重复挂件以及目录错误。网络拦截仅用于控制传输失败或真实回执交付，不构造成功业务数据。

视觉核对至少包含 1440px 桌面、390px 与 320px 窄屏，以及空态、目录、试戴和错误态。首次目标截图需人工确认，不能只凭生成了截图就宣称已通过批准基线的视觉回归。

手机抽屉用例使用手机 UA、移动视口与触控事件，覆盖 390×844 竖屏明／暗主题、320×568 小屏和打开后切换到 844×390 横屏。用例先验证弹窗铺满视口宽度并贴底，再验证试戴不写入、保存失败保留草稿、错误提示与操作按钮可见，以及重试后的真实佩戴结果。该浏览器模拟不替代 Android／iOS 真机、Safari 或软键盘核验。

设计取值与被替代方案见 ADR-0011。当前实例未配置挂件时出现空态是预期结果，不表示代码未生效。
