export type QuoteBadgeLabel = 'STALE DATA' | 'CLOSED' | null;

export interface QuoteFreshnessInput {
  readonly lastUpdated?: string | number | null;
  readonly marketTimeUnixSec?: number | null;
  readonly marketTimeIst?: string | null;
  readonly marketDateIst?: string | null;
  readonly timestamp?: string | null;
  readonly marketState?: string | null;
  readonly now?: Date;
}

export interface QuoteFreshnessResult {
  readonly isLive: boolean;
  readonly isStale: boolean;
  readonly isPreviousTradingDay: boolean;
  readonly isSameTradingDay: boolean;
  readonly isMarketClosed: boolean;
  readonly quoteDateIst: string | null;
  readonly systemDateIst: string;
  readonly badgeLabel: QuoteBadgeLabel;
  readonly headerLabel: string;
  readonly reason: string | null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MONTH_MAP: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

export function toIstCalendarDate(date: Date = new Date()): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseTimestampStringToIstDate(rawInput: string): string | null {
  const raw = rawInput.trim();
  if (!raw) return null;

  // Bare YYYY-MM-DD date
  const bareDateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (bareDateMatch) {
    return bareDateMatch[1];
  }

  // Direct YYYY-MM-DD HH:mm... IST format
  const istPrefixedMatch = raw.match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}(?::\d{2})?\s*IST$/i);
  if (istPrefixedMatch) {
    return istPrefixedMatch[1];
  }

  // NSE API format e.g. "25-Nov-2026 15:30:00" or "25-Nov-2026"
  const nseMatch = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\b/);
  if (nseMatch) {
    const day = nseMatch[1].padStart(2, '0');
    const month = MONTH_MAP[nseMatch[2].toUpperCase()];
    const year = nseMatch[3];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  // Standard ISO / RFC timestamp (UTC or explicit offset)
  const parsedMs = Date.parse(raw);
  if (!Number.isNaN(parsedMs)) {
    return toIstCalendarDate(new Date(parsedMs));
  }

  // Fallback leading YYYY-MM-DD if present
  const leadingIso = raw.match(/^(\d{4}-\d{2}-\d{2})\b/);
  if (leadingIso) {
    return leadingIso[1];
  }

  return null;
}

/**
 * Extracts an IST calendar date (`YYYY-MM-DD`) from `lastUpdated`, Unix epoch seconds,
 * an IST string (`YYYY-MM-DD HH:mm IST`), an NSE timestamp (`DD-MMM-YYYY HH:mm:ss`),
 * or an ISO timestamp.
 */
export function extractQuoteDateIst(input: {
  readonly lastUpdated?: string | number | null;
  readonly marketTimeUnixSec?: number | null;
  readonly marketTimeIst?: string | null;
  readonly marketDateIst?: string | null;
  readonly timestamp?: string | null;
}): string | null {
  if (
    typeof input.marketDateIst === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.marketDateIst.trim())
  ) {
    return input.marketDateIst.trim();
  }

  if (
    typeof input.marketTimeUnixSec === 'number' &&
    Number.isFinite(input.marketTimeUnixSec) &&
    input.marketTimeUnixSec > 0
  ) {
    return toIstCalendarDate(new Date(input.marketTimeUnixSec * 1000));
  }

  if (typeof input.lastUpdated === 'number' && Number.isFinite(input.lastUpdated) && input.lastUpdated > 0) {
    const ms = input.lastUpdated >= 1e12 ? input.lastUpdated : input.lastUpdated * 1000;
    return toIstCalendarDate(new Date(ms));
  }

  if (typeof input.lastUpdated === 'string' && input.lastUpdated.trim().length > 0) {
    const parsed = parseTimestampStringToIstDate(input.lastUpdated);
    if (parsed) return parsed;
  }

  if (typeof input.marketTimeIst === 'string' && input.marketTimeIst.trim().length > 0) {
    const parsed = parseTimestampStringToIstDate(input.marketTimeIst);
    if (parsed) return parsed;
  }

  if (typeof input.timestamp === 'string' && input.timestamp.trim().length > 0) {
    const parsed = parseTimestampStringToIstDate(input.timestamp);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Safety check comparing a quote's returned `lastUpdated` / market timestamp against the current IST system date.
 * If the API quote belongs to a previous trading session (or lacks a verifiable timestamp), flags it as
 * `STALE DATA` with `isLive: false` so the UI never shows green live indicators for old data.
 */
export function evaluateQuoteFreshness(
  input: QuoteFreshnessInput
): QuoteFreshnessResult {
  const now = input.now ?? new Date();
  const systemDateIst = toIstCalendarDate(now);
  const quoteDateIst = extractQuoteDateIst(input);
  const normalizedState = (input.marketState || '').trim().toUpperCase();
  const isMarketClosed =
    normalizedState === 'CLOSED' ||
    normalizedState === 'POST' ||
    normalizedState === 'POSTPOST' ||
    normalizedState === 'PREPRE';

  if (quoteDateIst === null) {
    return {
      isLive: false,
      isStale: true,
      isPreviousTradingDay: false,
      isSameTradingDay: false,
      isMarketClosed,
      quoteDateIst: null,
      systemDateIst,
      badgeLabel: 'STALE DATA',
      headerLabel: isMarketClosed
        ? 'Closed / Unverified Quote (vs EOD)'
        : 'Reference Quote (vs EOD)',
      reason: 'Missing or unparseable lastUpdated timestamp from quote API.',
    };
  }

  const isPreviousTradingDay = quoteDateIst < systemDateIst;
  const isSameTradingDay = quoteDateIst === systemDateIst;

  if (isPreviousTradingDay) {
    return {
      isLive: false,
      isStale: true,
      isPreviousTradingDay: true,
      isSameTradingDay: false,
      isMarketClosed,
      quoteDateIst,
      systemDateIst,
      badgeLabel: 'STALE DATA',
      headerLabel: 'Previous Session Price (vs EOD)',
      reason: `Quote lastUpdated is from ${quoteDateIst} (previous session before ${systemDateIst} IST).`,
    };
  }

  if (isMarketClosed) {
    return {
      isLive: false,
      isStale: false,
      isPreviousTradingDay: false,
      isSameTradingDay,
      isMarketClosed: true,
      quoteDateIst,
      systemDateIst,
      badgeLabel: 'CLOSED',
      headerLabel: 'Closed Session Price (vs EOD)',
      reason: `Market state is ${normalizedState} for ${quoteDateIst}.`,
    };
  }

  return {
    isLive: true,
    isStale: false,
    isPreviousTradingDay: false,
    isSameTradingDay,
    isMarketClosed: false,
    quoteDateIst,
    systemDateIst,
    badgeLabel: null,
    headerLabel: 'Current Live Price (vs EOD)',
    reason: null,
  };
}
