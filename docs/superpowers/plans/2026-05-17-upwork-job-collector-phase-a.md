# Upwork 职位收集器 — 阶段 A 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 Upwork 职位收集器中不依赖 Upwork 内部接口结构的全部基础模块,并通过一个发现任务产出真实响应 fixture,为阶段 B 铺路。

**Architecture:** Node.js + TypeScript 命令行程序。阶段 A 实现配置、SQLite 存储、节奏控制、来源解析、CSV 导出、浏览器会话管理、手动登录流程,以及 `login` / `export` 两个命令。最后的发现任务用真实登录会话观察 Upwork 网络流量,产出 fixture 与接口结构文档,供阶段 B 实现 NetworkCapture / Normalizer / Collectors。

**Tech Stack:** TypeScript、Playwright(Chromium)、better-sqlite3、vitest(测试)、tsx(运行 TS)、commander(CLI)。

**前置说明:**
- 设计依据:`docs/superpowers/specs/2026-05-17-upwork-job-collector-design.md`。
- 阶段 A **不实现** NetworkCapture、ListingCollector、DetailCollector、Normalizer、`collect` 命令、SourceResolver 的分类筛选分支 —— 这些依赖 Upwork 真实响应结构,在阶段 B 计划中编写。
- 全程 TDD:先写失败测试,再写最小实现。每个任务结束提交一次。
- 项目当前不是 git 仓库,Task 1 会执行 `git init`。

---

## 文件结构

| 文件 | 职责 | 阶段 |
|---|---|---|
| `package.json` / `tsconfig.json` / `.gitignore` | 工程脚手架 | A |
| `src/types.ts` | 领域类型:`Job` / `StoredJob` / `Run` / `Config` / `CategoryFilter` | A |
| `src/config.ts` | 读取并校验 `config.json` | A |
| `src/storage/schema.sql` | SQLite 建表语句 | A |
| `src/storage/Storage.ts` | SQLite 读写:upsert 去重、运行记录、运行-职位关联 | A |
| `src/pacer/Pacer.ts` | 随机延时 | A |
| `src/collect/SourceResolver.ts` | 关键词/已保存搜索 → 列表页 URL(分类筛选留阶段 B) | A |
| `src/export/CsvExporter.ts` | 把职位写成 CSV 文件 | A |
| `src/session/SessionManager.ts` | 启动 Chromium、加载/保存 storageState | A |
| `src/session/AuthFlow.ts` | 手动登录编排:开浏览器、等用户、存会话 | A |
| `src/cli.ts` | commander 命令入口:`login` / `export` | A |
| `scripts/observe.ts` | 发现工具:记录浏览器网络响应、转储 JSON | A |
| `tests/**` | 各模块测试 | A |
| `tests/fixtures/*.json` | 真实 Upwork 响应样本 | A(发现任务产出) |
| `docs/superpowers/specs/upwork-api-findings.md` | Upwork 接口结构findings | A(发现任务产出) |

---

## Task 1: 工程脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: 初始化 git 仓库**

Run: `git init`
Expected: `Initialized empty Git repository`

- [ ] **Step 2: 创建 `package.json`**

```json
{
  "name": "upwork-hub",
  "version": "0.1.0",
  "private": true,
  "description": "Upwork 职位信息收集器",
  "scripts": {
    "login": "tsx src/cli.ts login",
    "collect": "tsx src/cli.ts collect",
    "export": "tsx src/cli.ts export",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "commander": "^12.1.0",
    "playwright": "^1.48.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 4: 创建 `.gitignore`**

```
node_modules/
dist/
data/
```

- [ ] **Step 5: 安装依赖并下载 Chromium**

Run: `npm install && npx playwright install chromium`
Expected: 依赖安装完成,Chromium 浏览器下载完成,无报错。

- [ ] **Step 6: 验证依赖就位**

Run: `npm ls better-sqlite3 commander playwright vitest tsx typescript`
Expected: 六个包都列出版本号,无 `UNMET DEPENDENCY`。

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: 初始化工程脚手架"
```

---

## Task 2: 领域类型

**Files:**
- Create: `src/types.ts`

> 纯类型文件,无运行时行为,不写单元测试;以 `tsc --noEmit` 编译通过作为验证。

- [ ] **Step 1: 创建 `src/types.ts`**

```typescript
export type BudgetType = 'fixed' | 'hourly';

export type RunStatus = 'success' | 'failed' | 'session_expired';

/** 采集到的职位(尚未带存储元数据)。 */
export interface Job {
  id: string;
  url: string;
  title: string;
  description: string | null;
  budgetType: BudgetType | null;
  budgetAmount: number | null;
  hourlyMin: number | null;
  hourlyMax: number | null;
  skills: string[];
  category: string | null;
  subcategory: string | null;
  experienceLevel: string | null;
  projectDuration: string | null;
  proposalsCount: number | null;
  clientCountry: string | null;
  clientTotalSpent: number | null;
  clientHireRate: number | null;
  clientRating: number | null;
  clientPaymentVerified: boolean | null;
  postedAt: string | null;
  source: string;
  detailFetched: boolean;
  rawJson: string;
}

/** 从 SQLite 读出的职位,带首次/最近采集时间。 */
export interface StoredJob extends Job {
  firstSeen: string;
  lastSeen: string;
}

export interface Run {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  jobsSeen: number;
  jobsNew: number;
  status: RunStatus;
}

export interface CategoryFilter {
  category: string;
  budgetMin?: number;
  experienceLevel?: string;
}

export interface Config {
  sources: {
    keywords: string[];
    savedSearches: string[];
    categoryFilters: CategoryFilter[];
  };
  pacing: {
    minDelayMs: number;
    maxDelayMs: number;
    maxPagesPerSource: number;
    maxDetailsPerRun: number;
  };
  browser: { headless: boolean };
  paths: {
    storageState: string;
    database: string;
    exportDir: string;
  };
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npm run typecheck`
Expected: 无输出、退出码 0(`src/types.ts` 编译通过)。

- [ ] **Step 3: 提交**

```bash
git add src/types.ts
git commit -m "feat: 添加领域类型定义"
```

---

## Task 3: 配置加载与校验

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config';

function tmpConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'upwork-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, content);
  return path;
}

const validConfig = {
  sources: { keywords: ['react'], savedSearches: [], categoryFilters: [] },
  pacing: { minDelayMs: 3000, maxDelayMs: 8000, maxPagesPerSource: 5, maxDetailsPerRun: 50 },
  browser: { headless: false },
  paths: { storageState: './data/s.json', database: './data/u.db', exportDir: './data/exports' },
};

describe('loadConfig', () => {
  it('加载合法配置', () => {
    const cfg = loadConfig(tmpConfig(JSON.stringify(validConfig)));
    expect(cfg.sources.keywords).toEqual(['react']);
    expect(cfg.pacing.minDelayMs).toBe(3000);
  });

  it('缺少 sources 时报错', () => {
    const bad = { ...validConfig } as Record<string, unknown>;
    delete bad.sources;
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/sources/);
  });

  it('minDelayMs 大于 maxDelayMs 时报错', () => {
    const bad = { ...validConfig, pacing: { ...validConfig.pacing, minDelayMs: 9000 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/minDelayMs/);
  });

  it('文件不存在时报错', () => {
    expect(() => loadConfig('/no/such/config.json')).toThrow(/找不到配置文件/);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL —— `loadConfig` 未定义 / 模块不存在。

- [ ] **Step 3: 编写最小实现**

```typescript
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from './types';

function fail(msg: string): never {
  throw new Error(`配置无效:${msg}`);
}

export function loadConfig(path: string): Config {
  if (!existsSync(path)) throw new Error(`找不到配置文件:${path}`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('不是合法的 JSON');
  }

  const c = raw as Partial<Config>;
  if (!c.sources) fail('缺少 sources');
  if (!Array.isArray(c.sources.keywords)) fail('sources.keywords 必须是数组');
  if (!Array.isArray(c.sources.savedSearches)) fail('sources.savedSearches 必须是数组');
  if (!Array.isArray(c.sources.categoryFilters)) fail('sources.categoryFilters 必须是数组');

  if (!c.pacing) fail('缺少 pacing');
  const p = c.pacing;
  for (const k of ['minDelayMs', 'maxDelayMs', 'maxPagesPerSource', 'maxDetailsPerRun'] as const) {
    if (typeof p[k] !== 'number') fail(`pacing.${k} 必须是数字`);
  }
  if (p.minDelayMs > p.maxDelayMs) fail('pacing.minDelayMs 不能大于 maxDelayMs');

  if (!c.browser || typeof c.browser.headless !== 'boolean') fail('browser.headless 必须是布尔值');

  if (!c.paths) fail('缺少 paths');
  for (const k of ['storageState', 'database', 'exportDir'] as const) {
    if (typeof c.paths[k] !== 'string') fail(`paths.${k} 必须是字符串`);
  }

  return c as Config;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS,4 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: 添加配置加载与校验"
```

---

## Task 4: SQLite 存储

**Files:**
- Create: `src/storage/schema.sql`
- Create: `src/storage/Storage.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: 创建 `src/storage/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  budget_type TEXT,
  budget_amount REAL,
  hourly_min REAL,
  hourly_max REAL,
  skills TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  subcategory TEXT,
  experience_level TEXT,
  project_duration TEXT,
  proposals_count INTEGER,
  client_country TEXT,
  client_total_spent REAL,
  client_hire_rate REAL,
  client_rating REAL,
  client_payment_verified INTEGER,
  posted_at TEXT,
  source TEXT NOT NULL,
  detail_fetched INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  jobs_seen INTEGER NOT NULL DEFAULT 0,
  jobs_new INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'failed'
);

CREATE TABLE IF NOT EXISTS run_jobs (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  is_new INTEGER NOT NULL,
  PRIMARY KEY (run_id, job_id)
);
```

- [ ] **Step 2: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { Storage } from '../src/storage/Storage';
import type { Job } from '../src/types';

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'job-1', url: 'https://upwork.com/job/1', title: 'React 开发',
    description: null, budgetType: 'hourly', budgetAmount: null,
    hourlyMin: 30, hourlyMax: 60, skills: ['react', 'ts'],
    category: 'web', subcategory: null, experienceLevel: 'expert',
    projectDuration: null, proposalsCount: 5, clientCountry: 'US',
    clientTotalSpent: 1000, clientHireRate: 0.8, clientRating: 4.9,
    clientPaymentVerified: true, postedAt: '2026-05-17T00:00:00Z',
    source: 'keyword:react', detailFetched: false, rawJson: '{}',
    ...over,
  };
}

describe('Storage', () => {
  it('插入新职位返回 isNew=true', () => {
    const s = new Storage(':memory:');
    expect(s.upsertJob(makeJob(), '2026-05-17T10:00:00Z').isNew).toBe(true);
    s.close();
  });

  it('再次 upsert 同 id 返回 isNew=false 并保留 firstSeen', () => {
    const s = new Storage(':memory:');
    s.upsertJob(makeJob(), '2026-05-17T10:00:00Z');
    const r = s.upsertJob(makeJob({ title: '改了标题' }), '2026-05-17T12:00:00Z');
    expect(r.isNew).toBe(false);
    const job = s.getJob('job-1')!;
    expect(job.firstSeen).toBe('2026-05-17T10:00:00Z');
    expect(job.lastSeen).toBe('2026-05-17T12:00:00Z');
    expect(job.title).toBe('改了标题');
    expect(job.skills).toEqual(['react', 'ts']);
    s.close();
  });

  it('记录运行并关联职位', () => {
    const s = new Storage(':memory:');
    const runId = s.startRun('2026-05-17T10:00:00Z');
    s.upsertJob(makeJob(), '2026-05-17T10:00:00Z');
    s.linkRunJob(runId, 'job-1', true);
    s.finishRun(runId, { jobsSeen: 1, jobsNew: 1, status: 'success', finishedAt: '2026-05-17T10:05:00Z' });

    expect(s.getLatestRunId()).toBe(runId);
    const jobs = s.getJobsForRun(runId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-1');
    s.close();
  });
});
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL —— `Storage` 模块不存在。

- [ ] **Step 4: 编写 `src/storage/Storage.ts`**

```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, StoredJob, RunStatus } from '../types';

const SCHEMA = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

interface JobRow {
  id: string; url: string; title: string; description: string | null;
  budget_type: string | null; budget_amount: number | null;
  hourly_min: number | null; hourly_max: number | null; skills: string;
  category: string | null; subcategory: string | null;
  experience_level: string | null; project_duration: string | null;
  proposals_count: number | null; client_country: string | null;
  client_total_spent: number | null; client_hire_rate: number | null;
  client_rating: number | null; client_payment_verified: number | null;
  posted_at: string | null; source: string; detail_fetched: number;
  first_seen: string; last_seen: string; raw_json: string;
}

function rowToJob(r: JobRow): StoredJob {
  return {
    id: r.id, url: r.url, title: r.title, description: r.description,
    budgetType: r.budget_type as StoredJob['budgetType'],
    budgetAmount: r.budget_amount, hourlyMin: r.hourly_min, hourlyMax: r.hourly_max,
    skills: JSON.parse(r.skills) as string[],
    category: r.category, subcategory: r.subcategory,
    experienceLevel: r.experience_level, projectDuration: r.project_duration,
    proposalsCount: r.proposals_count, clientCountry: r.client_country,
    clientTotalSpent: r.client_total_spent, clientHireRate: r.client_hire_rate,
    clientRating: r.client_rating,
    clientPaymentVerified: r.client_payment_verified === null ? null : r.client_payment_verified === 1,
    postedAt: r.posted_at, source: r.source, detailFetched: r.detail_fetched === 1,
    firstSeen: r.first_seen, lastSeen: r.last_seen, rawJson: r.raw_json,
  };
}

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /** 插入或更新职位。返回是否为新职位。 */
  upsertJob(job: Job, now: string): { isNew: boolean } {
    const existing = this.db.prepare('SELECT id FROM jobs WHERE id = ?').get(job.id);
    const isNew = existing === undefined;
    this.db.prepare(`
      INSERT INTO jobs (
        id, url, title, description, budget_type, budget_amount, hourly_min, hourly_max,
        skills, category, subcategory, experience_level, project_duration, proposals_count,
        client_country, client_total_spent, client_hire_rate, client_rating,
        client_payment_verified, posted_at, source, detail_fetched,
        first_seen, last_seen, raw_json
      ) VALUES (
        @id, @url, @title, @description, @budget_type, @budget_amount, @hourly_min, @hourly_max,
        @skills, @category, @subcategory, @experience_level, @project_duration, @proposals_count,
        @client_country, @client_total_spent, @client_hire_rate, @client_rating,
        @client_payment_verified, @posted_at, @source, @detail_fetched,
        @now, @now, @raw_json
      )
      ON CONFLICT(id) DO UPDATE SET
        url = @url, title = @title, description = @description,
        budget_type = @budget_type, budget_amount = @budget_amount,
        hourly_min = @hourly_min, hourly_max = @hourly_max, skills = @skills,
        category = @category, subcategory = @subcategory,
        experience_level = @experience_level, project_duration = @project_duration,
        proposals_count = @proposals_count, client_country = @client_country,
        client_total_spent = @client_total_spent, client_hire_rate = @client_hire_rate,
        client_rating = @client_rating, client_payment_verified = @client_payment_verified,
        posted_at = @posted_at, source = @source, detail_fetched = @detail_fetched,
        last_seen = @now, raw_json = @raw_json
    `).run({
      id: job.id, url: job.url, title: job.title, description: job.description,
      budget_type: job.budgetType, budget_amount: job.budgetAmount,
      hourly_min: job.hourlyMin, hourly_max: job.hourlyMax,
      skills: JSON.stringify(job.skills), category: job.category,
      subcategory: job.subcategory, experience_level: job.experienceLevel,
      project_duration: job.projectDuration, proposals_count: job.proposalsCount,
      client_country: job.clientCountry, client_total_spent: job.clientTotalSpent,
      client_hire_rate: job.clientHireRate, client_rating: job.clientRating,
      client_payment_verified:
        job.clientPaymentVerified === null ? null : job.clientPaymentVerified ? 1 : 0,
      posted_at: job.postedAt, source: job.source,
      detail_fetched: job.detailFetched ? 1 : 0, raw_json: job.rawJson, now,
    });
    return { isNew };
  }

  getJob(id: string): StoredJob | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  startRun(now: string): number {
    const info = this.db.prepare('INSERT INTO runs (started_at) VALUES (?)').run(now);
    return Number(info.lastInsertRowid);
  }

  finishRun(
    runId: number,
    fields: { jobsSeen: number; jobsNew: number; status: RunStatus; finishedAt: string },
  ): void {
    this.db.prepare(`
      UPDATE runs SET jobs_seen = ?, jobs_new = ?, status = ?, finished_at = ? WHERE id = ?
    `).run(fields.jobsSeen, fields.jobsNew, fields.status, fields.finishedAt, runId);
  }

  linkRunJob(runId: number, jobId: string, isNew: boolean): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO run_jobs (run_id, job_id, is_new) VALUES (?, ?, ?)
    `).run(runId, jobId, isNew ? 1 : 0);
  }

  getLatestRunId(): number | undefined {
    const row = this.db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get() as
      | { id: number }
      | undefined;
    return row?.id;
  }

  getJobsForRun(runId: number): StoredJob[] {
    const rows = this.db.prepare(`
      SELECT j.* FROM jobs j
      JOIN run_jobs rj ON rj.job_id = j.id
      WHERE rj.run_id = ?
      ORDER BY j.posted_at DESC
    `).all(runId) as JobRow[];
    return rows.map(rowToJob);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS,3 个用例全过。

- [ ] **Step 6: 提交**

```bash
git add src/storage/schema.sql src/storage/Storage.ts tests/storage.test.ts
git commit -m "feat: 添加 SQLite 存储层"
```

---

## Task 5: 来源解析

**Files:**
- Create: `src/collect/SourceResolver.ts`
- Test: `tests/sourceResolver.test.ts`

> 阶段 A 只处理 `keywords` 与 `savedSearches`;`categoryFilters` 的 URL 参数映射依赖发现任务的结论,留阶段 B 扩展。

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSources } from '../src/collect/SourceResolver';
import type { Config } from '../src/types';

function cfg(over: Partial<Config['sources']>): Config {
  return {
    sources: { keywords: [], savedSearches: [], categoryFilters: [], ...over },
    pacing: { minDelayMs: 1, maxDelayMs: 2, maxPagesPerSource: 1, maxDetailsPerRun: 1 },
    browser: { headless: true },
    paths: { storageState: '', database: '', exportDir: '' },
  };
}

describe('resolveSources', () => {
  it('关键词解析为带编码 q 参数的搜索 URL', () => {
    const r = resolveSources(cfg({ keywords: ['react developer'] }));
    expect(r).toEqual([
      {
        type: 'keyword',
        label: 'react developer',
        url: 'https://www.upwork.com/nx/search/jobs/?q=react%20developer',
      },
    ]);
  });

  it('已保存搜索原样作为 URL', () => {
    const url = 'https://www.upwork.com/nx/find-work/saved/abc';
    const r = resolveSources(cfg({ savedSearches: [url] }));
    expect(r).toEqual([{ type: 'savedSearch', label: url, url }]);
  });

  it('保持 关键词 在前、已保存搜索在后的顺序', () => {
    const r = resolveSources(cfg({ keywords: ['a'], savedSearches: ['https://x'] }));
    expect(r.map((s) => s.type)).toEqual(['keyword', 'savedSearch']);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/sourceResolver.test.ts`
Expected: FAIL —— `resolveSources` 模块不存在。

- [ ] **Step 3: 编写 `src/collect/SourceResolver.ts`**

```typescript
import type { Config } from '../types';

export interface ResolvedSource {
  type: 'keyword' | 'savedSearch';
  label: string;
  url: string;
}

/**
 * 把配置里的来源展开成待访问的列表页 URL。
 * 阶段 A 仅处理 keywords 与 savedSearches;categoryFilters 留阶段 B。
 */
export function resolveSources(config: Config): ResolvedSource[] {
  const out: ResolvedSource[] = [];

  for (const keyword of config.sources.keywords) {
    out.push({
      type: 'keyword',
      label: keyword,
      url: `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(keyword)}`,
    });
  }

  for (const url of config.sources.savedSearches) {
    out.push({ type: 'savedSearch', label: url, url });
  }

  return out;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/sourceResolver.test.ts`
Expected: PASS,3 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/collect/SourceResolver.ts tests/sourceResolver.test.ts
git commit -m "feat: 添加来源解析(关键词与已保存搜索)"
```

---

## Task 6: 节奏控制

**Files:**
- Create: `src/pacer/Pacer.ts`
- Test: `tests/pacer.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { Pacer } from '../src/pacer/Pacer';

describe('Pacer', () => {
  it('randomDelayMs 落在 [min, max] 区间内', () => {
    const pacer = new Pacer(3000, 8000);
    for (let i = 0; i < 100; i++) {
      const d = pacer.randomDelayMs();
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });

  it('min 等于 max 时恒返回该值', () => {
    expect(new Pacer(5000, 5000).randomDelayMs()).toBe(5000);
  });

  it('wait 至少等待 min 毫秒', async () => {
    const pacer = new Pacer(20, 25);
    const start = Date.now();
    await pacer.wait();
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/pacer.test.ts`
Expected: FAIL —— `Pacer` 模块不存在。

- [ ] **Step 3: 编写 `src/pacer/Pacer.ts`**

```typescript
/** 在浏览器动作之间插入随机延时,模拟真人节奏。 */
export class Pacer {
  constructor(private readonly minDelayMs: number, private readonly maxDelayMs: number) {}

  randomDelayMs(): number {
    return this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
  }

  async wait(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.randomDelayMs()));
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/pacer.test.ts`
Expected: PASS,3 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/pacer/Pacer.ts tests/pacer.test.ts
git commit -m "feat: 添加随机延时节奏控制"
```

---

## Task 7: CSV 导出

**Files:**
- Create: `src/export/CsvExporter.ts`
- Test: `tests/csvExporter.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJobsToCsv } from '../src/export/CsvExporter';
import type { StoredJob } from '../src/types';

function makeStoredJob(over: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job-1', url: 'https://upwork.com/job/1', title: 'React 开发',
    description: '普通描述', budgetType: 'hourly', budgetAmount: null,
    hourlyMin: 30, hourlyMax: 60, skills: ['react', 'ts'],
    category: 'web', subcategory: null, experienceLevel: 'expert',
    projectDuration: null, proposalsCount: 5, clientCountry: 'US',
    clientTotalSpent: 1000, clientHireRate: 0.8, clientRating: 4.9,
    clientPaymentVerified: true, postedAt: '2026-05-17T00:00:00Z',
    source: 'keyword:react', detailFetched: true, rawJson: '{}',
    firstSeen: '2026-05-17T10:00:00Z', lastSeen: '2026-05-17T10:00:00Z',
    ...over,
  };
}

describe('exportJobsToCsv', () => {
  it('写出含表头与数据行的 CSV 文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upwork-csv-'));
    const path = exportJobsToCsv([makeStoredJob()], dir);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('title');
    expect(lines[1]).toContain('job-1');
  });

  it('转义含逗号、引号、换行的字段', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upwork-csv-'));
    const path = exportJobsToCsv(
      [makeStoredJob({ title: '带,逗号', description: '含"引号"\n和换行' })],
      dir,
    );
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('"带,逗号"');
    expect(content).toContain('"含""引号""\n和换行"');
  });

  it('空职位列表也写出仅含表头的文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upwork-csv-'));
    const path = exportJobsToCsv([], dir);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/csvExporter.test.ts`
Expected: FAIL —— `exportJobsToCsv` 模块不存在。

- [ ] **Step 3: 编写 `src/export/CsvExporter.ts`**

```typescript
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredJob } from '../types';

const COLUMNS: { header: string; get: (j: StoredJob) => unknown }[] = [
  { header: 'id', get: (j) => j.id },
  { header: 'title', get: (j) => j.title },
  { header: 'url', get: (j) => j.url },
  { header: 'budget_type', get: (j) => j.budgetType },
  { header: 'budget_amount', get: (j) => j.budgetAmount },
  { header: 'hourly_min', get: (j) => j.hourlyMin },
  { header: 'hourly_max', get: (j) => j.hourlyMax },
  { header: 'skills', get: (j) => j.skills.join('; ') },
  { header: 'category', get: (j) => j.category },
  { header: 'subcategory', get: (j) => j.subcategory },
  { header: 'experience_level', get: (j) => j.experienceLevel },
  { header: 'project_duration', get: (j) => j.projectDuration },
  { header: 'proposals_count', get: (j) => j.proposalsCount },
  { header: 'client_country', get: (j) => j.clientCountry },
  { header: 'client_total_spent', get: (j) => j.clientTotalSpent },
  { header: 'client_hire_rate', get: (j) => j.clientHireRate },
  { header: 'client_rating', get: (j) => j.clientRating },
  { header: 'client_payment_verified', get: (j) => j.clientPaymentVerified },
  { header: 'posted_at', get: (j) => j.postedAt },
  { header: 'source', get: (j) => j.source },
  { header: 'detail_fetched', get: (j) => j.detailFetched },
  { header: 'first_seen', get: (j) => j.firstSeen },
  { header: 'last_seen', get: (j) => j.lastSeen },
  { header: 'description', get: (j) => j.description },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 把职位写成带时间戳文件名的 CSV,返回写入路径。 */
export function exportJobsToCsv(jobs: StoredJob[], exportDir: string): string {
  mkdirSync(exportDir, { recursive: true });
  const rows = [COLUMNS.map((c) => c.header).join(',')];
  for (const job of jobs) {
    rows.push(COLUMNS.map((c) => csvCell(c.get(job))).join(','));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(exportDir, `upwork-jobs-${stamp}.csv`);
  writeFileSync(path, rows.join('\n') + '\n');
  return path;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/csvExporter.test.ts`
Expected: PASS,3 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/export/CsvExporter.ts tests/csvExporter.test.ts
git commit -m "feat: 添加 CSV 导出"
```

---

## Task 8: 浏览器会话管理

**Files:**
- Create: `src/session/SessionManager.ts`
- Test: `tests/sessionManager.test.ts`

> 集成测试:启动真实 Chromium,但不访问 Upwork。依赖 Task 1 已执行 `npx playwright install chromium`。

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../src/session/SessionManager';

describe('SessionManager', () => {
  it('hasStorageState 在文件不存在时返回 false', () => {
    const sm = new SessionManager({ storageStatePath: '/no/such/state.json', headless: true });
    expect(sm.hasStorageState()).toBe(false);
  });

  it('保存的 storageState 能在下次启动时恢复 cookie', async () => {
    const statePath = join(mkdtempSync(join(tmpdir(), 'upwork-sess-')), 'state.json');

    const first = new SessionManager({ storageStatePath: statePath, headless: true });
    const a = await first.launchContext();
    await a.context.addCookies([
      { name: 'probe', value: 'kept', domain: 'example.com', path: '/' },
    ]);
    await first.saveStorageState(a.context);
    await a.browser.close();

    const second = new SessionManager({ storageStatePath: statePath, headless: true });
    expect(second.hasStorageState()).toBe(true);
    const b = await second.launchContext();
    const cookies = await b.context.cookies('https://example.com');
    expect(cookies.find((c) => c.name === 'probe')?.value).toBe('kept');
    await b.browser.close();
  }, 30000);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/sessionManager.test.ts`
Expected: FAIL —— `SessionManager` 模块不存在。

- [ ] **Step 3: 编写 `src/session/SessionManager.ts`**

```typescript
import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface SessionOptions {
  storageStatePath: string;
  headless: boolean;
}

/** 启动 Chromium 并管理登录态(storageState)的加载与保存。 */
export class SessionManager {
  constructor(private readonly opts: SessionOptions) {}

  hasStorageState(): boolean {
    return existsSync(this.opts.storageStatePath);
  }

  /** 启动浏览器与上下文;若已有 storageState 则加载它。 */
  async launchContext(): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await chromium.launch({ headless: this.opts.headless });
    const context = await browser.newContext(
      this.hasStorageState() ? { storageState: this.opts.storageStatePath } : {},
    );
    return { browser, context };
  }

  /** 把当前上下文的登录态写到 storageState 文件。 */
  async saveStorageState(context: BrowserContext): Promise<void> {
    await context.storageState({ path: this.opts.storageStatePath });
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/sessionManager.test.ts`
Expected: PASS,2 个用例全过(第二个会真实启动 Chromium,约数秒)。

- [ ] **Step 5: 提交**

```bash
git add src/session/SessionManager.ts tests/sessionManager.test.ts
git commit -m "feat: 添加浏览器会话管理"
```

---

## Task 9: 手动登录流程

**Files:**
- Create: `src/session/AuthFlow.ts`
- Test: `tests/authFlow.test.ts`

> `runLogin` 接受注入的会话对象与「等待用户」函数,便于在不开真实浏览器、不连 Upwork 的情况下测试编排逻辑。

- [ ] **Step 1: 编写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { runLogin, type LoginSession } from '../src/session/AuthFlow';

function makeFakes() {
  const calls: string[] = [];
  const page = {
    goto: async (url: string) => { calls.push(`goto:${url}`); },
  };
  const context = { newPage: async () => page };
  const browser = { close: async () => { calls.push('close'); } };
  const session: LoginSession = {
    launchContext: async () => ({ browser, context } as never),
    saveStorageState: async () => { calls.push('save'); },
  };
  return { calls, session };
}

describe('runLogin', () => {
  it('导航到登录页、等用户、再保存会话并关闭', async () => {
    const { calls, session } = makeFakes();
    await runLogin(session, async () => { calls.push('prompt'); });
    expect(calls).toEqual([
      'goto:https://www.upwork.com/ab/account-security/login',
      'prompt',
      'save',
      'close',
    ]);
  });

  it('在用户确认之前不保存会话', async () => {
    const { calls, session } = makeFakes();
    let releasePrompt!: () => void;
    const promptDone = new Promise<void>((r) => { releasePrompt = r; });

    const loginDone = runLogin(session, () => promptDone);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).not.toContain('save');

    releasePrompt();
    await loginDone;
    expect(calls).toContain('save');
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/authFlow.test.ts`
Expected: FAIL —— `runLogin` 模块不存在。

- [ ] **Step 3: 编写 `src/session/AuthFlow.ts`**

```typescript
import type { Browser, BrowserContext } from 'playwright';

const LOGIN_URL = 'https://www.upwork.com/ab/account-security/login';

/** runLogin 所需的会话能力(由 SessionManager 满足,测试时可注入伪实现)。 */
export interface LoginSession {
  launchContext(): Promise<{ browser: Browser; context: BrowserContext }>;
  saveStorageState(context: BrowserContext): Promise<void>;
}

/**
 * 编排手动登录:打开浏览器到登录页,等用户完成登录(含 2FA),
 * 然后保存登录态并关闭浏览器。
 */
export async function runLogin(
  session: LoginSession,
  promptEnter: (message: string) => Promise<void>,
): Promise<void> {
  const { browser, context } = await session.launchContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL);
  await promptEnter('请在打开的浏览器中完成登录(含 2FA),完成后回到终端按 Enter...');
  await session.saveStorageState(context);
  await browser.close();
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/authFlow.test.ts`
Expected: PASS,2 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/session/AuthFlow.ts tests/authFlow.test.ts
git commit -m "feat: 添加手动登录编排"
```

---

## Task 10: CLI 入口(login / export)

**Files:**
- Create: `src/cli.ts`
- Create: `config.example.json`

> CLI 是把已测模块组装起来的薄编排层,不写单元测试;以手动运行命令验证。`collect` 命令在阶段 B 添加。

- [ ] **Step 1: 创建 `config.example.json`**

```json
{
  "sources": {
    "keywords": ["react developer", "python automation"],
    "savedSearches": [],
    "categoryFilters": []
  },
  "pacing": {
    "minDelayMs": 3000,
    "maxDelayMs": 8000,
    "maxPagesPerSource": 5,
    "maxDetailsPerRun": 50
  },
  "browser": { "headless": false },
  "paths": {
    "storageState": "./data/storageState.json",
    "database": "./data/upwork.db",
    "exportDir": "./data/exports"
  }
}
```

- [ ] **Step 2: 创建 `src/cli.ts`**

```typescript
import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config';
import { SessionManager } from './session/SessionManager';
import { runLogin } from './session/AuthFlow';
import { Storage } from './storage/Storage';
import { exportJobsToCsv } from './export/CsvExporter';

const CONFIG_PATH = process.env.UPWORK_HUB_CONFIG ?? './config.json';

function promptEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function loginCommand(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.storageState), { recursive: true });
  // 登录必须有头,否则无法手动操作。
  const session = new SessionManager({
    storageStatePath: config.paths.storageState,
    headless: false,
  });
  await runLogin(session, promptEnter);
  console.log(`登录会话已保存到 ${config.paths.storageState}`);
}

function exportCommand(): void {
  const config = loadConfig(CONFIG_PATH);
  const storage = new Storage(config.paths.database);
  try {
    const runId = storage.getLatestRunId();
    if (runId === undefined) {
      console.log('数据库中还没有运行记录,无可导出的职位。');
      return;
    }
    const jobs = storage.getJobsForRun(runId);
    const path = exportJobsToCsv(jobs, config.paths.exportDir);
    console.log(`已导出 ${jobs.length} 个职位(运行 #${runId})到 ${path}`);
  } finally {
    storage.close();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('upwork-hub').description('Upwork 职位信息收集器');

  program
    .command('login')
    .description('打开浏览器手动登录 Upwork 并保存会话')
    .action(loginCommand);

  program
    .command('export')
    .description('把最近一次运行采集的职位导出为 CSV')
    .action(exportCommand);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

- [ ] **Step 3: 验证 `export` 命令(空库情形)**

Run: `cp config.example.json config.json && npm run export`
Expected: 打印 `数据库中还没有运行记录,无可导出的职位。`,退出码 0。

- [ ] **Step 4: 验证 `login` 命令能启动(随后手动关掉浏览器与终端)**

Run: `npm run login`
Expected: 弹出 Chromium 窗口并停在 Upwork 登录页,终端显示等待提示。验证到此即可,按 Enter 让其保存并退出(此时未真正登录也可,只为验证流程跑通)。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 无输出、退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/cli.ts config.example.json
git commit -m "feat: 添加 CLI 入口(login 与 export 命令)"
```

---

## Task 11: 发现任务 —— 观察 Upwork 网络流量并产出 fixture

**Files:**
- Create: `scripts/observe.ts`
- Create: `tests/fixtures/.gitkeep`
- Create: `docs/superpowers/specs/upwork-api-findings.md`(产出文档)

> 本任务不是 TDD 编码任务,而是一次受控的真实观察。目标:用真实登录会话搞清楚 Upwork 列表/详情页调用了哪些接口、响应结构如何,并把真实响应存成 fixture,供阶段 B 编写 NetworkCapture 与 Normalizer。

- [ ] **Step 1: 编写观察脚本 `scripts/observe.ts`**

```typescript
/**
 * 发现工具:用已保存的登录会话打开指定 URL,
 * 把所有 upwork.com 的 XHR/fetch JSON 响应转储到 captures/ 目录。
 * 用法: tsx scripts/observe.ts "<要打开的 URL>"
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { SessionManager } from '../src/session/SessionManager';

async function main(): Promise<void> {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error('用法: tsx scripts/observe.ts "<URL>"');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(process.env.UPWORK_HUB_CONFIG ?? './config.json');
  const outDir = join('captures', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });

  // 观察用有头浏览器,便于人工确认页面正常加载。
  const session = new SessionManager({
    storageStatePath: config.paths.storageState,
    headless: false,
  });
  const { browser, context } = await session.launchContext();
  const page = await context.newPage();

  let index = 0;
  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] ?? '';
    if (!url.includes('upwork.com') || !ct.includes('json')) return;
    try {
      const body = await response.text();
      const name = `${String(index++).padStart(3, '0')}.json`;
      writeFileSync(
        join(outDir, name),
        JSON.stringify({ url, status: response.status(), body }, null, 2),
      );
      console.log(`捕获 ${name}  ${response.status()}  ${url}`);
    } catch {
      // 部分响应体不可读(如重定向),忽略。
    }
  });

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  console.log(`\n已加载页面。响应转储在 ${outDir}/`);
  console.log('可在浏览器中手动翻页/点开职位以捕获更多接口。完成后按 Enter 关闭...');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));

  await browser.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: 创建 fixture 目录占位**

Run: `mkdir -p tests/fixtures && touch tests/fixtures/.gitkeep`
Expected: `tests/fixtures/.gitkeep` 存在。

- [ ] **Step 3: 真实登录**

Run: `npm run login`
操作:在弹出的浏览器中用提供的账号完成真实登录(含 2FA),回到终端按 Enter。
Expected: 终端打印 `登录会话已保存到 ./data/storageState.json`。

- [ ] **Step 4: 观察「关键词搜索列表页」**

Run: `npx tsx scripts/observe.ts "https://www.upwork.com/nx/search/jobs/?q=react%20developer"`
操作:页面加载后,在浏览器里手动翻到第 2 页,再按 Enter 关闭。
Expected: `captures/<时间戳>/` 下出现若干 `NNN.json` 文件,终端逐条打印捕获的 URL。

- [ ] **Step 5: 观察「职位详情页」**

操作:从上一步的搜索结果里复制任意一个职位详情页 URL。
Run: `npx tsx scripts/observe.ts "<职位详情页 URL>"`
操作:加载后按 Enter 关闭。
Expected: `captures/<时间戳>/` 下出现详情页相关的 JSON 转储。

- [ ] **Step 6: 甄别并保存 fixture**

操作:翻看 `captures/` 里的 JSON 文件,找出**真正包含职位列表数据**和**职位详情数据**的那一两个响应。把它们的 `body` 内容(即真实响应 JSON)保存为:
- `tests/fixtures/search-response.json` —— 搜索列表接口的真实响应
- `tests/fixtures/job-detail-response.json` —— 职位详情接口的真实响应

Expected: 两个 fixture 文件存在且是合法 JSON(`node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/search-response.json','utf8'))"` 不报错,详情文件同理)。

- [ ] **Step 7: 编写接口结构文档 `docs/superpowers/specs/upwork-api-findings.md`**

文档需写明(基于实际观察填写,不是模板):
- **列表接口**:URL 模式、请求方法、翻页机制(查询参数 / 游标 / POST body),响应里职位数组所在的 JSON 路径。
- **详情接口**:URL 模式,响应里详情数据所在的 JSON 路径。
- **字段定位表**:把设计文档第 5 节 `jobs` 表的每个字段,对应到响应 JSON 里的具体路径(或标注「列表接口无此字段,需详情接口/DOM 兜底」)。
- **分类筛选 URL 参数**:分类、预算范围、经验等级等筛选项分别对应哪些查询参数(供阶段 B 的 SourceResolver 扩展)。
- **职位唯一 ID**:响应里哪个字段可作为 `jobs.id` 主键。

- [ ] **Step 8: 提交**

```bash
git add scripts/observe.ts tests/fixtures docs/superpowers/specs/upwork-api-findings.md
git commit -m "chore: 添加网络观察脚本与 Upwork 接口 fixture"
```

> `captures/` 目录不提交。若 `.gitignore` 未覆盖,补加一行 `captures/` 后一并提交。

---

## 阶段 A 完成标准

- [ ] `npm run test` —— 全部测试通过(config / storage / sourceResolver / pacer / csvExporter / sessionManager / authFlow)。
- [ ] `npm run typecheck` —— 无类型错误。
- [ ] `npm run login` —— 能完成真实登录并保存会话。
- [ ] `npm run export` —— 空库时给出友好提示。
- [ ] `tests/fixtures/search-response.json` 与 `job-detail-response.json` 是真实 Upwork 响应。
- [ ] `docs/superpowers/specs/upwork-api-findings.md` 记录了列表/详情接口结构、字段定位表、分类筛选参数。

满足后即可进入**阶段 B 计划**:基于 fixture 与接口文档,以 TDD 实现 NetworkCapture、Normalizer、ListingCollector、DetailCollector、`collect` 命令,以及 SourceResolver 的分类筛选分支。

---

## 自查记录

**Spec 覆盖**(对照设计文档):
- §3 模块:Config(T3)、Storage(T4)、Pacer(T6)、SourceResolver(T5,关键词/已保存搜索部分)、CsvExporter(T7)、SessionManager(T8)、AuthFlow(T9)、CLI(T10,login/export)均已覆盖。NetworkCapture / ListingCollector / DetailCollector / Normalizer / `collect` 命令 → 明确划入阶段 B。
- §5 数据模型:Storage 的 schema.sql 与方法覆盖 jobs / runs / run_jobs 三表及去重逻辑(T4)。
- §6 节奏:随机延时由 Pacer 覆盖(T6);翻页/详情数量上限是配置项,由阶段 B 的 Collectors 消费。
- §8 配置与结构:脚手架(T1)、Config(T3)、`config.example.json`(T10)覆盖。
- §9 测试:每个编码任务均为 TDD;集成测试见 T8;手动验证见 T10、T11。
- §10 开放项:发现任务(T11)产出 fixture 与接口结构文档,正面解决。

**占位符扫描**:无 TBD / TODO;T11 为观察任务,其「产出文档」的内容要求已具体到逐项,非占位符。

**类型一致性**:`Job` / `StoredJob` / `Config` / `RunStatus` 跨 T2–T10 命名一致;`Storage.upsertJob` / `getJob` / `startRun` / `finishRun` / `linkRunJob` / `getLatestRunId` / `getJobsForRun` 在 T4 定义、T10 使用,签名一致;`LoginSession` 在 T9 定义并被 `SessionManager`(T8)结构化满足。
