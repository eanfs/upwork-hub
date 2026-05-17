# Upwork 职位信息收集器 — 设计文档

- **日期**:2026-05-17
- **状态**:已确认;阶段 A 实现中
- **项目目录**:`upwork-hub`

> **修订(2026-05-17):改用 CDP 附接真实 Chrome。**
> 阶段 A 实现时发现:Playwright 自带 Chromium 启动时注入自动化标志(`navigator.webdriver` 等),被 Upwork 的 Cloudflare 机器人防护直接拦截。
> 因此放弃「Playwright 启动 Chromium + storageState」方案,改为:用户用调试端口启动本机真实 Google Chrome 并自行登录,工具通过 `connectOverCDP` 附接到这个 Chrome 只做观察。
> 本文档下列章节已据此更新:§2 登录方式、§3 模块(SessionManager→ChromeConnector、删除 AuthFlow)、§4 登录与采集流程、§6 反检测、§8 配置与结构。

## 1. 目标与范围

构建一个命令行工具,通过 **Playwright 驱动真实浏览器**、在**已登录的真实会话**下采集 Upwork 上的**招聘职位(Jobs)**信息。

明确的设计约束:

- **不使用独立爬虫**:不构造请求直接打接口、不伪造浏览器指纹。工具运行一个真实的、由用户手动登录过的浏览器,只**观察该浏览器自身发出的请求**并读取响应。
- 采集对象**仅限职位(Jobs)**,不含自由职业者档案、客户档案、账号私有数据。
- 第一版为**手动命令行运行**,架构上为后续接入定时调度预留空间。

### 非目标(YAGNI)

- 不做 Web 界面 / 可视化仪表盘。
- 不做定时调度本身(仅预留扩展空间)。
- 不采集职位以外的实体。
- 不做职位申请、消息等写操作。

## 2. 关键决策汇总

| 决策点 | 选择 |
|---|---|
| 采集对象 | 招聘职位(Jobs) |
| 职位来源 | 关键词搜索 + 已保存搜索/推送 + 分类筛选条件 |
| 数据提取方式 | 方案 C 混合:网络响应拦截为主,DOM 兜底为辅 |
| 登录方式 | 用户用调试端口启动真实 Chrome 并自行登录;工具经 CDP 附接,登录态留在独立 Chrome 配置目录 |
| 技术栈 | Node.js + TypeScript + Playwright(`connectOverCDP` 附接真实 Chrome) |
| 采集深度 | 列表页全量 + 逐个详情页 |
| 详情页范围 | 仅抓**本次新出现**的职位;旧职位跳过详情,仅刷新摘要 |
| 输出 | SQLite 主存(去重/增量/历史)+ 每次运行导出 CSV |
| 运行方式 | 手动命令行;为定时调度预留扩展空间 |
| 节奏参数 | 全部放入配置文件,跑起来后再调 |

## 3. 整体架构与模块划分

工具是一个 Node.js + TypeScript 命令行程序,内部分成职责单一、可独立测试的模块:

| 模块 | 职责 | 依赖 |
|---|---|---|
| **CLI** | 解析命令和参数,调度流程。命令:`login` / `collect` / `export` | Config |
| **Config** | 读取并校验配置文件:职位来源、节奏参数、Chrome 连接参数、文件路径 | — |
| **ChromeConnector** | `launchChrome()` 用调试端口 + 独立用户目录启动本机真实 Chrome;`connect()` 经 `connectOverCDP` 附接到它,返回其已登录的上下文 | Config |
| **SourceResolver** | 把配置里的「关键词 / 已保存搜索 / 分类筛选」解析成一批待访问的列表页 URL | Config |
| **NetworkCapture** | 通用工具:监听真实浏览器发出的 Upwork 接口请求,匹配并解析其 JSON 响应 | — |
| **ListingCollector** | 逐个来源:打开列表页 → 翻页 → 经 NetworkCapture 拿职位摘要;接口缺的字段用 DOM 兜底 | ChromeConnector, NetworkCapture |
| **DetailCollector** | 对新职位逐个打开详情页 → 拿详情 JSON;DOM 兜底 | ChromeConnector, NetworkCapture |
| **Normalizer** | 把原始 JSON(+DOM 片段)映射成统一的 `Job` 领域对象;含 DOM 兜底逻辑 | — |
| **Storage** | SQLite:按职位唯一 ID 去重/增量更新,记录 first_seen / last_seen 和每次运行历史 | — |
| **CsvExporter** | 把本次运行的职位导出成 CSV | Storage |
| **Pacer** | 拟人节奏:随机延时、串行单页访问,保护账号不被风控 | Config |

核心数据通道是 NetworkCapture(方案 B 主力),Normalizer 中做 DOM 兜底(方案 C)。每个模块通过明确接口通信,可单独编写测试。

## 4. 数据流与运行流程

### 登录(`upwork-hub login`)

1. ChromeConnector 用 `--remote-debugging-port` + `--user-data-dir`(独立配置目录)后台启动本机真实 Google Chrome。
2. 用户在打开的 Chrome 窗口里正常登录 Upwork(账号密码 + 2FA / 验证码)。Cloudflare 看到的是真实浏览器 + 真人操作,正常放行。
3. 登录态保存在独立 Chrome 配置目录里;窗口保持开启供后续 `collect` / `observe` 附接。下次 `login` 重开同一目录即仍是登录状态。

### 采集(`upwork-hub collect`)

1. ChromeConnector 经 `connectOverCDP` 附接到运行中的 Chrome;取其默认上下文(含登录态)。连接失败则中止并提示先运行 `login`。
2. SourceResolver 把配置里的来源展开成列表页 URL 队列。
3. 对每个来源(Pacer 控制串行 + 随机延时):
   - ListingCollector 打开列表页,NetworkCapture 监听并捕获搜索接口的 JSON 响应。
   - 翻页直到达到配置的页数上限 / 无更多结果。
   - Normalizer 把每条职位摘要规整为 `Job` 对象。
   - Storage 按职位唯一 ID **upsert**:新职位标记 `is_new`,旧职位更新 `last_seen`。
4. DetailCollector 对**本次新出现的职位**逐个打开详情页,捕获详情 JSON,Normalizer 合并进 `Job`,Storage 更新。
5. 全部完成后,CsvExporter 把本次运行涉及的职位导出成一个带时间戳的 CSV。
6. Storage 写一条 run 记录(运行时间、各来源命中数、新职位数、状态)。

### 导出(`upwork-hub export`)

从 SQLite 按指定运行(默认最近一次)导出 CSV,不触发浏览器。

### 关键流程决策

- 详情页**只抓本次新职位**,而非每次把所有职位详情重抓一遍。请求量小、对账号更安全;旧职位的摘要信息仍随每次运行刷新。
- Storage 边采边写(每个来源/职位处理完即落库),中途崩溃已采数据不丢失。

## 5. 数据模型(SQLite)

### 表 `jobs` — 职位主表,按 Upwork 职位唯一 ID 去重

| 字段 | 说明 |
|---|---|
| `id` | Upwork 职位唯一标识(主键) |
| `url` | 职位详情页链接 |
| `title` | 标题 |
| `description` | 完整描述(详情页抓到后填充) |
| `budget_type` | 固定价 / 时薪 |
| `budget_amount` | 固定价金额 |
| `hourly_min` / `hourly_max` | 时薪区间 |
| `skills` | 技能标签(JSON 数组文本) |
| `category` / `subcategory` | 分类 |
| `experience_level` | 经验等级要求 |
| `project_duration` | 项目时长 |
| `proposals_count` | 已申请数 |
| `client_country` | 客户所在地 |
| `client_total_spent` | 客户历史总支出 |
| `client_hire_rate` | 客户雇佣率 |
| `client_rating` | 客户评分 |
| `client_payment_verified` | 客户付款是否验证 |
| `posted_at` | 职位发布时间 |
| `source` | 来自哪个来源(关键词/已保存搜索/分类) |
| `detail_fetched` | 详情页是否已抓 |
| `first_seen` / `last_seen` | 首次 / 最近一次被采集到的时间 |
| `raw_json` | 原始响应留底,便于日后补字段 |

### 表 `runs` — 每次运行记录

`id` / `started_at` / `finished_at` / `jobs_seen` / `jobs_new` / `status`(`success` / `failed` / `session_expired`)

### 表 `run_jobs` — 运行与职位的关联(多对多)

`run_id` / `job_id` / `is_new` — 用于「导出本次运行的职位」和追溯历史。

### 去重逻辑

- `jobs` 表按 `id` upsert:新职位插入并置 `first_seen`;已存在则更新 `last_seen` 及可变摘要字段。
- 接口可能含未列出的有用字段,Normalizer 保底把整个原始 JSON 存进 `raw_json`,日后可补。
- CSV 导出时 join `run_jobs` 取指定运行的职位。

## 6. 账号安全节奏(Pacer)

Upwork 风控严格,这是底线:

- **串行**访问,任意时刻只开一个标签页,不并发。
- 每次页面跳转、翻页之间插入**随机延时**(可配置)。
- 每次运行设**总量上限**:每来源最多翻 N 页、单次运行最多抓 M 个详情页(可配置)。
- 采集发生在**用户本机的真实 Google Chrome**(经 CDP 附接)中,而非 Playwright 自带 Chromium —— 没有 `navigator.webdriver` 等自动化指纹,Cloudflare 几乎无法识别。
- 不改 UA、不伪造请求,只观察这个真实 Chrome 自身发出的请求。
- 采集时在已登录上下文里新开标签页,完事只关该标签页,不关用户的 Chrome。

## 7. 错误处理

- **会话失效**:校验页发现未登录 → 立即中止,run 状态记 `session_expired`,提示重新 `login`,不做重试硬闯。
- **单个职位失败**(详情页超时 / 结构异常):跳过该职位并记日志,不中断整次运行;该职位 `detail_fetched` 保持未完成,下次运行会重试。
- **接口响应未等到**:对该页设超时,超时后用 DOM 兜底再取一次;仍失败则记该来源部分失败。
- **崩溃中断**:Storage 边采边写,中途挂掉已采数据不丢;run 标记 `failed`。
- 全程结构化日志,出问题能定位到具体来源 / 职位。

## 8. 配置与项目结构

### 配置文件 `config.json`

```jsonc
{
  "sources": {
    "keywords": ["react developer", "python automation"],
    "savedSearches": ["https://www.upwork.com/nx/find-work/..."],
    "categoryFilters": [
      { "category": "web-development", "budgetMin": 500, "experienceLevel": "expert" }
    ]
  },
  "pacing": {
    "minDelayMs": 3000,
    "maxDelayMs": 8000,
    "maxPagesPerSource": 5,
    "maxDetailsPerRun": 50
  },
  "chrome": {
    "cdpPort": 9222,
    "userDataDir": "./data/chrome-profile",
    "executablePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  },
  "paths": {
    "database": "./data/upwork.db",
    "exportDir": "./data/exports"
  }
}
```

节奏参数(`pacing`)的具体默认值跑起来后再调。

### 项目结构

```
upwork-hub/
├── src/
│   ├── cli.ts                  # 命令入口:login / collect / export
│   ├── config.ts               # 读取 + 校验配置
│   ├── session/
│   │   └── ChromeConnector.ts   # 启动真实 Chrome + CDP 附接
│   ├── collect/
│   │   ├── SourceResolver.ts
│   │   ├── NetworkCapture.ts
│   │   ├── ListingCollector.ts
│   │   └── DetailCollector.ts
│   ├── normalize/
│   │   └── Normalizer.ts        # 含 DOM 兜底逻辑
│   ├── storage/
│   │   ├── Storage.ts           # SQLite 读写、upsert、去重
│   │   └── schema.sql
│   ├── export/CsvExporter.ts
│   ├── pacer/Pacer.ts
│   └── types.ts                # Job / Run 等领域类型
├── tests/
├── data/                       # Chrome 配置目录、db、CSV(git 忽略)
├── config.json
├── package.json
└── tsconfig.json
```

### 依赖

- `playwright` — 浏览器自动化。
- `better-sqlite3` — 同步 API 的 SQLite,简单可靠。
- CSV — 轻量库或手写。
- CLI 参数 — `commander` 或原生解析。

`data/` 整个加入 `.gitignore`(含登录态,绝不入库)。

## 9. 测试策略

开发流程采用 **TDD**:先写测试再写实现。

### 单元测试(主力,不连浏览器)

- **Normalizer**:喂保存好的真实 Upwork 接口 JSON 样本(fixture),断言能正确映射成 `Job` 对象;覆盖 DOM 兜底分支。
- **Storage**:用临时内存 / 文件 SQLite,验证 upsert 去重、`is_new` 判定、`first_seen/last_seen` 更新、run 与 run_jobs 关联。
- **SourceResolver**:验证配置正确展开成列表页 URL。
- **Pacer**:验证延时落在区间内、上限正确截断。
- **CsvExporter**:验证导出的 CSV 行列正确。
- **Config**:验证配置校验(缺字段、非法值能报错)。

### 集成测试(连浏览器,但不连 Upwork)

- 用 Playwright 加载**本地静态 HTML**(仿真的列表 / 详情页结构 + 模拟接口响应),验证 ListingCollector / DetailCollector / NetworkCapture 端到端跑通。

### 手动验证(对真实 Upwork,由用户确认)

- 首次 `login` 流程。
- 一次小规模真实 `collect`(限 1 个来源、翻 1 页),核对落库数据和 CSV 是否准确。

测试 fixture 使用真实响应数据,Normalizer 改字段时回归测试能立即发现问题。

## 10. 待实现时确认的开放项

- Upwork 列表 / 详情接口的实际 URL 模式与响应结构 —— 需在首次 `login` 后通过真实浏览器观察确定,再据此实现 NetworkCapture 与 Normalizer。
- 分类筛选(`categoryFilters`)如何映射为 Upwork 的 URL 查询参数 —— 同样在观察真实页面后确定。
