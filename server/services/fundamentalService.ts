import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LRUCache } from 'lru-cache';
import {
  fetchTrustedIndianFundamentals,
  getScreenerRateLimitState,
  loadIndianFundamentalsCache,
  saveIndianFundamentalsEntry,
  type AnnualStatementYear,
  type IndianFundamentalsPayload,
} from '../indianFundamentals.ts';
import type { XbrlFiling } from '../../src/types/trading.ts';
import {
  defaultIndianStockDataService,
  IndianStockDataService,
  normalizeSymbol,
  type HistoricalPriceBar,
  type LiveQuote,
  type ParsedTableRow,
  type ScreenerFundamentals,
  type ServiceResult,
} from './indianStockDataService.ts';

export {
  defaultIndianStockDataService,
  IndianStockDataService,
  type HistoricalPriceBar,
  type LiveQuote,
  type ScreenerFundamentals,
  type ServiceResult,
};

export type FundamentalVerificationStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'STALE_CACHE'
  | 'UNAVAILABLE';

export interface FundamentalVerificationReport {
  status: FundamentalVerificationStatus;
  scorePct: number;
  verifiedFieldsCount: number;
  totalCoreFields: number;
  missingCoreFields: string[];
  anomalies: string[];
  periodAgeDays: number | null;
  trustedIndianSource: boolean;
}

export interface FundamentalCacheMeta {
  fromCache: boolean;
  staleFallback: boolean;
  dedupedInFlight: boolean;
  ttlRemainingSec: number;
  fetchedAtUtc: string;
}

export interface VerifiedFundamentalResult {
  symbol: string;
  payload: IndianFundamentalsPayload | null;
  verification: FundamentalVerificationReport;
  cacheMeta: FundamentalCacheMeta;
  warnings: string[];
  error: string | null;
}

export interface FetchFundamentalOptions {
  xbrlFilings?: XbrlFiling[];
  forceRefresh?: boolean;
  forceBseProbe?: boolean;
  ttlMs?: number;
  /**
   * Preserved for API compatibility; live quote fallback now uses `nse-bse-api` only.
   */
  allowYahooSupplement?: boolean;
}

export interface FundamentalServiceHealth {
  cachedSymbolsCount: number;
  inFlightCount: number;
  metrics: {
    cacheHits: number;
    staleFallbacks: number;
    dedupedCalls: number;
    liveFetches: number;
    liveSuccesses: number;
    liveFailures: number;
    nseBseQuoteCalls: number;
    failureCooldownSkips: number;
  };
  screenerRateLimit: ReturnType<typeof getScreenerRateLimitState>;
  lruCache: ReturnType<IndianStockDataService['getCacheHealth']>;
  negativeCooldownSymbolsCount: number;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const CRORE_IN_INR = 1e7;

const payloadLruCache = new LRUCache<string, IndianFundamentalsPayload>({
  max: 500,
  ttl: DEFAULT_TTL_MS,
});
const inFlightRequests = new Map<string, Promise<VerifiedFundamentalResult>>();
const failureCooldownMap = new Map<string, { untilMs: number; reason: string }>();

const serviceMetrics = {
  cacheHits: 0,
  staleFallbacks: 0,
  dedupedCalls: 0,
  liveFetches: 0,
  liveSuccesses: 0,
  liveFailures: 0,
  nseBseQuoteCalls: 0,
  failureCooldownSkips: 0,
};

function toIstDateIso(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const MONTH_INDEX: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function periodLabelToEndDate(periodLabel: string): string {
  const match = periodLabel.trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return '';
  const mm = MONTH_INDEX[match[1].toLowerCase()];
  if (!mm) return '';
  const year = Number(match[2]);
  const monthNum = Number(mm);
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
}

function findRowNumber(
  rows: ParsedTableRow[],
  period: string,
  matchers: string[]
): number | null {
  for (const row of rows) {
    const norm = row.label.replace(/\+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (matchers.some((m) => norm.includes(m))) {
      return row.valuesByPeriod[period] ?? null;
    }
  }
  return null;
}

function extractPeriodsFromRows(rows: ParsedTableRow[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0].valuesByPeriod);
}

function computeYoYPct(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(2));
}

export function mapScreenerToIndianPayload(
  screener: ScreenerFundamentals,
  liveQuote: LiveQuote | null = null
): IndianFundamentalsPayload {
  const qRecords = screener.quarterlyResults.records;
  const qCount = qRecords.length;
  const latestQ = qCount >= 1 ? qRecords[qCount - 1] : null;
  const yoyPrevQ =
    qCount >= 5 ? qRecords[qCount - 5] : qCount >= 2 ? qRecords[qCount - 2] : null;

  // Compute TTM EPS (sum of last 4 quarters) & prior TTM EPS where available
  const epsVals = qRecords.map((r) => r.eps);
  let epsTtmCurr: number | null = null;
  if (qCount >= 4) {
    const last4 = epsVals.slice(-4);
    if (last4.every((v): v is number => v !== null)) {
      epsTtmCurr = Number(last4.reduce((a, b) => a + b, 0).toFixed(2));
    }
  }

  let epsTtmPrev: number | null = null;
  if (qCount >= 8) {
    const prev4 = epsVals.slice(-8, -4);
    if (prev4.every((v): v is number => v !== null)) {
      epsTtmPrev = Number(prev4.reduce((a, b) => a + b, 0).toFixed(2));
    }
  }

  // Annual Profit & Loss + Cash Flow + Balance Sheet mapping
  const plPeriods = extractPeriodsFromRows(screener.profitLossRows).filter(
    (p) => p.toUpperCase() !== 'TTM'
  );
  const bsByPeriod = new Map(screener.balanceSheet.records.map((r) => [r.period, r]));

  const annualYears: AnnualStatementYear[] = plPeriods.slice(-5).map((period) => {
    const salesCr = findRowNumber(screener.profitLossRows, period, ['sales', 'revenue']);
    const opProfitCr = findRowNumber(screener.profitLossRows, period, ['operating profit']);
    const interestCr = findRowNumber(screener.profitLossRows, period, ['interest']);
    const depCr = findRowNumber(screener.profitLossRows, period, ['depreciation']);
    const netProfitCr = findRowNumber(screener.profitLossRows, period, ['net profit']);
    const eps = findRowNumber(screener.profitLossRows, period, ['eps']);
    const ocfCr = findRowNumber(screener.cashFlowRows, period, ['cash from operating activity']);
    const fixedAssetsPurchasedCr = findRowNumber(screener.cashFlowRows, period, [
      'fixed assets purchased',
    ]);
    const bs = bsByPeriod.get(period);
    const equityCr =
      bs && bs.equityCapitalCr !== null && bs.reservesCr !== null
        ? bs.equityCapitalCr + bs.reservesCr
        : null;
    const ebitCr =
      opProfitCr !== null && depCr !== null ? opProfitCr - depCr : opProfitCr;
    const fcfCr =
      ocfCr !== null && fixedAssetsPurchasedCr !== null
        ? ocfCr + fixedAssetsPurchasedCr
        : null;

    return {
      asOfDate: periodLabelToEndDate(period) || period,
      revenue: salesCr !== null ? Math.round(salesCr * CRORE_IN_INR) : null,
      grossProfit: null,
      netIncome: netProfitCr !== null ? Math.round(netProfitCr * CRORE_IN_INR) : null,
      ebit: ebitCr !== null ? Math.round(ebitCr * CRORE_IN_INR) : null,
      ebitda: opProfitCr !== null ? Math.round(opProfitCr * CRORE_IN_INR) : null,
      interestExpense: interestCr !== null ? Math.round(interestCr * CRORE_IN_INR) : null,
      totalAssets:
        bs?.totalAssetsCr !== null && bs?.totalAssetsCr !== undefined
          ? Math.round(bs.totalAssetsCr * CRORE_IN_INR)
          : null,
      currentAssets: null,
      currentLiabilities: null,
      equity: equityCr !== null ? Math.round(equityCr * CRORE_IN_INR) : null,
      totalDebt:
        bs?.borrowingsCr !== null && bs?.borrowingsCr !== undefined
          ? Math.round(bs.borrowingsCr * CRORE_IN_INR)
          : null,
      ocf: ocfCr !== null ? Math.round(ocfCr * CRORE_IN_INR) : null,
      fcf: fcfCr !== null ? Math.round(fcfCr * CRORE_IN_INR) : null,
      shares: null,
      dilutedEps: eps,
    };
  });

  const latestAnnual = annualYears[annualYears.length - 1];
  const latestQuarterlyRevGrowth =
    latestQ && yoyPrevQ ? computeYoYPct(latestQ.salesCr, yoyPrevQ.salesCr) : null;
  const latestQuarterlyProfitGrowth =
    latestQ && yoyPrevQ ? computeYoYPct(latestQ.netProfitCr, yoyPrevQ.netProfitCr) : null;

  const interestCoverage =
    latestQ &&
    latestQ.operatingProfitCr !== null &&
    latestQ.interestCr !== null &&
    latestQ.interestCr > 0
      ? Number((latestQ.operatingProfitCr / latestQ.interestCr).toFixed(2))
      : latestAnnual?.ebit !== null &&
          latestAnnual?.interestExpense !== null &&
          latestAnnual?.interestExpense !== undefined &&
          latestAnnual.interestExpense > 0 &&
          latestAnnual.ebit !== undefined
        ? Number((latestAnnual.ebit / latestAnnual.interestExpense).toFixed(2))
        : null;

  const currentPrice = liveQuote?.lastPrice ?? screener.topRatios.currentPrice;
  const marketCapInr =
    screener.topRatios.marketCapCr !== null
      ? Math.round(screener.topRatios.marketCapCr * CRORE_IN_INR)
      : null;
  const bookValuePerShare = screener.topRatios.bookValue;
  const priceToBook =
    currentPrice !== null && bookValuePerShare !== null && bookValuePerShare > 0
      ? Number((currentPrice / bookValuePerShare).toFixed(2))
      : null;

  const latestSh = screener.shareholding[screener.shareholding.length - 1];
  const sources = ['Screener.in'];
  if (liveQuote) {
    sources.push(liveQuote.exchange === 'BSE' ? 'BSE Official' : 'NSE Live Quote');
  }

  return {
    symbol: screener.symbol,
    asOfDate: toIstDateIso(),
    source: sources.join(' + '),
    sourceUrl: screener.sourceUrl,
    sources,
    financialPeriodEnd:
      (latestQ ? periodLabelToEndDate(latestQ.period) : '') ||
      latestAnnual?.asOfDate ||
      '',
    companyName: liveQuote?.companyName || screener.companyName,
    providerSector: '',
    bseScripCode: liveQuote?.bseScripCode,
    marketCapInr,
    freeFloatMcapInr: null,
    enterpriseValueInr:
      marketCapInr !== null && latestAnnual?.totalDebt !== null && latestAnnual?.totalDebt !== undefined
        ? marketCapInr + latestAnnual.totalDebt
        : null,
    currentPrice,
    trailingPE: screener.peRatio,
    bookValuePerShare,
    priceToBook,
    dividendYieldPct: screener.topRatios.dividendYieldPct,
    roePct: screener.roePct,
    rocePct: screener.rocePct,
    revenueGrowthPct: latestQuarterlyRevGrowth,
    profitGrowthPct: latestQuarterlyProfitGrowth,
    debtToEquity: screener.debtToEquity,
    interestCoverage,
    operatingCashFlowInr: latestAnnual?.ocf ?? null,
    freeCashFlowInr: latestAnnual?.fcf ?? null,
    sharesOutstanding:
      marketCapInr !== null && currentPrice !== null && currentPrice > 0
        ? Math.round(marketCapInr / currentPrice)
        : null,
    evToEbitda: null,
    epsCurr: latestQ?.eps ?? null,
    epsPrev: yoyPrevQ?.eps ?? null,
    epsCurrPeriod: latestQ?.period ?? '',
    epsPrevPeriod: yoyPrevQ?.period ?? '',
    epsTtmCurr,
    epsTtmPrev,
    promoterHoldingPct: latestSh?.promoterPct ?? null,
    fiiHoldingPct: latestSh?.fiiPct ?? null,
    diiHoldingPct: latestSh?.diiPct ?? null,
    publicHoldingPct: latestSh?.publicPct ?? null,
    shareholdingQuarters: screener.shareholding.map((s) => ({
      period: s.period,
      promoterPct: s.promoterPct,
      fiiPct: s.fiiPct,
      diiPct: s.diiPct,
    })),
    annualYears,
    fetchedAtUtc: screener.fetchedAtUtc,
  };
}

export function verifyFundamentalIntegrity(
  payload: IndianFundamentalsPayload | null,
  staleFallback = false
): FundamentalVerificationReport {
  if (!payload) {
    return {
      status: 'UNAVAILABLE',
      scorePct: 0,
      verifiedFieldsCount: 0,
      totalCoreFields: 8,
      missingCoreFields: [
        'marketCapInr',
        'trailingPE',
        'roePct',
        'debtToEquity',
        'epsCurr',
        'epsTtmCurr',
        'revenueGrowthPct',
        'promoterHoldingPct',
      ],
      anomalies: ['No fundamental record available from upstream sources or cache.'],
      periodAgeDays: null,
      trustedIndianSource: false,
    };
  }

  const coreChecks: Array<[string, boolean]> = [
    ['marketCapInr', payload.marketCapInr !== null && payload.marketCapInr > 0],
    ['trailingPE', payload.trailingPE !== null && payload.trailingPE > 0 && payload.trailingPE < 1000],
    ['roePct', payload.roePct !== null && Number.isFinite(payload.roePct)],
    ['debtToEquity', payload.debtToEquity !== null && payload.debtToEquity >= 0],
    ['epsCurr', payload.epsCurr !== null && Number.isFinite(payload.epsCurr)],
    ['epsTtmCurr', payload.epsTtmCurr !== null && Number.isFinite(payload.epsTtmCurr)],
    ['revenueGrowthPct', payload.revenueGrowthPct !== null && Number.isFinite(payload.revenueGrowthPct)],
    ['promoterHoldingPct', payload.promoterHoldingPct !== null && payload.promoterHoldingPct >= 0],
  ];

  const verifiedFieldsCount = coreChecks.filter(([, ok]) => ok).length;
  const missingCoreFields = coreChecks.filter(([, ok]) => !ok).map(([name]) => name);

  const anomalies: string[] = [];
  if (payload.trailingPE !== null && (payload.trailingPE <= 0 || payload.trailingPE >= 1000)) {
    anomalies.push(`Outlier P/E detected (${payload.trailingPE}).`);
  }
  if (payload.marketCapInr !== null && payload.marketCapInr <= 0) {
    anomalies.push(`Invalid Market Cap (${payload.marketCapInr}).`);
  }
  const shSum =
    (payload.promoterHoldingPct ?? 0) +
    (payload.fiiHoldingPct ?? 0) +
    (payload.diiHoldingPct ?? 0);
  if (shSum > 105) {
    anomalies.push(`Shareholding total exceeds 105% (${shSum.toFixed(1)}%).`);
  }

  let periodAgeDays: number | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(payload.financialPeriodEnd)) {
    const ts = Date.parse(`${payload.financialPeriodEnd}T00:00:00Z`);
    if (Number.isFinite(ts)) {
      periodAgeDays = Math.max(0, Math.round((Date.now() - ts) / 86400000));
    }
  }

  const trustedIndianSource =
    payload.sources.includes('Screener.in') ||
    payload.sources.includes('BSE Official') ||
    payload.sources.includes('NSE XBRL');

  let status: FundamentalVerificationStatus;
  if (staleFallback) {
    status = 'STALE_CACHE';
  } else if (verifiedFieldsCount >= 6 && trustedIndianSource && anomalies.length === 0) {
    status = 'VERIFIED';
  } else if (verifiedFieldsCount >= 3) {
    status = 'PARTIAL';
  } else {
    status = 'UNAVAILABLE';
  }

  return {
    status,
    scorePct: Math.round((verifiedFieldsCount / coreChecks.length) * 100),
    verifiedFieldsCount,
    totalCoreFields: coreChecks.length,
    missingCoreFields,
    anomalies,
    periodAgeDays,
    trustedIndianSource,
  };
}

/**
 * Fetch, verify, and LRU-cache fundamental data for an Indian equity symbol.
 * Uses `screener-india` for all fundamental metrics (P/E, ROE, ROCE, Debt/Equity,
 * quarterly results, balance sheet) and `nse-bse-api` strictly for live quote confirmation.
 */
export async function getVerifiedFundamentals(
  symbol: string,
  options: FetchFundamentalOptions = {}
): Promise<VerifiedFundamentalResult> {
  const sym = normalizeSymbol(symbol);
  if (!sym) {
    return {
      symbol: '',
      payload: null,
      verification: verifyFundamentalIntegrity(null),
      cacheMeta: {
        fromCache: false,
        staleFallback: false,
        dedupedInFlight: false,
        ttlRemainingSec: 0,
        fetchedAtUtc: '',
      },
      warnings: ['Empty symbol provided.'],
      error: 'Symbol is required.',
    };
  }

  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const forceRefresh = Boolean(options.forceRefresh);
  const diskCache = loadIndianFundamentalsCache();
  const cachedEntry = payloadLruCache.get(sym) ?? diskCache[sym] ?? null;

  // 1. Fresh LRU / disk cache hit
  if (!forceRefresh && cachedEntry) {
    const ageMs = Date.now() - Date.parse(cachedEntry.fetchedAtUtc);
    const hasTrusted =
      cachedEntry.sources.includes('Screener.in') ||
      cachedEntry.sources.includes('BSE Official');
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs && hasTrusted) {
      payloadLruCache.set(sym, cachedEntry);
      serviceMetrics.cacheHits += 1;
      const ttlRemainingSec = Math.max(0, Math.round((ttlMs - ageMs) / 1000));
      return {
        symbol: sym,
        payload: cachedEntry,
        verification: verifyFundamentalIntegrity(cachedEntry, false),
        cacheMeta: {
          fromCache: true,
          staleFallback: false,
          dedupedInFlight: false,
          ttlRemainingSec,
          fetchedAtUtc: cachedEntry.fetchedAtUtc,
        },
        warnings: [],
        error: null,
      };
    }
  }

  // 2. Negative-lookup cooldown check
  const negCooldown = failureCooldownMap.get(sym);
  if (!forceRefresh && negCooldown && Date.now() < negCooldown.untilMs) {
    serviceMetrics.failureCooldownSkips += 1;
    return {
      symbol: sym,
      payload: cachedEntry,
      verification: verifyFundamentalIntegrity(cachedEntry, Boolean(cachedEntry)),
      cacheMeta: {
        fromCache: Boolean(cachedEntry),
        staleFallback: Boolean(cachedEntry),
        dedupedInFlight: false,
        ttlRemainingSec: 0,
        fetchedAtUtc: cachedEntry?.fetchedAtUtc || '',
      },
      warnings: [
        `Skipped upstream call during failure cooldown (${negCooldown.reason}).`,
      ],
      error: cachedEntry ? null : negCooldown.reason,
    };
  }

  // 3. In-flight request deduplication
  const flightKey = `${sym}:${forceRefresh ? '1' : '0'}`;
  const existingFlight = inFlightRequests.get(flightKey);
  if (existingFlight) {
    serviceMetrics.dedupedCalls += 1;
    const shared = await existingFlight;
    return {
      ...shared,
      cacheMeta: {
        ...shared.cacheMeta,
        dedupedInFlight: true,
      },
    };
  }

  const task = (async (): Promise<VerifiedFundamentalResult> => {
    serviceMetrics.liveFetches += 1;
    const warnings: string[] = [];
    const rlState = getScreenerRateLimitState();
    if (rlState.cooldownActive) {
      warnings.push(
        `Screener.in rate-limit cooldown active (${rlState.cooldownRemainingSec}s remaining).`
      );
    }

    let payload: IndianFundamentalsPayload | null = null;
    let upstreamError: string | null = null;

    // Fetch fundamentals via `screener-india` and live quote via `nse-bse-api` concurrently
    serviceMetrics.nseBseQuoteCalls += 1;
    const [screenerRes, quoteRes] = await Promise.all([
      defaultIndianStockDataService.getFundamentals(sym, { forceRefresh }),
      defaultIndianStockDataService.getLiveQuote(sym, { forceRefresh }),
    ]);

    if (screenerRes.warnings.length > 0) {
      warnings.push(...screenerRes.warnings);
    }
    if (!quoteRes.ok && quoteRes.error) {
      warnings.push(`nse-bse-api live quote unavailable (${quoteRes.error}); using Screener price.`);
    }

    if (screenerRes.ok && screenerRes.data) {
      payload = mapScreenerToIndianPayload(screenerRes.data, quoteRes.data);
    } else {
      upstreamError = screenerRes.error || 'screener-india fetch failed';
      warnings.push(`screener-india failed: ${upstreamError}`);
    }

    // Optional NSE XBRL / BSE filing merge if XBRL filings were passed or Screener failed
    if ((options.xbrlFilings && options.xbrlFilings.length > 0) || !payload) {
      try {
        const legacyIndian = await fetchTrustedIndianFundamentals(sym, options.xbrlFilings, {
          forceRefresh,
          forceBseProbe: options.forceBseProbe,
        });
        if (!payload) {
          payload = legacyIndian;
        } else {
          const mergedSources = Array.from(new Set([...payload.sources, ...legacyIndian.sources]));
          payload = {
            ...payload,
            sources: mergedSources,
            source: mergedSources.join(' + '),
            financialPeriodEnd: payload.financialPeriodEnd || legacyIndian.financialPeriodEnd,
            publicationDate: legacyIndian.publicationDate ?? payload.publicationDate,
            officialFilingUrl: legacyIndian.officialFilingUrl ?? payload.officialFilingUrl,
            officialFilingSource: legacyIndian.officialFilingSource ?? payload.officialFilingSource,
            providerSector: payload.providerSector || legacyIndian.providerSector,
            bseScripCode: payload.bseScripCode || legacyIndian.bseScripCode,
            nextEarningsDate: legacyIndian.nextEarningsDate ?? payload.nextEarningsDate,
            revenueGrowthPct: payload.revenueGrowthPct ?? legacyIndian.revenueGrowthPct,
            profitGrowthPct: payload.profitGrowthPct ?? legacyIndian.profitGrowthPct,
            roePct: payload.roePct ?? legacyIndian.roePct,
            rocePct: payload.rocePct ?? legacyIndian.rocePct,
            debtToEquity: payload.debtToEquity ?? legacyIndian.debtToEquity,
            interestCoverage: payload.interestCoverage ?? legacyIndian.interestCoverage,
          };
        }
      } catch (err) {
        if (!payload) {
          upstreamError =
            upstreamError || (err instanceof Error ? err.message : 'Indian sources unavailable');
        }
      }
    }

    if (payload) {
      serviceMetrics.liveSuccesses += 1;
      failureCooldownMap.delete(sym);
      payloadLruCache.set(sym, payload);
      await saveIndianFundamentalsEntry(payload).catch(() => {});

      const verification = verifyFundamentalIntegrity(payload, false);
      if (verification.anomalies.length > 0) {
        warnings.push(...verification.anomalies);
      }
      return {
        symbol: sym,
        payload,
        verification,
        cacheMeta: {
          fromCache: false,
          staleFallback: false,
          dedupedInFlight: false,
          ttlRemainingSec: Math.round(ttlMs / 1000),
          fetchedAtUtc: payload.fetchedAtUtc,
        },
        warnings: Array.from(new Set(warnings)),
        error: null,
      };
    }

    // 4. Stale-while-error cache fallback
    serviceMetrics.liveFailures += 1;
    const errMsg = upstreamError || `Unable to retrieve fundamental data for ${sym}`;
    failureCooldownMap.set(sym, {
      untilMs: Date.now() + FAILURE_COOLDOWN_MS,
      reason: errMsg,
    });

    if (cachedEntry) {
      serviceMetrics.staleFallbacks += 1;
      warnings.push('Returning stale cached fundamental data due to upstream error.');
      return {
        symbol: sym,
        payload: cachedEntry,
        verification: verifyFundamentalIntegrity(cachedEntry, true),
        cacheMeta: {
          fromCache: true,
          staleFallback: true,
          dedupedInFlight: false,
          ttlRemainingSec: 0,
          fetchedAtUtc: cachedEntry.fetchedAtUtc,
        },
        warnings: Array.from(new Set(warnings)),
        error: null,
      };
    }

    return {
      symbol: sym,
      payload: null,
      verification: verifyFundamentalIntegrity(null, false),
      cacheMeta: {
        fromCache: false,
        staleFallback: false,
        dedupedInFlight: false,
        ttlRemainingSec: 0,
        fetchedAtUtc: '',
      },
      warnings: Array.from(new Set(warnings)),
      error: errMsg,
    };
  })();

  inFlightRequests.set(flightKey, task);
  try {
    return await task;
  } finally {
    inFlightRequests.delete(flightKey);
  }
}

export async function getVerifiedFundamentalsBatch(
  symbols: string[],
  options: {
    xbrlBySymbol?: Map<string, XbrlFiling[]>;
    forceRefresh?: boolean;
    forceBseProbe?: boolean;
    concurrency?: number;
    delayBetweenBatchesMs?: number;
    allowYahooSupplement?: boolean;
  } = {}
): Promise<{
  results: Record<string, VerifiedFundamentalResult>;
  succeeded: string[];
  failed: Array<{ symbol: string; error: string }>;
  cacheHits: number;
  liveFetches: number;
}> {
  const unique = Array.from(
    new Set(symbols.map((s) => normalizeSymbol(s)).filter(Boolean))
  );
  const concurrency = Math.min(3, Math.max(1, options.concurrency ?? 2));
  const delayMs = Math.max(150, options.delayBetweenBatchesMs ?? 350);

  const results: Record<string, VerifiedFundamentalResult> = {};
  const succeeded: string[] = [];
  const failed: Array<{ symbol: string; error: string }> = [];
  let cacheHits = 0;
  let liveFetches = 0;

  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const settled = await Promise.all(
      chunk.map((sym) =>
        getVerifiedFundamentals(sym, {
          xbrlFilings: options.xbrlBySymbol?.get(sym),
          forceRefresh: options.forceRefresh,
          forceBseProbe: options.forceBseProbe,
          allowYahooSupplement: options.allowYahooSupplement,
        })
      )
    );

    for (const res of settled) {
      results[res.symbol] = res;
      if (res.cacheMeta.fromCache) cacheHits += 1;
      else liveFetches += 1;

      if (res.payload) {
        succeeded.push(res.symbol);
      } else {
        failed.push({ symbol: res.symbol, error: res.error || 'Unavailable' });
      }
    }

    if (i + concurrency < unique.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { results, succeeded, failed, cacheHits, liveFetches };
}

export async function getLiveQuote(
  symbol: string,
  options?: { exchange?: 'AUTO' | 'NSE' | 'BSE'; bseScripCode?: string; forceRefresh?: boolean }
): Promise<ServiceResult<LiveQuote>> {
  return defaultIndianStockDataService.getLiveQuote(symbol, options);
}

export async function getHistoricalPrices(
  symbol: string,
  options?: { fromDate?: Date; toDate?: Date; series?: string[]; forceRefresh?: boolean }
): Promise<ServiceResult<HistoricalPriceBar[]>> {
  return defaultIndianStockDataService.getHistoricalPrices(symbol, options);
}

export function evictFundamentalCache(symbol?: string): { clearedCount: number } {
  defaultIndianStockDataService.evictSymbol(symbol);
  const cache = loadIndianFundamentalsCache();
  if (symbol) {
    const sym = normalizeSymbol(symbol);
    const existed = (sym in cache) || payloadLruCache.has(sym);
    payloadLruCache.delete(sym);
    delete cache[sym];
    failureCooldownMap.delete(sym);
    const file = path.join(process.cwd(), 'data', 'research', 'indian_fundamentals_cache.json');
    if (existed && fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(cache), 'utf-8');
    }
    return { clearedCount: existed ? 1 : 0 };
  }

  const count = Math.max(Object.keys(cache).length, payloadLruCache.size);
  payloadLruCache.clear();
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
  failureCooldownMap.clear();
  const file = path.join(process.cwd(), 'data', 'research', 'indian_fundamentals_cache.json');
  if (fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({}), 'utf-8');
  }
  return { clearedCount: count };
}

export function getFundamentalServiceHealth(): FundamentalServiceHealth {
  const cache = loadIndianFundamentalsCache();
  return {
    cachedSymbolsCount: Math.max(Object.keys(cache).length, payloadLruCache.size),
    inFlightCount: inFlightRequests.size,
    metrics: { ...serviceMetrics },
    screenerRateLimit: getScreenerRateLimitState(),
    lruCache: defaultIndianStockDataService.getCacheHealth(),
    negativeCooldownSymbolsCount: failureCooldownMap.size,
  };
}

// Standalone execution: `npx tsx server/services/fundamentalService.ts TCS`
const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  const targetSymbol = normalizeSymbol(process.argv[2] || 'TCS');
  (async () => {
    const [fundRes, quoteRes, histRes] = await Promise.all([
      defaultIndianStockDataService.getFundamentals(targetSymbol),
      defaultIndianStockDataService.getLiveQuote(targetSymbol),
      defaultIndianStockDataService.getHistoricalPrices(targetSymbol, {
        fromDate: new Date(Date.now() - 30 * 86_400_000),
        toDate: new Date(),
      }),
    ]);

    console.log(
      JSON.stringify(
        {
          symbol: targetSymbol,
          fundamentals: fundRes.data
            ? {
                companyName: fundRes.data.companyName,
                peRatio: fundRes.data.peRatio,
                roePct: fundRes.data.roePct,
                rocePct: fundRes.data.rocePct,
                debtToEquity: fundRes.data.debtToEquity,
                quarterlyPeriods: fundRes.data.quarterlyResults.periods.slice(-4),
                balanceSheetPeriods: fundRes.data.balanceSheet.periods.slice(-4),
              }
            : { error: fundRes.error },
          liveQuote: quoteRes.data ?? { error: quoteRes.error },
          historicalBarsCount: histRes.data?.length ?? 0,
        },
        null,
        2
      )
    );
  })().catch((err) => {
    console.error('CLI error:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
