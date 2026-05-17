import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredJob } from '../types';

const COLUMNS: { header: string; get: (j: StoredJob) => unknown }[] = [
  { header: 'id', get: (j) => j.id },
  { header: 'title', get: (j) => j.title },
  { header: 'url', get: (j) => j.url },
  { header: 'budget_type', get: (j) => j.budgetType },
  { header: 'budget_amount', get: (j) => j.budgetAmount },
  { header: 'hourly_min', get: (j) => j.hourlyMin },
  { header: 'hourly_max', get: (j) => j.hourlyMax },
  { header: 'skills', get: (j) => j.skills.join('; ') },
  { header: 'category', get: (j) => j.category },
  { header: 'subcategory', get: (j) => j.subcategory },
  { header: 'experience_level', get: (j) => j.experienceLevel },
  { header: 'project_duration', get: (j) => j.projectDuration },
  { header: 'proposals_count', get: (j) => j.proposalsCount },
  { header: 'client_country', get: (j) => j.clientCountry },
  { header: 'client_total_spent', get: (j) => j.clientTotalSpent },
  { header: 'client_hire_rate', get: (j) => j.clientHireRate },
  { header: 'client_rating', get: (j) => j.clientRating },
  { header: 'client_payment_verified', get: (j) => j.clientPaymentVerified },
  { header: 'posted_at', get: (j) => j.postedAt },
  { header: 'source', get: (j) => j.source },
  { header: 'detail_fetched', get: (j) => j.detailFetched },
  { header: 'first_seen', get: (j) => j.firstSeen },
  { header: 'last_seen', get: (j) => j.lastSeen },
  { header: 'description', get: (j) => j.description },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 把职位写成带时间戳文件名的 CSV,返回写入路径。 */
export function exportJobsToCsv(jobs: StoredJob[], exportDir: string): string {
  mkdirSync(exportDir, { recursive: true });
  const rows = [COLUMNS.map((c) => c.header).join(',')];
  for (const job of jobs) {
    rows.push(COLUMNS.map((c) => csvCell(c.get(job))).join(','));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(exportDir, `upwork-jobs-${stamp}.csv`);
  writeFileSync(path, rows.join('\n') + '\n');
  return path;
}
