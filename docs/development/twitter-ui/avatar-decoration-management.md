# 头像挂件管理

本文描述头像挂件管理页及新增／编辑弹窗的当前实现。设计决策和历史排查记录见 [ADR-0012](adr/0012-avatar-decoration-management.md)。

## 页面入口与职责

| 入口 | 页面／组件 | 职责 |
| --- | --- | --- |
| `/settings/avatar-decoration` | `pages/settings/avatar-decoration.vue` | 查看目录、试戴及管理本人佩戴；具有管理权限时显示管理入口 |
| `/avatar-decorations` | `pages/avatar-decorations.vue` | 实例挂件目录的读取、分类，以及新增、编辑、删除命令 |
| `/admin/avatar-decorations` | 同一管理页 | 管理路由别名，共用目录与操作逻辑 |
| 管理页的“添加”或挂件卡片 | `pages/avatar-decoration-edit-dialog.vue` | 未保存的表单、双背景预览、角色选择和提交反馈 |

管理页通过 `ensureSignin()` 获取当前账户，管理入口条件为 `isAdmin || policies.canManageAvatarDecorations`。缺少管理权限时显示权限说明；API 继续执行服务端权限校验。页面离开及账户身份检查用于阻止旧读取结果写回当前页面。

Twitter UI 使用从 `ui/twitter/index.ts` 导出的 `TwitterSettingsShell`；默认 UI 使用 `PageWithHeader`。两个外观分支共享同一份目录、工具栏、状态呈现和业务命令。工具栏提供数量、刷新和带文字的添加按钮。分类由目录派生为 `Map`，分类名称保持普通文本语义；卡片使用原生按钮，支持键盘操作。

## 目录与写入回执

目录的唯一页面状态位于 `avatar-decorations.vue`，类型直接使用 `Misskey.entities.AdminAvatarDecorationsListResponse`。分类、计数和卡片都是该目录的只读展示。编辑器接收实体及可等待的 `submit`／`remove` 命令，只保存临时草稿。

| API | 回执及当前处理 |
| --- | --- |
| `admin/avatar-decorations/list` | 返回目录；成功后替换本页目录，失败保留已有结果 |
| `admin/avatar-decorations/create` | 返回完整实体；创建确认后可加入该实体，随后重新读取目录 |
| `admin/avatar-decorations/update` | 没有实体响应；使用打开弹窗时绑定的 ID 更新，并重新读取目录取得最新实体 |
| `admin/avatar-decorations/delete` | 删除确认后移除已绑定的 ID，再重新读取目录 |
| `admin/roles/list` | 提供角色名称与新增候选；不会反向覆盖表单已选择的角色 ID |

创建请求类型直接使用 `Misskey.Endpoints['admin/avatar-decorations/create']['req']`。父页绑定待编辑或删除的实体 ID，表单不能改变操作对象。更新接口没有实体回执，因此请求字段不被拼接成“已更新实体”。

写命令开始时使旧目录读取失效。写入确认之后，目录刷新即使失败，提交命令仍按写入成功完成：编辑器关闭，管理页提示“已保存，列表刷新失败”或“已删除，列表刷新失败”，用户通过刷新取得完整目录。这个边界避免把刷新失败呈现为需要再次提交的创建失败。

## 加载与失败状态

| 状态 | 页面行为 |
| --- | --- |
| 首次读取中 | 显示加载状态 |
| 首次读取失败 | 显示错误说明及重试入口，不显示成功空态 |
| 已确认的空目录 | 显示空目录说明，并保留添加入口 |
| 已有目录刷新中 | 保留已有内容，刷新按钮禁用 |
| 已有目录刷新失败 | 保留目录并显示刷新失败提示 |
| 写入失败 | 编辑器保留草稿并显示错误；如果写入打断了尚未完成的首拉，恢复目录读取 |
| 写入成功、刷新失败 | 关闭已提交的编辑器，在管理页明确提示写入已确认及刷新失败 |
| 路由离开 | 取消读取、释放本页弹窗；已发出的写请求继续等待后端完成 |
| 路由回访 | 重新读取目录，包括上次结果为空的情况 |

挂载和首次激活共用 `activate()`，避免重复首拉。每次读取具有独立 `AbortController`；请求身份、页面活动状态和账户身份共同限制结果交付。失效响应即使迟到，也不能覆盖后续读取。

## 编辑器与表单

新增和编辑共用 `MkModalWindow`，桌面配置宽度为 `440px`、高度为 `620px`，视口约束及手机抽屉行为由既有模态组件处理。表单位于正文滚动区；保存、取消、删除及写入错误位于独立 `footer` 插槽。基础模态组件保留原实现。

Twitter 内容区域就地映射基础输入组件需要的主题变量。颜色、间距、圆角和触控尺寸复用现有 Twitter tokens；正文滚动条沿用全局 `scrollbar-width: thin` 和 `scrollbar-color` 规则。页脚自身的基础 `overflow: auto` 保留，实际是否发生第二处溢出由几何验收检查。管理页不把主路由滚动规则扩展到弹窗。

表单包括名称、图片地址、分类、描述和可用角色。名称与图片地址按现有请求协议检查非空；名称、地址和分类去除首尾空白，空分类提交为 `null`，描述保留输入内容。图片加载失败提供本地说明和重试，保留全部草稿；图片可访问性不构成额外的保存规则。

角色 ID 数组是选择的唯一依据，并从传入实体复制。角色目录仅用于显示名称和提供公开角色候选。元数据读取失败时保留已选择 ID，显示未知角色信息，仍允许用户明确移除该 ID。角色选择、删除确认、写入及关闭动画共用临时操作状态，防止重复提交或关闭中再次提交。

遮罩点击、Escape 和取消按钮进入同一个关闭处理。提交或删除尚未完成时，操作按钮禁用，关闭按钮隐藏；成功后关闭，失败后恢复可操作状态并保留草稿。删除操作使用 `os.confirm`，取消确认不会发送删除请求。

双背景预览使用同一图片草稿，分别声明亮色与暗色 `color-scheme`。验收读取最终 computed background color，并确认实际挂件图片成功解码。

## 验证入口

E2E 使用独立的真实测试后端，地址由既有配置固定为 `http://localhost:61812`。服务器、数据库和 Redis 由测试运行环境提前准备，参照 [前端测试说明](../../../.claude/skills/working-on-frontend/references/knowledge/frontend-testing.md)。测试调用测试实例的 `reset-db`，使用新建账户、真实角色和真实上传图片；成功业务响应全部来自后端。故障与竞态场景仅中断传输或延迟真实响应。

从仓库根目录执行：

```bash
pnpm --filter i18n generate
pnpm --filter frontend typecheck
pnpm --filter frontend exec playwright test --config playwright.config.ts avatar-decoration-manager.spec.ts
node scripts/check-shipping.mjs
```

测试文件 [avatar-decoration-manager.spec.ts](../../../packages/frontend/test/e2e/avatar-decoration-manager.spec.ts) 定义 14 个执行场景：

| 范围 | 断言 |
| --- | --- |
| 空目录与取消 | 中文入口、键盘打开、取消不写入、窄屏无横向溢出 |
| 完整管理链路 | 设置进入管理，经表单新增、选角色、编辑、删除，返回设置后核对目录 |
| 写入边界 | 回执延迟时阻止重复点击、Escape 和背景关闭 |
| 失败重试 | 创建失败保留草稿，删除失败保留目录，重试后核对真实结果 |
| 写成功后读失败 | 创建次数保持一次；更新通过重新读取取得实体 |
| 目录状态 | 首读失败重试、刷新失败保留结果、首拉被失败写入打断后的恢复 |
| 生命周期 | 旧响应在离开及回访之后到达，也不能覆盖新目录 |
| 兼容入口 | 默认 UI、两个管理路由、角色元数据失败后保留 ID |
| 桌面布局 | `1440px` 亮暗主题，双背景预览、正文滚动、固定操作区、全局滚动条计算样式 |
| 手机布局 | `390×844` 亮暗主题、`320×568`、打开后转为 `844×390`；失败提示与操作按钮可达 |

截图输出到 Playwright 的 `packages/frontend/test/e2e/artifacts/` 目录。截图与几何断言用于本次验收，生成截图不会自动批准视觉基线。手机场景使用 Chromium 的移动布局、触控和手机 UA；实体设备及 Windows 原生滚动条的外观需要相应环境的独立证据。

## 本次执行记录（2026-10-20）

本次变更位于 `fix/avatar-decoration-management`，基于提交 `406d94a608e1896d23404baf75b721094d8cd672`。最终代码完成以下验证：

| 项目 | 实际结果 |
| --- | --- |
| 前端构建及语言内联 | 通过 |
| `pnpm --filter frontend typecheck` | 通过 |
| 页面、编辑器及生成语言类型 Lint | 通过 |
| 新 E2E 文件 Lint | 通过；使用既有 `test/tsconfig.json` 提供类型信息 |
| 既有头像挂件单元测试 | 3 / 3 通过 |
| 管理页真实后端 E2E | 最终执行 14 / 14 通过，55.2 秒 |
| SPDX 检查 | 通过 |
| Locale safety | 未通过：规则禁止非日文语言资源变更，本次按已确认方案新增 `zh-CN` 文案；检查器未修改 |

E2E 截图前等待实际启动遮罩移除、字体就绪和已存在的有限动画结束；不关闭动画、不注入覆盖样式，也不放宽几何容差。下列文件为最终执行的实际截图：

| 证据 | 场景 |
| --- | --- |
| [管理页](assets/avatar-decoration-manager-desktop-dark.png) | `1440×1050`、中文、暗色、真实空目录 |
| [桌面新增编辑器](assets/avatar-decoration-manager-editor-desktop-dark.png) | 真实上传图片、双背景预览、独立页脚 |
| [窄屏编辑器](assets/avatar-decoration-manager-editor-phone-dark.png) | `320×568`，删除／取消／保存三个按钮 |
| [横屏写入失败](assets/avatar-decoration-manager-editor-landscape-error.png) | `844×390`，错误反馈及取消／创建按钮均在视口内 |

### 修复前后的像素对照

管理页对照采用同一 Chromium、`1440×1050` 视口、中文、暗色、空目录、相同用户名和同一实际上传的头像素材。隔离测试后端重启会清库，因此两个阶段分别建立真实测试管理员，账户 ID 不同。修复前使用上述基准提交中的两个管理组件，其他构建输入保持一致；两阶段均等待启动及有限动画完成后截图。

对 [修复前](assets/avatar-decoration-manager-comparison-before.png) 与 [修复后](assets/avatar-decoration-manager-comparison-after.png) 执行逐像素 RGB 比较，不设置容差阈值、不隐藏区域：变化像素为 **626,704**，全部位于管理页路由内容区域，内容区域以外变化像素为 **0**。两阶段测得路由内容区域相同：`left=378.5`、`right=976.5`、`top=2`、`bottom=1054`；统计范围按像素边界取整并限制在截图内。完整计算记录见 [像素对照数据](assets/avatar-decoration-manager-pixel-comparison.json)。

这一结果说明本组桌面空目录场景的变化限制在目标内容区域；它不等同于所有主题、浏览器和实体设备都已获得像素一致性验证，也不会自动批准新的视觉基线。手机验证使用 Chromium 移动模拟，未提供实体 Windows 或 Safari 原生滚动条外观结论。
