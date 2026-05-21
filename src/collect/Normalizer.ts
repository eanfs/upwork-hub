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

interface DetailJob {
  opening: {
    job: {
      description: string | null;
      contractorTier: string | null;
      postedOn: string | null;
      publishTime: string | null;
      engagementDuration: { label: string } | null;
      extendedBudgetInfo: { hourlyBudgetMin: string | null; hourlyBudgetMax: string | null } | null;
      budget: { amount: number; currencyCode: string } | null;
      category: { name: string; urlSlug: string } | null;
      categoryGroup: { name: string; urlSlug: string } | null;
      clientActivity: { totalApplicants: number | null } | null;
      info: {
        id: string;
        ciphertext: string;
        title: string;
        type: 'FIXED' | 'HOURLY';
      };
      sandsData: { additionalSkills: { prefLabel: string }[] | null } | null;
    };
  };
  buyer: {
    isPaymentMethodVerified: boolean | null;
    info: {
      location: { country: string | null } | null;
      stats: {
        totalCharges: { amount: number } | null;
        score: number | null;
        feedbackCount: number | null;
      } | null;
    } | null;
  };
}

/** 把 data.jobAuthDetails 一条记录映射为 Job(detailFetched=true)。 */
export function normalizeDetailJob(raw: unknown, source: string): Job {
  const d = raw as DetailJob;
  const j = d.opening.job;
  const isFixed = j.info.type === 'FIXED';
  const budgetType: BudgetType = isFixed ? 'fixed' : 'hourly';
  const buyerInfo = d.buyer?.info;
  const stats = buyerInfo?.stats;

  return {
    id: j.info.id,
    url: `https://www.upwork.com/jobs/${j.info.ciphertext}`,
    title: j.info.title,
    description: j.description,
    budgetType,
    budgetAmount: isFixed && j.budget ? j.budget.amount : null,
    hourlyMin: !isFixed ? toNumber(j.extendedBudgetInfo?.hourlyBudgetMin ?? null) : null,
    hourlyMax: !isFixed ? toNumber(j.extendedBudgetInfo?.hourlyBudgetMax ?? null) : null,
    skills: (j.sandsData?.additionalSkills ?? []).map((s) => s.prefLabel),
    category: j.category?.name ?? null,
    subcategory: j.categoryGroup?.name ?? null,
    experienceLevel: normalizeTier(j.contractorTier),
    projectDuration: j.engagementDuration?.label ?? null,
    proposalsCount: j.clientActivity?.totalApplicants ?? null,
    clientCountry: buyerInfo?.location?.country ?? null,
    clientTotalSpent: toNumber(stats?.totalCharges?.amount ?? null),
    clientHireRate: null,
    clientRating: stats?.score ?? null,
    clientPaymentVerified: d.buyer?.isPaymentMethodVerified ?? null,
    postedAt: j.publishTime ?? j.postedOn ?? null,
    source,
    detailFetched: true,
    rawJson: JSON.stringify(raw),
  };
}

/** 把详情 Job 并到列表 Job 上;详情非空字段覆盖列表对应字段。 */
export function mergeJobs(listing: Job, detail: Job): Job {
  const pick = <K extends keyof Job>(k: K): Job[K] => {
    const dv = detail[k];
    if (dv === null || dv === undefined) return listing[k];
    if (Array.isArray(dv) && dv.length === 0) return listing[k];
    return dv;
  };

  return {
    ...listing,
    title: pick('title') as string,
    description: pick('description'),
    budgetType: pick('budgetType'),
    budgetAmount: pick('budgetAmount'),
    hourlyMin: pick('hourlyMin'),
    hourlyMax: pick('hourlyMax'),
    skills: pick('skills'),
    category: pick('category'),
    subcategory: pick('subcategory'),
    experienceLevel: pick('experienceLevel'),
    projectDuration: pick('projectDuration'),
    proposalsCount: pick('proposalsCount'),
    clientCountry: pick('clientCountry'),
    clientTotalSpent: pick('clientTotalSpent'),
    clientRating: pick('clientRating'),
    clientPaymentVerified: pick('clientPaymentVerified'),
    postedAt: pick('postedAt'),
    detailFetched: true,
    rawJson: JSON.stringify({
      listing: JSON.parse(listing.rawJson),
      detail: JSON.parse(detail.rawJson),
    }),
  };
}
