import { describe, it, expect } from 'vitest';
import { Storage } from '../src/storage/Storage';
import type { Job } from '../src/types';

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'job-1', url: 'https://upwork.com/job/1', title: 'React 开发',
    description: null, budgetType: 'hourly', budgetAmount: null,
    hourlyMin: 30, hourlyMax: 60, skills: ['react', 'ts'],
    category: 'web', subcategory: null, experienceLevel: 'expert',
    projectDuration: null, proposalsCount: 5, clientCountry: 'US',
    clientTotalSpent: 1000, clientHireRate: 0.8, clientRating: 4.9,
    clientPaymentVerified: true, postedAt: '2026-05-17T00:00:00Z',
    source: 'keyword:react', detailFetched: false, rawJson: '{}',
    ...over,
  };
}

describe('Storage', () => {
  it('插入新职位返回 isNew=true', () => {
    const s = new Storage(':memory:');
    expect(s.upsertJob(makeJob(), '2026-05-17T10:00:00Z').isNew).toBe(true);
    s.close();
  });

  it('再次 upsert 同 id 返回 isNew=false 并保留 firstSeen', () => {
    const s = new Storage(':memory:');
    s.upsertJob(makeJob(), '2026-05-17T10:00:00Z');
    const r = s.upsertJob(makeJob({ title: '改了标题' }), '2026-05-17T12:00:00Z');
    expect(r.isNew).toBe(false);
    const job = s.getJob('job-1')!;
    expect(job.firstSeen).toBe('2026-05-17T10:00:00Z');
    expect(job.lastSeen).toBe('2026-05-17T12:00:00Z');
    expect(job.title).toBe('改了标题');
    expect(job.skills).toEqual(['react', 'ts']);
    s.close();
  });

  it('记录运行并关联职位', () => {
    const s = new Storage(':memory:');
    const runId = s.startRun('2026-05-17T10:00:00Z');
    s.upsertJob(makeJob(), '2026-05-17T10:00:00Z');
    s.linkRunJob(runId, 'job-1', true);
    s.finishRun(runId, { jobsSeen: 1, jobsNew: 1, status: 'success', finishedAt: '2026-05-17T10:05:00Z' });

    expect(s.getLatestRunId()).toBe(runId);
    const jobs = s.getJobsForRun(runId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-1');
    s.close();
  });
});
