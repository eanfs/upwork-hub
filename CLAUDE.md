# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 命令

```bash
npm run test                          # 全部测试(vitest run)
npx vitest run tests/config.test.ts   # 单个测试文件
npx vitest run -t "加载合法配置"        # 按用例名过滤
npm run typecheck                     # tsc --noEmit,无类型错误即通过
npm run login                         # 启动带调试端口的真实 Chrome
npm run export                        # 导出最近一次运行的职位为 CSV
```

无 build / lint 步骤。TypeScript 经 `tsx` 直接运行,不产出 `dist/`。

## 架构

命令行工具,在**用户已手动登录的真实 Chrome** 中观察其自身网络请求,采集 Upwork 职位。详见 `docs/superpowers/specs/2026-05-17-upwork-job-collector-design.md`。

### CDP 附接 —— 核心约束

工具**不启动也不拥有**浏览器。`ChromeConnector` 用调试端口启动用户本机真实 Google Chrome(`launchChrome`,detached),再经 `chromium.connectOverCDP` 附接(`connect`),返回的 `browser` / `context` 是用户的真实 Chrome。

> **生产代码绝不可调用 `browser.close()`** —— 那会关掉用户的浏览器。只能 `page.close()` 关闭自己新开的标签页。

之所以如此:Playwright 自带 Chromium 带自动化指纹(`navigator.webdriver` 等),被 Upwork 的 Cloudflare 防护直接拦截。即便附接真实 Chrome,程序化 `page.goto()` 到搜索页仍可能触发 Cloudflare 质询 —— 故有 `_readpage.ts`(只 dump 用户已手动打开、已渲染好的标签页,不做导航)作为绕开手段。

### 数据流水线

`Config`(`config.ts`,校验 `chrome` 段)→ `SourceResolver`(关键词/已保存搜索 → 列表页 URL)→ `ChromeConnector` 附接 → **[阶段 B:NetworkCapture / ListingCollector / DetailCollector / Normalizer]** → `Storage`(SQLite upsert 去重)→ `CsvExporter`。`Pacer` 在浏览器动作间插入随机延时。

`Storage` 三表:`jobs`(以 `id` 为主键,upsert 时 `isNew` 标志区分新旧、`firstSeen` 永不被覆盖)、`runs`、`run_jobs`。

### 阶段化交付

实现计划在 `docs/superpowers/plans/`,逐任务带 checkbox:
- **阶段 A**(`...-phase-a.md`)+ **CDP 修订**(`...-cdp-revision.md`):基础模块,已完成。
- **发现任务**(阶段 A Task 11):用真实会话观察 Upwork 接口,产出 `tests/fixtures/*.json` 与 `docs/superpowers/specs/upwork-api-findings.md` —— 未完成,需人工驱动浏览器通过 Cloudflare。
- **阶段 B**:NetworkCapture、Normalizer、Collectors、`collect` 命令、`SourceResolver` 的分类筛选分支 —— 依赖发现任务产出,尚未编写计划。

按计划开发时:每个编码任务严格 TDD(先写失败测试再写最小实现),每任务结束提交一次。

## 约定

- `config.json` 不入库;`config.example.json` 为样例。可用环境变量 `UPWORK_HUB_CONFIG` 覆盖配置路径。
- 文档、代码注释、提交信息均用中文。
- 发现/调试脚本:`scripts/observe.ts`(转储页面 JSON 响应)、`_discover.ts`(导航抓取)、`_readpage.ts`(只读 dump 已渲染标签页)。
- TypeScript 为 CommonJS 模块(`tsconfig.json`),纯类型文件不写单元测试,以 `npm run typecheck` 验证。
