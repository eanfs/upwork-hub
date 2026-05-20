import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeListingJob } from '../src/collect/Normalizer';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/search-response.json'), 'utf8'),
);

const RESULTS: any[] = SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results;

describe('normalizeListingJob', () => {
  it('从 fixture 第一条记录提取必备字段', () => {
    const raw = RESULTS[0];
    const job = normalizeListingJob(raw, 'keyword:react developer');
    expect(job.id).toBe(raw.id);
    expect(job.title).toBe(raw.title.replace(/H\^|\^H/g, ''));
    expect(job.url).toBe(`https://www.upwork.com/jobs/${raw.jobTile.job.ciphertext}`);
    expect(job.source).toBe('keyword:react developer');
    expect(job.detailFetched).toBe(false);
    expect(typeof job.rawJson).toBe('string');
    expect(JSON.parse(job.rawJson)).toEqual(raw);
  });

  it('FIXED 类型映射 budgetType 与 budgetAmount', () => {
    const fixed = RESULTS.find((r) => r.jobTile.job.jobType === 'FIXED');
    expect(fixed).toBeDefined();
    const job = normalizeListingJob(fixed, 'kw');
    expect(job.budgetType).toBe('fixed');
    expect(job.budgetAmount).toBe(Number(fixed.jobTile.job.fixedPriceAmount.amount));
    expect(job.hourlyMin).toBeNull();
    expect(job.hourlyMax).toBeNull();
  });

  it('HOURLY 类型映射 hourlyMin / hourlyMax', () => {
    const hourly = RESULTS.find((r) => r.jobTile.job.jobType === 'HOURLY');
    expect(hourly).toBeDefined();
    const job = normalizeListingJob(hourly, 'kw');
    expect(job.budgetType).toBe('hourly');
    expect(job.budgetAmount).toBeNull();
    expect(job.hourlyMin).toBe(Number(hourly.jobTile.job.hourlyBudgetMin));
    expect(job.hourlyMax).toBe(Number(hourly.jobTile.job.hourlyBudgetMax));
  });

  it('contractorTier 归一化为小写枚举', () => {
    const r = JSON.parse(JSON.stringify(RESULTS[0]));
    r.jobTile.job.contractorTier = 'ExpertLevel';
    expect(normalizeListingJob(r, 'kw').experienceLevel).toBe('expert');
    r.jobTile.job.contractorTier = 'IntermediateLevel';
    expect(normalizeListingJob(r, 'kw').experienceLevel).toBe('intermediate');
    r.jobTile.job.contractorTier = 'EntryLevel';
    expect(normalizeListingJob(r, 'kw').experienceLevel).toBe('entry');
  });

  it('skills 取 ontologySkills.prefLabel,空数组兜底', () => {
    const job = normalizeListingJob(RESULTS[0], 'kw');
    expect(job.skills).toEqual(RESULTS[0].ontologySkills.map((s: any) => s.prefLabel));
    const r2 = JSON.parse(JSON.stringify(RESULTS[0]));
    r2.ontologySkills = null;
    expect(normalizeListingJob(r2, 'kw').skills).toEqual([]);
  });

  it('client.paymentVerificationStatus 映射 clientPaymentVerified', () => {
    const r = JSON.parse(JSON.stringify(RESULTS[0]));
    r.upworkHistoryData.client.paymentVerificationStatus = 'VERIFIED';
    expect(normalizeListingJob(r, 'kw').clientPaymentVerified).toBe(true);
    r.upworkHistoryData.client.paymentVerificationStatus = 'NOT_VERIFIED';
    expect(normalizeListingJob(r, 'kw').clientPaymentVerified).toBe(false);
  });

  it('postedAt 取 jobTile.job.publishTime', () => {
    const job = normalizeListingJob(RESULTS[0], 'kw');
    expect(job.postedAt).toBe(RESULTS[0].jobTile.job.publishTime);
  });

  it('category / subcategory / description(完整版) 列表无法提供 → null/短描述', () => {
    const job = normalizeListingJob(RESULTS[0], 'kw');
    expect(job.category).toBeNull();
    expect(job.subcategory).toBeNull();
    expect(job.description).toBe(RESULTS[0].description.replace(/H\^|\^H/g, ''));
  });

  it('projectDuration 按 jobType 取相应字段', () => {
    const fixed = RESULTS.find((r) => r.jobTile.job.jobType === 'FIXED');
    expect(normalizeListingJob(fixed, 'kw').projectDuration).toBe(
      fixed.jobTile.job.fixedPriceEngagementDuration?.label ?? null,
    );
    const hourly = RESULTS.find((r) => r.jobTile.job.jobType === 'HOURLY');
    expect(normalizeListingJob(hourly, 'kw').projectDuration).toBe(
      hourly.jobTile.job.hourlyEngagementDuration?.label ?? null,
    );
  });
});
