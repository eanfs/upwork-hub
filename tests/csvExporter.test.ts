import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJobsToCsv } from '../src/export/CsvExporter';
import type { StoredJob } from '../src/types';

function makeStoredJob(over: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job-1', url: 'https://upwork.com/job/1', title: 'React 开发',
    description: '普通描述', budgetType: 'hourly', budgetAmount: null,
    hourlyMin: 30, hourlyMax: 60, skills: ['react', 'ts'],
    category: 'web', subcategory: null, experienceLevel: 'expert',
    projectDuration: null, proposalsCount: 5, clientCountry: 'US',
    clientTotalSpent: 1000, clientHireRate: 0.8, clientRating: 4.9,
    clientPaymentVerified: true, postedAt: '2026-05-17T00:00:00Z',
    source: 'keyword:react', detailFetched: true, rawJson: '{}',
    firstSeen: '2026-05-17T10:00:00Z', lastSeen: '2026-05-17T10:00:00Z',
    ...over,
  };
}

describe('exportJobsToCsv', () => {
  it('写出含表头与数据行的 CSV 文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upwork-csv-'));
    const path = exportJobsToCsv([makeStoredJob()], dir);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('title');
    expect(lines[1]).toContain('job-1');
  });

  it('转义含逗号、引号、换行的字段', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upwork-csv-'));
    const path = exportJobsToCsv(
      [makeStoredJob({ title: '带,逗号', description: '含"引号"\n和换行' })],
      dir,
    );
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('"带,逗号"');
    expect(content).toContain('"含""引号""\n和换行"');
  });

  it('空职位列表也写出仅含表头的文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upwork-csv-'));
    const path = exportJobsToCsv([], dir);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});
