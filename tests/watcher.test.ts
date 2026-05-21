import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Watcher, inferSource } from '../src/collect/Watcher';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/search-response.json'), 'utf8'),
);
const DETAIL_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/job-detail-response.json'), 'utf8'),
);

class FakeResponse {
  constructor(
    private _url: string,
    private _headers: Record<string, string>,
    private _body: unknown,
  ) {}
  url() { return this._url; }
  headers() { return this._headers; }
  async json() { return this._body; }
}

class FakePage extends EventEmitter {
  constructor(public currentUrl: string) {
    super();
  }
  url() { return this.currentUrl; }
}

class FakeContext extends EventEmitter {
  private _pages: FakePage[] = [];
  pages() { return this._pages; }
  addPage(p: FakePage) {
    this._pages.push(p);
    this.emit('page', p);
  }
  presetPage(p: FakePage) {
    this._pages.push(p);
  }
}

const JSON_CT = { 'content-type': 'application/json' };

async function flush() {
  await new Promise((r) => setTimeout(r, 10));
}

describe('Watcher', () => {
  it('监听已有页面的 userJobSearch 响应并按 ?q= 推断 source', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=react%20developer');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    const { jobs, listingCount, detailCount } = watcher.collected();
    const fixtureLen = SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results.length;
    expect(listingCount).toBe(fixtureLen);
    expect(detailCount).toBe(0);
    expect(jobs).toHaveLength(fixtureLen);
    expect(jobs[0].source).toBe('keyword:react developer');
    expect(jobs[0].detailFetched).toBe(false);
  });

  it('对后续新开的页面也 attach', async () => {
    const ctx = new FakeContext();
    const watcher = new Watcher(ctx as never);
    watcher.start();

    const newPage = new FakePage('https://www.upwork.com/nx/search/jobs/?q=python');
    ctx.addPage(newPage);

    newPage.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    expect(watcher.collected().listingCount).toBeGreaterThan(0);
    expect(watcher.collected().jobs[0].source).toBe('keyword:python');
  });

  it('捕获详情响应并产出 detailFetched=true 的 Job', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=k');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    const listingFirstId =
      SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results[0].id;
    const detailId = DETAIL_FIXTURE.data.jobAuthDetails.opening.job.info.id;
    expect(detailId).not.toBe(listingFirstId);

    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2',
        JSON_CT,
        DETAIL_FIXTURE,
      ),
    );
    await flush();

    const { jobs, listingCount, detailCount } = watcher.collected();
    expect(listingCount).toBeGreaterThan(0);
    expect(detailCount).toBe(1);
    const detailOnly = jobs.find((j) => j.id === detailId);
    expect(detailOnly).toBeDefined();
    expect(detailOnly!.detailFetched).toBe(true);
    expect(detailOnly!.category).toBe(
      DETAIL_FIXTURE.data.jobAuthDetails.opening.job.category.name,
    );
  });

  it('忽略 upwork.com 以外的响应与非 JSON 响应', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=x');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit(
      'response',
      new FakeResponse('https://example.com/api?alias=userJobSearch', JSON_CT, SEARCH_FIXTURE),
    );
    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        { 'content-type': 'text/html' },
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    expect(watcher.collected().listingCount).toBe(0);
  });

  it('inferSource 按 URL 路径推断:搜索 / 已保存搜索 / best-matches / 详情页 / 其他', () => {
    expect(inferSource('https://www.upwork.com/nx/search/jobs/?q=react%20developer')).toBe(
      'keyword:react developer',
    );
    expect(inferSource('https://www.upwork.com/nx/search/jobs/')).toBe('search:unknown');
    expect(inferSource('https://www.upwork.com/nx/find-work/saved/abc123')).toBe(
      'savedSearch:/nx/find-work/saved/abc123',
    );
    expect(inferSource('https://www.upwork.com/nx/find-work/best-matches')).toBe(
      'feed:best-matches',
    );
    expect(inferSource('https://www.upwork.com/jobs/~02XXXXX')).toBe('job-detail-page');
    expect(inferSource('https://www.upwork.com/nx/some/other/path')).toBe(
      'page:/nx/some/other/path',
    );
    expect(inferSource('not-a-url')).toBe('page:not-a-url');
  });

  it('同 id 的列表响应被后到的覆盖(用户翻回原页时)', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=k');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const watcher = new Watcher(ctx as never);
    watcher.start();

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
      JSON_CT, SEARCH_FIXTURE,
    ));
    await flush();
    const firstCount = watcher.collected().listingCount;

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
      JSON_CT, SEARCH_FIXTURE,
    ));
    await flush();

    expect(watcher.collected().listingCount).toBe(firstCount);
  });

  it('传入 onJob 时,每捕获一条列表 Job 就回调一次', async () => {
    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=k');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const emitted: any[] = [];
    const watcher = new Watcher(ctx as never, (j) => emitted.push(j));
    watcher.start();

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
      JSON_CT, SEARCH_FIXTURE,
    ));
    await flush();

    const fixtureLen = SEARCH_FIXTURE.data.search.universalSearchNuxt.userJobSearchV1.results.length;
    expect(emitted).toHaveLength(fixtureLen);
    expect(emitted[0].detailFetched).toBe(false);
    expect(emitted[0].source).toBe('keyword:k');
  });

  it('捕获详情响应时 onJob 收到 detailFetched=true 的 Job', async () => {
    const page = new FakePage('https://www.upwork.com/jobs/~02xxx');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const emitted: any[] = [];
    const watcher = new Watcher(ctx as never, (j) => emitted.push(j));
    watcher.start();

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2',
      JSON_CT, DETAIL_FIXTURE,
    ));
    await flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].detailFetched).toBe(true);
    expect(emitted[0].id).toBe(DETAIL_FIXTURE.data.jobAuthDetails.opening.job.info.id);
  });

  it('同 id 的列表 + 详情:onJob 先收到列表 Job,详情到达后收到合并 Job', async () => {
    const detailId = DETAIL_FIXTURE.data.jobAuthDetails.opening.job.info.id;
    // 造一个搜索响应,把第一条 result 的 id 改成详情那条职位的 id
    const search = JSON.parse(JSON.stringify(SEARCH_FIXTURE));
    const firstResult = search.data.search.universalSearchNuxt.userJobSearchV1.results[0];
    firstResult.id = detailId;
    firstResult.jobTile.job.id = detailId;

    const page = new FakePage('https://www.upwork.com/nx/search/jobs/?q=react');
    const ctx = new FakeContext();
    ctx.presetPage(page);
    const emitted: any[] = [];
    const watcher = new Watcher(ctx as never, (j) => emitted.push(j));
    watcher.start();

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
      JSON_CT, search,
    ));
    await flush();
    const beforeDetail = emitted.find((j) => j.id === detailId);
    expect(beforeDetail.detailFetched).toBe(false);

    page.emit('response', new FakeResponse(
      'https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2',
      JSON_CT, DETAIL_FIXTURE,
    ));
    await flush();

    const merged = emitted[emitted.length - 1];
    expect(merged.id).toBe(detailId);
    expect(merged.detailFetched).toBe(true);
    expect(merged.category).toBe(DETAIL_FIXTURE.data.jobAuthDetails.opening.job.category.name);
    // 合并后 source 仍取列表侧
    expect(merged.source).toBe('keyword:react');
    watcher.stop();
  });

  it('对定期扫描新出现的页面也 attach', async () => {
    const ctx = new FakeContext();
    const watcher = new Watcher(ctx as never);
    watcher.start();

    // 模拟一个新页面，它没有通过 ctx 'page' 事件发出，而是直接放入 pages() 数组
    const newPage = new FakePage('https://www.upwork.com/nx/search/jobs/?q=golang');
    ctx.presetPage(newPage);

    // 等待扫描周期 (1000ms)，我们等待 1100ms 确保扫描完成
    await new Promise((r) => setTimeout(r, 1100));

    newPage.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        SEARCH_FIXTURE,
      ),
    );
    await flush();

    expect(watcher.collected().listingCount).toBeGreaterThan(0);
    expect(watcher.collected().jobs[0].source).toBe('keyword:golang');

    watcher.stop();
  });
});
