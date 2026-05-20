# Upwork 职位收集器 — 阶段 B' 实现计划:用户驱动采集

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用"用户驱动"模式替换失败的程序化 `collect`:用户手动在 Chrome 里搜索/翻页/点开详情,长驻 watcher 被动捕获 `userJobSearch` 与详情接口响应,用户按 Enter 入库。

**Architecture:** 新增 `Watcher` 类(附接到 `BrowserContext` 的所有已开 + 后续新开页面,直接监听 `response` 事件并就地归一化进内存 map),新增 `watch` CLI 命令(长驻等待 stdin),用 `Storage` 在用户结束时一次性 upsert。**删除**阶段 B 那个不可用的程序化 `collect` 命令及其依赖的 `ListingCollector` / `DetailCollector`,保留 `NetworkCapture`(便于将来调试用,但 Watcher 不再依赖它)与 `Normalizer`(原样复用)。

**Tech Stack:** TypeScript、Playwright、better-sqlite3、vitest;不引新依赖。

**前置说明:**
- 阶段 B 真实 E2E 暴露的限制(CLAUDE.md 顶部已警告):程序化 `page.goto()` 不能稳定触发 Upwork 的 `userJobSearch` —— SPA 区分用户主动搜索与脚本打开 URL,对后者不响应。本阶段不再尝试绕过,改用用户驱动。
- 接口结构与字段定位:`docs/superpowers/specs/upwork-api-findings.md`,字段映射与阶段 B 一致,Normalizer 不动。
- **删除项:** `src/collect/ListingCollector.ts` + 其测试,`src/collect/DetailCollector.ts` + 其测试,`src/cli.ts` 的 `collect` 命令、`collectCommand` 函数与相关 import。
- 数据流:Chrome → Watcher(被动监听)→ 内存 listing/detail map → 用户按 Enter → Storage upsert(连同新 Run 记录)。
- TDD 守纪律:B'1 严格 TDD;B'2 是薄编排 + 清理工作,以全量回归 + 手动 E2E 验收;B'3 是端到端验证。

---

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/collect/Watcher.ts` | 附接到 BrowserContext,监听全部页面的 JSON 响应,归一化进内存 map;`stop()` / `collected()` 暴露累积结果 | B'1 |
| `tests/watcher.test.ts` | 用 EventEmitter 模拟 BrowserContext + Page,emit 响应,断言 collected() | B'1 |
| `src/collect/ListingCollector.ts` | **删除** | B'2 |
| `tests/listingCollector.test.ts` | **删除** | B'2 |
| `src/collect/DetailCollector.ts` | **删除** | B'2 |
| `tests/detailCollector.test.ts` | **删除** | B'2 |
| `src/cli.ts` | 修改:`collect` 命令删除,新增 `watch` 命令 | B'2 |
| `package.json` | 修改:`scripts.collect` 改为 `scripts.watch` | B'2 |
| `CLAUDE.md` | 修改:数据流水线段落,把 ListingCollector / DetailCollector 改为 Watcher | B'2 |

---

## Task B'1: Watcher

**目的:** 写一个被动监听器类,attach 到 `BrowserContext`,捕获所有 `userJobSearch` 与 `gql-query-get-auth-job-details-v2` 响应,按页面 URL 推断 source,归一化进内存 map(列表 / 详情各一张),用户调用 `collected()` 时合并产出 Job[]。

**Files:**
- Create: `src/collect/Watcher.ts`
- Create: `tests/watcher.test.ts`

- [x] **Step 1: 编写失败测试**

```typescript
// tests/watcher.test.ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Watcher } from '../src/collect/Watcher';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/search-response.json'), 'utf8'),
);
const DETAIL_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/job-detail-response.json'), 'utf8'),
);

class FakeResponse {
  constructor(
    private _url: string,
    private _headers: Record<string, string>,
    private _body: unknown,
  ) {}
  url() { return this._url; }
  headers() { return this._headers; }
  async json() { return this._body; }
}

class FakePage extends EventEmitter {
  constructor(public currentUrl: string) {
    super();
  }
  url() { return this.currentUrl; }
}

class FakeContext extends EventEmitter {
  private _pages: FakePage[] = [];
  pages() { return this._pages; }
  addPage(p: FakePage) {
    this._pages.push(p);
    this.emit('page', p);
  }
  presetPage(p: FakePage) {
    this._pages.push(p);
  }
}

const JSON_CT = { 'content-type': 'application/json' };

async function flush() {
  await new Promise((r) => setTimeout(r, 10));
}

describe('Watcher', () => {
  it('监听已有页面的 userJobSearch 响应并按 ?q= 推断 source', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=react%20developer');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    const { jobs, listingCount, detailCount } = watcher.collected();
    const fixtureLen = SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results.length;
    expect(listingCount).toBe(fixtureLen);
    expect(detailCount).toBe(0);
    expect(jobs).toHaveLength(fixtureLen);
    expect(jobs[0].source).toBe('keyword:react developer');
    expect(jobs[0].detailFetched).toBe(false);
  });

  it('对后续新开的页面也 attach', async () => {
    const ctx = new FakeContext();
    const watcher = new Watcher(ctx as never);
    watcher.start();

    const newPage = new FakePage('https://www.upwork.com/nx/search/jobs/?q=python');
    ctx.addPage(newPage);

    newPage.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    expect(watcher.collected().listingCount).toBeGreaterThan(0);
    expect(watcher.collected().jobs[0].source).toBe('keyword:python');
  });

  it('捕获详情响应并与同 id 列表 Job 合并', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=k');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    const listingFirstId =
      SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results[0].id;
    const detailId = DETAIL_FIXTURE.data.jobAuthDetails.opening.job.info.id;
    expect(detailId).not.toBe(listingFirstId); // fixtures 是不同职位,正好测合并 fallback 行为

    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2',
        JSON_CT,
        DETAIL_FIXTURE,
      ),
    );
    await flush();

    const { jobs, listingCount, detailCount } = watcher.collected();
    expect(listingCount).toBeGreaterThan(0);
    expect(detailCount).toBe(1);
    // 同 id 合并,不同 id 各自独立
    const detailOnly = jobs.find((j) => j.id === detailId);
    expect(detailOnly).toBeDefined();
    expect(detailOnly!.detailFetched).toBe(true);
    expect(detailOnly!.category).toBe(
      DETAIL_FIXTURE.data.jobAuthDetails.opening.job.category.name,
    );
  });

  it('忽略 upwork.com 以外的响应与非 JSON 响应', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=x');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit(
      'response',
      new FakeResponse('https://example.com/api?alias=userJobSearch', JSON_CT, SEARCH_FIXTURE),
    );
    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        { 'content-type': 'text/html' },
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    expect(watcher.collected().listingCount).toBe(0);
  });

  it('source 推断:已保存搜索 URL → savedSearch:<path>,best-matches → feed:best-matches', async () => {
    const ctx = new FakeContext();
    const saved = new FakePage('https://www.upwork.com/nx/find-work/saved/abc123');
    const feed = new FakePage('https://www.upwork.com/nx/find-work/best-matches');
    ctx.presetPage(saved);
    ctx.presetPage(feed);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    saved.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    feed.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    const sources = new Set(watcher.collected().jobs.map((j) => j.source));
    expect([...sources].some((s) => s.startsWith('savedSearch:'))).toBe(true);
    expect([...sources].some((s) => s === 'feed:best-matches')).toBe(true);
  });

  it('同 id 的列表响应被后到的覆盖(用户翻回原页时)', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=k');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
      JSON_CT, SEARCH_FIXTURE,
    ));
    await flush();
    const firstCount = watcher.collected().listingCount;

    // 再 emit 一次:list 应仍是 firstCount(同 id 覆盖,不重复)
    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
      JSON_CT, SEARCH_FIXTURE,
    ));
    await flush();

    expect(watcher.collected().listingCount).toBe(firstCount);
  });
});
```

- [x] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/watcher.test.ts`
Expected: FAIL —— `Watcher` 模块不存在。

- [x] **Step 3: 编写最小实现**

```typescript
// src/collect/Watcher.ts
import type { BrowserContext, Page, Response } from 'playwright';
import type { Job } from '../types';
import { normalizeListingJob, normalizeDetailJob, mergeJobs } from './Normalizer';

const SEARCH_PRED = (url: string): boolean =>
  url.includes('alias=userJobSearch') && !url.includes('userJobSearch.');
const DETAIL_PRED = (url: string): boolean =>
  url.includes('alias=gql-query-get-auth-job-details-v2');

/** 根据页面当前 URL 推断本次响应应归属的 source 标签。 */
export function inferSource(pageUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return `page:${pageUrl}`;
  }
  if (parsed.pathname.includes('/nx/search/jobs/')) {
    const q = parsed.searchParams.get('q');
    return q ? `keyword:${q}` : 'search:unknown';
  }
  if (parsed.pathname.includes('/nx/find-work/saved/')) {
    return `savedSearch:${parsed.pathname}`;
  }
  if (parsed.pathname.includes('/nx/find-work/best-matches')) {
    return 'feed:best-matches';
  }
  if (parsed.pathname.startsWith('/jobs/')) {
    return 'job-detail-page';
  }
  return `page:${parsed.pathname}`;
}

interface SearchBody {
  data?: {
    search?: {
      universalSearchNuxt?: {
        userJobSearchV1?: {
          results?: unknown[];
        };
      };
    };
  };
}

interface DetailBody {
  data?: { jobAuthDetails?: unknown };
}

/**
 * 监听 BrowserContext 的所有页面(已有 + 后续新开),
 * 被动捕获 Upwork 列表与详情 GraphQL 响应,归一化进内存 map。
 * 调用 collected() 取合并结果。
 */
export class Watcher {
  private readonly listingByJobId = new Map<string, Job>();
  private readonly detailByJobId = new Map<string, Job>();
  private started = false;

  constructor(private readonly context: BrowserContext) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const p of this.context.pages()) this.attach(p);
    this.context.on('page', (p) => this.attach(p));
  }

  private attach(page: Page): void {
    page.on('response', (res) => {
      void this.onResponse(page, res);
    });
  }

  private async onResponse(page: Page, res: Response): Promise<void> {
    const url = res.url();
    if (!url.includes('upwork.com')) return;
    const ct = res.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;

    const isSearch = SEARCH_PRED(url);
    const isDetail = !isSearch && DETAIL_PRED(url);
    if (!isSearch && !isDetail) return;

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return;
    }

    const source = inferSource(page.url());
    if (isSearch) {
      const results = (body as SearchBody).data?.search?.universalSearchNuxt?.userJobSearchV1?.results;
      if (!results) return;
      for (const raw of results) {
        const job = normalizeListingJob(raw, source);
        this.listingByJobId.set(job.id, job);
      }
    } else {
      const jad = (body as DetailBody).data?.jobAuthDetails;
      if (!jad) return;
      const job = normalizeDetailJob(jad, source);
      this.detailByJobId.set(job.id, job);
    }
  }

  /** 取所有已捕获 Job:同 id 的列表/详情合并;只有详情没有列表的也带上。 */
  collected(): { jobs: Job[]; listingCount: number; detailCount: number } {
    const jobs: Job[] = [];
    for (const [id, listing] of this.listingByJobId) {
      const detail = this.detailByJobId.get(id);
      jobs.push(detail ? mergeJobs(listing, detail) : listing);
    }
    for (const [id, detail] of this.detailByJobId) {
      if (!this.listingByJobId.has(id)) jobs.push(detail);
    }
    return {
      jobs,
      listingCount: this.listingByJobId.size,
      detailCount: this.detailByJobId.size,
    };
  }
}
```

- [x] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/watcher.test.ts`
Expected: PASS,6 个用例全过。

- [x] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [x] **Step 6: 提交**

```bash
git add src/collect/Watcher.ts tests/watcher.test.ts
git commit -m "feat: 添加 Watcher 用户驱动被动采集监听器"
```

---

## Task B'2: watch CLI 命令 + 删除程序化 collect

**目的:**
1. 在 `src/cli.ts` 加 `watch` 命令:连 Chrome → 启动 Watcher → 等 stdin Enter → upsert + Run 记录。
2. 删除阶段 B 那个不可用的 `collect` 命令、`collectCommand`、`ListingCollector`、`DetailCollector` 及它们的测试。
3. `package.json` `scripts.collect` 改为 `scripts.watch`。
4. `CLAUDE.md` 数据流水线段落同步更新。

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `CLAUDE.md`
- Delete: `src/collect/ListingCollector.ts`
- Delete: `src/collect/DetailCollector.ts`
- Delete: `tests/listingCollector.test.ts`
- Delete: `tests/detailCollector.test.ts`

> 这一层是薄编排;不写单元测试,以全量回归 + B'3 的手动 E2E 验收。

- [x] **Step 1: 删除程序化采集器**

```bash
git rm src/collect/ListingCollector.ts src/collect/DetailCollector.ts \
       tests/listingCollector.test.ts tests/detailCollector.test.ts
```

- [x] **Step 2: 改 `src/cli.ts`**

把这段 import:

```typescript
import { resolveSources } from './collect/SourceResolver';
import { ListingCollector } from './collect/ListingCollector';
import { DetailCollector } from './collect/DetailCollector';
import { Pacer } from './pacer/Pacer';
import type { Job } from './types';
```

替换为:

```typescript
import { createInterface } from 'node:readline';
import { Watcher } from './collect/Watcher';
```

把整个 `async function collectCommand(): Promise<void> { ... }` 替换为:

```typescript
function promptEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function watchCommand(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.database), { recursive: true });

  const connector = new ChromeConnector(config.chrome);
  const { context } = await connector.connect();
  const watcher = new Watcher(context);
  watcher.start();

  console.log(
    '监听中:在 Chrome 里手动搜索/翻页/点开职位,我会被动捕获 userJobSearch 与详情接口响应。\n' +
      '完成后回到终端按 Enter 入库...',
  );
  await promptEnter('');

  const { jobs, listingCount, detailCount } = watcher.collected();
  console.log(`\n准备入库:${jobs.length} 条(列表 ${listingCount},详情 ${detailCount})`);
  if (jobs.length === 0) {
    console.log('没有捕获到任何职位,可能 Chrome 里没触发 userJobSearch。不写入数据库。');
    return;
  }

  const storage = new Storage(config.paths.database);
  const now = (): string => new Date().toISOString();
  const runId = storage.startRun(now());
  let jobsNew = 0;
  try {
    for (const job of jobs) {
      const { isNew } = storage.upsertJob(job, now());
      storage.linkRunJob(runId, job.id, isNew);
      if (isNew) jobsNew++;
    }
    storage.finishRun(runId, {
      jobsSeen: jobs.length,
      jobsNew,
      status: 'success',
      finishedAt: now(),
    });
  } finally {
    storage.close();
  }
  console.log(`运行 #${runId} 结束:seen=${jobs.length} new=${jobsNew}`);
}
```

把 commander 注册区里 `program.command('collect')...` 替换为:

```typescript
  program
    .command('watch')
    .description('附接已登录的 Chrome,被动监听你手动操作触发的搜索/详情响应,按 Enter 入库')
    .action(watchCommand);
```

- [x] **Step 3: 改 `package.json`**

把 `"collect": "tsx src/cli.ts collect"` 改为 `"watch": "tsx src/cli.ts watch"`。

- [x] **Step 4: 改 `CLAUDE.md`**

把命令区块里的 `npm run export` 上面追加一行 `npm run watch                         # 用户驱动:被动捕获 Chrome 里手动操作触发的响应,按 Enter 入库`。

把"数据流水线"段落里:
```
**[阶段 B:NetworkCapture / ListingCollector / DetailCollector / Normalizer]**
```
替换为:
```
**[Watcher(被动监听 Chrome)/ Normalizer]**
```

把"阶段化交付"里"**阶段 B**:NetworkCapture、Normalizer、Collectors、`collect` 命令、`SourceResolver` 的分类筛选分支"那一项改为:"**阶段 B'**(2026-05-20):用户驱动 Watcher、`watch` 命令(取代阶段 B 已废弃的程序化 `collect`)、SourceResolver 分类筛选 —— 完成于 `...-phase-b-prime.md`。"

- [x] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [x] **Step 6: 跑全量测试,确认无回归**

Run: `npm run test`
Expected: PASS。新增 6 个 watcher 用例;删掉 3(listing) + 1(detail) = 4 个旧 collector 用例。原 52 - 4 + 6 = **54 个**。

- [x] **Step 7: `npm run watch --help` 验证命令注册**

Run: `npx tsx src/cli.ts --help`
Expected: 列出 `login` / `watch` / `export`,没有 `collect`。

- [x] **Step 8: 提交**

```bash
git add -A src/cli.ts src/collect tests package.json CLAUDE.md
git commit -m "feat: watch 命令取代失败的程序化 collect;删除 ListingCollector/DetailCollector"
```

---

## Task B'3: 真实 E2E 验证

**目的:** 用 `npm run watch` 跑通一次真实采集 —— 用户手动搜索/翻页/点开 2-3 个职位,按 Enter 入库,验证 DB 有数据且字段正确。

**Files:** 无代码改动。

- [x] **Step 1: 前置 —— 确认 Chrome 在 9222 端口且 Upwork 已登录**

Run: `curl -sf http://127.0.0.1:9222/json/version > /dev/null && echo OK || echo "需重新 npm run login"`
Expected: `OK`。若不是,先 `npm run login` 完成登录。

- [x] **Step 2: 启动 watch**

Run: `npm run watch`
Expected: 终端打印"监听中:..."并等待 Enter。

- [x] **Step 3: 用户手动操作 Chrome**

操作:
1. 在 Upwork 标签里访问搜索 URL(如 `https://www.upwork.com/nx/search/jobs/?q=react%20developer`),让 SPA 跑出列表
2. 翻到第 2 页(可选)
3. 点开 2 个职位详情
4. 回到终端,按 Enter

Expected: 终端打印 `准备入库:N 条(列表 X,详情 Y)`,然后 `运行 #1 结束:seen=N new=N`。N 至少 10,Y 至少 2。

- [x] **Step 4: 验证 DB 写入**

Run:
```bash
node -e "
const db = require('better-sqlite3')('./data/upwork.db');
console.log('jobs:', db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n);
console.log('latest run:', db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get());
const sample = db.prepare('SELECT id, title, budget_type, category, detail_fetched, source FROM jobs ORDER BY first_seen DESC LIMIT 5').all();
console.table(sample);
"
```
Expected:
- `jobs` 表至少 10 行
- 最近一次 run 的 status 为 `success`
- 至少 2 行 `detail_fetched = 1` 且 `category` 非 null
- `source` 字段包含 `keyword:react developer`(或你搜的关键词)

- [x] **Step 5: 验证 export**

Run: `npm run export`
Expected: 打印 `已导出 N 个职位(运行 #...) 到 ./data/exports/upwork-jobs-<timestamp>.csv`。抽查 CSV 几行,字段齐全。

> 本任务无 commit(纯验证)。

---

## 阶段 B' 完成标准

- [x] `npm run test` —— 全部测试通过(54 个)。
- [x] `npm run typecheck` —— 无类型错误。
- [x] `npm run watch` —— 在用户手动操作下能完整跑通一次采集,DB 写入正确,详情合并字段(category / subcategory)出现。
- [x] `npm run export` —— 能导出最近一次 run 的职位为 CSV。
- [x] 没有任何生产代码调用 `browser.close()`。
- [x] `src/collect/ListingCollector.ts` / `DetailCollector.ts` 及对应测试已从仓库删除。
- [x] CLI 不再有 `collect` 命令;有 `watch` 命令。
- [x] CLAUDE.md 与 package.json 同步更新。

---

## 自查记录

**Spec 覆盖**(对照 findings 文档与 Phase B 失败教训):
- 不再做程序化 `page.goto` 搜索 → 由 Watcher 被动监听用户操作完成,避免 SPA 不响应问题。
- Watcher 同时处理 `userJobSearch`(列表)与 `gql-query-get-auth-job-details-v2`(详情)。
- Source 推断:`keyword:<q>` / `savedSearch:<path>` / `feed:best-matches` / `job-detail-page` / `page:<path>` —— 覆盖 Upwork 主要列表入口。
- 数据落地路径(Normalizer → mergeJobs → Storage.upsertJob → linkRunJob → finishRun)与 Phase B 设计一致,仅触发方式从主动改被动。

**留给下一阶段的事**(本计划不做):
- `SourceResolver.categoryFilters` 真实 URL 参数映射 —— 仍需独立观察任务。
- 多用户/多 Chrome profile 支持。
- 长驻 watcher 的持久化/崩溃恢复(目前内存 map,进程异常会丢)。

**占位符扫描:** 无 TBD / TODO / "implement later"。

**类型一致性:**
- `Watcher.collected()` 返回 `{ jobs: Job[]; listingCount: number; detailCount: number }`,所有字段在 B'2 watchCommand 中使用,签名一致;
- `inferSource` 在 Watcher 内部使用,导出便于将来扩展或测试;
- `Job` / `mergeJobs` / `normalizeListingJob` / `normalizeDetailJob` 类型沿用 Phase B Normalizer,未变。

**TDD 守纪律:** B'1 完整 TDD;B'2 是删除 + 薄编排,以全量回归验证;B'3 端到端验证。
