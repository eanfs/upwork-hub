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
    expect(enriched.category).toBe(
      DETAIL_FIXTURE.data.jobAuthDetails.opening.job.category.name,
    );
    expect(enriched.subcategory).toBe(
      DETAIL_FIXTURE.data.jobAuthDetails.opening.job.categoryGroup.name,
    );
  });
});
