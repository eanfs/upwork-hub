import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, StoredJob, RunStatus } from '../types';

const SCHEMA = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

interface JobRow {
  id: string; url: string; title: string; description: string | null;
  budget_type: string | null; budget_amount: number | null;
  hourly_min: number | null; hourly_max: number | null; skills: string;
  category: string | null; subcategory: string | null;
  experience_level: string | null; project_duration: string | null;
  proposals_count: number | null; client_country: string | null;
  client_total_spent: number | null; client_hire_rate: number | null;
  client_rating: number | null; client_payment_verified: number | null;
  posted_at: string | null; source: string; detail_fetched: number;
  first_seen: string; last_seen: string; raw_json: string;
}

function rowToJob(r: JobRow): StoredJob {
  return {
    id: r.id, url: r.url, title: r.title, description: r.description,
    budgetType: r.budget_type as StoredJob['budgetType'],
    budgetAmount: r.budget_amount, hourlyMin: r.hourly_min, hourlyMax: r.hourly_max,
    skills: JSON.parse(r.skills) as string[],
    category: r.category, subcategory: r.subcategory,
    experienceLevel: r.experience_level, projectDuration: r.project_duration,
    proposalsCount: r.proposals_count, clientCountry: r.client_country,
    clientTotalSpent: r.client_total_spent, clientHireRate: r.client_hire_rate,
    clientRating: r.client_rating,
    clientPaymentVerified: r.client_payment_verified === null ? null : r.client_payment_verified === 1,
    postedAt: r.posted_at, source: r.source, detailFetched: r.detail_fetched === 1,
    firstSeen: r.first_seen, lastSeen: r.last_seen, rawJson: r.raw_json,
  };
}

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /** 插入或更新职位。返回是否为新职位。 */
  upsertJob(job: Job, now: string): { isNew: boolean } {
    const existing = this.db.prepare('SELECT id FROM jobs WHERE id = ?').get(job.id);
    const isNew = existing === undefined;
    this.db.prepare(`
      INSERT INTO jobs (
        id, url, title, description, budget_type, budget_amount, hourly_min, hourly_max,
        skills, category, subcategory, experience_level, project_duration, proposals_count,
        client_country, client_total_spent, client_hire_rate, client_rating,
        client_payment_verified, posted_at, source, detail_fetched,
        first_seen, last_seen, raw_json
      ) VALUES (
        @id, @url, @title, @description, @budget_type, @budget_amount, @hourly_min, @hourly_max,
        @skills, @category, @subcategory, @experience_level, @project_duration, @proposals_count,
        @client_country, @client_total_spent, @client_hire_rate, @client_rating,
        @client_payment_verified, @posted_at, @source, @detail_fetched,
        @now, @now, @raw_json
      )
      ON CONFLICT(id) DO UPDATE SET
        url = @url, title = @title, description = @description,
        budget_type = @budget_type, budget_amount = @budget_amount,
        hourly_min = @hourly_min, hourly_max = @hourly_max, skills = @skills,
        category = @category, subcategory = @subcategory,
        experience_level = @experience_level, project_duration = @project_duration,
        proposals_count = @proposals_count, client_country = @client_country,
        client_total_spent = @client_total_spent, client_hire_rate = @client_hire_rate,
        client_rating = @client_rating, client_payment_verified = @client_payment_verified,
        posted_at = @posted_at, source = @source, detail_fetched = @detail_fetched,
        last_seen = @now, raw_json = @raw_json
    `).run({
      id: job.id, url: job.url, title: job.title, description: job.description,
      budget_type: job.budgetType, budget_amount: job.budgetAmount,
      hourly_min: job.hourlyMin, hourly_max: job.hourlyMax,
      skills: JSON.stringify(job.skills), category: job.category,
      subcategory: job.subcategory, experience_level: job.experienceLevel,
      project_duration: job.projectDuration, proposals_count: job.proposalsCount,
      client_country: job.clientCountry, client_total_spent: job.clientTotalSpent,
      client_hire_rate: job.clientHireRate, client_rating: job.clientRating,
      client_payment_verified:
        job.clientPaymentVerified === null ? null : job.clientPaymentVerified ? 1 : 0,
      posted_at: job.postedAt, source: job.source,
      detail_fetched: job.detailFetched ? 1 : 0, raw_json: job.rawJson, now,
    });
    return { isNew };
  }

  getJob(id: string): StoredJob | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  startRun(now: string): number {
    const info = this.db.prepare('INSERT INTO runs (started_at) VALUES (?)').run(now);
    return Number(info.lastInsertRowid);
  }

  finishRun(
    runId: number,
    fields: { jobsSeen: number; jobsNew: number; status: RunStatus; finishedAt: string },
  ): void {
    this.db.prepare(`
      UPDATE runs SET jobs_seen = ?, jobs_new = ?, status = ?, finished_at = ? WHERE id = ?
    `).run(fields.jobsSeen, fields.jobsNew, fields.status, fields.finishedAt, runId);
  }

  linkRunJob(runId: number, jobId: string, isNew: boolean): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO run_jobs (run_id, job_id, is_new) VALUES (?, ?, ?)
    `).run(runId, jobId, isNew ? 1 : 0);
  }

  getLatestRunId(): number | undefined {
    const row = this.db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get() as
      | { id: number }
      | undefined;
    return row?.id;
  }

  getJobsForRun(runId: number): StoredJob[] {
    const rows = this.db.prepare(`
      SELECT j.* FROM jobs j
      JOIN run_jobs rj ON rj.job_id = j.id
      WHERE rj.run_id = ?
      ORDER BY j.posted_at DESC
    `).all(runId) as JobRow[];
    return rows.map(rowToJob);
  }

  close(): void {
    this.db.close();
  }
}
