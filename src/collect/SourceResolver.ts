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
