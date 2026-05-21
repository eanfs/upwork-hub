import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeListingJob, normalizeDetailJob, mergeJobs } from '../src/collect/Normalizer';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/search-response.json'), 'utf8'),
);

const RESULTS: any[] = SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results;

const DETAIL_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/job-detail-response.json'), 'utf8'),
);
const DETAIL: any = DETAIL_FIXTURE.data.jobAuthDetails;

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

describe('normalizeDetailJob', () => {
  it('从 fixture 提取详情专属字段', () => {
    const job = normalizeDetailJob(DETAIL, 'kw');
    expect(job.id).toBe(DETAIL.opening.job.info.id);
    expect(job.url).toBe(`https://www.upwork.com/jobs/${DETAIL.opening.job.info.ciphertext}`);
    expect(job.title).toBe(DETAIL.opening.job.info.title);
    expect(job.description).toBe(DETAIL.opening.job.description);
    expect(job.category).toBe(DETAIL.opening.job.category.name);
    expect(job.subcategory).toBe(DETAIL.opening.job.categoryGroup.name);
    expect(job.detailFetched).toBe(true);
    expect(JSON.parse(job.rawJson)).toEqual(DETAIL);
  });

  it('详情的 contractorTier 也归一化为小写', () => {
    const job = normalizeDetailJob(DETAIL, 'kw');
    expect(['expert', 'intermediate', 'entry']).toContain(job.experienceLevel);
  });

  it('budget 取 opening.job.info.type(HOURLY/FIXED) + extendedBudgetInfo 或 budget.amount', () => {
    const job = normalizeDetailJob(DETAIL, 'kw');
    expect(job.budgetType).toBe(DETAIL.opening.job.info.type === 'FIXED' ? 'fixed' : 'hourly');
  });

  it('clientPaymentVerified 取 buyer.isPaymentMethodVerified', () => {
    const d = JSON.parse(JSON.stringify(DETAIL));
    d.buyer.isPaymentMethodVerified = true;
    expect(normalizeDetailJob(d, 'kw').clientPaymentVerified).toBe(true);
    d.buyer.isPaymentMethodVerified = false;
    expect(normalizeDetailJob(d, 'kw').clientPaymentVerified).toBe(false);
  });

  it('clientTotalSpent 从 totalCharges 对象提取数字(有消费历史的客户)', () => {
    // 真实数据:有消费历史的客户 totalCharges 是 { amount: <number> },无消费时为 null
    const d = JSON.parse(JSON.stringify(DETAIL));
    d.buyer.info.stats.totalCharges = { amount: 21541.5 };
    const job = normalizeDetailJob(d, 'kw');
    expect(job.clientTotalSpent).toBe(21541.5);
    expect(typeof job.clientTotalSpent).toBe('number');
  });

  it('clientTotalSpent 在 totalCharges 为 null 时为 null', () => {
    const d = JSON.parse(JSON.stringify(DETAIL));
    d.buyer.info.stats.totalCharges = null;
    expect(normalizeDetailJob(d, 'kw').clientTotalSpent).toBeNull();
  });
});

describe('mergeJobs', () => {
  it('详情非空字段覆盖列表;detailFetched 取 detail 的值', () => {
    const listing = normalizeListingJob(RESULTS[0], 'kw');
    const detail = normalizeDetailJob(DETAIL, 'kw');
    const merged = mergeJobs(listing, detail);
    expect(merged.id).toBe(listing.id);
    expect(merged.title).toBe(detail.title);
    expect(merged.description).toBe(detail.description);
    expect(merged.category).toBe(detail.category);
    expect(merged.subcategory).toBe(detail.subcategory);
    expect(merged.detailFetched).toBe(true);
    expect(merged.source).toBe(listing.source);
  });

  it('详情为空的字段不覆盖列表已有非空值', () => {
    const listing = { ...normalizeListingJob(RESULTS[0], 'kw'), clientCountry: 'USA' };
    const detail = { ...normalizeDetailJob(DETAIL, 'kw'), clientCountry: null };
    expect(mergeJobs(listing, detail).clientCountry).toBe('USA');
  });

  it('rawJson 拼成 {listing, detail} 双载荷', () => {
    const listing = normalizeListingJob(RESULTS[0], 'kw');
    const detail = normalizeDetailJob(DETAIL, 'kw');
    const merged = mergeJobs(listing, detail);
    const parsed = JSON.parse(merged.rawJson);
    expect(parsed).toHaveProperty('listing');
    expect(parsed).toHaveProperty('detail');
  });
});
