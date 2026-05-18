import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config';

function tmpConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'upwork-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, content);
  return path;
}

const validConfig = {
  sources: { keywords: ['react'], savedSearches: [], categoryFilters: [] },
  pacing: { minDelayMs: 3000, maxDelayMs: 8000, maxPagesPerSource: 5, maxDetailsPerRun: 50 },
  chrome: { cdpPort: 9222, userDataDir: './data/chrome-profile', executablePath: '/path/to/chrome' },
  paths: { database: './data/u.db', exportDir: './data/exports' },
};

describe('loadConfig', () => {
  it('加载合法配置', () => {
    const cfg = loadConfig(tmpConfig(JSON.stringify(validConfig)));
    expect(cfg.sources.keywords).toEqual(['react']);
    expect(cfg.chrome.cdpPort).toBe(9222);
  });

  it('缺少 sources 时报错', () => {
    const bad = { ...validConfig } as Record<string, unknown>;
    delete bad.sources;
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/sources/);
  });

  it('minDelayMs 大于 maxDelayMs 时报错', () => {
    const bad = { ...validConfig, pacing: { ...validConfig.pacing, minDelayMs: 9000 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/minDelayMs/);
  });

  it('文件不存在时报错', () => {
    expect(() => loadConfig('/no/such/config.json')).toThrow(/找不到配置文件/);
  });

  it('JSON 非法时报错', () => {
    expect(() => loadConfig(tmpConfig('{ not json'))).toThrow(/JSON/);
  });

  it('配置不是对象时报错', () => {
    expect(() => loadConfig(tmpConfig('[]'))).toThrow(/对象/);
  });

  it('pacing.maxPagesPerSource 非数字时报错', () => {
    const bad = { ...validConfig, pacing: { ...validConfig.pacing, maxPagesPerSource: 'x' } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/maxPagesPerSource/);
  });

  it('chrome.cdpPort 非数字时报错', () => {
    const bad = { ...validConfig, chrome: { ...validConfig.chrome, cdpPort: '9222' } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/cdpPort/);
  });

  it('chrome.executablePath 非字符串时报错', () => {
    const bad = { ...validConfig, chrome: { ...validConfig.chrome, executablePath: 123 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/executablePath/);
  });

  it('paths.database 非字符串时报错', () => {
    const bad = { ...validConfig, paths: { ...validConfig.paths, database: 123 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/database/);
  });
});
