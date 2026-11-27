import type { DeliveryCategory } from '../src/types/trading.ts';

export interface DeliverySessionInput {
  readonly date: string;
  readonly series?: string;
  readonly delivPer: number | null;
}

export interface DeliverySliceResult {
  readonly deliveryCategory: DeliveryCategory;
  readonly passA: boolean;
  readonly passB: boolean;
  readonly rolling5dGt60Count: number;
  readonly maxConsecutiveRolling5dGt60: number;
  readonly dailyGt60Count: number;
  readonly valid30dCount: number;
  readonly total30dSessions: number;
}

export interface DynamicStreakResult {
  readonly consecutiveStreak: number;
  readonly totalQualifyingSessions: number;
  readonly firstStreakDate: string;
  readonly deliveryStatus: string;
  readonly latestCategory: DeliveryCategory;
}

export function isDeliveryAB(category: DeliveryCategory): boolean {
  return category === 'A_AND_B' || category === 'A_ONLY' || category === 'B_ONLY';
}

function isValidDelivPer(val: number | null | undefined): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

/**
 * Normalizes a chronological delivery timeline:
 * - Deduplicates multiple entries on the same `date` (preserving the latest occurrence for that date)
 * - Sorts strictly ascending by ISO date (`YYYY-MM-DD`)
 * - Optionally restricts strictly to `date <= asOfDate`
 */
function normalizeTimeline(
  rows: ReadonlyArray<DeliverySessionInput>,
  asOfDate?: string
): DeliverySessionInput[] {
  const byDate = new Map<string, DeliverySessionInput>();
  for (const row of rows) {
    if (!row.date) continue;
    if (asOfDate && row.date > asOfDate) continue;
    byDate.set(row.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
}

function evaluateDeliveryWindowRange(
  sessions: ReadonlyArray<DeliverySessionInput>,
  startIdx: number,
  endIdx: number,
  isIpo: boolean
): DeliverySliceResult {
  const total30dSessions = endIdx >= startIdx ? endIdx - startIdx + 1 : 0;
  let valid30dCount = 0;
  let dailyGt60Count = 0;
  let sumValid = 0;

  for (let i = startIdx; i <= endIdx; i++) {
    const val = sessions[i].delivPer;
    if (isValidDelivPer(val)) {
      valid30dCount++;
      sumValid += val;
      if (val >= 60.0) {
        dailyGt60Count++;
      }
    }
  }

  // Evaluate each rolling 5-trading-session window [i-4..i] independently
  let rolling5dGt60Count = 0;
  let currentConsecutive = 0;
  let maxConsecutiveRolling5dGt60 = 0;

  for (let i = startIdx + 4; i <= endIdx; i++) {
    let windowSum = 0;
    let windowComplete = true;
    for (let j = i - 4; j <= i; j++) {
      const val = sessions[j].delivPer;
      if (!isValidDelivPer(val)) {
        windowComplete = false;
        break;
      }
      windowSum += val;
    }

    if (windowComplete) {
      const avg5 = windowSum / 5;
      if (avg5 >= 60.0) {
        rolling5dGt60Count++;
        currentConsecutive++;
        if (currentConsecutive > maxConsecutiveRolling5dGt60) {
          maxConsecutiveRolling5dGt60 = currentConsecutive;
        }
      } else {
        currentConsecutive = 0;
      }
    } else {
      currentConsecutive = 0;
    }
  }

  let passA = false;
  let passB = false;
  let deliveryCategory: DeliveryCategory = 'NONE';

  if (valid30dCount < 5) {
    if (isIpo && valid30dCount >= 2) {
      const avgDelivShort = sumValid / valid30dCount;
      passA = avgDelivShort >= 60.0;
      passB = dailyGt60Count >= Math.ceil(valid30dCount * 0.6);
      if (passA && passB) deliveryCategory = 'A_AND_B';
      else if (passA) deliveryCategory = 'A_ONLY';
      else if (passB) deliveryCategory = 'B_ONLY';
    } else {
      deliveryCategory = 'WAIT_FOR_DATA';
    }
  } else {
    passA = maxConsecutiveRolling5dGt60 >= 5;
    passB = dailyGt60Count >= 5;
    if (passA && passB) deliveryCategory = 'A_AND_B';
    else if (passA) deliveryCategory = 'A_ONLY';
    else if (passB) deliveryCategory = 'B_ONLY';
  }

  return {
    deliveryCategory,
    passA,
    passB,
    rolling5dGt60Count,
    maxConsecutiveRolling5dGt60,
    dailyGt60Count,
    valid30dCount,
    total30dSessions,
  };
}

/**
 * Builds a delivery timeline across all trading dates in `fullHistory` while enforcing
 * series integrity: sessions belonging to a different series than `targetSeries` stay in the
 * chronological grid with `delivPer = null` so missing/different-series gaps NEVER falsely
 * bridge consecutive 5-trading-session windows or streaks.
 */
export function buildSeriesDeliveryTimeline(
  fullHistory: ReadonlyArray<DeliverySessionInput>,
  targetSeries: string,
  marketSessionDates?: ReadonlyArray<string>
): DeliverySessionInput[] {
  const byDate = new Map<string, DeliverySessionInput>();
  for (const row of fullHistory) {
    if (!row.date) continue;
    const isTargetSeries = row.series === undefined || row.series === targetSeries;
    const mapped: DeliverySessionInput = {
      date: row.date,
      series: row.series,
      delivPer: isTargetSeries
        ? isValidDelivPer(row.delivPer)
          ? row.delivPer
          : null
        : null,
    };
    const prev = byDate.get(row.date);
    if (!prev) {
      byDate.set(row.date, mapped);
    } else {
      const prevWasTarget = prev.series === undefined || prev.series === targetSeries;
      if (isTargetSeries && !prevWasTarget) {
        byDate.set(row.date, mapped);
      } else if (isTargetSeries === prevWasTarget && isValidDelivPer(mapped.delivPer)) {
        byDate.set(row.date, mapped);
      }
    }
  }

  if (marketSessionDates && marketSessionDates.length > 0 && byDate.size > 0) {
    let minDate = '';
    let maxDate = '';
    for (const dt of byDate.keys()) {
      if (!minDate || dt < minDate) minDate = dt;
      if (!maxDate || dt > maxDate) maxDate = dt;
    }
    for (const sessionDt of marketSessionDates) {
      if (sessionDt >= minDate && sessionDt <= maxDate && !byDate.has(sessionDt)) {
        byDate.set(sessionDt, {
          date: sessionDt,
          series: undefined,
          delivPer: null,
        });
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
}

/**
 * Evaluates 30-calendar-day Delivery Cycle A and Cycle B as of `asOfDate`.
 *
 * Cycle A:
 * - Evaluates each rolling 5-trading-session window `[i - 4 .. i]` inside the 30-day window
 *   INDEPENDENTLY. All 5 consecutive trading sessions in the window must have valid finite
 *   `delivPer` (gaps with `null` are NOT skipped/collapsed), and the 5-session arithmetic
 *   mean must be >= 60.0%.
 * - Requires at least 5 CONSECUTIVE qualifying rolling 5-trading-session windows
 *   (`maxConsecutiveRolling5dGt60 >= 5`) within the 30-day lookback.
 *
 * Cycle B:
 * - Requires at least 5 individual trading sessions with `delivPer >= 60.0%` within the
 *   30-day lookback.
 *
 * Preserves existing IPO short-window rules (`2 <= valid30dCount < 5` for IPOs).
 */
export function computeDeliveryCategoryAtSlice(
  seriesSlice: ReadonlyArray<DeliverySessionInput>,
  asOfDate: string,
  isIpo: boolean
): DeliverySliceResult {
  const asOfMs = Date.parse(`${asOfDate}T00:00:00Z`);
  if (!Number.isFinite(asOfMs)) {
    return {
      deliveryCategory: 'WAIT_FOR_DATA',
      passA: false,
      passB: false,
      rolling5dGt60Count: 0,
      maxConsecutiveRolling5dGt60: 0,
      dailyGt60Count: 0,
      valid30dCount: 0,
      total30dSessions: 0,
    };
  }

  const cutoff30dMs = asOfMs - 29 * 24 * 60 * 60 * 1000;
  const timeline = normalizeTimeline(seriesSlice, asOfDate);

  // Preserve every trading session in the 30-day inclusive window without dropping nulls
  const sessions30d = timeline.filter((d) => {
    const ms = Date.parse(`${d.date}T00:00:00Z`);
    return Number.isFinite(ms) && ms >= cutoff30dMs && ms <= asOfMs;
  });

  return evaluateDeliveryWindowRange(sessions30d, 0, sessions30d.length - 1, isIpo);
}

/**
 * Computes the latest 5-trading-session delivery average strictly over the most recent
 * 5 contiguous trading sessions (or 2..4 contiguous valid sessions at the tail for recent IPOs).
 * Returns `null` if any session in the 5-session tail lacks valid `delivPer`.
 */
export function computeAverageDelivery5D(
  seriesRows: ReadonlyArray<DeliverySessionInput>,
  isIpo: boolean,
  asOfDate?: string
): number | null {
  const timeline = normalizeTimeline(seriesRows, asOfDate);
  if (timeline.length >= 5) {
    const tail5 = timeline.slice(-5);
    if (tail5.every((d) => isValidDelivPer(d.delivPer))) {
      return tail5.reduce((acc, d) => acc + (d.delivPer as number), 0) / 5;
    }
    return null;
  }

  if (isIpo && timeline.length >= 2) {
    if (timeline.every((d) => isValidDelivPer(d.delivPer))) {
      return timeline.reduce((acc, d) => acc + (d.delivPer as number), 0) / timeline.length;
    }
  }

  return null;
}

/**
 * Dynamically computes the unbroken trailing A/B qualifying streak and total qualifying
 * sessions across the chronological timeline with zero hardcoded date overrides.
 */
export function computeDynamicDeliveryStreak(
  seriesRows: ReadonlyArray<DeliverySessionInput>,
  isIpoOrResolver: boolean | ((asOfDate: string) => boolean),
  asOfDate?: string
): DynamicStreakResult {
  const timeline = normalizeTimeline(seriesRows, asOfDate);
  if (timeline.length === 0) {
    return {
      consecutiveStreak: 0,
      totalQualifyingSessions: 0,
      firstStreakDate: '',
      deliveryStatus: 'WAIT_FOR_DATA',
      latestCategory: 'WAIT_FOR_DATA',
    };
  }

  const dateMs = new Float64Array(timeline.length);
  let allDatesFinite = true;
  for (let k = 0; k < timeline.length; k++) {
    const ms = Date.parse(`${timeline[k].date}T00:00:00Z`);
    dateMs[k] = ms;
    if (!Number.isFinite(ms)) allDatesFinite = false;
  }

  let totalQualifyingSessions = 0;
  let consecutiveStreak = 0;
  let firstStreakDate = '';
  let streakOpen = true;
  let latestCategory: DeliveryCategory = 'NONE';
  const windowDaysMs = 29 * 24 * 60 * 60 * 1000;
  let startPtr = timeline.length - 1;

  for (let i = timeline.length - 1; i >= 0; i--) {
    const sliceDate = timeline[i].date;
    const isIpoAtDate =
      typeof isIpoOrResolver === 'function' ? isIpoOrResolver(sliceDate) : isIpoOrResolver;

    let res: DeliverySliceResult;
    if (allDatesFinite) {
      const asOfMs = dateMs[i];
      const cutoff30dMs = asOfMs - windowDaysMs;
      if (startPtr > i) startPtr = i;
      while (startPtr > 0 && dateMs[startPtr - 1] >= cutoff30dMs) {
        startPtr--;
      }
      while (startPtr <= i && dateMs[startPtr] < cutoff30dMs) {
        startPtr++;
      }
      res = evaluateDeliveryWindowRange(timeline, startPtr, i, isIpoAtDate);
    } else {
      res = computeDeliveryCategoryAtSlice(timeline.slice(0, i + 1), sliceDate, isIpoAtDate);
    }

    if (i === timeline.length - 1) {
      latestCategory = res.deliveryCategory;
    }

    if (isDeliveryAB(res.deliveryCategory)) {
      totalQualifyingSessions++;
      if (streakOpen) {
        consecutiveStreak++;
        firstStreakDate = sliceDate;
      }
    } else {
      streakOpen = false;
    }
  }

  const deliveryStatus = isDeliveryAB(latestCategory)
    ? consecutiveStreak > 1
      ? `ACTIVE_STREAK_${consecutiveStreak}D`
      : 'NEW_QUALIFIER'
    : latestCategory;

  return {
    consecutiveStreak,
    totalQualifyingSessions,
    firstStreakDate,
    deliveryStatus,
    latestCategory,
  };
}
