import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config';
import { ChromeConnector } from './session/ChromeConnector';
import { Storage } from './storage/Storage';
import { exportJobsToCsv } from './export/CsvExporter';
import { resolveSources } from './collect/SourceResolver';
import { ListingCollector } from './collect/ListingCollector';
import { DetailCollector } from './collect/DetailCollector';
import { Pacer } from './pacer/Pacer';
import type { Job } from './types';

const CONFIG_PATH = process.env.UPWORK_HUB_CONFIG ?? './config.json';

function loginCommand(): void {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(config.chrome.userDataDir, { recursive: true });
  const connector = new ChromeConnector(config.chrome);
  connector.launchChrome();
  console.log(
    `已启动 Chrome(调试端口 ${config.chrome.cdpPort})。\n` +
      '请在打开的窗口中登录 Upwork,登录后保持该窗口开启,即可运行 collect / observe。',
  );
}

async function collectCommand(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.database), { recursive: true });
  const sources = resolveSources(config);
  if (sources.length === 0) {
    console.log('config.sources 没有任何来源,什么也不采集。');
    return;
  }

  const connector = new ChromeConnector(config.chrome);
  const { context } = await connector.connect();
  const pacer = new Pacer(config.pacing.minDelayMs, config.pacing.maxDelayMs);
  const storage = new Storage(config.paths.database);
  const now = (): string => new Date().toISOString();
  const runId = storage.startRun(now());

  let jobsSeen = 0;
  let jobsNew = 0;
  let status: 'success' | 'failed' = 'success';
  const listingCollector = new ListingCollector();
  const detailCollector = new DetailCollector();

  try {
    const allListing: Job[] = [];
    for (const source of sources) {
      console.log(`[列表] ${source.type}:${source.label}`);
      const jobs = await listingCollector.collect({
        context,
        source,
        maxPages: config.pacing.maxPagesPerSource,
      });
      console.log(`  抓到 ${jobs.length} 条`);
      allListing.push(...jobs);
      await pacer.wait();
    }

    const toEnrich = allListing.slice(0, config.pacing.maxDetailsPerRun);
    const enriched = new Map<string, Job>();
    for (const job of toEnrich) {
      try {
        console.log(`[详情] ${job.id}  ${job.title.slice(0, 60)}`);
        const full = await detailCollector.collect({ context, job });
        enriched.set(full.id, full);
      } catch (err) {
        console.error(`  详情失败:${err instanceof Error ? err.message : err}`);
      }
      await pacer.wait();
    }

    for (const job of allListing) {
      const final = enriched.get(job.id) ?? job;
      const { isNew } = storage.upsertJob(final, now());
      storage.linkRunJob(runId, final.id, isNew);
      jobsSeen++;
      if (isNew) jobsNew++;
    }
  } catch (err) {
    status = 'failed';
    console.error(`采集失败:${err instanceof Error ? err.message : err}`);
  } finally {
    storage.finishRun(runId, { jobsSeen, jobsNew, status, finishedAt: now() });
    storage.close();
    console.log(`运行 #${runId} 结束:status=${status} seen=${jobsSeen} new=${jobsNew}`);
  }
}

function exportCommand(): void {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.database), { recursive: true });
  const storage = new Storage(config.paths.database);
  try {
    const runId = storage.getLatestRunId();
    if (runId === undefined) {
      console.log('数据库中还没有运行记录,无可导出的职位。');
      return;
    }
    const jobs = storage.getJobsForRun(runId);
    const path = exportJobsToCsv(jobs, config.paths.exportDir);
    console.log(`已导出 ${jobs.length} 个职位(运行 #${runId})到 ${path}`);
  } finally {
    storage.close();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('upwork-hub').description('Upwork 职位信息收集器');

  program
    .command('login')
    .description('启动带调试端口的真实 Chrome,供你手动登录 Upwork')
    .action(loginCommand);

  program
    .command('collect')
    .description('在已登录的 Chrome 里采集所有配置的来源,写入数据库')
    .action(collectCommand);

  program
    .command('export')
    .description('把最近一次运行采集的职位导出为 CSV')
    .action(exportCommand);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
