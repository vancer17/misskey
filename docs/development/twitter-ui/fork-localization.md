# Fork 自有功能的简体中文文案

Twitter UI 的头像挂件素材校准继续通过 `i18n.ts._avatarDecorationCalibration` 读取文案。日文源键及 `Locale` 类型沿用现有语言体系，简体中文补充资源位于 `packages/i18n/src/resources/fork/zh-CN.json`。该文件只补充此命名空间，不承载其他功能或语言。

`locales/ja-JP.yml` 以外的 locale YAML 由 Crowdin 管理，不手动修改。Fork 补充资源随 `i18n` 包构建复制到 `built/resources/fork/zh-CN.json`，在每次生成语言快照时从文件重新读取。开发监听覆盖补充文件的新增、修改和删除；删除源文件会同步删除副本，重新生成原生回退结果。

语言加载器先去除原始语言资源中的空值，再校验补充资源并合入简体中文目标副本，随后执行既有日文、英文、主语言和目标语言的回退合并。主语言继承仍读取原始资源，因此其他语言不消费简体中文补充。开发页面、独立语言 JSON、Service Worker 和生产内联脚本共同使用这一结果，组件不维护额外字典或判断语言。

补充资源的键集合取自日文源中的 `_avatarDecorationCalibration`。不接受其他命名空间、未知键、空字符串或非字符串值。原始中文资源已经具有同名有效译文时，构建会报错并要求删除对应补充项；比较发生在回退合并之前，因此日文或英文回退内容不会被当作正式中文译文。

正式中文翻译可以逐项接管：先移除对应补充项，再接收正式翻译。所有键均由正式翻译提供后，删除补充文件和对应的读取、校验、复制、监听接入，并保留语言发布及页面回归验证。

首次启动必须具有有效语言资源。若首次模块加载就因非法资源失败，修正后需要重新启动 i18n 构建；首次成功加载后的非法编辑会保留已发布快照，修正后可由同一监听进程继续发布。

## 验证

- `packages/frontend/test/unit/locale-publication.test.ts` 在独立目录验证真实语言构建、正式翻译冲突及逐项接管、非法补充拒绝、同进程重新读取和完整 JSON 发布。
- `packages/frontend/test/e2e/avatar-decoration-material.spec.ts` 连接真实隔离后端，验证中文入口、弹窗说明、数值标签、操作、加载及失败反馈，并确认日文会话保留日文。
- 校准弹窗在 1440／390／320px 的明暗主题下验证换行、横向溢出与操作区可达性，截图仅作为人工审阅材料。
- 发布时重新构建 `i18n` 和前端生产语言内联；类型检查、变更文件 ESLint、SPDX 与 locale safety 均执行仓库既有检查。

局部中文界面的审阅材料如下。差异图以相同测试素材、视口和主题下的既有日文截图为参照，包含文字变化及由换行引起的位置变化，不作为已批准的视觉基线。

| 场景 | 中文截图 | 与既有日文截图的差异 |
| --- | --- | --- |
| 1440px 深色 | [弹窗](assets/avatar-decoration-calibration-zh-CN-1440-dark.png) | [diff](assets/avatar-decoration-calibration-zh-CN-1440-dark-diff.png) |
| 320px 浅色 | [弹窗](assets/avatar-decoration-calibration-zh-CN-320-light.png) | [diff](assets/avatar-decoration-calibration-zh-CN-320-light-diff.png) |
