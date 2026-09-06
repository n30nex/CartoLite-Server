import type { VisualQuality } from '../packetAnimator';

// Measure this renderer, not the phone model. Downshift quickly, recover slowly.
export class NetgraphQuality {
  mode: VisualQuality = 'full';
  private slowMS = 0;
  private fastMS = 0;

  sample(frameMS: number, drawMS: number): boolean {
    if (frameMS <= 0 || frameMS > 2_000 || !Number.isFinite(drawMS)) return false;
    const slow = frameMS > 25 || drawMS > 12;
    const fast = frameMS < 19 && drawMS < 5;
    this.slowMS = slow ? this.slowMS + Math.min(frameMS, 100) : Math.max(0, this.slowMS - frameMS);
    this.fastMS = fast ? this.fastMS + frameMS : 0;
    const next = this.slowMS >= 700 ? (this.mode === 'full' ? 'balanced' : 'low')
      : this.fastMS >= 12_000 ? (this.mode === 'low' ? 'balanced' : 'full') : this.mode;
    if (next === this.mode) return false;
    this.mode = next;
    this.slowMS = this.fastMS = 0;
    return true;
  }

  resetSamples(): void {
    this.slowMS = this.fastMS = 0;
  }
}
