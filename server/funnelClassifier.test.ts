import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySwingTier,
  computeFunnelTierCounts,
  computeSequentialFunnelMetrics,
  partitionFunnelTiers,
  type SequentialFunnelRowInput,
  type SwingTierCriteriaInput,
} from './funnelClassifier.ts';

function baseT1Candidate(
  overrides: Partial<SwingTierCriteriaInput> = {}
): SwingTierCriteriaInput {
  return {
    avgTurnover20DCr: 12.5,
    liquidityPass: true,
    deliveryCategory: 'A_AND_B',
    aboveEma21: true,
    delivQtyRatio: 1.45,
    rvol: 1.85,
    rvolBand: 'HIGH',
    changePct: 2.4,
    rsi14: 61.5,
    ...overrides,
  };
}

describe('Filter Funnel Tier Classification (strict T1 > T2 > T3 priority & mutual exclusivity)', () => {
  it('assigns TIER_1_READY when all 7 T1 criteria are satisfied (including exact boundary values)', () => {
    assert.equal(classifySwingTier(baseT1Candidate()), 'TIER_1_READY');

    // Exact inclusive boundaries: Turnover=1.5, DelivQtyRatio=1.20, RVOL=1.51 (>1.50), Change=0.01 (>0), RSI=45 & 78
    assert.equal(
      classifySwingTier(
        baseT1Candidate({
          avgTurnover20DCr: 1.5,
          delivQtyRatio: 1.2,
          rvol: 1.51,
          changePct: 0.01,
          rsi14: 45,
        })
      ),
      'TIER_1_READY'
    );
    assert.equal(
      classifySwingTier(baseT1Candidate({ deliveryCategory: 'B_ONLY', rsi14: 78 })),
      'TIER_1_READY'
    );
  });

  it('assigns TIER_2_ACCUMULATION when T1 core gates pass but RVOL, Green Candle, or RSI fail', () => {
    // Low RVOL (<= 1.50) -> falls out of T1 into T2
    assert.equal(
      classifySwingTier(baseT1Candidate({ rvol: 1.5, rvolBand: 'LOW' })),
      'TIER_2_ACCUMULATION'
    );
    // Non-green candle (changePct <= 0) -> T2
    assert.equal(
      classifySwingTier(baseT1Candidate({ changePct: 0 })),
      'TIER_2_ACCUMULATION'
    );
    assert.equal(
      classifySwingTier(baseT1Candidate({ changePct: -0.75 })),
      'TIER_2_ACCUMULATION'
    );
    // RSI outside 45..78 or null -> T2
    assert.equal(classifySwingTier(baseT1Candidate({ rsi14: 44.9 })), 'TIER_2_ACCUMULATION');
    assert.equal(classifySwingTier(baseT1Candidate({ rsi14: 78.1 })), 'TIER_2_ACCUMULATION');
    assert.equal(classifySwingTier(baseT1Candidate({ rsi14: null })), 'TIER_2_ACCUMULATION');
  });

  it('requires DelivQty Ratio >= 1.20 for T2 (never leaks DelivQty < 1.20 into T2 even if RVOL > 1.50)', () => {
    // Meets Delivery A/B + EMA21 + RVOL > 1.50 + Green, but DelivQty < 1.20 -> NOT T1, NOT T2, NOT T3 (since Delivery A/B & EMA21 both passed)
    assert.equal(
      classifySwingTier(baseT1Candidate({ delivQtyRatio: 1.19 })),
      'NONE'
    );
  });

  it('assigns TIER_3_RVOL_WATCH when Turnover >= 1.5Cr + RVOL > 1.50 + Green Candle, and Delivery A/B OR EMA21 fails', () => {
    // Fails Delivery A/B (`NONE`), passes EMA21 + Turnover + RVOL + Green -> T3
    assert.equal(
      classifySwingTier(baseT1Candidate({ deliveryCategory: 'NONE' })),
      'TIER_3_RVOL_WATCH'
    );
    // Passes Delivery A/B, fails EMA21 (`false` or `null`) + Turnover + RVOL + Green -> T3
    assert.equal(
      classifySwingTier(baseT1Candidate({ aboveEma21: false })),
      'TIER_3_RVOL_WATCH'
    );
    assert.equal(
      classifySwingTier(baseT1Candidate({ aboveEma21: null })),
      'TIER_3_RVOL_WATCH'
    );
    // Fails BOTH Delivery A/B and EMA21, passes Turnover + RVOL + Green -> T3
    assert.equal(
      classifySwingTier(
        baseT1Candidate({ deliveryCategory: 'NONE', aboveEma21: false, delivQtyRatio: 0.8 })
      ),
      'TIER_3_RVOL_WATCH'
    );
  });

  it('returns NONE if 20D Turnover < 1.5 Cr or T3 lacks Green Candle / RVOL > 1.50', () => {
    assert.equal(classifySwingTier(baseT1Candidate({ avgTurnover20DCr: 1.49 })), 'NONE');
    assert.equal(classifySwingTier(baseT1Candidate({ avgTurnover20DCr: null })), 'NONE');
    // Fails Delivery A/B AND is red candle -> cannot be T3
    assert.equal(
      classifySwingTier(baseT1Candidate({ deliveryCategory: 'NONE', changePct: -1.0 })),
      'NONE'
    );
    // Fails Delivery A/B AND RVOL <= 1.50 -> cannot be T3
    assert.equal(
      classifySwingTier(baseT1Candidate({ deliveryCategory: 'NONE', rvol: 1.4, rvolBand: 'LOW' })),
      'NONE'
    );
  });

  it('partitions every stock into strictly one bucket with T1 > T2 > T3 priority', () => {
    const stocks: Array<SwingTierCriteriaInput & { symbol: string }> = [
      { symbol: 'T1_A', ...baseT1Candidate() },
      { symbol: 'T2_A', ...baseT1Candidate({ rvol: 1.1, rvolBand: 'LOW' }) },
      { symbol: 'T2_B', ...baseT1Candidate({ changePct: -0.2, rsi14: 82 }) },
      { symbol: 'T3_A', ...baseT1Candidate({ deliveryCategory: 'NONE' }) },
      { symbol: 'T3_B', ...baseT1Candidate({ aboveEma21: false }) },
      { symbol: 'NONE_A', ...baseT1Candidate({ avgTurnover20DCr: 0.9 }) },
    ];

    const buckets = partitionFunnelTiers(stocks);
    assert.deepEqual(
      buckets.tier1.map((s) => s.symbol),
      ['T1_A']
    );
    assert.deepEqual(
      buckets.tier2.map((s) => s.symbol),
      ['T2_A', 'T2_B']
    );
    assert.deepEqual(
      buckets.tier3.map((s) => s.symbol),
      ['T3_A', 'T3_B']
    );
    assert.deepEqual(
      buckets.none.map((s) => s.symbol),
      ['NONE_A']
    );

    const totalPartitioned =
      buckets.tier1.length + buckets.tier2.length + buckets.tier3.length + buckets.none.length;
    assert.equal(totalPartitioned, stocks.length);

    const counts = computeFunnelTierCounts(
      stocks.map((s) => ({ swingTier: classifySwingTier(s) }))
    );
    assert.equal(counts.tier1ReadyCount, 1);
    assert.equal(counts.tier2AccumulationCount, 2);
    assert.equal(counts.tier3RvolWatchCount, 2);
    assert.equal(counts.noneCount, 1);
  });
});

describe('Sequential Selection Funnel Order (Universe -> Delivery A/B -> Liquidity >= 1.5Cr -> RVOL > 1.5x -> Tiered Watchlist)', () => {
  it('applies filters strictly sequentially so every subsequent stage is <= the previous stage', () => {
    const rows: SequentialFunnelRowInput[] = [
      // 1. Passes Delivery A/B + Liquidity + RVOL HIGH + T1 Ready (in all 5 stages)
      { deliveryCategory: 'A_AND_B', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', swingTier: 'TIER_1_READY' },
      // 2. Passes Delivery A/B + Liquidity + RVOL HIGH + T2 Accum (in all 5 stages)
      { deliveryCategory: 'B_ONLY', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', swingTier: 'TIER_2_ACCUMULATION' },
      // 3. Passes Delivery A/B + Liquidity + RVOL HIGH + NONE tier (passes Stage 4, excluded from Stage 5)
      { deliveryCategory: 'A_ONLY', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', swingTier: 'NONE' },
      // 4. Passes Delivery A/B + Liquidity + RVOL LOW + T2 Accum (passes Stage 3, excluded from Stage 4 & Stage 5 sequential)
      { deliveryCategory: 'A_AND_B', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'LOW', swingTier: 'TIER_2_ACCUMULATION' },
      // 5. Passes Delivery A/B + fails Liquidity + RVOL HIGH (passes Stage 2, excluded from Stage 3 & Stage 4)
      { deliveryCategory: 'A_AND_B', liquidityPass: false, liquidityTier: 'BELOW_MIN', rvolBand: 'HIGH', swingTier: 'NONE' },
      // 6. Passes Delivery A/B + fails Liquidity + RVOL HIGH
      { deliveryCategory: 'B_ONLY', liquidityPass: false, liquidityTier: 'BELOW_MIN', rvolBand: 'HIGH', swingTier: 'NONE' },
      // 7. Fails Delivery A/B + passes Liquidity + RVOL HIGH + T3 RVOL (excluded from Stage 2..5 sequential, counted in universe-wide T3)
      { deliveryCategory: 'NONE', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', swingTier: 'TIER_3_RVOL_WATCH' },
      // 8. Fails Delivery A/B + fails Liquidity
      { deliveryCategory: 'NONE', liquidityPass: false, liquidityTier: 'BELOW_MIN', rvolBand: 'LOW', swingTier: 'NONE' },
    ];

    const m = computeSequentialFunnelMetrics(rows);

    assert.equal(m.universeMainboard, 8);
    assert.equal(m.deliveryAorBUnion, 6);
    assert.equal(m.liquidityPassInUnion, 4);
    assert.equal(m.rvolHighInLiquidUnion, 3);
    assert.equal(m.rvolLowInLiquidUnion, 1);
    assert.equal(m.rvolWaitInLiquidUnion, 0);
    assert.equal(m.sequentialTieredCount, 2);
    assert.equal(m.sequentialTier1Count, 1);
    assert.equal(m.sequentialTier2Count, 1);
    assert.equal(m.sequentialTier3Count, 0);

    // Strictly monotonically non-increasing funnel invariant
    assert.ok(m.universeMainboard >= m.deliveryAorBUnion);
    assert.ok(m.deliveryAorBUnion >= m.liquidityPassInUnion);
    assert.ok(m.liquidityPassInUnion >= m.rvolHighInLiquidUnion);
    assert.ok(m.rvolHighInLiquidUnion >= m.sequentialTieredCount);

    // Universe-wide totals remain intact for KPI cards and Watchlist sum
    assert.equal(m.tier1ReadyCount, 1);
    assert.equal(m.tier2AccumulationCount, 2);
    assert.equal(m.tier3RvolWatchCount, 1);
    assert.equal(
      m.tieredWatchlistCount,
      m.tier1ReadyCount + m.tier2AccumulationCount + m.tier3RvolWatchCount
    );
  });

  it('guarantees T1 + T2 + T3 equals total Watchlist (26 + 28 + 91 = 145) with zero duplicate symbols across tiers', () => {
    const stocks: Array<SwingTierCriteriaInput & { symbol: string }> = [];

    for (let i = 0; i < 26; i++) {
      stocks.push({ symbol: `T1_${i}`, ...baseT1Candidate() });
    }
    for (let i = 0; i < 28; i++) {
      // 7 with high RVOL (failing green candle/RSI) + 21 with low RVOL
      stocks.push({
        symbol: `T2_${i}`,
        ...baseT1Candidate(i < 7 ? { changePct: -0.4 } : { rvol: 1.1, rvolBand: 'LOW' }),
      });
    }
    for (let i = 0; i < 91; i++) {
      // 13 passing Delivery A/B but failing EMA21 + 78 failing Delivery A/B
      stocks.push({
        symbol: `T3_${i}`,
        ...baseT1Candidate(i < 13 ? { aboveEma21: false } : { deliveryCategory: 'NONE' }),
      });
    }
    // Add duplicate symbol entries and non-qualifying stocks to prove deduplication and strict if/else if partitioning
    stocks.push({ symbol: 'T1_0', ...baseT1Candidate() });
    stocks.push({ symbol: 'T2_0', ...baseT1Candidate({ rvol: 1.1, rvolBand: 'LOW' }) });
    stocks.push({ symbol: 'NONE_0', ...baseT1Candidate({ avgTurnover20DCr: 0.8 }) });

    const buckets = partitionFunnelTiers(stocks);
    assert.equal(buckets.tier1.length, 26);
    assert.equal(buckets.tier2.length, 28);
    assert.equal(buckets.tier3.length, 91);
    assert.equal(buckets.none.length, 1);

    const t1Set = new Set(buckets.tier1.map((s) => s.symbol));
    const t2Set = new Set(buckets.tier2.map((s) => s.symbol));
    const t3Set = new Set(buckets.tier3.map((s) => s.symbol));

    // Strictly zero intersection between T1, T2, and T3
    for (const sym of t1Set) {
      assert.equal(t2Set.has(sym), false, `${sym} duplicated in T1 and T2`);
      assert.equal(t3Set.has(sym), false, `${sym} duplicated in T1 and T3`);
    }
    for (const sym of t2Set) {
      assert.equal(t3Set.has(sym), false, `${sym} duplicated in T2 and T3`);
    }

    const classifiedRows: SequentialFunnelRowInput[] = stocks.map((s) => ({
      symbol: s.symbol,
      deliveryCategory: s.deliveryCategory,
      liquidityPass: s.liquidityPass ?? true,
      liquidityTier: 'STRONG',
      rvolBand: s.rvolBand ?? 'HIGH',
      swingTier: classifySwingTier(s),
    }));

    const counts = computeFunnelTierCounts(classifiedRows);
    assert.equal(counts.tier1ReadyCount, 26);
    assert.equal(counts.tier2AccumulationCount, 28);
    assert.equal(counts.tier3RvolWatchCount, 91);
    assert.equal(counts.tieredWatchlistCount, 145);

    const metrics = computeSequentialFunnelMetrics(classifiedRows);
    assert.equal(metrics.tier1ReadyCount, 26);
    assert.equal(metrics.tier2AccumulationCount, 28);
    assert.equal(metrics.tier3RvolWatchCount, 91);
    assert.equal(metrics.tieredWatchlistCount, 145);
  });
});
