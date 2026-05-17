import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ChromeConnector } from '../src/session/ChromeConnector';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ChromeConnector', () => {
  it('Chrome 未运行时 connect 抛出友好错误', async () => {
    const connector = new ChromeConnector({
      cdpPort: 9971,
      userDataDir: '/tmp/none',
      executablePath: chromium.executablePath(),
    });
    await expect(connector.connect()).rejects.toThrow(/upwork-hub login/);
  });

  it('connect 能附接到运行中的 Chrome 并返回上下文', async () => {
    const port = 9972;
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    const proc: ChildProcess = spawn(
      chromium.executablePath(),
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dir}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      { stdio: 'ignore' },
    );
    try {
      const connector = new ChromeConnector({
        cdpPort: port,
        userDataDir: dir,
        executablePath: chromium.executablePath(),
      });
      let result: Awaited<ReturnType<ChromeConnector['connect']>> | undefined;
      for (let i = 0; i < 50; i++) {
        try {
          result = await connector.connect();
          break;
        } catch {
          await sleep(200);
        }
      }
      expect(result?.context).toBeDefined();
      await result!.browser.close();
    } finally {
      proc.kill();
    }
  }, 40000);
});
