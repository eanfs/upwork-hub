import type { Page, Response } from 'playwright';

interface Waiter {
  predicate: (url: string) => boolean;
  resolve: (body: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 在一个 Playwright Page 上拦截 upwork.com 的 JSON 响应,
 * 提供「等下一条符合谓词的响应」与「取已捕获的全部响应」两种用法。
 */
export class NetworkCapture {
  private readonly captures: { url: string; body: unknown }[] = [];
  private readonly waiters: Waiter[] = [];

  constructor(page: Page) {
    page.on('response', (res) => {
      void this.onResponse(res);
    });
  }

  private async onResponse(res: Response): Promise<void> {
    const url = res.url();
    if (!url.includes('upwork.com')) return;
    const ct = res.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return;
    }
    this.captures.push({ url, body });
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.predicate(url)) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        w.resolve(body);
      }
    }
  }

  /** 等待下一条 URL 匹配谓词的响应;超时则 reject。 */
  waitFor<T = unknown>(predicate: (url: string) => boolean, timeoutMs = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (b) => resolve(b as T),
        reject,
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new Error(`等待网络响应超时 ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** 取已捕获的、URL 匹配谓词的全部响应体。 */
  getAll<T = unknown>(predicate: (url: string) => boolean): T[] {
    return this.captures.filter((c) => predicate(c.url)).map((c) => c.body as T);
  }
}
