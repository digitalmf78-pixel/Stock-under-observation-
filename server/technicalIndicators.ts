export type EmaPeriod = 21 | 44 | 200 | number;
export type NumericInput = number | null | undefined;

export interface EmaRibbonSnapshot {
  readonly ema21: number | null;
  readonly ema44: number | null;
  readonly ema200: number | null;
}

export interface EmaRibbonSeries {
  readonly ema21: Array<number | null>;
  readonly ema44: Array<number | null>;
  readonly ema200: Array<number | null>;
}

function assertValidPeriod(period: number, indicatorName: string): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${indicatorName} period must be a positive integer, received ${period}`);
  }
}

function isFiniteNumber(value: NumericInput): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Calculates Simple Moving Average over the first `period` entries of `values`.
 * Returns `null` if insufficient entries or if any entry is `null`, `undefined`, or `NaN`.
 */
export function calculateSma(
  values: ReadonlyArray<NumericInput>,
  period: number
): number | null {
  assertValidPeriod(period, 'SMA');
  if (values.length < period) return null;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    const val = values[i];
    if (!isFiniteNumber(val)) return null;
    sum += val;
  }
  return sum / period;
}

/**
 * Calculates SMA-seeded Exponential Moving Average (EMA) series while strictly preserving
 * 1:1 index alignment with the input `closes` / date array.
 *
 * - Warm-up slots and any `null` / `undefined` / `NaN` positions stay `null` in place (never spliced/filtered).
 * - First EMA value (once `period` valid finite closes have accumulated) is the SMA of that window.
 * - Subsequent values use:
 *   `EMA = (Close - Previous EMA) * (2 / (Period + 1)) + Previous EMA`
 */
export function calculateEmaSeries(
  closes: ReadonlyArray<NumericInput>,
  period: EmaPeriod
): Array<number | null> {
  assertValidPeriod(period, 'EMA');
  const out: Array<number | null> = new Array<number | null>(closes.length).fill(null);
  if (closes.length < period) return out;

  const multiplier = 2 / (period + 1);
  let seedSum = 0;
  let validRunCount = 0;
  let prevEma: number | null = null;

  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    if (!isFiniteNumber(close)) {
      if (prevEma === null) {
        // Reset incomplete seed window before a valid SMA seed is established
        seedSum = 0;
        validRunCount = 0;
      }
      // Keep out[i] === null to maintain date/index alignment
      continue;
    }

    if (prevEma === null) {
      seedSum += close;
      validRunCount++;
      if (validRunCount === period) {
        prevEma = seedSum / period;
        out[i] = prevEma;
      }
    } else {
      const ema: number = (close - prevEma) * multiplier + prevEma;
      out[i] = ema;
      prevEma = ema;
    }
  }

  return out;
}

/**
 * Returns the latest SMA-seeded EMA value for the given period, or `null` if insufficient bars.
 */
export function calculateLatestEma(
  closes: ReadonlyArray<NumericInput>,
  period: EmaPeriod
): number | null {
  const series = calculateEmaSeries(closes, period);
  return series.length > 0 ? (series[series.length - 1] ?? null) : null;
}

/**
 * Computes full SMA-seeded EMA(21), EMA(44), and EMA(200) series in one reusable call.
 */
export function calculateEmaRibbonSeries(
  closes: ReadonlyArray<NumericInput>
): EmaRibbonSeries {
  return {
    ema21: calculateEmaSeries(closes, 21),
    ema44: calculateEmaSeries(closes, 44),
    ema200: calculateEmaSeries(closes, 200),
  };
}

/**
 * Computes latest EMA(21), EMA(44), and EMA(200) values for a close price array.
 */
export function calculateEmaRibbonLatest(
  closes: ReadonlyArray<NumericInput>
): EmaRibbonSnapshot {
  return {
    ema21: calculateLatestEma(closes, 21),
    ema44: calculateLatestEma(closes, 44),
    ema200: calculateLatestEma(closes, 200),
  };
}

function computeRsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculates Wilder's Smoothed Relative Strength Index (RSI) series while strictly preserving
 * 1:1 index alignment with the input `closes` / date array.
 *
 * - Warm-up slots and any `null` / `undefined` / `NaN` positions stay `null` in place (never spliced/filtered).
 * - Seed: arithmetic mean of the first `period` valid price changes.
 * - Subsequent values: Wilder's Smoothing:
 *   `AvgGain = (Previous AvgGain * (period - 1) + Current Gain) / period`
 *   `AvgLoss = (Previous AvgLoss * (period - 1) + Current Loss) / period`
 *   (For `period = 14`, `(Previous Avg * 13 + Current Gain/Loss) / 14`.)
 */
export function calculateWilderRsiSeries(
  closes: ReadonlyArray<NumericInput>,
  period = 14
): Array<number | null> {
  assertValidPeriod(period, 'RSI');
  const out: Array<number | null> = new Array<number | null>(closes.length).fill(null);
  if (closes.length <= period) return out;

  const prevWeight = period - 1;
  let lastValidClose: number | null = null;
  let gainSum = 0;
  let lossSum = 0;
  let diffCount = 0;
  let avgGain: number | null = null;
  let avgLoss: number | null = null;

  for (let i = 0; i < closes.length; i++) {
    const curr = closes[i];
    if (!isFiniteNumber(curr)) {
      // Keep out[i] === null to preserve index/date alignment
      continue;
    }

    if (lastValidClose === null) {
      lastValidClose = curr;
      continue;
    }

    const diff = curr - lastValidClose;
    lastValidClose = curr;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    if (avgGain === null || avgLoss === null) {
      gainSum += currentGain;
      lossSum += currentLoss;
      diffCount++;
      if (diffCount === period) {
        avgGain = gainSum / period;
        avgLoss = lossSum / period;
        out[i] = computeRsiFromAverages(avgGain, avgLoss);
      }
    } else {
      avgGain = (avgGain * prevWeight + currentGain) / period;
      avgLoss = (avgLoss * prevWeight + currentLoss) / period;
      out[i] = computeRsiFromAverages(avgGain, avgLoss);
    }
  }

  return out;
}

/**
 * Returns the latest Wilder's Smoothed RSI value (default period 14), or `null` if insufficient bars.
 */
export function calculateLatestWilderRsi(
  closes: ReadonlyArray<NumericInput>,
  period = 14
): number | null {
  const series = calculateWilderRsiSeries(closes, period);
  return series.length > 0 ? (series[series.length - 1] ?? null) : null;
}

/**
 * Calculates Relative Volume (RVOL) for the latest bar in `volumes`.
 *
 * Guard clause: requires at least `lookback + 1` data points (21 by default: 20-day baseline + 1 current day).
 * Never returns `0` (on invalid data) or `Infinity` (on zero baseline volume); returns `null` instead.
 */
export function calculateLatestRvol(
  volumes: ReadonlyArray<NumericInput>,
  lookback = 20
): number | null {
  assertValidPeriod(lookback, 'RVOL');
  const minRequiredPoints = lookback + 1; // 21 for 20-day average + 1 current day
  if (volumes.length < minRequiredPoints) return null;

  const currentIdx = volumes.length - 1;
  const currentVol = volumes[currentIdx];
  if (!isFiniteNumber(currentVol) || currentVol <= 0) return null;

  let priorSum = 0;
  for (let i = currentIdx - lookback; i < currentIdx; i++) {
    const v = volumes[i];
    if (!isFiniteNumber(v) || v < 0) return null;
    priorSum += v;
  }

  const avgVol = priorSum / lookback;
  if (!Number.isFinite(avgVol) || avgVol <= 0) return null;

  const rvol = currentVol / avgVol;
  return Number.isFinite(rvol) ? rvol : null;
}

/**
 * Calculates an index-aligned Relative Volume (RVOL) series matching the exact length of `volumes`.
 *
 * - Guard clause: if `volumes.length < lookback + 1` (21 by default), returns all `null`s.
 * - Warm-up slots (`0 .. lookback - 1`) and invalid/zero-average bars stay `null` in place (never spliced).
 */
export function calculateRvolSeries(
  volumes: ReadonlyArray<NumericInput>,
  lookback = 20
): Array<number | null> {
  assertValidPeriod(lookback, 'RVOL');
  const out: Array<number | null> = new Array<number | null>(volumes.length).fill(null);
  const minRequiredPoints = lookback + 1; // 21 for 20-day average + 1 current day
  if (volumes.length < minRequiredPoints) return out;

  for (let i = lookback; i < volumes.length; i++) {
    const currentVol = volumes[i];
    if (!isFiniteNumber(currentVol) || currentVol <= 0) continue;

    let priorSum = 0;
    let validWindow = true;
    for (let j = i - lookback; j < i; j++) {
      const priorVol = volumes[j];
      if (!isFiniteNumber(priorVol) || priorVol < 0) {
        validWindow = false;
        break;
      }
      priorSum += priorVol;
    }

    if (!validWindow) continue;
    const avgVol = priorSum / lookback;
    if (!Number.isFinite(avgVol) || avgVol <= 0) continue;

    const rvol = currentVol / avgVol;
    if (Number.isFinite(rvol)) {
      out[i] = rvol;
    }
  }

  return out;
}
