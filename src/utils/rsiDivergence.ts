export type RsiDivergenceKind =
  | 'REGULAR_BULLISH'
  | 'REGULAR_BEARISH'
  | 'HIDDEN_BULLISH'
  | 'HIDDEN_BEARISH';

export type RsiDivergencePolarity = 'BULLISH' | 'BEARISH';
export type RsiDivergenceCategory = 'REGULAR' | 'HIDDEN';

export interface RsiDivergenceInputBar {
  readonly date: string;
  readonly high?: number | null;
  readonly low?: number | null;
  readonly close: number | null;
  readonly rsi14?: number | null;
}

export interface RsiDivergencePivot {
  readonly index: number;
  readonly date: string;
  readonly price: number;
  readonly closePrice: number;
  readonly rsi: number;
}

export interface RsiDivergenceSignal {
  readonly id: string;
  readonly kind: RsiDivergenceKind;
  readonly polarity: RsiDivergencePolarity;
  readonly category: RsiDivergenceCategory;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly from: RsiDivergencePivot;
  readonly to: RsiDivergencePivot;
  readonly priceDeltaPct: number;
  readonly rsiDelta: number;
  readonly barsApart: number;
  readonly barsSinceEnd: number;
  readonly isRecent: boolean;
  readonly strength: 'STRONG' | 'MODERATE';
}

export interface RsiDivergenceAnalysis {
  readonly rsiSeries: Array<number | null>;
  readonly latestRsi: number | null;
  readonly swingHighs: RsiDivergencePivot[];
  readonly swingLows: RsiDivergencePivot[];
  readonly divergences: RsiDivergenceSignal[];
  readonly latestDivergence: RsiDivergenceSignal | null;
  readonly activeBullish: RsiDivergenceSignal | null;
  readonly activeBearish: RsiDivergenceSignal | null;
  readonly insufficientData: boolean;
}

export interface RsiDivergenceOptions {
  readonly rsiPeriod?: number;
  readonly leftBars?: number;
  readonly rightBars?: number;
  readonly minBarsApart?: number;
  readonly maxBarsApart?: number;
  readonly minPriceMovePct?: number;
  readonly minRsiDelta?: number;
  readonly recentBarsThreshold?: number;
  readonly includeHidden?: boolean;
}

function isFiniteNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Computes Wilder's Smoothed RSI series preserving exact 1:1 index alignment
 * with the input closes array (null during warm-up and missing bars).
 */
export function computeWilderRsiAligned(
  closes: ReadonlyArray<number | null | undefined>,
  period = 14
): Array<number | null> {
  const out: Array<number | null> = new Array<number | null>(closes.length).fill(null);
  if (period < 1 || closes.length <= period) return out;

  const prevWeight = period - 1;
  let lastValidClose: number | null = null;
  let gainSum = 0;
  let lossSum = 0;
  let diffCount = 0;
  let avgGain: number | null = null;
  let avgLoss: number | null = null;

  for (let i = 0; i < closes.length; i++) {
    const curr = closes[i];
    if (!isFiniteNum(curr)) continue;

    if (lastValidClose === null) {
      lastValidClose = curr;
      continue;
    }

    const delta = curr - lastValidClose;
    lastValidClose = curr;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    if (avgGain === null || avgLoss === null) {
      gainSum += gain;
      lossSum += loss;
      diffCount++;

      if (diffCount === period) {
        avgGain = gainSum / period;
        avgLoss = lossSum / period;
        if (avgGain === 0 && avgLoss === 0) out[i] = 50;
        else if (avgLoss === 0) out[i] = 100;
        else if (avgGain === 0) out[i] = 0;
        else out[i] = Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
      }
    } else {
      avgGain = (avgGain * prevWeight + gain) / period;
      avgLoss = (avgLoss * prevWeight + loss) / period;
      if (avgGain === 0 && avgLoss === 0) out[i] = 50;
      else if (avgLoss === 0) out[i] = 100;
      else if (avgGain === 0) out[i] = 0;
      else out[i] = Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
    }
  }

  return out;
}

function getSwingHighPrice(bar: RsiDivergenceInputBar): number | null {
  if (isFiniteNum(bar.high) && bar.high > 0) return bar.high;
  if (isFiniteNum(bar.close) && bar.close > 0) return bar.close;
  return null;
}

function getSwingLowPrice(bar: RsiDivergenceInputBar): number | null {
  if (isFiniteNum(bar.low) && bar.low > 0) return bar.low;
  if (isFiniteNum(bar.close) && bar.close > 0) return bar.close;
  return null;
}

/**
 * Automated RSI Divergence Detection Engine:
 * - Regular Bearish Divergence: Price makes Higher High while RSI makes Lower High
 * - Regular Bullish Divergence: Price makes Lower Low while RSI makes Higher Low
 * - Hidden Bullish Divergence: Price makes Higher Low while RSI makes Lower Low
 * - Hidden Bearish Divergence: Price makes Lower High while RSI makes Higher High
 */
export function detectRsiDivergences(
  history: ReadonlyArray<RsiDivergenceInputBar>,
  options: RsiDivergenceOptions = {}
): RsiDivergenceAnalysis {
  const rsiPeriod = options.rsiPeriod ?? 14;
  const leftBars = options.leftBars ?? 3;
  const rightBars = options.rightBars ?? 2;
  const minBarsApart = options.minBarsApart ?? 4;
  const maxBarsApart = options.maxBarsApart ?? 65;
  const minPriceMovePct = options.minPriceMovePct ?? 0.25;
  const minRsiDelta = options.minRsiDelta ?? 1.5;
  const recentBarsThreshold = options.recentBarsThreshold ?? 10;
  const includeHidden = options.includeHidden ?? true;

  if (!history || history.length === 0) {
    return {
      rsiSeries: [],
      latestRsi: null,
      swingHighs: [],
      swingLows: [],
      divergences: [],
      latestDivergence: null,
      activeBullish: null,
      activeBearish: null,
      insufficientData: true,
    };
  }

  const hasPrecomputedRsi = history.some((b) => isFiniteNum(b.rsi14));
  const computedRsi = computeWilderRsiAligned(
    history.map((b) => b.close),
    rsiPeriod
  );
  const rsiSeries = history.map((b, i) => {
    if (hasPrecomputedRsi && isFiniteNum(b.rsi14)) return b.rsi14;
    if (hasPrecomputedRsi && b.rsi14 === null) return null;
    return computedRsi[i] ?? null;
  });

  let latestRsi: number | null = null;
  for (let i = rsiSeries.length - 1; i >= 0; i--) {
    const val = rsiSeries[i];
    if (isFiniteNum(val)) {
      latestRsi = val;
      break;
    }
  }

  const validRsiCount = rsiSeries.filter((v): v is number => isFiniteNum(v)).length;
  if (validRsiCount < leftBars + rightBars + minBarsApart) {
    return {
      rsiSeries,
      latestRsi,
      swingHighs: [],
      swingLows: [],
      divergences: [],
      latestDivergence: null,
      activeBullish: null,
      activeBearish: null,
      insufficientData: true,
    };
  }

  const swingHighs: RsiDivergencePivot[] = [];
  const swingLows: RsiDivergencePivot[] = [];

  for (let i = leftBars; i <= history.length - 1 - rightBars; i++) {
    const rsi = rsiSeries[i];
    const bar = history[i];
    if (!isFiniteNum(rsi) || !isFiniteNum(bar.close)) continue;

    const hiPrice = getSwingHighPrice(bar);
    if (hiPrice !== null) {
      let isPeak = true;
      let strictlyHigherCount = 0;
      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (j === i) continue;
        const neighborHi = getSwingHighPrice(history[j]);
        if (neighborHi === null) {
          isPeak = false;
          break;
        }
        // Strict tie-break on right side prevents duplicate adjacent flat peaks
        if (j > i && neighborHi >= hiPrice) {
          isPeak = false;
          break;
        }
        if (j < i && neighborHi > hiPrice) {
          isPeak = false;
          break;
        }
        if (hiPrice > neighborHi) strictlyHigherCount++;
      }
      if (isPeak && strictlyHigherCount >= 2) {
        swingHighs.push({
          index: i,
          date: bar.date,
          price: Number(hiPrice.toFixed(2)),
          closePrice: Number(bar.close.toFixed(2)),
          rsi: Number(rsi.toFixed(2)),
        });
      }
    }

    const loPrice = getSwingLowPrice(bar);
    if (loPrice !== null) {
      let isTrough = true;
      let strictlyLowerCount = 0;
      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (j === i) continue;
        const neighborLo = getSwingLowPrice(history[j]);
        if (neighborLo === null) {
          isTrough = false;
          break;
        }
        if (j > i && neighborLo <= loPrice) {
          isTrough = false;
          break;
        }
        if (j < i && neighborLo < loPrice) {
          isTrough = false;
          break;
        }
        if (loPrice < neighborLo) strictlyLowerCount++;
      }
      if (isTrough && strictlyLowerCount >= 2) {
        swingLows.push({
          index: i,
          date: bar.date,
          price: Number(loPrice.toFixed(2)),
          closePrice: Number(bar.close.toFixed(2)),
          rsi: Number(rsi.toFixed(2)),
        });
      }
    }
  }

  const rawSignals: RsiDivergenceSignal[] = [];
  const lastIdx = history.length - 1;

  // Inspect Swing High pairs for Bearish Divergences (Regular Bearish & Hidden Bearish)
  for (let b = 1; b < swingHighs.length; b++) {
    const p2 = swingHighs[b];
    // Compare with up to 2 prior swing highs so intermediate minor peaks don't hide major divergences
    const startA = Math.max(0, b - 2);
    for (let a = b - 1; a >= startA; a--) {
      const p1 = swingHighs[a];
      const barsApart = p2.index - p1.index;
      if (barsApart < minBarsApart || barsApart > maxBarsApart) continue;

      const priceDeltaPct = ((p2.price - p1.price) / p1.price) * 100;
      const rsiDelta = p2.rsi - p1.rsi;
      const barsSinceEnd = lastIdx - p2.index;
      const isRecent = barsSinceEnd <= recentBarsThreshold;

      // Regular Bearish: Price Higher High + RSI Lower High
      if (priceDeltaPct >= minPriceMovePct && rsiDelta <= -minRsiDelta) {
        const strength =
          Math.abs(rsiDelta) >= 5 || p1.rsi >= 65 || p2.rsi >= 65 ? 'STRONG' : 'MODERATE';
        rawSignals.push({
          id: `REGULAR_BEARISH-${p1.index}-${p2.index}`,
          kind: 'REGULAR_BEARISH',
          polarity: 'BEARISH',
          category: 'REGULAR',
          label: 'Regular Bearish Divergence',
          shortLabel: 'Reg Bear Div',
          description: `Price made Higher High (₹${p1.price.toFixed(2)} → ₹${p2.price.toFixed(2)}, +${priceDeltaPct.toFixed(1)}%) while RSI(14) made Lower High (${p1.rsi.toFixed(1)} → ${p2.rsi.toFixed(1)}, ${rsiDelta.toFixed(1)}).`,
          from: p1,
          to: p2,
          priceDeltaPct: Number(priceDeltaPct.toFixed(2)),
          rsiDelta: Number(rsiDelta.toFixed(2)),
          barsApart,
          barsSinceEnd,
          isRecent,
          strength,
        });
      } else if (
        includeHidden &&
        priceDeltaPct <= -minPriceMovePct &&
        rsiDelta >= minRsiDelta
      ) {
        // Hidden Bearish: Price Lower High + RSI Higher High
        const strength = Math.abs(rsiDelta) >= 5 ? 'STRONG' : 'MODERATE';
        rawSignals.push({
          id: `HIDDEN_BEARISH-${p1.index}-${p2.index}`,
          kind: 'HIDDEN_BEARISH',
          polarity: 'BEARISH',
          category: 'HIDDEN',
          label: 'Hidden Bearish Divergence',
          shortLabel: 'Hid Bear Div',
          description: `Price made Lower High (₹${p1.price.toFixed(2)} → ₹${p2.price.toFixed(2)}, ${priceDeltaPct.toFixed(1)}%) while RSI(14) made Higher High (${p1.rsi.toFixed(1)} → ${p2.rsi.toFixed(1)}, +${rsiDelta.toFixed(1)}).`,
          from: p1,
          to: p2,
          priceDeltaPct: Number(priceDeltaPct.toFixed(2)),
          rsiDelta: Number(rsiDelta.toFixed(2)),
          barsApart,
          barsSinceEnd,
          isRecent,
          strength,
        });
      }
    }
  }

  // Inspect Swing Low pairs for Bullish Divergences (Regular Bullish & Hidden Bullish)
  for (let b = 1; b < swingLows.length; b++) {
    const p2 = swingLows[b];
    const startA = Math.max(0, b - 2);
    for (let a = b - 1; a >= startA; a--) {
      const p1 = swingLows[a];
      const barsApart = p2.index - p1.index;
      if (barsApart < minBarsApart || barsApart > maxBarsApart) continue;

      const priceDeltaPct = ((p2.price - p1.price) / p1.price) * 100;
      const rsiDelta = p2.rsi - p1.rsi;
      const barsSinceEnd = lastIdx - p2.index;
      const isRecent = barsSinceEnd <= recentBarsThreshold;

      // Regular Bullish: Price Lower Low + RSI Higher Low
      if (priceDeltaPct <= -minPriceMovePct && rsiDelta >= minRsiDelta) {
        const strength =
          Math.abs(rsiDelta) >= 5 || p1.rsi <= 35 || p2.rsi <= 35 ? 'STRONG' : 'MODERATE';
        rawSignals.push({
          id: `REGULAR_BULLISH-${p1.index}-${p2.index}`,
          kind: 'REGULAR_BULLISH',
          polarity: 'BULLISH',
          category: 'REGULAR',
          label: 'Regular Bullish Divergence',
          shortLabel: 'Reg Bull Div',
          description: `Price made Lower Low (₹${p1.price.toFixed(2)} → ₹${p2.price.toFixed(2)}, ${priceDeltaPct.toFixed(1)}%) while RSI(14) made Higher Low (${p1.rsi.toFixed(1)} → ${p2.rsi.toFixed(1)}, +${rsiDelta.toFixed(1)}).`,
          from: p1,
          to: p2,
          priceDeltaPct: Number(priceDeltaPct.toFixed(2)),
          rsiDelta: Number(rsiDelta.toFixed(2)),
          barsApart,
          barsSinceEnd,
          isRecent,
          strength,
        });
      } else if (
        includeHidden &&
        priceDeltaPct >= minPriceMovePct &&
        rsiDelta <= -minRsiDelta
      ) {
        // Hidden Bullish: Price Higher Low + RSI Lower Low
        const strength = Math.abs(rsiDelta) >= 5 ? 'STRONG' : 'MODERATE';
        rawSignals.push({
          id: `HIDDEN_BULLISH-${p1.index}-${p2.index}`,
          kind: 'HIDDEN_BULLISH',
          polarity: 'BULLISH',
          category: 'HIDDEN',
          label: 'Hidden Bullish Divergence',
          shortLabel: 'Hid Bull Div',
          description: `Price made Higher Low (₹${p1.price.toFixed(2)} → ₹${p2.price.toFixed(2)}, +${priceDeltaPct.toFixed(1)}%) while RSI(14) made Lower Low (${p1.rsi.toFixed(1)} → ${p2.rsi.toFixed(1)}, ${rsiDelta.toFixed(1)}).`,
          from: p1,
          to: p2,
          priceDeltaPct: Number(priceDeltaPct.toFixed(2)),
          rsiDelta: Number(rsiDelta.toFixed(2)),
          barsApart,
          barsSinceEnd,
          isRecent,
          strength,
        });
      }
    }
  }

  // Keep only the strongest signal per (kind, to.index) endpoint so chart & table stay crisp
  const dedupedByEnd = new Map<string, RsiDivergenceSignal>();
  for (const sig of rawSignals) {
    const key = `${sig.kind}:${sig.to.index}`;
    const existing = dedupedByEnd.get(key);
    if (!existing || Math.abs(sig.rsiDelta) > Math.abs(existing.rsiDelta)) {
      dedupedByEnd.set(key, sig);
    }
  }

  const divergences = Array.from(dedupedByEnd.values()).sort((a, b) => {
    if (b.to.index !== a.to.index) return b.to.index - a.to.index;
    if (a.category !== b.category) return a.category === 'REGULAR' ? -1 : 1;
    return Math.abs(b.rsiDelta) - Math.abs(a.rsiDelta);
  });

  const latestDivergence = divergences[0] ?? null;
  const activeBullish = divergences.find((d) => d.polarity === 'BULLISH' && d.isRecent) ?? null;
  const activeBearish = divergences.find((d) => d.polarity === 'BEARISH' && d.isRecent) ?? null;

  return {
    rsiSeries,
    latestRsi,
    swingHighs,
    swingLows,
    divergences,
    latestDivergence,
    activeBullish,
    activeBearish,
    insufficientData: false,
  };
}
