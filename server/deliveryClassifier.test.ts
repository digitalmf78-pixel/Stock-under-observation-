import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeriesDeliveryTimeline,
  computeAverageDelivery5D,
  computeDeliveryCategoryAtSlice,
  computeDynamicDeliveryStreak,
  type DeliverySessionInput,
} from './deliveryClassifier.ts';

function makeSessions(
  values: Array<number | null>,
  startIso = '2026-11-01',
  series = 'EQ'
): DeliverySessionInput[] {
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  return values.map((delivPer, idx) => ({
    date: new Date(startMs + idx * 86_400_000).toISOString().slice(0, 10),
    series,
    delivPer,
  }));
}

describe('Delivery Cycle A & Independent Rolling 5-Session Windows', () => {
  it('requires 5 CONSECUTIVE qualifying rolling 5-session windows for Cycle A (scattered >= 5 fails)', () => {
    // Windows 0..3 qualify (4 consecutive), then a low-delivery dip breaks the streak,
    // then 3 more windows qualify at the end -> total 7 qualifying rolling windows, max consecutive = 4.
    // Daily >= 60% count = 8 (>= 5 so Cycle B passes, Cycle A MUST FAIL -> B_ONLY).
    const sessions = makeSessions([
      65, 65, 65, 65, 65, // win0=65 (consec 1)
      65,                 // win1=65 (consec 2)
      65,                 // win2=65 (consec 3)
      65,                 // win3=65 (consec 4)
      10,                 // breaks streak
      35, 35, 35, 35, 35, // 35+65*4 = 59.0 (< 60) so tail windows only qualify once all 5 are 65
      65, 65, 65, 65, 65, // consec 1
      65,                 // consec 2
      65,                 // consec 3
    ]);

    const asOfDate = sessions[sessions.length - 1].date;
    const res = computeDeliveryCategoryAtSlice(sessions, asOfDate, false);

    assert.equal(res.rolling5dGt60Count, 7);
    assert.equal(res.maxConsecutiveRolling5dGt60, 4);
    assert.equal(res.passA, false);
    assert.equal(res.passB, true);
    assert.equal(res.deliveryCategory, 'B_ONLY');
  });

  it('passes Cycle A when at least 5 consecutive rolling 5-session windows independently average >= 60%', () => {
    // 9 sessions at 62% produce 5 consecutive rolling 5-session windows ([0..4]..[4..8]) >= 60%.
    const sessions = makeSessions([62, 62, 62, 62, 62, 62, 62, 62, 62]);
    const asOfDate = sessions[sessions.length - 1].date;
    const res = computeDeliveryCategoryAtSlice(sessions, asOfDate, false);

    assert.equal(res.rolling5dGt60Count, 5);
    assert.equal(res.maxConsecutiveRolling5dGt60, 5);
    assert.equal(res.passA, true);
    assert.equal(res.passB, true);
    assert.equal(res.deliveryCategory, 'A_AND_B');
  });

  it('evaluates each rolling 5-session window independently and does NOT skip/collapse null delivPer gaps', () => {
    // Two runs of 4 consecutive valid rolling windows separated by ONE null delivPer session.
    // Total >=60% days = 16, valid rolling windows = 8, but null breaks contiguity so maxConsec = 4 -> passA MUST be false!
    const sessions = makeSessions([
      65, 65, 65, 65, 65, 65, 65, 65, // 8 sessions -> 4 consecutive valid rolling windows
      null,                           // missing session breaks all 5 rolling windows touching it
      65, 65, 65, 65, 65, 65, 65, 65, // 8 sessions -> 4 consecutive valid rolling windows
    ]);
    const asOfDate = sessions[sessions.length - 1].date;
    const res = computeDeliveryCategoryAtSlice(sessions, asOfDate, false);

    assert.equal(res.rolling5dGt60Count, 8);
    assert.equal(res.maxConsecutiveRolling5dGt60, 4);
    assert.equal(res.passA, false);
    assert.equal(res.deliveryCategory, 'B_ONLY');

    // Average 5D on a 5-session tail containing a null session must be null (no stale gap-bridging)
    const sessionsEndingWithGap = makeSessions([70, 70, 70, 70, null, 70]);
    assert.equal(computeAverageDelivery5D(sessionsEndingWithGap, false), null);
  });

  it('preserves series-switch gaps via buildSeriesDeliveryTimeline so BE days never bridge EQ rolling windows', () => {
    const startMs = Date.parse('2026-11-01T00:00:00Z');
    const history: DeliverySessionInput[] = [
      ...[65, 65, 65, 65, 65, 65, 65, 65].map((dp, i) => ({
        date: new Date(startMs + i * 86_400_000).toISOString().slice(0, 10),
        series: 'EQ',
        delivPer: dp,
      })),
      {
        date: new Date(startMs + 8 * 86_400_000).toISOString().slice(0, 10),
        series: 'BE',
        delivPer: 100,
      },
      ...[65, 65, 65, 65, 65, 65, 65, 65].map((dp, i) => ({
        date: new Date(startMs + (9 + i) * 86_400_000).toISOString().slice(0, 10),
        series: 'EQ',
        delivPer: dp,
      })),
    ];

    const timeline = buildSeriesDeliveryTimeline(history, 'EQ');
    const res = computeDeliveryCategoryAtSlice(
      timeline,
      timeline[timeline.length - 1].date,
      false
    );
    assert.equal(res.maxConsecutiveRolling5dGt60, 4);
    assert.equal(res.passA, false);
  });

  it('ignores sessions strictly beyond asOfDate and outside the 30-calendar-day inclusive window', () => {
    const sessions = makeSessions([
      80, 80, 80, 80, 80, // outside 30-day window relative to day 35
      ...new Array(26).fill(40),
      80, 80, 80, 80, 80, // future relative to asOfIdx=30
    ]);

    const asOfDate = sessions[30].date; // only 1 day (idx 1..30) in window has 40%
    const res = computeDeliveryCategoryAtSlice(sessions, asOfDate, false);
    assert.equal(res.passA, false);
    assert.equal(res.passB, false);
    assert.equal(res.deliveryCategory, 'NONE');
  });
});

describe('Dynamic Streak Calculation (no hardcoded date overrides)', () => {
  it('computes dynamic streak accurately across all dates including 2026-11-13', () => {
    // End on 2026-11-13 to prove no static override alters dynamic results
    // 10 sessions ending 2026-11-13: first 4 < 5 valid sessions -> WAIT_FOR_DATA;
    // session index 4 (2026-11-08) reaches 5 valid >=60% sessions -> B_ONLY (NEW_QUALIFIER);
    // indices 5..7 stay B_ONLY; index 8 (2026-11-12) reaches 5 consecutive rolling 5D windows -> A_AND_B;
    // index 9 (2026-11-13) continues streak.
    const sessions = makeSessions(
      [62, 62, 62, 62, 62, 62, 62, 62, 62, 62],
      '2026-11-04'
    );
    assert.equal(sessions[sessions.length - 1].date, '2026-11-13');

    const streak = computeDynamicDeliveryStreak(sessions, false, '2026-11-13');
    assert.equal(streak.latestCategory, 'A_AND_B');
    assert.equal(streak.consecutiveStreak, 6); // indices 4..9
    assert.equal(streak.totalQualifyingSessions, 6);
    assert.equal(streak.firstStreakDate, '2026-11-08');
    assert.equal(streak.deliveryStatus, 'ACTIVE_STREAK_6D');
  });

  it('resets consecutiveStreak to 0 when the latest session fails A/B while preserving prior totalQualifyingSessions', () => {
    const sessions = makeSessions([
      65, 65, 65, 65, 65, // idx 4: B_ONLY (total 1)
      65,                 // idx 5: B_ONLY (total 2)
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const streak = computeDynamicDeliveryStreak(sessions, false);
    assert.equal(streak.consecutiveStreak, 0);
    assert.equal(streak.firstStreakDate, '');
    assert.equal(streak.latestCategory, 'NONE');
    assert.equal(streak.deliveryStatus, 'NONE');
    assert.ok(streak.totalQualifyingSessions >= 2);
  });

  it('rejects 4 consecutive windows, enforces exact 60.00% vs 59.99% boundary, and handles duplicate dates / missing market sessions', () => {
    // Exactly 8 sessions at 60.0% => 4 consecutive rolling windows -> passA MUST be false
    const fourWin = makeSessions([60, 60, 60, 60, 60, 60, 60, 60]);
    const res4 = computeDeliveryCategoryAtSlice(fourWin, fourWin[fourWin.length - 1].date, false);
    assert.equal(res4.maxConsecutiveRolling5dGt60, 4);
    assert.equal(res4.passA, false);

    // 9 sessions: window 4 drops to 59.99% => only 4 consecutive >= 60%, NOT 5
    const dipWin = makeSessions([60, 60, 60, 60, 60, 60, 60, 60, 59.95]);
    const resDip = computeDeliveryCategoryAtSlice(dipWin, dipWin[dipWin.length - 1].date, false);
    assert.equal(resDip.maxConsecutiveRolling5dGt60, 4);
    assert.equal(resDip.passA, false);

    // Missing NSE market session in the middle creates a null gap so non-adjacent sessions never bridge a rolling 5D window
    const marketSessions = Array.from({ length: 17 }, (_, i) =>
      new Date(Date.parse('2026-11-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
    );
    const sparseHistory: DeliverySessionInput[] = marketSessions
      .filter((_, idx) => idx !== 8) // stock did not trade / missing Bhavcopy on index 8
      .map((date) => ({ date, series: 'EQ', delivPer: 70 }));

    // Even with duplicate BE row appearing after EQ on day 2, EQ must win
    sparseHistory.push({ date: marketSessions[2], series: 'BE', delivPer: 10 });

    const timeline = buildSeriesDeliveryTimeline(sparseHistory, 'EQ', marketSessions);
    assert.equal(timeline.length, 17);
    assert.equal(timeline[2].series, 'EQ');
    assert.equal(timeline[2].delivPer, 70);
    assert.equal(timeline[8].delivPer, null);

    const gapRes = computeDeliveryCategoryAtSlice(
      timeline,
      marketSessions[marketSessions.length - 1],
      false
    );
    assert.equal(gapRes.maxConsecutiveRolling5dGt60, 4);
    assert.equal(gapRes.passA, false);
  });
});

