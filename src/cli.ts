import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config';
import { SessionManager } from './session/SessionManager';
import { runLogin } from './session/AuthFlow';
import { Storage } from './storage/Storage';
import { exportJobsToCsv } from './export/CsvExporter';

const CONFIG_PATH = process.env.UPWORK_HUB_CONFIG ?? './config.json';

function promptEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function loginCommand(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.storageState), { recursive: true });
  // 登录必须有头,否则无法手动操作。
  const session = new SessionManager({
    storageStatePath: config.paths.storageState,
    headless: false,
  });
  await runLogin(session, promptEnter);
  console.log(`登录会话已保存到 ${config.paths.storageState}`);
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
    .description('打开浏览器手动登录 Upwork 并保存会话')
    .action(loginCommand);

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
