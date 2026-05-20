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
