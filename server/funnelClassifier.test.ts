import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySwingTier,
  computeFunnelTierCounts,
  computeSequentialFunnelMetrics,
  isValidatedDeliveryAB,
  partitionFunnelTiers,
  resolveValidatedDeliveryCategory,
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

  it('requires DelivQty Ratio >= 1.20 for T2, while High RVOL + Green falls back to T3 instead of NONE', () => {
    // Meets Delivery A/B + EMA21 + LOW RVOL + DelivQty < 1.20 -> NOT T1, NOT T2, NOT T3 -> NONE
    assert.equal(
      classifySwingTier(baseT1Candidate({ delivQtyRatio: 1.19, rvol: 1.1, rvolBand: 'LOW' })),
      'NONE'
    );
    // Meets Liquidity + Delivery A/B + EMA21 + High RVOL (> 1.50) + Green, with DelivQty < 1.20 -> falls back to T3 RVOL Watch
    assert.equal(
      classifySwingTier(baseT1Candidate({ delivQtyRatio: 1.16, rvol: 1.71, rvolBand: 'HIGH' })),
      'TIER_3_RVOL_WATCH'
    );
  });

  it('assigns TIER_3_RVOL_WATCH when Turnover >= 1.5Cr + RVOL > 1.50 + Green Candle, and not already T1/T2', () => {
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
    // Missing technical metrics (null rvol / changePct) must never false-pass into T1, T2, or T3
    assert.equal(
      classifySwingTier(
        baseT1Candidate({ deliveryCategory: 'NONE', rvol: null, rvolBand: 'LOW', changePct: null })
      ),
      'NONE'
    );
    // Invalid Cycle A/B (`NONE`) + null RSI + high RVOL red candle stays NONE
    assert.equal(
      classifySwingTier(
        baseT1Candidate({ deliveryCategory: 'NONE', rvol: 2.0, rvolBand: 'HIGH', changePct: 0, rsi14: null })
      ),
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

describe('Sequential Selection Funnel Order (monotonic & includes 100% of eligible T1/T2/T3 stocks)', () => {
  it('applies filters strictly sequentially so every subsequent stage is <= previous and no eligible T1/T2/T3 stock is dropped', () => {
    const rows: SequentialFunnelRowInput[] = [
      // 1. Passes Delivery A/B + Liquidity + RVOL HIGH + DelivQty>=1.2 + T1 Ready
      { deliveryCategory: 'A_AND_B', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', delivQtyRatio: 1.5, swingTier: 'TIER_1_READY' },
      // 2. Passes Delivery A/B + Liquidity + RVOL HIGH + DelivQty>=1.2 + T2 Accum (failed RSI/green)
      { deliveryCategory: 'B_ONLY', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', delivQtyRatio: 1.4, swingTier: 'TIER_2_ACCUMULATION' },
      // 3. Passes Delivery A/B + Liquidity + RVOL HIGH + NONE tier (e.g. red candle & below EMA21) -> passes Step 4, excluded from Step 5
      { deliveryCategory: 'A_ONLY', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', delivQtyRatio: 1.0, swingTier: 'NONE' },
      // 4. Passes Delivery A/B + Liquidity + RVOL LOW + DelivQty>=1.2 + T2 Accum -> MUST reach Step 5
      { deliveryCategory: 'A_AND_B', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'LOW', delivQtyRatio: 1.35, swingTier: 'TIER_2_ACCUMULATION' },
      // 5. Passes Delivery A/B + fails Liquidity + RVOL HIGH -> excluded at Step 3
      { deliveryCategory: 'A_AND_B', liquidityPass: false, liquidityTier: 'BELOW_MIN', rvolBand: 'HIGH', delivQtyRatio: 1.8, swingTier: 'NONE' },
      // 6. Passes Delivery A/B + fails Liquidity + RVOL HIGH -> excluded at Step 3
      { deliveryCategory: 'B_ONLY', liquidityPass: false, liquidityTier: 'BELOW_MIN', rvolBand: 'HIGH', delivQtyRatio: 1.1, swingTier: 'NONE' },
      // 7. Fails Delivery A/B + passes Liquidity + RVOL HIGH + T3 RVOL -> MUST reach Step 2..5
      { deliveryCategory: 'NONE', liquidityPass: true, liquidityTier: 'STRONG', rvolBand: 'HIGH', delivQtyRatio: 1.1, swingTier: 'TIER_3_RVOL_WATCH' },
      // 8. Fails Delivery A/B + fails Liquidity + RVOL LOW -> excluded at Step 2
      { deliveryCategory: 'NONE', liquidityPass: false, liquidityTier: 'BELOW_MIN', rvolBand: 'LOW', delivQtyRatio: 0.9, swingTier: 'NONE' },
    ];

    const m = computeSequentialFunnelMetrics(rows);

    assert.equal(m.universeMainboard, 8);
    assert.equal(m.funnelStep2FlowCount, 7); // rows 1..7 pass Delivery A/B OR RVOL HIGH
    assert.equal(m.nonAbHighRvolCount, 1); // row 7
    assert.equal(m.funnelStep3LiquidityCount, 5); // rows 1,2,3,4,7
    assert.equal(m.funnelStep4TriggerCount, 5); // rows 1,2,3,7 (RVOL HIGH) + row 4 (DelivQty>=1.2)
    assert.equal(m.liquidHighRvolTotalCount, 4);
    assert.equal(m.liquidDelivExpLowRvolCount, 1);
    assert.equal(m.deliveryAorBUnion, 6);
    assert.equal(m.liquidityPassInUnion, 4);
    assert.equal(m.rvolHighInLiquidUnion, 3);
    assert.equal(m.sequentialTieredCount, 4);
    assert.equal(m.sequentialTier1Count, 1);
    assert.equal(m.sequentialTier2Count, 2);
    assert.equal(m.sequentialTier3Count, 1);

    // Strictly monotonically non-increasing funnel invariant across all 5 steps
    assert.ok(m.universeMainboard >= m.funnelStep2FlowCount);
    assert.ok(m.funnelStep2FlowCount >= m.funnelStep3LiquidityCount);
    assert.ok(m.funnelStep3LiquidityCount >= m.funnelStep4TriggerCount);
    assert.ok(m.funnelStep4TriggerCount >= m.sequentialTieredCount);

    // Zero eligible Watchlist stocks dropped by sequential funnel
    assert.equal(m.sequentialTieredCount, m.tieredWatchlistCount);
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

describe('Cycle A Sequence Validation Enforcement (ignores aggregate rolling5dGt60Count)', () => {
  it('rejects A_ONLY candidates with aggregate rolling5dGt60Count >= 5 but maxConsecutiveRolling5dGt60 < 5 from T1 and T2', () => {
    // Low RVOL -> would have falsely entered TIER_2_ACCUMULATION if aggregate rolling5dGt60Count were trusted
    const falseT2 = baseT1Candidate({
      deliveryCategory: 'A_ONLY',
      rolling5dGt60Count: 8,
      maxConsecutiveRolling5dGt60: 4,
      dailyGt60Count: 4,
      rvol: 1.1,
      rvolBand: 'LOW',
    });
    assert.equal(resolveValidatedDeliveryCategory(falseT2), 'NONE');
    assert.equal(isValidatedDeliveryAB(falseT2), false);
    assert.equal(classifySwingTier(falseT2), 'NONE');

    // High RVOL + green -> CANNOT enter TIER_1_READY or TIER_2_ACCUMULATION; falls back strictly to T3 RVOL Watch
    const rejectedToT3 = baseT1Candidate({
      deliveryCategory: 'A_ONLY',
      rolling5dGt60Count: 7,
      maxConsecutiveRolling5dGt60: 4,
      dailyGt60Count: 4,
      rvol: 1.9,
      rvolBand: 'HIGH',
      changePct: 2.1,
    });
    assert.equal(classifySwingTier(rejectedToT3), 'TIER_3_RVOL_WATCH');

    // NONE category with high aggregate rolling5dGt60Count is ignored
    const aggregateOnlyNone = baseT1Candidate({
      deliveryCategory: 'NONE',
      rolling5dGt60Count: 9,
      maxConsecutiveRolling5dGt60: 4,
      rvol: 1.0,
      rvolBand: 'LOW',
    });
    assert.equal(classifySwingTier(aggregateOnlyNone), 'NONE');
  });

  it('requires maxConsecutiveRolling5dGt60 >= 5 for Cycle A and strips unvalidated A_AND_B/A_ONLY from funnel counts', () => {
    // A_AND_B with maxConsecutive < 5 and dailyGt60Count >= 5 downgrades to B_ONLY
    assert.equal(
      resolveValidatedDeliveryCategory({
        deliveryCategory: 'A_AND_B',
        rolling5dGt60Count: 6,
        maxConsecutiveRolling5dGt60: 4,
        dailyGt60Count: 5,
      }),
      'B_ONLY'
    );

    // A_AND_B with both maxConsecutive < 5 and dailyGt60Count < 5 downgrades to NONE
    assert.equal(
      resolveValidatedDeliveryCategory({
        deliveryCategory: 'A_AND_B',
        rolling5dGt60Count: 6,
        maxConsecutiveRolling5dGt60: 4,
        dailyGt60Count: 3,
      }),
      'NONE'
    );

    // Validated Cycle A (maxConsecutive >= 5) qualifies into T1
    assert.equal(
      classifySwingTier(
        baseT1Candidate({
          deliveryCategory: 'A_ONLY',
          rolling5dGt60Count: 5,
          maxConsecutiveRolling5dGt60: 5,
          dailyGt60Count: 4,
        })
      ),
      'TIER_1_READY'
    );

    // Short IPO rule (isIpo=true, 2 <= valid30dCount < 5) preserves eligibility
    assert.equal(
      classifySwingTier(
        baseT1Candidate({
          deliveryCategory: 'A_ONLY',
          isIpo: true,
          valid30dCount: 3,
          maxConsecutiveRolling5dGt60: 0,
        })
      ),
      'TIER_1_READY'
    );

    // Pre-tagged T1/T2 rows failing maxConsecutiveRolling5dGt60 < 5 are stripped from sequential funnel & tier counts
    const mixedRows: SequentialFunnelRowInput[] = [
      {
        symbol: 'VALID_A',
        deliveryCategory: 'A_ONLY',
        rolling5dGt60Count: 5,
        maxConsecutiveRolling5dGt60: 5,
        dailyGt60Count: 4,
        liquidityPass: true,
        liquidityTier: 'STRONG',
        rvolBand: 'LOW',
        delivQtyRatio: 1.4,
        swingTier: 'TIER_2_ACCUMULATION',
      },
      {
        symbol: 'FAKE_AGG_A',
        deliveryCategory: 'A_ONLY',
        rolling5dGt60Count: 8,
        maxConsecutiveRolling5dGt60: 4,
        dailyGt60Count: 4,
        liquidityPass: true,
        liquidityTier: 'STRONG',
        rvolBand: 'LOW',
        delivQtyRatio: 1.5,
        swingTier: 'TIER_2_ACCUMULATION',
      },
      {
        symbol: 'VALID_T3',
        deliveryCategory: 'NONE',
        rolling5dGt60Count: 6,
        maxConsecutiveRolling5dGt60: 3,
        liquidityPass: true,
        liquidityTier: 'STRONG',
        rvolBand: 'HIGH',
        delivQtyRatio: 1.0,
        swingTier: 'TIER_3_RVOL_WATCH',
      },
    ];

    const counts = computeFunnelTierCounts(mixedRows);
    assert.equal(counts.tier1ReadyCount, 0);
    assert.equal(counts.tier2AccumulationCount, 1);
    assert.equal(counts.tier3RvolWatchCount, 1);
    assert.equal(counts.tieredWatchlistCount, 2);
    assert.equal(counts.noneCount, 1);

    const seq = computeSequentialFunnelMetrics(mixedRows);
    assert.equal(seq.deliveryAorBUnion, 1);
    assert.equal(seq.deliveryAOnly, 1);
    assert.equal(seq.sequentialTier2Count, 1);
    assert.equal(seq.sequentialTier3Count, 1);
    assert.equal(seq.sequentialTieredCount, 2);
  });

  it('rejects aggregate-only Cycle A without sequence validation and enforces T3 fallback & liquidity gating on partial rows', () => {
    // Providing rolling5dGt60Count without maxConsecutiveRolling5dGt60 must NOT grant Cycle A
    const aggregateWithoutSequence = baseT1Candidate({
      deliveryCategory: 'A_ONLY',
      rolling5dGt60Count: 9,
      rvol: 1.1,
      rvolBand: 'LOW',
    });
    assert.equal(resolveValidatedDeliveryCategory(aggregateWithoutSequence), 'NONE');
    assert.equal(classifySwingTier(aggregateWithoutSequence), 'NONE');

    const partialRows: SequentialFunnelRowInput[] = [
      // Pre-tagged T1 failing Cycle A, but with liquidity + high RVOL + green candle -> falls back to T3
      {
        symbol: 'PARTIAL_T3_FALLBACK',
        deliveryCategory: 'A_ONLY',
        rolling5dGt60Count: 7,
        maxConsecutiveRolling5dGt60: 4,
        dailyGt60Count: 4,
        liquidityPass: true,
        liquidityTier: 'STRONG',
        rvolBand: 'HIGH',
        changePct: 2.2,
        swingTier: 'TIER_1_READY',
      },
      // Pre-tagged T3 with failing liquidity -> forced to NONE
      {
        symbol: 'BAD_T3_ILLIQUID',
        deliveryCategory: 'NONE',
        liquidityPass: false,
        liquidityTier: 'BELOW_MIN',
        rvolBand: 'HIGH',
        changePct: 3.1,
        swingTier: 'TIER_3_RVOL_WATCH',
      },
      // Pre-tagged T3 with red candle -> forced to NONE
      {
        symbol: 'BAD_T3_RED',
        deliveryCategory: 'NONE',
        liquidityPass: true,
        liquidityTier: 'STRONG',
        rvolBand: 'HIGH',
        changePct: -0.5,
        swingTier: 'TIER_3_RVOL_WATCH',
      },
    ];

    const counts = computeFunnelTierCounts(partialRows);
    assert.equal(counts.tier1ReadyCount, 0);
    assert.equal(counts.tier2AccumulationCount, 0);
    assert.equal(counts.tier3RvolWatchCount, 1);
    assert.equal(counts.noneCount, 2);
  });
});


