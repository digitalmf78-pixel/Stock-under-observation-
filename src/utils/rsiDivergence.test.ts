import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWilderRsiAligned,
  detectRsiDivergences,
  type RsiDivergenceInputBar,
} from './rsiDivergence.ts';

function buildBarsFromCloses(closes: number[]): RsiDivergenceInputBar[] {
  return closes.map((close, idx) => ({
    date: `2026-01-${String(idx + 1).padStart(2, '0')}`,
    high: Number((close * 1.008).toFixed(2)),
    low: Number((close * 0.992).toFixed(2)),
    close,
  }));
}

describe('computeWilderRsiAligned', () => {
  it('preserves null warm-up entries aligned 1:1 with closes without splicing', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const rsi = computeWilderRsiAligned(closes, 14);
    assert.equal(rsi.length, closes.length);
    for (let i = 0; i < 14; i++) {
      assert.equal(rsi[i], null);
    }
    assert.ok(rsi[14] !== null && rsi[14] > 90);
    assert.ok(rsi[19] !== null);
  });
});

describe('detectRsiDivergences', () => {
  it('detects Regular Bearish Divergence when price makes Higher High while RSI makes Lower High', () => {
    // 18-bar base uptrend, Peak 1 at index 17 (price ~142, strong RSI),
    // pullback, then slightly higher price Peak 2 at index 25 with weaker momentum (Lower High RSI).
    const closes = [
      100, 101, 102, 103, 105, 107, 110, 113, 116, 120,
      124, 128, 132, 136, 140, 145, 150, 156, // strong rally -> peak 1 at idx 17 (RSI very high)
      148, 142, 138, 141, 146, 151, 155, 159, // higher price peak 2 at idx 25 after dip -> lower RSI
      153, 149, 146,
    ];
    const bars = buildBarsFromCloses(closes);
    const result = detectRsiDivergences(bars, {
      leftBars: 2,
      rightBars: 2,
      minBarsApart: 4,
    });

    assert.equal(result.insufficientData, false);
    const bearish = result.divergences.filter((d) => d.kind === 'REGULAR_BEARISH');
    assert.ok(bearish.length >= 1, 'Expected at least one REGULAR_BEARISH divergence');
    assert.ok(bearish[0].to.price > bearish[0].from.price);
    assert.ok(bearish[0].to.rsi < bearish[0].from.rsi);
    assert.equal(bearish[0].label, 'Regular Bearish Divergence');
  });

  it('detects Regular Bullish Divergence when price makes Lower Low while RSI makes Higher Low', () => {
    // Sustained downtrend into Trough 1, rebound, then slightly lower price Trough 2 with higher RSI.
    const closes = [
      160, 158, 156, 154, 151, 148, 145, 142, 138, 134,
      130, 125, 120, 115, 110, 104, 98, 92, // sharp selloff -> trough 1 at idx 17 (low RSI)
      100, 106, 109, 104, 98, 94, 90, // lower price trough 2 at idx 24 -> higher RSI
      95, 99, 103,
    ];
    const bars = buildBarsFromCloses(closes);
    const result = detectRsiDivergences(bars, {
      leftBars: 2,
      rightBars: 2,
      minBarsApart: 4,
    });

    assert.equal(result.insufficientData, false);
    const bullish = result.divergences.filter((d) => d.kind === 'REGULAR_BULLISH');
    assert.ok(bullish.length >= 1, 'Expected at least one REGULAR_BULLISH divergence');
    assert.ok(bullish[0].to.price < bullish[0].from.price);
    assert.ok(bullish[0].to.rsi > bullish[0].from.rsi);
    assert.equal(bullish[0].label, 'Regular Bullish Divergence');
  });

  it('detects Hidden Bullish Divergence when price makes Higher Low while RSI makes Lower Low', () => {
    const bars: RsiDivergenceInputBar[] = Array.from({ length: 30 }, (_, idx) => ({
      date: `2026-02-${String(idx + 1).padStart(2, '0')}`,
      high: 110,
      low: 100,
      close: 105,
      rsi14: idx < 14 ? null : 55,
    }));

    // Construct clean pivot trough 1 at idx 16 (low=100, rsi=48) and trough 2 at idx 23 (low=106, rsi=36)
    bars[14] = { ...bars[14], low: 105, close: 106, rsi14: 54 };
    bars[15] = { ...bars[15], low: 103, close: 104, rsi14: 51 };
    bars[16] = { ...bars[16], low: 100, close: 101, rsi14: 48 };
    bars[17] = { ...bars[17], low: 104, close: 106, rsi14: 53 };
    bars[18] = { ...bars[18], low: 109, close: 112, rsi14: 60 };

    bars[21] = { ...bars[21], low: 111, close: 113, rsi14: 45 };
    bars[22] = { ...bars[22], low: 108, close: 109, rsi14: 40 };
    bars[23] = { ...bars[23], low: 106, close: 107, rsi14: 36 };
    bars[24] = { ...bars[24], low: 110, close: 112, rsi14: 43 };
    bars[25] = { ...bars[25], low: 114, close: 116, rsi14: 50 };

    const result = detectRsiDivergences(bars, {
      leftBars: 2,
      rightBars: 2,
      minBarsApart: 4,
    });

    const hiddenBull = result.divergences.filter((d) => d.kind === 'HIDDEN_BULLISH');
    assert.equal(hiddenBull.length, 1);
    assert.equal(hiddenBull[0].from.index, 16);
    assert.equal(hiddenBull[0].to.index, 23);
    assert.ok(hiddenBull[0].to.price > hiddenBull[0].from.price);
    assert.ok(hiddenBull[0].to.rsi < hiddenBull[0].from.rsi);
  });

  it('returns insufficientData=true cleanly when history is shorter than warm-up window', () => {
    const shortBars = buildBarsFromCloses([100, 102, 104, 103, 105, 107]);
    const result = detectRsiDivergences(shortBars);
    assert.equal(result.insufficientData, true);
    assert.equal(result.divergences.length, 0);
    assert.equal(result.rsiSeries.length, shortBars.length);
  });
});
