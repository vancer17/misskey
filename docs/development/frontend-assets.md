# Web 前端资源交付

Web 服务在启动时读取主前端和嵌入前端各自的 manifest 存在状态，HTML 入口和对应资源路由消费同一份启动配置。资源探测与交付逻辑位于后端 Web 适配层，不进入前端领域模型、业务 Store 或组件。

## 资源选择

| 主前端 manifest | 嵌入前端 manifest | `/vite/` | `/embed_vite/` |
| --- | --- | --- | --- |
| 不存在 | 不存在 | 主前端 Vite 代理 | 嵌入前端 Vite 代理 |
| 存在 | 不存在 | 主前端静态制品 | 嵌入前端 Vite 代理 |
| 不存在 | 存在 | 主前端 Vite 代理 | 嵌入前端静态制品 |
| 存在 | 存在 | 主前端静态制品 | 嵌入前端静态制品 |

主前端制品目录为 `built/_frontend_vite_`，嵌入前端为 `built/_frontend_embed_vite_`。每个静态资源分支单独封装缓存与去查询参数钩子，保持 30 天 immutable 缓存。开发代理保留模块查询参数，沿用 `VITE_PORT`／`EMBED_VITE_PORT` 和原上游地址规则。

配置中的 manifest 状态在进程启动时读取，HTML 模板也缓存入口资源。切换制品目录后必须重启对应后端进程，才能使入口选择与资源路由同时更新。

## 开发与验证目录

运行 `pnpm dev` 的工作区保持开发制品状态。需要生产构建或完整生产运行时验证时，使用独立 checkout／staging 根执行构建，包含自己的 `packages`、`built` 与隔离配置；只共享依赖。验证完成后同时检查原开发页面的 HTML 入口、JS、CSS 和浏览器启动，不能仅以端口存活判断可用。

仅检查后端编译时，可以从 backend 包根使用 Rolldown 的输出目录参数，将代码写入任务目录：

```bash
pnpm exec rolldown -c --dir /absolute/path/to/isolated/backend-built
```

该参数只隔离编译输出，不能将所得 bundle 视为完整隔离运行时。运行服务前仍需准备独立根目录和配置。此路径不使用 `--watch`；开发 watch 会启动既有开发后端并生成共享资源。

路由协议测试直接从源码运行，不执行会写共享 `built` 的构建或配置编译命令：

```bash
pnpm exec vitest run --config vitest.config.unit.ts test/unit/server/ClientServerService.ts
```

## 验收边界

`packages/backend/test/unit/server/ClientServerService.ts` 使用真实 `ClientServerService`、Fastify HTTP、临时 manifest／文件和随机端口上游，覆盖四种组合、资源正文与 MIME、静态缓存、去查询参数跳转和代理参数透传。未参与请求的业务依赖使用协议测试替身，该测试不证明业务领域行为。

浏览器可用性另以不拦截资源的独立会话验证实际开发地址，检查首次打开及刷新均正常。测试浏览器可授予 `local-network-access` 权限，避免浏览器本地网络策略阻断开发 HMR WebSocket；该权限仅属于测试会话。

本次修复的变更原因与取舍见 [ADR-0026](./twitter-ui/adr/0026-independent-frontend-asset-delivery.md)。
