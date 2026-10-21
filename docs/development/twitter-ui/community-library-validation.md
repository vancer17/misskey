# 频道资料库修复验证记录

- 验证日期：2026-10-21
- 项目：`/home/vancer17/misskey`
- 分支：`fix/twitter-communities-layout`
- 基础提交：`0e96dbd558c951ef86e02dd21aa9b8eb960efebe`
- 范围：当前未提交的所属频道分页、资料库窗口高度、状态呈现与键盘操作改动
- 结果：本次选定的 21 项浏览器回归、11 项单元测试及 7 项本地化专项检查通过；构建、类型与交付检查通过

当前实现见 [频道入口布局与请求边界](./communities-layout.md)，决策与被替代方案见 [ADR-0016](./adr/0016-community-library-query-and-height.md)。本记录描述实际执行结果，执行时的源码摘要见 [source-sha256.json](./assets/community-library/source-sha256.json)。

## 修复后的可观察行为

1. 桌面短列表按内容撑高，长列表保留 650px 上限并在主体内滚动。矮视口继续受模态覆盖层可用空间约束。
2. 每页展示 10 条、请求 11 条，以预读结果确认后续页。游标取最后展示的条目，预读条目在下一页正常出现。
3. 加载、空集合、失败重试、继续分页和非空结束状态分别呈现；追加或刷新时保留已显示列表。
4. 关闭重开复用原查询；创建或收藏后的路由回访按当前入口刷新。重复追加不会发送第二个并发请求。
5. 键盘加载期间由状态区域暂接焦点，完成后进入第一条新增频道；用户已转移焦点时不抢回。弹窗内 Tab／Shift+Tab 循环可达控件，Esc 正常关闭并解除背景隔离。
6. 手机继续使用原抽屉尺寸规则；默认固定高度窗口维持原行为。简体中文结束提示为“已显示全部频道”。

## 已执行的检查

| 检查 | 结果 | 实际范围 |
| --- | --- | --- |
| `twitter-community-library.spec.ts` | PASS，18 项 | 分页数量边界、故障恢复、重复动作、回访竞态、明暗主题、短／长列表、矮屏、移动抽屉、原界面 owned、键盘末页与慢请求、既有 Drive 窗口 |
| 既有频道回归 | PASS，3 项 | 管理／收藏窗口按需读取；真实创建后回访原空集合；真实收藏后回访缓存收藏区 |
| `twitter-owned-channels.test.ts` 与 `i18n.test.ts` | PASS，11 项 | 新查询协议和取消／失效边界 8 项；既有 i18n 3 项 |
| 本地化补充资源专项 | PASS，7 项 | 简体中文内容、原挂件命名空间、其他语言隔离、未知命名空间／键及空值拒绝、禁止覆盖已有翻译、缺文件回退 |
| 前端 `vue-tsc --noEmit` | PASS | 全量前端类型检查 |
| i18n `tsc --noEmit` | PASS | 本地化包类型检查 |
| Vite 构建与 locale inlining | PASS | 最终源码的隔离前端制品与本地化脚本 |
| 变更源码及测试文件 ESLint | PASS | 变更源码 lint，以及新 E2E／unit 文件专项 lint |
| SPDX 与 locale safety | PASS | 仓库交付检查；非 ja-JP 的 locale YAML 无改动 |
| `git diff --check` | PASS | 差异格式检查 |
| 最终中文场景采样 | PASS | 真实四条频道，明暗主题，中文结束提示，无更多按钮 |

自动检查的退出码和运行时长见 [checks.json](./assets/community-library/checks.json)。浏览器用例使用真实隔离后端；成功数据由真实 API 创建与读取。传输故障和时序场景只中断或延迟真实响应，不伪造业务集合。单元测试用于协议、错误、取消及旧响应隔离边界。

### 分页边界的实际结果

| 真实频道总数 | 首屏显示 | 后续追加 | 完整读取请求数 | 最终状态 |
| --- | --- | --- | --- | --- |
| 0 | 0 | 无 | 1 | 空态，无结束提示 |
| 4 | 4 | 无 | 1 | 已显示全部，无更多按钮 |
| 10 | 10 | 无 | 1 | 已显示全部，无额外空页请求 |
| 11 | 10 | 1 | 2 | 已显示全部 |
| 20 | 10 | 10 | 2 | 已显示全部，无第三次探测 |
| 31 | 10 | 10、10、1 | 4 | 已显示全部 |

每一场景同时检查实际频道 ID 顺序、`limit=11`、`untilId` 等于最后展示的频道，以及关闭重开后不重复首拉。以上数量来自稳定数据集；预读后发生删除或归档时，合法空末页仍允许保留原列表并结束。

### 交互与兼容回归

- 追加传输失败后保留已有 10 条，重试使用同一游标，随后得到真实第 11 条。
- 同一事件循环的重复追加只发送一条请求；在途关闭重开保留列表及加载状态。
- 追加在途期间离页创建频道，回访等待追加结束后刷新首屏，最终集合与真实新首屏一致。
- 首拉失败后重开仍显示错误，只有显式重试才重新请求。
- 原界面 owned 标签与 Twitter 弹窗均按相同分页协议展示；键盘末页加载后焦点保留在所属列表内。
- 弹窗末页完成后，Tab 到关闭按钮，Shift+Tab 返回最后一条频道，再次 Tab 返回关闭按钮；Esc 关闭后页面不再位于 inert 祖先下。
- 慢追加期间按钮禁用，焦点仍在弹窗内；用户 Tab 到关闭按钮后，响应完成保持该焦点。
- 频道编辑中的既有 Drive 选择窗口保持 800 × 500px，主体 `container-type: size`；关闭后可继续填写频道名称。

## 视觉证据

桌面中文对比固定为 1440 × 1000、DPR 1、浏览器缩放 100%，同名四条频道及对应明暗主题。测量值见 [before-metrics.json](./assets/community-library/before-metrics.json) 与 [after-metrics.json](./assets/community-library/after-metrics.json)。

| 项目 | 修复前 | 修复后 |
| --- | --- | --- |
| 四条频道的桌面窗口高度 | 650px | 441.890625px，约 442px |
| 暗色主体／业务列表背景 | `rgb(21,32,43)`／`rgb(16,24,33)` | 均为 `rgb(21,32,43)` |
| 亮色主体／业务列表背景 | 白色／`rgb(230,236,240)` | 均为白色 |
| 四条频道的底部状态 | 仍显示可点击的“查看更多” | “已显示全部频道”，无更多按钮 |
| 长列表桌面窗口 | — | 高度上限 650px，内部滚动 |
| 1440 × 480 矮视口 | — | 窗口不越界，高度不超过 416px，关闭入口可见 |
| 390 × 844 手机参数浏览器上下文 | — | 抽屉宽 390px、高 814px，底部对齐视口 |

| 场景 | 修复前 | 修复后 | 差异图 |
| --- | --- | --- | --- |
| 暗色四条频道 | [截图](./assets/community-library/before-dark-owned-4.png) | [截图](./assets/community-library/after-dark-owned-4.png) | [diff](./assets/community-library/diff-dark-owned-4.png) |
| 亮色四条频道 | [截图](./assets/community-library/before-light-owned-4.png) | [截图](./assets/community-library/after-light-owned-4.png) | [diff](./assets/community-library/diff-light-owned-4.png) |

额外证据：[矮视口长列表](./assets/community-library/owned-long-short-viewport.png)、[移动抽屉](./assets/community-library/owned-mobile-drawer.png)。移动场景采用 Chromium 的 iPhone 13 参数上下文，不是物理手机测试。

差异图将 RGB 绝对差之和超过 36 的像素标红；统计见 [visual-diff.json](./assets/community-library/visual-diff.json)。它用于人工审阅预期布局变化，不是相似度通过阈值或已批准基线。650px 是沿用的窗口上限；本次没有宣称取得 X 管理弹窗的成功 DOM 或像素基线。

## 复跑入口

仓库根目录下的静态与单元检查：

```bash
pnpm --filter frontend typecheck
pnpm --filter i18n typecheck
pnpm --filter frontend test twitter-owned-channels.test.ts i18n.test.ts
pnpm --filter frontend exec eslint --quiet test/e2e/twitter-community-library.spec.ts test/unit/twitter-owned-channels.test.ts
node scripts/check-shipping.mjs --base HEAD
git diff --check
```

本次 E2E 配置为 `/home/vancer17/misskey/tmp/twitter-community-library-fix/playwright.config.mjs`，使用 `http://localhost:61812` 的隔离实例和一个 worker。用例会按场景重置该测试实例的数据，复跑时需让此实例独占测试进程。

```bash
pnpm --filter frontend exec playwright test \
  --config /home/vancer17/misskey/tmp/twitter-community-library-fix/playwright.config.mjs \
  --output /home/vancer17/misskey/tmp/twitter-community-library-fix/e2e-owned-final \
  twitter-community-library.spec.ts

pnpm --filter frontend exec playwright test \
  --config /home/vancer17/misskey/tmp/twitter-community-library-fix/playwright.config.mjs \
  --output /home/vancer17/misskey/tmp/twitter-community-library-fix/e2e-channel-regressions \
  twitter-communities.spec.ts twitter-write-freshness.spec.ts \
  --grep '独立管理与收藏弹窗按需读取，关闭后主流保持原位|社区管理列表在创建后回访更新原空集合|收藏频道后缓存社区收藏区回访更新'
```

最终构建写入 `/home/vancer17/misskey/tmp/twitter-community-library-fix/frontend-build`。完整过程日志位于同级目录的 `*.log`，本记录及已复制的截图、指标和退出码保留在项目文档中。
