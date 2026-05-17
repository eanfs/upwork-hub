import { describe, it, expect } from 'vitest';
import { Pacer } from '../src/pacer/Pacer';

describe('Pacer', () => {
  it('randomDelayMs 落在 [min, max] 区间内', () => {
    const pacer = new Pacer(3000, 8000);
    for (let i = 0; i < 100; i++) {
      const d = pacer.randomDelayMs();
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });

  it('min 等于 max 时恒返回该值', () => {
    expect(new Pacer(5000, 5000).randomDelayMs()).toBe(5000);
  });

  it('wait 至少等待 min 毫秒', async () => {
    const pacer = new Pacer(20, 25);
    const start = Date.now();
    await pacer.wait();
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });
});
