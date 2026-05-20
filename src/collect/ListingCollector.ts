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
   * 只 page.close() 自己开的标签,绝不调用 browser.close()。
   */
  async collect(opts: CollectOptions): Promise<Job[]> {
    const page = await opts.context.newPage();
    const capture = opts.createCapture?.(page) ?? new NetworkCapture(page);
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
