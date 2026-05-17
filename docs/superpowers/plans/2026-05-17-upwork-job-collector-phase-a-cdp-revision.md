# Upwork 职位收集器 — 阶段 A 修订:改用 CDP 附接真实 Chrome

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把阶段 A 已实现的「Playwright 启动 Chromium + storageState」方案,改为「用调试端口启动用户本机真实 Chrome + `connectOverCDP` 附接」,以绕过 Upwork 的 Cloudflare 机器人拦截。

**Why:** 阶段 A 实测发现 Playwright 自带 Chromium 带 `navigator.webdriver` 等自动化指纹,被 Cloudflare 直接拦截。详见设计文档 `2026-05-17-upwork-job-collector-design.md` 顶部「修订」说明。

**Tech Stack:** 不变(Node.js + TypeScript + Playwright);改用 `chromium.connectOverCDP` 与 `child_process.spawn`。

**受影响范围:** Task 2/3/8/9/10/11 的产物。Task 1/4/5/6/7 不变。

---

## 配置结构变化

`Config.browser`(`{ headless }`)→ `Config.chrome`(`{ cdpPort, userDataDir, executablePath }`);删除 `Config.paths.storageState`。

---

## Task R1: 领域类型 — Config 改 chrome 段

**Files:** Modify: `src/types.ts`

- [ ] **Step 1: 修改 `Config` 接口** — 把 `browser: { headless: boolean }` 替换为 `chrome` 段,并从 `paths` 删除 `storageState`。最终 `Config` 为:

```typescript
export interface Config {
  sources: {
    keywords: string[];
    savedSearches: string[];
    categoryFilters: CategoryFilter[];
  };
  pacing: {
    minDelayMs: number;
    maxDelayMs: number;
    maxPagesPerSource: number;
    maxDetailsPerRun: number;
  };
  chrome: {
    cdpPort: number;
    userDataDir: string;
    executablePath: string;
  };
  paths: {
    database: string;
    exportDir: string;
  };
}
```

其余类型(`Job` / `StoredJob` / `Run` / `CategoryFilter` 等)不变。

- [ ] **Step 2: 验证** — `npm run typecheck` 会因 config.ts 等仍引用旧字段而报错,这是预期的;本步只确认 `src/types.ts` 自身语法无误(报错都来自其他文件)。
- [ ] **Step 3: 提交** — `git add src/types.ts && git commit -m "refactor: Config 改用 chrome 段(CDP 方案)"`

---

## Task R2: 配置校验 — 校验 chrome 段

**Files:** Modify: `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: 改 `tests/config.test.ts`** — 整个文件替换为:

```typescript
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config';

function tmpConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'upwork-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, content);
  return path;
}

const validConfig = {
  sources: { keywords: ['react'], savedSearches: [], categoryFilters: [] },
  pacing: { minDelayMs: 3000, maxDelayMs: 8000, maxPagesPerSource: 5, maxDetailsPerRun: 50 },
  chrome: { cdpPort: 9222, userDataDir: './data/chrome-profile', executablePath: '/path/to/chrome' },
  paths: { database: './data/u.db', exportDir: './data/exports' },
};

describe('loadConfig', () => {
  it('加载合法配置', () => {
    const cfg = loadConfig(tmpConfig(JSON.stringify(validConfig)));
    expect(cfg.sources.keywords).toEqual(['react']);
    expect(cfg.chrome.cdpPort).toBe(9222);
  });

  it('缺少 sources 时报错', () => {
    const bad = { ...validConfig } as Record<string, unknown>;
    delete bad.sources;
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/sources/);
  });

  it('minDelayMs 大于 maxDelayMs 时报错', () => {
    const bad = { ...validConfig, pacing: { ...validConfig.pacing, minDelayMs: 9000 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/minDelayMs/);
  });

  it('文件不存在时报错', () => {
    expect(() => loadConfig('/no/such/config.json')).toThrow(/找不到配置文件/);
  });

  it('JSON 非法时报错', () => {
    expect(() => loadConfig(tmpConfig('{ not json'))).toThrow(/JSON/);
  });

  it('配置不是对象时报错', () => {
    expect(() => loadConfig(tmpConfig('[]'))).toThrow(/对象/);
  });

  it('pacing.maxPagesPerSource 非数字时报错', () => {
    const bad = { ...validConfig, pacing: { ...validConfig.pacing, maxPagesPerSource: 'x' } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/maxPagesPerSource/);
  });

  it('chrome.cdpPort 非数字时报错', () => {
    const bad = { ...validConfig, chrome: { ...validConfig.chrome, cdpPort: '9222' } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/cdpPort/);
  });

  it('chrome.executablePath 非字符串时报错', () => {
    const bad = { ...validConfig, chrome: { ...validConfig.chrome, executablePath: 123 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/executablePath/);
  });

  it('paths.database 非字符串时报错', () => {
    const bad = { ...validConfig, paths: { ...validConfig.paths, database: 123 } };
    expect(() => loadConfig(tmpConfig(JSON.stringify(bad)))).toThrow(/database/);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败** — `npx vitest run tests/config.test.ts`,预期 FAIL(校验逻辑还在校验旧的 browser 段)。
- [ ] **Step 3: 改 `src/config.ts`** — 把校验 `browser` 与 `paths` 的两段替换。当前为:

```typescript
  if (!c.browser || typeof c.browser.headless !== 'boolean') fail('browser.headless 必须是布尔值');

  if (!c.paths) fail('缺少 paths');
  for (const k of ['storageState', 'database', 'exportDir'] as const) {
    if (typeof c.paths[k] !== 'string') fail(`paths.${k} 必须是字符串`);
  }
```

替换为:

```typescript
  if (!c.chrome) fail('缺少 chrome');
  if (typeof c.chrome.cdpPort !== 'number') fail('chrome.cdpPort 必须是数字');
  if (typeof c.chrome.userDataDir !== 'string') fail('chrome.userDataDir 必须是字符串');
  if (typeof c.chrome.executablePath !== 'string') fail('chrome.executablePath 必须是字符串');

  if (!c.paths) fail('缺少 paths');
  for (const k of ['database', 'exportDir'] as const) {
    if (typeof c.paths[k] !== 'string') fail(`paths.${k} 必须是字符串`);
  }
```

`src/config.ts` 其余部分(文件存在性、JSON 解析、根类型守卫、sources、pacing 校验)不变。

- [ ] **Step 4: 运行测试,确认通过** — `npx vitest run tests/config.test.ts`,预期 PASS,10 个用例。
- [ ] **Step 5: 提交** — `git add src/config.ts tests/config.test.ts && git commit -m "refactor: 配置校验改为校验 chrome 段"`

---

## Task R3: ChromeConnector 取代 SessionManager

**Files:** Create: `src/session/ChromeConnector.ts`, `tests/chromeConnector.test.ts`;Delete: `src/session/SessionManager.ts`, `tests/sessionManager.test.ts`

- [ ] **Step 1: 删除旧文件** — `git rm src/session/SessionManager.ts tests/sessionManager.test.ts`

- [ ] **Step 2: 写失败测试** — 创建 `tests/chromeConnector.test.ts`:

```typescript
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
```

- [ ] **Step 3: 运行测试,确认失败** — `npx vitest run tests/chromeConnector.test.ts`,预期 FAIL(模块不存在)。

- [ ] **Step 4: 创建 `src/session/ChromeConnector.ts`:**

```typescript
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
```

> 注意:`connect()` 返回的 `browser` 是用户的真实 Chrome。生产代码(observe / collectors)**只可关闭自己新开的标签页(`page.close()`),绝不可调用 `browser.close()`**,否则会关掉用户的浏览器。

- [ ] **Step 5: 运行测试,确认通过** — `npx vitest run tests/chromeConnector.test.ts`,预期 PASS,2 个用例(第二个会启动 headless Chromium,需数秒)。
- [ ] **Step 6: 提交** — `git add -A src/session tests/chromeConnector.test.ts && git commit -m "feat: ChromeConnector 取代 SessionManager(CDP 附接)"`

---

## Task R4: CLI 与配置样例改用 ChromeConnector,删除 AuthFlow

**Files:** Modify: `src/cli.ts`, `config.example.json`;Delete: `src/session/AuthFlow.ts`, `tests/authFlow.test.ts`

- [ ] **Step 1: 删除 AuthFlow** — `git rm src/session/AuthFlow.ts tests/authFlow.test.ts`

- [ ] **Step 2: 整体替换 `src/cli.ts`:**

```typescript
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config';
import { ChromeConnector } from './session/ChromeConnector';
import { Storage } from './storage/Storage';
import { exportJobsToCsv } from './export/CsvExporter';

const CONFIG_PATH = process.env.UPWORK_HUB_CONFIG ?? './config.json';

function loginCommand(): void {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(config.chrome.userDataDir, { recursive: true });
  const connector = new ChromeConnector(config.chrome);
  connector.launchChrome();
  console.log(
    `已启动 Chrome(调试端口 ${config.chrome.cdpPort})。\n` +
      '请在打开的窗口中登录 Upwork,登录后保持该窗口开启,即可运行 collect / observe。',
  );
}

function exportCommand(): void {
  const config = loadConfig(CONFIG_PATH);
  mkdirSync(dirname(config.paths.database), { recursive: true });
  const storage = new Storage(config.paths.database);
  try {
    const runId = storage.getLatestRunId();
    if (runId === undefined) {
      console.log('数据库中还没有运行记录,无可导出的职位。');
      return;
    }
    const jobs = storage.getJobsForRun(runId);
    const path = exportJobsToCsv(jobs, config.paths.exportDir);
    console.log(`已导出 ${jobs.length} 个职位(运行 #${runId})到 ${path}`);
  } finally {
    storage.close();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('upwork-hub').description('Upwork 职位信息收集器');

  program
    .command('login')
    .description('启动带调试端口的真实 Chrome,供你手动登录 Upwork')
    .action(loginCommand);

  program
    .command('export')
    .description('把最近一次运行采集的职位导出为 CSV')
    .action(exportCommand);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

- [ ] **Step 3: 整体替换 `config.example.json`:**

```json
{
  "sources": {
    "keywords": ["react developer", "python automation"],
    "savedSearches": [],
    "categoryFilters": []
  },
  "pacing": {
    "minDelayMs": 3000,
    "maxDelayMs": 8000,
    "maxPagesPerSource": 5,
    "maxDetailsPerRun": 50
  },
  "chrome": {
    "cdpPort": 9222,
    "userDataDir": "./data/chrome-profile",
    "executablePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  },
  "paths": {
    "database": "./data/upwork.db",
    "exportDir": "./data/exports"
  }
}
```

- [ ] **Step 4: 验证** — `cp config.example.json config.json && npm run export`,预期打印 `数据库中还没有运行记录,无可导出的职位。`,退出码 0。
- [ ] **Step 5: 验证命令注册** — `npx tsx src/cli.ts --help`,预期列出 `login` 与 `export`。不要运行 `npm run login`(会启动 Chrome)。
- [ ] **Step 6: 类型检查** — `npm run typecheck`,预期退出码 0。
- [ ] **Step 7: 提交** — `git add -A src/cli.ts src/session config.example.json tests && git commit -m "refactor: CLI login 改用 ChromeConnector,删除 AuthFlow"`

---

## Task R5: observe 脚本改用 ChromeConnector

**Files:** Modify: `scripts/observe.ts`

- [ ] **Step 1: 整体替换 `scripts/observe.ts`:**

```typescript
/**
 * 发现工具:附接到已登录的真实 Chrome,打开指定 URL,
 * 把所有 upwork.com 的 XHR/fetch JSON 响应转储到 captures/ 目录。
 * 用法: tsx scripts/observe.ts "<要打开的 URL>"
 * 前置:先运行 `npm run login` 启动 Chrome 并登录 Upwork。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { ChromeConnector } from '../src/session/ChromeConnector';

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

  const connector = new ChromeConnector(config.chrome);
  const { context } = await connector.connect();
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
  console.log('可在浏览器中手动翻页/点开职位以捕获更多接口。完成后按 Enter 关闭本标签...');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));

  await page.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

> 只 `page.close()` 关闭自己开的标签,不关用户的 Chrome。

- [ ] **Step 2: 类型检查** — `npm run typecheck`,预期退出码 0。
- [ ] **Step 3: 提交** — `git add scripts/observe.ts && git commit -m "refactor: observe 脚本改用 ChromeConnector 附接"`

---

## 修订完成标准

- [ ] `npm run test` —— 全部测试通过(config 10 个、chromeConnector 2 个,及未改动的 storage/sourceResolver/pacer/csvExporter)。
- [ ] `npm run typecheck` —— 无类型错误。
- [ ] 不再有任何文件引用 `SessionManager`、`AuthFlow`、`storageState`、`Config.browser`。
- [ ] `npm run export`(空库)正常;`upwork-hub --help` 列出 `login` / `export`。
