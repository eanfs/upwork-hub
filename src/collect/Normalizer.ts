import type { Job, BudgetType } from '../types';

function stripHighlight(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  return s.replace(/H\^|\^H/g, '');
}

function toNumber(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeTier(tier: string | null | undefined): string | null {
  if (!tier) return null;
  const lower = tier.toLowerCase();
  if (lower.includes('expert')) return 'expert';
  if (lower.includes('intermediate')) return 'intermediate';
  if (lower.includes('entry')) return 'entry';
  return lower;
}

interface ListingJobTile {
  job: {
    id: string;
    ciphertext: string;
    jobType: string;
    contractorTier: string | null;
    hourlyBudgetMin: string | null;
    hourlyBudgetMax: string | null;
    fixedPriceAmount?: { amount: string } | null;
    fixedPriceEngagementDuration?: { label: string } | null;
    hourlyEngagementDuration?: { label: string } | null;
    totalApplicants: number | null;
    publishTime: string | null;
  };
}

interface ListingClient {
  paymentVerificationStatus?: string | null;
  country?: string | null;
  totalReviews?: number | null;
  totalFeedback?: number | null;
  totalSpent?: { amount: string } | null;
}

interface ListingResult {
  id: string;
  title: string;
  description: string | null;
  ontologySkills: { prefLabel: string }[] | null;
  upworkHistoryData?: { client?: ListingClient | null } | null;
  jobTile: ListingJobTile;
}

/** 把 userJobSearchV1.results[i] 一条记录映射为 Job(detailFetched=false)。 */
export function normalizeListingJob(raw: unknown, source: string): Job {
  const r = raw as ListingResult;
  const j = r.jobTile.job;
  const isFixed = j.jobType === 'FIXED';
  const isHourly = j.jobType === 'HOURLY';
  const budgetType: BudgetType | null = isFixed ? 'fixed' : isHourly ? 'hourly' : null;
  const client = r.upworkHistoryData?.client ?? null;
  const projectDuration = isFixed
    ? j.fixedPriceEngagementDuration?.label ?? null
    : isHourly
      ? j.hourlyEngagementDuration?.label ?? null
      : null;

  return {
    id: r.id,
    url: `https://www.upwork.com/jobs/${j.ciphertext}`,
    title: stripHighlight(r.title) ?? '',
    description: stripHighlight(r.description),
    budgetType,
    budgetAmount: isFixed ? toNumber(j.fixedPriceAmount?.amount ?? null) : null,
    hourlyMin: isHourly ? toNumber(j.hourlyBudgetMin) : null,
    hourlyMax: isHourly ? toNumber(j.hourlyBudgetMax) : null,
    skills: (r.ontologySkills ?? []).map((s) => s.prefLabel),
    category: null,
    subcategory: null,
    experienceLevel: normalizeTier(j.contractorTier),
    projectDuration,
    proposalsCount: j.totalApplicants ?? null,
    clientCountry: client?.country ?? null,
    clientTotalSpent: toNumber(client?.totalSpent?.amount ?? null),
    clientHireRate: null,
    clientRating: client?.totalFeedback ?? null,
    clientPaymentVerified:
      client?.paymentVerificationStatus === undefined || client?.paymentVerificationStatus === null
        ? null
        : client.paymentVerificationStatus === 'VERIFIED',
    postedAt: j.publishTime ?? null,
    source,
    detailFetched: false,
    rawJson: JSON.stringify(raw),
  };
}
