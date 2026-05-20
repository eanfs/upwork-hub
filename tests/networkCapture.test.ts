import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { NetworkCapture } from '../src/collect/NetworkCapture';

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

function makePage() {
  const ee = new EventEmitter();
  return Object.assign(ee, { emit: ee.emit.bind(ee), on: ee.on.bind(ee) });
}

const JSON_CT = { 'content-type': 'application/json' };

describe('NetworkCapture', () => {
  it('waitFor 在收到匹配响应时 resolve 响应体', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const promise = capture.waitFor((url) => url.includes('userJobSearch'));
    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/api/graphql/v1?alias=userJobSearch',
        JSON_CT,
        { data: 'ok' },
      ),
    );
    await expect(promise).resolves.toEqual({ data: 'ok' });
  });

  it('忽略非 upwork.com 的响应', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const promise = capture.waitFor(() => true, 50);
    page.emit('response', new FakeResponse('https://example.com/x', JSON_CT, {}));
    await expect(promise).rejects.toThrow(/超时/);
  });

  it('忽略非 JSON 响应', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const promise = capture.waitFor(() => true, 50);
    page.emit(
      'response',
      new FakeResponse(
        'https://www.upwork.com/x',
        { 'content-type': 'text/html' },
        {},
      ),
    );
    await expect(promise).rejects.toThrow(/超时/);
  });

  it('waitFor 超时时抛错', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    await expect(capture.waitFor(() => true, 30)).rejects.toThrow(/超时/);
  });

  it('getAll 返回所有匹配的已捕获响应体', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    page.emit('response', new FakeResponse('https://www.upwork.com/a', JSON_CT, { i: 1 }));
    page.emit('response', new FakeResponse('https://www.upwork.com/b', JSON_CT, { i: 2 }));
    await new Promise((r) => setTimeout(r, 10));
    const items = capture.getAll((url) => url.endsWith('/a') || url.endsWith('/b'));
    expect(items).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it('多个 waitFor 各自等到自己的匹配', async () => {
    const page = makePage();
    const capture = new NetworkCapture(page as never);
    const pa = capture.waitFor((u) => u.endsWith('/a'));
    const pb = capture.waitFor((u) => u.endsWith('/b'));
    page.emit('response', new FakeResponse('https://www.upwork.com/b', JSON_CT, { v: 'b' }));
    page.emit('response', new FakeResponse('https://www.upwork.com/a', JSON_CT, { v: 'a' }));
    await expect(pa).resolves.toEqual({ v: 'a' });
    await expect(pb).resolves.toEqual({ v: 'b' });
  });
});
