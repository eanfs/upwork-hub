# Upwork 职位收集器 — 阶段 B 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Upwork 列表/详情接口的网络拦截、归一化、采集器与 `collect` 命令,把阶段 A 已落地的基础模块连成完整的采集流水线,做到能跑 `npm run collect` 就把搜索结果入库。

**Architecture:** 以阶段 A 的 `ChromeConnector` 为入口,新增 `NetworkCapture`(在 Playwright 页面上拦截 `userJobSearch` / 详情接口的 JSON 响应)、`Normalizer`(把 GraphQL 响应映射成 `Job`)、`ListingCollector`(翻页采集列表)、`DetailCollector`(逐条补全详情),最后由 `cli.ts` 的 `collect` 命令编排:Config → Sources → Listing → Detail → Storage upsert → Run 记录。**绝不调用 `browser.close()`**;每个采集任务只新开标签 + `page.close()`。

**Tech Stack:** TypeScript、Playwright、better-sqlite3、vitest;不引新依赖。

**前置说明:**
- 设计依据:`docs/superpowers/specs/2026-05-17-upwork-job-collector-design.md`。
- 接口结构与字段定位:`docs/superpowers/specs/upwork-api-findings.md`。
- Fixture:`tests/fixtures/search-response.json`、`tests/fixtures/job-detail-response.json`。
- **不在本阶段做**:`SourceResolver` 的分类筛选分支(`CategoryFilter` → URL 参数)。findings 文档 §4 已说明此分支的 URL 参数尚未观察,需另起一次发现任务,留到 Phase B' 处理。`Config.sources.categoryFilters` 字段保留,`resolveSources` 遇到非空数组时**抛错提示尚未实现**,避免悄无声息地漏配置。
- TDD 守纪律:每个编码任务先写失败测试,再写最小实现;每任务结束 commit 一次。

---

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/collect/NetworkCapture.ts` | 在一个 `Page` 上拦截 JSON 响应,按 URL 谓词过滤,提供 `waitFor`(等下一条)/`getAll`(取已捕获) | B1 |
| `src/collect/Normalizer.ts` | `normalizeListingJob` / `normalizeDetailJob` / `mergeJobs`:把 GraphQL 响应原始对象映射成 `Job` | B2, B3 |
| `src/collect/ListingCollector.ts` | 给定已附接的 `BrowserContext` 与 `ResolvedSource`,新开标签 → 触发首页 + 后续页(`&page=N` 形式)→ 收集所有 Job | B4 |
| `src/collect/DetailCollector.ts` | 给定 Job(`id` + `ciphertext`),新开标签 → 触发详情接口 → 用详情归一化 + 合并 | B5 |
| `src/collect/SourceResolver.ts` | 修改:`categoryFilters` 非空时显式 throw | B6 |
| `src/cli.ts` | 修改:新增 `collect` 命令,把上述模块编排成一次完整采集 | B7 |
| `tests/networkCapture.test.ts` | 用 `EventEmitter` 伪装 `Page` 单元测试 | B1 |
| `tests/normalizer.test.ts` | 用 fixture 单元测试 listing / detail / merge | B2, B3 |
| `tests/listingCollector.test.ts` | 用 mock Page + mock Capture 单元测试翻页与终止条件 | B4 |
| `tests/detailCollector.test.ts` | 用 mock Page + mock Capture 单元测试 | B5 |
| `tests/sourceResolver.test.ts` | 扩充:`categoryFilters` 非空抛错 | B6 |

---

## Task B1: NetworkCapture

**目的:** 把"在 Page 上 attach `response` 监听 → 过滤 → 给采集器"的胶水代码沉到一个可单测的类里。

**Files:**
- Create: `src/collect/NetworkCapture.ts`
- Create: `tests/networkCapture.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/networkCapture.test.ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { NetworkCapture } from '../src/collect/NetworkCapture';

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

function makePage() {
  const ee = new EventEmitter();
  return Object.assign(ee, { emit: ee.emit.bind(ee), on: ee.on.bind(ee) });
}

const JSON_CT = { 'content-type': 'application/json' };

describe('NetworkCapture', () => {
  it('waitFor 在收到匹配响应时 resolve 响应体', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const promise = capture.waitFor((url) => url.includes('userJobSearch'));
    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        { data: 'ok' },
      ),
    );
    await expect(promise).resolves.toEqual({ data: 'ok' });
  });

  it('忽略非 upwork.com 的响应', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const promise = capture.waitFor(() => true, 50);
    page.emit('response', new FakeResponse('https://example.com/x', JSON_CT, {}));
    await expect(promise).rejects.toThrow(/超时/);
  });

  it('忽略非 JSON 响应', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const promise = capture.waitFor(() => true, 50);
    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/x',
        { 'content-type': 'text/html' },
        {},
      ),
    );
    await expect(promise).rejects.toThrow(/超时/);
  });

  it('waitFor 超时时抛错', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    await expect(capture.waitFor(() => true, 30)).rejects.toThrow(/超时/);
  });

  it('getAll 返回所有匹配的已捕获响应体', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    page.emit('response', new FakeResponse('https://www.upwork.com/a', JSON_CT, { i: 1 }));
    page.emit('response', new FakeResponse('https://www.upwork.com/b', JSON_CT, { i: 2 }));
    // 给 listener 时间消费
    await new Promise((r) => setTimeout(r, 10));
    const items = capture.getAll((url) => url.endsWith('/a') || url.endsWith('/b'));
    expect(items).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it('多个 waitFor 各自等到自己的匹配', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const pa = capture.waitFor((u) => u.endsWith('/a'));
    const pb = capture.waitFor((u) => u.endsWith('/b'));
    page.emit('response', new FakeResponse('https://www.upwork.com/b', JSON_CT, { v: 'b' }));
    page.emit('response', new FakeResponse('https://www.upwork.com/a', JSON_CT, { v: 'a' }));
    await expect(pa).resolves.toEqual({ v: 'a' });
    await expect(pb).resolves.toEqual({ v: 'b' });
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/networkCapture.test.ts`
Expected: FAIL —— `NetworkCapture` 模块不存在。

- [ ] **Step 3: 编写最小实现**

```typescript
// src/collect/NetworkCapture.ts
import type { Page, Response } from 'playwright';

type Predicate = (url: string, body: unknown) => boolean;

interface Waiter {
  predicate: (url: string) => boolean;
  resolve: (body: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 在一个 Playwright Page 上拦截 upwork.com 的 JSON 响应,
 * 提供「等下一条符合谓词的响应」与「取已捕获的全部响应」两种用法。
 */
export class NetworkCapture {
  private readonly captures: { url: string; body: unknown }[] = [];
  private readonly waiters: Waiter[] = [];

  constructor(page: Page) {
    page.on('response', (res) => {
      void this.onResponse(res);
    });
  }

  private async onResponse(res: Response): Promise<void> {
    const url = res.url();
    if (!url.includes('upwork.com')) return;
    const ct = res.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return;
    }
    this.captures.push({ url, body });
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.predicate(url)) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        w.resolve(body);
      }
    }
  }

  /** 等待下一条 URL 匹配谓词的响应;超时则 reject。 */
  waitFor<T = unknown>(predicate: (url: string) => boolean, timeoutMs = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (b) => resolve(b as T),
        reject,
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new Error(`等待网络响应超时 ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** 取已捕获的、URL 匹配谓词的全部响应体。 */
  getAll<T = unknown>(predicate: (url: string) => boolean): T[] {
    return this.captures.filter((c) => predicate(c.url)).map((c) => c.body as T);
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/networkCapture.test.ts`
Expected: PASS,6 个用例全过。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 无输出、退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/collect/NetworkCapture.ts tests/networkCapture.test.ts
git commit -m "feat: 添加 NetworkCapture 网络响应拦截器"
```

---

## Task B2: Normalizer —— 列表分支

**目的:** 把 `userJobSearchV1.results[i]` 一条记录映射成 `Job`(`detailFetched=false`)。字段映射规则严格按 findings 文档 §3。

**Files:**
- Create: `src/collect/Normalizer.ts`
- Create: `tests/normalizer.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeListingJob } from '../src/collect/Normalizer';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/search-response.json'), 'utf8'),
);

const RESULTS: any[] = SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results;

describe('normalizeListingJob', () => {
  it('从 fixture 第一条记录提取必备字段', () => {
    const raw = RESULTS[0];
    const job = normalizeListingJob(raw, 'keyword:react developer');
    expect(job.id).toBe(raw.id);
    expect(job.title).toBe(raw.title.replace(/H\^|\^H/g, ''));
    expect(job.url).toBe(`https://www.upwork.com/jobs/${raw.jobTile.job.ciphertext}`);
    expect(job.source).toBe('keyword:react developer');
    expect(job.detailFetched).toBe(false);
    expect(typeof job.rawJson).toBe('string');
    expect(JSON.parse(job.rawJson)).toEqual(raw);
  });

  it('FIXED 类型映射 budgetType 与 budgetAmount', () => {
    const fixed = RESULTS.find((r) => r.jobTile.job.jobType === 'FIXED');
    expect(fixed).toBeDefined();
    const job = normalizeListingJob(fixed, 'kw');
    expect(job.budgetType).toBe('fixed');
    expect(job.budgetAmount).toBe(Number(fixed.jobTile.job.fixedPriceAmount.amount));
    expect(job.hourlyMin).toBeNull();
    expect(job.hourlyMax).toBeNull();
  });

  it('HOURLY 类型映射 hourlyMin / hourlyMax', () => {
    const hourly = RESULTS.find((r) => r.jobTile.job.jobType === 'HOURLY');
    expect(hourly).toBeDefined();
    const job = normalizeListingJob(hourly, 'kw');
    expect(job.budgetType).toBe('hourly');
    expect(job.budgetAmount).toBeNull();
    expect(job.hourlyMin).toBe(Number(hourly.jobTile.job.hourlyBudgetMin));
    expect(job.hourlyMax).toBe(Number(hourly.jobTile.job.hourlyBudgetMax));
  });

  it('contractorTier 归一化为小写枚举', () => {
    const r = { ...RESULTS[0] };
    r.jobTile = { ...r.jobTile, job: { ...r.jobTile.job, contractorTier: 'ExpertLevel' } };
    expect(normalizeListingJob(r, 'kw').experienceLevel).toBe('expert');
    r.jobTile.job.contractorTier = 'IntermediateLevel';
    expect(normalizeListingJob(r, 'kw').experienceLevel).toBe('intermediate');
    r.jobTile.job.contractorTier = 'EntryLevel';
    expect(normalizeListingJob(r, 'kw').experienceLevel).toBe('entry');
  });

  it('skills 取 ontologySkills.prefLabel,空数组兜底', () => {
    const job = normalizeListingJob(RESULTS[0], 'kw');
    expect(job.skills).toEqual(RESULTS[0].ontologySkills.map((s: any) => s.prefLabel));
    const r2 = { ...RESULTS[0], ontologySkills: null };
    expect(normalizeListingJob(r2, 'kw').skills).toEqual([]);
  });

  it('client.paymentVerificationStatus 映射 clientPaymentVerified', () => {
    const r = { ...RESULTS[0] };
    r.upworkHistoryData = {
      ...r.upworkHistoryData,
      client: { ...r.upworkHistoryData.client, paymentVerificationStatus: 'VERIFIED' },
    };
    expect(normalizeListingJob(r, 'kw').clientPaymentVerified).toBe(true);
    r.upworkHistoryData.client.paymentVerificationStatus = 'NOT_VERIFIED';
    expect(normalizeListingJob(r, 'kw').clientPaymentVerified).toBe(false);
  });

  it('postedAt 取 jobTile.job.publishTime', () => {
    const job = normalizeListingJob(RESULTS[0], 'kw');
    expect(job.postedAt).toBe(RESULTS[0].jobTile.job.publishTime);
  });

  it('category / subcategory / description(完整版) 列表无法提供 → null/短描述', () => {
    const job = normalizeListingJob(RESULTS[0], 'kw');
    expect(job.category).toBeNull();
    expect(job.subcategory).toBeNull();
    // 列表 description 含高亮标记,本归一化负责剥离
    expect(job.description).toBe(RESULTS[0].description.replace(/H\^|\^H/g, ''));
  });

  it('projectDuration 按 jobType 取相应字段', () => {
    const fixed = RESULTS.find((r) => r.jobTile.job.jobType === 'FIXED');
    expect(normalizeListingJob(fixed, 'kw').projectDuration).toBe(
      fixed.jobTile.job.fixedPriceEngagementDuration?.label ?? null,
    );
    const hourly = RESULTS.find((r) => r.jobTile.job.jobType === 'HOURLY');
    expect(normalizeListingJob(hourly, 'kw').projectDuration).toBe(
      hourly.jobTile.job.hourlyEngagementDuration?.label ?? null,
    );
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/normalizer.test.ts`
Expected: FAIL —— `normalizeListingJob` 模块不存在。

- [ ] **Step 3: 编写最小实现**

```typescript
// src/collect/Normalizer.ts
import type { Job, BudgetType } from '../types';

/** 列表 title / description 含 `H^...^H` 高亮标记,显示前剥离。 */
function stripHighlight(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  return s.replace(/H\^|\^H/g, '');
}

function toNumber(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeTier(tier: string | null | undefined): string | null {
  if (!tier) return null;
  const lower = tier.toLowerCase();
  if (lower.includes('expert')) return 'expert';
  if (lower.includes('intermediate')) return 'intermediate';
  if (lower.includes('entry')) return 'entry';
  return lower;
}

interface ListingJobTile {
  job: {
    id: string;
    ciphertext: string;
    jobType: string;
    contractorTier: string | null;
    hourlyBudgetMin: string | null;
    hourlyBudgetMax: string | null;
    fixedPriceAmount?: { amount: string } | null;
    fixedPriceEngagementDuration?: { label: string } | null;
    hourlyEngagementDuration?: { label: string } | null;
    totalApplicants: number | null;
    publishTime: string | null;
  };
}

interface ListingClient {
  paymentVerificationStatus?: string | null;
  country?: string | null;
  totalReviews?: number | null;
  totalFeedback?: number | null;
  totalSpent?: { amount: string } | null;
}

interface ListingResult {
  id: string;
  title: string;
  description: string | null;
  ontologySkills: { prefLabel: string }[] | null;
  upworkHistoryData?: { client?: ListingClient | null } | null;
  jobTile: ListingJobTile;
}

/** 把 userJobSearchV1.results[i] 一条记录映射为 Job(detailFetched=false)。 */
export function normalizeListingJob(raw: unknown, source: string): Job {
  const r = raw as ListingResult;
  const j = r.jobTile.job;
  const isFixed = j.jobType === 'FIXED';
  const isHourly = j.jobType === 'HOURLY';
  const budgetType: BudgetType | null = isFixed ? 'fixed' : isHourly ? 'hourly' : null;
  const client = r.upworkHistoryData?.client ?? null;
  const projectDuration = isFixed
    ? j.fixedPriceEngagementDuration?.label ?? null
    : isHourly
      ? j.hourlyEngagementDuration?.label ?? null
      : null;

  return {
    id: r.id,
    url: `https://www.upwork.com/jobs/${j.ciphertext}`,
    title: stripHighlight(r.title) ?? '',
    description: stripHighlight(r.description),
    budgetType,
    budgetAmount: isFixed ? toNumber(j.fixedPriceAmount?.amount ?? null) : null,
    hourlyMin: isHourly ? toNumber(j.hourlyBudgetMin) : null,
    hourlyMax: isHourly ? toNumber(j.hourlyBudgetMax) : null,
    skills: (r.ontologySkills ?? []).map((s) => s.prefLabel),
    category: null,
    subcategory: null,
    experienceLevel: normalizeTier(j.contractorTier),
    projectDuration,
    proposalsCount: j.totalApplicants ?? null,
    clientCountry: client?.country ?? null,
    clientTotalSpent: toNumber(client?.totalSpent?.amount ?? null),
    clientHireRate: null,
    clientRating: client?.totalFeedback ?? null,
    clientPaymentVerified:
      client?.paymentVerificationStatus === undefined || client?.paymentVerificationStatus === null
        ? null
        : client.paymentVerificationStatus === 'VERIFIED',
    postedAt: j.publishTime ?? null,
    source,
    detailFetched: false,
    rawJson: JSON.stringify(raw),
  };
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/normalizer.test.ts`
Expected: PASS,9 个用例全过。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/collect/Normalizer.ts tests/normalizer.test.ts
git commit -m "feat: 添加 Normalizer 列表分支 — userJobSearch → Job"
```

---

## Task B3: Normalizer —— 详情分支 + 合并

**目的:** 增加 `normalizeDetailJob`(从 `jobAuthDetails` 提取 `Job`,`detailFetched=true`)与 `mergeJobs`(把详情字段并到列表 Job 上)。

**Files:**
- Modify: `src/collect/Normalizer.ts`
- Modify: `tests/normalizer.test.ts`(追加用例)

- [ ] **Step 1: 编写失败测试**

把下列内容**追加**到 `tests/normalizer.test.ts` 末尾:

```typescript
import { normalizeDetailJob, mergeJobs } from '../src/collect/Normalizer';

const DETAIL_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/job-detail-response.json'), 'utf8'),
);
const DETAIL: any = DETAIL_FIXTURE.data.jobAuthDetails;

describe('normalizeDetailJob', () => {
  it('从 fixture 提取详情专属字段', () => {
    const job = normalizeDetailJob(DETAIL, 'kw');
    expect(job.id).toBe(DETAIL.opening.job.info.id);
    expect(job.url).toBe(`https://www.upwork.com/jobs/${DETAIL.opening.job.info.ciphertext}`);
    expect(job.title).toBe(DETAIL.opening.job.info.title);
    expect(job.description).toBe(DETAIL.opening.job.description);
    expect(job.category).toBe(DETAIL.opening.job.category.name);
    expect(job.subcategory).toBe(DETAIL.opening.job.categoryGroup.name);
    expect(job.detailFetched).toBe(true);
    expect(JSON.parse(job.rawJson)).toEqual(DETAIL);
  });

  it('详情的 contractorTier 也归一化为小写', () => {
    const job = normalizeDetailJob(DETAIL, 'kw');
    expect(['expert', 'intermediate', 'entry']).toContain(job.experienceLevel);
  });

  it('budget 取 opening.job.info.type(HOURLY/FIXED) + extendedBudgetInfo 或 budget.amount', () => {
    const job = normalizeDetailJob(DETAIL, 'kw');
    expect(job.budgetType).toBe(DETAIL.opening.job.info.type === 'FIXED' ? 'fixed' : 'hourly');
  });

  it('clientPaymentVerified 取 buyer.isPaymentMethodVerified', () => {
    const d = JSON.parse(JSON.stringify(DETAIL));
    d.buyer.isPaymentMethodVerified = true;
    expect(normalizeDetailJob(d, 'kw').clientPaymentVerified).toBe(true);
    d.buyer.isPaymentMethodVerified = false;
    expect(normalizeDetailJob(d, 'kw').clientPaymentVerified).toBe(false);
  });
});

describe('mergeJobs', () => {
  it('详情非空字段覆盖列表;detailFetched 取 detail 的值', () => {
    const listing = normalizeListingJob(RESULTS[0], 'kw');
    const detail = normalizeDetailJob(DETAIL, 'kw');
    const merged = mergeJobs(listing, detail);
    expect(merged.id).toBe(listing.id); // 主键以 listing 为准
    expect(merged.title).toBe(detail.title); // detail 覆盖
    expect(merged.description).toBe(detail.description);
    expect(merged.category).toBe(detail.category);
    expect(merged.subcategory).toBe(detail.subcategory);
    expect(merged.detailFetched).toBe(true);
    // listing 独有 / detail 没有的字段保留 listing 的
    expect(merged.source).toBe(listing.source);
  });

  it('详情为空的字段不覆盖列表已有非空值', () => {
    const listing = { ...normalizeListingJob(RESULTS[0], 'kw'), clientCountry: 'USA' };
    const detail = { ...normalizeDetailJob(DETAIL, 'kw'), clientCountry: null };
    expect(mergeJobs(listing, detail).clientCountry).toBe('USA');
  });

  it('rawJson 拼成 {listing, detail} 双载荷', () => {
    const listing = normalizeListingJob(RESULTS[0], 'kw');
    const detail = normalizeDetailJob(DETAIL, 'kw');
    const merged = mergeJobs(listing, detail);
    const parsed = JSON.parse(merged.rawJson);
    expect(parsed).toHaveProperty('listing');
    expect(parsed).toHaveProperty('detail');
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/normalizer.test.ts`
Expected: FAIL —— `normalizeDetailJob` / `mergeJobs` 未导出。

- [ ] **Step 3: 在 `src/collect/Normalizer.ts` 末尾追加实现**

```typescript
interface DetailJob {
  data?: never; // marker
  opening: {
    job: {
      description: string | null;
      contractorTier: string | null;
      postedOn: string | null;
      publishTime: string | null;
      engagementDuration: { label: string } | null;
      extendedBudgetInfo: { hourlyBudgetMin: string | null; hourlyBudgetMax: string | null } | null;
      budget: { amount: number; currencyCode: string } | null;
      category: { name: string; urlSlug: string } | null;
      categoryGroup: { name: string; urlSlug: string } | null;
      clientActivity: { totalApplicants: number | null } | null;
      info: {
        id: string;
        ciphertext: string;
        title: string;
        type: 'FIXED' | 'HOURLY';
      };
      sandsData: { additionalSkills: { prefLabel: string }[] | null } | null;
    };
  };
  buyer: {
    isPaymentMethodVerified: boolean | null;
    info: {
      location: { country: string | null } | null;
      stats: { totalCharges: number | null; score: number | null; feedbackCount: number | null } | null;
    } | null;
  };
}

/** 把 data.jobAuthDetails 一条记录映射为 Job(detailFetched=true)。 */
export function normalizeDetailJob(raw: unknown, source: string): Job {
  const d = raw as DetailJob;
  const j = d.opening.job;
  const isFixed = j.info.type === 'FIXED';
  const budgetType: BudgetType = isFixed ? 'fixed' : 'hourly';
  const buyerInfo = d.buyer?.info;
  const stats = buyerInfo?.stats;

  return {
    id: j.info.id,
    url: `https://www.upwork.com/jobs/${j.info.ciphertext}`,
    title: j.info.title,
    description: j.description,
    budgetType,
    budgetAmount: isFixed && j.budget ? j.budget.amount : null,
    hourlyMin: !isFixed ? toNumber(j.extendedBudgetInfo?.hourlyBudgetMin ?? null) : null,
    hourlyMax: !isFixed ? toNumber(j.extendedBudgetInfo?.hourlyBudgetMax ?? null) : null,
    skills: (j.sandsData?.additionalSkills ?? []).map((s) => s.prefLabel),
    category: j.category?.name ?? null,
    subcategory: j.categoryGroup?.name ?? null,
    experienceLevel: normalizeTier(j.contractorTier),
    projectDuration: j.engagementDuration?.label ?? null,
    proposalsCount: j.clientActivity?.totalApplicants ?? null,
    clientCountry: buyerInfo?.location?.country ?? null,
    clientTotalSpent: stats?.totalCharges ?? null,
    clientHireRate: null,
    clientRating: stats?.score ?? null,
    clientPaymentVerified: d.buyer?.isPaymentMethodVerified ?? null,
    postedAt: j.publishTime ?? j.postedOn ?? null,
    source,
    detailFetched: true,
    rawJson: JSON.stringify(raw),
  };
}

/** 把详情 Job 并到列表 Job 上;详情非空字段覆盖列表对应字段。 */
export function mergeJobs(listing: Job, detail: Job): Job {
  const pick = <K extends keyof Job>(k: K): Job[K] =>
    (detail[k] !== null && detail[k] !== undefined && (Array.isArray(detail[k]) ? (detail[k] as unknown[]).length > 0 : true)
      ? detail[k]
      : listing[k]) as Job[K];

  return {
    ...listing,
    title: pick('title') as string,
    description: pick('description'),
    budgetType: pick('budgetType'),
    budgetAmount: pick('budgetAmount'),
    hourlyMin: pick('hourlyMin'),
    hourlyMax: pick('hourlyMax'),
    skills: pick('skills'),
    category: pick('category'),
    subcategory: pick('subcategory'),
    experienceLevel: pick('experienceLevel'),
    projectDuration: pick('projectDuration'),
    proposalsCount: pick('proposalsCount'),
    clientCountry: pick('clientCountry'),
    clientTotalSpent: pick('clientTotalSpent'),
    clientRating: pick('clientRating'),
    clientPaymentVerified: pick('clientPaymentVerified'),
    postedAt: pick('postedAt'),
    detailFetched: true,
    rawJson: JSON.stringify({ listing: JSON.parse(listing.rawJson), detail: JSON.parse(detail.rawJson) }),
  };
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/normalizer.test.ts`
Expected: PASS,共 9(B2)+ 7(B3)= 16 个用例全过。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/collect/Normalizer.ts tests/normalizer.test.ts
git commit -m "feat: Normalizer 补详情分支与合并函数"
```

---

## Task B4: ListingCollector

**目的:** 在已附接的 `BrowserContext` 上新开标签 → 访问搜索 URL → 拦截 `userJobSearch` 响应 → 提取 Job 列表;按 `paging` 决定是否翻页(URL 增加 `&page=N`,N 从 2 起)。

**翻页 URL 形式说明:** Upwork SPA 的搜索页支持 `?q=...&page=2` 形式;首页 `page=1` 可省略。**实现前需做一次极小的人工验证**(见 Step 1)。如果实际不工作,要回退到"点击 Next 按钮"。

**Files:**
- Create: `src/collect/ListingCollector.ts`
- Create: `tests/listingCollector.test.ts`

- [ ] **Step 1: 人工验证翻页 URL 参数**

操作:在你已登录的 Chrome 标签里直接访问 `https://www.upwork.com/nx/search/jobs/?q=react%20developer&page=2`。

Expected: 页面正常加载第 2 页搜索结果(可比对第一项 id 与之前 captures/2026-05-20T13-33-59-414Z/043.json 的 `results[0].id` 是否一致 / 不同页内容确实不一样)。

如果加载的不是第 2 页 → **暂停**,改用 `_readpage.ts` 模式手动观察 Next 按钮的 selector,调整下面的实现策略后再继续。

- [ ] **Step 2: 编写失败测试**

```typescript
// tests/listingCollector.test.ts
import { describe, it, expect } from 'vitest';
import { ListingCollector } from '../src/collect/ListingCollector';
import type { Job } from '../src/types';

interface FakePage {
  goto: (url: string, opts?: unknown) => Promise<void>;
  close: () => Promise<void>;
  visited: string[];
}

function makeFakeContext(visited: string[]) {
  return {
    newPage: async (): Promise<FakePage> => ({
      goto: async (url: string) => {
        visited.push(url);
      },
      close: async () => {},
      visited,
    }),
  };
}

function fakeCapture(responses: unknown[]) {
  let i = 0;
  return {
    waitFor: async <T>(_pred: (url: string) => boolean): Promise<T> => {
      if (i >= responses.length) throw new Error('no more responses queued');
      return responses[i++] as T;
    },
    getAll: () => [],
  };
}

function makeSearchResponse(
  offset: number,
  total: number,
  results: { id: string }[],
): unknown {
  return {
    data: {
      search: {
        universalSearchNuxt: {
          userJobSearchV1: {
            paging: { offset, total, count: results.length },
            facets: {},
            results: results.map((r) => ({
              id: r.id,
              title: 'T',
              description: 'D',
              ontologySkills: [],
              upworkHistoryData: { client: { paymentVerificationStatus: 'VERIFIED' } },
              jobTile: {
                job: {
                  id: r.id,
                  ciphertext: `~02${r.id}`,
                  jobType: 'FIXED',
                  contractorTier: 'IntermediateLevel',
                  hourlyBudgetMin: null,
                  hourlyBudgetMax: null,
                  fixedPriceAmount: { amount: '100' },
                  totalApplicants: 1,
                  publishTime: '2026-05-20T00:00:00Z',
                },
              },
            })),
          },
        },
      },
    },
  };
}

describe('ListingCollector', () => {
  it('单页抓完即停(paging.total <= count)', async () => {
    const visited: string[] = [];
    const ctx = makeFakeContext(visited);
    const capture = fakeCapture([
      makeSearchResponse(0, 1, [{ id: 'j1' }]),
    ]);
    const jobs = await new ListingCollector().collect({
      context: ctx as never,
      createCapture: () => capture as never,
      source: {
        type: 'keyword',
        label: 'k',
        url: 'https://www.upwork.com/nx/search/jobs/?q=k',
      },
      maxPages: 3,
    });
    expect(jobs.map((j: Job) => j.id)).toEqual(['j1']);
    expect(visited).toEqual(['https://www.upwork.com/nx/search/jobs/?q=k']);
  });

  it('多页翻页:遵守 maxPages 与 paging.total 双终止条件', async () => {
    const visited: string[] = [];
    const ctx = makeFakeContext(visited);
    const capture = fakeCapture([
      makeSearchResponse(0, 25, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'h' }, { id: 'i' }, { id: 'j' }]),
      makeSearchResponse(10, 25, [{ id: 'k' }, { id: 'l' }, { id: 'm' }, { id: 'n' }, { id: 'o' }, { id: 'p' }, { id: 'q' }, { id: 'r' }, { id: 's' }, { id: 't' }]),
    ]);
    const jobs = await new ListingCollector().collect({
      context: ctx as never,
      createCapture: () => capture as never,
      source: { type: 'keyword', label: 'k', url: 'https://www.upwork.com/nx/search/jobs/?q=k' },
      maxPages: 2,
    });
    expect(jobs).toHaveLength(20);
    expect(visited).toEqual([
      'https://www.upwork.com/nx/search/jobs/?q=k',
      'https://www.upwork.com/nx/search/jobs/?q=k&page=2',
    ]);
  });

  it('抓完所有页(total < maxPages*count)正常终止', async () => {
    const visited: string[] = [];
    const ctx = makeFakeContext(visited);
    const capture = fakeCapture([
      makeSearchResponse(0, 15, Array.from({ length: 10 }, (_, i) => ({ id: `p1-${i}` }))),
      makeSearchResponse(10, 15, Array.from({ length: 5 }, (_, i) => ({ id: `p2-${i}` }))),
    ]);
    const jobs = await new ListingCollector().collect({
      context: ctx as never,
      createCapture: () => capture as never,
      source: { type: 'keyword', label: 'k', url: 'https://www.upwork.com/nx/search/jobs/?q=k' },
      maxPages: 10,
    });
    expect(jobs).toHaveLength(15);
    expect(visited).toHaveLength(2);
  });
});
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `npx vitest run tests/listingCollector.test.ts`
Expected: FAIL —— `ListingCollector` 未定义。

- [ ] **Step 4: 编写最小实现**

```typescript
// src/collect/ListingCollector.ts
import type { BrowserContext, Page } from 'playwright';
import type { Job } from '../types';
import type { ResolvedSource } from './SourceResolver';
import { NetworkCapture } from './NetworkCapture';
import { normalizeListingJob } from './Normalizer';

interface SearchResponse {
  data: {
    search: {
      universalSearchNuxt: {
        userJobSearchV1: {
          paging: { offset: number; total: number; count: number };
          results: unknown[];
        };
      };
    };
  };
}

const SEARCH_PRED = (url: string): boolean =>
  url.includes('alias=userJobSearch') && !url.includes('userJobSearch.');

export interface CollectOptions {
  context: BrowserContext;
  createCapture?: (page: Page) => Pick<NetworkCapture, 'waitFor'>;
  source: ResolvedSource;
  maxPages: number;
}

export class ListingCollector {
  /**
   * 在新标签里访问列表 URL,拦截 userJobSearch 响应,
   * 按 `&page=N` 翻页,直到耗尽 maxPages 或 paging.total。
   * 注意:只 page.close() 自己开的标签,绝不调用 browser.close()。
   */
  async collect(opts: CollectOptions): Promise<Job[]> {
    const page = await opts.context.newPage();
    const capture =
      opts.createCapture?.(page) ?? new NetworkCapture(page);
    try {
      const jobs: Job[] = [];
      for (let pageNum = 1; pageNum <= opts.maxPages; pageNum++) {
        const url =
          pageNum === 1 ? opts.source.url : `${opts.source.url}&page=${pageNum}`;
        const responsePromise = capture.waitFor<SearchResponse>(SEARCH_PRED);
        await page.goto(url, { waitUntil: 'networkidle' });
        const body = await responsePromise;
        const v1 = body.data.search.universalSearchNuxt.userJobSearchV1;
        for (const raw of v1.results) {
          jobs.push(normalizeListingJob(raw, `${opts.source.type}:${opts.source.label}`));
        }
        const reached = v1.paging.offset + v1.paging.count;
        if (reached >= v1.paging.total) break;
      }
      return jobs;
    } finally {
      await page.close();
    }
  }
}
```

> **注意:** 上述实现的 `page.goto(url)` 是程序化导航,**可能触发 Cloudflare 质询**。CLAUDE.md 已明确:若触发,需改走"用户手动导航 + 只读 dump"路径,这条降级路径不在本 Task 内实现;Task B7 的手动 E2E 验证会暴露问题,如出现再追加 Task B4.5。

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx vitest run tests/listingCollector.test.ts`
Expected: PASS,3 个用例全过。

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [ ] **Step 7: 提交**

```bash
git add src/collect/ListingCollector.ts tests/listingCollector.test.ts
git commit -m "feat: 添加 ListingCollector 列表页翻页采集"
```

---

## Task B5: DetailCollector

**目的:** 给定一个列表 Job(带 `ciphertext` —— 从 URL 末尾 `/jobs/<ciphertext>` 反解出来),新开标签访问详情页 → 拦截 `gql-query-get-auth-job-details-v2` 响应 → 归一化 → 与列表 Job 合并。

**Files:**
- Create: `src/collect/DetailCollector.ts`
- Create: `tests/detailCollector.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/detailCollector.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DetailCollector } from '../src/collect/DetailCollector';
import { normalizeListingJob } from '../src/collect/Normalizer';
import type { Job } from '../src/types';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/search-response.json'), 'utf8'),
);
const DETAIL_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/job-detail-response.json'), 'utf8'),
);

function makeFakeContext(visited: string[]) {
  return {
    newPage: async () => ({
      goto: async (url: string) => {
        visited.push(url);
      },
      close: async () => {},
    }),
  };
}

function fakeCapture(response: unknown) {
  return {
    waitFor: async () => response,
    getAll: () => [],
  };
}

describe('DetailCollector', () => {
  it('对一个列表 Job 抓详情并合并', async () => {
    const visited: string[] = [];
    const ctx = makeFakeContext(visited);
    const listing: Job = normalizeListingJob(
      SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results[0],
      'kw',
    );
    const enriched = await new DetailCollector().collect({
      context: ctx as never,
      createCapture: () => fakeCapture(DETAIL_FIXTURE) as never,
      job: listing,
    });
    expect(visited).toEqual([listing.url]);
    expect(enriched.id).toBe(listing.id);
    expect(enriched.detailFetched).toBe(true);
    // 详情独有字段被合并进来
    expect(enriched.category).toBe(
      DETAIL_FIXTURE.data.jobAuthDetails.opening.job.category.name,
    );
    expect(enriched.subcategory).toBe(
      DETAIL_FIXTURE.data.jobAuthDetails.opening.job.categoryGroup.name,
    );
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/detailCollector.test.ts`
Expected: FAIL —— `DetailCollector` 未定义。

- [ ] **Step 3: 编写最小实现**

```typescript
// src/collect/DetailCollector.ts
import type { BrowserContext, Page } from 'playwright';
import type { Job } from '../types';
import { NetworkCapture } from './NetworkCapture';
import { normalizeDetailJob, mergeJobs } from './Normalizer';

const DETAIL_PRED = (url: string): boolean =>
  url.includes('alias=gql-query-get-auth-job-details-v2');

export interface DetailCollectOptions {
  context: BrowserContext;
  createCapture?: (page: Page) => Pick<NetworkCapture, 'waitFor'>;
  job: Job;
}

interface DetailResponse {
  data: { jobAuthDetails: unknown };
}

export class DetailCollector {
  /**
   * 在新标签里打开 Job.url,拦截详情响应,
   * 归一化后与列表 Job 合并并返回。
   * 同样:只 page.close() 自己开的标签。
   */
  async collect(opts: DetailCollectOptions): Promise<Job> {
    const page = await opts.context.newPage();
    const capture = opts.createCapture?.(page) ?? new NetworkCapture(page);
    try {
      const responsePromise = capture.waitFor<DetailResponse>(DETAIL_PRED);
      await page.goto(opts.job.url, { waitUntil: 'networkidle' });
      const body = await responsePromise;
      const detail = normalizeDetailJob(body.data.jobAuthDetails, opts.job.source);
      return mergeJobs(opts.job, detail);
    } finally {
      await page.close();
    }
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/detailCollector.test.ts`
Expected: PASS,1 个用例通过。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/collect/DetailCollector.ts tests/detailCollector.test.ts
git commit -m "feat: 添加 DetailCollector 职位详情补全"
```

---

## Task B6: SourceResolver —— 拒绝未实现的分类筛选

**目的:** 在分类筛选 URL 参数尚未观察的情况下,如果用户在 `config.json` 里写了 `categoryFilters`,显式抛错告知未实现,而不是悄无声息地丢弃。

**Files:**
- Modify: `src/collect/SourceResolver.ts`
- Modify: `tests/sourceResolver.test.ts`

- [ ] **Step 1: 编写失败测试 —— 追加到 `tests/sourceResolver.test.ts`**

```typescript
it('categoryFilters 非空时抛错(阶段 B 尚未实现)', () => {
  const c = cfg({
    keywords: [],
    savedSearches: [],
    categoryFilters: [{ category: 'web-development' }],
  });
  expect(() => resolveSources(c)).toThrow(/categoryFilters 尚未实现/);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/sourceResolver.test.ts`
Expected: FAIL —— 不会抛错(当前实现忽略 categoryFilters)。

- [ ] **Step 3: 修改 `src/collect/SourceResolver.ts`**

把 `resolveSources` 函数体首行(`const out = ...`)之前插入:

```typescript
  if (config.sources.categoryFilters.length > 0) {
    throw new Error(
      'config.sources.categoryFilters 尚未实现:Upwork 分类筛选 URL 参数需另起一次发现任务,见 docs/superpowers/specs/upwork-api-findings.md §4。',
    );
  }
```

- [ ] **Step 4: 运行所有 sourceResolver 测试,确认全过**

Run: `npx vitest run tests/sourceResolver.test.ts`
Expected: PASS,4 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/collect/SourceResolver.ts tests/sourceResolver.test.ts
git commit -m "feat: SourceResolver 拒绝未实现的 categoryFilters"
```

---

## Task B7: `collect` 命令 + 端到端验证

**目的:** 把 ChromeConnector / SourceResolver / ListingCollector / DetailCollector / Storage / Pacer 串成一个 `collect` 命令,跑一次真实采集,把职位入库。

**Files:**
- Modify: `src/cli.ts`

> 这一层是薄编排,不写单元测试;以"实际跑通,DB 有数据"验收。

- [ ] **Step 1: 修改 `src/cli.ts`**

在 `src/cli.ts` 顶部 import 区追加:

```typescript
import { ChromeConnector } from './session/ChromeConnector';
import { resolveSources } from './collect/SourceResolver';
import { ListingCollector } from './collect/ListingCollector';
import { DetailCollector } from './collect/DetailCollector';
import { Pacer } from './pacer/Pacer';
import type { Job } from './types';
```

在 `exportCommand` 之前插入:

```typescript
async function collectCommand(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.database), { recursive: true });
  const sources = resolveSources(config);
  if (sources.length === 0) {
    console.log('config.sources 没有任何来源,什么也不采集。');
    return;
  }

  const connector = new ChromeConnector(config.chrome);
  const { context } = await connector.connect();
  const pacer = new Pacer(config.pacing.minDelayMs, config.pacing.maxDelayMs);
  const storage = new Storage(config.paths.database);
  const now = (): string => new Date().toISOString();
  const runId = storage.startRun(now());

  let jobsSeen = 0;
  let jobsNew = 0;
  let status: 'success' | 'failed' = 'success';
  const listingCollector = new ListingCollector();
  const detailCollector = new DetailCollector();

  try {
    const allListing: Job[] = [];
    for (const source of sources) {
      console.log(`[列表] ${source.type}:${source.label}`);
      const jobs = await listingCollector.collect({
        context,
        source,
        maxPages: config.pacing.maxPagesPerSource,
      });
      console.log(`  抓到 ${jobs.length} 条`);
      allListing.push(...jobs);
      await pacer.wait();
    }

    // 详情按 maxDetailsPerRun 截断
    const toEnrich = allListing.slice(0, config.pacing.maxDetailsPerRun);
    const enriched = new Map<string, Job>();
    for (const job of toEnrich) {
      try {
        console.log(`[详情] ${job.id}  ${job.title.slice(0, 60)}`);
        const full = await detailCollector.collect({ context, job });
        enriched.set(full.id, full);
      } catch (err) {
        console.error(`  详情失败:${err instanceof Error ? err.message : err}`);
      }
      await pacer.wait();
    }

    // upsert 全部(优先 enriched,其次列表)
    for (const job of allListing) {
      const final = enriched.get(job.id) ?? job;
      const { isNew } = storage.upsertJob(final, now());
      storage.linkRunJob(runId, final.id, isNew);
      jobsSeen++;
      if (isNew) jobsNew++;
    }
  } catch (err) {
    status = 'failed';
    console.error(`采集失败:${err instanceof Error ? err.message : err}`);
  } finally {
    storage.finishRun(runId, { jobsSeen, jobsNew, status, finishedAt: now() });
    storage.close();
    console.log(`运行 #${runId} 结束:status=${status} seen=${jobsSeen} new=${jobsNew}`);
  }
}
```

在 commander 命令注册区追加:

```typescript
  program
    .command('collect')
    .description('在已登录的 Chrome 里采集所有配置的来源,写入数据库')
    .action(collectCommand);
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0。

- [ ] **Step 3: 跑全量测试,确认未回归**

Run: `npm run test`
Expected: PASS,B1+B2+B3+B4+B5+B6 新增的全部用例 + 阶段 A 原有 25 个测试全过。

- [ ] **Step 4: 手动 E2E —— 跑一次真实采集**

前置:确保 Chrome 还在 9222 端口运行且 Upwork 已登录(若已退出,运行 `npm run login` 再登录一次)。

`config.json` 临时改保守一些:`maxPagesPerSource: 1`, `maxDetailsPerRun: 2`,避免一次跑太多。

Run: `npm run collect`

Expected:
- 终端依次打印 `[列表] keyword:react developer` → `抓到 N 条`(N 通常 10)→ 第二个 keyword 同样
- `[详情] <id> <title>` 各 2 行(只取前 2 个)
- 最后一行 `运行 #1 结束:status=success seen=20 new=20`

- [ ] **Step 5: 验证 DB 写入**

Run:
```bash
node -e "
const db = require('better-sqlite3')('./data/upwork.db');
console.log('jobs:', db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n);
console.log('latest run:', db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get());
console.log('run_jobs:', db.prepare('SELECT COUNT(*) AS n FROM run_jobs').get().n);
const sample = db.prepare('SELECT id, title, budget_type, category, detail_fetched FROM jobs ORDER BY first_seen DESC LIMIT 5').all();
console.table(sample);
"
```

Expected:
- `jobs` 表至少有 20 条
- 最近一次 run 的 `status='success'`,`jobs_new` > 0
- 至少 2 条记录的 `detail_fetched = 1` 且 `category` 非 null(详情已合并)

- [ ] **Step 6: 验证 export 工作**

Run: `npm run export`
Expected: 打印 `已导出 N 个职位(运行 #1)到 ./data/exports/upwork-jobs-<timestamp>.csv`。打开 CSV 抽查几行,字段齐全、转义正确。

- [ ] **Step 7: 提交**

```bash
git add src/cli.ts
git commit -m "feat: 添加 collect 命令编排端到端采集流水线"
```

---

## 阶段 B 完成标准

- [ ] `npm run test` —— 全部测试通过(B1 6 个 + B2 9 个 + B3 7 个 + B4 3 个 + B5 1 个 + B6 1 个 + 阶段 A 已有 25 个)。
- [ ] `npm run typecheck` —— 无类型错误。
- [ ] `npm run collect` —— 能在登录后的真实 Chrome 上跑通一次完整采集,DB 写入正确,详情合并字段(category / subcategory)出现在已 enriched 的记录中。
- [ ] `npm run export` —— 正确导出最近一次 run 的职位为 CSV。
- [ ] 没有任何生产代码调用 `browser.close()`(只 `page.close()`)。
- [ ] `config.sources.categoryFilters` 非空时显式抛错,不静默忽略。

---

## 自查记录

**Spec 覆盖**(对照设计文档 §3 与 findings 文档 §3):
- NetworkCapture(T B1)、Normalizer(T B2/B3,覆盖字段定位表全部字段;`clientHireRate` 按 findings 文档 §3 备注落 null)、ListingCollector(T B4,翻页机制 `&page=N` 待 Step 1 人工验证)、DetailCollector(T B5,基于 ciphertext URL)、SourceResolver 分类筛选(T B6,显式拒绝 + 待 Phase B' 处理)、`collect` 命令(T B7)。

**留给 Phase B' 的事:**
- `SourceResolver.categoryFilters` 真实实现 —— 先做一次 facet 点击观察任务。
- Cloudflare 触发时的"只读 dump 已渲染标签"降级路径(必要时新增 Task B4.5)。
- `applicantsBidsStats` 字段补抓:目前 fixture 中为 null,采集到非 null 样本后再决定是否纳入 `Job`。

**占位符扫描:** 全文搜 TBD / TODO / "implement later" / "fill in"  —— 无。

**类型一致性:**
- `Job` 接口跨 B2/B3/B4/B5/B7 引用,字段名完全一致;
- `NetworkCapture.waitFor` 在 B1 定义,在 B4/B5/B7 透过 `createCapture` 注入;
- `ResolvedSource` 已在阶段 A 定义,B4/B7 直接使用;
- `Storage.startRun` / `upsertJob` / `linkRunJob` / `finishRun` 在阶段 A 定义,B7 调用,签名一致。

**TDD 守纪律:** B1/B2/B3/B4/B5/B6 全程"先写失败测试 → 跑确认失败 → 写实现 → 跑确认通过 → typecheck → commit"。B7 是薄编排层,不写单元测试,但 Step 3 跑全量回归,Step 4–6 手动 E2E 验收。
