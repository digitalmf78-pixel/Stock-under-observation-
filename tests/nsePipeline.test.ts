import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeriesDeliveryTimeline,
  computeAverageDelivery5D,
  computeDeliveryCategoryAtSlice,
  computeDynamicDeliveryStreak,
  type DeliverySessionInput,
} from '../server/deliveryClassifier.ts';
import { backfillNseBhavcopiesToMinSessions, getCachedBhavcopyDates } from '../server/liveFetcher.ts';
import { nsePipeline } from '../server/nsePipeline.ts';

function makeTradingSessions(
  values: Array<number | null>,
  startIso = '2026-10-15',
  series = 'EQ'
): DeliverySessionInput[] {
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  return values.map((delivPer, idx) => ({
    date: new Date(startMs + idx * 86_400_000).toISOString().slice(0, 10),
    series,
    delivPer,
  }));
}

describe('Phase 2: Cycle A Validation (tests/nsePipeline.test.ts)', () => {
  it('distinguishes 4 vs 5 consecutive qualifying rolling 5-session windows and rejects scattered windows', () => {
    // 8 sessions >= 60% -> 4 rolling 5-session windows -> Cycle B passes, Cycle A MUST FAIL
    const fourWindows = makeTradingSessions([62, 62, 62, 62, 62, 62, 62, 62]);
    const resFour = computeDeliveryCategoryAtSlice(
      fourWindows,
      fourWindows[fourWindows.length - 1].date,
      false
    );
    assert.equal(resFour.rolling5dGt60Count, 4);
    assert.equal(resFour.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resFour.passA, false);
    assert.equal(resFour.passB, true);
    assert.equal(resFour.deliveryCategory, 'B_ONLY');

    // 9 sessions >= 60% -> 5 consecutive rolling 5-session windows -> Cycle A PASSES
    const fiveWindows = makeTradingSessions([60, 60, 60, 60, 60, 60, 60, 60, 60]);
    const resFive = computeDeliveryCategoryAtSlice(
      fiveWindows,
      fiveWindows[fiveWindows.length - 1].date,
      false
    );
    assert.equal(resFive.rolling5dGt60Count, 5);
    assert.equal(resFive.maxConsecutiveRolling5dGt60, 5);
    assert.equal(resFive.passA, true);
    assert.equal(resFive.passB, true);
    assert.equal(resFive.deliveryCategory, 'A_AND_B');

    // 9 sessions where 9th dips to 59.95% -> 5th rolling window averages 59.99% (< 60%) -> Cycle A FAILS
    const boundaryFail = makeTradingSessions([60, 60, 60, 60, 60, 60, 60, 60, 59.95]);
    const resBoundary = computeDeliveryCategoryAtSlice(
      boundaryFail,
      boundaryFail[boundaryFail.length - 1].date,
      false
    );
    assert.equal(resBoundary.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resBoundary.passA, false);

    // Scattered >= 5 qualifying rolling windows (4 + dip + 3 = 7 total, maxConsecutive = 4) -> Cycle A FAILS
    const scattered = makeTradingSessions([
      65, 65, 65, 65, 65, 65, 65, 65, // 4 consecutive qualifying windows
      10, 35, 35, 35, 35, 35,         // resets streak cleanly
      65, 65, 65, 65, 65, 65, 65,     // 3 consecutive qualifying windows
    ]);
    const resScattered = computeDeliveryCategoryAtSlice(
      scattered,
      scattered[scattered.length - 1].date,
      false
    );
    assert.equal(resScattered.rolling5dGt60Count, 7);
    assert.equal(resScattered.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resScattered.passA, false);
    assert.equal(resScattered.deliveryCategory, 'B_ONLY');
  });

  it('resets consecutive streak immediately on failure and handles dynamic dates without static overrides', () => {
    // 10 sessions ending on 2026-11-13: proves no hardcoded override alters dynamic streak
    const unbroken = makeTradingSessions(
      [63, 63, 63, 63, 63, 63, 63, 63, 63, 63],
      '2026-11-04'
    );
    assert.equal(unbroken[unbroken.length - 1].date, '2026-11-13');

    const streakOk = computeDynamicDeliveryStreak(unbroken, false, '2026-11-13');
    assert.equal(streakOk.latestCategory, 'A_AND_B');
    assert.equal(streakOk.consecutiveStreak, 6);
    assert.equal(streakOk.totalQualifyingSessions, 6);
    assert.equal(streakOk.firstStreakDate, '2026-11-08');
    assert.equal(streakOk.deliveryStatus, 'ACTIVE_STREAK_6D');

    // Break qualification with sufficient trailing low-delivery sessions -> consecutiveStreak resets to 0
    const broken = makeTradingSessions([
      65, 65, 65, 65, 65, // idx 4 qualifies (B_ONLY)
      65,                 // idx 5 qualifies (B_ONLY)
      ...new Array<number>(26).fill(15), // exits 30-day lookback -> NONE
    ]);
    const streakReset = computeDynamicDeliveryStreak(broken, false);
    assert.equal(streakReset.latestCategory, 'NONE');
    assert.equal(streakReset.consecutiveStreak, 0);
    assert.equal(streakReset.firstStreakDate, '');
    assert.equal(streakReset.deliveryStatus, 'NONE');
    assert.ok(streakReset.totalQualifyingSessions >= 2);
  });

  it('handles missing delivery values, missed NSE market sessions, series switches, and duplicate dates safely', () => {
    // Null or NaN values inside a rolling 5-session window break contiguity (never skipped/collapsed)
    const withNullGap = makeTradingSessions([
      68, 68, 68, 68, 68, 68, 68, 68, // 4 consecutive windows
      null,
      68, 68, 68, 68, 68, 68, 68, 68, // 4 consecutive windows
    ]);
    const resNullGap = computeDeliveryCategoryAtSlice(
      withNullGap,
      withNullGap[withNullGap.length - 1].date,
      false
    );
    assert.equal(resNullGap.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resNullGap.passA, false);
    assert.equal(computeAverageDelivery5D(makeTradingSessions([70, 70, 70, Number.NaN, 70]), false), null);

    // Missed NSE market session injected via marketSessionDates breaks rolling window contiguity
    const marketSessions = Array.from({ length: 17 }, (_, idx) =>
      new Date(Date.parse('2026-11-01T00:00:00Z') + idx * 86_400_000).toISOString().slice(0, 10)
    );
    const sparseHistory: DeliverySessionInput[] = marketSessions
      .filter((_, idx) => idx !== 8) // missing symbol row on NSE session idx 8
      .map((date) => ({ date, series: 'EQ', delivPer: 72 }));

    // Inject duplicate same-date non-matching series BE row + duplicate EQ row to verify deduplication & EQ preference
    sparseHistory.push({ date: marketSessions[2], series: 'BE', delivPer: 10 });
    sparseHistory.push({ date: marketSessions[10], series: 'EQ', delivPer: 72 });

    const timeline = buildSeriesDeliveryTimeline(sparseHistory, 'EQ', marketSessions);
    assert.equal(timeline.length, 17);
    assert.equal(timeline[2].series, 'EQ');
    assert.equal(timeline[2].delivPer, 72);
    assert.equal(timeline[8].delivPer, null);

    const resMissedSession = computeDeliveryCategoryAtSlice(
      timeline,
      marketSessions[marketSessions.length - 1],
      false
    );
    assert.equal(resMissedSession.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resMissedSession.passA, false);

    // Series switch on session 8 (BE instead of EQ) creates a null gap without marketSessionDates too
    const mixedSeries: DeliverySessionInput[] = marketSessions.map((date, idx) =>
      idx === 8 ? { date, series: 'BE', delivPer: 100 } : { date, series: 'EQ', delivPer: 70 }
    );
    const seriesTimeline = buildSeriesDeliveryTimeline(mixedSeries, 'EQ');
    assert.equal(seriesTimeline[8].delivPer, null);
    const resSeriesSwitch = computeDeliveryCategoryAtSlice(
      seriesTimeline,
      seriesTimeline[seriesTimeline.length - 1].date,
      false
    );
    assert.equal(resSeriesSwitch.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resSeriesSwitch.passA, false);
  });

  it('handles historical backfill cleanly without breaking trailing streaks or Cycle A rules', async () => {
    // 1. Prepending backfilled historical sessions updates historical qualification totals without altering trailing Cycle A or current streak
    const recentTail = makeTradingSessions([65, 65, 65, 65, 65, 65, 65, 65, 65], '2026-11-10');
    const priorGapDay = makeTradingSessions([20], '2026-11-09');
    const backfilledHistory = makeTradingSessions(
      [75, 75, 75, 75, 75, 75, 75, 75, 75],
      '2026-10-01'
    );

    const beforeBackfill = computeDynamicDeliveryStreak([...priorGapDay, ...recentTail], false);
    const afterBackfill = computeDynamicDeliveryStreak(
      [...backfilledHistory, ...priorGapDay, ...recentTail],
      false
    );

    assert.equal(beforeBackfill.consecutiveStreak, 5);
    assert.equal(afterBackfill.consecutiveStreak, 5);
    assert.equal(afterBackfill.firstStreakDate, beforeBackfill.firstStreakDate);
    assert.equal(afterBackfill.latestCategory, 'A_AND_B');
    assert.ok(afterBackfill.totalQualifyingSessions > beforeBackfill.totalQualifyingSessions);

    // 2. Local Bhavcopy backfill check preserves existing >=200 historical trading sessions with zero re-downloads
    const cachedDates = getCachedBhavcopyDates();
    assert.ok(cachedDates.length >= 200, `Expected >=200 cached Bhavcopy sessions, got ${cachedDates.length}`);
    const backfillRes = await backfillNseBhavcopiesToMinSessions({
      minSessions: 200,
      targetSessions: 200,
    });
    assert.equal(backfillRes.meetsMinSessions, true);
    assert.deepEqual(backfillRes.downloadedDates, []);
    assert.equal(backfillRes.finalCachedCount, cachedDates.length);

    // 3. Verify live pipeline historical slice evaluation (no future data leak) & Cycle A invariant on real NSE data
    nsePipeline.ensureLoaded();
    const meta = nsePipeline.getScreenerSessionMeta();
    assert.ok(meta.sessionDates.length >= 200);

    const midHistoricalDate = meta.sessionDates[Math.max(40, meta.sessionDates.length - 15)];
    const historicalSnapshot = nsePipeline.getT1T2SnapshotForDate(midHistoricalDate);
    assert.ok(historicalSnapshot.length > 0);
    for (const snap of historicalSnapshot.slice(0, 20)) {
      assert.ok(
        snap.swingTier === 'TIER_1_READY' || snap.swingTier === 'TIER_2_ACCUMULATION',
        `Unexpected swingTier ${snap.swingTier} for ${snap.symbol}`
      );
      const hist = nsePipeline.getHistoryForSymbol(snap.symbol);
      const exactRow = hist.find((h) => h.date === midHistoricalDate);
      assert.ok(exactRow, `Missing historical row at ${midHistoricalDate} for ${snap.symbol}`);
      assert.equal(snap.closePrice, exactRow.close);
    }

    const allRows = nsePipeline.getAllScreenerRows();
    const cycleARows = allRows.filter(
      (r) => r.deliveryCategory === 'A_ONLY' || r.deliveryCategory === 'A_AND_B'
    );
    assert.ok(cycleARows.length > 0);
    for (const row of cycleARows) {
      const history = nsePipeline.getHistoryForSymbol(row.symbol);
      assert.ok(history.length > 0, `Missing history for Cycle A stock ${row.symbol}`);
      const seriesTimeline = buildSeriesDeliveryTimeline(
        history,
        row.series,
        meta.sessionDates
      );
      const slice = computeDeliveryCategoryAtSlice(
        seriesTimeline,
        meta.latestDate,
        row.isIpo
      );
      assert.equal(slice.passA, true, `${row.symbol} failed passA on re-evaluation`);
      if (!(row.isIpo && slice.valid30dCount < 5)) {
        assert.ok(
          slice.maxConsecutiveRolling5dGt60 >= 5,
          `${row.symbol} marked ${row.deliveryCategory} but had maxConsecutiveRolling5dGt60=${slice.maxConsecutiveRolling5dGt60}`
        );
      }
    }
  });
});
