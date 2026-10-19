# 视频附件上传

共享上传器 `packages/frontend/src/composables/use-uploader.ts` 负责附件状态与任务生命周期，`packages/frontend/src/utility/video-preprocessing/index.ts` 负责实际媒体转换和完整性校验。发帖表单、通用上传弹窗和各帖子视图继续使用现有共享组件。

## 处理和提交规则

1. 原始 `File` 始终保留。每次预处理先清除上一轮压缩文件、压缩大小和附加后缀，恢复原文件预览来源。
2. 视频适配器解析源文件的实际音视频轨道。转换使用现有压缩级别和全部音视频轨道；源文件必须包含视频，每条必需轨道都必须进入转换计划，不能被库静默舍弃。
3. 转换完成后重新解析候选文件，检查文件非空、音视频轨道数量一致、每条轨道有实际编码数据包，以及视频宽高有效。此检查不承诺保留所有字幕和容器元数据，也不进行第二次全文件解码。
4. 只有仍属于当前附件、当前任务且未取消的候选结果，才能统一更新上传文件、大小、后缀和预览 URL。
5. 转换或校验失败时，当前尝试提示使用原文件并恢复原始内容。用户明确发起上传后，原文件仍经过现有 `uploadFile()` 和后端的大小、空间及文件类型限制。

源文件自身无法被浏览器解码时，回退只保证保留原始字节，不把它转换成受支持的编码。播放器兼容性应以实际文件和目标浏览器验证。

## 取消、重试和并发

任务控制仅存在于上传器内部，不创建第二份持久业务状态。附件身份沿用 `UploaderItem.id`，不同尝试通过独立任务对象区分。

- 新预处理、取消、删除、清空和卸载先使旧任务失效；旧任务的进度、成功、失败和清理均不能覆盖新任务。
- 缓存的旧取消句柄只属于旧尝试，不能取消后续重试。
- 主动取消不解释为压缩失败，不自动改为原文件上传；明确重试会按当前参数重新预处理。
- 共享上传入口自身等待预处理、合并重复上传调用，并在取消、失败或仍有未上传附件时拒绝成功返回。
- 发帖入口只在既有上传调用边界消费已提示的上传拒绝与主动取消，明确中止普通发布或计划发布。未知异常继续传播，失败不会被解释为已完成上传。
- 成功事件在 `uploaded` 提交之后发出，允许既有消费者立即移除已上传附件；通用弹窗全部完成后自动关闭仍属于成功。
- 图片处理只在临时候选附件中准备结果，其预览 URL 也由公共提交入口管理。裁剪和图片效果保留原附件身份，并检查附件仍然可编辑。

## 后台运行依赖

运行后台的环境必须同时提供 `ffmpeg` 和 `ffprobe`。它们应能通过后台进程实际的 `PATH` 找到，或使用既有媒体库支持的显式路径配置。Debian 环境可安装系统 `ffmpeg` 包，包中包含两者。

安装依赖之后需要重启曾经查找失败的后台进程，因为媒体库会缓存工具路径的查找结果。验证应包括真实视频上传后的缩略图请求和纯音频 MP4 的类型识别，不能只检查交互式终端中的命令是否存在。

现有后台仍负责文件类型识别与缩略图生成；本次没有改变其探测失败策略。前端完整性保护依据实际转换计划和文件内容，不依赖修改实例 URL 或浏览器安全设置。当前实例 URL 应继续遵守原有部署约束。

## 回退提示与语言资源更新

`_uploader.videoCompressionFallback` 是原文件回退提示的文案键，显示时通过参数化格式化填入文件名。独立语言加载器的正常请求使用 `cache: 'no-cache'`，重新验证同一应用版本下的语言资源；取得新响应后更新浏览器缓存，使后续普通请求也能读取新文案。

语言构建器先完成继承合并，只在最终 JSON 内容变化时通过同目录临时文件原子替换发布。开发环境监听这些最终生成物，在发布完成后向对应语言发送 `locale-update`；页面收到自己语言的通知后重新加载，复用正常语言加载流程。内容不变时不重写文件，也不重复触发通知。

视频压缩回退提示已在 `locales/zh-CN.yml` 提供简体中文译文：`视频“{name}”无法安全压缩，已改用原文件。`，显示时由既有格式化逻辑填入文件名。其他缺少译文的条目仍通过既有合并规则继承基础文案，因此基础语言变化可能同时更新中文生成物。

## 回归验证

`test/unit/use-uploader.test.ts` 覆盖任务生命周期、迟到回调和上传参数协议；其中的可控适配器不能作为真实媒体正确性的证据。

`test/e2e/video-upload-integrity.spec.ts` 使用真实浏览器、测试账号、后台上传、存储文件、FFprobe、缩略图和播放器。`test/e2e/video-upload-harness.ts` 为真实 Vue 上传器提供取消重试测试入口，不进入产品入口。

视频端到端测试必须连接独立测试实例及其数据库、Redis 和存储目录。测试进程需要 `ffmpeg`、`ffprobe` 和 Playwright Chromium。小型样本位于 `test/e2e/fixtures/video-upload/`；超限样本在用例输出目录中生成。

语言资源回归使用当前 `i18n` 构建产物：`test/e2e/locale-cache.spec.ts` 以真实 Chromium HTTP 缓存验证旧资源命中、加载器重新验证及后续缓存更新；`test/e2e/locale-hmr.spec.ts` 通过真实构建器、Vite 文件监听与 WebSocket 验证中文继承更新和无变化发布。两者自行创建独立临时服务与文件，不依赖产品后端或测试账号。单元回归同时覆盖上传提示、通知映射、语言发布和生产内联匹配。

在仓库根目录执行：

```bash
pnpm --filter i18n build
pnpm --dir packages/frontend exec vitest run --globals --config vitest.config.unit.ts \
  test/unit/use-uploader.test.ts \
  test/unit/vite-plugin-watch-locales.test.ts \
  test/unit/locale-publication.test.ts \
  test/unit/locale-inliner-cache.test.ts
pnpm --dir packages/frontend exec playwright test \
  test/e2e/locale-cache.spec.ts \
  test/e2e/locale-hmr.spec.ts
pnpm --dir packages/frontend exec playwright test test/e2e/video-upload-integrity.spec.ts
```

视频端到端测试还应在非安全的局域网 HTTP 来源运行。通过 `VIDEO_TEST_BASE_URL` 指定独立测试实例的实际地址，并设置 `VIDEO_TEST_INSECURE=1`。测试会检查浏览器实际安全上下文、上传前后 SHA-256、音视频轨道和解码帧；不能用 localhost 或关闭浏览器安全限制代替该场景。

已经存储的缺少视频轨道的文件不会因代码或依赖修复而恢复画面，必须取得原始视频并重新上传。
