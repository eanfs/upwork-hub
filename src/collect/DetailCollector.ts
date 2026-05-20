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
   * 只 page.close() 自己开的标签,绝不调用 browser.close()。
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
