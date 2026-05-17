import { describe, it, expect } from 'vitest';
import { resolveSources } from '../src/collect/SourceResolver';
import type { Config } from '../src/types';

function cfg(over: Partial<Config['sources']>): Config {
  return {
    sources: { keywords: [], savedSearches: [], categoryFilters: [], ...over },
    pacing: { minDelayMs: 1, maxDelayMs: 2, maxPagesPerSource: 1, maxDetailsPerRun: 1 },
    chrome: { cdpPort: 9222, userDataDir: '', executablePath: '' },
    paths: { database: '', exportDir: '' },
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
