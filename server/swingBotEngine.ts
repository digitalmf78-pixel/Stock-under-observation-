import fs from 'node:fs';
import path from 'node:path';
import {
  atomicWriteJsonSync,
  readJsonSafe,
  withFileLock,
} from './filePersistence.ts';
import type {
  BotBacktestPhaseMetrics,
  BotBacktestReport,
  BotBacktestTrade,
  BotStockAnalysis,
  BotValuationSnapshot,
  BulkBlockDealItem,
  CheckGateStatus,
  DailyBhavRow,
  FundamentalProfile,
  MacroNewsDashboardResponse,
  PiotroskiCheckItem,
  RecommendedStockPick,
  RecommendedStocksResponse,
  ScreenerRow,
} from '../src/types/trading.ts';
import { nsePipeline } from './nsePipeline.ts';
import { classifyMarketCap } from './liveFetcher.ts';
import {
  type AnnualStatementYear,
  type IndianFundamentalsPayload,
} from './indianFundamentals.ts';
import { getVerifiedFundamentals } from './services/fundamentalService.ts';
import {
  calculateEmaSeries as computeEmaSeries,
  calculateWilderRsiSeries as computeRsiSeries,
} from './technicalIndicators.ts';
import { getOpenMacroAndNewsDashboard } from './openMacroNewsEngine.ts';
import { fetchLiveYahooQuote } from './paperTradeStore.ts';
import { fetchStockNews } from './stockNewsFetcher.ts';
import { loadWatchlistSymbols } from './watchlistStore.ts';
import {
  filterDealsWithin30Days,
  mergeAndDeduplicateBulkBlockDeals,
} from './catalystFetcher.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YahooOhlcvCacheEntry {
  symbol: string;
  tickerUsed: string;
  fetchedAtUtc: string;
  bars: OhlcvBar[];
}

const BOT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let memoryBotCache: Record<string, YahooOhlcvCacheEntry> | null = null;

function botCachePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'bot_yahoo_cache.json');
}

function isBotCacheShape(val: unknown): val is Record<string, YahooOhlcvCacheEntry> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function loadBotCache(throwOnCorruptWithoutBackup = false): Record<string, YahooOhlcvCacheEntry> {
  if (memoryBotCache && !throwOnCorruptWithoutBackup) return memoryBotCache;
  memoryBotCache = readJsonSafe<Record<string, YahooOhlcvCacheEntry>>(
    botCachePath(),
    {},
    {
      validate: isBotCacheShape,
      throwOnCorruptWithoutBackup,
    }
  );
  return memoryBotCache;
}

async function saveBotCacheEntry(entry: YahooOhlcvCacheEntry): Promise<void> {
  const file = botCachePath();
  await withFileLock(file, () => {
    const cache = loadBotCache(true);
    cache[entry.symbol] = entry;
    memoryBotCache = cache;
    atomicWriteJsonSync(file, cache, { preserveBackup: true });
  });
}

function toIstIso(unixSec: number): string {
  return new Date((unixSec + 19800) * 1000).toISOString().slice(0, 10);
}

async function fetchYahoo3YChart(tickerWithSuffix: string): Promise<OhlcvBar[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      tickerWithSuffix
    )}?range=3y&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0];
    if (!q || ts.length === 0) return [];

    const byDate = new Map<string, OhlcvBar>();
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i];
      const o = q.open?.[i] ?? c;
      const h = q.high?.[i] ?? c;
      const l = q.low?.[i] ?? c;
      const v = q.volume?.[i] ?? 0;
      if (
        typeof c !== 'number' ||
        !Number.isFinite(c) ||
        c <= 0 ||
        typeof o !== 'number' ||
        typeof h !== 'number' ||
        typeof l !== 'number'
      ) {
        continue;
      }
      const date = toIstIso(ts[i]);
      byDate.set(date, {
        date,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: typeof v === 'number' && Number.isFinite(v) ? v : 0,
      });
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

async function fetchAndCacheYahooForSymbol(
  symbol: string,
  forceRefresh = false
): Promise<YahooOhlcvCacheEntry> {
  const sym = symbol.trim().toUpperCase();
  const cache = loadBotCache();
  const existing = cache[sym];
  if (
    !forceRefresh &&
    existing &&
    Date.now() - Date.parse(existing.fetchedAtUtc) < BOT_CACHE_TTL_MS &&
    Array.isArray(existing.bars) &&
    existing.bars.length > 0
  ) {
    return existing;
  }

  let tickerUsed = `${sym}.NS`;
  let bars = await fetchYahoo3YChart(tickerUsed);
  if (bars.length < 30) {
    const boBars = await fetchYahoo3YChart(`${sym}.BO`);
    if (boBars.length > bars.length) {
      bars = boBars;
      tickerUsed = `${sym}.BO`;
    }
  }

  const entry: YahooOhlcvCacheEntry = {
    symbol: sym,
    tickerUsed,
    fetchedAtUtc: new Date().toISOString(),
    bars,
  };

  if (bars.length > 0) {
    await saveBotCacheEntry(entry);
  }
  return entry;
}

// =========================================================================
// INDICATOR HELPERS (EMA, RSI, MACD, BOLLINGER)
// EMA & Wilder RSI imported from ./technicalIndicators.ts
// =========================================================================

function computeMacdHistSeries(closes: ReadonlyArray<number | null | undefined>): Array<number | null> {
  const ema12 = computeEmaSeries(closes, 12);
  const ema26 = computeEmaSeries(closes, 26);
  const macdLine: Array<number | null> = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? (ema12[i] as number) - (ema26[i] as number) : null
  );
  const signal = computeEmaSeries(macdLine, 9);
  return closes.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null
      ? (macdLine[i] as number) - (signal[i] as number)
      : null
  );
}

function computeBollingerLowerSeries(closes: number[], period = 20, mult = 2): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    out[i] = mean - mult * Math.sqrt(variance);
  }
  return out;
}

function loadBulkDeals30D(refIso?: string): BulkBlockDealItem[] {
  const file = path.join(process.cwd(), 'data', 'research', 'bulk_block_deals_30d.json');
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { deals?: BulkBlockDealItem[] };
    const raw = Array.isArray(parsed?.deals) ? parsed.deals : [];
    return mergeAndDeduplicateBulkBlockDeals([], filterDealsWithin30Days(raw, refIso, 30), refIso);
  } catch {
    return [];
  }
}

export function computeWeightedAvgBuyDealPrice(buyDeals: BulkBlockDealItem[]): number | null {
  if (buyDeals.length === 0) return null;
  let weightedSum = 0;
  let qtySum = 0;
  for (const d of buyDeals) {
    const qty = Number(d.quantity || 0);
    const price = Number(d.tradePrice || 0);
    if (qty > 0 && price > 0) {
      weightedSum += qty * price;
      qtySum += qty;
    }
  }
  if (qtySum > 0) {
    return Number((weightedSum / qtySum).toFixed(2));
  }
  const validPrices = buyDeals.map((d) => Number(d.tradePrice || 0)).filter((p) => p > 0);
  if (validPrices.length === 0) return null;
  return Number((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(2));
}

function hasRecentPromoterBuyingInCatalystCache(symbol: string): boolean {
  const file = path.join(process.cwd(), 'data', 'research', 'catalysts_cache.json');
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      bySymbol?: Record<string, { announcements?: Array<{ title?: string }> }>;
    };
    const anns = parsed?.bySymbol?.[symbol]?.announcements ?? [];
    return anns.some((a) =>
      /\b(promoter.*acqui|insider.*buy|creeping acquisition|sast.*buy|allotment.*promoter)\b/i.test(
        a.title || ''
      )
    );
  } catch {
    return false;
  }
}

function normalizeSectorAliases(rawSector: string): string[] {
  const s = rawSector.toLowerCase();
  const keys = [s];
  if (s.includes('bank') || s.includes('financial') || s.includes('nbfc')) {
    keys.push('financial services', 'banks', 'nbfc');
  }
  if (s.includes('tech') || s.includes('software') || s.includes('it')) {
    keys.push('technology', 'it');
  }
  if (s.includes('health') || s.includes('pharma')) {
    keys.push('healthcare', 'pharma');
  }
  if (s.includes('defen') || s.includes('industrial') || s.includes('capital')) {
    keys.push('industrials', 'defence', 'capital goods');
  }
  if (s.includes('energy') || s.includes('oil') || s.includes('gas')) {
    keys.push('energy', 'oil marketing', 'oil exploration');
  }
  if (s.includes('fmcg') || s.includes('consumer defensive')) {
    keys.push('consumer defensive', 'fmcg');
  }
  if (s.includes('metal') || s.includes('material') || s.includes('chem')) {
    keys.push('basic materials', 'metals', 'chemicals');
  }
  if (s.includes('auto')) keys.push('auto', 'consumer cyclical');
  if (s.includes('realty') || s.includes('real estate')) keys.push('real estate');
  return keys;
}

// =========================================================================
// PHASE 2: SECTOR + NEWS + MACRO FILTER
// =========================================================================

function evaluatePhase2SectorMacroNews(params: {
  sector: string;
  dashboard: MacroNewsDashboardResponse;
  sector1mMap: Map<string, number>;
}): BotStockAnalysis['phase2SectorMacroNews'] {
  const secKey = params.sector.trim().toUpperCase();
  const sector1mReturnPct = secKey ? (params.sector1mMap.get(secKey) ?? null) : null;
  const nifty1mReturnPct = params.dashboard.regime.nifty50.return1mPct;
  const sectorOutperformsNifty =
    sector1mReturnPct !== null && nifty1mReturnPct !== null
      ? sector1mReturnPct > nifty1mReturnPct
      : null;

  const aliases = normalizeSectorAliases(params.sector);
  let newsBias: 'BOOST' | 'AVOID' | 'NEUTRAL' = 'NEUTRAL';
  const flags: string[] = [];

  for (const imp of params.dashboard.sectorImpacts) {
    const impName = imp.sector.toLowerCase();
    if (aliases.some((a) => impName.includes(a) || a.includes(impName))) {
      if (imp.bias === 'AVOID') {
        newsBias = 'AVOID';
        flags.push(`RSS News AVOID (${imp.sector}: ${imp.reasons.join(', ')})`);
      } else if (imp.bias === 'BOOST' && newsBias !== 'AVOID') {
        newsBias = 'BOOST';
        flags.push(`RSS News BOOST (${imp.sector}: ${imp.reasons.join(', ')})`);
      }
    }
  }

  let dxySectorFlag: 'AVOID' | 'DEFENSIVE_BUY' | 'NEUTRAL' = 'NEUTRAL';
  if (params.dashboard.dxyAvoidSectors.some((s) => aliases.includes(s.toLowerCase()))) {
    dxySectorFlag = 'AVOID';
    flags.push(`DXY Strong (${params.dashboard.regime.dxy.value}) — Sector in AVOID list`);
  } else if (params.dashboard.dxyDefensiveSectors.some((s) => aliases.includes(s.toLowerCase()))) {
    dxySectorFlag = 'DEFENSIVE_BUY';
    flags.push(`DXY Strong — Defensive sector hedge`);
  }

  const brentFlag = params.dashboard.regime.brentCrude.bias;
  if (brentFlag === 'SEVERE_RISK' || brentFlag === 'CAUTION') {
    flags.push(`Brent $${params.dashboard.regime.brentCrude.value} (${brentFlag})`);
  }

  if (sectorOutperformsNifty === true) {
    flags.push(`Sector 1M (${sector1mReturnPct?.toFixed(2)}%) > Nifty (${nifty1mReturnPct?.toFixed(2)}%)`);
  } else if (sector1mReturnPct !== null && sector1mReturnPct < 0) {
    flags.push(`Negative Sector 1M (${sector1mReturnPct.toFixed(2)}%)`);
  }

  return {
    sector1mReturnPct,
    nifty1mReturnPct,
    sectorOutperformsNifty,
    newsBias,
    dxySectorFlag,
    brentFlag,
    flags,
  };
}

// =========================================================================
// PHASE 3: FUNDAMENTALS (9-PT PIOTROSKI + 7 HARD REJECT + GRAHAM + DCF)
// =========================================================================

function formatCr(inr: number | null): string {
  if (inr === null) return 'DATA NOT AVAILABLE';
  return `₹${(inr / 1e7).toFixed(0)} Cr`;
}

function evaluatePhase3Fundamentals(params: {
  closePrice: number;
  summary: ScreenerRow;
  fund: FundamentalProfile | null;
  bars: OhlcvBar[];
  indianFund: IndianFundamentalsPayload | null;
}): BotStockAnalysis['phase3Fundamentals'] {
  const { closePrice, summary, fund, bars, indianFund } = params;
  const annualYears: AnnualStatementYear[] = indianFund?.annualYears ?? [];
  const yr0 = annualYears[0] ?? null; // Latest FY (Screener.in INR)
  const yr1 = annualYears[1] ?? null; // Prior FY (Screener.in INR)

  const roe0 =
    indianFund?.roePct ??
    (yr0 && yr0.netIncome !== null && yr0.equity && yr0.equity > 0
      ? (yr0.netIncome / yr0.equity) * 100
      : fund?.roePct ?? null);
  const ocf0 = indianFund?.operatingCashFlowInr ?? yr0?.ocf ?? fund?.operatingCashFlowInr ?? null;
  const ni0 = yr0?.netIncome ?? null;

  const roa0 =
    yr0 && yr0.netIncome !== null && yr0.totalAssets && yr0.totalAssets > 0
      ? yr0.netIncome / yr0.totalAssets
      : null;
  const roa1 =
    yr1 && yr1.netIncome !== null && yr1.totalAssets && yr1.totalAssets > 0
      ? yr1.netIncome / yr1.totalAssets
      : null;

  const rawDe0 =
    indianFund?.debtToEquity ??
    (yr0 && yr0.totalDebt !== null && yr0.equity && yr0.equity > 0
      ? yr0.totalDebt / yr0.equity
      : fund?.debtToEquity ?? null);
  const de0 = rawDe0 !== null && rawDe0 >= 0 ? rawDe0 : null;
  const rawDe1 =
    yr1 && yr1.totalDebt !== null && yr1.equity && yr1.equity > 0
      ? yr1.totalDebt / yr1.equity
      : null;
  const de1 = rawDe1 !== null && rawDe1 >= 0 ? rawDe1 : null;

  const cr0 =
    yr0 && yr0.currentAssets !== null && yr0.currentLiabilities && yr0.currentLiabilities > 0
      ? yr0.currentAssets / yr0.currentLiabilities
      : null;
  const cr1 =
    yr1 && yr1.currentAssets !== null && yr1.currentLiabilities && yr1.currentLiabilities > 0
      ? yr1.currentAssets / yr1.currentLiabilities
      : null;

  const gm0 =
    yr0 && yr0.grossProfit !== null && yr0.revenue && yr0.revenue > 0
      ? yr0.grossProfit / yr0.revenue
      : null;
  const gm1 =
    yr1 && yr1.grossProfit !== null && yr1.revenue && yr1.revenue > 0
      ? yr1.grossProfit / yr1.revenue
      : null;

  const at0 =
    yr0 && yr0.revenue !== null && yr0.totalAssets && yr0.totalAssets > 0
      ? yr0.revenue / yr0.totalAssets
      : null;
  const at1 =
    yr1 && yr1.revenue !== null && yr1.totalAssets && yr1.totalAssets > 0
      ? yr1.revenue / yr1.totalAssets
      : null;

  const piotroskiChecks: PiotroskiCheckItem[] = [
    {
      key: 'roe_pos',
      label: '1. ROE > 0',
      status: roe0 === null ? 'DATA NOT AVAILABLE' : roe0 > 0 ? 'PASS' : 'FAIL',
      detail: roe0 !== null ? `${roe0.toFixed(1)}%` : 'DATA NOT AVAILABLE',
    },
    {
      key: 'ocf_pos',
      label: '2. OCF > 0',
      status: ocf0 === null ? 'DATA NOT AVAILABLE' : ocf0 > 0 ? 'PASS' : 'FAIL',
      detail: formatCr(ocf0),
    },
    {
      key: 'roa_imp',
      label: '3. ROA > Prev Year ROA',
      status:
        roa0 === null || roa1 === null ? 'DATA NOT AVAILABLE' : roa0 > roa1 ? 'PASS' : 'FAIL',
      detail:
        roa0 !== null && roa1 !== null
          ? `${(roa0 * 100).toFixed(2)}% vs ${(roa1 * 100).toFixed(2)}%`
          : 'DATA NOT AVAILABLE',
    },
    {
      key: 'ocf_gt_ni',
      label: '4. OCF > Net Income',
      status:
        ocf0 === null || ni0 === null ? 'DATA NOT AVAILABLE' : ocf0 > ni0 ? 'PASS' : 'FAIL',
      detail:
        ocf0 !== null && ni0 !== null
          ? `${formatCr(ocf0)} vs ${formatCr(ni0)}`
          : 'DATA NOT AVAILABLE',
    },
    {
      key: 'de_imp',
      label: '5. Debt/Equity < Prev Year',
      status:
        de0 === null || de1 === null
          ? 'DATA NOT AVAILABLE'
          : de0 < de1 || (de0 === 0 && de1 === 0)
            ? 'PASS'
            : 'FAIL',
      detail:
        de0 !== null && de1 !== null
          ? `${de0.toFixed(2)}x vs ${de1.toFixed(2)}x`
          : 'DATA NOT AVAILABLE',
    },
    {
      key: 'cr_imp',
      label: '6. Current Ratio > Prev Year',
      status:
        cr0 === null || cr1 === null ? 'DATA NOT AVAILABLE' : cr0 > cr1 ? 'PASS' : 'FAIL',
      detail:
        cr0 !== null && cr1 !== null
          ? `${cr0.toFixed(2)}x vs ${cr1.toFixed(2)}x`
          : 'DATA NOT AVAILABLE',
    },
    {
      key: 'shares_no_dil',
      label: '7. Shares <= Prev Year (No Dilution)',
      status:
        yr0?.shares === null ||
        yr0?.shares === undefined ||
        yr1?.shares === null ||
        yr1?.shares === undefined
          ? 'DATA NOT AVAILABLE'
          : yr0.shares <= yr1.shares * 1.005
            ? 'PASS'
            : 'FAIL',
      detail:
        yr0?.shares && yr1?.shares
          ? `${(yr0.shares / 1e7).toFixed(2)}Cr vs ${(yr1.shares / 1e7).toFixed(2)}Cr`
          : 'DATA NOT AVAILABLE',
    },
    {
      key: 'gm_imp',
      label: '8. Gross Margin > Prev Year',
      status:
        gm0 === null || gm1 === null ? 'DATA NOT AVAILABLE' : gm0 > gm1 ? 'PASS' : 'FAIL',
      detail:
        gm0 !== null && gm1 !== null
          ? `${(gm0 * 100).toFixed(1)}% vs ${(gm1 * 100).toFixed(1)}%`
          : 'DATA NOT AVAILABLE',
    },
    {
      key: 'at_imp',
      label: '9. Asset Turnover > Prev Year',
      status:
        at0 === null || at1 === null ? 'DATA NOT AVAILABLE' : at0 > at1 ? 'PASS' : 'FAIL',
      detail:
        at0 !== null && at1 !== null
          ? `${at0.toFixed(2)}x vs ${at1.toFixed(2)}x`
          : 'DATA NOT AVAILABLE',
    },
  ];

  const piotroskiAvailable = piotroskiChecks.filter((c) => c.status !== 'DATA NOT AVAILABLE').length;
  const piotroskiScore =
    piotroskiAvailable === 9
      ? piotroskiChecks.filter((c) => c.status === 'PASS').length
      : null;

  // 3-Year average ROE from Screener.in Annual Statements
  const roeSeries = annualYears
    .slice(0, 3)
    .map((y) =>
      y.netIncome !== null && y.equity !== null && y.equity > 0
        ? (y.netIncome / y.equity) * 100
        : null
    )
    .filter((v): v is number => v !== null);
  const roe3YrAvgPct =
    roeSeries.length >= 2
      ? Number((roeSeries.reduce((a, b) => a + b, 0) / roeSeries.length).toFixed(2))
      : roe0 !== null
        ? Number(roe0.toFixed(2))
        : null;

  // Interest coverage: prefer Screener/NSE XBRL exact EBIT/Interest
  let yr0Ic: number | null = null;
  if (yr0 && yr0.ebit !== null && yr0.ebit > 0) {
    if (yr0.interestExpense !== null) {
      const absInt = Math.abs(yr0.interestExpense);
      yr0Ic = absInt > 0 ? Number((yr0.ebit / absInt).toFixed(2)) : 999;
    } else if (de0 !== null && de0 <= 0.01) {
      yr0Ic = 999;
    }
  }
  let interestCoverage: number | null = null;
  if (indianFund?.interestCoverage !== null && indianFund?.interestCoverage !== undefined && indianFund.interestCoverage > 0) {
    interestCoverage = indianFund.interestCoverage;
  } else if (yr0Ic !== null) {
    interestCoverage = yr0Ic;
  } else if (
    fund?.interestCoverage !== undefined &&
    fund?.interestCoverage !== null &&
    fund.interestCoverage > 0
  ) {
    interestCoverage = fund.interestCoverage;
  } else if (fund?.interestCoverage === 0 && (de0 === null || de0 > 0.05)) {
    interestCoverage = 0;
  }

  // Earnings Quality (OCF / Net Income)
  const earningsQualityOcfNi =
    ocf0 !== null && ni0 !== null && ni0 > 0 ? Number((ocf0 / ni0).toFixed(2)) : null;

  // EPS Growth YoY (Screener / NSE XBRL / BSE)
  let epsGrowthYoyPct: number | null = null;
  const ttmCurr = indianFund?.epsTtmCurr ?? fund?.epsTtmCurr ?? null;
  const ttmPrev = indianFund?.epsTtmPrev ?? fund?.epsTtmPrev ?? null;
  if (ttmCurr !== null && ttmPrev !== null && Math.abs(ttmPrev) > 0) {
    epsGrowthYoyPct = ((ttmCurr - ttmPrev) / Math.abs(ttmPrev)) * 100;
  } else if (
    yr0?.dilutedEps !== null &&
    yr0?.dilutedEps !== undefined &&
    yr1?.dilutedEps !== null &&
    yr1?.dilutedEps !== undefined &&
    Math.abs(yr1.dilutedEps) > 0
  ) {
    epsGrowthYoyPct = ((yr0.dilutedEps - yr1.dilutedEps) / Math.abs(yr1.dilutedEps)) * 100;
  } else if (indianFund?.profitGrowthPct !== null && indianFund?.profitGrowthPct !== undefined) {
    epsGrowthYoyPct = indianFund.profitGrowthPct;
  } else if (fund?.profitGrowthPct !== null && fund?.profitGrowthPct !== undefined) {
    epsGrowthYoyPct = fund.profitGrowthPct;
  }
  if (epsGrowthYoyPct !== null) epsGrowthYoyPct = Number(epsGrowthYoyPct.toFixed(2));

  // Free-float Market Cap (Cr): prefer official BSE MktCapFF, else (100 - Screener Promoter %) * Market Cap
  const mcapInr =
    indianFund?.marketCapInr ??
    fund?.marketCapInr ??
    (indianFund?.sharesOutstanding ? indianFund.sharesOutstanding * closePrice : null);
  let freeFloatMcapCr: number | null = null;
  if (indianFund?.freeFloatMcapInr && indianFund.freeFloatMcapInr > 0) {
    freeFloatMcapCr = Math.round(indianFund.freeFloatMcapInr / 1e7);
  } else if (mcapInr && mcapInr > 0) {
    const promPct = indianFund?.promoterHoldingPct ?? fund?.promoterHoldingPct ?? null;
    if (promPct !== null && promPct >= 0 && promPct <= 100) {
      freeFloatMcapCr = Number((((100 - promPct) / 100) * (mcapInr / 1e7)).toFixed(0));
    }
  }

  const gates: Array<{
    label: string;
    valueText: string;
    threshold: string;
    status: CheckGateStatus;
  }> = [
    {
      label: 'Piotroski F-Score',
      valueText:
        piotroskiScore !== null && piotroskiAvailable === 9 ? `${piotroskiScore}/9` : 'INCOMPLETE DATA',
      threshold: '>= 7',
      status:
        piotroskiScore === null || piotroskiAvailable < 9
          ? 'DATA NOT AVAILABLE'
          : piotroskiScore >= 7
            ? 'PASS'
            : 'FAIL',
    },
    {
      label: `ROE ${roeSeries.length >= 2 ? `(${roeSeries.length}Y Avg)` : '(Latest)'}`,
      valueText: roe3YrAvgPct !== null ? `${roe3YrAvgPct.toFixed(1)}%` : 'DATA NOT AVAILABLE',
      threshold: '> 15%',
      status:
        roe3YrAvgPct === null ? 'DATA NOT AVAILABLE' : roe3YrAvgPct > 15 ? 'PASS' : 'FAIL',
    },
    {
      label: 'Debt / Equity',
      valueText: de0 !== null ? `${de0.toFixed(2)}x` : 'DATA NOT AVAILABLE',
      threshold: '< 1.0x',
      status: de0 === null ? 'DATA NOT AVAILABLE' : de0 < 1.0 ? 'PASS' : 'FAIL',
    },
    {
      label: 'Interest Coverage (EBIT/Int)',
      valueText:
        interestCoverage !== null
          ? interestCoverage >= 999
            ? 'Debt-Free'
            : `${interestCoverage.toFixed(1)}x`
          : 'DATA NOT AVAILABLE',
      threshold: '> 3.0x',
      status:
        interestCoverage === null
          ? 'DATA NOT AVAILABLE'
          : interestCoverage > 3
            ? 'PASS'
            : 'FAIL',
    },
    {
      label: 'Earnings Quality (OCF/NI)',
      valueText:
        earningsQualityOcfNi !== null ? `${earningsQualityOcfNi.toFixed(2)}x` : 'DATA NOT AVAILABLE',
      threshold: '> 1.0x',
      status:
        earningsQualityOcfNi === null
          ? 'DATA NOT AVAILABLE'
          : earningsQualityOcfNi > 1.0
            ? 'PASS'
            : 'FAIL',
    },
    {
      label: 'EPS Growth YoY',
      valueText:
        epsGrowthYoyPct !== null
          ? `${epsGrowthYoyPct >= 0 ? '+' : ''}${epsGrowthYoyPct.toFixed(1)}%`
          : 'DATA NOT AVAILABLE',
      threshold: '> 10%',
      status:
        epsGrowthYoyPct === null
          ? 'DATA NOT AVAILABLE'
          : epsGrowthYoyPct > 10
            ? 'PASS'
            : 'FAIL',
    },
    {
      label: 'Free-Float Market Cap',
      valueText:
        freeFloatMcapCr !== null ? `₹${freeFloatMcapCr.toLocaleString('en-IN')} Cr` : 'DATA NOT AVAILABLE',
      threshold: '> ₹1,000 Cr',
      status:
        freeFloatMcapCr === null
          ? 'DATA NOT AVAILABLE'
          : freeFloatMcapCr > 1000
            ? 'PASS'
            : 'FAIL',
    },
  ];

  const hardRejectAvailableCount = gates.filter((g) => g.status !== 'DATA NOT AVAILABLE').length;
  const hardRejectPassCount = gates.filter((g) => g.status === 'PASS').length;
  const hardRejectFailCount = gates.filter((g) => g.status === 'FAIL').length;
  const hardRejectReasons = gates
    .filter((g) => g.status === 'FAIL')
    .map((g) => `${g.label} (${g.valueText} vs ${g.threshold})`);
  const minGatesRequired = summary.isIpo ? 1 : 3;
  if (hardRejectAvailableCount < minGatesRequired) {
    hardRejectReasons.push(
      `Insufficient verified fundamental gates (<${minGatesRequired} available)`
    );
  }
  const hardRejectPass =
    hardRejectFailCount === 0 && hardRejectAvailableCount >= minGatesRequired;

  // Valuation: Graham Number, 5Y DCF, EV/EBITDA from trusted Screener/BSE/NSE sources
  const peRatio = indianFund?.trailingPE ?? fund?.trailingPE ?? null;
  const impliedPeEps = peRatio && peRatio > 0 && closePrice > 0 ? closePrice / peRatio : null;
  let epsTtm: number | null =
    indianFund?.epsTtmCurr ??
    fund?.epsTtmCurr ??
    yr0?.dilutedEps ??
    impliedPeEps;
  if (
    impliedPeEps !== null &&
    epsTtm !== null &&
    epsTtm > 0 &&
    (epsTtm / impliedPeEps > 2.2 || impliedPeEps / epsTtm > 2.2)
  ) {
    epsTtm = impliedPeEps;
  }
  const pbRatio = indianFund?.priceToBook ?? fund?.priceToBook ?? null;
  const bvps =
    indianFund?.bookValuePerShare ??
    (pbRatio && pbRatio > 0 ? closePrice / pbRatio : null) ??
    (yr0?.equity && yr0.shares && yr0.shares > 0 ? yr0.equity / yr0.shares : null);

  let grahamNumber: number | null = null;
  let grahamRatio: number | null = null;
  let grahamZone: BotValuationSnapshot['grahamZone'] = 'DATA NOT AVAILABLE';
  if (epsTtm !== null && epsTtm > 0 && bvps !== null && bvps > 0) {
    grahamNumber = Number(Math.sqrt(22.5 * epsTtm * bvps).toFixed(2));
    grahamRatio = Number((closePrice / grahamNumber).toFixed(2));
    grahamZone =
      closePrice < grahamNumber * 0.7
        ? 'DEEP_VALUE'
        : closePrice > grahamNumber * 1.5
          ? 'OVERVALUED'
          : 'FAIR_VALUE';
  }

  const fcfInr = indianFund?.freeCashFlowInr ?? yr0?.fcf ?? fund?.freeCashFlowInr ?? null;
  const sharesOut =
    indianFund?.sharesOutstanding ??
    yr0?.shares ??
    (mcapInr && closePrice > 0 ? mcapInr / closePrice : null);

  let dcfIntrinsicPerShare: number | null = null;
  let dcfZone: BotValuationSnapshot['dcfZone'] = 'DATA NOT AVAILABLE';
  if (fcfInr !== null && fcfInr > 0 && sharesOut !== null && sharesOut > 0) {
    const rawG = epsGrowthYoyPct !== null ? epsGrowthYoyPct / 100 : 0.1;
    const g = Math.max(0.05, Math.min(0.15, rawG)); // conservative 5%-15% growth
    const r = 0.11; // 11% India discount rate (10-12%)
    const tg = 0.03; // 3% perpetual growth
    let pv = 0;
    let proj = fcfInr;
    for (let yr = 1; yr <= 5; yr++) {
      proj *= 1 + g;
      pv += proj / (1 + r) ** yr;
    }
    const terminal = (proj * (1 + tg)) / (r - tg);
    pv += terminal / (1 + r) ** 5;
    dcfIntrinsicPerShare = Number((pv / sharesOut).toFixed(2));
    dcfZone = closePrice < dcfIntrinsicPerShare * 0.7 ? 'MARGIN_OF_SAFETY' : 'FAIR_OR_FULL';
  }

  // Compute Live EV/EBITDA from INR Screener/BSE figures
  let evToEbitda: number | null =
    indianFund?.evToEbitda !== null && indianFund?.evToEbitda !== undefined
      ? Number(indianFund.evToEbitda.toFixed(2))
      : null;
  if (
    yr0?.ebitda !== null &&
    yr0?.ebitda !== undefined &&
    yr0.ebitda > 0 &&
    mcapInr &&
    mcapInr > 0
  ) {
    const liveEv = mcapInr + (yr0.totalDebt ?? 0) - (yr0.cash ?? 0);
    if (liveEv > 0) {
      const liveEvEbitda = Number((liveEv / yr0.ebitda).toFixed(2));
      if (
        evToEbitda === null ||
        evToEbitda <= 0 ||
        evToEbitda / liveEvEbitda > 2.5 ||
        liveEvEbitda / evToEbitda > 2.5
      ) {
        evToEbitda = liveEvEbitda;
      }
    }
  }

  // Compute real multi-year historical EV/EBITDA average using Screener annual EBITDA + FY-end OHLCV price
  const histEvEbitdas: number[] = [];
  if (bars.length > 0 && annualYears.length > 0) {
    for (const y of annualYears) {
      const yEbitda = y.ebitda ?? null;
      const yShares = y.shares ?? sharesOut ?? null;
      if (!yEbitda || yEbitda <= 0 || !yShares || yShares <= 0) continue;
      const targetMs = Date.parse(y.asOfDate);
      if (!Number.isFinite(targetMs)) continue;
      let bestBar: OhlcvBar | null = null;
      let bestDiff = Infinity;
      for (const b of bars) {
        const diff = Math.abs(Date.parse(b.date) - targetMs);
        if (diff <= 30 * 86400000 && diff < bestDiff) {
          bestDiff = diff;
          bestBar = b;
        }
      }
      if (!bestBar || bestBar.close <= 0) continue;
      const histEv = bestBar.close * yShares + (y.totalDebt ?? 0) - (y.cash ?? 0);
      const ratio = histEv / yEbitda;
      if (Number.isFinite(ratio) && ratio > 0 && ratio < 400) {
        histEvEbitdas.push(ratio);
      }
    }
  }

  const evToEbitda5YrAvg =
    histEvEbitdas.length >= 2
      ? Number(
          (histEvEbitdas.reduce((a, b) => a + b, 0) / histEvEbitdas.length).toFixed(1)
        )
      : null;
  const evToEbitdaHistLabel =
    evToEbitda5YrAvg !== null ? `${histEvEbitdas.length}Y Hist Avg` : 'Hist Avg';

  let evToEbitdaZone = 'DATA NOT AVAILABLE';
  if (evToEbitda !== null && evToEbitda5YrAvg !== null) {
    const tag =
      evToEbitda < evToEbitda5YrAvg * 0.85
        ? 'Discount vs Hist'
        : evToEbitda > evToEbitda5YrAvg * 1.25
          ? 'Premium vs Hist'
          : 'Fair vs Hist';
    evToEbitdaZone = `Live ${evToEbitda.toFixed(1)}x vs ${histEvEbitdas.length}Y Avg ${evToEbitda5YrAvg.toFixed(1)}x (${tag})`;
  } else if (evToEbitda !== null) {
    evToEbitdaZone = `Live ${evToEbitda.toFixed(1)}x (Hist Avg: DATA NOT AVAILABLE)`;
  }

  const valuation: BotValuationSnapshot = {
    epsTtm: epsTtm !== null ? Number(epsTtm.toFixed(2)) : null,
    bookValuePerShare: bvps !== null ? Number(bvps.toFixed(2)) : null,
    grahamNumber,
    grahamRatio,
    grahamZone,
    fcfInr,
    sharesOutstanding: sharesOut ? Math.round(sharesOut) : null,
    dcfIntrinsicPerShare,
    dcfZone,
    evToEbitda,
    evToEbitda5YrAvg,
    evToEbitdaZone,
    evToEbitdaHistLabel,
  };

  // Preserve unused summary ref cleanliness
  void summary;

  return {
    hardRejectPass,
    hardRejectAvailableCount,
    hardRejectPassCount,
    hardRejectFailCount,
    hardRejectReasons,
    piotroskiScore,
    piotroskiAvailable,
    piotroskiChecks,
    roe3YrAvgPct,
    debtToEquity: de0 !== null ? Number(de0.toFixed(2)) : null,
    interestCoverage,
    earningsQualityOcfNi,
    epsGrowthYoyPct,
    freeFloatMcapCr,
    gates,
    valuation,
  };
}

// =========================================================================
// PHASE 4: MOVEMENT POTENTIAL (252D BURST POWER + 52W HIGH + UNIVERSE RS)
// =========================================================================

function computeUniverseRsRank(symbol: string, allRows: ScreenerRow[]): number | null {
  // Compute real 20-session return across universe from Bhavcopy history for RS percentile rank
  const returns: Array<{ symbol: string; ret: number }> = [];
  for (const r of allRows) {
    const h = nsePipeline.getHistoryForSymbol(r.symbol);
    if (h.length < 15) continue;
    const base = h[Math.max(0, h.length - 22)]?.close;
    if (!base || base <= 0) continue;
    returns.push({ symbol: r.symbol, ret: (r.closePrice - base) / base });
  }
  if (returns.length < 50) return null;
  returns.sort((a, b) => a.ret - b.ret);
  const idx = returns.findIndex((x) => x.symbol === symbol);
  if (idx < 0) return null;
  return Number(((idx / Math.max(1, returns.length - 1)) * 100).toFixed(1));
}

function mergeOhlcvWithBhav(yfBars: OhlcvBar[], bhavHistory: DailyBhavRow[]): OhlcvBar[] {
  const byDate = new Map<string, OhlcvBar>();
  for (const b of yfBars) {
    if (b.date && b.close > 0 && b.high > 0 && b.low > 0) {
      byDate.set(b.date, b);
    }
  }
  for (const row of bhavHistory) {
    const close = row.close ?? 0;
    const high = row.high ?? close;
    const low = row.low ?? close;
    const open = row.open ?? row.prevClose ?? close;
    if (!row.date || close <= 0 || high <= 0 || low <= 0) continue;
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        date: row.date,
        open,
        high,
        low,
        close,
        volume: Math.max(0, row.volume || 0),
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function evaluatePhase4MovementPotential(
  symbol: string,
  closePrice: number,
  bars: OhlcvBar[],
  allRows: ScreenerRow[],
  isIpo = false
): BotStockAnalysis['phase4Movement'] {
  const rsRank = computeUniverseRsRank(symbol, allRows);
  const rsPass = rsRank !== null ? rsRank > 80 : null;

  if (bars.length < (isIpo ? 5 : 15)) {
    return {
      lookbackDays: bars.length,
      days5To10Pct: 0,
      days10To19Pct: 0,
      days19PlusPct: 0,
      downDays5To10Pct: 0,
      downDays10To19Pct: 0,
      downDays19PlusPct: 0,
      burstPowerRaw: null,
      burstPowerNormalized: null,
      downwardBurstRaw: null,
      downwardBurstNormalized: null,
      netBurstRaw: null,
      netBurstNormalized: null,
      upwardBurstSharePct: null,
      downwardBurstSharePct: null,
      upwardBurstDaysPct: null,
      downwardBurstDaysPct: null,
      burstBias: 'DATA NOT AVAILABLE',
      burstPass: null,
      high52W: null,
      distFrom52wHighPct: null,
      within25PctOf52wHigh: null,
      relativeStrengthPctRank: rsRank,
      rsPass,
    };
  }

  const slice = bars.slice(-253); // up to 252 daily returns
  let days5To10Pct = 0;
  let days10To19Pct = 0;
  let days19PlusPct = 0;
  let downDays5To10Pct = 0;
  let downDays10To19Pct = 0;
  let downDays19PlusPct = 0;
  let high52W = 0;

  for (let i = 0; i < slice.length; i++) {
    if (slice[i].high > high52W) high52W = slice[i].high;
    if (i === 0) continue;
    const prev = slice[i - 1].close;
    if (prev <= 0) continue;
    const pct = ((slice[i].close - prev) / prev) * 100;
    if (pct >= 19) days19PlusPct++;
    else if (pct >= 10) days10To19Pct++;
    else if (pct >= 5) days5To10Pct++;
    else if (pct <= -19) downDays19PlusPct++;
    else if (pct <= -10) downDays10To19Pct++;
    else if (pct <= -5) downDays5To10Pct++;
  }

  const lookbackDays = Math.max(1, slice.length - 1);
  const burstPowerRaw = days5To10Pct * 1 + days10To19Pct * 2 + days19PlusPct * 3;
  const downwardBurstRaw = downDays5To10Pct * 1 + downDays10To19Pct * 2 + downDays19PlusPct * 3;
  const netBurstRaw = burstPowerRaw - downwardBurstRaw;

  const burstPowerNormalized = Number(
    Math.min(100, (burstPowerRaw / (252 * 3)) * 1000).toFixed(2)
  );
  const downwardBurstNormalized = Number(
    Math.min(100, (downwardBurstRaw / (252 * 3)) * 1000).toFixed(2)
  );
  const netBurstNormalized = Number(
    (burstPowerNormalized - downwardBurstNormalized).toFixed(2)
  );

  const totalBurstRaw = burstPowerRaw + downwardBurstRaw;
  const upwardBurstSharePct =
    totalBurstRaw > 0 ? Number(((burstPowerRaw / totalBurstRaw) * 100).toFixed(1)) : 0;
  const downwardBurstSharePct =
    totalBurstRaw > 0 ? Number((100 - upwardBurstSharePct).toFixed(1)) : 0;
  const upDaysTotal = days5To10Pct + days10To19Pct + days19PlusPct;
  const downDaysTotal = downDays5To10Pct + downDays10To19Pct + downDays19PlusPct;
  const upwardBurstDaysPct = Number(((upDaysTotal / lookbackDays) * 100).toFixed(1));
  const downwardBurstDaysPct = Number(((downDaysTotal / lookbackDays) * 100).toFixed(1));

  const burstBias: BotStockAnalysis['phase4Movement']['burstBias'] =
    (burstPowerNormalized >= 10 && netBurstRaw > 0) || netBurstRaw >= 3
      ? 'UPWARD_DOMINANT'
      : netBurstRaw <= -2 || (downwardBurstNormalized >= 10 && netBurstRaw < 0)
        ? 'DOWNWARD_RISK'
        : 'BALANCED';

  const distFrom52wHighPct =
    high52W > 0 ? Number((((high52W - closePrice) / high52W) * 100).toFixed(2)) : null;

  return {
    lookbackDays,
    days5To10Pct,
    days10To19Pct,
    days19PlusPct,
    downDays5To10Pct,
    downDays10To19Pct,
    downDays19PlusPct,
    burstPowerRaw,
    burstPowerNormalized,
    downwardBurstRaw,
    downwardBurstNormalized,
    netBurstRaw,
    netBurstNormalized,
    upwardBurstSharePct,
    downwardBurstSharePct,
    upwardBurstDaysPct,
    downwardBurstDaysPct,
    burstBias,
    burstPass: burstPowerNormalized >= 10 && netBurstRaw > 0,
    high52W: high52W > 0 ? Number(high52W.toFixed(2)) : null,
    distFrom52wHighPct,
    within25PctOf52wHigh: distFrom52wHighPct !== null ? distFrom52wHighPct <= 25 : null,
    relativeStrengthPctRank: rsRank,
    rsPass,
  };
}

// =========================================================================
// SUPPORT / RESISTANCE + DAILY / WEEKLY / MONTHLY SENTIMENT + PERIODIC SCORE
// =========================================================================

function getWeekStartKeyUtc(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - diffToMonday);
  return dt.toISOString().slice(0, 10);
}

function resampleOhlcvTimeframe(
  bars: OhlcvBar[],
  timeframe: 'WEEKLY' | 'MONTHLY'
): OhlcvBar[] {
  if (bars.length === 0) return [];
  const buckets = new Map<string, OhlcvBar>();
  for (const b of bars) {
    if (!b.date || b.close <= 0) continue;
    const key = timeframe === 'WEEKLY' ? getWeekStartKeyUtc(b.date) : b.date.slice(0, 7);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        date: b.date,
        open: b.open > 0 ? b.open : b.close,
        high: b.high > 0 ? b.high : b.close,
        low: b.low > 0 ? b.low : b.close,
        close: b.close,
        volume: Math.max(0, b.volume || 0),
      });
    } else {
      existing.high = Math.max(existing.high, b.high > 0 ? b.high : b.close);
      existing.low = Math.min(existing.low, b.low > 0 ? b.low : b.close);
      existing.close = b.close;
      existing.date = b.date;
      existing.volume += Math.max(0, b.volume || 0);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function computeSupportResistance(
  closePrice: number,
  bars: OhlcvBar[]
): BotStockAnalysis['periodicAnalysis']['supportResistance'] {
  if (bars.length < 5 || closePrice <= 0) {
    return {
      nearestSupport: null,
      nearestSupportLabel: 'DATA NOT AVAILABLE',
      supportDistPct: null,
      secondarySupport: null,
      secondarySupportLabel: 'DATA NOT AVAILABLE',
      nearestResistance: null,
      nearestResistanceLabel: 'DATA NOT AVAILABLE',
      resistanceDistPct: null,
      secondaryResistance: null,
      secondaryResistanceLabel: 'DATA NOT AVAILABLE',
      pivot: null,
      pivotS1: null,
      pivotR1: null,
      riskRewardToR1: null,
      low52W: null,
      high52W: null,
      positionStatus: 'DATA NOT AVAILABLE',
      swingSupports: [],
      swingResistances: [],
    };
  }

  const slice52W = bars.slice(-252);
  const low52W = Number(Math.min(...slice52W.map((b) => b.low)).toFixed(2));
  const high52W = Number(Math.max(...slice52W.map((b) => b.high)).toFixed(2));

  const lastBar = bars[bars.length - 1];
  const pivot = Number(((lastBar.high + lastBar.low + lastBar.close) / 3).toFixed(2));
  const pivotR1 = Number((2 * pivot - lastBar.low).toFixed(2));
  const pivotS1 = Number((2 * pivot - lastBar.high).toFixed(2));

  const recentBars = bars.slice(-180);
  const rawSupports: Array<{ price: number; date: string; label: string; priority: number }> = [];
  const rawResistances: Array<{ price: number; date: string; label: string; priority: number }> = [];

  // 2-bar left/right fractal swing pivots
  for (let i = 2; i < recentBars.length - 2; i++) {
    const cur = recentBars[i];
    const isSwingLow =
      cur.low <= recentBars[i - 1].low &&
      cur.low <= recentBars[i - 2].low &&
      cur.low <= recentBars[i + 1].low &&
      cur.low <= recentBars[i + 2].low;
    const isSwingHigh =
      cur.high >= recentBars[i - 1].high &&
      cur.high >= recentBars[i - 2].high &&
      cur.high >= recentBars[i + 1].high &&
      cur.high >= recentBars[i + 2].high;

    if (isSwingLow && cur.low < closePrice * 0.997) {
      rawSupports.push({
        price: Number(cur.low.toFixed(2)),
        date: cur.date,
        label: `Swing Low (${cur.date})`,
        priority: 3,
      });
    }
    if (isSwingHigh && cur.high > closePrice * 1.003) {
      rawResistances.push({
        price: Number(cur.high.toFixed(2)),
        date: cur.date,
        label: `Swing High (${cur.date})`,
        priority: 3,
      });
    }
  }

  // Rolling window highs/lows + classic pivot S1/R1
  const addWindowBounds = (len: number, tag: string, prio: number) => {
    if (bars.length < Math.min(len, 10)) return;
    const win = bars.slice(-len);
    const wLow = Math.min(...win.map((b) => b.low));
    const wHigh = Math.max(...win.map((b) => b.high));
    const lowBar = win.find((b) => b.low === wLow);
    const highBar = win.find((b) => b.high === wHigh);
    if (wLow < closePrice * 0.997) {
      rawSupports.push({
        price: Number(wLow.toFixed(2)),
        date: lowBar?.date || lastBar.date,
        label: `${tag} Low`,
        priority: prio,
      });
    }
    if (wHigh > closePrice * 1.003) {
      rawResistances.push({
        price: Number(wHigh.toFixed(2)),
        date: highBar?.date || lastBar.date,
        label: `${tag} High`,
        priority: prio,
      });
    }
  };

  addWindowBounds(20, '20D', 2);
  addWindowBounds(60, '60D', 2);
  addWindowBounds(252, '52W', 2);

  if (pivotS1 > 0 && pivotS1 < closePrice * 0.997) {
    rawSupports.push({
      price: pivotS1,
      date: lastBar.date,
      label: 'Classic Pivot S1',
      priority: 1,
    });
  }
  if (pivotR1 > closePrice * 1.003) {
    rawResistances.push({
      price: pivotR1,
      date: lastBar.date,
      label: 'Classic Pivot R1',
      priority: 1,
    });
  }

  // Cluster levels within 1.2% so S1/S2 and R1/R2 are distinct, meaningful price zones
  const dedupeLevels = (
    items: Array<{ price: number; date: string; label: string; priority: number }>,
    direction: 'DESC' | 'ASC'
  ) => {
    const sorted = [...items].sort((a, b) =>
      direction === 'DESC' ? b.price - a.price : a.price - b.price
    );
    const clustered: Array<{ price: number; date: string; label: string; priority: number }> = [];
    for (const item of sorted) {
      const existing = clustered.find(
        (c) => Math.abs(c.price - item.price) / Math.max(1, c.price) <= 0.012
      );
      if (!existing) {
        clustered.push(item);
      } else if (item.priority > existing.priority) {
        existing.label = item.label;
        existing.date = item.date;
        existing.priority = item.priority;
      }
    }
    return clustered;
  };

  const supports = dedupeLevels(rawSupports, 'DESC');
  const resistances = dedupeLevels(rawResistances, 'ASC');

  const s1 = supports[0] ?? null;
  const s2 =
    supports.find((s) => (s1 ? s.price < s1.price * 0.985 : true)) ?? supports[1] ?? null;
  const r1 = resistances[0] ?? null;
  const r2 =
    resistances.find((r) => (r1 ? r.price > r1.price * 1.015 : true)) ?? resistances[1] ?? null;

  const nearestSupport = s1 ? s1.price : null;
  const nearestSupportLabel = s1 ? s1.label : 'Below tracked lows (No lower S1)';
  const secondarySupport = s2 ? s2.price : null;
  const secondarySupportLabel = s2 ? s2.label : 'None below S1';

  const nearestResistance = r1 ? r1.price : null;
  const nearestResistanceLabel = r1 ? r1.label : 'Blue-Sky / Above 52W High';
  const secondaryResistance = r2 ? r2.price : null;
  const secondaryResistanceLabel = r2 ? r2.label : 'None above R1';

  const supportDistPct =
    nearestSupport !== null
      ? Number((((closePrice - nearestSupport) / closePrice) * 100).toFixed(2))
      : null;
  const resistanceDistPct =
    nearestResistance !== null
      ? Number((((nearestResistance - closePrice) / closePrice) * 100).toFixed(2))
      : null;

  const riskRewardToR1 =
    nearestSupport !== null && nearestResistance !== null && closePrice > nearestSupport
      ? Number(((nearestResistance - closePrice) / (closePrice - nearestSupport)).toFixed(2))
      : null;

  let positionStatus: BotStockAnalysis['periodicAnalysis']['supportResistance']['positionStatus'] =
    'MID_RANGE';
  if (nearestResistance === null && closePrice >= high52W * 0.99) {
    positionStatus = 'BREAKOUT_ABOVE_R1';
  } else if (nearestSupport === null && closePrice <= low52W * 1.005) {
    positionStatus = 'BELOW_SUPPORT';
  } else if (
    supportDistPct !== null &&
    supportDistPct <= 3.0 &&
    (resistanceDistPct === null || supportDistPct <= resistanceDistPct)
  ) {
    positionStatus = 'NEAR_SUPPORT';
  } else if (resistanceDistPct !== null && resistanceDistPct <= 3.0) {
    positionStatus = 'NEAR_RESISTANCE';
  }

  return {
    nearestSupport,
    nearestSupportLabel,
    supportDistPct,
    secondarySupport,
    secondarySupportLabel,
    nearestResistance,
    nearestResistanceLabel,
    resistanceDistPct,
    secondaryResistance,
    secondaryResistanceLabel,
    pivot,
    pivotS1,
    pivotR1,
    riskRewardToR1,
    low52W,
    high52W,
    positionStatus,
    swingSupports: supports.slice(0, 3).map(({ price, date, label }) => ({ price, date, label })),
    swingResistances: resistances
      .slice(0, 3)
      .map(({ price, date, label }) => ({ price, date, label })),
  };
}

function evaluateTimeframeSentiment(
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  bars: OhlcvBar[]
): BotStockAnalysis['periodicAnalysis']['sentiment']['daily'] {
  const cfg =
    timeframe === 'DAILY'
      ? {
          minBars: 22,
          shortP: 9,
          longP: 21,
          rsiP: 14,
          retLookback: 20,
          shortLabel: 'EMA 9',
          longLabel: 'EMA 21',
          retLabel: '20D Ret',
        }
      : timeframe === 'WEEKLY'
        ? {
            minBars: 12,
            shortP: 10,
            longP: 20,
            rsiP: 14,
            retLookback: 4,
            shortLabel: 'W-EMA 10',
            longLabel: 'W-EMA 20',
            retLabel: '4W Ret',
          }
        : {
            minBars: 7,
            shortP: 6,
            longP: 12,
            rsiP: 6,
            retLookback: 3,
            shortLabel: 'M-EMA 6',
            longLabel: 'M-EMA 12',
            retLabel: '3M Ret',
          };

  if (bars.length < cfg.minBars) {
    return {
      timeframe: timeframe as 'DAILY',
      status: 'DATA NOT AVAILABLE',
      score: null,
      candlesCount: bars.length,
      returnPct: null,
      returnLabel: cfg.retLabel,
      emaShort: null,
      emaLong: null,
      emaShortLabel: cfg.shortLabel,
      emaLongLabel: cfg.longLabel,
      aboveEmaShort: null,
      aboveEmaLong: null,
      rsi: null,
      reasons: [`Need >=${cfg.minBars} ${timeframe.toLowerCase()} candles (have ${bars.length})`],
    };
  }

  const closes = bars.map((b) => b.close);
  const lastIdx = closes.length - 1;
  const latestClose = closes[lastIdx];

  const emaShortArr = computeEmaSeries(closes, cfg.shortP);
  const emaLongArr =
    closes.length >= cfg.longP ? computeEmaSeries(closes, cfg.longP) : new Array(closes.length).fill(null);
  const rsiArr =
    closes.length > cfg.rsiP ? computeRsiSeries(closes, cfg.rsiP) : new Array(closes.length).fill(null);

  const emaShortRaw = emaShortArr[lastIdx];
  const emaLongRaw = emaLongArr[lastIdx];
  const rsiRaw = rsiArr[lastIdx];

  const emaShort = emaShortRaw !== null ? Number(emaShortRaw.toFixed(2)) : null;
  const emaLong = emaLongRaw !== null ? Number(emaLongRaw.toFixed(2)) : null;
  const rsi = rsiRaw !== null ? Number(rsiRaw.toFixed(1)) : null;

  const baseIdx = Math.max(0, lastIdx - cfg.retLookback);
  const baseClose = closes[baseIdx];
  const returnPct =
    baseClose > 0 ? Number((((latestClose - baseClose) / baseClose) * 100).toFixed(2)) : null;

  const aboveEmaShort = emaShort !== null ? latestClose > emaShort : null;
  const aboveEmaLong = emaLong !== null ? latestClose > emaLong : null;

  let score = 50;
  const reasons: string[] = [];

  if (aboveEmaShort !== null) {
    if (aboveEmaShort) {
      score += 15;
      reasons.push(`Close > ${cfg.shortLabel} (₹${emaShort})`);
    } else {
      score -= 15;
      reasons.push(`Close < ${cfg.shortLabel} (₹${emaShort})`);
    }
  }

  if (aboveEmaLong !== null) {
    if (aboveEmaLong) {
      score += 15;
      reasons.push(`Close > ${cfg.longLabel} (₹${emaLong})`);
    } else {
      score -= 15;
      reasons.push(`Close < ${cfg.longLabel} (₹${emaLong})`);
    }
  }

  if (emaShort !== null && emaLong !== null) {
    if (emaShort > emaLong) {
      score += 10;
      reasons.push(`${cfg.shortLabel} > ${cfg.longLabel}`);
    } else {
      score -= 10;
      reasons.push(`${cfg.shortLabel} < ${cfg.longLabel}`);
    }
  }

  if (returnPct !== null) {
    if (returnPct >= 1) {
      score += 10;
      reasons.push(`${cfg.retLabel} +${returnPct}%`);
    } else if (returnPct <= -1) {
      score -= 10;
      reasons.push(`${cfg.retLabel} ${returnPct}%`);
    } else {
      reasons.push(`${cfg.retLabel} ${returnPct >= 0 ? '+' : ''}${returnPct}% (flat)`);
    }
  }

  if (rsi !== null) {
    if (rsi >= 52 && rsi <= 78) {
      score += 10;
      reasons.push(`RSI(${cfg.rsiP}) ${rsi} bullish`);
    } else if (rsi > 78) {
      score += 5;
      reasons.push(`RSI(${cfg.rsiP}) ${rsi} overbought`);
    } else if (rsi < 45) {
      score -= 10;
      reasons.push(`RSI(${cfg.rsiP}) ${rsi} weak`);
    } else {
      reasons.push(`RSI(${cfg.rsiP}) ${rsi} neutral`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' =
    score >= 60 ? 'BULLISH' : score <= 40 ? 'BEARISH' : 'NEUTRAL';

  return {
    timeframe: timeframe as 'DAILY',
    status,
    score,
    candlesCount: bars.length,
    returnPct,
    returnLabel: cfg.retLabel,
    emaShort,
    emaLong,
    emaShortLabel: cfg.shortLabel,
    emaLongLabel: cfg.longLabel,
    aboveEmaShort,
    aboveEmaLong,
    rsi,
    reasons,
  };
}

function evaluatePeriodicAnalysis(params: {
  closePrice: number;
  bars: OhlcvBar[];
  phase4Movement: BotStockAnalysis['phase4Movement'];
}): BotStockAnalysis['periodicAnalysis'] {
  const { closePrice, bars, phase4Movement } = params;

  const supportResistance = computeSupportResistance(closePrice, bars);
  const weeklyBars = resampleOhlcvTimeframe(bars, 'WEEKLY');
  const monthlyBars = resampleOhlcvTimeframe(bars, 'MONTHLY');

  const daily = evaluateTimeframeSentiment('DAILY', bars);
  const weekly = evaluateTimeframeSentiment('WEEKLY', weeklyBars) as unknown as BotStockAnalysis['periodicAnalysis']['sentiment']['weekly'];
  const monthly = evaluateTimeframeSentiment('MONTHLY', monthlyBars) as unknown as BotStockAnalysis['periodicAnalysis']['sentiment']['monthly'];

  const tfList = [daily, weekly, monthly];
  const availableTimeframesCount = tfList.filter((t) => t.status !== 'DATA NOT AVAILABLE').length;
  const bullishTimeframesCount = tfList.filter((t) => t.status === 'BULLISH').length;

  let mtfAlignment = 'DATA NOT AVAILABLE';
  if (availableTimeframesCount > 0) {
    if (bullishTimeframesCount === availableTimeframesCount && availableTimeframesCount === 3) {
      mtfAlignment = '3/3 ALL BULLISH (D+W+M)';
    } else if (bullishTimeframesCount === availableTimeframesCount) {
      mtfAlignment = `${bullishTimeframesCount}/${availableTimeframesCount} BULLISH (Limited History)`;
    } else if (bullishTimeframesCount === 0) {
      mtfAlignment = `0/${availableTimeframesCount} NO BULLISH TF`;
    } else {
      mtfAlignment = `${bullishTimeframesCount}/${availableTimeframesCount} BULLISH`;
    }
  }

  // Component raw scores (0-100) for Periodic Score
  const netBurstRawScore =
    phase4Movement.netBurstNormalized !== null
      ? Math.max(0, Math.min(100, Math.round(50 + phase4Movement.netBurstNormalized * 1.5)))
      : null;

  let srPositionScore: number | null = null;
  if (supportResistance.positionStatus !== 'DATA NOT AVAILABLE') {
    if (supportResistance.positionStatus === 'BREAKOUT_ABOVE_R1') srPositionScore = 90;
    else if (supportResistance.positionStatus === 'NEAR_SUPPORT') {
      srPositionScore =
        supportResistance.riskRewardToR1 !== null && supportResistance.riskRewardToR1 >= 1.5 ? 85 : 75;
    } else if (supportResistance.positionStatus === 'MID_RANGE') srPositionScore = 60;
    else if (supportResistance.positionStatus === 'NEAR_RESISTANCE') srPositionScore = 38;
    else srPositionScore = 20;
  }

  const components: Array<{
    label: string;
    weightPct: number;
    rawScore: number | null;
    detail: string;
  }> = [
    {
      label: 'Daily Bullish Sentiment',
      weightPct: 25,
      rawScore: daily.score,
      detail:
        daily.score !== null
          ? `${daily.status} (${daily.score}/100 · ${daily.candlesCount}D)`
          : 'DATA NOT AVAILABLE',
    },
    {
      label: 'Weekly Bullish Sentiment',
      weightPct: 30,
      rawScore: weekly.score,
      detail:
        weekly.score !== null
          ? `${weekly.status} (${weekly.score}/100 · ${weekly.candlesCount}W)`
          : 'DATA NOT AVAILABLE',
    },
    {
      label: 'Monthly Bullish Sentiment',
      weightPct: 25,
      rawScore: monthly.score,
      detail:
        monthly.score !== null
          ? `${monthly.status} (${monthly.score}/100 · ${monthly.candlesCount}M)`
          : 'DATA NOT AVAILABLE',
    },
    {
      label: 'Net Burst Power Bias (Up − Down)',
      weightPct: 10,
      rawScore: netBurstRawScore,
      detail:
        phase4Movement.netBurstNormalized !== null
          ? `${phase4Movement.burstBias} (Up ${phase4Movement.burstPowerNormalized} vs Dn ${phase4Movement.downwardBurstNormalized})`
          : 'DATA NOT AVAILABLE',
    },
    {
      label: 'Support / Resistance Zone',
      weightPct: 10,
      rawScore: srPositionScore,
      detail:
        supportResistance.positionStatus !== 'DATA NOT AVAILABLE'
          ? `${supportResistance.positionStatus.replace(/_/g, ' ')} (S1 ₹${supportResistance.nearestSupport ?? '—'} · R1 ₹${supportResistance.nearestResistance ?? '—'})`
          : 'DATA NOT AVAILABLE',
    },
  ];

  const availableWeight = components.reduce(
    (sum, c) => (c.rawScore !== null ? sum + c.weightPct : sum),
    0
  );

  let periodicScoreVal: number | null = null;
  const breakdown = components.map((c) => {
    if (c.rawScore === null || availableWeight <= 0) {
      return {
        label: c.label,
        weightPct: c.weightPct,
        rawScore: null,
        weightedPoints: null,
        detail: c.detail,
      };
    }
    const weightedPoints = Number(((c.rawScore * c.weightPct) / availableWeight).toFixed(1));
    return {
      label: c.label,
      weightPct: c.weightPct,
      rawScore: c.rawScore,
      weightedPoints,
      detail: c.detail,
    };
  });

  if (availableWeight >= 50) {
    const sum = breakdown.reduce((acc, b) => acc + (b.weightedPoints ?? 0), 0);
    periodicScoreVal = Math.max(0, Math.min(100, Math.round(sum)));
  }

  const grade: BotStockAnalysis['periodicAnalysis']['periodicScore']['grade'] =
    periodicScoreVal === null
      ? 'DATA NOT AVAILABLE'
      : periodicScoreVal >= 75
        ? 'STRONG_BULLISH'
        : periodicScoreVal >= 60
          ? 'BULLISH'
          : periodicScoreVal >= 45
            ? 'NEUTRAL'
            : 'WEAK';

  return {
    supportResistance,
    sentiment: {
      daily,
      weekly,
      monthly,
      bullishTimeframesCount,
      availableTimeframesCount,
      mtfAlignment,
    },
    periodicScore: {
      score: periodicScoreVal,
      grade,
      formulaText:
        'Periodic Score (0–100) = 25% Daily Sentiment + 30% Weekly Sentiment + 25% Monthly Sentiment + 10% Net Burst Bias (Up−Down) + 10% Support/Resistance Position',
      definitionSummary:
        'Periodic Score measures multi-horizon price strength across Daily (short-term momentum via EMA9/21 & RSI), Weekly (primary swing structure via W-EMA10/20), and Monthly (macro trend via M-EMA6/12) timeframes, adjusted by 252D Upward vs Downward Burst dominance and proximity to real OHLCV Support (S1/S2) and Resistance (R1/R2) levels. If Monthly history is shorter than 7 months (e.g., new IPO), weights normalize transparently across available timeframes.',
      thresholdGuide:
        '75–100 Strong Bullish (MTF Aligned) · 60–74 Bullish · 45–59 Neutral / Rangebound · 0–44 Weak / Bearish',
      breakdown,
    },
  };
}

// =========================================================================
// PHASE 5: ACCUMULATION DETECTION (WYCKOFF + VCP + DELIVERY + BULK)
// =========================================================================

function evaluatePhase5Accumulation(params: {
  symbol: string;
  summary: ScreenerRow;
  fund: FundamentalProfile | null;
  bars: OhlcvBar[];
  bhavHistory: DailyBhavRow[];
  bulkDeals: BulkBlockDealItem[];
  indianFund: IndianFundamentalsPayload | null;
}): BotStockAnalysis['phase5Accumulation'] {
  const { symbol, summary, fund, bars, bhavHistory, bulkDeals, indianFund } = params;

  let wyckoffSellingClimax: boolean | null = null;
  let wyckoffSecondaryTest: boolean | null = null;
  let wyckoffSpring: boolean | null = null;
  let wyckoffSos: boolean | null = null;
  let vcpDetected: boolean | null = null;
  let vcpDetail = 'DATA NOT AVAILABLE';

  if (bars.length >= 45) {
    const n = bars.length;
    const recentWindowStart = Math.max(20, n - 15);
    const volAvg20At = (idx: number) => {
      const s = bars.slice(Math.max(0, idx - 20), idx);
      return s.reduce((a, b) => a + b.volume, 0) / Math.max(1, s.length);
    };

    wyckoffSellingClimax = false;
    wyckoffSecondaryTest = false;
    wyckoffSpring = false;
    wyckoffSos = false;

    let climaxLow: number | null = null;
    for (let i = Math.max(20, n - 30); i < n - 1; i++) {
      const b = bars[i];
      const prevC = bars[i - 1].close;
      const vAvg = volAvg20At(i);
      const dropPct = prevC > 0 ? ((b.close - prevC) / prevC) * 100 : 0;
      const nextUp = bars[i + 1].close > b.close;
      if (b.volume > vAvg * 2.0 && dropPct <= -2.5 && nextUp) {
        wyckoffSellingClimax = true;
        climaxLow = b.low;
      }
    }

    if (climaxLow !== null) {
      for (let i = Math.max(20, n - 12); i < n; i++) {
        const b = bars[i];
        const vAvg = volAvg20At(i);
        if (b.low <= climaxLow * 1.03 && b.low >= climaxLow * 0.985 && b.volume < vAvg * 0.85) {
          wyckoffSecondaryTest = true;
        }
      }
    }

    for (let i = recentWindowStart; i < n; i++) {
      const b = bars[i];
      const prior20Low = Math.min(...bars.slice(i - 20, i).map((x) => x.low));
      const prior20High = Math.max(...bars.slice(i - 20, i).map((x) => x.high));
      const vAvg = volAvg20At(i);

      // Spring: breaks <= 2% below 20-day low, closes back above 20-day low on >=1.5x vol
      if (b.low <= prior20Low * 0.985 && b.close > prior20Low && b.volume > vAvg * 1.5) {
        wyckoffSpring = true;
      }
      // SOS: breaks 20-day high on >=1.5x vol & green candle
      if (b.close > prior20High && b.close > b.open && b.volume > vAvg * 1.5) {
        wyckoffSos = true;
      }
    }

    // VCP across 3 sequential 12-bar contractions
    const seg1 = bars.slice(-39, -26);
    const seg2 = bars.slice(-26, -13);
    const seg3 = bars.slice(-13);
    const rangePct = (seg: OhlcvBar[]) => {
      const hi = Math.max(...seg.map((x) => x.high));
      const lo = Math.min(...seg.map((x) => x.low));
      return lo > 0 ? ((hi - lo) / lo) * 100 : 0;
    };
    const r1 = rangePct(seg1);
    const r2 = rangePct(seg2);
    const r3 = rangePct(seg3);
    const vEarly = bars.slice(-35, -10).reduce((a, b) => a + b.volume, 0) / 25;
    const vLate = bars.slice(-10).reduce((a, b) => a + b.volume, 0) / 10;
    const contracting = r1 >= 7 && r2 < r1 && r3 < r2 && r3 <= r1 * 0.65 && vLate < vEarly;
    vcpDetected = contracting;
    vcpDetail = contracting
      ? `Contracting ${r1.toFixed(1)}% → ${r2.toFixed(1)}% → ${r3.toFixed(1)}% (vol dry-up)`
      : `Ranges ${r1.toFixed(1)}% → ${r2.toFixed(1)}% → ${r3.toFixed(1)}%`;
  }

  // Official NSE VWAP from latest Bhavcopy avgPrice
  const latestBhav = bhavHistory[bhavHistory.length - 1];
  const vwapPrice = latestBhav?.avgPrice ?? null;
  const aboveVwap =
    vwapPrice !== null && vwapPrice > 0 ? summary.closePrice >= vwapPrice : null;

  // Section 6D: Bulk & Block Deal Confirmation (30D NSE Archive)
  const allSymDeals = bulkDeals
    .filter((d) => d.symbol === symbol)
    .sort((a, b) => b.date.localeCompare(a.date));
  const symBuyDeals = allSymDeals.filter((d) => d.buySell.toUpperCase().includes('BUY'));
  const symSellDeals = allSymDeals.filter((d) => d.buySell.toUpperCase().includes('SELL'));

  const bulkBuyCount = symBuyDeals.filter((d) => d.dealType === 'BULK').length;
  const blockBuyCount = symBuyDeals.filter((d) => d.dealType === 'BLOCK').length;
  const bulkSellCount = symSellDeals.filter((d) => d.dealType === 'BULK').length;
  const blockSellCount = symSellDeals.filter((d) => d.dealType === 'BLOCK').length;

  const totalBuyVal = symBuyDeals.reduce((a, d) => a + (d.valueCr || 0), 0);
  const totalSellVal = symSellDeals.reduce((a, d) => a + (d.valueCr || 0), 0);
  const netValueCr = Number((totalBuyVal - totalSellVal).toFixed(2));

  const clientCounts = new Map<string, number>();
  for (const d of symBuyDeals) {
    const c = d.clientName.trim().toUpperCase();
    if (!c) continue;
    clientCounts.set(c, (clientCounts.get(c) ?? 0) + 1);
  }
  let repeatedBuyClientName: string | null = null;
  let bulkDealRepeatedPrints = 0;
  for (const [client, count] of clientCounts.entries()) {
    if (count > bulkDealRepeatedPrints) {
      bulkDealRepeatedPrints = count;
      repeatedBuyClientName = client;
    }
  }

  const largestBuyDealCr =
    symBuyDeals.length > 0
      ? Number(Math.max(...symBuyDeals.map((d) => d.valueCr || 0)).toFixed(2))
      : null;
  const avgTurnover20DCr =
    summary.avgTurnover20DCr !== null && summary.avgTurnover20DCr > 0
      ? Number(summary.avgTurnover20DCr.toFixed(2))
      : null;
  const sizeVsAdvPct =
    largestBuyDealCr !== null && avgTurnover20DCr !== null && avgTurnover20DCr > 0
      ? Number(((largestBuyDealCr / avgTurnover20DCr) * 100).toFixed(1))
      : null;
  const largePrintFlag =
    largestBuyDealCr !== null &&
    (largestBuyDealCr >= 20 || (sizeVsAdvPct !== null && sizeVsAdvPct >= 50));

  const recent20 = bhavHistory.slice(-20);
  const recentRange20dHigh =
    recent20.length > 0
      ? Number(
          Math.max(...recent20.map((b) => b.high ?? b.close ?? 0)).toFixed(2)
        )
      : null;
  const recentRange20dLow =
    recent20.length > 0
      ? Number(
          Math.min(
            ...recent20.map((b) => b.low ?? b.close ?? Infinity).filter((v) => v > 0)
          ).toFixed(2)
        )
      : null;

  const avgBuyDealPrice = computeWeightedAvgBuyDealPrice(symBuyDeals);

  let priceContext: BotStockAnalysis['phase5Accumulation']['bulkBlockConfirmation']['priceContext'] =
    'NO_BUY_DEALS';
  if (avgBuyDealPrice !== null && recentRange20dHigh !== null && recentRange20dHigh > 0) {
    if (avgBuyDealPrice >= recentRange20dHigh * 0.99) {
      priceContext = 'ABOVE_RANGE';
    } else if (
      recentRange20dLow !== null &&
      Number.isFinite(recentRange20dLow) &&
      avgBuyDealPrice <= recentRange20dLow * 1.01
    ) {
      priceContext = 'BELOW_RANGE';
    } else {
      priceContext = 'INSIDE_RANGE';
    }
  }

  const totalBuyValCr = Number(totalBuyVal.toFixed(2));
  const totalSellValCr = Number(totalSellVal.toFixed(2));
  const totalValCr = totalBuyValCr + totalSellValCr;
  const buyPct =
    totalValCr > 0 ? Number(((totalBuyValCr / totalValCr) * 100).toFixed(1)) : undefined;

  const formatClientVal = (val: number) =>
    val > 0 && val < 0.1 ? `₹${(val * 100).toFixed(1)} L` : `₹${val.toFixed(2)} Cr`;

  const clientVolBuy = new Map<string, number>();
  for (const d of symBuyDeals) {
    const c = d.clientName.trim();
    if (c) clientVolBuy.set(c, (clientVolBuy.get(c) ?? 0) + (d.valueCr || 0));
  }
  const topBuyClients = [...clientVolBuy.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, val]) => `${name} (${formatClientVal(val)})`);

  const clientVolSell = new Map<string, number>();
  for (const d of symSellDeals) {
    const c = d.clientName.trim();
    if (c) clientVolSell.set(c, (clientVolSell.get(c) ?? 0) + (d.valueCr || 0));
  }
  const topSellClients = [...clientVolSell.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, val]) => `${name} (${formatClientVal(val)})`);

  let confirmationStatus: BotStockAnalysis['phase5Accumulation']['bulkBlockConfirmation']['confirmationStatus'] =
    'NO_30D_DEALS';
  let confirmationReason = 'No Bulk/Block deals recorded in last 30D NSE archive.';

  if (allSymDeals.length > 0) {
    const flowSummary = `Buy ₹${totalBuyValCr} Cr (${symBuyDeals.length} deals) vs Sell ₹${totalSellValCr} Cr (${symSellDeals.length} deals) · Net ${netValueCr >= 0 ? '+' : ''}₹${netValueCr} Cr${buyPct !== undefined ? ` · ${buyPct}% Buy Share` : ''}`;
    if (
      symBuyDeals.length > 0 &&
      netValueCr > 0 &&
      (bulkDealRepeatedPrints >= 2 || largePrintFlag || priceContext === 'ABOVE_RANGE')
    ) {
      confirmationStatus = 'CONFIRMED';
      const reasons: string[] = [flowSummary];
      if (bulkDealRepeatedPrints >= 2) reasons.push(`${bulkDealRepeatedPrints}x repeated buyer (${repeatedBuyClientName})`);
      if (largePrintFlag) reasons.push(`Large print ₹${largestBuyDealCr} Cr (${sizeVsAdvPct ?? '—'}% ADV)`);
      if (priceContext === 'ABOVE_RANGE') reasons.push('Accumulated above 20D high');
      if (topBuyClients.length > 0) reasons.push(`Top Buyer: ${topBuyClients[0]}`);
      confirmationReason = reasons.join(' · ');
    } else if (netValueCr < 0 && symSellDeals.length >= symBuyDeals.length) {
      confirmationStatus = 'SELL_PRESSURE';
      confirmationReason = `Distribution Pressure: ${flowSummary}${topSellClients.length > 0 ? ` · Top Seller: ${topSellClients[0]}` : ''}`;
    } else {
      confirmationStatus = 'ACTIVE_WATCH';
      confirmationReason = `Active Institutional Flow: ${flowSummary}${topBuyClients.length > 0 ? ` · Key Buyer: ${topBuyClients[0]}` : ''}`;
    }
  }

  const bulkBlockConfirmation: BotStockAnalysis['phase5Accumulation']['bulkBlockConfirmation'] = {
    totalDeals30d: allSymDeals.length,
    bulkBuyCount,
    bulkSellCount,
    blockBuyCount,
    blockSellCount,
    netValueCr,
    totalBuyCr: totalBuyValCr,
    totalSellCr: totalSellValCr,
    buyPct,
    topBuyClients,
    topSellClients,
    largestBuyDealCr,
    avgTurnover20DCr,
    sizeVsAdvPct,
    largePrintFlag,
    repeatedBuyClientName,
    repeatedBuyPrints: bulkDealRepeatedPrints,
    avgBuyDealPrice,
    recentRange20dHigh,
    priceContext,
    confirmationStatus,
    confirmationReason,
    recentDeals: allSymDeals.slice(0, 8).map((d) => ({
      date: d.date,
      dealType: d.dealType,
      clientName: d.clientName,
      buySell: d.buySell,
      tradePrice: d.tradePrice,
      valueCr: d.valueCr,
    })),
  };

  const promoterHoldingPct =
    indianFund?.promoterHoldingPct ??
    fund?.promoterHoldingPct ??
    null;
  const fiiHoldingPct = indianFund?.fiiHoldingPct ?? fund?.fiiHoldingPct ?? null;
  const diiHoldingPct = indianFund?.diiHoldingPct ?? fund?.diiHoldingPct ?? null;
  const smartMoneyTotalPct =
    promoterHoldingPct !== null && (fiiHoldingPct !== null || diiHoldingPct !== null)
      ? Number(
          (promoterHoldingPct + (fiiHoldingPct ?? 0) + (diiHoldingPct ?? 0)).toFixed(1)
        )
      : null;

  let fiiDiiMultiQuarterTrend: BotStockAnalysis['phase5Accumulation']['fiiDiiMultiQuarterTrend'] =
    'DATA NOT AVAILABLE';
  let fiiDiiTrendDetail = 'Quarterly FII/DII series unavailable in Screener/NSE cache';
  const quarters = indianFund?.shareholdingQuarters ?? [];
  const combinedSeries = quarters
    .map((q) => ({
      period: q.period,
      total: Number(((q.fiiPct ?? 0) + (q.diiPct ?? 0)).toFixed(2)),
      hasAny: q.fiiPct !== null || q.diiPct !== null,
    }))
    .filter((x) => x.hasAny);

  if (combinedSeries.length >= 3) {
    const qPrev2 = combinedSeries[combinedSeries.length - 3];
    const qPrev1 = combinedSeries[combinedSeries.length - 2];
    const qCurr = combinedSeries[combinedSeries.length - 1];
    const delta2Q = Number((qCurr.total - qPrev2.total).toFixed(2));
    const delta1Q = Number((qCurr.total - qPrev1.total).toFixed(2));
    const rising2Consec = qCurr.total > qPrev1.total && qPrev1.total > qPrev2.total;
    const falling2Consec = qCurr.total < qPrev1.total && qPrev1.total < qPrev2.total;

    if ((rising2Consec && delta2Q >= 0.25) || (delta2Q >= 0.75 && delta1Q >= 0)) {
      fiiDiiMultiQuarterTrend = 'INCREASING';
    } else if ((falling2Consec && delta2Q <= -0.25) || (delta2Q <= -0.75 && delta1Q <= 0)) {
      fiiDiiMultiQuarterTrend = 'DECREASING';
    } else {
      fiiDiiMultiQuarterTrend = 'FLAT / MIXED';
    }
    fiiDiiTrendDetail = `${qPrev2.period} ${qPrev2.total}% → ${qPrev1.period} ${qPrev1.total}% → ${qCurr.period} ${qCurr.total}% (${delta2Q >= 0 ? '+' : ''}${delta2Q}% 2Q)`;
  } else if (combinedSeries.length === 2) {
    const qPrev1 = combinedSeries[0];
    const qCurr = combinedSeries[1];
    const delta = Number((qCurr.total - qPrev1.total).toFixed(2));
    fiiDiiMultiQuarterTrend =
      delta >= 0.5 ? 'INCREASING' : delta <= -0.5 ? 'DECREASING' : 'FLAT / MIXED';
    fiiDiiTrendDetail = `${qPrev1.period} ${qPrev1.total}% → ${qCurr.period} ${qCurr.total}% (${delta >= 0 ? '+' : ''}${delta}%)`;
  }

  return {
    wyckoffSellingClimax,
    wyckoffSecondaryTest,
    wyckoffSpring,
    wyckoffSos,
    vcpDetected,
    vcpDetail,
    deliveryDailyPct: summary.delivPer,
    delivery5dAvgPct: summary.avgDeliv5D,
    rvol: summary.rvol,
    aboveVwap,
    bulkDealRepeatedPrints,
    bulkBlockConfirmation,
    promoterHoldingPct:
      promoterHoldingPct !== null ? Number(promoterHoldingPct.toFixed(2)) : null,
    fiiHoldingPct: fiiHoldingPct !== null ? Number(fiiHoldingPct.toFixed(2)) : null,
    diiHoldingPct: diiHoldingPct !== null ? Number(diiHoldingPct.toFixed(2)) : null,
    smartMoneyTotalPct,
    fiiDiiMultiQuarterTrend,
    fiiDiiTrendDetail,
    fiiDiiQuarterSeries: quarters,
    promoterPledgePct: null,
    institutionalLimitationNote:
      quarters.length > 0
        ? 'Multi-quarter Promoter/FII/DII parsed from public Screener.in shareholding table. Promoter pledge % remains DATA NOT AVAILABLE unless verified.'
        : 'Quarterly FII/DII history and promoter pledge % are marked DATA NOT AVAILABLE when uncached/unverified.',
  };
}

// =========================================================================
// PHASE 6: FAST ENTRY TRIGGERS (EARLIER THAN EMA 44)
// =========================================================================

function evaluatePhase6EntryTriggers(
  bars: OhlcvBar[],
  aboveVwap: boolean | null
): BotStockAnalysis['phase6EntryTriggers'] {
  if (bars.length < 5) {
    return {
      ema9: null,
      ema20: null,
      ema21: null,
      ema44: null,
      ema50: null,
      ema200: null,
      ema21AboveEma44: null,
      ema21Cross44Bullish: null,
      ema21Cross44DaysAgo: null,
      rsi14: null,
      macdHistogram: null,
      bbLower: null,
      trendAligned20_50_200: null,
      fastSignalsTriggered: [],
      anyFastEntryTriggered: false,
      gapUpPct: null,
      gapUpSkip: false,
    };
  }

  const closes = bars.map((b) => b.close);
  const ema9S = computeEmaSeries(closes, 9);
  const ema20S = computeEmaSeries(closes, 20);
  const ema21S = computeEmaSeries(closes, 21);
  const ema44S = computeEmaSeries(closes, 44);
  const ema50S = computeEmaSeries(closes, 50);
  const ema200S = computeEmaSeries(closes, 200);
  const rsiS = computeRsiSeries(closes, 14);
  const macdHistS = computeMacdHistSeries(closes);
  const bbLowerS = computeBollingerLowerSeries(closes, 20, 2);

  const i = bars.length - 1;
  const ema9 = ema9S[i];
  const ema20 = ema20S[i];
  const ema21 = ema21S[i];
  const ema44 = ema44S[i];
  const ema50 = ema50S[i];
  const ema200 = ema200S[i];
  const rsi14 = rsiS[i];
  const macdHistogram = macdHistS[i];
  const bbLower = bbLowerS[i];

  const ema21AboveEma44 =
    ema21 !== null && ema44 !== null ? ema21 > ema44 : null;
  let ema21Cross44Bullish: boolean | null =
    ema21 !== null && ema44 !== null ? false : null;
  let ema21Cross44DaysAgo: number | null = null;
  if (ema21 !== null && ema44 !== null) {
    for (let look = 0; look < 5 && i - look >= 1; look++) {
      const idx = i - look;
      const c21 = ema21S[idx];
      const c44 = ema44S[idx];
      const p21 = ema21S[idx - 1];
      const p44 = ema44S[idx - 1];
      if (
        c21 !== null &&
        c44 !== null &&
        p21 !== null &&
        p44 !== null &&
        p21 <= p44 &&
        c21 > c44
      ) {
        ema21Cross44Bullish = true;
        ema21Cross44DaysAgo = look;
        break;
      }
    }
  }

  const vol20Avg =
    bars.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b.volume, 0) /
    Math.max(1, Math.min(20, i));
  const lastVolRatio = vol20Avg > 0 ? bars[i].volume / vol20Avg : 0;

  const fastSignalsTriggered: string[] = [];

  if (ema21Cross44Bullish) {
    fastSignalsTriggered.push(
      `EMA 21/44 Bullish Crossover (${ema21Cross44DaysAgo === 0 ? 'Today' : `${ema21Cross44DaysAgo}D ago`})`
    );
  }

  // 1. EMA 9/21 Bullish Cross (last 2 sessions) + Volume 1.5x + Above VWAP
  const emaCrossRecent = [i - 1, i].some((idx) => {
    if (idx < 1) return false;
    const c9 = ema9S[idx];
    const c21 = ema21S[idx];
    const p9 = ema9S[idx - 1];
    const p21 = ema21S[idx - 1];
    return c9 !== null && c21 !== null && p9 !== null && p21 !== null && p9 <= p21 && c9 > c21;
  });
  if (emaCrossRecent && lastVolRatio >= 1.5 && aboveVwap !== false) {
    fastSignalsTriggered.push('EMA 9/21 Cross + 1.5x Vol + VWAP');
  }

  // 2. RSI(14) < 30 -> cross above 35 + higher low
  const recentLowRsi = Math.min(
    ...[i - 5, i - 4, i - 3, i - 2, i - 1]
      .filter((k) => k >= 0 && rsiS[k] !== null)
      .map((k) => rsiS[k] as number)
  );
  const prevRsi = rsiS[i - 1];
  if (
    Number.isFinite(recentLowRsi) &&
    recentLowRsi < 30 &&
    rsi14 !== null &&
    rsi14 >= 35 &&
    (prevRsi === null || prevRsi < 35)
  ) {
    fastSignalsTriggered.push('RSI(14) <30 → >35 Reversal');
  }

  // 3. MACD Histogram negative -> positive flip
  const prevHist = macdHistS[i - 1];
  if (macdHistogram !== null && prevHist !== null && prevHist <= 0 && macdHistogram > 0) {
    fastSignalsTriggered.push('MACD Histogram Neg → Pos Flip');
  }

  // 4. Bollinger Lower Band touch + close inside
  if (bbLower !== null && bars[i].low <= bbLower * 1.003 && bars[i].close > bbLower) {
    fastSignalsTriggered.push('Bollinger Lower Band Bounce');
  }

  // 5. 20-day low reclaim + volume spike
  if (i >= 21) {
    const prior20Low = Math.min(...bars.slice(i - 21, i - 1).map((b) => b.low));
    if (bars[i].low <= prior20Low * 1.005 && bars[i].close > prior20Low && lastVolRatio >= 1.5) {
      fastSignalsTriggered.push('20D Low Reclaim + Vol Spike');
    }
  }

  // 6. 3-4D volume dry-up + first green candle >= 1.5x
  if (i >= 5) {
    const prior3Dry = [i - 3, i - 2, i - 1].every((idx) => bars[idx].volume < vol20Avg * 0.85);
    if (prior3Dry && bars[i].close > bars[i].open && lastVolRatio >= 1.5) {
      fastSignalsTriggered.push('3-4D Vol Dry-up + 1.5x Green Candle');
    }
  }

  const trendAligned20_50_200 =
    ema20 !== null && ema50 !== null && ema200 !== null
      ? bars[i].close > ema20 && ema20 > ema50 && ema50 > ema200
      : null;

  const prevClose = bars[i - 1]?.close ?? null;
  const gapUpPct =
    prevClose && prevClose > 0
      ? Number((((bars[i].open - prevClose) / prevClose) * 100).toFixed(2))
      : null;

  return {
    ema9: ema9 !== null ? Number(ema9.toFixed(2)) : null,
    ema20: ema20 !== null ? Number(ema20.toFixed(2)) : null,
    ema21: ema21 !== null ? Number(ema21.toFixed(2)) : null,
    ema44: ema44 !== null ? Number(ema44.toFixed(2)) : null,
    ema50: ema50 !== null ? Number(ema50.toFixed(2)) : null,
    ema200: ema200 !== null ? Number(ema200.toFixed(2)) : null,
    ema21AboveEma44,
    ema21Cross44Bullish,
    ema21Cross44DaysAgo,
    rsi14: rsi14 !== null ? Number(rsi14.toFixed(1)) : null,
    macdHistogram: macdHistogram !== null ? Number(macdHistogram.toFixed(3)) : null,
    bbLower: bbLower !== null ? Number(bbLower.toFixed(2)) : null,
    trendAligned20_50_200,
    fastSignalsTriggered,
    anyFastEntryTriggered: fastSignalsTriggered.length > 0,
    gapUpPct,
    gapUpSkip: gapUpPct !== null && gapUpPct >= 3.0,
  };
}

// =========================================================================
// FULL SINGLE-STOCK PIPELINE (PHASES 1-8 + SECTION 11 SCORING)
// =========================================================================

export async function analyzeStockWithV3Bot(
  symbol: string,
  options?: {
    forceRefresh?: boolean;
    dashboard?: MacroNewsDashboardResponse;
    sector1mMap?: Map<string, number>;
    bulkDeals?: BulkBlockDealItem[];
    allRows?: ScreenerRow[];
  }
): Promise<BotStockAnalysis> {
  const sym = symbol.trim().toUpperCase();
  const detail = nsePipeline.getStockDetail(sym);
  if (!detail) {
    throw new Error(`Symbol ${sym} not found in NSE Mainboard dataset.`);
  }

  const allRows = options?.allRows ?? nsePipeline.getAllScreenerRows();
  const overview = nsePipeline.getOverview();
  const dashboard =
    options?.dashboard ??
    (await getOpenMacroAndNewsDashboard({
      allRows,
      marketSentimentScore: overview.marketSentiment.score,
      ema21BreadthPct: overview.marketSentiment.aboveEma21Pct,
    }));
  const sector1mMap = options?.sector1mMap ?? nsePipeline.getSector1mReturnMap();
  const bulkDeals = options?.bulkDeals ?? loadBulkDeals30D();

  const isTieredSwingStock =
    detail.summary.swingTier === 'TIER_1_READY' ||
    detail.summary.swingTier === 'TIER_2_ACCUMULATION' ||
    detail.summary.swingTier === 'TIER_3_RVOL_WATCH';

  const [yf, indianFund] = await Promise.all([
    fetchAndCacheYahooForSymbol(sym, Boolean(options?.forceRefresh)),
    isTieredSwingStock
      ? getVerifiedFundamentals(sym, {
          xbrlFilings: nsePipeline.getXbrlFilingsForSymbol(sym),
          forceRefresh: Boolean(options?.forceRefresh),
          forceBseProbe: true,
          allowYahooSupplement: true,
        })
          .then((res) => res.payload)
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const closePrice = detail.summary.closePrice;
  const bhavHistory = detail.history;
  const effectiveBars = mergeOhlcvWithBhav(yf.bars, bhavHistory);

  const phase2SectorMacroNews = evaluatePhase2SectorMacroNews({
    sector: detail.summary.providerSector || indianFund?.providerSector || '',
    dashboard,
    sector1mMap,
  });

  const phase3Fundamentals = evaluatePhase3Fundamentals({
    closePrice,
    summary: detail.summary,
    fund: detail.fundamentals,
    bars: effectiveBars,
    indianFund,
  });

  const capInfo = classifyMarketCap(
    indianFund?.marketCapInr ??
      detail.fundamentals?.marketCapInr ??
      (indianFund?.sharesOutstanding ? indianFund.sharesOutstanding * closePrice : null)
  );

  const phase4Movement = evaluatePhase4MovementPotential(
    sym,
    closePrice,
    effectiveBars,
    allRows,
    detail.summary.isIpo
  );

  const periodicAnalysis = evaluatePeriodicAnalysis({
    closePrice,
    bars: effectiveBars,
    phase4Movement,
  });

  const phase5Accumulation = evaluatePhase5Accumulation({
    symbol: sym,
    summary: detail.summary,
    fund: detail.fundamentals,
    bars: effectiveBars,
    bhavHistory,
    bulkDeals,
    indianFund,
  });

  const phase6EntryTriggers = evaluatePhase6EntryTriggers(
    effectiveBars,
    phase5Accumulation.aboveVwap
  );

  // Phase 7: Risk Management
  const recentSwingLow =
    yf.bars.length >= 10
      ? Math.min(...yf.bars.slice(-10).map((b) => b.low))
      : Math.min(...bhavHistory.slice(-10).map((b) => b.low ?? closePrice));
  const swingStop = recentSwingLow * 0.99;
  const stop8 = closePrice * 0.92;
  const stop12 = closePrice * 0.88;
  const stopLoss = Number(Math.max(stop12, Math.min(swingStop, stop8)).toFixed(2));
  const stopPct = Number((((closePrice - stopLoss) / closePrice) * 100).toFixed(2));

  let suggestedPositionSizePct = 18;
  if (
    dashboard.regime.regimeVerdict === 'HARD_STOP' ||
    !phase3Fundamentals.hardRejectPass
  ) {
    suggestedPositionSizePct = 0;
  } else if (
    dashboard.geopoliticalAlerts.length > 0 ||
    phase2SectorMacroNews.dxySectorFlag === 'AVOID' ||
    dashboard.regime.dxy.bias === 'STRONG_RISK' ||
    dashboard.regime.regimeVerdict === 'CAUTION_50_PCT'
  ) {
    suggestedPositionSizePct = 10;
  }

  // Phase 8: Top Detection
  const fundamentalOvervalued = phase3Fundamentals.valuation.grahamZone === 'OVERVALUED';
  const technicalOverheated =
    phase6EntryTriggers.rsi14 !== null &&
    phase6EntryTriggers.rsi14 > 80 &&
    (detail.summary.rvol ?? 0) >= 2.0;
  const distributionFlatHighDeliv =
    (detail.summary.delivPer ?? 0) >= 70 &&
    detail.summary.changePct !== null &&
    Math.abs(detail.summary.changePct) <= 1.2;

  const topWarnings: string[] = [];
  if (fundamentalOvervalued) {
    topWarnings.push(
      `Fundamental Overvalued: Price ₹${closePrice.toFixed(2)} > 1.5x Graham Number (₹${phase3Fundamentals.valuation.grahamNumber})`
    );
  }
  if (technicalOverheated) {
    topWarnings.push(
      `Technical Top Warning: RSI(14) ${phase6EntryTriggers.rsi14} > 80 + Volume Climax`
    );
  }
  if (distributionFlatHighDeliv) {
    topWarnings.push(
      `Distribution Warning: Delivery ${detail.summary.delivPer?.toFixed(1)}% >= 70% on flat price (${detail.summary.changePct?.toFixed(2)}%)`
    );
  }
  if (phase5Accumulation.fiiDiiMultiQuarterTrend === 'DECREASING') {
    topWarnings.push(
      `Institutional Exit Warning: Combined FII+DII holding decreasing (${phase5Accumulation.fiiDiiTrendDetail || 'multi-quarter'})`
    );
  }

  // Section 11: Exact Scoring Engine
  const promoterBuying3m = hasRecentPromoterBuyingInCatalystCache(sym);
  const breakdown: BotStockAnalysis['scoring']['breakdown'] = [];

  if (!phase3Fundamentals.hardRejectPass) {
    breakdown.push({
      label: 'Phase 3 Hard Reject',
      points: 0,
      active: true,
      note: phase3Fundamentals.hardRejectReasons.join('; '),
    });
    return {
      symbol: sym,
      companyName: indianFund?.companyName || detail.fundamentals?.companyName || sym,
      sector: detail.summary.providerSector || indianFund?.providerSector || 'Unclassified',
      asOfDate: detail.summary.latestDate,
      closePrice,
      isIpo: detail.summary.isIpo,
      marketCapCr: capInfo.marketCapCr,
      marketCapCategory: capInfo.marketCapCategory,
      paperTradingMode: true,
      dataCoverageNotes: [
        'Trusted Fundamentals: Screener.in + BSE Official + NSE XBRL (Yahoo Finance strictly limited to 3Y OHLCV & Global Macro).',
        ...(detail.summary.isIpo
          ? ['IPO Sector (<1Y Cohort): Evaluated with newly listed allowance for sparse multi-year history.']
          : []),
        'Any unavailable field is explicitly marked DATA NOT AVAILABLE.',
      ],
      phase1Regime: {
        verdict: dashboard.regime.regimeVerdict,
        reasons: dashboard.regime.regimeReasons,
      },
      phase2SectorMacroNews,
      phase3Fundamentals,
      phase4Movement,
      periodicAnalysis,
      phase5Accumulation,
      phase6EntryTriggers,
      phase7Risk: {
        entryPrice: closePrice,
        stopLoss,
        stopPct,
        target15Pct: Number((closePrice * 1.15).toFixed(2)),
        target25Pct: Number((closePrice * 1.25).toFixed(2)),
        suggestedPositionSizePct: 0,
        trailingBreakevenTriggerPrice: Number((closePrice * 1.2).toFixed(2)),
      },
      phase8TopWarnings: {
        fundamentalOvervalued,
        technicalOverheated,
        distributionFlatHighDeliv,
        warnings: topWarnings,
      },
      scoring: {
        totalScore: 0,
        verdict: 'HARD REJECT',
        baseScore: 0,
        breakdown,
      },
    };
  }

  const baseScore = 50;
  let totalScore = baseScore;
  const addItem = (label: string, points: number, active: boolean, note: string) => {
    if (active) totalScore += points;
    breakdown.push({ label, points, active, note });
  };

  addItem(
    'Burst Power >= 15 (252D)',
    10,
    (phase4Movement.burstPowerNormalized ?? 0) >= 15,
    phase4Movement.burstPowerNormalized !== null
      ? `${phase4Movement.burstPowerNormalized}/100`
      : 'DATA NOT AVAILABLE'
  );
  addItem(
    'Promoter Buying (Last 3M)',
    10,
    promoterBuying3m,
    promoterBuying3m ? 'Detected in BSE/NSE filings' : 'No verified open-source buy print'
  );
  addItem(
    'Wyckoff Spring Detected',
    10,
    phase5Accumulation.wyckoffSpring === true,
    phase5Accumulation.wyckoffSpring === null
      ? 'DATA NOT AVAILABLE'
      : phase5Accumulation.wyckoffSpring
        ? '20D undercut + reclaim on >=1.5x vol'
        : 'Not triggered'
  );
  addItem(
    'Delivery 5D Avg > 60%',
    10,
    (phase5Accumulation.delivery5dAvgPct ?? 0) > 60,
    phase5Accumulation.delivery5dAvgPct !== null
      ? `${phase5Accumulation.delivery5dAvgPct.toFixed(1)}%`
      : 'DATA NOT AVAILABLE'
  );
  addItem(
    'Fast Entry Trigger Confirmed',
    10,
    phase6EntryTriggers.anyFastEntryTriggered && !phase6EntryTriggers.gapUpSkip,
    phase6EntryTriggers.fastSignalsTriggered.join(', ') || 'No fast trigger today'
  );
  addItem(
    'EMA 21 > EMA 44 Bullish Trend / Cross',
    phase6EntryTriggers.ema21Cross44Bullish ? 8 : 4,
    Boolean(phase6EntryTriggers.ema21Cross44Bullish || phase6EntryTriggers.ema21AboveEma44),
    phase6EntryTriggers.ema21Cross44Bullish
      ? `Bullish Cross (${phase6EntryTriggers.ema21Cross44DaysAgo === 0 ? 'Today' : `${phase6EntryTriggers.ema21Cross44DaysAgo}D ago`})`
      : phase6EntryTriggers.ema21AboveEma44 === true
        ? `EMA 21 (₹${phase6EntryTriggers.ema21}) > EMA 44 (₹${phase6EntryTriggers.ema44})`
        : phase6EntryTriggers.ema44 === null
          ? 'DATA NOT AVAILABLE'
          : `EMA 21 (₹${phase6EntryTriggers.ema21}) <= EMA 44 (₹${phase6EntryTriggers.ema44})`
  );
  addItem(
    'Sector Outperforms Nifty 1M',
    10,
    phase2SectorMacroNews.sectorOutperformsNifty === true,
    phase2SectorMacroNews.sector1mReturnPct !== null
      ? `Sector ${phase2SectorMacroNews.sector1mReturnPct}% vs Nifty ${phase2SectorMacroNews.nifty1mReturnPct}%`
      : 'DATA NOT AVAILABLE'
  );
  addItem(
    'FII/DII 2-3Q Increasing Trend',
    10,
    phase5Accumulation.fiiDiiMultiQuarterTrend === 'INCREASING',
    phase5Accumulation.fiiDiiTrendDetail ||
      (phase5Accumulation.fiiDiiMultiQuarterTrend === 'DATA NOT AVAILABLE'
        ? 'DATA NOT AVAILABLE'
        : phase5Accumulation.fiiDiiMultiQuarterTrend)
  );
  addItem(
    'Bulk Deal Repeated Prints',
    10,
    phase5Accumulation.bulkDealRepeatedPrints >= 2,
    phase5Accumulation.bulkDealRepeatedPrints >= 2
      ? `${phase5Accumulation.bulkDealRepeatedPrints} buy prints`
      : 'None in 30D NSE Bulk Deals'
  );
  addItem(
    'Smart Money Total >= 70%',
    5,
    (phase5Accumulation.smartMoneyTotalPct ?? 0) >= 70,
    phase5Accumulation.smartMoneyTotalPct !== null
      ? `${phase5Accumulation.smartMoneyTotalPct}%`
      : 'DATA NOT AVAILABLE'
  );
  addItem(
    'Promoter Pledge Zero',
    5,
    false,
    'DATA NOT AVAILABLE (pledge % not published in free Screener/BSE summary)'
  );
  addItem(
    'RSS News Positive for Sector',
    5,
    phase2SectorMacroNews.newsBias === 'BOOST',
    phase2SectorMacroNews.newsBias
  );
  addItem(
    'RSS News Negative for Sector',
    -10,
    phase2SectorMacroNews.newsBias === 'AVOID',
    phase2SectorMacroNews.newsBias
  );
  addItem(
    'DXY Strong & Sector in AVOID',
    -10,
    phase2SectorMacroNews.dxySectorFlag === 'AVOID',
    phase2SectorMacroNews.dxySectorFlag
  );
  addItem(
    'Brent Crude > $105',
    -10,
    dashboard.regime.brentCrude.bias === 'SEVERE_RISK',
    dashboard.regime.brentCrude.detail
  );

  totalScore = Math.max(0, Math.min(100, totalScore));
  const verdict: BotStockAnalysis['scoring']['verdict'] =
    totalScore >= 85
      ? 'STRONG BUY'
      : totalScore >= 70
        ? 'BUY (75% SIZE)'
        : totalScore >= 60
          ? 'BUY (50% SIZE)'
          : 'WATCHLIST';

  return {
    symbol: sym,
    companyName: indianFund?.companyName || detail.fundamentals?.companyName || sym,
    sector: detail.summary.providerSector || indianFund?.providerSector || 'Unclassified',
    asOfDate: detail.summary.latestDate,
    closePrice,
    isIpo: detail.summary.isIpo,
    swingTier: detail.summary.swingTier,
    delivPer: detail.summary.delivPer,
    marketCapCr: capInfo.marketCapCr,
    marketCapCategory: capInfo.marketCapCategory,
    paperTradingMode: true,
    dataCoverageNotes: [
      'Trusted Fundamentals: Screener.in + BSE Official + NSE XBRL + NSE Bhavcopy + ET/BS/LiveMint RSS (Yahoo strictly for 3Y OHLCV & Global Macro).',
      ...(detail.summary.isIpo
        ? ['IPO Sector (<1Y Cohort): Evaluated with adaptive Bar/Fundamental gates for newly listed companies.']
        : []),
      'Any unverified metric (such as Promoter Pledge %) remains explicitly marked DATA NOT AVAILABLE.',
    ],
    phase1Regime: {
      verdict: dashboard.regime.regimeVerdict,
      reasons: dashboard.regime.regimeReasons,
    },
    phase2SectorMacroNews,
    phase3Fundamentals,
    phase4Movement,
    periodicAnalysis,
    phase5Accumulation,
    phase6EntryTriggers,
    phase7Risk: {
      entryPrice: closePrice,
      stopLoss,
      stopPct,
      target15Pct: Number((closePrice * 1.15).toFixed(2)),
      target25Pct: Number((closePrice * 1.25).toFixed(2)),
      suggestedPositionSizePct,
      trailingBreakevenTriggerPrice: Number((closePrice * 1.2).toFixed(2)),
    },
    phase8TopWarnings: {
      fundamentalOvervalued,
      technicalOverheated,
      distributionFlatHighDeliv,
      warnings: topWarnings,
    },
    scoring: {
      totalScore,
      verdict,
      baseScore,
      breakdown,
    },
  };
}

// =========================================================================
// SECTION 12: DAILY BOT SCANNER
// =========================================================================

export async function runDailyBotScanner(params?: {
  scope?: 'LIQUID_TIERS' | 'WATCHLIST' | 'DELIV_HIGH' | 'TOP_SECTORS' | 'IPO';
  q?: string;
  limit?: number;
  forceRefresh?: boolean;
}): Promise<{
  dashboard: MacroNewsDashboardResponse;
  items: BotStockAnalysis[];
  scannedCandidates: number;
  paperTradingMode: boolean;
}> {
  const allRows = nsePipeline.getAllScreenerRows();
  const overview = nsePipeline.getOverview();
  const dashboard = await getOpenMacroAndNewsDashboard({
    allRows,
    marketSentimentScore: overview.marketSentiment.score,
    ema21BreadthPct: overview.marketSentiment.aboveEma21Pct,
    forceRefresh: params?.forceRefresh,
  });
  const sector1mMap = nsePipeline.getSector1mReturnMap();
  const bulkDeals = loadBulkDeals30D();

  const limit = Math.min(24, Math.max(4, params?.limit ?? 12));
  const q = (params?.q || '').trim().toUpperCase();
  let candidates: ScreenerRow[] = [];

  if (q) {
    candidates = allRows.filter(
      (r) => r.symbol.includes(q) || r.providerSector.toUpperCase().includes(q)
    );
  } else if (params?.scope === 'WATCHLIST') {
    const wl = new Set(loadWatchlistSymbols());
    candidates = allRows.filter((r) => wl.has(r.symbol));
  } else if (params?.scope === 'IPO') {
    const tierRank = (t: ScreenerRow['swingTier']) =>
      t === 'TIER_1_READY'
        ? 3
        : t === 'TIER_2_ACCUMULATION'
          ? 2
          : t === 'TIER_3_RVOL_WATCH'
            ? 1
            : 0;
    candidates = allRows
      .filter(
        (r) =>
          r.isIpo || r.providerSector.trim().toUpperCase() === 'IPO / RECENT LISTINGS'
      )
      .sort((a, b) => {
        const td = tierRank(b.swingTier) - tierRank(a.swingTier);
        if (td !== 0) return td;
        const rvolDiff = (b.rvol ?? 0) - (a.rvol ?? 0);
        if (rvolDiff !== 0) return rvolDiff;
        const delivDiff = (b.delivPer ?? 0) - (a.delivPer ?? 0);
        if (delivDiff !== 0) return delivDiff;
        return (b.sessionsCount ?? 0) - (a.sessionsCount ?? 0);
      });
  } else if (params?.scope === 'DELIV_HIGH') {
    candidates = allRows
      .filter((r) => r.liquidityPass && (r.avgDeliv5D ?? 0) >= 60)
      .sort((a, b) => (b.rvol ?? 0) - (a.rvol ?? 0));
  } else if (params?.scope === 'TOP_SECTORS') {
    const top3 = new Set(overview.sectorSentiment.slice(0, 3).map((s) => s.sector.toUpperCase()));
    candidates = allRows
      .filter((r) => r.liquidityPass && top3.has(r.providerSector.toUpperCase()))
      .sort((a, b) => (b.rvol ?? 0) - (a.rvol ?? 0));
  } else {
    candidates = allRows
      .filter(
        (r) =>
          r.liquidityPass &&
          (r.fundamentalPassCount >= 5 || r.swingTier !== 'NONE' || (r.rvol ?? 0) >= 1.5)
      )
      .sort((a, b) => {
        const fpDiff = (b.fundamentalPassCount ?? 0) - (a.fundamentalPassCount ?? 0);
        if (fpDiff !== 0) return fpDiff;
        const tierRank = (t: ScreenerRow['swingTier']) =>
          t === 'TIER_1_READY'
            ? 3
            : t === 'TIER_2_ACCUMULATION'
              ? 2
              : t === 'TIER_3_RVOL_WATCH'
                ? 1
                : 0;
        const td = tierRank(b.swingTier) - tierRank(a.swingTier);
        if (td !== 0) return td;
        return (b.rvol ?? 0) - (a.rvol ?? 0);
      });
  }

  const picked = candidates.slice(0, limit);
  const items: BotStockAnalysis[] = [];

  // Process in batches of 4 to avoid rate limiting Yahoo
  for (let i = 0; i < picked.length; i += 4) {
    const chunk = picked.slice(i, i + 4);
    const res = await Promise.all(
      chunk.map((row) =>
        analyzeStockWithV3Bot(row.symbol, {
          forceRefresh: false,
          dashboard,
          sector1mMap,
          bulkDeals,
          allRows,
        }).catch(() => null)
      )
    );
    for (const item of res) {
      if (item) items.push(item);
    }
  }

  // Attach daily-cached live stock news / corporate announcement badge (non-blocking if any feed fails)
  await Promise.all(
    items.map(async (item) => {
      try {
        const newsRes = await fetchStockNews(item.symbol, item.companyName, false);
        item.newsBadge = {
          hasAnnouncement: newsRes.hasRecentAnnouncement,
          label: newsRes.recentAnnouncementLabel || (newsRes.items.length > 0 ? 'News' : ''),
          headlineCount: newsRes.items.length,
          hasRiskAlert: newsRes.hasRiskAlert,
        };
      } catch {
        // non-fatal
      }
    })
  );

  items.sort((a, b) => b.scoring.totalScore - a.scoring.totalScore);
  return {
    dashboard,
    items,
    scannedCandidates: picked.length,
    paperTradingMode: true,
  };
}

// =========================================================================
// SECTION 13: 2-3 YEAR OUT-OF-SAMPLE & PHASE-BY-PHASE BACKTEST FRAMEWORK
// =========================================================================

function summarizeBacktestTrades(
  label: string,
  trades: BotBacktestTrade[]
): BotBacktestPhaseMetrics {
  if (trades.length === 0) {
    return {
      label,
      trades: 0,
      winRatePct: null,
      avgReturnPct: null,
      profitFactor: null,
      maxDrawdownPct: null,
      sharpeRatio: null,
      compoundedReturnPct: null,
    };
  }
  const wins = trades.filter((t) => t.returnPct > 0);
  const grossWin = wins.reduce((a, b) => a + b.returnPct, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.returnPct < 0).reduce((a, b) => a + b.returnPct, 0)
  );
  const avgReturnPct = trades.reduce((a, b) => a + b.returnPct, 0) / trades.length;
  const profitFactor =
    grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : null;

  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  for (const t of trades) {
    equity *= 1 + t.returnPct / 100;
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }
  const compoundedReturnPct = Number((equity - 100).toFixed(2));

  const variance =
    trades.reduce((a, b) => a + (b.returnPct - avgReturnPct) ** 2, 0) /
    Math.max(1, trades.length - 1);
  const stdev = Math.sqrt(variance);
  const sharpeRatio =
    stdev > 0 ? Number(((avgReturnPct / stdev) * Math.sqrt(12)).toFixed(2)) : null;

  return {
    label,
    trades: trades.length,
    winRatePct: Number(((wins.length / trades.length) * 100).toFixed(1)),
    avgReturnPct: Number(avgReturnPct.toFixed(2)),
    profitFactor,
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    sharpeRatio,
    compoundedReturnPct,
  };
}

function simulateTradesOnSeries(params: {
  bars: OhlcvBar[];
  splitIdx: number;
  holdDays: number;
  stopPct: number;
  targetPct: number;
  phaseSet: string;
  signalFn: (idx: number) => boolean;
}): BotBacktestTrade[] {
  const { bars, splitIdx, holdDays, stopPct, targetPct, phaseSet, signalFn } = params;
  const trades: BotBacktestTrade[] = [];
  let i = 205;
  while (i < bars.length - 3) {
    if (!signalFn(i)) {
      i++;
      continue;
    }
    // Phase 7C: next-day 3%+ gap-up skip check
    const nextBar = bars[i + 1];
    const gapPct = ((nextBar.open - bars[i].close) / bars[i].close) * 100;
    if (gapPct >= 3.0) {
      i++;
      continue;
    }
    const entryPrice = nextBar.open > 0 ? nextBar.open : bars[i].close;
    const stopPrice = entryPrice * (1 - stopPct / 100);
    const targetPrice = entryPrice * (1 + targetPct / 100);

    let exitIdx = Math.min(bars.length - 1, i + 1 + holdDays);
    let exitPrice = bars[exitIdx].close;
    let outcome: BotBacktestTrade['outcome'] = 'TIME_EXIT';
    let trailingStop = stopPrice;

    for (let j = i + 1; j <= exitIdx; j++) {
      const b = bars[j];
      if (b.low <= trailingStop) {
        exitIdx = j;
        exitPrice = trailingStop;
        outcome = trailingStop >= entryPrice ? 'TARGET' : 'STOP';
        break;
      }
      if (b.high >= targetPrice) {
        exitIdx = j;
        exitPrice = targetPrice;
        outcome = 'TARGET';
        break;
      }
      // Phase 7: Move stop to breakeven after +20% unrealized move
      if (b.high >= entryPrice * 1.2 && trailingStop < entryPrice) {
        trailingStop = entryPrice;
      }
    }

    const retPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    trades.push({
      entryDate: nextBar.date,
      exitDate: bars[exitIdx].date,
      entryPrice: Number(entryPrice.toFixed(2)),
      exitPrice: Number(exitPrice.toFixed(2)),
      returnPct: Number(retPct.toFixed(2)),
      outcome,
      phaseSet,
      inSample: i <= splitIdx,
    });
    i = exitIdx + 1; // Non-overlapping trades
  }
  return trades;
}

export async function runBotBacktestFramework(
  symbol: string,
  opts?: { holdDays?: number; stopPct?: number; targetPct?: number }
): Promise<BotBacktestReport> {
  const sym = symbol.trim().toUpperCase();
  const detail = nsePipeline.getStockDetail(sym);
  if (!detail) {
    throw new Error(`Symbol ${sym} not found in NSE Mainboard dataset.`);
  }

  const yf = await fetchAndCacheYahooForSymbol(sym, false);
  const bars = yf.bars;
  if (bars.length < 240) {
    throw new Error(
      `Insufficient 2-3Y Yahoo Finance daily history for ${sym} (${bars.length} sessions).`
    );
  }

  const holdDays = Math.min(60, Math.max(5, opts?.holdDays ?? 25));
  const stopPct = Math.min(15, Math.max(5, opts?.stopPct ?? 10));
  const targetPct = Math.min(40, Math.max(10, opts?.targetPct ?? 20));

  const closes = bars.map((b) => b.close);
  const ema9 = computeEmaSeries(closes, 9);
  const ema20 = computeEmaSeries(closes, 20);
  const ema21 = computeEmaSeries(closes, 21);
  const ema50 = computeEmaSeries(closes, 50);
  const ema200 = computeEmaSeries(closes, 200);
  const rsi = computeRsiSeries(closes, 14);
  const macdHist = computeMacdHistSeries(closes);
  const bbLower = computeBollingerLowerSeries(closes, 20, 2);

  const vol20 = (idx: number) =>
    bars.slice(Math.max(0, idx - 20), idx).reduce((a, b) => a + b.volume, 0) /
    Math.max(1, Math.min(20, idx));

  const burst252At = (idx: number) => {
    const start = Math.max(1, idx - 252);
    let score = 0;
    for (let k = start; k <= idx; k++) {
      const p = bars[k - 1].close;
      if (p <= 0) continue;
      const pct = ((bars[k].close - p) / p) * 100;
      if (pct >= 19) score += 3;
      else if (pct >= 10) score += 2;
      else if (pct >= 5) score += 1;
    }
    return Math.min(100, (score / (252 * 3)) * 1000);
  };

  const isFastEntry = (i: number) => {
    const vAvg = vol20(i);
    const vRatio = vAvg > 0 ? bars[i].volume / vAvg : 0;
    const emaCross =
      ema9[i] !== null &&
      ema21[i] !== null &&
      ema9[i - 1] !== null &&
      ema21[i - 1] !== null &&
      (ema9[i - 1] as number) <= (ema21[i - 1] as number) &&
      (ema9[i] as number) > (ema21[i] as number);
    const rsiRev =
      rsi[i] !== null && rsi[i - 1] !== null && (rsi[i - 1] as number) < 35 && (rsi[i] as number) >= 35;
    const macdFlip =
      macdHist[i] !== null &&
      macdHist[i - 1] !== null &&
      (macdHist[i - 1] as number) <= 0 &&
      (macdHist[i] as number) > 0;
    const bbBounce =
      bbLower[i] !== null && bars[i].low <= (bbLower[i] as number) && bars[i].close > (bbLower[i] as number);
    return (emaCross && vRatio >= 1.3) || rsiRev || macdFlip || bbBounce;
  };

  const isTrendAligned = (i: number) =>
    ema20[i] !== null &&
    ema50[i] !== null &&
    ema200[i] !== null &&
    bars[i].close > (ema20[i] as number) &&
    (ema20[i] as number) > (ema50[i] as number) &&
    (ema50[i] as number) > (ema200[i] as number);

  const isSpringOrReclaim = (i: number) => {
    const prior20Low = Math.min(...bars.slice(i - 20, i).map((b) => b.low));
    const vAvg = vol20(i);
    return bars[i].low <= prior20Low * 0.99 && bars[i].close > prior20Low && bars[i].volume >= vAvg * 1.4;
  };

  const splitIdx = Math.floor(205 + (bars.length - 205) * 0.6);

  const baselineTrades = simulateTradesOnSeries({
    bars,
    splitIdx,
    holdDays,
    stopPct,
    targetPct,
    phaseSet: 'Phase 6 Fast Entry Baseline',
    signalFn: (i) => isFastEntry(i),
  });
  const trendTrades = simulateTradesOnSeries({
    bars,
    splitIdx,
    holdDays,
    stopPct,
    targetPct,
    phaseSet: '+ Phase 6 Trend (EMA 20>50>200)',
    signalFn: (i) => isFastEntry(i) && isTrendAligned(i),
  });
  const burstTrades = simulateTradesOnSeries({
    bars,
    splitIdx,
    holdDays,
    stopPct,
    targetPct,
    phaseSet: '+ Phase 4 Burst Power >= 10',
    signalFn: (i) => isFastEntry(i) && isTrendAligned(i) && burst252At(i) >= 10,
  });
  const springTrades = simulateTradesOnSeries({
    bars,
    splitIdx,
    holdDays,
    stopPct,
    targetPct,
    phaseSet: '+ Phase 5 Wyckoff Spring/Reclaim',
    signalFn: (i) => isSpringOrReclaim(i) && burst252At(i) >= 10,
  });
  const fullTrades = simulateTradesOnSeries({
    bars,
    splitIdx,
    holdDays,
    stopPct,
    targetPct,
    phaseSet: 'Full Open-Source Filter (Trend+Burst+Vol)',
    signalFn: (i) => {
      const vAvg = vol20(i);
      return (
        (isFastEntry(i) || isSpringOrReclaim(i)) &&
        isTrendAligned(i) &&
        burst252At(i) >= 10 &&
        bars[i].volume >= vAvg * 1.25
      );
    },
  });

  const activePrimary = fullTrades.length >= 3 ? fullTrades : trendTrades.length >= 3 ? trendTrades : baselineTrades;

  return {
    symbol: sym,
    paperTradingMode: true,
    dataSource: `Yahoo Finance 3Y OHLCV (${yf.tickerUsed})`,
    fromDate: bars[0].date,
    toDate: bars[bars.length - 1].date,
    totalSessions: bars.length,
    splitDate: bars[splitIdx]?.date || bars[Math.floor(bars.length * 0.6)].date,
    params: { holdDays, stopPct, targetPct },
    overall: summarizeBacktestTrades('Overall 3Y Paper Backtest', activePrimary),
    inSample: summarizeBacktestTrades(
      'In-Sample (First 60%)',
      activePrimary.filter((t) => t.inSample)
    ),
    outOfSample: summarizeBacktestTrades(
      'Out-of-Sample (Latest 40%)',
      activePrimary.filter((t) => !t.inSample)
    ),
    phaseAblation: [
      summarizeBacktestTrades('1. Fast Entry Baseline (EMA9/21, RSI, MACD, BB)', baselineTrades),
      summarizeBacktestTrades('2. + Trend Aligned (Price > EMA20 > EMA50 > EMA200)', trendTrades),
      summarizeBacktestTrades('3. + Phase 4 Burst Power >= 10 (252D)', burstTrades),
      summarizeBacktestTrades('4. + Phase 5 Wyckoff Spring / Reclaim', springTrades),
      summarizeBacktestTrades('5. Full Filter (Trend + Burst>=10 + 1.25x Vol)', fullTrades),
    ],
    recentTrades: [...activePrimary].reverse().slice(0, 12),
  };
}

// =========================================================================
// MULTI-FILTER RECOMMENDED STOCKS + OPEN-SOURCE QUANT/AI RESEARCH BRIEF
// =========================================================================

function buildOpenSourceResearchBrief(
  row: ScreenerRow,
  bot: BotStockAnalysis
): RecommendedStockPick['aiResearchBrief'] {
  const f = bot.phase3Fundamentals;
  const m = bot.phase4Movement;
  const a = bot.phase5Accumulation;
  const t = bot.phase6EntryTriggers;
  const p2 = bot.phase2SectorMacroNews;
  const val = f.valuation;

  const headline = f.hardRejectPass
    ? `${bot.symbol} clears all available Phase 3 Fundamental Hard Rejects (${f.hardRejectPassCount}/7 gates, Piotroski ${f.piotroskiScore ?? 'N/A'}/${f.piotroskiAvailable}) with ${bot.scoring.verdict} (${bot.scoring.totalScore}/100).`
    : `${bot.symbol} shows ${row.swingTier !== 'NONE' ? row.swingTier : 'Delivery/RVOL'} & U-Turn (${row.uTurnStatus || 'MONITOR'}) setup with ${f.hardRejectPassCount}/7 Fundamental gates passed (Watchlist until ${f.hardRejectReasons[0] || 'fundamental gate'} clears).`;

  const fundamentalVerdict = [
    f.piotroskiScore !== null
      ? `Piotroski F-Score ${f.piotroskiScore}/${f.piotroskiAvailable}`
      : 'Piotroski DATA NOT AVAILABLE',
    f.roe3YrAvgPct !== null ? `ROE ${f.roe3YrAvgPct.toFixed(1)}%` : 'ROE N/A',
    f.debtToEquity !== null ? `D/E ${f.debtToEquity.toFixed(2)}x` : 'D/E N/A',
    f.earningsQualityOcfNi !== null ? `OCF/NI ${f.earningsQualityOcfNi.toFixed(2)}x` : 'OCF/NI N/A',
    f.epsGrowthYoyPct !== null
      ? `EPS YoY ${f.epsGrowthYoyPct >= 0 ? '+' : ''}${f.epsGrowthYoyPct.toFixed(1)}%`
      : 'EPS Growth N/A',
    val.grahamNumber !== null
      ? `Graham ₹${val.grahamNumber.toFixed(0)} (${val.grahamZone})`
      : 'Graham N/A',
    val.dcfIntrinsicPerShare !== null
      ? `5Y DCF ₹${val.dcfIntrinsicPerShare.toFixed(0)} (${val.dcfZone})`
      : 'DCF N/A',
  ].join(' · ');

  const techParts: string[] = [];
  if (row.delivPer !== null) techParts.push(`Delivery ${row.delivPer.toFixed(1)}% (5D avg ${row.avgDeliv5D?.toFixed(1) ?? '—'}%)`);
  if (row.rvol !== null) techParts.push(`RVOL ${row.rvol.toFixed(2)}x`);
  if (row.uTurnStatus) techParts.push(`U-Turn ${row.uTurnStatus}`);
  if (m.burstPowerNormalized !== null) techParts.push(`Burst 252D ${m.burstPowerNormalized}`);
  if (m.relativeStrengthPctRank !== null) techParts.push(`RS ${m.relativeStrengthPctRank}%ile`);
  if (a.wyckoffSpring) techParts.push('Wyckoff Spring');
  if (a.vcpDetected) techParts.push('VCP Contracting');
  if (t.fastSignalsTriggered.length > 0) techParts.push(`Triggers: ${t.fastSignalsTriggered.join(', ')}`);
  const technicalSetup = techParts.join(' · ') || 'No active fast technical trigger yet.';

  const macroNewsContext = [
    `Phase 1 Regime: ${bot.phase1Regime.verdict}`,
    p2.sector1mReturnPct !== null
      ? `Sector 1M ${p2.sector1mReturnPct}% vs Nifty ${p2.nifty1mReturnPct ?? 'N/A'}%`
      : 'Sector 1M N/A',
    `RSS News: ${p2.newsBias}`,
    `DXY Flag: ${p2.dxySectorFlag}`,
    `Brent: ${p2.brentFlag}`,
  ].join(' · ');

  const riskPlan = `Paper Entry ₹${bot.phase7Risk.entryPrice.toFixed(2)} · Stop ₹${bot.phase7Risk.stopLoss.toFixed(2)} (-${bot.phase7Risk.stopPct}%) · Target 15–25% (₹${bot.phase7Risk.target15Pct.toFixed(2)}–₹${bot.phase7Risk.target25Pct.toFixed(2)}) · Suggested Size ${bot.phase7Risk.suggestedPositionSizePct}% (+20% Trail BE @ ₹${bot.phase7Risk.trailingBreakevenTriggerPrice.toFixed(2)}).`;

  const missingParts: string[] = [];
  if (val.evToEbitda5YrAvg === null) missingParts.push('Historical EV/EBITDA Avg');
  if (a.fiiDiiMultiQuarterTrend === 'DATA NOT AVAILABLE') missingParts.push('Multi-quarter FII/DII');
  missingParts.push('Promoter Pledge %');
  const dataGaps = `Open-source status: ${missingParts.join(', ')} marked DATA NOT AVAILABLE.`;

  return {
    headline,
    fundamentalVerdict,
    technicalSetup,
    macroNewsContext,
    riskPlan,
    dataGaps,
  };
}

export async function recommendStocksWithOpenAnalysis(options?: {
  limit?: number;
}): Promise<RecommendedStocksResponse> {
  const allRows = nsePipeline.getAllScreenerRows();
  const overview = nsePipeline.getOverview();
  const dashboard = await getOpenMacroAndNewsDashboard({
    allRows,
    marketSentimentScore: overview.marketSentiment.score,
    ema21BreadthPct: overview.marketSentiment.aboveEma21Pct,
  });
  const sector1mMap = nsePipeline.getSector1mReturnMap();
  const bulkDeals = loadBulkDeals30D();
  const top3Sectors = new Set(
    overview.sectorSentiment.slice(0, 3).map((s) => s.sector.trim().toUpperCase())
  );

  // Score universe candidates pre-filter so we evaluate the highest-probability NSE stocks
  const scoredPool = allRows
    .filter((r) => r.liquidityPass && r.fundamentalPassCount >= 4)
    .map((r) => {
      let preScore = r.fundamentalPassCount * 12;
      if (r.fundamentalVerified) preScore += 18;
      if (r.swingTier === 'TIER_1_READY') preScore += 20;
      else if (r.swingTier === 'TIER_2_ACCUMULATION') preScore += 14;
      else if (r.swingTier === 'TIER_3_RVOL_WATCH') preScore += 8;
      if (r.uTurnStatus === 'ACTIVE_TRIGGER' || r.uTurnStatus === 'CONFIRMED_SUPPORT') preScore += 16;
      if ((r.avgDeliv5D ?? 0) >= 60) preScore += 10;
      if ((r.rvol ?? 0) >= 1.5) preScore += 10;
      if (top3Sectors.has(r.providerSector.trim().toUpperCase())) preScore += 8;
      return { row: r, preScore };
    })
    .sort((a, b) => b.preScore - a.preScore);

  const candidateCount = Math.min(20, scoredPool.length);
  const candidates = scoredPool.slice(0, candidateCount).map((x) => x.row);

  const analyzed: Array<{ row: ScreenerRow; bot: BotStockAnalysis }> = [];
  for (let i = 0; i < candidates.length; i += 4) {
    const chunk = candidates.slice(i, i + 4);
    const res = await Promise.all(
      chunk.map(async (row) => {
        try {
          const bot = await analyzeStockWithV3Bot(row.symbol, {
            forceRefresh: false,
            dashboard,
            sector1mMap,
            bulkDeals,
            allRows,
          });
          return { row, bot };
        } catch {
          return null;
        }
      })
    );
    for (const r of res) {
      if (r) analyzed.push(r);
    }
  }

  // Build combined multi-filter confluence ranking
  const rankedPicksRaw = analyzed.map(({ row, bot }) => {
    const f = bot.phase3Fundamentals;
    const filtersPassed: string[] = [];
    const filtersFailedOrMissing: string[] = [];

    if (row.liquidityPass) filtersPassed.push('Liquidity >= ₹1.5 Cr');
    else filtersFailedOrMissing.push('Liquidity < ₹1.5 Cr');

    if (f.hardRejectPass) filtersPassed.push('Phase 3 Hard Reject PASS (All Gates)');
    else {
      filtersPassed.push(`${f.hardRejectPassCount}/7 Fundamental Gates Pass`);
      for (const reason of f.hardRejectReasons) filtersFailedOrMissing.push(reason);
    }

    if (row.fundamentalVerified) filtersPassed.push('Verified Fundamentals');
    if ((row.avgDeliv5D ?? 0) >= 60) filtersPassed.push(`5D Deliv ${row.avgDeliv5D?.toFixed(1)}%`);
    if ((row.rvol ?? 0) >= 1.5) filtersPassed.push(`High RVOL ${row.rvol?.toFixed(2)}x`);
    if (row.swingTier !== 'NONE') filtersPassed.push(row.swingTier);
    if (row.uTurnStatus === 'ACTIVE_TRIGGER' || row.uTurnStatus === 'CONFIRMED_SUPPORT') {
      filtersPassed.push(`U-Turn ${row.uTurnStatus}`);
    }
    if (top3Sectors.has(row.providerSector.trim().toUpperCase())) {
      filtersPassed.push('Top 3 Rotating Sector');
    }
    if (bot.phase2SectorMacroNews.sectorOutperformsNifty) {
      filtersPassed.push('Sector > Nifty 1M');
    }
    if (bot.phase4Movement.burstPass) {
      filtersPassed.push(`Burst 252D ${bot.phase4Movement.burstPowerNormalized}`);
    }
    if (bot.phase5Accumulation.wyckoffSpring) filtersPassed.push('Wyckoff Spring');
    if (bot.phase5Accumulation.vcpDetected) filtersPassed.push('VCP Pattern');
    if (bot.phase6EntryTriggers.anyFastEntryTriggered) {
      filtersPassed.push(`Fast Entry (${bot.phase6EntryTriggers.fastSignalsTriggered[0]})`);
    }
    if (
      f.valuation.grahamZone === 'DEEP_VALUE' ||
      f.valuation.dcfZone === 'MARGIN_OF_SAFETY'
    ) {
      filtersPassed.push('Graham/DCF Value Zone');
    }

    const confluenceScore = Math.min(
      100,
      Math.round(
        (f.hardRejectPass ? 40 : f.hardRejectPassCount * 4.5) +
          bot.scoring.totalScore * 0.35 +
          ((row.avgDeliv5D ?? 0) >= 60 ? 7 : 0) +
          ((row.rvol ?? 0) >= 1.5 ? 6 : 0) +
          (row.uTurnStatus === 'ACTIVE_TRIGGER' || row.uTurnStatus === 'CONFIRMED_SUPPORT' ? 8 : 0) +
          (row.swingTier === 'TIER_1_READY' ? 8 : row.swingTier === 'TIER_2_ACCUMULATION' ? 5 : 0) +
          (bot.phase6EntryTriggers.anyFastEntryTriggered ? 6 : 0)
      )
    );

    const tier: RecommendedStockPick['tier'] = f.hardRejectPass
      ? 'ALL_FILTER_PASS'
      : 'HIGH_CONFLUENCE_WATCH';

    return { row, bot, confluenceScore, tier, filtersPassed, filtersFailedOrMissing };
  });

  rankedPicksRaw.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'ALL_FILTER_PASS' ? -1 : 1;
    return b.confluenceScore - a.confluenceScore;
  });

  const limit = Math.min(12, Math.max(4, options?.limit ?? 8));
  const topList = rankedPicksRaw.slice(0, limit);

  // Fetch live Yahoo Finance checking price for top picks
  const liveQuotes = await Promise.all(
    topList.map((x) => fetchLiveYahooQuote(x.row.symbol, false))
  );

  const picks: RecommendedStockPick[] = topList.map((x, idx) => {
    const lq = liveQuotes[idx];
    const effectiveEntry =
      lq?.available && lq.livePrice !== null ? lq.livePrice : x.bot.phase7Risk.entryPrice;
    return {
      symbol: x.row.symbol,
      companyName: x.bot.companyName,
      sector: x.bot.sector,
      eodClose: x.row.closePrice,
      livePrice: lq?.available ? lq.livePrice : null,
      liveChangePct: lq?.available ? lq.changePct : null,
      liveLastUpdated: lq?.available ? lq.lastUpdated ?? null : null,
      liveMarketTimeIst: lq?.available ? lq.marketTimeIst : '',
      liveMarketDateIst: lq?.available ? lq.marketDateIst ?? null : null,
      liveMarketState: lq?.available ? lq.marketState : '',
      liveIsStale: lq?.available ? Boolean(lq.isStale) : undefined,
      botScore: x.bot.scoring.totalScore,
      botVerdict: x.bot.scoring.verdict,
      confluenceScore: x.confluenceScore,
      tier: x.tier,
      filtersPassed: x.filtersPassed,
      filtersFailedOrMissing: x.filtersFailedOrMissing,
      entryPrice: effectiveEntry,
      stopLoss: x.bot.phase7Risk.stopLoss,
      target15Pct: x.bot.phase7Risk.target15Pct,
      target25Pct: x.bot.phase7Risk.target25Pct,
      suggestedSizePct: x.bot.phase7Risk.suggestedPositionSizePct,
      delivPer: x.row.delivPer,
      avgDeliv5D: x.row.avgDeliv5D,
      rvol: x.row.rvol,
      uTurnStatus: x.row.uTurnStatus,
      swingTier: x.row.swingTier,
      isIpo: x.row.isIpo,
      marketCapCr: x.row.marketCapCr,
      marketCapCategory: x.row.marketCapCategory,
      ema21AboveEma44: x.row.ema21AboveEma44,
      ema21Cross44Bullish: x.row.ema21Cross44Bullish,
      aiResearchBrief: buildOpenSourceResearchBrief(x.row, x.bot),
    };
  });

  return {
    generatedAtUtc: new Date().toISOString(),
    scannedUniverseCount: candidateCount,
    strictPassCount: picks.filter((p) => p.tier === 'ALL_FILTER_PASS').length,
    regimeVerdict: dashboard.regime.regimeVerdict,
    picks,
  };
}

