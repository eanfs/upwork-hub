# upwork-hub

Upwork 职位信息收集器 —— 一个命令行工具,在**用户已手动登录的真实 Chrome** 中观察浏览器自身发出的请求,采集 Upwork 上的**招聘职位(Jobs)**信息。

## 设计约束

- **不做独立爬虫**:不构造请求直接打接口、不伪造浏览器指纹。工具经 CDP 附接到用户本机真实 Chrome,只**观察该浏览器自身的请求**并读取响应。
- 采集对象**仅限职位(Jobs)**,不含自由职业者档案、客户私有数据。
- **只读**:不做职位申请、发消息等写操作。
- 第一版为手动命令行运行,架构上为后续定时调度预留空间。

> 早期方案曾用 Playwright 自带 Chromium + `storageState`,因其自动化指纹(`navigator.webdriver` 等)被 Upwork 的 Cloudflare 防护拦截。现改为:用户用调试端口启动本机真实 Google Chrome 并自行登录,工具经 `connectOverCDP` 附接。详见 `docs/superpowers/specs/2026-05-17-upwork-job-collector-design.md`。

## 环境要求

- Node.js 20+
- 本机安装 Google Chrome

## 安装

```bash
npm install
npx playwright install chromium   # 测试用
```

## 配置

复制样例配置并按需修改:

```bash
cp config.example.json config.json
```

| 字段 | 说明 |
|---|---|
| `sources.keywords` | 关键词列表,各自展开为搜索列表页 URL |
| `sources.savedSearches` | 已保存搜索的 URL,原样访问 |
| `sources.categoryFilters` | 分类筛选条件(阶段 B 启用) |
| `pacing` | 动作间随机延时区间、每来源翻页上限、每次运行详情抓取上限 |
| `chrome.cdpPort` | Chrome 调试端口(默认 `9222`) |
| `chrome.userDataDir` | 独立 Chrome 用户配置目录(登录态留在此处) |
| `chrome.executablePath` | 本机 Chrome 可执行文件路径 |
| `paths.database` | SQLite 数据库路径 |
| `paths.exportDir` | CSV 导出目录 |

也可用环境变量 `UPWORK_HUB_CONFIG` 指定配置文件路径。

## 使用

```bash
npm run login     # 启动带调试端口的真实 Chrome,供你手动登录 Upwork
npm run export    # 把最近一次运行采集的职位导出为 CSV
```

`login` 后请保持该 Chrome 窗口开启 —— 后续观察/采集都附接到它。`collect` 命令在阶段 B 实现。

## 项目结构

```
src/
  types.ts                  领域类型:Job / StoredJob / Run / Config
  config.ts                 配置加载与校验
  storage/Storage.ts         SQLite 读写:upsert 去重、运行记录、运行-职位关联
  storage/schema.sql         建表语句
  pacer/Pacer.ts             随机延时节奏控制
  collect/SourceResolver.ts  关键词/已保存搜索 → 列表页 URL
  export/CsvExporter.ts      职位导出为 CSV
  session/ChromeConnector.ts 启动并经 CDP 附接真实 Chrome
  cli.ts                     命令入口:login / export
scripts/observe.ts           发现工具:转储页面 JSON 响应
tests/                       各模块测试(vitest)
docs/superpowers/            设计文档与实现计划
```

## 测试

```bash
npm run test       # vitest,全部用例
npm run typecheck  # tsc --noEmit
```

## 状态

- **阶段 A** —— 基础模块(配置、存储、节奏、来源解析、CSV 导出、Chrome 附接、CLI):已完成。
- **发现任务** —— 产出 Upwork 接口 fixture 与字段定位文档:待人工驱动浏览器抓取后完成。
- **阶段 B** —— NetworkCapture、Normalizer、ListingCollector、DetailCollector、`collect` 命令、分类筛选:待实现。
