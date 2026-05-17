export type BudgetType = 'fixed' | 'hourly';

export type RunStatus = 'success' | 'failed' | 'session_expired';

/** 采集到的职位(尚未带存储元数据)。 */
export interface Job {
  id: string;
  url: string;
  title: string;
  description: string | null;
  budgetType: BudgetType | null;
  budgetAmount: number | null;
  hourlyMin: number | null;
  hourlyMax: number | null;
  skills: string[];
  category: string | null;
  subcategory: string | null;
  experienceLevel: string | null;
  projectDuration: string | null;
  proposalsCount: number | null;
  clientCountry: string | null;
  clientTotalSpent: number | null;
  clientHireRate: number | null;
  clientRating: number | null;
  clientPaymentVerified: boolean | null;
  postedAt: string | null;
  source: string;
  detailFetched: boolean;
  rawJson: string;
}

/** 从 SQLite 读出的职位,带首次/最近采集时间。 */
export interface StoredJob extends Job {
  firstSeen: string;
  lastSeen: string;
}

export interface Run {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  jobsSeen: number;
  jobsNew: number;
  status: RunStatus;
}

export interface CategoryFilter {
  category: string;
  budgetMin?: number;
  experienceLevel?: string;
}

export interface Config {
  sources: {
    keywords: string[];
    savedSearches: string[];
    categoryFilters: CategoryFilter[];
  };
  pacing: {
    minDelayMs: number;
    maxDelayMs: number;
    maxPagesPerSource: number;
    maxDetailsPerRun: number;
  };
  browser: { headless: boolean };
  paths: {
    storageState: string;
    database: string;
    exportDir: string;
  };
}
