import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEmaRibbonLatest,
  calculateEmaRibbonSeries,
  calculateEmaSeries,
  calculateLatestEma,
  calculateLatestRvol,
  calculateLatestWilderRsi,
  calculateRvolSeries,
  calculateWilderRsiSeries,
  type NumericInput,
} from './technicalIndicators.ts';

function assertClose(actual: number | null, expected: number | null, epsilon = 1e-9): void {
  assert.notEqual(expected, null, 'Expected reference value must not be null');
  assert.notEqual(actual, null, `Expected number near ${expected}, got null`);
  assert.ok(
    Math.abs((actual as number) - (expected as number)) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

describe('EMA (21, 44, 200) - SMA-seeded recursive calculation & index alignment', () => {
  it('returns all nulls when close array is shorter than period and rejects invalid periods', () => {
    const shortCloses = Array.from({ length: 20 }, (_, i) => 100 + i);
    const ema21 = calculateEmaSeries(shortCloses, 21);
    assert.equal(ema21.length, 20);
    assert.ok(ema21.every((v) => v === null));
    assert.equal(calculateLatestEma(shortCloses, 21), null);

    assert.throws(() => calculateEmaSeries(shortCloses, 0), RangeError);
    assert.throws(() => calculateEmaSeries(shortCloses, -5), RangeError);
    assert.throws(() => calculateEmaSeries(shortCloses, 14.5), RangeError);
  });

  it('seeds EMA(21) with SMA(21) at index 20 and applies (Close - PrevEMA) * (2/22) + PrevEMA', () => {
    const first21 = Array.from({ length: 21 }, (_, i) => 10 + i);
    const closes = [...first21, 42, 31];

    const series = calculateEmaSeries(closes, 21);
    assert.equal(series.length, closes.length);
    for (let i = 0; i < 20; i++) {
      assert.equal(series[i], null);
    }

    const expectedSeed = 20;
    assertClose(series[20], expectedSeed);

    const k = 2 / 22;
    const expected21 = (42 - expectedSeed) * k + expectedSeed;
    assertClose(series[21], expected21);

    const expected22 = (31 - expected21) * k + expected21;
    assertClose(series[22], expected22);
    assertClose(calculateLatestEma(closes, 21), expected22);
  });

  it('computes EMA(44) and EMA(200) accurately via calculateEmaRibbonSeries & calculateEmaRibbonLatest', () => {
    const closes = [...Array.from({ length: 200 }, (_, i) => i + 1), 250, 260];

    const ribbon = calculateEmaRibbonSeries(closes);
    assert.equal(ribbon.ema21.length, closes.length);
    assert.equal(ribbon.ema44.length, closes.length);
    assert.equal(ribbon.ema200.length, closes.length);
    assert.equal(ribbon.ema21.slice(0, 20).every((v) => v === null), true);
    assert.equal(ribbon.ema44.slice(0, 43).every((v) => v === null), true);
    assert.equal(ribbon.ema200.slice(0, 199).every((v) => v === null), true);

    assertClose(ribbon.ema44[43], 22.5);
    const k44 = 2 / (44 + 1);
    assertClose(ribbon.ema44[44], (45 - 22.5) * k44 + 22.5);

    assertClose(ribbon.ema200[199], 100.5);
    const k200 = 2 / (200 + 1);
    const ema200Bar200 = (250 - 100.5) * k200 + 100.5;
    const ema200Bar201 = (260 - ema200Bar200) * k200 + ema200Bar200;
    assertClose(ribbon.ema200[200], ema200Bar200);
    assertClose(ribbon.ema200[201], ema200Bar201);

    const latest = calculateEmaRibbonLatest(closes);
    assertClose(latest.ema21, ribbon.ema21[201]);
    assertClose(latest.ema44, ribbon.ema44[201]);
    assertClose(latest.ema200, ema200Bar201);
  });

  it('preserves exact date/index alignment without splicing or filtering warm-up null and NaN entries', () => {
    // 2 leading invalid values + 21 valid [10..30] + 1 mid-series NaN + 1 valid 42 = 25 points
    const dates = Array.from({ length: 25 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const closes: NumericInput[] = [
      null,
      Number.NaN,
      ...Array.from({ length: 21 }, (_, i) => 10 + i),
      Number.NaN,
      42,
    ];

    const ema21 = calculateEmaSeries(closes, 21);

    // Output length MUST equal input dates length; no warm-up nulls/NaNs spliced out
    assert.equal(ema21.length, dates.length);
    for (let i = 0; i < 22; i++) {
      assert.equal(ema21[i], null);
    }
    // Seed at index 22 (aligned with 2026-10-23) = SMA([10..30]) = 20
    assertClose(ema21[22], 20);
    // Mid-series NaN at index 23 stays null in place
    assert.equal(ema21[23], null);
    // Index 24 (aligned with 2026-10-25) resumes cleanly from PrevEMA = 20
    assertClose(ema21[24], (42 - 20) * (2 / 22) + 20);
  });
});

describe("RSI (14) - Wilder's Smoothing & index alignment", () => {
  it('returns null series when length <= period and rejects invalid periods', () => {
    const closes = Array.from({ length: 14 }, (_, i) => 100 + i);
    const rsi = calculateWilderRsiSeries(closes, 14);
    assert.equal(rsi.length, 14);
    assert.ok(rsi.every((v) => v === null));
    assert.equal(calculateLatestWilderRsi(closes, 14), null);

    assert.throws(() => calculateWilderRsiSeries(closes, 0), RangeError);
  });

  it("matches exact Wilder's Smoothing ((PrevAvg * 13 + Current) / 14) and preserves index alignment across null/NaN", () => {
    const baseCloses = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03,
    ];
    // Prepend 2 warm-up null/NaN entries; indices must shift by +2 and never be spliced out
    const paddedCloses: NumericInput[] = [null, Number.NaN, ...baseCloses];
    const series = calculateWilderRsiSeries(paddedCloses, 14);

    assert.equal(series.length, paddedCloses.length);
    for (let i = 0; i < 16; i++) {
      assert.equal(series[i], null);
    }

    let initGains = 0;
    let initLosses = 0;
    for (let i = 1; i <= 14; i++) {
      const diff = baseCloses[i] - baseCloses[i - 1];
      if (diff > 0) initGains += diff;
      else if (diff < 0) initLosses += Math.abs(diff);
    }
    let avgGain = initGains / 14;
    let avgLoss = initLosses / 14;
    assertClose(series[16], 100 - 100 / (1 + avgGain / avgLoss), 1e-7);

    avgGain = (avgGain * 13 + 0) / 14;
    avgLoss = (avgLoss * 13 + 0.28) / 14;
    assertClose(series[17], 100 - 100 / (1 + avgGain / avgLoss), 1e-7);

    avgGain = (avgGain * 13 + 0.03) / 14;
    avgLoss = (avgLoss * 13 + 0) / 14;
    const expectedLast = 100 - 100 / (1 + avgGain / avgLoss);
    assertClose(series[18], expectedLast, 1e-7);
    assertClose(calculateLatestWilderRsi(paddedCloses, 14), expectedLast, 1e-7);
  });

  it('handles monotonic uptrends (100), monotonic downtrends (0), and flat series (50)', () => {
    const up = Array.from({ length: 16 }, (_, i) => 100 + i);
    const down = Array.from({ length: 16 }, (_, i) => 200 - i);
    const flat = new Array(16).fill(150);

    assert.equal(calculateLatestWilderRsi(up, 14), 100);
    assert.equal(calculateLatestWilderRsi(down, 14), 0);
    assert.equal(calculateLatestWilderRsi(flat, 14), 50);
  });
});

describe('RVOL (Relative Volume) - 21-point guard clause & NaN/Infinity prevention', () => {
  it('returns null (never 0 or Infinity) when historical volume array length is < 21', () => {
    const volumes20 = new Array(20).fill(100_000);
    assert.equal(calculateLatestRvol(volumes20), null);
    assert.equal(calculateLatestRvol([]), null);

    const series20 = calculateRvolSeries(volumes20);
    assert.equal(series20.length, 20);
    assert.ok(series20.every((v) => v === null));
  });

  it('computes exact RVOL once 21 data points exist and keeps 20 warm-up indices as null', () => {
    // 20 prior bars of 100,000 + current bar of 250,000 -> RVOL = 2.5x
    const volumes = [...new Array(20).fill(100_000), 250_000, 150_000];
    const series = calculateRvolSeries(volumes, 20);

    assert.equal(series.length, 22);
    for (let i = 0; i < 20; i++) {
      assert.equal(series[i], null);
    }
    assertClose(series[20], 2.5);

    // Index 21: prior 20 bars = 19 * 100,000 + 250,000 = 2,150,000 -> avg = 107,500
    const expected21 = 150_000 / 107_500;
    assertClose(series[21], expected21);
    assertClose(calculateLatestRvol(volumes, 20), expected21);
  });

  it('returns null instead of Infinity, 0, or NaN when baseline average is 0 or inputs contain null/NaN', () => {
    const zeroBaseline = [...new Array(20).fill(0), 50_000];
    assert.equal(calculateLatestRvol(zeroBaseline), null);
    assert.equal(calculateRvolSeries(zeroBaseline)[20], null);

    const zeroCurrent = [...new Array(20).fill(100_000), 0];
    assert.equal(calculateLatestRvol(zeroCurrent), null);

    const withNaN = [...new Array(19).fill(100_000), Number.NaN, 200_000];
    assert.equal(calculateLatestRvol(withNaN), null);

    const withNull = [...new Array(19).fill(100_000), null, 200_000];
    assert.equal(calculateLatestRvol(withNull), null);
  });
});
