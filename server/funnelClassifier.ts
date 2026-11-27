import type { DeliveryCategory, RvolBand, ScreenerRow, SwingTier } from '../src/types/trading.ts';

export interface DeliverySequenceValidationInput {
  readonly deliveryCategory: DeliveryCategory;
  /** Validated maximum consecutive qualifying rolling 5-session windows (>= 5 required for Cycle A). */
  readonly maxConsecutiveRolling5dGt60?: number | null;
  /** Individual >= 60% delivery sessions in the 30-day window (>= 5 required for Cycle B). */
  readonly dailyGt60Count?: number | null;
  /** Number of valid delivery sessions in the 30-day window (for short-IPO window rule). */
  readonly valid30dCount?: number | null;
  readonly valid30dSessions?: number | null;
  readonly isIpo?: boolean;
  /** Non-consecutive aggregate count is strictly ignored for Cycle A validation. */
  readonly rolling5dGt60Count?: number | null;
}

export interface SwingTierCriteriaInput extends DeliverySequenceValidationInput {
  readonly avgTurnover20DCr: number | null;
  readonly liquidityPass?: boolean;
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
 * Validates Cycle A / Cycle B delivery category using sequence-validated consecutive rolling
 * window evidence when provided.
 *
 * - Aggregate `rolling5dGt60Count` is strictly ignored and NEVER qualifies a stock for Cycle A.
 * - For non-short-IPO horizons, Cycle A (`A_AND_B` / `A_ONLY`) is accepted ONLY if
 *   `maxConsecutiveRolling5dGt60 >= 5` whenever `maxConsecutiveRolling5dGt60` is provided.
 * - Cycle B (`A_AND_B` / `B_ONLY`) requires `dailyGt60Count >= 5` whenever `dailyGt60Count` is provided.
 */
export function resolveValidatedDeliveryCategory(
  input: DeliverySequenceValidationInput
): DeliveryCategory {
  const raw = input.deliveryCategory;
  if (raw === 'NONE' || raw === 'WAIT_FOR_DATA') {
    return raw;
  }

  const validCount = input.valid30dCount ?? input.valid30dSessions ?? null;
  const isShortIpo =
    input.isIpo === true &&
    typeof validCount === 'number' &&
    Number.isFinite(validCount) &&
    validCount >= 2 &&
    validCount < 5;

  let passA = raw === 'A_AND_B' || raw === 'A_ONLY';
  if (
    passA &&
    !isShortIpo &&
    (input.maxConsecutiveRolling5dGt60 !== undefined || input.rolling5dGt60Count !== undefined)
  ) {
    passA =
      typeof input.maxConsecutiveRolling5dGt60 === 'number' &&
      Number.isFinite(input.maxConsecutiveRolling5dGt60) &&
      input.maxConsecutiveRolling5dGt60 >= 5;
  }

  let passB = raw === 'A_AND_B' || raw === 'B_ONLY';
  if (passB && !isShortIpo && input.dailyGt60Count !== undefined) {
    passB =
      typeof input.dailyGt60Count === 'number' &&
      Number.isFinite(input.dailyGt60Count) &&
      input.dailyGt60Count >= 5;
  }

  if (passA && passB) return 'A_AND_B';
  if (passA) return 'A_ONLY';
  if (passB) return 'B_ONLY';
  return 'NONE';
}

export function isValidatedDeliveryAB(input: DeliverySequenceValidationInput): boolean {
  return isDeliveryABCategory(resolveValidatedDeliveryCategory(input));
}

/**
 * Evaluates the Filter Funnel tier strictly in priority order: T1 -> T2 -> T3 -> NONE.
 * Mutual exclusivity is guaranteed via `if (isT1) ... else if (isT2) ... else if (isT3)`:
 * each stock appears in at most one tier.
 *
 * 1. T1 (TIER_1_READY):
 *    20D Turnover >= 1.5 Cr AND sequence-validated Delivery A/B AND Price > EMA21
 *    AND DelivQty Ratio >= 1.20 AND RVOL > 1.50 AND EOD Change > 0 AND RSI(14) between 45 and 78.
 * 2. T2 (TIER_2_ACCUMULATION):
 *    Meets all T1 criteria EXCEPT RVOL, Green Candle, and RSI:
 *    20D Turnover >= 1.5 Cr AND sequence-validated Delivery A/B AND Price > EMA21
 *    AND DelivQty Ratio >= 1.20.
 * 3. T3 (TIER_3_RVOL_WATCH):
 *    Meets 20D Turnover >= 1.5 Cr AND RVOL > 1.50 AND Green Candle,
 *    when not already qualified for T1 or T2 (e.g. missing Delivery A/B, EMA21, or DelivQty >= 1.20).
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

  const hasDeliveryAB = isValidatedDeliveryAB(input);
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

  const isT3 = hasHighRvol && isGreenCandle;

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

type TierCountRowInput = Pick<ScreenerRow, 'swingTier'> & {
  readonly symbol?: string;
} & Partial<DeliverySequenceValidationInput> &
  Partial<
    Pick<
      SwingTierCriteriaInput,
      'avgTurnover20DCr' | 'liquidityPass' | 'aboveEma21' | 'delivQtyRatio' | 'rvol' | 'rvolBand' | 'changePct' | 'rsi14'
    >
  >;

function hasFullTierCriteria(row: TierCountRowInput): row is TierCountRowInput & SwingTierCriteriaInput {
  return (
    typeof row.deliveryCategory === 'string' &&
    row.avgTurnover20DCr !== undefined &&
    row.aboveEma21 !== undefined &&
    row.delivQtyRatio !== undefined &&
    row.rvol !== undefined &&
    row.changePct !== undefined &&
    row.rsi14 !== undefined
  );
}

function resolveEffectiveSwingTier(row: TierCountRowInput): SwingTier {
  if (hasFullTierCriteria(row)) {
    return classifySwingTier(row);
  }

  const tier: SwingTier = row.swingTier;
  if (tier === 'NONE') {
    return 'NONE';
  }

  const failsExplicitLiquidity =
    row.liquidityPass === false ||
    (row.avgTurnover20DCr !== undefined &&
      !(
        typeof row.avgTurnover20DCr === 'number' &&
        Number.isFinite(row.avgTurnover20DCr) &&
        row.avgTurnover20DCr >= 1.5
      ));
  if (failsExplicitLiquidity) {
    return 'NONE';
  }

  const hasExplicitHighRvol =
    typeof row.rvol === 'number' && Number.isFinite(row.rvol)
      ? row.rvol > 1.5
      : row.rvolBand === 'HIGH';
  const hasExplicitGreenCandle =
    typeof row.changePct === 'number' &&
    Number.isFinite(row.changePct) &&
    row.changePct > 0;

  if (tier === 'TIER_3_RVOL_WATCH') {
    if ((row.rvol !== undefined || row.rvolBand !== undefined) && !hasExplicitHighRvol) {
      return 'NONE';
    }
    if (row.changePct !== undefined && !hasExplicitGreenCandle) {
      return 'NONE';
    }
    return 'TIER_3_RVOL_WATCH';
  }

  if (typeof row.deliveryCategory === 'string') {
    const validated = isValidatedDeliveryAB({
      deliveryCategory: row.deliveryCategory,
      maxConsecutiveRolling5dGt60: row.maxConsecutiveRolling5dGt60,
      dailyGt60Count: row.dailyGt60Count,
      valid30dCount: row.valid30dCount,
      valid30dSessions: row.valid30dSessions,
      isIpo: row.isIpo,
      rolling5dGt60Count: row.rolling5dGt60Count,
    });
    if (!validated) {
      const hasKnownLiquidity =
        row.liquidityPass === true ||
        (typeof row.avgTurnover20DCr === 'number' &&
          Number.isFinite(row.avgTurnover20DCr) &&
          row.avgTurnover20DCr >= 1.5);
      if (hasKnownLiquidity && hasExplicitHighRvol && hasExplicitGreenCandle) {
        return 'TIER_3_RVOL_WATCH';
      }
      return 'NONE';
    }
  }
  return tier;
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
 * Enforces sequence-validated Cycle A eligibility when delivery metadata is present and
 * guarantees `tieredWatchlistCount === tier1ReadyCount + tier2AccumulationCount + tier3RvolWatchCount`.
 */
export function computeFunnelTierCounts(rows: ReadonlyArray<TierCountRowInput>): FunnelCounts {
  let tier1ReadyCount = 0;
  let tier2AccumulationCount = 0;
  let tier3RvolWatchCount = 0;
  let noneCount = 0;

  const uniqueRows = deduplicateBySymbol(rows);

  for (const row of uniqueRows) {
    const tier: SwingTier = resolveEffectiveSwingTier(row);
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
> & {
  readonly symbol?: string;
  readonly delivQtyRatio?: number | null;
} & Partial<Omit<DeliverySequenceValidationInput, 'deliveryCategory'>> &
  Partial<
    Pick<
      SwingTierCriteriaInput,
      'avgTurnover20DCr' | 'aboveEma21' | 'rvol' | 'changePct' | 'rsi14'
    >
  >;

export interface SequentialFunnelMetrics {
  readonly universeMainboard: number;
  readonly funnelStep2FlowCount: number;
  readonly nonAbHighRvolCount: number;
  readonly funnelStep3LiquidityCount: number;
  readonly funnelStep4TriggerCount: number;
  readonly liquidHighRvolTotalCount: number;
  readonly liquidDelivExpLowRvolCount: number;
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

export function isDelivQtyExpanding(row: {
  readonly delivQtyRatio?: number | null;
  readonly swingTier?: SwingTier;
}): boolean {
  if (typeof row.delivQtyRatio === 'number') {
    return Number.isFinite(row.delivQtyRatio) && row.delivQtyRatio >= 1.2;
  }
  if (row.delivQtyRatio === null) {
    return false;
  }
  return row.swingTier === 'TIER_1_READY' || row.swingTier === 'TIER_2_ACCUMULATION';
}

/**
 * Evaluates the 5-step Selection Funnel using a strict sequential `.filter()` chain:
 * 1. universe ->
 * 2. .filter(validatedDeliveryAorB || rvol > 1.5x) ->
 * 3. .filter(liquidity >= 1.5Cr) ->
 * 4. .filter(rvol > 1.5x || (validatedDeliveryAorB && delivQty >= 1.2x)) ->
 * 5. .filter(effectiveTierLogic !== 'NONE')
 *
 * Guarantees monotonic subset invariants:
 * step1 >= step2 >= step3 >= step4 >= step5
 * AND guarantees that zero eligible Tier 1 / Tier 2 / Tier 3 stocks are excluded
 * while rejecting any unvalidated Cycle A aggregate-only candidates.
 */
export function computeSequentialFunnelMetrics(
  rows: ReadonlyArray<SequentialFunnelRowInput>
): SequentialFunnelMetrics {
  // Step 1: Mainboard Universe (deduplicated by symbol when provided)
  const step1Universe = deduplicateBySymbol(rows).map((r) => ({
    ...r,
    deliveryCategory: resolveValidatedDeliveryCategory(r),
    swingTier: resolveEffectiveSwingTier(r),
  }));

  // Step 2: 30-Day Sequence-Validated Delivery A/B Union OR High-RVOL (>1.5x) Flow
  // Retains all validated Delivery A/B candidates (T1/T2) AND early High-RVOL candidates (T3).
  const step2Flow = step1Universe.filter(
    (r) => isDeliveryABCategory(r.deliveryCategory) || r.rvolBand === 'HIGH'
  );

  // Step 3: 20-Session Liquidity Gate (>= 1.5 Cr) strictly within Step 2
  const step3Liquidity = step2Flow.filter((r) => r.liquidityPass === true);

  // Step 4: Breakout / Accumulation Trigger strictly within Step 3
  // RVOL > 1.5x (T1 & T3) OR validated Delivery A/B with DelivQty >= 1.2x expansion (T1 & T2).
  const step4Trigger = step3Liquidity.filter(
    (r) =>
      r.rvolBand === 'HIGH' ||
      (isDeliveryABCategory(r.deliveryCategory) && isDelivQtyExpanding(r))
  );

  // Step 5: Tiered Watchlist (T1/T2/T3) strictly within Step 4
  const step5Tiered = step4Trigger.filter((r) => r.swingTier !== 'NONE');
  const stage5TierCounts = computeFunnelTierCounts(step5Tiered);

  // Delivery A/B sub-cohort breakdowns (strictly sequence-validated)
  const deliveryAB = step1Universe.filter((r) => isDeliveryABCategory(r.deliveryCategory));
  const liqPassInAB = deliveryAB.filter((r) => r.liquidityPass === true);

  // Overall universe-wide mutually exclusive Watchlist counts (T1 + T2 + T3)
  const universeTierCounts = computeFunnelTierCounts(step1Universe);

  const liquidHighRvolTotalCount = step3Liquidity.filter((r) => r.rvolBand === 'HIGH').length;
  const liquidDelivExpLowRvolCount = step4Trigger.filter((r) => r.rvolBand !== 'HIGH').length;

  return {
    universeMainboard: step1Universe.length,
    funnelStep2FlowCount: step2Flow.length,
    nonAbHighRvolCount: step2Flow.filter((r) => !isDeliveryABCategory(r.deliveryCategory)).length,
    funnelStep3LiquidityCount: step3Liquidity.length,
    funnelStep4TriggerCount: step4Trigger.length,
    liquidHighRvolTotalCount,
    liquidDelivExpLowRvolCount,
    deliveryAorBUnion: deliveryAB.length,
    deliveryAAndB: deliveryAB.filter((r) => r.deliveryCategory === 'A_AND_B').length,
    deliveryAOnly: deliveryAB.filter((r) => r.deliveryCategory === 'A_ONLY').length,
    deliveryBOnly: deliveryAB.filter((r) => r.deliveryCategory === 'B_ONLY').length,
    liquidityPassInUnion: liqPassInAB.length,
    liquidityBelowMinInUnion: deliveryAB.filter(
      (r) => r.liquidityTier === 'BELOW_MIN'
    ).length,
    rvolHighInLiquidUnion: liqPassInAB.filter((r) => r.rvolBand === 'HIGH').length,
    rvolLowInLiquidUnion: liqPassInAB.filter((r) => r.rvolBand === 'LOW').length,
    rvolWaitInLiquidUnion: liqPassInAB.filter(
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
