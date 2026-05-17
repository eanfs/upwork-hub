import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config';
import { ChromeConnector } from './session/ChromeConnector';
import { Storage } from './storage/Storage';
import { exportJobsToCsv } from './export/CsvExporter';

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
    .command('export')
    .description('把最近一次运行采集的职位导出为 CSV')
    .action(exportCommand);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
