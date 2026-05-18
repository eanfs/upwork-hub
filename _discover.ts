/** 发现脚本 v2:抓取搜索/详情页的完整 HTML 与嵌入的 SSR 状态脚本。 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'captures', 'v2-' + new Date().toISOString().replace(/[:.]/g, '-'));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  if (!context) throw new Error('no context');
  const page = await context.newPage();

  let jsonIdx = 0;
  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] ?? '';
    if (!url.includes('upwork.com') || !ct.includes('json')) return;
    try {
      const body = await resp.text();
      writeFileSync(
        join(OUT, `gql-${String(jsonIdx++).padStart(3, '0')}.json`),
        JSON.stringify({ url, status: resp.status(), body }, null, 2),
      );
    } catch { /* ignore */ }
  });

  async function snapshot(label: string, url: string): Promise<void> {
    console.log(`\n>>> ${label}: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.log(`  goto warn: ${String(e).slice(0, 120)}`);
    }
    await page.waitForTimeout(10000);
    console.log(`  title: ${await page.title()}  url: ${page.url()}`);

    const html = await page.content();
    writeFileSync(join(OUT, `${label}.html`), html);
    console.log(`  saved ${label}.html (${html.length} bytes)`);

    const scripts: { id: string; type: string; len: number; text: string }[] =
      await page.evaluate(() => Array.from(document.querySelectorAll('script')).map((s) => ({
        id: s.id || '',
        type: s.getAttribute('type') || '',
        len: (s.textContent || '').length,
        text: s.textContent || '',
      })));
    let si = 0;
    for (const s of scripts) {
      if (s.len < 500) continue;
      writeFileSync(
        join(OUT, `${label}-script-${String(si++).padStart(2, '0')}.txt`),
        `id=${s.id}\ntype=${s.type}\nlen=${s.len}\n----\n${s.text}`,
      );
    }
    console.log(`  saved ${si} script blocks >=500 bytes`);
  }

  await snapshot('search', 'https://www.upwork.com/nx/search/jobs/?q=react%20developer');

  const detailUrl: string | null = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const job = anchors.find((a) => /\/jobs\/|~02/.test(a.getAttribute('href') || ''));
    return job ? job.href : null;
  });
  console.log(`\ndetail link: ${detailUrl ?? 'not found'}`);
  if (detailUrl) await snapshot('detail', detailUrl);

  await page.close();
  console.log(`\n=== done, output dir: ${OUT} ===`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
