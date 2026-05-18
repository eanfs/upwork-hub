/** 只读工具:附接 Chrome,把"已打开、已渲染好"的某个标签页 dump 下来,不做任何导航。 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function main(): Promise<void> {
  const match = process.argv[2] ?? 'search/jobs';
  const label = process.argv[3] ?? 'page';
  const out = join(process.cwd(), 'captures', 'read-' + new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  if (!context) throw new Error('no context');

  const pages = context.pages();
  console.log(`Chrome 当前打开 ${pages.length} 个标签:`);
  for (const p of pages) console.log(`  - ${p.url()}`);

  const page = pages.find((p) => p.url().includes(match));
  if (!page) {
    console.log(`\n没找到 URL 含 "${match}" 的标签。请先在 Chrome 里手动打开目标页面。`);
    return;
  }
  console.log(`\n读取: ${page.url()}`);

  const html = await page.content();
  writeFileSync(join(out, `${label}.html`), html);
  console.log(`HTML 已存 ${label}.html (${html.length} 字节)`);

  const scripts: { id: string; type: string; len: number; text: string }[] =
    await page.evaluate(() => Array.from(document.querySelectorAll('script')).map((s) => ({
      id: s.id || '',
      type: s.getAttribute('type') || '',
      len: (s.textContent || '').length,
      text: s.textContent || '',
    })));
  let si = 0;
  for (const s of scripts) {
    if (s.len < 300) continue;
    writeFileSync(join(out, `${label}-script-${String(si++).padStart(2, '0')}.txt`),
      `id=${s.id}\ntype=${s.type}\nlen=${s.len}\n----\n${s.text}`);
  }
  console.log(`存了 ${si} 个 script 块`);
  console.log(`标题: ${await page.title()}`);
  console.log(`\n=== 产物: ${out} ===`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
