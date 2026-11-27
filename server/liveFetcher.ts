import fs from 'node:fs';
import path from 'node:path';
import { parseBhavDateToIso } from './csvParser.ts';
import {
  atomicWriteFileSync,
  atomicWriteJsonSync,
  readJsonSafe,
  withFileLock,
} from './filePersistence.ts';
import type { IndianFundamentalsPayload } from './indianFundamentals.ts';
import {
  getVerifiedFundamentals,
  getVerifiedFundamentalsBatch,
} from './services/fundamentalService.ts';

import type {
  FundamentalCollectionStatus,
  MarketCapCategory,
  XbrlFiling,
} from '../src/types/trading.ts';

export function toIstDateIso(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function classifyMarketCap(marketCapInr: number | null | undefined): {
  marketCapCr: number | null;
  marketCapCategory: MarketCapCategory;
} {
  if (marketCapInr === null || marketCapInr === undefined || !Number.isFinite(marketCapInr) || marketCapInr <= 0) {
    return { marketCapCr: null, marketCapCategory: 'UNKNOWN' };
  }
  const marketCapCr = Math.round(marketCapInr / 1e7);
  if (marketCapCr >= 20000) return { marketCapCr, marketCapCategory: 'LARGE_CAP' };
  if (marketCapCr >= 5000) return { marketCapCr, marketCapCategory: 'MID_CAP' };
  if (marketCapCr > 0) return { marketCapCr, marketCapCategory: 'SMALL_CAP' };
  return { marketCapCr: null, marketCapCategory: 'UNKNOWN' };
}

const fxRateCache = new Map<string, { rate: number; expiresAt: number }>();

export async function getFxRateToInr(currency: string): Promise<number> {
  const curr = (currency || '').trim().toUpperCase();
  if (!curr || curr === 'INR') return 1;

  const cached = fxRateCache.get(curr);
  if (cached && Date.now() < cached.expiresAt && cached.rate > 0) {
    return cached.rate;
  }

  const pair = `${curr}INR=X`;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?range=5d&interval=1d`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number };
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const entry = json.chart?.result?.[0];
      const metaPx = entry?.meta?.regularMarketPrice;
      const closes = (entry?.indicators?.quote?.[0]?.close ?? []).filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
      );
      const rate =
        typeof metaPx === 'number' && Number.isFinite(metaPx) && metaPx > 0
          ? metaPx
          : closes[closes.length - 1] ?? null;
      if (rate && rate > 0) {
        fxRateCache.set(curr, { rate, expiresAt: Date.now() + 60 * 60 * 1000 });
        return rate;
      }
    }
  } catch {
    // fallback handled below
  }

  if (cached && cached.rate > 0) return cached.rate;
  // Reasonable last-resort static fallbacks only if Yahoo FX endpoint fails transiently
  if (curr === 'USD') return 84.5;
  if (curr === 'EUR') return 90;
  if (curr === 'GBP') return 107;
  return 1;
}

export interface LiveFundamentalRecord {
  symbol: string;
  asOfDate: string;
  source: string;
  sourceUrl: string;
  financialPeriodEnd: string;
  publicationDate?: string;
  officialFilingUrl?: string;
  officialFilingSource?: string;
  sources?: string[];
  providerSector: string;
  revenueGrowthPct: number | null;
  profitGrowthPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  operatingCashFlowInr: number | null;
  freeCashFlowInr: number | null;
  trailingPE: number | null;
  priceToBook: number | null;
  marketCapInr: number | null;
  enterpriseValueInr: number | null;
  dividendYieldPct: number | null;
  promoterHoldingPct?: number | null;
  epsPrev?: number | null;
  epsCurr?: number | null;
  epsPrevPeriod?: string;
  epsCurrPeriod?: string;
  epsTtmPrev?: number | null;
  epsTtmCurr?: number | null;
  firstTradeDateIso?: string;
  nextEarningsDate?: string;
  companyName?: string;
  fetchedAtUtc: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function overridesPath(): string {
  return path.join(process.cwd(), 'data', 'research', 'live_fundamental_overrides.json');
}

function isPlainRecord(val: unknown): val is Record<string, LiveFundamentalRecord> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

export function loadLiveFundamentalOverrides(): Record<string, LiveFundamentalRecord> {
  return readJsonSafe<Record<string, LiveFundamentalRecord>>(
    overridesPath(),
    {},
    { validate: isPlainRecord }
  );
}

function saveLiveFundamentalOverrides(map: Record<string, LiveFundamentalRecord>): void {
  atomicWriteJsonSync(overridesPath(), map, { pretty: true, preserveBackup: true });
}

function isTrustedIndianSourceList(sources: string[] | undefined): boolean {
  if (!sources || sources.length === 0) return false;
  return sources.includes('Screener.in') || sources.includes('BSE Official');
}

function mergeFundamentalRecords(
  prev: LiveFundamentalRecord | undefined,
  next: LiveFundamentalRecord
): LiveFundamentalRecord {
  if (!prev) return next;
  const nextIsTrusted = isTrustedIndianSourceList(next.sources);
  const prevCleanSources = nextIsTrusted
    ? (prev.sources || []).filter((s) => s !== 'YFinance (.NS)' && s !== 'BSE (.BO)')
    : prev.sources || [];
  const mergedSources = Array.from(new Set([...prevCleanSources, ...(next.sources || [])]));
  const isIsoDate = (v: string | undefined): boolean => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const bestPeriod =
    isIsoDate(next.financialPeriodEnd) &&
    (!isIsoDate(prev.financialPeriodEnd) || next.financialPeriodEnd >= prev.financialPeriodEnd)
      ? next.financialPeriodEnd
      : isIsoDate(prev.financialPeriodEnd)
        ? prev.financialPeriodEnd
        : next.financialPeriodEnd || prev.financialPeriodEnd;
  return {
    ...prev,
    ...next,
    asOfDate: next.asOfDate || prev.asOfDate,
    source: next.source || prev.source,
    sourceUrl: next.sourceUrl || prev.sourceUrl,
    financialPeriodEnd: bestPeriod,
    publicationDate: next.publicationDate || prev.publicationDate,
    officialFilingUrl: next.officialFilingUrl || prev.officialFilingUrl,
    officialFilingSource: next.officialFilingSource || prev.officialFilingSource,
    sources: mergedSources,
    providerSector: next.providerSector || prev.providerSector,
    companyName: next.companyName || prev.companyName,
    firstTradeDateIso: next.firstTradeDateIso || prev.firstTradeDateIso,
    nextEarningsDate: next.nextEarningsDate || prev.nextEarningsDate,
    revenueGrowthPct: next.revenueGrowthPct ?? prev.revenueGrowthPct,
    profitGrowthPct: next.profitGrowthPct ?? prev.profitGrowthPct,
    roePct: next.roePct ?? prev.roePct,
    rocePct: next.rocePct ?? prev.rocePct,
    debtToEquity: next.debtToEquity ?? prev.debtToEquity,
    interestCoverage: next.interestCoverage ?? prev.interestCoverage,
    operatingCashFlowInr: next.operatingCashFlowInr ?? prev.operatingCashFlowInr,
    freeCashFlowInr: next.freeCashFlowInr ?? prev.freeCashFlowInr,
    trailingPE: next.trailingPE ?? prev.trailingPE,
    priceToBook: next.priceToBook ?? prev.priceToBook,
    marketCapInr: next.marketCapInr ?? prev.marketCapInr,
    enterpriseValueInr: next.enterpriseValueInr ?? prev.enterpriseValueInr,
    dividendYieldPct: next.dividendYieldPct ?? prev.dividendYieldPct,
    promoterHoldingPct: next.promoterHoldingPct ?? prev.promoterHoldingPct,
    epsPrev: next.epsPrev ?? prev.epsPrev,
    epsCurr: next.epsCurr ?? prev.epsCurr,
    epsPrevPeriod: next.epsPrevPeriod || prev.epsPrevPeriod,
    epsCurrPeriod: next.epsCurrPeriod || prev.epsCurrPeriod,
    epsTtmPrev: next.epsTtmPrev ?? prev.epsTtmPrev,
    epsTtmCurr: next.epsTtmCurr ?? prev.epsTtmCurr,
    fetchedAtUtc: next.fetchedAtUtc || new Date().toISOString(),
  };
}

export async function upsertAndSaveFundamentalOverrides(
  records: LiveFundamentalRecord[]
): Promise<number> {
  if (records.length === 0) return 0;
  return withFileLock(overridesPath(), () => {
    const current = readJsonSafe<Record<string, LiveFundamentalRecord>>(
      overridesPath(),
      {},
      { validate: isPlainRecord, throwOnCorruptWithoutBackup: true }
    );
    for (const rec of records) {
      const sym = rec.symbol.trim().toUpperCase();
      if (!sym) continue;
      current[sym] = mergeFundamentalRecords(current[sym], { ...rec, symbol: sym });
    }
    saveLiveFundamentalOverrides(current);
    return Object.keys(current).length;
  });
}

function toLiveFundamentalRecord(p: IndianFundamentalsPayload): LiveFundamentalRecord {
  return {
    symbol: p.symbol,
    asOfDate: p.asOfDate,
    source: p.source,
    sourceUrl: p.sourceUrl,
    financialPeriodEnd: p.financialPeriodEnd,
    publicationDate: p.publicationDate,
    officialFilingUrl: p.officialFilingUrl,
    officialFilingSource: p.officialFilingSource,
    sources: p.sources,
    providerSector: p.providerSector,
    companyName: p.companyName,
    nextEarningsDate: p.nextEarningsDate,
    revenueGrowthPct: p.revenueGrowthPct,
    profitGrowthPct: p.profitGrowthPct,
    roePct: p.roePct,
    rocePct: p.rocePct,
    debtToEquity: p.debtToEquity,
    interestCoverage: p.interestCoverage,
    operatingCashFlowInr: p.operatingCashFlowInr,
    freeCashFlowInr: p.freeCashFlowInr,
    trailingPE: p.trailingPE,
    priceToBook: p.priceToBook,
    marketCapInr: p.marketCapInr,
    enterpriseValueInr: p.enterpriseValueInr,
    dividendYieldPct: p.dividendYieldPct,
    promoterHoldingPct: p.promoterHoldingPct,
    epsPrev: p.epsPrev,
    epsCurr: p.epsCurr,
    epsPrevPeriod: p.epsPrevPeriod,
    epsCurrPeriod: p.epsCurrPeriod,
    epsTtmPrev: p.epsTtmPrev,
    epsTtmCurr: p.epsTtmCurr,
    fetchedAtUtc: p.fetchedAtUtc,
  };
}

export async function fetchTrustedFundamentalsForSymbol(
  symbol: string,
  xbrlFilings?: XbrlFiling[],
  forceBseProbe = true,
  forceRefresh = false
): Promise<LiveFundamentalRecord> {
  const verified = await getVerifiedFundamentals(symbol, {
    xbrlFilings,
    forceBseProbe,
    forceRefresh,
    allowYahooSupplement: true,
  });
  if (!verified.payload) {
    throw new Error(verified.error || `No verified fundamentals found for ${symbol}`);
  }
  return toLiveFundamentalRecord(verified.payload);
}

// Backwards-compatible export alias routed through fundamentalService (Screener.in + BSE + NSE XBRL + guarded Yahoo fallback)
export const fetchYahooFundamentalsForSymbol = fetchTrustedFundamentalsForSymbol;

const EPS_ATTEMPT_CACHE = new Map<string, number>();

export async function saveSymbolFundamentalsToCache(
  symbol: string,
  xbrlFilings?: XbrlFiling[],
  forceBseProbe = true,
  options?: { isEligible?: (symbol: string) => boolean }
): Promise<{
  record: LiveFundamentalRecord | null;
  totalSavedCount: number;
  error?: string;
}> {
  const sym = symbol.trim().toUpperCase();
  if (options?.isEligible && !options.isEligible(sym)) {
    const current = loadLiveFundamentalOverrides();
    return {
      record: current[sym] ?? null,
      totalSavedCount: Object.keys(current).length,
      error: `Symbol ${sym} is not in Tier 1, Tier 2, or Tier 3 (Fundamental Deep Audit is restricted to Tier 1–3 stocks).`,
    };
  }
  try {
    const fresh = await fetchTrustedFundamentalsForSymbol(sym, xbrlFilings, forceBseProbe, true);
    const totalSavedCount = await upsertAndSaveFundamentalOverrides([fresh]);
    return { record: fresh, totalSavedCount };
  } catch (err) {
    const current = loadLiveFundamentalOverrides();
    return {
      record: current[sym] ?? null,
      totalSavedCount: Object.keys(current).length,
      error: (err as Error).message,
    };
  }
}

export async function ensureLiveFundamentalsForSymbol(
  symbol: string,
  xbrlFilings?: XbrlFiling[],
  options?: { isEligible?: (symbol: string) => boolean }
): Promise<LiveFundamentalRecord | null> {
  const sym = symbol.trim().toUpperCase();
  const overrides = loadLiveFundamentalOverrides();
  const cached = overrides[sym];
  if (
    cached &&
    isTrustedIndianSourceList(cached.sources) &&
    cached.epsPrev !== undefined &&
    cached.epsCurr !== undefined &&
    cached.epsCurr !== null &&
    cached.epsTtmCurr !== undefined
  ) {
    return cached;
  }

  if (options?.isEligible && !options.isEligible(sym)) {
    return cached ?? null;
  }

  const lastTry = EPS_ATTEMPT_CACHE.get(sym) ?? 0;
  if (Date.now() - lastTry < 10 * 60 * 1000) {
    return cached ?? null;
  }
  EPS_ATTEMPT_CACHE.set(sym, Date.now());

  try {
    const fresh = await fetchTrustedFundamentalsForSymbol(sym, xbrlFilings, true, false);
    await upsertAndSaveFundamentalOverrides([fresh]);
    return fresh;
  } catch {
    return cached ?? null;
  }
}

export async function refreshFundamentalsBatch(
  symbols: string[],
  xbrlBySymbol?: Map<string, XbrlFiling[]>,
  forceBseProbe = false,
  options?: { isEligible?: (symbol: string) => boolean }
): Promise<{
  succeeded: string[];
  failed: Array<{ symbol: string; error: string }>;
}> {
  const normalized = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const failed: Array<{ symbol: string; error: string }> = [];
  const eligibleSymbols: string[] = [];

  for (const sym of normalized) {
    if (options?.isEligible && !options.isEligible(sym)) {
      failed.push({
        symbol: sym,
        error: `Symbol ${sym} is not in Tier 1, Tier 2, or Tier 3.`,
      });
    } else {
      eligibleSymbols.push(sym);
    }
  }

  if (eligibleSymbols.length === 0) {
    return { succeeded: [], failed };
  }

  const batch = await getVerifiedFundamentalsBatch(eligibleSymbols, {
    xbrlBySymbol,
    forceBseProbe,
    forceRefresh: true,
    concurrency: 2,
    delayBetweenBatchesMs: 350,
    allowYahooSupplement: true,
  });

  const recordsToSave: LiveFundamentalRecord[] = [];
  for (const sym of batch.succeeded) {
    const payload = batch.results[sym]?.payload;
    if (payload) {
      recordsToSave.push(toLiveFundamentalRecord(payload));
    }
  }

  if (recordsToSave.length > 0) {
    await upsertAndSaveFundamentalOverrides(recordsToSave);
  }

  return { succeeded: batch.succeeded, failed: [...failed, ...batch.failed] };
}

let collectionStatus: FundamentalCollectionStatus = {
  running: false,
  scope: '',
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  nseXbrlHits: 0,
  yahooNsHits: 0,
  bseBoHits: 0,
  currentSymbol: '',
  startedAtUtc: '',
  finishedAtUtc: '',
  lastError: null,
};

export function getCollectionJobStatus(): FundamentalCollectionStatus {
  return { ...collectionStatus };
}

export function startFullFundamentalCollection(
  symbols: string[],
  scope: string,
  xbrlBySymbol: Map<string, XbrlFiling[]>,
  onCheckpointReload: () => void,
  options?: { isEligible?: (symbol: string) => boolean }
): FundamentalCollectionStatus {
  if (collectionStatus.running) {
    return getCollectionJobStatus();
  }

  const targetSymbols = options?.isEligible
    ? symbols.map((s) => s.trim().toUpperCase()).filter((s) => options.isEligible!(s))
    : symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);

  if (targetSymbols.length === 0) {
    return getCollectionJobStatus();
  }

  collectionStatus = {
    running: true,
    scope,
    total: targetSymbols.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    nseXbrlHits: 0,
    yahooNsHits: 0,
    bseBoHits: 0,
    currentSymbol: targetSymbols[0] || '',
    startedAtUtc: new Date().toISOString(),
    finishedAtUtc: '',
    lastError: null,
  };

  void (async () => {
    let pendingBuffer: LiveFundamentalRecord[] = [];
    const CHUNK_SIZE = 2;

    try {
      for (let i = 0; i < targetSymbols.length; i += CHUNK_SIZE) {
        const chunk = targetSymbols.slice(i, i + CHUNK_SIZE);
        collectionStatus.currentSymbol = chunk[0] || '';
        const settled = await Promise.allSettled(
          chunk.map((sym) => fetchTrustedFundamentalsForSymbol(sym, xbrlBySymbol.get(sym), true, false))
        );

        settled.forEach((res, idx) => {
          collectionStatus.processed += 1;
          if (res.status === 'fulfilled') {
            const rec = res.value;
            pendingBuffer.push(rec);
            collectionStatus.succeeded += 1;
            const srcs = rec.sources || [];
            if (srcs.includes('NSE XBRL')) collectionStatus.nseXbrlHits += 1;
            if (srcs.includes('Screener.in')) collectionStatus.yahooNsHits += 1;
            if (srcs.includes('BSE Official')) collectionStatus.bseBoHits += 1;
          } else {
            collectionStatus.failed += 1;
            collectionStatus.lastError = `${chunk[idx]}: ${(res.reason as Error).message}`;
          }
        });

        if (pendingBuffer.length >= 10) {
          const toFlush = pendingBuffer;
          pendingBuffer = [];
          await upsertAndSaveFundamentalOverrides(toFlush);
          onCheckpointReload();
        }

        if (i + CHUNK_SIZE < targetSymbols.length) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }

      if (pendingBuffer.length > 0) {
        await upsertAndSaveFundamentalOverrides(pendingBuffer);
        pendingBuffer = [];
      }
      onCheckpointReload();
    } catch (err) {
      collectionStatus.lastError = (err as Error).message;
    } finally {
      collectionStatus.running = false;
      collectionStatus.currentSymbol = '';
      collectionStatus.finishedAtUtc = new Date().toISOString();
    }
  })();

  return getCollectionJobStatus();
}

interface NseCalendarYear {
  holidays?: string[];
  special_sessions?: Record<string, string>;
}

interface NseTradingCalendarData {
  holidaysByYear: Map<string, Set<string>>;
  specialSessions: Set<string>;
}

export function loadNseTradingCalendar(rootDir: string = process.cwd()): NseTradingCalendarData {
  const file = path.join(rootDir, 'data', 'inputs', 'nse_trading_calendar.json');
  const holidaysByYear = new Map<string, Set<string>>();
  const specialSessions = new Set<string>();
  if (!fs.existsSync(file)) {
    return { holidaysByYear, specialSessions };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      years?: Record<string, NseCalendarYear>;
    };
    for (const [year, info] of Object.entries(parsed?.years ?? {})) {
      holidaysByYear.set(
        year,
        new Set((info?.holidays ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
      );
      for (const dt of Object.keys(info?.special_sessions ?? {})) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
          specialSessions.add(dt);
        }
      }
    }
  } catch {
    // Fallback to weekday-only heuristic when calendar unreadable
  }
  return { holidaysByYear, specialSessions };
}

export function isNseTradingDay(isoDate: string, calendar?: NseTradingCalendarData): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const cal = calendar ?? loadNseTradingCalendar();
  if (cal.specialSessions.has(isoDate)) return true;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return false;
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const yr = isoDate.slice(0, 4);
  const yearHolidays = cal.holidaysByYear.get(yr);
  if (yearHolidays?.has(isoDate)) return false;
  return true;
}

export function getCachedBhavcopyDates(deliveryDir?: string): string[] {
  const dir = deliveryDir ?? path.join(process.cwd(), 'data', 'cache', 'delivery');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => {
      const m = f.match(/^sec_bhavdata_full_(\d{2})(\d{2})(\d{4})\.csv$/);
      if (!m) return '';
      const fullPath = path.join(dir, f);
      try {
        if (fs.statSync(fullPath).size <= 1000) return '';
      } catch {
        return '';
      }
      return `${m[3]}-${m[2]}-${m[1]}`;
    })
    .filter(Boolean)
    .sort();
}

async function downloadAndValidateBhavcopyForDate(
  iso: string,
  deliveryDir: string
): Promise<{
  status: 'DOWNLOADED' | 'ALREADY_CACHED' | 'UNAVAILABLE';
  filePath: string;
  filename: string;
  rowsCount?: number;
  error?: string;
}> {
  const [yyyy, mm, dd] = iso.split('-');
  const token = `${dd}${mm}${yyyy}`;
  const filename = `sec_bhavdata_full_${token}.csv`;
  const filePath = path.join(deliveryDir, filename);

  // Never overwrite or delete already-cached historical Bhavcopy files
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    return { status: 'ALREADY_CACHED', filePath, filename };
  }

  const url = `https://nsearchives.nseindia.com/products/content/${filename}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/csv,text/plain,*/*',
        Referer: 'https://www.nseindia.com/all-reports',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return { status: 'UNAVAILABLE', filePath, filename, error: `${iso}: HTTP ${res.status}` };
    }
    const text = await res.text();
    const trimmed = text.trimStart();
    if (!trimmed || trimmed.toLowerCase().startsWith('<html') || trimmed.startsWith('<!')) {
      return { status: 'UNAVAILABLE', filePath, filename, error: `${iso}: NSE returned HTML instead of CSV` };
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 100) {
      return { status: 'UNAVAILABLE', filePath, filename, error: `${iso}: CSV too short (${lines.length} lines)` };
    }
    const headers = lines[0].split(',').map((h) => h.trim().toUpperCase());
    const dateIdx = headers.indexOf('DATE1');
    if (
      dateIdx < 0 ||
      !headers.includes('SYMBOL') ||
      !headers.includes('CLOSE_PRICE') ||
      !headers.includes('DELIV_PER')
    ) {
      return { status: 'UNAVAILABLE', filePath, filename, error: `${iso}: Required Bhavcopy columns missing` };
    }
    const firstDateRaw = lines[1].split(',')[dateIdx] || '';
    const lastDateRaw = lines[lines.length - 1].split(',')[dateIdx] || '';
    const parsedFirst = parseBhavDateToIso(firstDateRaw);
    const parsedLast = parseBhavDateToIso(lastDateRaw);
    if (parsedFirst !== iso || (parsedLast && parsedLast !== iso)) {
      return {
        status: 'UNAVAILABLE',
        filePath,
        filename,
        error: `${iso}: Internal DATE1 (${parsedFirst}/${parsedLast}) mismatches filename date`,
      };
    }

    atomicWriteFileSync(filePath, text);
    return {
      status: 'DOWNLOADED',
      filePath,
      filename,
      rowsCount: lines.length - 1,
    };
  } catch (err) {
    return {
      status: 'UNAVAILABLE',
      filePath,
      filename,
      error: `${iso}: ${(err as Error).message}`,
    };
  }
}

export async function fetchNseBhavcopyForDate(
  targetIsoDate?: string
): Promise<{
  status: 'DOWNLOADED' | 'ALREADY_CACHED' | 'UNAVAILABLE';
  date: string;
  filePath?: string;
  rowsCount?: number;
  message: string;
}> {
  const calendar = loadNseTradingCalendar();
  const candidates: string[] = [];
  if (targetIsoDate && /^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate)) {
    candidates.push(targetIsoDate);
  } else {
    // Check IST today and walk back up to 7 calendar days for latest trading session
    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(nowIst.getTime() - offset * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      if (!isNseTradingDay(iso, calendar)) continue;
      candidates.push(iso);
    }
  }

  const deliveryDir = path.join(process.cwd(), 'data', 'cache', 'delivery');
  fs.mkdirSync(deliveryDir, { recursive: true });

  const errors: string[] = [];

  for (const iso of candidates) {
    const res = await downloadAndValidateBhavcopyForDate(iso, deliveryDir);
    if (res.status === 'ALREADY_CACHED') {
      return {
        status: 'ALREADY_CACHED',
        date: iso,
        filePath: res.filename,
        message: `Latest available NSE Bhavcopy (${iso}) is already cached locally.`,
      };
    }
    if (res.status === 'DOWNLOADED') {
      return {
        status: 'DOWNLOADED',
        date: iso,
        filePath: res.filename,
        rowsCount: res.rowsCount,
        message: `Downloaded and validated NSE Bhavcopy for ${iso} (${res.rowsCount} rows).`,
      };
    }
    if (res.error) errors.push(res.error);
  }

  return {
    status: 'UNAVAILABLE',
    date: candidates[0] || '',
    message: `No newer NSE Bhavcopy available yet (${errors.join(' | ') || 'no trading days matched'}).`,
  };
}

export async function backfillNseBhavcopiesToMinSessions(options?: {
  minSessions?: number;
  targetSessions?: number;
  maxLookbackCalendarDays?: number;
  referenceIsoDate?: string;
  concurrency?: number;
}): Promise<{
  initialCachedCount: number;
  finalCachedCount: number;
  downloadedDates: string[];
  meetsMinSessions: boolean;
  minSessions: number;
  message: string;
}> {
  const minSessions = Math.max(1, options?.minSessions ?? 200);
  const targetSessions = Math.max(minSessions, options?.targetSessions ?? 220);
  const maxLookback = Math.max(minSessions, options?.maxLookbackCalendarDays ?? 400);
  const concurrency = Math.min(8, Math.max(1, options?.concurrency ?? 5));

  const deliveryDir = path.join(process.cwd(), 'data', 'cache', 'delivery');
  fs.mkdirSync(deliveryDir, { recursive: true });

  const existingDates = getCachedBhavcopyDates(deliveryDir);
  const initialCachedCount = existingDates.length;
  if (initialCachedCount >= targetSessions) {
    return {
      initialCachedCount,
      finalCachedCount: initialCachedCount,
      downloadedDates: [],
      meetsMinSessions: initialCachedCount >= minSessions,
      minSessions,
      message: `Local Bhavcopy archive already holds ${initialCachedCount} actual trading sessions (>= ${minSessions}).`,
    };
  }

  const existingSet = new Set(existingDates);
  const calendar = loadNseTradingCalendar();
  const refIso = options?.referenceIsoDate || toIstDateIso();
  const refMs = Date.parse(`${refIso}T00:00:00Z`);

  const missingCandidates: string[] = [];
  for (let offset = 0; offset <= maxLookback; offset++) {
    const iso = new Date(refMs - offset * 86_400_000).toISOString().slice(0, 10);
    if (!isNseTradingDay(iso, calendar)) continue;
    if (!existingSet.has(iso)) {
      missingCandidates.push(iso);
    }
  }

  const downloadedDates: string[] = [];
  let currentCount = initialCachedCount;

  for (let i = 0; i < missingCandidates.length && currentCount < targetSessions; i += concurrency) {
    const needed = targetSessions - currentCount;
    const batch = missingCandidates.slice(i, i + Math.min(concurrency, needed + 1));
    const settled = await Promise.all(
      batch.map(async (iso) => ({
        iso,
        res: await downloadAndValidateBhavcopyForDate(iso, deliveryDir),
      }))
    );

    for (const item of settled) {
      if (item.res.status === 'DOWNLOADED') {
        downloadedDates.push(item.iso);
        currentCount += 1;
      }
    }

    if (currentCount < targetSessions && i + batch.length < missingCandidates.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  downloadedDates.sort();
  const finalDates = getCachedBhavcopyDates(deliveryDir);
  const finalCachedCount = finalDates.length;

  return {
    initialCachedCount,
    finalCachedCount,
    downloadedDates,
    meetsMinSessions: finalCachedCount >= minSessions,
    minSessions,
    message:
      downloadedDates.length > 0
        ? `Backfilled ${downloadedDates.length} NSE Bhavcopy session(s) (${downloadedDates[0]} to ${downloadedDates[downloadedDates.length - 1]}). Total cached sessions: ${finalCachedCount}.`
        : `Cached ${finalCachedCount} NSE Bhavcopy sessions (target ${minSessions}).`,
  };
}

export async function syncLatestBhavcopiesCatchup(lookbackCalendarDays = 10): Promise<{
  downloadedDates: string[];
  latestCachedDate: string;
  todayIstIso: string;
  todayPublishedYet: boolean;
  checkedDates: string[];
  message: string;
}> {
  const deliveryDir = path.join(process.cwd(), 'data', 'cache', 'delivery');
  fs.mkdirSync(deliveryDir, { recursive: true });

  const calendar = loadNseTradingCalendar();
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIstIso = nowIst.toISOString().slice(0, 10);

  // Build trading-day candidates ordered oldest -> newest using NSE calendar (includes Muhurat special sessions)
  const candidates: string[] = [];
  for (let offset = lookbackCalendarDays; offset >= 0; offset--) {
    const d = new Date(nowIst.getTime() - offset * 24 * 60 * 60 * 1000);
    const iso = d.toISOString().slice(0, 10);
    if (!isNseTradingDay(iso, calendar)) continue;
    candidates.push(iso);
  }

  const downloadedDates: string[] = [];
  const checkedDates: string[] = [];
  let todayPublishedYet = false;

  for (const iso of candidates) {
    checkedDates.push(iso);
    const res = await downloadAndValidateBhavcopyForDate(iso, deliveryDir);
    if (res.status === 'ALREADY_CACHED') {
      if (iso === todayIstIso) todayPublishedYet = true;
      continue;
    }
    if (res.status === 'DOWNLOADED') {
      downloadedDates.push(iso);
      if (iso === todayIstIso) todayPublishedYet = true;
    }
  }

  const cachedIsos = getCachedBhavcopyDates(deliveryDir);
  const latestCachedDate = cachedIsos[cachedIsos.length - 1] || '';

  const isTradingToday = isNseTradingDay(todayIstIso, calendar);
  const pendingNote =
    isTradingToday && !todayPublishedYet && latestCachedDate < todayIstIso
      ? ` (Note: Today's ${todayIstIso} Bhavcopy is published by NSE after market close ~18:00 IST)`
      : '';

  const message =
    downloadedDates.length > 0
      ? `Downloaded ${downloadedDates.length} new Bhavcopy session(s): ${downloadedDates.join(', ')}. Latest EOD: ${latestCachedDate}.${pendingNote}`
      : `Scanner synced to latest available NSE Bhavcopy (${latestCachedDate}).${pendingNote}`;

  return {
    downloadedDates,
    latestCachedDate,
    todayIstIso,
    todayPublishedYet,
    checkedDates,
    message,
  };
}
