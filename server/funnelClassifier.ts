import type { DeliveryCategory, RvolBand, ScreenerRow, SwingTier } from '../src/types/trading.ts';

export interface SwingTierCriteriaInput {
  readonly avgTurnover20DCr: number | null;
  readonly liquidityPass?: boolean;
  readonly deliveryCategory: DeliveryCategory;
  readonly aboveEma21: boolean | null;
  readonly delivQtyRatio: number | null;
  readonly rvol: number | null;
  readonly rvolBand?: RvolBand;
  readonly changePct: number | null;
  readonly rsi14: number | null;
}

export interface FunnelCounts {
  readonly universeMainboard: number;
  readonly tier1ReadyCount: number;
  readonly tier2AccumulationCount: number;
  readonly tier3RvolWatchCount: number;
  readonly tieredWatchlistCount: number;
  readonly noneCount: number;
}

export interface FunnelTierBuckets<T> {
  readonly tier1: T[];
  readonly tier2: T[];
  readonly tier3: T[];
  readonly none: T[];
}

function assertNeverTier(value: never): never {
  throw new Error(`Unhandled SwingTier value: ${String(value)}`);
}

export function isDeliveryABCategory(category: DeliveryCategory): boolean {
  return category === 'A_AND_B' || category === 'A_ONLY' || category === 'B_ONLY';
}

/**
 * Evaluates the Filter Funnel tier strictly in priority order: T1 -> T2 -> T3 -> NONE.
 * Mutual exclusivity is guaranteed via `if (isT1) ... else if (isT2) ... else if (isT3)`:
 * each stock appears in at most one tier.
 *
 * 1. T1 (TIER_1_READY):
 *    20D Turnover >= 1.5 Cr AND Delivery A/B AND Price > EMA21 AND DelivQty Ratio >= 1.20
 *    AND RVOL > 1.50 AND EOD Change > 0 AND RSI(14) between 45 and 78.
 * 2. T2 (TIER_2_ACCUMULATION):
 *    Meets all T1 criteria EXCEPT RVOL, Green Candle, and RSI:
 *    20D Turnover >= 1.5 Cr AND Delivery A/B AND Price > EMA21 AND DelivQty Ratio >= 1.20.
 * 3. T3 (TIER_3_RVOL_WATCH):
 *    Meets 20D Turnover >= 1.5 Cr AND RVOL > 1.50 AND Green Candle,
 *    but fails Delivery A/B or fails Price > EMA21.
 */
export function classifySwingTier(input: SwingTierCriteriaInput): SwingTier {
  const hasLiquidTurnover =
    typeof input.avgTurnover20DCr === 'number' &&
    Number.isFinite(input.avgTurnover20DCr) &&
    input.avgTurnover20DCr >= 1.5 &&
    input.liquidityPass !== false;

  if (!hasLiquidTurnover) {
    return 'NONE';
  }

  const hasDeliveryAB = isDeliveryABCategory(input.deliveryCategory);
  const isAboveEma21 = input.aboveEma21 === true;
  const hasDelivQtyExpansion =
    typeof input.delivQtyRatio === 'number' &&
    Number.isFinite(input.delivQtyRatio) &&
    input.delivQtyRatio >= 1.2;

  const hasHighRvol =
    typeof input.rvol === 'number' && Number.isFinite(input.rvol)
      ? input.rvol > 1.5
      : input.rvolBand === 'HIGH';

  const isGreenCandle =
    typeof input.changePct === 'number' &&
    Number.isFinite(input.changePct) &&
    input.changePct > 0;

  const isRsiInZone =
    typeof input.rsi14 === 'number' &&
    Number.isFinite(input.rsi14) &&
    input.rsi14 >= 45 &&
    input.rsi14 <= 78;

  const isT1 =
    hasDeliveryAB &&
    isAboveEma21 &&
    hasDelivQtyExpansion &&
    hasHighRvol &&
    isGreenCandle &&
    isRsiInZone;

  const isT2 = hasDeliveryAB && isAboveEma21 && hasDelivQtyExpansion;

  const isT3 = hasHighRvol && isGreenCandle && (!hasDeliveryAB || !isAboveEma21);

  if (isT1) {
    return 'TIER_1_READY';
  } else if (isT2) {
    return 'TIER_2_ACCUMULATION';
  } else if (isT3) {
    return 'TIER_3_RVOL_WATCH';
  }

  return 'NONE';
}

function deduplicateBySymbol<T extends { symbol?: string }>(rows: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (typeof row.symbol === 'string' && row.symbol.length > 0) {
      const key = row.symbol.trim().toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    unique.push(row);
  }
  return unique;
}

/**
 * Buckets rows into mutually exclusive T1 / T2 / T3 / NONE groups using `classifySwingTier`.
 * If rows carry a `symbol`, duplicates are excluded so no stock can appear in more than one tier.
 */
export function partitionFunnelTiers<T extends SwingTierCriteriaInput & { symbol?: string }>(
  rows: ReadonlyArray<T>
): FunnelTierBuckets<T> {
  const tier1: T[] = [];
  const tier2: T[] = [];
  const tier3: T[] = [];
  const none: T[] = [];

  for (const row of deduplicateBySymbol(rows)) {
    const tier = classifySwingTier(row);
    if (tier === 'TIER_1_READY') {
      tier1.push(row);
    } else if (tier === 'TIER_2_ACCUMULATION') {
      tier2.push(row);
    } else if (tier === 'TIER_3_RVOL_WATCH') {
      tier3.push(row);
    } else if (tier === 'NONE') {
      none.push(row);
    } else {
      assertNeverTier(tier);
    }
  }

  return { tier1, tier2, tier3, none };
}

/**
 * Computes mutually exclusive Filter Funnel tier counts from classified screener rows.
 * Guarantees `tieredWatchlistCount === tier1ReadyCount + tier2AccumulationCount + tier3RvolWatchCount`
 * and deduplicates by `symbol` when provided.
 */
export function computeFunnelTierCounts(
  rows: ReadonlyArray<Pick<ScreenerRow, 'swingTier'> & { symbol?: string }>
): FunnelCounts {
  let tier1ReadyCount = 0;
  let tier2AccumulationCount = 0;
  let tier3RvolWatchCount = 0;
  let noneCount = 0;

  const uniqueRows = deduplicateBySymbol(rows);

  for (const row of uniqueRows) {
    const tier: SwingTier = row.swingTier;
    if (tier === 'TIER_1_READY') {
      tier1ReadyCount++;
    } else if (tier === 'TIER_2_ACCUMULATION') {
      tier2AccumulationCount++;
    } else if (tier === 'TIER_3_RVOL_WATCH') {
      tier3RvolWatchCount++;
    } else if (tier === 'NONE') {
      noneCount++;
    } else {
      assertNeverTier(tier);
    }
  }

  const tieredWatchlistCount =
    tier1ReadyCount + tier2AccumulationCount + tier3RvolWatchCount;

  return {
    universeMainboard: uniqueRows.length,
    tier1ReadyCount,
    tier2AccumulationCount,
    tier3RvolWatchCount,
    tieredWatchlistCount,
    noneCount,
  };
}

export type SequentialFunnelRowInput = Pick<
  ScreenerRow,
  'deliveryCategory' | 'liquidityPass' | 'liquidityTier' | 'rvolBand' | 'swingTier'
> & { readonly symbol?: string };

export interface SequentialFunnelMetrics {
  readonly universeMainboard: number;
  readonly deliveryAorBUnion: number;
  readonly deliveryAAndB: number;
  readonly deliveryAOnly: number;
  readonly deliveryBOnly: number;
  readonly liquidityPassInUnion: number;
  readonly liquidityBelowMinInUnion: number;
  readonly rvolHighInLiquidUnion: number;
  readonly rvolLowInLiquidUnion: number;
  readonly rvolWaitInLiquidUnion: number;
  readonly sequentialTieredCount: number;
  readonly sequentialTier1Count: number;
  readonly sequentialTier2Count: number;
  readonly sequentialTier3Count: number;
  readonly tier1ReadyCount: number;
  readonly tier2AccumulationCount: number;
  readonly tier3RvolWatchCount: number;
  readonly tieredWatchlistCount: number;
}

/**
 * Evaluates the 5-step Selection Funnel using a strict sequential `.filter()` chain:
 * universe -> .filter(deliveryAorB) -> .filter(liquidity >= 1.5Cr) -> .filter(rvol > 1.5) -> .filter(tierLogic)
 *
 * Guarantees monotonic subset invariants:
 * step1 >= step2 >= step3 >= step4 >= step5.
 * Also exposes overall universe-wide Watchlist counts (`tieredWatchlistCount === T1 + T2 + T3`).
 */
export function computeSequentialFunnelMetrics(
  rows: ReadonlyArray<SequentialFunnelRowInput>
): SequentialFunnelMetrics {
  // Step 1: Mainboard Universe (deduplicated by symbol when provided)
  const step1Universe = deduplicateBySymbol(rows);

  // Step 2: 30-Day Delivery A/B Union
  const step2DeliveryAB = step1Universe.filter((r) =>
    isDeliveryABCategory(r.deliveryCategory)
  );

  // Step 3: 20-Session Liquidity Gate (>= 1.5 Cr) within Step 2
  const step3Liquidity = step2DeliveryAB.filter((r) => r.liquidityPass === true);

  // Step 4: RVOL > 1.5x (HIGH) strictly within Step 3
  const step4Rvol = step3Liquidity.filter((r) => r.rvolBand === 'HIGH');

  // Step 5: Tiered Watchlist (T1/T2/T3) strictly within Step 4
  const step5Tiered = step4Rvol.filter((r) => r.swingTier !== 'NONE');
  const stage5TierCounts = computeFunnelTierCounts(step5Tiered);

  // Overall universe-wide mutually exclusive Watchlist counts (T1 + T2 + T3)
  const universeTierCounts = computeFunnelTierCounts(step1Universe);

  return {
    universeMainboard: step1Universe.length,
    deliveryAorBUnion: step2DeliveryAB.length,
    deliveryAAndB: step2DeliveryAB.filter((r) => r.deliveryCategory === 'A_AND_B').length,
    deliveryAOnly: step2DeliveryAB.filter((r) => r.deliveryCategory === 'A_ONLY').length,
    deliveryBOnly: step2DeliveryAB.filter((r) => r.deliveryCategory === 'B_ONLY').length,
    liquidityPassInUnion: step3Liquidity.length,
    liquidityBelowMinInUnion: step2DeliveryAB.filter(
      (r) => r.liquidityTier === 'BELOW_MIN'
    ).length,
    rvolHighInLiquidUnion: step4Rvol.length,
    rvolLowInLiquidUnion: step3Liquidity.filter((r) => r.rvolBand === 'LOW').length,
    rvolWaitInLiquidUnion: step3Liquidity.filter(
      (r) => r.rvolBand === 'WAIT_FOR_DATA'
    ).length,
    sequentialTieredCount: stage5TierCounts.tieredWatchlistCount,
    sequentialTier1Count: stage5TierCounts.tier1ReadyCount,
    sequentialTier2Count: stage5TierCounts.tier2AccumulationCount,
    sequentialTier3Count: stage5TierCounts.tier3RvolWatchCount,
    tier1ReadyCount: universeTierCounts.tier1ReadyCount,
    tier2AccumulationCount: universeTierCounts.tier2AccumulationCount,
    tier3RvolWatchCount: universeTierCounts.tier3RvolWatchCount,
    tieredWatchlistCount: universeTierCounts.tieredWatchlistCount,
  };
}
