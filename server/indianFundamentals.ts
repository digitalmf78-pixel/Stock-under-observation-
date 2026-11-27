import fs from 'node:fs';
import path from 'node:path';
import {
  atomicWriteJsonSync,
  readJsonSafe,
  withFileLock,
} from './filePersistence.ts';
import type { XbrlFiling } from '../src/types/trading.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface AnnualStatementYear {
  asOfDate: string;
  revenue: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  ebit: number | null;
  ebitda?: number | null;
  interestExpense: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  equity: number | null;
  totalDebt: number | null;
  cash?: number | null;
  ocf: number | null;
  fcf: number | null;
  shares: number | null;
  dilutedEps: number | null;
}

export interface ScreenerShareholdingQuarter {
  period: string;
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
}

export interface IndianFundamentalsPayload {
  symbol: string;
  asOfDate: string;
  source: string;
  sourceUrl: string;
  sources: string[];
  financialPeriodEnd: string;
  publicationDate?: string;
  officialFilingUrl?: string;
  officialFilingSource?: string;
  companyName: string;
  providerSector: string;
  bseScripCode?: string;
  nextEarningsDate?: string;
  marketCapInr: number | null;
  freeFloatMcapInr: number | null;
  enterpriseValueInr: number | null;
  currentPrice: number | null;
  trailingPE: number | null;
  bookValuePerShare: number | null;
  priceToBook: number | null;
  dividendYieldPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  revenueGrowthPct: number | null;
  profitGrowthPct: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  operatingCashFlowInr: number | null;
  freeCashFlowInr: number | null;
  sharesOutstanding: number | null;
  evToEbitda: number | null;
  epsCurr: number | null;
  epsPrev: number | null;
  epsCurrPeriod: string;
  epsPrevPeriod: string;
  epsTtmCurr: number | null;
  epsTtmPrev: number | null;
  promoterHoldingPct: number | null;
  fiiHoldingPct: number | null;
  diiHoldingPct: number | null;
  publicHoldingPct: number | null;
  shareholdingQuarters: ScreenerShareholdingQuarter[];
  annualYears: AnnualStatementYear[];
  fetchedAtUtc: string;
}

export interface ParsedXbrlMetrics {
  periodEnd: string;
  revenueGrowthPct: number | null;
  profitGrowthPct: number | null;
  roePct: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  epsCurr: number | null;
  epsPrev: number | null;
  epsCurrPeriod: string;
  epsPrevPeriod: string;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let memoryFundCache: Record<string, IndianFundamentalsPayload> | null = null;

// Screener.in rate limiter & HTTP 429 circuit breaker
const SCREENER_MIN_GAP_MS = 350;
const SCREENER_MAX_CONCURRENT = 2;
let screenerActiveCount = 0;
let screenerLastReqMs = 0;
let screenerCooldownUntilMs = 0;
let screener429Count = 0;
const screenerWaitQueue: Array<() => void> = [];

export function getScreenerRateLimitState(): {
  cooldownActive: boolean;
  cooldownRemainingSec: number;
  activeRequests: number;
  queuedRequests: number;
  rateLimit429Hits: number;
} {
  const remMs = Math.max(0, screenerCooldownUntilMs - Date.now());
  return {
    cooldownActive: remMs > 0,
    cooldownRemainingSec: Math.ceil(remMs / 1000),
    activeRequests: screenerActiveCount,
    queuedRequests: screenerWaitQueue.length,
    rateLimit429Hits: screener429Count,
  };
}

async function acquireScreenerSlot(): Promise<void> {
  while (screenerActiveCount >= SCREENER_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => screenerWaitQueue.push(resolve));
  }
  screenerActiveCount += 1;
  const elapsed = Date.now() - screenerLastReqMs;
  if (elapsed < SCREENER_MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, SCREENER_MIN_GAP_MS - elapsed));
  }
  screenerLastReqMs = Date.now();
}

function releaseScreenerSlot(): void {
  screenerActiveCount = Math.max(0, screenerActiveCount - 1);
  const next = screenerWaitQueue.shift();
  if (next) next();
}

async function rateLimitedScreenerFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 8000,
  maxRetries = 1
): Promise<Response | null> {
  if (Date.now() < screenerCooldownUntilMs) {
    return null;
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await acquireScreenerSlot();
    try {
      if (Date.now() < screenerCooldownUntilMs) {
        return null;
      }
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status === 403) {
        screener429Count += 1;
        const retryAfterSec = Number(res.headers.get('retry-after') || '45');
        const cooldownMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(120_000, Math.max(15_000, retryAfterSec * 1000))
            : 45_000;
        screenerCooldownUntilMs = Math.max(screenerCooldownUntilMs, Date.now() + cooldownMs);
        return null;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return res;
    } catch {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      return null;
    } finally {
      releaseScreenerSlot();
    }
  }
  return null;
}

function indianCachePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'indian_fundamentals_cache.json');
}

function bseScripMapPath(): string {
  return path.join(process.cwd(), 'data', 'research', 'bse_scrip_map.json');
}

function screenerCachePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'bot_screener_cache.json');
}

function isPlainObjectRecord<T>(val: unknown): val is Record<string, T> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

export function loadIndianFundamentalsCache(): Record<string, IndianFundamentalsPayload> {
  if (memoryFundCache) return memoryFundCache;
  const file = indianCachePath();
  memoryFundCache = readJsonSafe<Record<string, IndianFundamentalsPayload>>(file, {}, {
    validate: isPlainObjectRecord<IndianFundamentalsPayload>,
  });
  return memoryFundCache;
}

export async function saveIndianFundamentalsEntry(entry: IndianFundamentalsPayload): Promise<void> {
  const file = indianCachePath();
  await withFileLock(file, () => {
    const cache = readJsonSafe<Record<string, IndianFundamentalsPayload>>(file, {}, {
      validate: isPlainObjectRecord<IndianFundamentalsPayload>,
      throwOnCorruptWithoutBackup: true,
    });
    cache[entry.symbol] = entry;
    memoryFundCache = cache;
    atomicWriteJsonSync(file, cache, { preserveBackup: true });
  });
}

export async function evictIndianFundamentalsCacheStore(symbol?: string): Promise<number> {
  const file = indianCachePath();
  return withFileLock(file, () => {
    const cache = readJsonSafe<Record<string, IndianFundamentalsPayload>>(file, {}, {
      validate: isPlainObjectRecord<IndianFundamentalsPayload>,
      throwOnCorruptWithoutBackup: true,
    });
    if (symbol) {
      const sym = symbol.trim().toUpperCase();
      const existed = sym in cache;
      delete cache[sym];
      if (memoryFundCache) delete memoryFundCache[sym];
      if (existed) {
        atomicWriteJsonSync(file, cache, { preserveBackup: true });
      }
      return existed ? 1 : 0;
    }
    const count = Object.keys(cache).length;
    memoryFundCache = {};
    if (count > 0) {
      atomicWriteJsonSync(file, {}, { preserveBackup: true });
    }
    return count;
  });
}

async function syncScreenerShareholdingCache(entry: IndianFundamentalsPayload): Promise<void> {
  if (entry.shareholdingQuarters.length === 0) return;
  try {
    const file = screenerCachePath();
    await withFileLock(file, () => {
      const existing = readJsonSafe<Record<string, unknown>>(file, {}, {
        validate: isPlainObjectRecord<unknown>,
        throwOnCorruptWithoutBackup: true,
      });
      existing[entry.symbol] = {
        symbol: entry.symbol,
        fetchedAtUtc: entry.fetchedAtUtc,
        quarters: entry.shareholdingQuarters,
        latestPromoterPct: entry.promoterHoldingPct,
        latestFiiPct: entry.fiiHoldingPct,
        latestDiiPct: entry.diiHoldingPct,
      };
      atomicWriteJsonSync(file, existing, { preserveBackup: true });
    });
  } catch {
    // non-fatal
  }
}

function loadBseScripMap(): Record<string, string> {
  return readJsonSafe<Record<string, string>>(bseScripMapPath(), {}, {
    validate: isPlainObjectRecord<string>,
  });
}

async function saveBseScripCode(sym: string, code: string): Promise<void> {
  if (!sym || !code) return;
  const file = bseScripMapPath();
  await withFileLock(file, () => {
    const map = readJsonSafe<Record<string, string>>(file, {}, {
      validate: isPlainObjectRecord<string>,
      throwOnCorruptWithoutBackup: true,
    });
    if (map[sym] === code) return;
    map[sym] = code;
    atomicWriteJsonSync(file, map, { pretty: true, preserveBackup: true });
  });
}

function toIstDateIso(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cleanHtmlText(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8377;|₹/g, '₹')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIndianNum(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,%Cr,\s]/gi, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === 'N/A') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function periodHeaderToIso(label: string): string {
  const cleaned = String(label || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  // Supports annotated headers from Screener such as "Mar 2026 (S)" or "Mar 2009 18m"
  const m = cleaned.match(/^([A-Za-z]{3})[\s-]+(\d{2,4})(?:\s*\([^)]*\)|\s+\d+m|\s+TTM)?$/i)
    ?? cleaned.match(/^([A-Za-z]{3})[\s-]+(\d{2,4})\b/);
  if (!m) return '';
  const monthIdx: Record<string, number> = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  };
  const monthNum = monthIdx[m[1].toUpperCase()];
  if (!monthNum) return '';
  const year = m[2].length === 2 ? Number(`20${m[2]}`) : Number(m[2]);
  if (!Number.isFinite(year) || year < 1990 || year > 2100) return '';
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

interface ParsedScreenerTable {
  headers: string[];
  rows: Map<string, string[]>;
}

function parseScreenerSectionTable(html: string, sectionId: string): ParsedScreenerTable | null {
  const secMatch = html.match(
    new RegExp(`<section[^>]*id=["']${sectionId}["'][\\s\\S]*?<\\/section>`, 'i')
  );
  const tblMatch = secMatch?.[0]?.match(/<table[\s\S]*?<\/table>/i);
  if (!tblMatch) return null;

  const tableHtml = tblMatch[0];
  const theadMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
  const headerSource = theadMatch ? theadMatch[0] : tableHtml;
  const headers = [...headerSource.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    cleanHtmlText(m[1])
  );
  if (headers.length < 2) return null;

  const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i);
  const bodySource = tbodyMatch ? tbodyMatch[0] : tableHtml;
  const rows = new Map<string, string[]>();

  for (const tr of bodySource.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((td) => cleanHtmlText(td[1]));
    if (tds.length < 2) continue;
    const rawName = tds[0].replace(/\s*\+\s*$/, '').trim().toLowerCase();
    if (!rawName) continue;
    rows.set(rawName, tds);
  }
  return { headers, rows };
}

function findRow(table: ParsedScreenerTable | null, candidates: string[]): string[] | null {
  if (!table) return null;
  for (const c of candidates) {
    const exact = table.rows.get(c.toLowerCase());
    if (exact) return exact;
  }
  for (const c of candidates) {
    const lc = c.toLowerCase();
    for (const [k, v] of table.rows.entries()) {
      if (k.startsWith(lc) || k.includes(lc)) return v;
    }
  }
  return null;
}

type ScheduleMap = Record<string, Record<string, unknown>>;

async function fetchScreenerSchedule(
  companyId: string,
  parent: string,
  section: string,
  isConsolidated: boolean
): Promise<ScheduleMap | null> {
  const consParam = isConsolidated ? '&consolidated=' : '';
  const url = `https://www.screener.in/api/company/${encodeURIComponent(
    companyId
  )}/schedules/?parent=${encodeURIComponent(parent)}&section=${encodeURIComponent(
    section
  )}${consParam}`;
  try {
    const res = await rateLimitedScreenerFetch(
      url,
      {
        'User-Agent': UA,
        Accept: 'application/json',
        Referer: 'https://www.screener.in/',
      },
      5500,
      1
    );
    if (!res || !res.ok) return null;
    const json = (await res.json()) as ScheduleMap;
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

function readScheduleNumber(
  schedule: ScheduleMap | null,
  rowCandidates: string[],
  periodHeader: string
): number | null {
  if (!schedule) return null;
  for (const key of Object.keys(schedule)) {
    const kl = key.toLowerCase();
    if (rowCandidates.some((c) => kl.includes(c.toLowerCase()))) {
      const row = schedule[key];
      if (!row || typeof row !== 'object') continue;
      const raw = row[periodHeader];
      if (typeof raw === 'string' || typeof raw === 'number') {
        const parsed = parseIndianNum(String(raw));
        if (parsed !== null) return parsed;
      }
      const tooltips = row.tooltips as Record<string, string> | undefined;
      if (tooltips && typeof tooltips[periodHeader] === 'string') {
        const parsed = parseIndianNum(tooltips[periodHeader]);
        if (parsed !== null) return parsed;
      }
    }
  }
  return null;
}

function sumScheduleAllItems(schedule: ScheduleMap | null, periodHeader: string): number | null {
  if (!schedule) return null;
  let sum = 0;
  let count = 0;
  for (const row of Object.values(schedule)) {
    if (!row || typeof row !== 'object') continue;
    const raw = row[periodHeader];
    if (typeof raw === 'string' || typeof raw === 'number') {
      const v = parseIndianNum(String(raw));
      if (v !== null) {
        sum += v;
        count++;
      }
    }
  }
  return count > 0 ? sum : null;
}

async function fetchScreenerFullData(symbol: string): Promise<Partial<IndianFundamentalsPayload> | null> {
  const sym = symbol.trim().toUpperCase();
  const attempts: Array<{ url: string; consolidated: boolean }> = [
    { url: `https://www.screener.in/company/${encodeURIComponent(sym)}/consolidated/`, consolidated: true },
    { url: `https://www.screener.in/company/${encodeURIComponent(sym)}/`, consolidated: false },
  ];

  let html = '';
  let usedUrl = '';
  let isConsolidated = true;
  let plTable: ParsedScreenerTable | null = null;
  let qtrTable: ParsedScreenerTable | null = null;

  for (const att of attempts) {
    try {
      const res = await rateLimitedScreenerFetch(
        att.url,
        {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
        },
        8000,
        1
      );
      if (!res || !res.ok) continue;
      const body = await res.text();
      const testPl = parseScreenerSectionTable(body, 'profit-loss');
      const testQtr = parseScreenerSectionTable(body, 'quarters');
      const hasPlData = Boolean(
        testPl && (findRow(testPl, ['sales', 'revenue']) || findRow(testPl, ['net profit']))
      );
      const hasQtrData = Boolean(
        testQtr && (findRow(testQtr, ['sales', 'revenue']) || findRow(testQtr, ['net profit']))
      );
      if (hasPlData || hasQtrData) {
        html = body;
        usedUrl = res.url || att.url;
        isConsolidated = att.consolidated && usedUrl.includes('/consolidated');
        plTable = testPl;
        qtrTable = testQtr;
        break;
      }
      if (!html && body.includes('id="top-ratios"')) {
        html = body;
        usedUrl = res.url || att.url;
        isConsolidated = att.consolidated && usedUrl.includes('/consolidated');
        plTable = testPl;
        qtrTable = testQtr;
      }
    } catch {
      // try next URL
    }
  }

  if (!html) return null;

  const companyName = cleanHtmlText(
    html.match(/<h1[^>]*class="[^"]*h2[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      ''
  );
  const companyId = html.match(/data-company-id="(\d+)"/)?.[1] || '';
  const bseScripCode =
    html.match(/bseindia\.com\/stock-share-price\/[^"]+\/(\d{6})\//i)?.[1] || '';

  const sectorLinks = [...html.matchAll(/<a[^>]*href="\/market\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (m) => cleanHtmlText(m[1])
  );
  const providerSector = sectorLinks[1] || sectorLinks[0] || '';

  // Parse Top Ratios
  const topRatios = new Map<string, number>();
  for (const li of html.matchAll(/<li[^>]*class="flex flex-space-between"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const nameMatch = li[1].match(/<span[^>]*class="name"[^>]*>([\s\S]*?)<\/span>/i);
    const valMatch = li[1].match(/<span[^>]*class="nowrap value"[^>]*>([\s\S]*?)<\/span>/i);
    const name = cleanHtmlText(nameMatch?.[1] || '').toLowerCase();
    const val = parseIndianNum(cleanHtmlText(valMatch?.[1] || ''));
    if (name && val !== null) topRatios.set(name, val);
  }

  const mcapCr = topRatios.get('market cap') ?? null;
  const currentPrice = topRatios.get('current price') ?? null;
  const trailingPE = topRatios.get('stock p/e') ?? null;
  const bookValuePerShare = topRatios.get('book value') ?? null;
  const dividendYieldPct = topRatios.get('dividend yield') ?? null;
  const rocePct = topRatios.get('roce') ?? null;
  const roePct = topRatios.get('roe') ?? null;
  const topDebtToEquity = topRatios.get('debt to equity') ?? null;
  const faceValue = topRatios.get('face value') ?? null;

  const marketCapInr = mcapCr !== null && mcapCr > 0 ? Math.round(mcapCr * 1e7) : null;
  const priceToBook =
    currentPrice !== null && currentPrice > 0 && bookValuePerShare !== null && bookValuePerShare > 0
      ? Number((currentPrice / bookValuePerShare).toFixed(2))
      : null;

  const bsTable = parseScreenerSectionTable(html, 'balance-sheet');
  const cfTable = parseScreenerSectionTable(html, 'cash-flow');
  const shTable = parseScreenerSectionTable(html, 'shareholding');

  // Fetch Screener Schedules in parallel if companyId is present for exact Cash, Current Assets/Liab, Gross Profit, Capex
  const cfFcfRowDirect = findRow(cfTable, ['free cash flow']);
  const [otherAssetsSch, otherLiabSch, expensesSch, investingSch] = companyId
    ? await Promise.all([
        fetchScreenerSchedule(companyId, 'Other Assets', 'balance-sheet', isConsolidated),
        fetchScreenerSchedule(companyId, 'Other Liabilities', 'balance-sheet', isConsolidated),
        fetchScreenerSchedule(companyId, 'Expenses', 'profit-loss', isConsolidated),
        !cfFcfRowDirect
          ? fetchScreenerSchedule(
              companyId,
              'Cash from Investing Activity',
              'cash-flow',
              isConsolidated
            )
          : Promise.resolve(null),
      ])
    : [null, null, null, null];

  // Parse Quarterly Results for epsCurr, epsPrev, TTM EPS, YoY Revenue & Profit Growth
  let epsCurr: number | null = null;
  let epsPrev: number | null = null;
  let epsCurrPeriod = '';
  let epsPrevPeriod = '';
  let epsTtmCurr: number | null = null;
  let epsTtmPrev: number | null = null;
  let revenueGrowthPct: number | null = null;
  let profitGrowthPct: number | null = null;

  if (qtrTable) {
    const qHeaders = qtrTable.headers;
    const qSales = findRow(qtrTable, ['sales', 'revenue']);
    const qProfit = findRow(qtrTable, ['net profit']);
    const qEps = findRow(qtrTable, ['eps in rs']);

    const validQCols: Array<{ col: number; iso: string; label: string }> = [];
    for (let c = 1; c < qHeaders.length; c++) {
      const iso = periodHeaderToIso(qHeaders[c]);
      if (iso) validQCols.push({ col: c, iso, label: qHeaders[c] });
    }

    if (validQCols.length >= 1 && qEps) {
      const last = validQCols[validQCols.length - 1];
      epsCurr = parseIndianNum(qEps[last.col]);
      epsCurrPeriod = last.iso;
    }
    if (validQCols.length >= 2 && qEps) {
      const prev = validQCols[validQCols.length - 2];
      epsPrev = parseIndianNum(qEps[prev.col]);
      epsPrevPeriod = prev.iso;
    }
    if (validQCols.length >= 4 && qEps) {
      const last4 = validQCols.slice(-4).map((q) => parseIndianNum(qEps[q.col]));
      if (last4.every((v): v is number => v !== null)) {
        epsTtmCurr = Number(last4.reduce((a, b) => a + b, 0).toFixed(2));
      }
    }
    if (validQCols.length >= 8 && qEps) {
      const prev4 = validQCols.slice(-8, -4).map((q) => parseIndianNum(qEps[q.col]));
      if (prev4.every((v): v is number => v !== null)) {
        epsTtmPrev = Number(prev4.reduce((a, b) => a + b, 0).toFixed(2));
      }
    }
    // YoY Revenue & Net Profit Growth: match prior-year quarter 340..390 days earlier by ISO period date
    if (validQCols.length >= 2) {
      const latestQCol = validQCols[validQCols.length - 1];
      const latestQMs = Date.parse(`${latestQCol.iso}T00:00:00Z`);
      const yoyQCol = Number.isFinite(latestQMs)
        ? validQCols.find((q) => {
            if (q.col === latestQCol.col) return false;
            const diffDays = (latestQMs - Date.parse(`${q.iso}T00:00:00Z`)) / 86400000;
            return diffDays >= 340 && diffDays <= 390;
          })
        : undefined;
      if (yoyQCol) {
        const cIdx = latestQCol.col;
        const yIdx = yoyQCol.col;
        const sCurr = qSales ? parseIndianNum(qSales[cIdx]) : null;
        const sPrev = qSales ? parseIndianNum(qSales[yIdx]) : null;
        if (sCurr !== null && sPrev !== null && Math.abs(sPrev) > 0) {
          revenueGrowthPct = Number((((sCurr - sPrev) / Math.abs(sPrev)) * 100).toFixed(2));
        }
        const pCurr = qProfit ? parseIndianNum(qProfit[cIdx]) : null;
        const pPrev = qProfit ? parseIndianNum(qProfit[yIdx]) : null;
        if (pCurr !== null && pPrev !== null && Math.abs(pPrev) > 0) {
          profitGrowthPct = Number((((pCurr - pPrev) / Math.abs(pPrev)) * 100).toFixed(2));
        }
      }
    }
  }

  // Parse Annual Statements (recent up to 5 FY columns, excluding TTM for annualYears)
  const annualYears: AnnualStatementYear[] = [];
  const plSalesRow = findRow(plTable, ['sales', 'revenue']);
  const plOpProfitRow = findRow(plTable, ['operating profit', 'financing profit']);
  const plInterestRow = findRow(plTable, ['interest']);
  const plDepRow = findRow(plTable, ['depreciation']);
  const plPbtRow = findRow(plTable, ['profit before tax']);
  const plPatRow = findRow(plTable, ['net profit']);
  const plEpsRow = findRow(plTable, ['eps in rs']);

  const bsEqCapRow = findRow(bsTable, ['equity capital']);
  const bsResRow = findRow(bsTable, ['reserves']);
  const bsBorrowRow = findRow(bsTable, ['borrowings', 'borrowing']);
  const bsOtherLiabRow = findRow(bsTable, ['other liabilities']);
  const bsTotalAssetsRow = findRow(bsTable, ['total assets']);
  const bsOtherAssetsRow = findRow(bsTable, ['other assets']);

  const cfOcfRow = findRow(cfTable, ['cash from operating activity']);

  // Build maps by period header label (e.g. "Mar 2026")
  const fyHeaders = (plTable?.headers || [])
    .slice(1)
    .filter((h) => /^[A-Za-z]{3}\s+\d{4}$/.test(h))
    .slice(-5)
    .reverse(); // newest first

  const bsColMap = new Map<string, number>();
  if (bsTable) {
    bsTable.headers.forEach((h, i) => {
      if (i > 0 && h) bsColMap.set(h, i);
    });
  }
  const cfColMap = new Map<string, number>();
  if (cfTable) {
    cfTable.headers.forEach((h, i) => {
      if (i > 0 && h) cfColMap.set(h, i);
    });
  }
  const plColMap = new Map<string, number>();
  if (plTable) {
    plTable.headers.forEach((h, i) => {
      if (i > 0 && h) plColMap.set(h, i);
    });
  }

  const sharesFromMcap =
    marketCapInr !== null && currentPrice !== null && currentPrice > 0
      ? Math.round(marketCapInr / currentPrice)
      : null;

  for (const label of fyHeaders) {
    const iso = periodHeaderToIso(label);
    if (!iso) continue;
    const pCol = plColMap.get(label);
    const bCol = bsColMap.get(label);
    const cCol = cfColMap.get(label);

    const salesCr = pCol !== undefined && plSalesRow ? parseIndianNum(plSalesRow[pCol]) : null;
    const opProfCr =
      pCol !== undefined && plOpProfitRow ? parseIndianNum(plOpProfitRow[pCol]) : null;
    const intCr = pCol !== undefined && plInterestRow ? parseIndianNum(plInterestRow[pCol]) : null;
    const depCr = pCol !== undefined && plDepRow ? parseIndianNum(plDepRow[pCol]) : null;
    const pbtCr = pCol !== undefined && plPbtRow ? parseIndianNum(plPbtRow[pCol]) : null;
    const patCr = pCol !== undefined && plPatRow ? parseIndianNum(plPatRow[pCol]) : null;
    const epsFy = pCol !== undefined && plEpsRow ? parseIndianNum(plEpsRow[pCol]) : null;

    const isFinFormat = Array.from(plTable?.rows.keys() ?? []).some((k) =>
      k.includes('financing profit')
    );
    const ebitdaCr = isFinFormat && pbtCr !== null && intCr !== null ? pbtCr + intCr + (depCr ?? 0) : opProfCr;
    const ebitCr =
      isFinFormat && pbtCr !== null && intCr !== null
        ? pbtCr + intCr
        : opProfCr !== null && depCr !== null
          ? opProfCr - depCr
          : pbtCr !== null && intCr !== null
            ? pbtCr + intCr
            : opProfCr;

    // Material cost from Expenses schedule -> Gross Profit = Sales - Material Cost
    let matCostCr = readScheduleNumber(expensesSch, ['material cost'], label);
    if (matCostCr !== null && salesCr !== null && expensesSch) {
      // Check if schedule raw string was percentage vs rupee tooltip; tooltips always have ₹ value
      const matRow = Object.entries(expensesSch).find(([k]) =>
        k.toLowerCase().includes('material cost')
      )?.[1];
      const rawCell = matRow && typeof matRow[label] === 'string' ? (matRow[label] as string) : '';
      const tipCell =
        matRow?.tooltips && typeof (matRow.tooltips as Record<string, string>)[label] === 'string'
          ? (matRow.tooltips as Record<string, string>)[label]
          : '';
      if (tipCell) {
        const tipVal = parseIndianNum(tipCell);
        if (tipVal !== null) matCostCr = tipVal;
      } else if (rawCell.includes('%') && salesCr > 0) {
        matCostCr = (salesCr * matCostCr) / 100;
      }
    }
    const grossProfitCr =
      salesCr !== null && matCostCr !== null ? salesCr - matCostCr : null;

    const eqCapCr = bCol !== undefined && bsEqCapRow ? parseIndianNum(bsEqCapRow[bCol]) : null;
    const resCr = bCol !== undefined && bsResRow ? parseIndianNum(bsResRow[bCol]) : null;
    const equityCr = eqCapCr !== null && resCr !== null ? eqCapCr + resCr : null;
    const debtCr = bCol !== undefined && bsBorrowRow ? parseIndianNum(bsBorrowRow[bCol]) : null;
    const totalAssetsCr =
      bCol !== undefined && bsTotalAssetsRow ? parseIndianNum(bsTotalAssetsRow[bCol]) : null;
    const otherAssetsCr =
      bCol !== undefined && bsOtherAssetsRow ? parseIndianNum(bsOtherAssetsRow[bCol]) : null;
    const otherLiabCr =
      bCol !== undefined && bsOtherLiabRow ? parseIndianNum(bsOtherLiabRow[bCol]) : null;

    const schCurAssetsCr = sumScheduleAllItems(otherAssetsSch, label);
    const currentAssetsCr = schCurAssetsCr ?? otherAssetsCr;
    const cashCr = readScheduleNumber(otherAssetsSch, ['cash equivalent', 'cash'], label);
    const schCurLiabCr = sumScheduleAllItems(otherLiabSch, label);
    const currentLiabilitiesCr = schCurLiabCr ?? otherLiabCr;

    const ocfCr = cCol !== undefined && cfOcfRow ? parseIndianNum(cfOcfRow[cCol]) : null;
    let fcfCr =
      cCol !== undefined && cfFcfRowDirect ? parseIndianNum(cfFcfRowDirect[cCol]) : null;
    if (fcfCr === null && ocfCr !== null) {
      const capexCr = readScheduleNumber(investingSch, ['fixed assets purchased'], label);
      if (capexCr !== null) {
        fcfCr = ocfCr - Math.abs(capexCr);
      }
    }

    let shares: number | null = null;
    if (eqCapCr !== null && faceValue !== null && faceValue > 0) {
      shares = Math.round((eqCapCr * 1e7) / faceValue);
    } else if (patCr !== null && epsFy !== null && Math.abs(epsFy) > 0.05) {
      shares = Math.round((patCr * 1e7) / epsFy);
    } else {
      shares = sharesFromMcap;
    }

    const toInr = (cr: number | null) => (cr !== null ? Math.round(cr * 1e7) : null);

    annualYears.push({
      asOfDate: iso,
      revenue: toInr(salesCr),
      grossProfit: toInr(grossProfitCr),
      netIncome: toInr(patCr),
      ebit: toInr(ebitCr),
      ebitda: toInr(ebitdaCr),
      interestExpense: toInr(intCr),
      totalAssets: toInr(totalAssetsCr),
      currentAssets: toInr(currentAssetsCr),
      currentLiabilities: toInr(currentLiabilitiesCr),
      equity: toInr(equityCr),
      totalDebt: toInr(debtCr),
      cash: toInr(cashCr),
      ocf: toInr(ocfCr),
      fcf: toInr(fcfCr),
      shares,
      dilutedEps: epsFy,
    });
  }

  // Fallback annual revenue/profit growth if quarterly growth unavailable
  if (revenueGrowthPct === null && annualYears.length >= 2) {
    const r0 = annualYears[0].revenue;
    const r1 = annualYears[1].revenue;
    if (r0 !== null && r1 !== null && Math.abs(r1) > 0) {
      revenueGrowthPct = Number((((r0 - r1) / Math.abs(r1)) * 100).toFixed(2));
    }
  }
  if (profitGrowthPct === null && annualYears.length >= 2) {
    const p0 = annualYears[0].netIncome;
    const p1 = annualYears[1].netIncome;
    if (p0 !== null && p1 !== null && Math.abs(p1) > 0) {
      profitGrowthPct = Number((((p0 - p1) / Math.abs(p1)) * 100).toFixed(2));
    }
  }
  if (epsTtmCurr === null) {
    const ttmCol = plColMap.get('TTM');
    if (ttmCol !== undefined && plEpsRow) {
      epsTtmCurr = parseIndianNum(plEpsRow[ttmCol]);
    } else if (annualYears[0]?.dilutedEps !== null) {
      epsTtmCurr = annualYears[0]?.dilutedEps ?? null;
    }
  }
  if (epsTtmPrev === null && annualYears.length >= 2) {
    epsTtmPrev = annualYears[1].dilutedEps ?? null;
  }

  // Latest Balance Sheet D/E (prefer Sep/latest BS column if newer than Mar; treat all-blank cells as null)
  const latestBsCol = bsTable && bsTable.headers.length > 1 ? bsTable.headers.length - 1 : -1;
  const bsEqVal = latestBsCol > 0 && bsEqCapRow ? parseIndianNum(bsEqCapRow[latestBsCol]) : null;
  const bsResVal = latestBsCol > 0 && bsResRow ? parseIndianNum(bsResRow[latestBsCol]) : null;
  let latestEquityCr: number | null =
    bsEqVal !== null || bsResVal !== null ? (bsEqVal ?? 0) + (bsResVal ?? 0) : null;
  let latestDebtCr =
    latestBsCol > 0 && bsBorrowRow ? parseIndianNum(bsBorrowRow[latestBsCol]) : null;
  if (latestEquityCr === null && annualYears[0]?.equity !== null && annualYears[0]?.equity !== undefined) {
    latestEquityCr = annualYears[0].equity / 1e7;
  }
  if (latestDebtCr === null && annualYears[0]?.totalDebt !== null && annualYears[0]?.totalDebt !== undefined) {
    latestDebtCr = annualYears[0].totalDebt / 1e7;
  }
  const debtToEquity =
    latestDebtCr !== null && latestEquityCr !== null && latestEquityCr > 0
      ? Number((latestDebtCr / latestEquityCr).toFixed(2))
      : topDebtToEquity !== null && topDebtToEquity >= 0
        ? topDebtToEquity
        : null;

  // Interest coverage from TTM or latest FY
  let interestCoverage: number | null = null;
  const ttmCol = plColMap.get('TTM');
  const ttmOp = ttmCol !== undefined && plOpProfitRow ? parseIndianNum(plOpProfitRow[ttmCol]) : null;
  const ttmDep = ttmCol !== undefined && plDepRow ? parseIndianNum(plDepRow[ttmCol]) : null;
  const ttmInt = ttmCol !== undefined && plInterestRow ? parseIndianNum(plInterestRow[ttmCol]) : null;
  const ttmPbt = ttmCol !== undefined && plPbtRow ? parseIndianNum(plPbtRow[ttmCol]) : null;
  const isFinFormatGlobal = Array.from(plTable?.rows.keys() ?? []).some((k) =>
    k.includes('financing profit')
  );
  const ttmEbit =
    isFinFormatGlobal && ttmPbt !== null && ttmInt !== null
      ? ttmPbt + ttmInt
      : ttmOp !== null && ttmDep !== null
        ? ttmOp - ttmDep
        : ttmPbt !== null && ttmInt !== null
          ? ttmPbt + ttmInt
          : annualYears[0]?.ebit !== null && annualYears[0]?.ebit !== undefined
            ? annualYears[0].ebit / 1e7
            : null;
  const effInt =
    ttmInt !== null
      ? ttmInt
      : annualYears[0]?.interestExpense !== null && annualYears[0]?.interestExpense !== undefined
        ? annualYears[0].interestExpense / 1e7
        : null;
  if (ttmEbit !== null && effInt !== null) {
    if (Math.abs(effInt) > 0.05) {
      interestCoverage = Number((ttmEbit / Math.abs(effInt)).toFixed(2));
    } else if (debtToEquity !== null && debtToEquity <= 0.02 && ttmEbit > 0) {
      interestCoverage = 999;
    }
  }

  const yr0 = annualYears[0] ?? null;
  const operatingCashFlowInr = yr0?.ocf ?? null;
  const freeCashFlowInr = yr0?.fcf ?? null;
  const sharesOutstanding = yr0?.shares ?? sharesFromMcap;

  const latestCashInr =
    latestBsCol > 0 && bsTable?.headers[latestBsCol]
      ? (() => {
          const c = readScheduleNumber(
            otherAssetsSch,
            ['cash equivalent', 'cash'],
            bsTable.headers[latestBsCol]
          );
          return c !== null ? c * 1e7 : yr0?.cash ?? 0;
        })()
      : yr0?.cash ?? 0;
  const latestDebtInr = latestDebtCr !== null ? latestDebtCr * 1e7 : yr0?.totalDebt ?? 0;
  const enterpriseValueInr =
    marketCapInr !== null && marketCapInr > 0
      ? Math.max(0, Math.round(marketCapInr + latestDebtInr - latestCashInr))
      : null;

  const ttmEbitdaInr = ttmOp !== null && ttmOp > 0 ? ttmOp * 1e7 : yr0?.ebitda ?? null;
  const evToEbitda =
    enterpriseValueInr !== null && ttmEbitdaInr !== null && ttmEbitdaInr > 0
      ? Number((enterpriseValueInr / ttmEbitdaInr).toFixed(2))
      : null;

  // Shareholding
  const shareholdingQuarters: ScreenerShareholdingQuarter[] = [];
  if (shTable) {
    const promRow = findRow(shTable, ['promoters', 'promoter']);
    const fiiRow = findRow(shTable, ['fiis', 'fii']);
    const diiRow = findRow(shTable, ['diis', 'dii']);
    for (let c = 1; c < shTable.headers.length; c++) {
      const period = shTable.headers[c];
      if (!period || !/[A-Za-z]{3}\s+\d{4}/.test(period)) continue;
      const p = promRow ? parseIndianNum(promRow[c]) : null;
      const f = fiiRow ? parseIndianNum(fiiRow[c]) : null;
      const d = diiRow ? parseIndianNum(diiRow[c]) : null;
      if (p === null && f === null && d === null) continue;
      shareholdingQuarters.push({ period, promoterPct: p, fiiPct: f, diiPct: d });
    }
  }
  const trimmedSh = shareholdingQuarters.slice(-8);
  const lastPromRaw = [...trimmedSh].reverse().find((q) => q.promoterPct !== null)?.promoterPct ?? null;
  const lastProm = lastPromRaw !== null ? lastPromRaw : trimmedSh.length > 0 ? 0 : null;
  const lastFii = [...trimmedSh].reverse().find((q) => q.fiiPct !== null)?.fiiPct ?? null;
  const lastDii = [...trimmedSh].reverse().find((q) => q.diiPct !== null)?.diiPct ?? null;
  const pubRow = findRow(shTable, ['public']);
  const lastPub =
    pubRow && shTable && shTable.headers.length > 1
      ? parseIndianNum(pubRow[shTable.headers.length - 1])
      : null;

  const periodCandidates = [epsCurrPeriod, yr0?.asOfDate || ''].filter((d) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d)
  );
  periodCandidates.sort((a, b) => b.localeCompare(a));
  const financialPeriodEnd = periodCandidates[0] || '';

  return {
    symbol: sym,
    asOfDate: toIstDateIso(),
    source: 'Screener.in',
    sourceUrl: usedUrl,
    sources: ['Screener.in'],
    financialPeriodEnd,
    companyName,
    providerSector,
    bseScripCode,
    marketCapInr,
    enterpriseValueInr,
    currentPrice,
    trailingPE,
    bookValuePerShare,
    priceToBook,
    dividendYieldPct,
    roePct,
    rocePct,
    revenueGrowthPct,
    profitGrowthPct,
    debtToEquity,
    interestCoverage,
    operatingCashFlowInr,
    freeCashFlowInr,
    sharesOutstanding,
    evToEbitda,
    epsCurr,
    epsPrev,
    epsCurrPeriod,
    epsPrevPeriod,
    epsTtmCurr,
    epsTtmPrev,
    promoterHoldingPct: lastProm,
    fiiHoldingPct: lastFii,
    diiHoldingPct: lastDii,
    publicHoldingPct: lastPub,
    shareholdingQuarters: trimmedSh,
    annualYears,
  };
}

async function resolveBseScripCode(sym: string, hintCode?: string): Promise<string> {
  if (hintCode && /^\d{6}$/.test(hintCode)) {
    void saveBseScripCode(sym, hintCode);
    return hintCode;
  }
  const map = loadBseScripMap();
  if (map[sym]) return map[sym];

  try {
    const res = await fetch(
      `https://api.bseindia.com/BseIndiaAPI/api/PeerSmartSearch/w?Type=SS&text=${encodeURIComponent(
        sym
      )}`,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json,text/html,*/*',
          Referer: 'https://www.bseindia.com/',
          Origin: 'https://www.bseindia.com',
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return '';
    const html = await res.text();
    for (const m of html.matchAll(/liclick\('(\d{6})','([^']+)'\)/g)) {
      const code = m[1];
      const idx = m.index ?? 0;
      const slice = html.slice(idx, idx + 350).toUpperCase();
      if (
        slice.includes(`>${sym}<`) ||
        slice.includes(`${sym}&NBSP;`) ||
        slice.includes(`<strong>${sym}</strong>`)
      ) {
        await saveBseScripCode(sym, code);
        return code;
      }
    }
    const first = html.match(/liclick\('(\d{6})'/);
    if (first?.[1]) {
      await saveBseScripCode(sym, first[1]);
      return first[1];
    }
  } catch {
    // non-fatal
  }
  return '';
}

interface BseOfficialData {
  scripCode: string;
  mktCapFullInr: number | null;
  mktCapFfInr: number | null;
  epsCurr: number | null;
  epsPrev: number | null;
  epsCurrPeriod: string;
  epsPrevPeriod: string;
  nextEarningsDate: string;
}

function parseBseShortPeriod(raw: string | undefined): string {
  if (!raw) return '';
  const m = raw.trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return '';
  return periodHeaderToIso(`${m[1]} 20${m[2]}`);
}

async function fetchBseOfficialData(sym: string, hintCode?: string): Promise<BseOfficialData | null> {
  const scripCode = await resolveBseScripCode(sym, hintCode);
  if (!scripCode) return null;

  const headers = {
    'User-Agent': UA,
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://www.bseindia.com/',
    Origin: 'https://www.bseindia.com',
  };

  const [tabRes, tradeRes, forthRes] = await Promise.allSettled([
    fetch(
      `https://api.bseindia.com/BseIndiaAPI/api/TabResults_New/w?scripcode=${encodeURIComponent(
        scripCode
      )}&tabtype=RESULTS`,
      { headers, signal: AbortSignal.timeout(5500) }
    ).then((r) => (r.ok ? r.json() : null)),
    fetch(
      `https://api.bseindia.com/BseIndiaAPI/api/StockTrading/w?flag=&quotetype=EQ&scripcode=${encodeURIComponent(
        scripCode
      )}`,
      { headers, signal: AbortSignal.timeout(5500) }
    ).then((r) => (r.ok ? r.json() : null)),
    fetch(
      `https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w?scripcode=${encodeURIComponent(
        scripCode
      )}`,
      { headers, signal: AbortSignal.timeout(5500) }
    ).then((r) => (r.ok ? r.json() : null)),
  ]);

  let epsCurr: number | null = null;
  let epsPrev: number | null = null;
  let epsCurrPeriod = '';
  let epsPrevPeriod = '';

  if (tabRes.status === 'fulfilled' && tabRes.value) {
    const t = tabRes.value as {
      col2?: string;
      col3?: string;
      resultinCr?: Array<{ title?: string; v1?: string; v2?: string }>;
    };
    epsCurrPeriod = parseBseShortPeriod(t.col2);
    epsPrevPeriod = parseBseShortPeriod(t.col3);
    const epsRow = (t.resultinCr || []).find((r) => (r.title || '').trim().toUpperCase() === 'EPS');
    if (epsRow) {
      epsCurr = parseIndianNum(epsRow.v1);
      epsPrev = parseIndianNum(epsRow.v2);
    }
  }

  let mktCapFullInr: number | null = null;
  let mktCapFfInr: number | null = null;
  if (tradeRes.status === 'fulfilled' && tradeRes.value) {
    const tr = tradeRes.value as { MktCapFull?: string; MktCapFF?: string };
    const fullCr = parseIndianNum(tr.MktCapFull);
    const ffCr = parseIndianNum(tr.MktCapFF);
    if (fullCr !== null && fullCr > 0) mktCapFullInr = Math.round(fullCr * 1e7);
    if (ffCr !== null && ffCr > 0) mktCapFfInr = Math.round(ffCr * 1e7);
  }

  let nextEarningsDate = '';
  if (forthRes.status === 'fulfilled' && Array.isArray(forthRes.value)) {
    const todayIso = toIstDateIso();
    for (const item of forthRes.value as Array<Record<string, unknown>>) {
      const rawDt = String(item.meetingdate || item.MEETING_DATE || '').trim();
      const dmy = rawDt.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
      if (dmy) {
        const monNum: Record<string, string> = {
          JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
          JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
        };
        const mm = monNum[dmy[2].toUpperCase()];
        if (mm) {
          const iso = `${dmy[3]}-${mm}-${dmy[1].padStart(2, '0')}`;
          if (iso >= todayIso) {
            nextEarningsDate = iso;
            break;
          }
        }
      }
    }
  }

  if (epsCurr === null && mktCapFullInr === null && mktCapFfInr === null && !nextEarningsDate) {
    return null;
  }

  return {
    scripCode,
    mktCapFullInr,
    mktCapFfInr,
    epsCurr,
    epsPrev,
    epsCurrPeriod,
    epsPrevPeriod,
    nextEarningsDate,
  };
}

export async function fetchAndParseNseXbrl(filing: XbrlFiling): Promise<ParsedXbrlMetrics | null> {
  if (!filing.officialFilingUrl || !filing.officialFilingUrl.startsWith('http')) return null;

  const res = await fetch(filing.officialFilingUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/xml,text/xml,*/*',
      Referer: 'https://www.nseindia.com/',
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  if (!xml || xml.length < 300 || !xml.includes('xbrli:')) return null;

  interface CtxSpan {
    id: string;
    start?: string;
    end?: string;
    instant?: string;
    days: number;
  }
  const contexts = new Map<string, CtxSpan>();
  for (const m of xml.matchAll(/<xbrli:context[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/g)) {
    const id = m[1];
    const body = m[2];
    const start = body.match(/<xbrli:startDate>(\d{4}-\d{2}-\d{2})<\/xbrli:startDate>/)?.[1];
    const end = body.match(/<xbrli:endDate>(\d{4}-\d{2}-\d{2})<\/xbrli:endDate>/)?.[1];
    const instant = body.match(/<xbrli:instant>(\d{4}-\d{2}-\d{2})<\/xbrli:instant>/)?.[1];
    let days = 0;
    if (start && end) {
      days =
        Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) +
        1;
    }
    contexts.set(id, { id, start, end, instant, days });
  }

  const readTagByCtx = (tagRegex: RegExp): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of xml.matchAll(tagRegex)) {
      const ctx = m[1];
      const val = Number(m[2]);
      if (ctx && Number.isFinite(val) && !out.has(ctx)) {
        out.set(ctx, val);
      }
    }
    return out;
  };

  const epsMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):(?:DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations|DilutedEarningsLossPerShareFromContinuingOperations|BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations|BasicEarningsLossPerShareFromContinuingOperations)[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const revMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):RevenueFromOperations[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const patMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):ProfitLossForPeriod[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const pbtMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):ProfitBeforeTax[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const finCostMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):FinanceCosts[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const deMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):DebtEquityRatio[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const icMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):InterestServiceCoverageRatio[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const equityCapMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):PaidUpValueOfEquityShareCapital[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );
  const otherEqMap = readTagByCtx(
    /<(?:in-capmkt|in-bse-fin):OtherEquity[^>]*contextRef="([^"]+)"[^>]*>([-+]?[\d.]+)</gi
  );

  const qtrCtxs = Array.from(contexts.values())
    .filter((c) => c.start && c.end && c.days >= 75 && c.days <= 105 && (revMap.has(c.id) || epsMap.has(c.id)))
    .sort((a, b) => (b.end || '').localeCompare(a.end || ''));

  const currQtr = qtrCtxs.find((c) => c.id === 'OneD') || qtrCtxs[0];
  const periodEnd = currQtr?.end || filing.financialPeriodEnd || '';

  const halfYearCtx = Array.from(contexts.values()).find(
    (c) => c.end === periodEnd && c.days >= 170 && c.days <= 195 && (epsMap.has(c.id) || patMap.has(c.id))
  );

  let epsCurr: number | null = currQtr ? (epsMap.get(currQtr.id) ?? null) : null;
  let epsPrev: number | null = null;
  let epsPrevPeriod = '';

  if (currQtr?.end) {
    const currMs = Date.parse(`${currQtr.end}T00:00:00Z`);
    const prevQtr = qtrCtxs.find((c) => {
      if (!c.end || c.id === currQtr.id) return false;
      const diff = (currMs - Date.parse(`${c.end}T00:00:00Z`)) / 86400000;
      return diff >= 80 && diff <= 115 && epsMap.has(c.id);
    });
    if (prevQtr) {
      epsPrev = epsMap.get(prevQtr.id) ?? null;
      epsPrevPeriod = prevQtr.end || '';
    } else if (epsCurr !== null && halfYearCtx && epsMap.has(halfYearCtx.id)) {
      epsPrev = Number(((epsMap.get(halfYearCtx.id) as number) - epsCurr).toFixed(2));
      const q1Date = new Date(currMs - 92 * 86400000);
      epsPrevPeriod = q1Date.toISOString().slice(0, 10);
    }
  }

  let revenueGrowthPct: number | null = null;
  let profitGrowthPct: number | null = null;
  if (currQtr?.end) {
    const currMs = Date.parse(`${currQtr.end}T00:00:00Z`);
    const yoyCtx = qtrCtxs.find((c) => {
      if (!c.end) return false;
      const diff = (currMs - Date.parse(`${c.end}T00:00:00Z`)) / 86400000;
      return diff >= 340 && diff <= 390;
    });
    if (yoyCtx) {
      const revC = revMap.get(currQtr.id);
      const revP = revMap.get(yoyCtx.id);
      if (revC !== undefined && revP !== undefined && Math.abs(revP) > 0) {
        revenueGrowthPct = Number((((revC - revP) / Math.abs(revP)) * 100).toFixed(2));
      }
      const patC = patMap.get(currQtr.id);
      const patP = patMap.get(yoyCtx.id);
      if (patC !== undefined && patP !== undefined && Math.abs(patP) > 0) {
        profitGrowthPct = Number((((patC - patP) / Math.abs(patP)) * 100).toFixed(2));
      }
    }
  }

  const firstVal = (m: Map<string, number>): number | null => {
    for (const v of m.values()) return v;
    return null;
  };

  const instantForEnd = (m: Map<string, number>): number | null => {
    if (periodEnd) {
      for (const [ctxId, v] of m.entries()) {
        const ctx = contexts.get(ctxId);
        if (ctx?.instant === periodEnd || ctx?.end === periodEnd) return v;
      }
    }
    return firstVal(m);
  };

  const rawDe = currQtr && deMap.has(currQtr.id) ? deMap.get(currQtr.id)! : instantForEnd(deMap);
  const debtToEquity = rawDe !== null && rawDe >= 0 ? rawDe : null;

  let interestCoverage =
    currQtr && icMap.has(currQtr.id) ? icMap.get(currQtr.id)! : instantForEnd(icMap);
  if (interestCoverage === null || interestCoverage <= 0.1) {
    let computedIc: number | null = null;
    if (currQtr) {
      const pbt = pbtMap.get(currQtr.id);
      const fc = finCostMap.get(currQtr.id);
      if (pbt !== undefined && fc !== undefined && fc > 0) {
        computedIc = Number(((pbt + fc) / fc).toFixed(2));
      }
    }
    interestCoverage = computedIc !== null && Number.isFinite(computedIc) ? computedIc : null;
  }

  let roePct: number | null = null;
  const patCurr = currQtr ? patMap.get(currQtr.id) : undefined;
  const eqCap = instantForEnd(equityCapMap);
  const othEq = instantForEnd(otherEqMap);
  if (patCurr !== undefined && eqCap !== null && othEq !== null && eqCap + othEq > 0) {
    roePct = Number((((patCurr * 4) / (eqCap + othEq)) * 100).toFixed(2));
  }

  if (
    epsCurr === null &&
    debtToEquity === null &&
    interestCoverage === null &&
    revenueGrowthPct === null &&
    roePct === null
  ) {
    return null;
  }

  return {
    periodEnd,
    revenueGrowthPct,
    profitGrowthPct,
    roePct,
    debtToEquity,
    interestCoverage,
    epsCurr,
    epsPrev,
    epsCurrPeriod: currQtr?.end || periodEnd,
    epsPrevPeriod,
  };
}

export async function fetchTrustedIndianFundamentals(
  symbol: string,
  xbrlFilings?: XbrlFiling[],
  options?: { forceRefresh?: boolean; forceBseProbe?: boolean }
): Promise<IndianFundamentalsPayload> {
  const sym = symbol.trim().toUpperCase();
  const forceRefresh = Boolean(options?.forceRefresh);
  const cache = loadIndianFundamentalsCache();
  const existing = cache[sym];

  if (
    !forceRefresh &&
    existing &&
    Date.now() - Date.parse(existing.fetchedAtUtc) < CACHE_TTL_MS &&
    existing.sources.includes('Screener.in')
  ) {
    return existing;
  }

  const latestFiling =
    xbrlFilings && xbrlFilings.length > 0
      ? xbrlFilings.find((f) => f.filingDescription.toLowerCase().includes('consolidated')) ||
        xbrlFilings[0]
      : null;

  const [screenerRes, xbrlRes] = await Promise.allSettled([
    fetchScreenerFullData(sym),
    latestFiling ? fetchAndParseNseXbrl(latestFiling) : Promise.resolve(null),
  ]);

  const scr = screenerRes.status === 'fulfilled' ? screenerRes.value : null;
  const xbrl = xbrlRes.status === 'fulfilled' ? xbrlRes.value : null;

  let bse: BseOfficialData | null = null;
  if (options?.forceBseProbe !== false || !scr || scr.epsCurr === null || scr.marketCapInr === null) {
    try {
      bse = await fetchBseOfficialData(sym, scr?.bseScripCode);
    } catch {
      bse = null;
    }
  }

  if (!scr && !xbrl && !bse) {
    if (existing) return existing;
    throw new Error(`Unavailable on Screener.in, BSE Official, and NSE XBRL for ${sym}`);
  }

  const sources: string[] = [];
  if (scr) sources.push('Screener.in');
  if (bse) sources.push('BSE Official');
  if (xbrl && latestFiling) sources.push('NSE XBRL');

  const sourceUrl =
    scr?.sourceUrl ||
    latestFiling?.officialFilingUrl ||
    (bse?.scripCode ? `https://www.bseindia.com/stock-share-price/x/x/${bse.scripCode}/` : '');

  const scrPeriod = scr?.financialPeriodEnd || '';
  const xbrlPeriod = xbrl?.periodEnd || latestFiling?.financialPeriodEnd || '';
  const bsePeriod = bse?.epsCurrPeriod || '';
  const allPeriods = [scrPeriod, xbrlPeriod, bsePeriod].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  allPeriods.sort((a, b) => b.localeCompare(a));
  const financialPeriodEnd = allPeriods[0] || '';

  const xbrlIsNewerOrEq = Boolean(xbrl && xbrlPeriod && (!scrPeriod || xbrlPeriod >= scrPeriod));
  const bseIsNewerOrEq = Boolean(bse && bsePeriod && (!scrPeriod || bsePeriod >= scrPeriod));

  const epsCurr =
    (scr?.epsCurr !== null && scr?.epsCurr !== undefined ? scr.epsCurr : null) ??
    (bseIsNewerOrEq && bse ? bse.epsCurr : null) ??
    (xbrlIsNewerOrEq && xbrl ? xbrl.epsCurr : null) ??
    bse?.epsCurr ??
    xbrl?.epsCurr ??
    null;

  const epsPrev =
    (scr?.epsPrev !== null && scr?.epsPrev !== undefined ? scr.epsPrev : null) ??
    (bseIsNewerOrEq && bse ? bse.epsPrev : null) ??
    (xbrlIsNewerOrEq && xbrl ? xbrl.epsPrev : null) ??
    bse?.epsPrev ??
    xbrl?.epsPrev ??
    null;

  const epsCurrPeriod =
    scr?.epsCurrPeriod ||
    (bseIsNewerOrEq ? bse?.epsCurrPeriod : '') ||
    (xbrlIsNewerOrEq ? xbrl?.epsCurrPeriod : '') ||
    '';

  const epsPrevPeriod =
    scr?.epsPrevPeriod ||
    (bseIsNewerOrEq ? bse?.epsPrevPeriod : '') ||
    (xbrlIsNewerOrEq ? xbrl?.epsPrevPeriod : '') ||
    '';

  // Prefer Screener D/E & IC when valid (Screener avoids unit-scaling stubs); supplement with XBRL if missing
  const debtToEquity =
    (scr?.debtToEquity !== null && scr?.debtToEquity !== undefined ? scr.debtToEquity : null) ??
    (xbrl?.debtToEquity !== null && xbrl?.debtToEquity !== undefined ? xbrl.debtToEquity : null);

  const interestCoverage =
    (scr?.interestCoverage !== null && scr?.interestCoverage !== undefined
      ? scr.interestCoverage
      : null) ??
    (xbrl?.interestCoverage !== null && xbrl?.interestCoverage !== undefined
      ? xbrl.interestCoverage
      : null);

  const marketCapInr = scr?.marketCapInr ?? bse?.mktCapFullInr ?? null;
  const freeFloatMcapInr = bse?.mktCapFfInr ?? null;

  const payload: IndianFundamentalsPayload = {
    symbol: sym,
    asOfDate: toIstDateIso(),
    source: sources.join(' + '),
    sourceUrl,
    sources,
    financialPeriodEnd,
    publicationDate: latestFiling?.publicationDate || undefined,
    officialFilingUrl: latestFiling?.officialFilingUrl || undefined,
    officialFilingSource: latestFiling?.officialSource || undefined,
    companyName: scr?.companyName || '',
    providerSector: scr?.providerSector || '',
    bseScripCode: scr?.bseScripCode || bse?.scripCode || '',
    nextEarningsDate: bse?.nextEarningsDate || undefined,
    marketCapInr,
    freeFloatMcapInr,
    enterpriseValueInr: scr?.enterpriseValueInr ?? null,
    currentPrice: scr?.currentPrice ?? null,
    trailingPE: scr?.trailingPE ?? null,
    bookValuePerShare: scr?.bookValuePerShare ?? null,
    priceToBook: scr?.priceToBook ?? null,
    dividendYieldPct: scr?.dividendYieldPct ?? null,
    roePct: scr?.roePct ?? xbrl?.roePct ?? null,
    rocePct: scr?.rocePct ?? null,
    revenueGrowthPct:
      (xbrlIsNewerOrEq && xbrl ? xbrl.revenueGrowthPct : null) ??
      scr?.revenueGrowthPct ??
      null,
    profitGrowthPct:
      (xbrlIsNewerOrEq && xbrl ? xbrl.profitGrowthPct : null) ??
      scr?.profitGrowthPct ??
      null,
    debtToEquity,
    interestCoverage,
    operatingCashFlowInr: scr?.operatingCashFlowInr ?? null,
    freeCashFlowInr: scr?.freeCashFlowInr ?? null,
    sharesOutstanding: scr?.sharesOutstanding ?? null,
    evToEbitda: scr?.evToEbitda ?? null,
    epsCurr,
    epsPrev,
    epsCurrPeriod,
    epsPrevPeriod,
    epsTtmCurr: scr?.epsTtmCurr ?? null,
    epsTtmPrev: scr?.epsTtmPrev ?? null,
    promoterHoldingPct: scr?.promoterHoldingPct ?? null,
    fiiHoldingPct: scr?.fiiHoldingPct ?? null,
    diiHoldingPct: scr?.diiHoldingPct ?? null,
    publicHoldingPct: scr?.publicHoldingPct ?? null,
    shareholdingQuarters: scr?.shareholdingQuarters ?? [],
    annualYears: scr?.annualYears ?? [],
    fetchedAtUtc: new Date().toISOString(),
  };

  await saveIndianFundamentalsEntry(payload);
  await syncScreenerShareholdingCache(payload);
  return payload;
}
