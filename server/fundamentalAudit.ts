import type { FundamentalFreshness } from '../src/types/trading.ts';

export const LATEST_DATA_MAX_AGE_DAYS = 90;
export const DEFAULT_MAX_DATA_AGE_DAYS = 548;

export interface ClassifyFundamentalFreshnessInput {
  readonly ageDays: number | null;
  readonly maxDataAgeDays?: number | null;
  readonly bestPeriod?: string;
  readonly sourcesLabel: string;
  readonly newerXbrlNote?: string;
}

export interface FundamentalFreshnessClassification {
  readonly fundamentalFreshness: FundamentalFreshness;
  readonly fundamentalAgeDays: number | null;
  readonly maxDataAgeDays: number;
  readonly fundamentalRemark: string;
}

/**
 * Resolves the active maximum allowed fundamental data age in days from `fundamental_thresholds.json`,
 * falling back to `DEFAULT_MAX_DATA_AGE_DAYS` (548 days) and never dropping below the 90-day LATEST tier.
 */
export function resolveMaxDataAgeDays(maxDataAgeDays?: number | null): number {
  if (
    typeof maxDataAgeDays === 'number' &&
    Number.isFinite(maxDataAgeDays) &&
    maxDataAgeDays > 0
  ) {
    return Math.max(LATEST_DATA_MAX_AGE_DAYS, Math.round(maxDataAgeDays));
  }
  return DEFAULT_MAX_DATA_AGE_DAYS;
}

/**
 * Classifies fundamental data freshness strictly in alignment with `max_data_age_days`
 * from `fundamental_thresholds.json`:
 * - `LATEST`:   ageDays <= 90 days
 * - `OLD_3M`:   91 .. maxDataAgeDays (default 548 days)
 * - `STALE`:    ageDays > maxDataAgeDays (or missing/unverified period date)
 */
export function classifyFundamentalFreshness(
  input: ClassifyFundamentalFreshnessInput
): FundamentalFreshnessClassification {
  const effectiveMaxAgeDays = resolveMaxDataAgeDays(input.maxDataAgeDays);
  const periodLabel = input.bestPeriod || '';
  const xbrlNote = input.newerXbrlNote || '';

  if (input.ageDays === null || !Number.isFinite(input.ageDays)) {
    return {
      fundamentalFreshness: 'STALE',
      fundamentalAgeDays: null,
      maxDataAgeDays: effectiveMaxAgeDays,
      fundamentalRemark: `Old / Date Unverified (Period date missing · ${input.sourcesLabel}${xbrlNote})`,
    };
  }

  if (input.ageDays <= LATEST_DATA_MAX_AGE_DAYS) {
    return {
      fundamentalFreshness: 'LATEST',
      fundamentalAgeDays: input.ageDays,
      maxDataAgeDays: effectiveMaxAgeDays,
      fundamentalRemark: `Latest (<=90d · ${input.ageDays}d ago · Period ${periodLabel} · ${input.sourcesLabel})`,
    };
  }

  if (input.ageDays <= effectiveMaxAgeDays) {
    return {
      fundamentalFreshness: 'OLD_3M',
      fundamentalAgeDays: input.ageDays,
      maxDataAgeDays: effectiveMaxAgeDays,
      fundamentalRemark: `3+ Months Old (91–${effectiveMaxAgeDays}d · ${input.ageDays}d ago · Period ${periodLabel} · ${input.sourcesLabel}${xbrlNote})`,
    };
  }

  return {
    fundamentalFreshness: 'STALE',
    fundamentalAgeDays: input.ageDays,
    maxDataAgeDays: effectiveMaxAgeDays,
    fundamentalRemark: `Old / Stale (>${effectiveMaxAgeDays}d · ${input.ageDays}d ago · Period ${periodLabel} · ${input.sourcesLabel}${xbrlNote})`,
  };
}
