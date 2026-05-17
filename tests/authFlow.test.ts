import { describe, it, expect } from 'vitest';
import { runLogin, type LoginSession } from '../src/session/AuthFlow';

function makeFakes() {
  const calls: string[] = [];
  const page = {
    goto: async (url: string) => { calls.push(`goto:${url}`); },
  };
  const context = { newPage: async () => page };
  const browser = { close: async () => { calls.push('close'); } };
  const session: LoginSession = {
    launchContext: async () => ({ browser, context } as never),
    saveStorageState: async () => { calls.push('save'); },
  };
  return { calls, session };
}

describe('runLogin', () => {
  it('导航到登录页、等用户、再保存会话并关闭', async () => {
    const { calls, session } = makeFakes();
    await runLogin(session, async () => { calls.push('prompt'); });
    expect(calls).toEqual([
      'goto:https://www.upwork.com/ab/account-security/login',
      'prompt',
      'save',
      'close',
    ]);
  });

  it('在用户确认之前不保存会话', async () => {
    const { calls, session } = makeFakes();
    let releasePrompt!: () => void;
    const promptDone = new Promise<void>((r) => { releasePrompt = r; });

    const loginDone = runLogin(session, () => promptDone);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).not.toContain('save');

    releasePrompt();
    await loginDone;
    expect(calls).toContain('save');
  });
});
