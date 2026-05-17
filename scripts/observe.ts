/**
 * 发现工具:用已保存的登录会话打开指定 URL,
 * 把所有 upwork.com 的 XHR/fetch JSON 响应转储到 captures/ 目录。
 * 用法: tsx scripts/observe.ts "<要打开的 URL>"
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { SessionManager } from '../src/session/SessionManager';

async function main(): Promise<void> {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error('用法: tsx scripts/observe.ts "<URL>"');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(process.env.UPWORK_HUB_CONFIG ?? './config.json');
  const outDir = join('captures', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });

  // 观察用有头浏览器,便于人工确认页面正常加载。
  const session = new SessionManager({
    storageStatePath: config.paths.storageState,
    headless: false,
  });
  const { browser, context } = await session.launchContext();
  const page = await context.newPage();

  let index = 0;
  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] ?? '';
    if (!url.includes('upwork.com') || !ct.includes('json')) return;
    try {
      const body = await response.text();
      const name = `${String(index++).padStart(3, '0')}.json`;
      writeFileSync(
        join(outDir, name),
        JSON.stringify({ url, status: response.status(), body }, null, 2),
      );
      console.log(`捕获 ${name}  ${response.status()}  ${url}`);
    } catch {
      // 部分响应体不可读(如重定向),忽略。
    }
  });

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  console.log(`\n已加载页面。响应转储在 ${outDir}/`);
  console.log('可在浏览器中手动翻页/点开职位以捕获更多接口。完成后按 Enter 关闭...');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));

  await browser.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
