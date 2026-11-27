import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyFundamentalFreshness,
  DEFAULT_MAX_DATA_AGE_DAYS,
  resolveMaxDataAgeDays,
} from './fundamentalAudit.ts';

describe('Fundamental Audit Freshness Classification (aligned with fundamental_thresholds.json max_data_age_days)', () => {
  it('reads max_data_age_days = 548 from fundamental_thresholds.json and aligns STALE threshold strictly to 548 days', () => {
    const thresholdsPath = path.join(
      process.cwd(),
      'data',
      'inputs',
      'fundamental_thresholds.json'
    );
    const thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf-8')) as {
      max_data_age_days: number;
    };
    assert.equal(thresholds.max_data_age_days, 548);
    assert.equal(resolveMaxDataAgeDays(thresholds.max_data_age_days), 548);

    // <= 90 days -> LATEST
    const latest = classifyFundamentalFreshness({
      ageDays: 90,
      maxDataAgeDays: thresholds.max_data_age_days,
      bestPeriod: '2026-09-30',
      sourcesLabel: 'Screener.in',
    });
    assert.equal(latest.fundamentalFreshness, 'LATEST');

    // 181..548 days -> OLD_3M (must NOT be STALE while within max_data_age_days = 548)
    for (const withinMaxAge of [91, 180, 181, 365, 548]) {
      const res = classifyFundamentalFreshness({
        ageDays: withinMaxAge,
        maxDataAgeDays: thresholds.max_data_age_days,
        bestPeriod: '2025-09-30',
        sourcesLabel: 'Screener.in',
      });
      assert.equal(
        res.fundamentalFreshness,
        'OLD_3M',
        `Expected ${withinMaxAge}d to be OLD_3M within ${thresholds.max_data_age_days}d limit`
      );
      assert.ok(res.fundamentalRemark.includes('91–548d'));
    }

    // > 548 days -> STALE
    const stale = classifyFundamentalFreshness({
      ageDays: 549,
      maxDataAgeDays: thresholds.max_data_age_days,
      bestPeriod: '2025-03-31',
      sourcesLabel: 'Screener.in',
    });
    assert.equal(stale.fundamentalFreshness, 'STALE');
    assert.ok(stale.fundamentalRemark.includes('>548d'));
  });

  it('honors custom max_data_age_days overrides and handles missing/null period dates cleanly', () => {
    const custom180 = classifyFundamentalFreshness({
      ageDays: 181,
      maxDataAgeDays: 180,
      bestPeriod: '2026-03-31',
      sourcesLabel: 'BSE Official',
    });
    assert.equal(custom180.fundamentalFreshness, 'STALE');
    assert.ok(custom180.fundamentalRemark.includes('>180d'));

    const missingDate = classifyFundamentalFreshness({
      ageDays: null,
      maxDataAgeDays: DEFAULT_MAX_DATA_AGE_DAYS,
      sourcesLabel: 'None',
    });
    assert.equal(missingDate.fundamentalFreshness, 'STALE');
    assert.equal(missingDate.fundamentalAgeDays, null);
  });
});

describe('Tier 1-3 Fundamental Deep Audit Scope & 7-Metric Data Validation', async () => {
  const { nsePipeline } = await import('./nsePipeline.ts');

  it('runs Fundamental Deep Audit strictly on Tier 1, Tier 2, and Tier 3 stocks (never Main Board-wide)', () => {
    const overview = nsePipeline.getOverview();
    const tieredExpected =
      overview.funnel.tier1ReadyCount +
      overview.funnel.tier2AccumulationCount +
      overview.funnel.tier3RvolWatchCount;

    assert.ok(tieredExpected > 0, 'Expected at least 1 tiered swing stock');
    assert.ok(
      tieredExpected < overview.funnel.universeMainboard,
      'Tiered watchlist must be strictly smaller than Main Board universe'
    );

    // 1. Overview Fundamental Audit breakdown must equal Tier 1+2+3 count
    assert.equal(overview.fundamentalAudit.totalStocks, tieredExpected);
    const freshnessSum =
      overview.fundamentalAudit.latestCount +
      overview.fundamentalAudit.old3mCount +
      overview.fundamentalAudit.staleCount +
      overview.fundamentalAudit.notAvailableCount;
    assert.equal(freshnessSum, tieredExpected);

    // 2. queryFundamentalAudit must strictly contain only Tier 1/2/3 stocks
    const tieredScreener = nsePipeline.queryScreener({ swingTier: 'ANY_SWING', limit: 5000 });
    const tieredSymbolSet = new Set(tieredScreener.rows.map((r) => r.symbol));
    assert.equal(tieredSymbolSet.size, tieredExpected);

    const auditQuery = nsePipeline.queryFundamentalAudit({ limit: 5000 });
    assert.equal(auditQuery.counts.nseMapped, tieredExpected);
    assert.equal(auditQuery.total, tieredExpected);
    for (const entry of auditQuery.rows) {
      assert.ok(
        tieredSymbolSet.has(entry.symbol),
        `Non-tiered stock ${entry.symbol} leaked into queryFundamentalAudit`
      );
    }

    // 3. Collection target pools must never return swingTier === NONE stocks
    for (const scope of ['ALL', 'MISSING_OR_OLD', 'NOT_AVAILABLE', 'LIQUID'] as const) {
      const targets = nsePipeline.getAuditCollectionTargets(scope);
      for (const sym of targets) {
        assert.ok(
          tieredSymbolSet.has(sym),
          `Non-tiered stock ${sym} leaked into getAuditCollectionTargets(${scope})`
        );
      }
    }
    for (const sym of nsePipeline.getMissingFundamentalCandidates(500)) {
      assert.ok(
        tieredSymbolSet.has(sym),
        `Non-tiered stock ${sym} leaked into getMissingFundamentalCandidates`
      );
    }
  });

  it('rejects corrupted Moneycontrol clone rows and keeps 7 metrics finite and accurately checked', () => {
    // Previously 104 unrelated stocks in fundamental_free_source_cache.csv received identical
    // fabricated Moneycontrol ratios (rocePct=40.99, interestCoverage=21686.25).
    for (const sym of ['ARIS', 'CEATLTD', 'BORORENEW', 'ADOR', 'AUROPHARMA']) {
      const detail = nsePipeline.getStockDetail(sym);
      const f = detail?.fundamentals;
      if (!f) continue;
      const isFabricatedClone =
        f.rocePct === 40.99 &&
        f.roePct === 37.41 &&
        f.interestCoverage === 21686.25 &&
        f.revenueGrowthPct === 59.53;
      assert.equal(
        isFabricatedClone,
        false,
        `${sym} must not carry corrupted Moneycontrol cloned ratios`
      );
      for (const chk of f.checks) {
        if (chk.value !== null) {
          assert.ok(Number.isFinite(chk.value), `${sym}.${chk.key} must be finite or null`);
        }
        if (chk.key === 'debtToEquity' && chk.value !== null) {
          assert.ok(chk.value >= 0, `${sym}.debtToEquity must be non-negative`);
        }
      }
    }

    // Negative finite interestCoverage must be preserved as FAIL (never dropped to MISSING)
    const testNegativeIc = ['COHANCE', 'GREAVESCOT', 'ABFRL', 'INDIGO', 'SHALPAINTS'];
    let verifiedAtLeastOneNegIc = false;
    for (const sym of testNegativeIc) {
      const detail = nsePipeline.getStockDetail(sym);
      const icCheck = detail?.fundamentals?.checks.find((c) => c.key === 'interestCoverage');
      if (icCheck && icCheck.value !== null && icCheck.value < 0) {
        assert.equal(
          icCheck.status,
          'FAIL',
          `${sym} negative IC (${icCheck.value}) must evaluate as FAIL`
        );
        verifiedAtLeastOneNegIc = true;
      }
    }
    assert.ok(verifiedAtLeastOneNegIc, 'Expected at least one stock with preserved negative IC FAIL check');
  });

  it('enforces isSymbolEligibleForFundamentalAudit allowlist across fetcher helpers (Tier 1-3 pass, NONE blocked)', async () => {
    const { saveSymbolFundamentalsToCache, refreshFundamentalsBatch } = await import(
      './liveFetcher.ts'
    );
    const eligibleSet = nsePipeline.getEligibleAuditSymbolSet();
    const allRows = nsePipeline.getAllScreenerRows();
    const firstEligible = allRows.find((r) => eligibleSet.has(r.symbol));
    const firstNonTiered = allRows.find((r) => r.swingTier === 'NONE');

    assert.ok(firstEligible, 'Expected at least one eligible tiered symbol');
    assert.ok(firstNonTiered, 'Expected at least one NONE non-tiered symbol');

    assert.equal(nsePipeline.isSymbolEligibleForFundamentalAudit(firstEligible.symbol), true);
    assert.equal(nsePipeline.isSymbolEligibleForFundamentalAudit(firstNonTiered.symbol), false);
    assert.equal(nsePipeline.isSymbolEligibleForFundamentalAudit('NONEXISTENT_SYM_XYZ'), false);

    const saveRejected = await saveSymbolFundamentalsToCache(
      firstNonTiered.symbol,
      undefined,
      false,
      { isEligible: (s) => nsePipeline.isSymbolEligibleForFundamentalAudit(s) }
    );
    assert.ok(saveRejected.error?.includes('Tier 1, Tier 2, or Tier 3'));

    const batchRes = await refreshFundamentalsBatch(
      [firstNonTiered.symbol],
      undefined,
      false,
      { isEligible: (s) => nsePipeline.isSymbolEligibleForFundamentalAudit(s) }
    );
    assert.deepEqual(batchRes.succeeded, []);
    assert.equal(batchRes.failed.length, 1);
    assert.equal(batchRes.failed[0].symbol, firstNonTiered.symbol);
  });
});


