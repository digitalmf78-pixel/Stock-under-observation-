import fs from 'node:fs';
import path from 'node:path';
import { parseBhavDateToIso } from './csvParser.ts';
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

export function loadLiveFundamentalOverrides(): Record<string, LiveFundamentalRecord> {
  const file = overridesPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLiveFundamentalOverrides(map: Record<string, LiveFundamentalRecord>): void {
  const file = overridesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpFile, file);
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
  const bestPeriod =
    next.financialPeriodEnd && (!prev.financialPeriodEnd || next.financialPeriodEnd >= prev.financialPeriodEnd)
      ? next.financialPeriodEnd
      : prev.financialPeriodEnd;
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

let writeQueue: Promise<void> = Promise.resolve();

export async function upsertAndSaveFundamentalOverrides(
  records: LiveFundamentalRecord[]
): Promise<number> {
  if (records.length === 0) return 0;
  let totalSaved = 0;
  const op = writeQueue.then(() => {
    const current = loadLiveFundamentalOverrides();
    for (const rec of records) {
      const sym = rec.symbol.trim().toUpperCase();
      if (!sym) continue;
      current[sym] = mergeFundamentalRecords(current[sym], { ...rec, symbol: sym });
    }
    saveLiveFundamentalOverrides(current);
    totalSaved = Object.keys(current).length;
  });
  writeQueue = op.catch(() => {});
  await op;
  return totalSaved;
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
  forceBseProbe = true
): Promise<{
  record: LiveFundamentalRecord | null;
  totalSavedCount: number;
  error?: string;
}> {
  const sym = symbol.trim().toUpperCase();
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
  xbrlFilings?: XbrlFiling[]
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
  forceBseProbe = false
): Promise<{
  succeeded: string[];
  failed: Array<{ symbol: string; error: string }>;
}> {
  const batch = await getVerifiedFundamentalsBatch(symbols, {
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

  return { succeeded: batch.succeeded, failed: batch.failed };
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
  onCheckpointReload: () => void
): FundamentalCollectionStatus {
  if (collectionStatus.running) {
    return getCollectionJobStatus();
  }

  collectionStatus = {
    running: true,
    scope,
    total: symbols.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    nseXbrlHits: 0,
    yahooNsHits: 0,
    bseBoHits: 0,
    currentSymbol: symbols[0] || '',
    startedAtUtc: new Date().toISOString(),
    finishedAtUtc: '',
    lastError: null,
  };

  void (async () => {
    let pendingBuffer: LiveFundamentalRecord[] = [];
    const CHUNK_SIZE = 2;

    try {
      for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + CHUNK_SIZE);
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

        if (i + CHUNK_SIZE < symbols.length) {
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

export async function fetchNseBhavcopyForDate(
  targetIsoDate?: string
): Promise<{
  status: 'DOWNLOADED' | 'ALREADY_CACHED' | 'UNAVAILABLE';
  date: string;
  filePath?: string;
  rowsCount?: number;
  message: string;
}> {
  const candidates: string[] = [];
  if (targetIsoDate && /^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate)) {
    candidates.push(targetIsoDate);
  } else {
    // Check IST today and walk back up to 5 calendar days for latest trading session
    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    for (let offset = 0; offset < 6; offset++) {
      const d = new Date(nowIst.getTime() - offset * 24 * 60 * 60 * 1000);
      const dayOfWeek = d.getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      candidates.push(d.toISOString().slice(0, 10));
    }
  }

  const deliveryDir = path.join(process.cwd(), 'data', 'cache', 'delivery');
  fs.mkdirSync(deliveryDir, { recursive: true });

  const errors: string[] = [];

  for (const iso of candidates) {
    const [yyyy, mm, dd] = iso.split('-');
    const token = `${dd}${mm}${yyyy}`;
    const filename = `sec_bhavdata_full_${token}.csv`;
    const filePath = path.join(deliveryDir, filename);

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
      return {
        status: 'ALREADY_CACHED',
        date: iso,
        filePath: filename,
        message: `Latest available NSE Bhavcopy (${iso}) is already cached locally.`,
      };
    }

    const url = `https://nsearchives.nseindia.com/products/content/${filename}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/csv,text/plain,*/*',
          Referer: 'https://www.nseindia.com/',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        errors.push(`${iso}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text || text.trimStart().toLowerCase().startsWith('<html') || text.trimStart().startsWith('<!')) {
        errors.push(`${iso}: NSE returned HTML instead of CSV`);
        continue;
      }
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 100) {
        errors.push(`${iso}: CSV too short (${lines.length} lines)`);
        continue;
      }
      const headers = lines[0].split(',').map((h) => h.trim().toUpperCase());
      const dateIdx = headers.indexOf('DATE1');
      if (dateIdx < 0 || !headers.includes('SYMBOL') || !headers.includes('DELIV_PER')) {
        errors.push(`${iso}: Required Bhavcopy columns missing`);
        continue;
      }
      // Integrity check matching delivery_filter.py validate_delivery_report_date
      const sampleDateRaw = lines[1].split(',')[dateIdx] || '';
      const parsedDate = parseBhavDateToIso(sampleDateRaw);
      if (parsedDate !== iso) {
        errors.push(`${iso}: Internal DATE1 (${parsedDate}) mismatches filename date`);
        continue;
      }

      fs.writeFileSync(filePath, text, 'utf-8');
      return {
        status: 'DOWNLOADED',
        date: iso,
        filePath: filename,
        rowsCount: lines.length - 1,
        message: `Downloaded and validated NSE Bhavcopy for ${iso} (${lines.length - 1} rows).`,
      };
    } catch (err) {
      errors.push(`${iso}: ${(err as Error).message}`);
    }
  }

  return {
    status: 'UNAVAILABLE',
    date: candidates[0] || '',
    message: `No newer NSE Bhavcopy available yet (${errors.join(' | ') || 'no trading days matched'}).`,
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

  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIstIso = nowIst.toISOString().slice(0, 10);

  // Build weekday candidates ordered oldest -> newest so multi-day catchup fills chronologically
  const candidates: string[] = [];
  for (let offset = lookbackCalendarDays; offset >= 0; offset--) {
    const d = new Date(nowIst.getTime() - offset * 24 * 60 * 60 * 1000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    candidates.push(d.toISOString().slice(0, 10));
  }

  const downloadedDates: string[] = [];
  const checkedDates: string[] = [];
  let todayPublishedYet = false;

  for (const iso of candidates) {
    checkedDates.push(iso);
    const [yyyy, mm, dd] = iso.split('-');
    const token = `${dd}${mm}${yyyy}`;
    const filename = `sec_bhavdata_full_${token}.csv`;
    const filePath = path.join(deliveryDir, filename);

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
      if (iso === todayIstIso) todayPublishedYet = true;
      continue;
    }

    const url = `https://nsearchives.nseindia.com/products/content/${filename}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/csv,text/plain,*/*',
          Referer: 'https://www.nseindia.com/',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trimStart().toLowerCase().startsWith('<html') || text.trimStart().startsWith('<!')) {
        continue;
      }
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 100) continue;
      const headers = lines[0].split(',').map((h) => h.trim().toUpperCase());
      const dateIdx = headers.indexOf('DATE1');
      if (dateIdx < 0 || !headers.includes('SYMBOL') || !headers.includes('DELIV_PER')) {
        continue;
      }
      const sampleDateRaw = lines[1].split(',')[dateIdx] || '';
      const parsedDate = parseBhavDateToIso(sampleDateRaw);
      if (parsedDate !== iso) continue;

      fs.writeFileSync(filePath, text, 'utf-8');
      downloadedDates.push(iso);
      if (iso === todayIstIso) todayPublishedYet = true;
    } catch {
      // Ignore holidays / not-yet-published EOD files
    }
  }

  // Determine actual latest cached ISO date
  const cachedIsos = fs
    .readdirSync(deliveryDir)
    .map((f) => {
      const m = f.match(/^sec_bhavdata_full_(\d{2})(\d{2})(\d{4})\.csv$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    })
    .filter(Boolean)
    .sort();
  const latestCachedDate = cachedIsos[cachedIsos.length - 1] || '';

  const isWeekdayToday = [1, 2, 3, 4, 5].includes(nowIst.getUTCDay());
  const pendingNote =
    isWeekdayToday && !todayPublishedYet && latestCachedDate < todayIstIso
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
