import type { ScreenerRow } from '../src/types/trading.ts';

export type BreadthInputRow = Pick<
  ScreenerRow,
  | 'changePct'
  | 'aboveEma21'
  | 'aboveEma44'
  | 'aboveEma200'
  | 'ema21AboveEma44'
  | 'ema21Cross44Bullish'
> & {
  symbol?: string;
};

export interface MarketBreadthMetrics {
  totalValidStocks: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  breadthPct: number;
  aboveEma21Count: number;
  ema21EligibleCount: number;
  aboveEma21Pct: number;
  aboveEma44Count: number;
  ema44EligibleCount: number;
  aboveEma44Pct: number;
  aboveEma200Count: number;
  ema200SampleCount: number;
  aboveEma200Pct: number | null;
  aboveEma21And44Count: number;
  ema21And44EligibleCount: number;
  aboveEma21And44Pct: number;
  emaCrossBullishCount: number;
}

export interface SectorBreadthMetrics extends MarketBreadthMetrics {
  ema21Above44Pct: number;
  emaTrendCompositePct: number;
}

/**
 * Deduplicates input stock rows by normalized uppercase `symbol` when provided.
 * Rows without a `symbol` (e.g. synthetic anonymous test rows) are preserved as distinct entries.
 */
export function deduplicateBreadthRows<T extends BreadthInputRow>(
  rows: ReadonlyArray<T>
): T[] {
  const seenSymbols = new Set<string>();
  const uniqueRows: T[] = [];

  for (const row of rows) {
    if (typeof row.symbol === 'string') {
      const normalized = row.symbol.trim().toUpperCase();
      if (normalized.length > 0) {
        if (seenSymbols.has(normalized)) continue;
        seenSymbols.add(normalized);
      }
    }
    uniqueRows.push(row);
  }

  return uniqueRows;
}

export function calculatePercentage(numerator: number, totalEligible: number): number {
  if (totalEligible <= 0 || !Number.isFinite(totalEligible) || !Number.isFinite(numerator)) {
    return 0;
  }
  const boundedNumerator = Math.min(Math.max(0, numerator), totalEligible);
  const pct = (boundedNumerator / totalEligible) * 100;
  return Number(Math.min(100, Math.max(0, pct)).toFixed(1));
}

export function calculateMarketBreadth(
  rows: ReadonlyArray<BreadthInputRow>
): MarketBreadthMetrics {
  const uniqueRows = deduplicateBreadthRows(rows);
  const totalValidStocks = uniqueRows.length;

  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let emaCrossBullishCount = 0;

  for (const r of uniqueRows) {
    const chg = r.changePct;
    if (typeof chg === 'number' && Number.isFinite(chg)) {
      if (chg > 0.05) advancers++;
      else if (chg < -0.05) decliners++;
      else unchanged++;
    } else {
      unchanged++;
    }

    if (r.ema21Cross44Bullish === true) {
      emaCrossBullishCount++;
    }
  }

  // Compute each EMA numerator strictly as a filtered subset of its eligible rows array
  // so numerator can NEVER exceed denominator or totalValidStocks.
  const ema21EligibleRows = uniqueRows.filter((r) => typeof r.aboveEma21 === 'boolean');
  const ema21EligibleCount = ema21EligibleRows.length;
  const aboveEma21Count = Math.min(
    ema21EligibleRows.filter((r) => r.aboveEma21 === true).length,
    ema21EligibleCount
  );

  const ema44EligibleRows = uniqueRows.filter((r) => typeof r.aboveEma44 === 'boolean');
  const ema44EligibleCount = ema44EligibleRows.length;
  const aboveEma44Count = Math.min(
    ema44EligibleRows.filter((r) => r.aboveEma44 === true).length,
    ema44EligibleCount
  );

  const ema200EligibleRows = uniqueRows.filter((r) => typeof r.aboveEma200 === 'boolean');
  const ema200SampleCount = ema200EligibleRows.length;
  const aboveEma200Count = Math.min(
    ema200EligibleRows.filter((r) => r.aboveEma200 === true).length,
    ema200SampleCount
  );

  const ema21And44EligibleRows = uniqueRows.filter((r) => typeof r.ema21AboveEma44 === 'boolean');
  const ema21And44EligibleCount = ema21And44EligibleRows.length;
  const aboveEma21And44Count = Math.min(
    ema21And44EligibleRows.filter((r) => r.ema21AboveEma44 === true).length,
    ema21And44EligibleCount
  );

  emaCrossBullishCount = Math.min(emaCrossBullishCount, totalValidStocks);

  const adTotal = Math.min(advancers + decliners, totalValidStocks);
  const safeAdvancers = Math.min(advancers, adTotal);
  const safeDecliners = Math.min(decliners, adTotal);
  const breadthPct = adTotal > 0 ? calculatePercentage(safeAdvancers, adTotal) : 0;

  // Formula: (Stocks Above EMA / Total Eligible Stocks) * 100
  const aboveEma21Pct = calculatePercentage(aboveEma21Count, ema21EligibleCount);
  const aboveEma44Pct = calculatePercentage(aboveEma44Count, ema44EligibleCount);
  const aboveEma200Pct =
    ema200SampleCount > 0 ? calculatePercentage(aboveEma200Count, ema200SampleCount) : null;
  const aboveEma21And44Pct = calculatePercentage(
    aboveEma21And44Count,
    ema21And44EligibleCount
  );

  return {
    totalValidStocks,
    advancers: safeAdvancers,
    decliners: safeDecliners,
    unchanged,
    breadthPct,
    aboveEma21Count,
    ema21EligibleCount,
    aboveEma21Pct,
    aboveEma44Count,
    ema44EligibleCount,
    aboveEma44Pct,
    aboveEma200Count,
    ema200SampleCount,
    aboveEma200Pct,
    aboveEma21And44Count,
    ema21And44EligibleCount,
    aboveEma21And44Pct,
    emaCrossBullishCount,
  };
}

export function calculateSectorBreadth(
  rows: ReadonlyArray<BreadthInputRow>
): SectorBreadthMetrics {
  const base = calculateMarketBreadth(rows);
  const ema21Above44Pct = base.aboveEma21And44Pct;

  const emaParts = [base.aboveEma21Pct, base.aboveEma44Pct, ema21Above44Pct];
  if (base.aboveEma200Pct !== null) {
    emaParts.push(base.aboveEma200Pct);
  }
  const emaTrendCompositePct = Number(
    (emaParts.reduce((sum, val) => sum + val, 0) / Math.max(1, emaParts.length)).toFixed(1)
  );

  return {
    ...base,
    ema21Above44Pct,
    emaTrendCompositePct,
  };
}

export interface SectorDeliveryTrendMetrics {
  readonly delivery30dAvg: number;
  readonly delivery5dAvg: number;
  readonly deliveryShiftPp: number;
}

/**
 * Computes 30-session average delivery %, recent 5-session average delivery %,
 * and shift percentage points strictly as `5D Avg - 30D Avg` so the shift always
 * matches the displayed 30D Avg and 5D Avg values on the sector card.
 */
export function calculateSectorDeliveryTrendMetrics(
  deliveryTrend30d: ReadonlyArray<{ avgDeliveryPct: number }>,
  fallbackDeliveryAvg: number
): SectorDeliveryTrendMetrics {
  const safeFallback = Number.isFinite(fallbackDeliveryAvg)
    ? Number(fallbackDeliveryAvg.toFixed(1))
    : 0;

  const delivery30dAvg =
    deliveryTrend30d.length > 0
      ? Number(
          (
            deliveryTrend30d.reduce((acc, p) => acc + p.avgDeliveryPct, 0) /
            deliveryTrend30d.length
          ).toFixed(1)
        )
      : safeFallback;

  const recentSlice = deliveryTrend30d.slice(-Math.min(5, deliveryTrend30d.length));
  const delivery5dAvg =
    recentSlice.length > 0
      ? Number(
          (
            recentSlice.reduce((acc, p) => acc + p.avgDeliveryPct, 0) /
            recentSlice.length
          ).toFixed(1)
        )
      : delivery30dAvg;

  const deliveryShiftPp = Number((delivery5dAvg - delivery30dAvg).toFixed(1));

  return {
    delivery30dAvg,
    delivery5dAvg,
    deliveryShiftPp,
  };
}
