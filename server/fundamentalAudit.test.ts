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
