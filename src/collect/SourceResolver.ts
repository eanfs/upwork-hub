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
  if (config.sources.categoryFilters.length > 0) {
    throw new Error(
      'config.sources.categoryFilters 尚未实现:Upwork 分类筛选 URL 参数需另起一次发现任务,见 docs/superpowers/specs/upwork-api-findings.md §4。',
    );
  }

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
