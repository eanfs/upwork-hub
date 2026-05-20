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
