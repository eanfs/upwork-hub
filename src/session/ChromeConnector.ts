import { spawn } from 'node:child_process';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface ChromeOptions {
  cdpPort: number;
  userDataDir: string;
  executablePath: string;
}

/** 启动用户本机真实 Chrome(带调试端口),并通过 CDP 附接到它。 */
export class ChromeConnector {
  constructor(private readonly opts: ChromeOptions) {}

  private endpoint(): string {
    return `http://127.0.0.1:${this.opts.cdpPort}`;
  }

  /** 以调试端口 + 独立用户目录后台启动真实 Chrome,并停在 Upwork 首页。 */
  launchChrome(): void {
    const child = spawn(
      this.opts.executablePath,
      [
        `--remote-debugging-port=${this.opts.cdpPort}`,
        `--user-data-dir=${this.opts.userDataDir}`,
        'https://www.upwork.com/',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
  }

  /** 经 CDP 附接到运行中的 Chrome,返回浏览器与其已登录的默认上下文。 */
  async connect(): Promise<{ browser: Browser; context: BrowserContext }> {
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(this.endpoint());
    } catch {
      throw new Error(
        `无法连接到 Chrome 调试端口 ${this.opts.cdpPort}。请先运行 \`upwork-hub login\` 启动 Chrome。`,
      );
    }
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('已连接 Chrome,但未找到可用的浏览器上下文。');
    }
    return { browser, context };
  }
}
