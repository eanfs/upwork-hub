import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface SessionOptions {
  storageStatePath: string;
  headless: boolean;
}

/** 启动 Chromium 并管理登录态(storageState)的加载与保存。 */
export class SessionManager {
  constructor(private readonly opts: SessionOptions) {}

  hasStorageState(): boolean {
    return existsSync(this.opts.storageStatePath);
  }

  /** 启动浏览器与上下文;若已有 storageState 则加载它。 */
  async launchContext(): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await chromium.launch({ headless: this.opts.headless });
    const context = await browser.newContext(
      this.hasStorageState() ? { storageState: this.opts.storageStatePath } : {},
    );
    return { browser, context };
  }

  /** 把当前上下文的登录态写到 storageState 文件。 */
  async saveStorageState(context: BrowserContext): Promise<void> {
    await context.storageState({ path: this.opts.storageStatePath });
  }
}
