/** 在浏览器动作之间插入随机延时,模拟真人节奏。 */
export class Pacer {
  constructor(private readonly minDelayMs: number, private readonly maxDelayMs: number) {}

  randomDelayMs(): number {
    return this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
  }

  async wait(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.randomDelayMs()));
  }
}
