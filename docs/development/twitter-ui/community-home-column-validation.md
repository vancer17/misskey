# 首页频道横条与主列居中验证

- 日期：2026-10-21
- 基础提交：`0e96dbd558c951ef86e02dd21aa9b8eb960efebe`
- 范围：首页专属关注横条、发现请求清理、“我的频道”桌面主列居中。
- 结果：30 项真实后端浏览器用例、11 项相关单元测试、前端类型、构建与交付检查通过。

现行实现见 [频道入口布局与请求边界](./communities-layout.md)，决策见 [ADR-0017](./adr/0017-community-home-strip-and-column-dialog.md)。原有未提交的资料库分页、窗口高度和本地化改动保留；本次在该工作区基础上完成布局修复。

## 检查结果

| 检查 | 结果与范围 |
| --- | --- |
| `twitter-communities.spec.ts` | PASS，9 项；发现无频道横条／推荐请求、已有与新增关注、刷新重进、错误重试、分页、搜索与独立窗口 |
| `twitter-community-library.spec.ts` | PASS，19 项；所属分页、加载／错误／空态、明暗主题、长短列表、主列居中、resize、同宽过渡、关闭重开、手机抽屉、键盘与原界面／Drive 回归 |
| `twitter-write-freshness.spec.ts` | PASS，2 项；真实创建后回访我的频道、真实收藏后回访收藏窗口 |
| 最终补充重跑 | PASS，2 项；空集合居中，以及补充页面滚动后的主列居中场景 |
| `twitter-owned-channels.test.ts`、`i18n.test.ts` | PASS，11 项；既有协议、取消边界及本地化回归 |
| `vue-tsc --noEmit` | PASS |
| Vite 构建与 locale inlining | PASS，隔离制品 |
| Vue 组件独立审查 | PASS；已修正模板缩进与同宽过渡结束后重测的审查项 |
| `check-shipping.mjs --base HEAD` | PASS，变更文件 lint、SPDX 与 locale safety |
| `git diff --check` | PASS |

真实后端使用独立的 `localhost:61812`、PostgreSQL `54312`、Redis `56312`，数据库为 `twitter_communities_20261021`。测试按场景重建夹具，成功业务结果来自真实 API；故障测试只延迟或中断传输。窗口几何从实际 DOM 读取，不通过 Mock 证明关注或分页行为。

完整套件运行 28 项，最终定向运行 4 项，其中 2 项为补充回访场景，合计 30 个独立浏览器场景。最终定向运行还覆盖测试中新增的滚动及空集合中心断言。

## 主列中心测量

桌面窗口宽 600px，高度按内容收敛。采样 DPR 为 1；1440px 同时采集明暗主题。

| CSS 视口 | 主列中心 | 修复前窗口中心 | 修复后窗口中心 | 修复后误差 |
| --- | ---: | ---: | ---: | ---: |
| 1440 × 1000 | 677.5px | 720px | 677.5px | 0px |
| 1657 × 1000 | 786px | 828.5px | 786px | 0px |
| 900 × 1000 | 481px | 450px | 481px | 0px |
| 手机 390 × 844 | 195px | 195px | 195px | 0px |

手机仍为原抽屉：宽 390px、高 814px、顶部 30px、底部 844px。该场景采用 Chromium 的 iPhone 13 参数上下文，不是物理手机测试。

E2E 另覆盖打开期间从 1657px 调整到 900px、501px、1440px，以及同宽 `left` 过渡完成后的定位。窄桌面窗口按基础模态可用空间收窄，中心误差不超过 1px，左右不越界。页面滚动后打开仍以主列水平中心定位，纵向维持可用视口中线。

测量原始值：[修复前](./assets/community-home-column/before-metrics.json)、[修复后](./assets/community-home-column/after-metrics.json)。

## 视觉回归

| 场景 | 修复前 | 修复后 | diff |
| --- | --- | --- | --- |
| 桌面首页 | [截图](./assets/community-home-column/before-dark-1440-home.png) | [截图](./assets/community-home-column/after-dark-1440-home.png) | [差异](./assets/community-home-column/diff-dark-1440-home.png) |
| 桌面发现 | [截图](./assets/community-home-column/before-dark-1440-explore.png) | [截图](./assets/community-home-column/after-dark-1440-explore.png) | [差异](./assets/community-home-column/diff-dark-1440-explore.png) |
| 暗色窗口 1440px | [截图](./assets/community-home-column/before-dark-1440-owned.png) | [截图](./assets/community-home-column/after-dark-1440-owned.png) | [差异](./assets/community-home-column/diff-dark-1440-owned.png) |
| 亮色窗口 1440px | [截图](./assets/community-home-column/before-light-1440-owned.png) | [截图](./assets/community-home-column/after-light-1440-owned.png) | [差异](./assets/community-home-column/diff-light-1440-owned.png) |
| 窗口 1657px | [截图](./assets/community-home-column/before-dark-1657-owned.png) | [截图](./assets/community-home-column/after-dark-1657-owned.png) | [差异](./assets/community-home-column/diff-dark-1657-owned.png) |
| 窗口 900px | [截图](./assets/community-home-column/before-dark-900-owned.png) | [截图](./assets/community-home-column/after-dark-900-owned.png) | [差异](./assets/community-home-column/diff-dark-900-owned.png) |
| 手机发现 | [截图](./assets/community-home-column/before-mobile-390-explore.png) | [截图](./assets/community-home-column/after-mobile-390-explore.png) | [差异](./assets/community-home-column/diff-mobile-390-explore.png) |
| 手机抽屉 | [截图](./assets/community-home-column/before-mobile-390-owned.png) | [截图](./assets/community-home-column/after-mobile-390-owned.png) | [差异](./assets/community-home-column/diff-mobile-390-owned.png) |

差异图将 RGB 绝对差之和超过 36 的像素标红，统计见 [visual-diff.json](./assets/community-home-column/visual-diff.json)。前后采用相同频道名称、关注关系、视口、DPR 和主题；隔离服务器重启后重建账号夹具，因此默认头像颜色及首次登录成就提示可能产生附带差异。布局变化已结合实际几何与业务断言审阅，差异比例不作为自动通过阈值，也不代表取得 X 像素基线。

源码及制品 manifest 摘要见 [source-sha256.json](./assets/community-home-column/source-sha256.json)，退出码及场景数量见 [checks.json](./assets/community-home-column/checks.json)。

## 复跑

独立测试实例启动并加载对应前端制品后，在仓库根目录执行：

```bash
pnpm --filter frontend typecheck
pnpm --filter frontend test twitter-owned-channels.test.ts i18n.test.ts
pnpm --filter frontend exec playwright test \
  --config /home/vancer17/misskey/tmp/channel-home-column-20261021/playwright.config.mjs \
  twitter-communities.spec.ts twitter-community-library.spec.ts
node scripts/check-shipping.mjs --base HEAD
git diff --check
```

工作日志、构建和临时浏览器配置保存在 `tmp/channel-home-column-20261021`。测试实例需独占使用；开发实例不用于这些数据重置测试。
