import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config';
import { ChromeConnector } from './session/ChromeConnector';
import { Storage } from './storage/Storage';
import { exportJobsToCsv } from './export/CsvExporter';
import { Watcher } from './collect/Watcher';

const CONFIG_PATH = process.env.UPWORK_HUB_CONFIG ?? './config.json';

function loginCommand(): void {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(config.chrome.userDataDir, { recursive: true });
  const connector = new ChromeConnector(config.chrome);
  connector.launchChrome();
  console.log(
    `已启动 Chrome(调试端口 ${config.chrome.cdpPort})。\n` +
      '请在打开的窗口中登录 Upwork,登录后保持该窗口开启,即可运行 watch / observe。',
  );
}

/** 等到 stdin 有一行输入(用户按 Enter)或收到 SIGINT/SIGTERM,whichever 先到。 */
function waitForStop(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const done = (): void => {
      rl.close();
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    rl.once('line', done);
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

async function watchCommand(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.database), { recursive: true });

  const connector = new ChromeConnector(config.chrome);
  const { context } = await connector.connect();
  const watcher = new Watcher(context);
  watcher.start();

  console.log(
    '监听中:在 Chrome 里手动搜索/翻页/点开职位,我会被动捕获 userJobSearch 与详情接口响应。\n' +
      '完成后回到终端按 Enter 入库(或对进程发 SIGTERM/SIGINT 也会触发入库)...',
  );
  await waitForStop();

  const { jobs, listingCount, detailCount } = watcher.collected();
  console.log(`\n准备入库:${jobs.length} 条(列表 ${listingCount},详情 ${detailCount})`);
  if (jobs.length === 0) {
    console.log('没有捕获到任何职位,可能 Chrome 里没触发 userJobSearch。不写入数据库。');
    return;
  }

  const storage = new Storage(config.paths.database);
  const now = (): string => new Date().toISOString();
  const runId = storage.startRun(now());
  let jobsNew = 0;
  let failed = 0;
  try {
    for (const job of jobs) {
      try {
        const { isNew } = storage.upsertJob(job, now());
        storage.linkRunJob(runId, job.id, isNew);
        if (isNew) jobsNew++;
      } catch (err) {
        failed++;
        console.error(`\nupsert 失败 id=${job.id}: ${err instanceof Error ? err.message : err}`);
        console.error('Job 字段类型/预览:');
        for (const [k, v] of Object.entries(job)) {
          const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
          const preview = (() => {
            try {
              return JSON.stringify(v)?.slice(0, 100);
            } catch {
              return String(v);
            }
          })();
          console.error(`  ${k}: ${t}  ${preview}`);
        }
      }
    }
    storage.finishRun(runId, {
      jobsSeen: jobs.length - failed,
      jobsNew,
      status: failed === 0 ? 'success' : 'failed',
      finishedAt: now(),
    });
  } finally {
    storage.close();
  }
  if (failed > 0) console.log(`(${failed} 条 upsert 失败,详见上方日志)`);
  console.log(`运行 #${runId} 结束:seen=${jobs.length} new=${jobsNew}`);
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
    .command('watch')
    .description('附接已登录的 Chrome,被动监听你手动操作触发的搜索/详情响应,按 Enter 入库')
    .action(watchCommand);

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
