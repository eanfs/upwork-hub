CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  budget_type TEXT,
  budget_amount REAL,
  hourly_min REAL,
  hourly_max REAL,
  skills TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  subcategory TEXT,
  experience_level TEXT,
  project_duration TEXT,
  proposals_count INTEGER,
  client_country TEXT,
  client_total_spent REAL,
  client_hire_rate REAL,
  client_rating REAL,
  client_payment_verified INTEGER,
  posted_at TEXT,
  source TEXT NOT NULL,
  detail_fetched INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  jobs_seen INTEGER NOT NULL DEFAULT 0,
  jobs_new INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'failed'
);

CREATE TABLE IF NOT EXISTS run_jobs (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  is_new INTEGER NOT NULL,
  PRIMARY KEY (run_id, job_id)
);
