import type { Browser, BrowserContext } from 'playwright';

const LOGIN_URL = 'https://www.upwork.com/ab/account-security/login';

/** runLogin 所需的会话能力(由 SessionManager 满足,测试时可注入伪实现)。 */
export interface LoginSession {
  launchContext(): Promise<{ browser: Browser; context: BrowserContext }>;
  saveStorageState(context: BrowserContext): Promise<void>;
}

/**
 * 编排手动登录:打开浏览器到登录页,等用户完成登录(含 2FA),
 * 然后保存登录态并关闭浏览器。
 */
export async function runLogin(
  session: LoginSession,
  promptEnter: (message: string) => Promise<void>,
): Promise<void> {
  const { browser, context } = await session.launchContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL);
  await promptEnter('请在打开的浏览器中完成登录(含 2FA),完成后回到终端按 Enter...');
  await session.saveStorageState(context);
  await browser.close();
}
