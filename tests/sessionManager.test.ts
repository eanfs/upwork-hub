import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../src/session/SessionManager';

describe('SessionManager', () => {
  it('hasStorageState 在文件不存在时返回 false', () => {
    const sm = new SessionManager({ storageStatePath: '/no/such/state.json', headless: true });
    expect(sm.hasStorageState()).toBe(false);
  });

  it('保存的 storageState 能在下次启动时恢复 cookie', async () => {
    const statePath = join(mkdtempSync(join(tmpdir(), 'upwork-sess-')), 'state.json');

    const first = new SessionManager({ storageStatePath: statePath, headless: true });
    const a = await first.launchContext();
    await a.context.addCookies([
      { name: 'probe', value: 'kept', domain: 'example.com', path: '/' },
    ]);
    await first.saveStorageState(a.context);
    await a.browser.close();

    const second = new SessionManager({ storageStatePath: statePath, headless: true });
    expect(second.hasStorageState()).toBe(true);
    const b = await second.launchContext();
    const cookies = await b.context.cookies('https://example.com');
    expect(cookies.find((c) => c.name === 'probe')?.value).toBe('kept');
    await b.browser.close();
  }, 30000);
});
