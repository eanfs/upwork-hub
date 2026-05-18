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

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('配置必须是 JSON 对象');
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

  if (!c.chrome) fail('缺少 chrome');
  if (typeof c.chrome.cdpPort !== 'number') fail('chrome.cdpPort 必须是数字');
  if (typeof c.chrome.userDataDir !== 'string') fail('chrome.userDataDir 必须是字符串');
  if (typeof c.chrome.executablePath !== 'string') fail('chrome.executablePath 必须是字符串');

  if (!c.paths) fail('缺少 paths');
  for (const k of ['database', 'exportDir'] as const) {
    if (typeof c.paths[k] !== 'string') fail(`paths.${k} 必须是字符串`);
  }

  return c as Config;
}
