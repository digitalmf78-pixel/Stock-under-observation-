import fs from 'node:fs';
import path from 'node:path';
import { NSEApi } from 'nse-bse-api';
import type {
  BulkBlock30DSummary,
  BulkBlockDealItem,
  CatalystScreenerResponse,
  CorporateAnnouncementItem,
  FundamentalProfile,
  RejectionGateVerdict,
  ResultPriorityTier,
  ScreenerRow,
  StockCatalystProfile,
  StockNewsItem,
  UpcomingResultObservationResponse,
  UpcomingResultStockItem,
} from '../src/types/trading.ts';
import {
  loadLiveFundamentalOverrides,
  type LiveFundamentalRecord,
  toIstDateIso,
  upsertAndSaveFundamentalOverrides,
} from './liveFetcher.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let sharedNseHttpClient: NSEApi.HttpClient | null = null;
function getNseHttpClient(): NSEApi.HttpClient {
  if (!sharedNseHttpClient) {
    const cookieDir = path.join(process.cwd(), 'data');
    fs.mkdirSync(cookieDir, { recursive: true });
    sharedNseHttpClient = new NSEApi.HttpClient(cookieDir, true, 15000);
  }
  return sharedNseHttpClient;
}

interface CachedStockCatalyst {
  symbol: string;
  companyName: string;
  bseScripCode?: string;
  nextResultDate: string;
  isResultEstimate: boolean;
  resultSource: string;
  news7D: StockNewsItem[];
  announcements: CorporateAnnouncementItem[];
  fetchedAtUtc: string;
}

interface CatalystCacheFile {
  lastUniverseQuoteSyncUtc: string;
  bySymbol: Record<string, CachedStockCatalyst>;
}

interface BulkBlockStoreFile {
  lastSyncedUtc: string;
  deals: BulkBlockDealItem[];
}

function catalystsCachePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'catalysts_cache.json');
}

function bulkBlockStorePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'bulk_block_deals_30d.json');
}

function bseScripMapPath(): string {
  return path.join(process.cwd(), 'data', 'research', 'bse_scrip_map.json');
}

function atomicWriteJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

function loadCatalystCache(): CatalystCacheFile {
  const file = catalystsCachePath();
  if (!fs.existsSync(file)) {
    return { lastUniverseQuoteSyncUtc: '', bySymbol: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as CatalystCacheFile;
    return {
      lastUniverseQuoteSyncUtc: parsed?.lastUniverseQuoteSyncUtc || '',
      bySymbol: parsed?.bySymbol && typeof parsed.bySymbol === 'object' ? parsed.bySymbol : {},
    };
  } catch {
    return { lastUniverseQuoteSyncUtc: '', bySymbol: {} };
  }
}

function loadBulkBlockStore(): BulkBlockStoreFile {
  const file = bulkBlockStorePath();
  if (!fs.existsSync(file)) {
    return { lastSyncedUtc: '', deals: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as BulkBlockStoreFile;
    return {
      lastSyncedUtc: parsed?.lastSyncedUtc || '',
      deals: Array.isArray(parsed?.deals) ? parsed.deals : [],
    };
  } catch {
    return { lastSyncedUtc: '', deals: [] };
  }
}

function loadBseScripMap(): Record<string, string> {
  const file = bseScripMapPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let yahooCookie = '';
let yahooCrumb = '';
let yahooCrumbExpiry = 0;

async function getYahooQuoteSession(): Promise<{ cookie: string; crumb: string }> {
  if (yahooCookie && yahooCrumb && Date.now() < yahooCrumbExpiry) {
    return { cookie: yahooCookie, crumb: yahooCrumb };
  }
  const r0 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  const setCookies =
    typeof r0.headers.getSetCookie === 'function'
      ? r0.headers.getSetCookie()
      : [r0.headers.get('set-cookie')].filter((x): x is string => Boolean(x));
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const rc = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
    signal: AbortSignal.timeout(8000),
  });
  if (!rc.ok) throw new Error(`Yahoo crumb HTTP ${rc.status}`);
  const crumb = (await rc.text()).trim();
  if (!crumb) throw new Error('Yahoo empty crumb');
  yahooCookie = cookie;
  yahooCrumb = crumb;
  yahooCrumbExpiry = Date.now() + 15 * 60 * 1000;
  return { cookie, crumb };
}

export function parseNseDealDateToIso(raw: string): string {
  const clean = String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase();
  if (!clean) return '';

  const months: Record<string, string> = {
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  // DD-MMM-YYYY or DD/MMM/YYYY or DD MMM YYYY
  const mNamed4 = clean.match(/^(\d{1,2})[-/\s]([A-Z]{3})[-/\s](\d{4})$/);
  if (mNamed4 && months[mNamed4[2]]) {
    return `${mNamed4[3]}-${months[mNamed4[2]]}-${mNamed4[1].padStart(2, '0')}`;
  }

  // DD-MMM-YY
  const mNamed2 = clean.match(/^(\d{1,2})[-/\s]([A-Z]{3})[-/\s](\d{2})$/);
  if (mNamed2 && months[mNamed2[2]]) {
    return `20${mNamed2[3]}-${months[mNamed2[2]]}-${mNamed2[1].padStart(2, '0')}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const mNum = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mNum) {
    const day = Number(mNum[1]);
    const month = Number(mNum[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${mNum[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return '';
}

function normalizeDealSymbol(raw: string): string {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO)$/i, '')
    .replace(/-EQ$/i, '');
}

function normalizeDealClientName(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Institutional / Client';
}

function formatCompactCrOrLakhs(valCr: number): string {
  const abs = Math.abs(valCr);
  if (abs > 0 && abs < 0.1) {
    return `₹${(valCr * 100).toFixed(1)} L`;
  }
  return `₹${valCr.toFixed(2)} Cr`;
}

function formatIsoToDdmmyyyy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function resolveActiveRefIso(refIsoDate?: string): string {
  const todayIso = toIstDateIso();
  if (refIsoDate && /^\d{4}-\d{2}-\d{2}$/.test(refIsoDate)) {
    return refIsoDate > todayIso ? refIsoDate : todayIso;
  }
  return todayIso;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseNseDealsCsv(
  csvText: string,
  dealType: 'BULK' | 'BLOCK'
): BulkBlockDealItem[] {
  const cleanText = String(csvText || '').replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim().toUpperCase());
  const dateIdx = header.findIndex((h) => h.includes('DATE'));
  const symIdx = header.findIndex((h) => h === 'SYMBOL' || h.includes('SYMBOL'));
  const clientIdx = header.findIndex((h) => h.includes('CLIENT'));
  const sideIdx = header.findIndex(
    (h) => h.includes('BUY') || h.includes('SELL') || h === 'SIDE' || h.includes('TRANSACTION')
  );
  const qtyIdx = header.findIndex((h) => h.includes('QUANTITY') || h === 'QTY');
  const priceIdx = header.findIndex((h) => h.includes('PRICE') || h.includes('WATP'));

  if (symIdx < 0 || sideIdx < 0 || qtyIdx < 0) return [];

  const deals: BulkBlockDealItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const symbol = normalizeDealSymbol(cols[symIdx] || '');
    const rawSide = (cols[sideIdx] || '').trim().toUpperCase();
    const qty = Number((cols[qtyIdx] || '').replace(/,/g, ''));
    const price = priceIdx >= 0 ? Number((cols[priceIdx] || '').replace(/,/g, '')) : 0;
    const dateIso = dateIdx >= 0 ? parseNseDealDateToIso(cols[dateIdx] || '') : '';
    const clientName =
      clientIdx >= 0 ? normalizeDealClientName(cols[clientIdx] || '') : 'Institutional / Client';

    if (!symbol || !dateIso || !Number.isFinite(qty) || qty <= 0) continue;
    if (!rawSide.startsWith('S') && !rawSide.startsWith('B')) continue;
    const buySell: 'BUY' | 'SELL' = rawSide.startsWith('S') ? 'SELL' : 'BUY';
    const tradePrice = Number.isFinite(price) && price >= 0 ? price : 0;
    const valueCr = Number(((qty * tradePrice) / 1e7).toFixed(4));
    deals.push({
      date: dateIso,
      dealType,
      symbol,
      clientName,
      buySell,
      quantity: qty,
      tradePrice,
      valueCr,
    });
  }
  return deals;
}

export function filterDealsWithin30Days(
  deals: BulkBlockDealItem[],
  refIsoDate?: string,
  windowDays = 30
): BulkBlockDealItem[] {
  const activeRefIso = resolveActiveRefIso(refIsoDate);
  const refMs = Date.parse(`${activeRefIso}T00:00:00Z`);
  const cutoffMs = refMs - windowDays * 24 * 60 * 60 * 1000;
  const maxFutureMs = refMs + 2 * 24 * 60 * 60 * 1000;

  return deals.filter((d) => {
    if (!d?.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return false;
    const ms = Date.parse(`${d.date}T00:00:00Z`);
    return Number.isFinite(ms) && ms >= cutoffMs && ms <= maxFutureMs;
  });
}

export function mergeAndDeduplicateBulkBlockDeals(
  existingDeals: BulkBlockDealItem[],
  fetchedDeals: BulkBlockDealItem[],
  refIsoDate?: string
): BulkBlockDealItem[] {
  // Collapse exact cross-reported BLOCK + BULK duplicate prints (NSE reports block-window prints
  // exceeding 0.5% equity in both bulk_deals and block_deals), preferring 'BLOCK' attribution.
  const dedup = new Map<string, BulkBlockDealItem>();
  const withinWindow = filterDealsWithin30Days([...existingDeals, ...fetchedDeals], refIsoDate, 30);

  for (const raw of withinWindow) {
    const symbol = normalizeDealSymbol(raw.symbol);
    const date = parseNseDealDateToIso(raw.date);
    const clientName = normalizeDealClientName(raw.clientName);
    const quantity = Number(raw.quantity);
    const tradePrice = Number.isFinite(raw.tradePrice) && raw.tradePrice >= 0 ? raw.tradePrice : 0;
    if (!symbol || !date || !Number.isFinite(quantity) || quantity <= 0) continue;
    const buySell: 'BUY' | 'SELL' = String(raw.buySell || '').toUpperCase().startsWith('S')
      ? 'SELL'
      : 'BUY';
    const dealType: 'BULK' | 'BLOCK' = raw.dealType === 'BLOCK' ? 'BLOCK' : 'BULK';
    const valueCr = Number(((quantity * tradePrice) / 1e7).toFixed(4));

    const item: BulkBlockDealItem = {
      date,
      dealType,
      symbol,
      clientName,
      buySell,
      quantity,
      tradePrice,
      valueCr,
    };

    const priceBucket = Math.round(tradePrice * 100);
    const key = `${date}|${symbol}|${clientName.toUpperCase()}|${buySell}|${quantity}|${priceBucket}`;
    const prev = dedup.get(key);
    if (!prev || (prev.dealType === 'BULK' && item.dealType === 'BLOCK')) {
      dedup.set(key, item);
    }
  }

  return Array.from(dedup.values()).sort((a, b) => {
    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    return (b.valueCr || 0) - (a.valueCr || 0);
  });
}

let inFlightBulkSyncPromise: Promise<BulkBlockStoreFile> | null = null;

export async function syncNseBulkBlockDeals(
  refIsoDate?: string,
  options?: { force?: boolean }
): Promise<BulkBlockStoreFile> {
  if (inFlightBulkSyncPromise) {
    return inFlightBulkSyncPromise;
  }

  const run = async (): Promise<BulkBlockStoreFile> => {
    const existing = loadBulkBlockStore();
    const activeRefIso = resolveActiveRefIso(refIsoDate);
    const existingWindowDeals = filterDealsWithin30Days(existing.deals, activeRefIso, 30);
    const existingDatesCount = new Set(existingWindowDeals.map((d) => d.date)).size;
    const lastSyncMs = existing.lastSyncedUtc ? Date.parse(existing.lastSyncedUtc) : 0;
    const ageMs = lastSyncMs ? Date.now() - lastSyncMs : Infinity;

    // Respect short 60s cooldown on force refresh if archive already has >= 10 trading days;
    // otherwise backfill immediately so stale/partial stores recover automatically.
    if (options?.force && existingDatesCount >= 10 && ageMs < 60 * 1000) {
      const normalized = mergeAndDeduplicateBulkBlockDeals(existingWindowDeals, [], activeRefIso);
      return { lastSyncedUtc: existing.lastSyncedUtc, deals: normalized };
    }

    const nseHttp = getNseHttpClient();
    const fetched: BulkBlockDealItem[] = [];

    // 1) Primary 30-day historical archive CSVs via primed NSE HTTP/2 client
    const refMs = Date.parse(`${activeRefIso}T00:00:00Z`);
    const fromIso = new Date(refMs - 32 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fromStr = formatIsoToDdmmyyyy(fromIso);
    const toStr = formatIsoToDdmmyyyy(activeRefIso);

    for (const [dealType, optionType] of [
      ['BULK', 'bulk_deals'],
      ['BLOCK', 'block_deals'],
    ] as const) {
      try {
        const url = `https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=${optionType}&from=${fromStr}&to=${toStr}&csv=true`;
        const csvText = await nseHttp.getTextResponse(url);
        if (csvText && !csvText.trimStart().startsWith('<')) {
          fetched.push(...parseNseDealsCsv(csvText, dealType));
        }
      } catch {
        // fallback to latest CSV & snapshot below
      }
    }

    // 2) Latest-session NSE nsearchives CSVs (covers current session if historicalOR lags EOD publish)
    const headers = {
      'User-Agent': UA,
      Referer: 'https://www.nseindia.com/',
      Accept: 'text/csv,text/plain,*/*',
    };
    for (const [type, url] of [
      ['BULK', 'https://nsearchives.nseindia.com/content/equities/bulk.csv'],
      ['BLOCK', 'https://nsearchives.nseindia.com/content/equities/block.csv'],
    ] as const) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(9000) });
        if (res.ok) {
          const text = await res.text();
          if (text && !text.trimStart().startsWith('<')) {
            fetched.push(...parseNseDealsCsv(text, type));
          }
        }
      } catch {
        // non-fatal
      }
    }

    // 3) Live NSE snapshot-capital-market-largedeal JSON via primed NSE client (fallback to fetch)
    interface NseLargeDealSnapshot {
      BULK_DEALS_DATA?: Array<Record<string, unknown>>;
      BLOCK_DEALS_DATA?: Array<Record<string, unknown>>;
    }
    try {
      let snap: NseLargeDealSnapshot | null = null;
      try {
        snap = (await nseHttp.request(
          'https://www.nseindia.com/api/snapshot-capital-market-largedeal'
        )) as NseLargeDealSnapshot;
      } catch {
        const snapRes = await fetch(
          'https://www.nseindia.com/api/snapshot-capital-market-largedeal',
          {
            headers: {
              'User-Agent': UA,
              Referer: 'https://www.nseindia.com/',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(7000),
          }
        );
        if (snapRes.ok) {
          snap = (await snapRes.json()) as NseLargeDealSnapshot;
        }
      }

      if (snap) {
        const ingestSnapshot = (
          arr: Array<Record<string, unknown>> | undefined,
          dealType: 'BULK' | 'BLOCK'
        ) => {
          for (const r of Array.isArray(arr) ? arr : []) {
            const symbol = normalizeDealSymbol(String(r.symbol || ''));
            const rawSide = String(r.buySell || '').trim().toUpperCase();
            const qty = Number(String(r.qty || '0').replace(/,/g, ''));
            const price = Number(String(r.watp || '0').replace(/,/g, ''));
            const dateIso = parseNseDealDateToIso(String(r.date || ''));
            const clientName = normalizeDealClientName(String(r.clientName || ''));
            if (!symbol || !dateIso || !Number.isFinite(qty) || qty <= 0) continue;
            if (!rawSide.startsWith('S') && !rawSide.startsWith('B')) continue;
            const buySell: 'BUY' | 'SELL' = rawSide.startsWith('S') ? 'SELL' : 'BUY';
            const tradePrice = Number.isFinite(price) && price >= 0 ? price : 0;
            const valueCr = Number(((qty * tradePrice) / 1e7).toFixed(4));
            fetched.push({
              date: dateIso,
              dealType,
              symbol,
              clientName,
              buySell,
              quantity: qty,
              tradePrice,
              valueCr,
            });
          }
        };
        ingestSnapshot(snap.BULK_DEALS_DATA, 'BULK');
        ingestSnapshot(snap.BLOCK_DEALS_DATA, 'BLOCK');
      }
    } catch {
      // non-fatal fallback
    }

    const mergedDeals = mergeAndDeduplicateBulkBlockDeals(existing.deals, fetched, activeRefIso);
    const merged: BulkBlockStoreFile = {
      lastSyncedUtc: fetched.length > 0 ? new Date().toISOString() : existing.lastSyncedUtc,
      deals: mergedDeals,
    };
    atomicWriteJson(bulkBlockStorePath(), merged);
    return merged;
  };

  inFlightBulkSyncPromise = run().finally(() => {
    inFlightBulkSyncPromise = null;
  });
  return inFlightBulkSyncPromise;
}

export function getBulkBlock30DSummaryForSymbol(
  symbol: string,
  store?: BulkBlockStoreFile,
  refIsoDate?: string
): BulkBlock30DSummary {
  const sym = normalizeDealSymbol(symbol);
  const data = store ?? loadBulkBlockStore();
  const windowDeals = filterDealsWithin30Days(data.deals, refIsoDate, 30);
  const deals = mergeAndDeduplicateBulkBlockDeals(
    [],
    windowDeals.filter((d) => normalizeDealSymbol(d.symbol) === sym),
    refIsoDate
  );

  if (deals.length === 0) {
    return {
      totalDeals: 0,
      buyCount: 0,
      sellCount: 0,
      buyValueCr: 0,
      sellValueCr: 0,
      netValueCr: 0,
      sentiment: 'NONE',
      sentimentLabel: 'No 30D Deals',
      sentimentReason: 'No NSE Bulk or Block deals recorded for this symbol in the rolling 30D archive.',
      buyPct: 0,
      topBuyClients: [],
      topSellClients: [],
      deals: [],
    };
  }
  let buyCount = 0;
  let sellCount = 0;
  let buyValueCr = 0;
  let sellValueCr = 0;
  const buyerVals = new Map<string, number>();
  const sellerVals = new Map<string, number>();

  for (const d of deals) {
    const client = normalizeDealClientName(d.clientName);
    const valCr = Number.isFinite(d.valueCr) ? d.valueCr : 0;
    if (d.buySell === 'BUY') {
      buyCount++;
      buyValueCr += valCr;
      buyerVals.set(client, (buyerVals.get(client) || 0) + valCr);
    } else {
      sellCount++;
      sellValueCr += valCr;
      sellerVals.set(client, (sellerVals.get(client) || 0) + valCr);
    }
  }
  const buyCr = Number(buyValueCr.toFixed(2));
  const sellCr = Number(sellValueCr.toFixed(2));
  const netValueCr = Number((buyValueCr - sellValueCr).toFixed(2));
  const grossCr = buyValueCr + sellValueCr;
  const buyPct = grossCr > 0 ? Number(((buyValueCr / grossCr) * 100).toFixed(1)) : buyCount > 0 ? 100 : 0;

  const topBuyClients = Array.from(buyerVals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, val]) => `${name} (${formatCompactCrOrLakhs(val)})`);
  const topSellClients = Array.from(sellerVals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, val]) => `${name} (${formatCompactCrOrLakhs(val)})`);

  const sentiment: BulkBlock30DSummary['sentiment'] =
    netValueCr > 0.25 ? 'POSITIVE' : netValueCr < -0.25 ? 'NEGATIVE' : 'NEUTRAL';

  let sentimentLabel = 'Balanced Two-Way Flow';
  let sentimentReason = `Buy ₹${buyCr.toFixed(2)} Cr (${buyCount} deals, ${buyPct}%) vs Sell ₹${sellCr.toFixed(2)} Cr (${sellCount} deals) · Net ${netValueCr >= 0 ? '+' : '-'}₹${Math.abs(netValueCr).toFixed(2)} Cr`;

  if (sentiment === 'POSITIVE') {
    sentimentLabel = buyPct >= 75 ? 'Strong Institutional Accumulation' : 'Net Institutional Buying';
    sentimentReason = `Buy ₹${buyCr.toFixed(2)} Cr (${buyCount} deals, ${buyPct}% share) vs Sell ₹${sellCr.toFixed(2)} Cr (${sellCount} deals) · Net +₹${netValueCr.toFixed(2)} Cr inflow${
      topBuyClients.length > 0 ? ` · Key buyers: ${topBuyClients.slice(0, 2).join(', ')}` : ''
    }`;
  } else if (sentiment === 'NEGATIVE') {
    sentimentLabel = buyPct <= 25 ? 'Heavy Institutional Distribution' : 'Net Institutional Selling';
    sentimentReason = `Sell ₹${sellCr.toFixed(2)} Cr (${sellCount} deals) vs Buy ₹${buyCr.toFixed(2)} Cr (${buyCount} deals, ${buyPct}% share) · Net -₹${Math.abs(netValueCr).toFixed(2)} Cr outflow${
      topSellClients.length > 0 ? ` · Key sellers: ${topSellClients.slice(0, 2).join(', ')}` : ''
    }`;
  } else if (topBuyClients.length > 0 || topSellClients.length > 0) {
    sentimentReason += `${topBuyClients.length > 0 ? ` · Buy: ${topBuyClients[0]}` : ''}${
      topSellClients.length > 0 ? ` · Sell: ${topSellClients[0]}` : ''
    }`;
  }

  return {
    totalDeals: deals.length,
    buyCount,
    sellCount,
    buyValueCr: buyCr,
    sellValueCr: sellCr,
    netValueCr,
    sentiment,
    sentimentLabel,
    sentimentReason,
    buyPct,
    topBuyClients,
    topSellClients,
    deals: deals.slice(0, 60),
  };
}

export function getAllBulkBlockDeals30D(params?: {
  symbol?: string;
  dealType?: string;
  buySell?: string;
  days?: number;
  limit?: number;
  refIso?: string;
}): {
  lastSyncedUtc: string;
  distinctDatesCount: number;
  oldestDealDate: string;
  latestDealDate: string;
  symbolsWithDeals: number;
  total: number;
  deals: BulkBlockDealItem[];
} {
  const store = loadBulkBlockStore();
  const days = Math.min(30, Math.max(1, params?.days ?? 30));
  const cleanDeals = mergeAndDeduplicateBulkBlockDeals(
    [],
    filterDealsWithin30Days(store.deals, params?.refIso, days),
    params?.refIso
  );

  const dates = Array.from(new Set(cleanDeals.map((d) => d.date))).sort();
  let filtered = cleanDeals;

  const sym = params?.symbol ? normalizeDealSymbol(params.symbol) : '';
  if (sym) {
    filtered = filtered.filter((d) => d.symbol === sym);
  }
  const dt = (params?.dealType || '').trim().toUpperCase();
  if (dt === 'BULK' || dt === 'BLOCK') {
    filtered = filtered.filter((d) => d.dealType === dt);
  }
  const bs = (params?.buySell || '').trim().toUpperCase();
  if (bs === 'BUY' || bs === 'SELL') {
    filtered = filtered.filter((d) => d.buySell === bs);
  }

  const limit = Math.min(500, Math.max(1, params?.limit ?? 150));
  return {
    lastSyncedUtc: store.lastSyncedUtc,
    distinctDatesCount: dates.length,
    oldestDealDate: dates[0] || '',
    latestDealDate: dates[dates.length - 1] || '',
    symbolsWithDeals: new Set(cleanDeals.map((d) => d.symbol)).size,
    total: filtered.length,
    deals: filtered.slice(0, limit),
  };
}

let universeQuoteScanState = {
  running: false,
  processed: 0,
  total: 0,
  lastSyncedUtc: '',
};

export function getUniverseQuoteScanStatus() {
  return { ...universeQuoteScanState };
}

function pickUpcomingEarningsDate(q: Record<string, unknown>, refIso: string): {
  dateIso: string;
  isEstimate: boolean;
} {
  const startRaw = typeof q.earningsTimestampStart === 'number' ? q.earningsTimestampStart : null;
  const mainRaw = typeof q.earningsTimestamp === 'number' ? q.earningsTimestamp : null;
  const endRaw = typeof q.earningsTimestampEnd === 'number' ? q.earningsTimestampEnd : null;
  const isEst = Boolean(q.isEarningsDateEstimate);

  const candidates: number[] = [];
  for (const ts of [startRaw, mainRaw, endRaw]) {
    if (ts !== null && Number.isFinite(ts) && ts > 1577836800) {
      candidates.push(ts);
    }
  }
  if (candidates.length === 0) return { dateIso: '', isEstimate: isEst };

  const isoList = candidates
    .map((ts) => new Date(ts * 1000).toISOString().slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => a.localeCompare(b));

  const upcoming = isoList.find((d) => d >= refIso);
  if (upcoming) return { dateIso: upcoming, isEstimate: isEst };
  return { dateIso: '', isEstimate: isEst };
}

export async function syncUniverseQuoteCalendarAndIpo(
  symbols: string[],
  refIso: string,
  onFinished?: () => void
): Promise<{
  total: number;
  updatedCount: number;
  upcoming3mCount: number;
  ipoUnder1yCount: number;
}> {
  if (universeQuoteScanState.running) {
    return { total: universeQuoteScanState.total, updatedCount: 0, upcoming3mCount: 0, ipoUnder1yCount: 0 };
  }

  universeQuoteScanState = {
    running: true,
    processed: 0,
    total: symbols.length,
    lastSyncedUtc: universeQuoteScanState.lastSyncedUtc,
  };

  let updatedCount = 0;
  let upcoming3mCount = 0;
  let ipoUnder1yCount = 0;

  try {
    const session = await getYahooQuoteSession();
    const existingOverrides = loadLiveFundamentalOverrides();
    const recordsToUpsert: LiveFundamentalRecord[] = [];
    const CHUNK = 80;
    const todayIso = toIstDateIso();
    const activeRefIso = refIso > todayIso ? refIso : todayIso;
    const refMs = Date.parse(`${activeRefIso}T00:00:00Z`);

    for (let i = 0; i < symbols.length; i += CHUNK) {
      const slice = symbols.slice(i, i + CHUNK);
      const yfTickers = slice.map((s) => `${s}.NS`).join(',');
      try {
        let res = await fetch(
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
            yfTickers
          )}&crumb=${encodeURIComponent(session.crumb)}`,
          {
            headers: { 'User-Agent': UA, Cookie: session.cookie },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (res.status === 401) {
          yahooCrumbExpiry = 0;
          const freshSess = await getYahooQuoteSession();
          res = await fetch(
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
              yfTickers
            )}&crumb=${encodeURIComponent(freshSess.crumb)}`,
            {
              headers: { 'User-Agent': UA, Cookie: freshSess.cookie },
              signal: AbortSignal.timeout(10000),
            }
          );
        }
        if (res.ok) {
          const json = (await res.json()) as {
            quoteResponse?: { result?: Array<Record<string, unknown>> };
          };
          for (const q of json?.quoteResponse?.result ?? []) {
            const rawSym = typeof q.symbol === 'string' ? q.symbol : '';
            const sym = rawSym.replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
            if (!sym) continue;

            const ftMs = typeof q.firstTradeDateMilliseconds === 'number' ? q.firstTradeDateMilliseconds : null;
            const firstTradeDateIso =
              ftMs && ftMs > 631152000000 ? new Date(ftMs).toISOString().slice(0, 10) : '';
            const { dateIso: nextEarningsDate } = pickUpcomingEarningsDate(q, activeRefIso);
            const companyName =
              (typeof q.longName === 'string' && q.longName.trim()) ||
              (typeof q.shortName === 'string' && q.shortName.trim()) ||
              '';

            if (firstTradeDateIso) {
              const ageDays = Math.round((refMs - Date.parse(`${firstTradeDateIso}T00:00:00Z`)) / 86400000);
              if (ageDays >= 0 && ageDays <= 365) ipoUnder1yCount++;
            }
            if (nextEarningsDate && nextEarningsDate >= activeRefIso) {
              const daysTo = Math.round((Date.parse(`${nextEarningsDate}T00:00:00Z`) - refMs) / 86400000);
              if (daysTo >= 0 && daysTo <= 90) upcoming3mCount++;
            }

            const prev = existingOverrides[sym];

            if (firstTradeDateIso || nextEarningsDate || companyName) {
              updatedCount++;
              recordsToUpsert.push({
                symbol: sym,
                asOfDate: prev?.asOfDate || '',
                source: prev?.source || 'Listing & Calendar Metadata (.NS)',
                sourceUrl: prev?.sourceUrl || '',
                financialPeriodEnd: prev?.financialPeriodEnd || '',
                sources: prev?.sources || [],
                providerSector: prev?.providerSector || '',
                companyName: companyName || prev?.companyName,
                firstTradeDateIso: firstTradeDateIso || prev?.firstTradeDateIso,
                nextEarningsDate: nextEarningsDate || prev?.nextEarningsDate,
                revenueGrowthPct: prev?.revenueGrowthPct ?? null,
                profitGrowthPct: prev?.profitGrowthPct ?? null,
                roePct: prev?.roePct ?? null,
                rocePct: prev?.rocePct ?? null,
                debtToEquity: prev?.debtToEquity ?? null,
                interestCoverage: prev?.interestCoverage ?? null,
                operatingCashFlowInr: prev?.operatingCashFlowInr ?? null,
                freeCashFlowInr: prev?.freeCashFlowInr ?? null,
                trailingPE: prev?.trailingPE ?? null,
                priceToBook: prev?.priceToBook ?? null,
                marketCapInr: prev?.marketCapInr ?? null,
                enterpriseValueInr: prev?.enterpriseValueInr ?? null,
                dividendYieldPct: prev?.dividendYieldPct ?? null,
                promoterHoldingPct: prev?.promoterHoldingPct ?? null,
                epsPrev: prev?.epsPrev ?? null,
                epsCurr: prev?.epsCurr ?? null,
                epsPrevPeriod: prev?.epsPrevPeriod || '',
                epsCurrPeriod: prev?.epsCurrPeriod || '',
                epsTtmPrev: prev?.epsTtmPrev ?? null,
                epsTtmCurr: prev?.epsTtmCurr ?? null,
                fetchedAtUtc: prev?.fetchedAtUtc || '',
              });
            }
          }
        }
      } catch {
        // continue to next batch
      }
      universeQuoteScanState.processed = Math.min(symbols.length, i + slice.length);
      if (i + CHUNK < symbols.length) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    if (recordsToUpsert.length > 0) {
      await upsertAndSaveFundamentalOverrides(recordsToUpsert);
    }
    const cache = loadCatalystCache();
    cache.lastUniverseQuoteSyncUtc = new Date().toISOString();
    atomicWriteJson(catalystsCachePath(), cache);
    universeQuoteScanState.lastSyncedUtc = cache.lastUniverseQuoteSyncUtc;
    if (onFinished) onFinished();
  } finally {
    universeQuoteScanState.running = false;
  }

  return { total: symbols.length, updatedCount, upcoming3mCount, ipoUnder1yCount };
}

function classifyTextSentiment(text: string): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' {
  const lower = text.toLowerCase();
  const posHits = [
    'order win',
    'wins order',
    'bags order',
    'bagged',
    'awarded',
    'letter of award',
    'loa',
    'contract win',
    'work order',
    'profit rises',
    'profit jumps',
    'net profit up',
    'pat up',
    'surge',
    'growth',
    'expansion',
    'acquisition',
    'dividend',
    'buyback',
    'upgrade',
    'outperform',
    'approval',
  ];
  const negHits = [
    'loss',
    'profit falls',
    'profit drops',
    'profit declines',
    'net profit down',
    'penalty',
    'fine',
    'sebi notice',
    'default',
    'downgrade',
    'resign',
    'termination',
    'cancel',
    'raid',
    'investigation',
    'fraud',
    'slump',
    'weak results',
  ];
  let score = 0;
  for (const w of posHits) if (lower.includes(w)) score++;
  for (const w of negHits) if (lower.includes(w)) score--;
  if (score > 0) return 'POSITIVE';
  if (score < 0) return 'NEGATIVE';
  return 'NEUTRAL';
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetch7DayGoogleNews(
  symbol: string,
  companyName?: string
): Promise<StockNewsItem[]> {
  const symUpper = symbol.trim().toUpperCase();
  const cleanName = (companyName || '')
    .replace(/\b(Limited|Ltd\.?|Private|Pvt\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const query = cleanName
    ? `("${symUpper}" OR "${cleanName}") (NSE OR BSE OR stock OR share OR results OR order) when:7d`
    : `"${symUpper}" (NSE OR BSE OR stock OR share OR results OR order) when:7d`;

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

  const stopWords = new Set([
    'india',
    'limited',
    'ltd',
    'private',
    'pvt',
    'one',
    'group',
    'holdings',
    'holding',
    'financial',
    'services',
    'industries',
    'enterprises',
    'global',
    'solutions',
    'technologies',
    'corporation',
    'company',
  ]);
  const nameTokens = cleanName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));
  const cleanNameLower = cleanName.toLowerCase();

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/xml,text/xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: StockNewsItem[] = [];
    const nowMs = Date.now();
    const maxAgeMs = 7.5 * 24 * 60 * 60 * 1000;

    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
      const descRaw = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
      const linkRaw = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
      const pubRaw = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
      const sourceRaw = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || 'Google News';

      const title = decodeHtmlEntities(titleRaw.replace(/^<!\[CDATA\[|\]\]>$/g, ''));
      const desc = decodeHtmlEntities(
        descRaw.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/<[^>]+>/g, ' ')
      );
      const urlClean = linkRaw.trim();
      const source = decodeHtmlEntities(sourceRaw.replace(/^<!\[CDATA\[|\]\]>$/g, ''));
      const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
      if (!title || !urlClean || !Number.isFinite(pubMs)) continue;

      const haystack = `${title} ${desc}`.toLowerCase();
      const matchesSymbol = haystack.includes(symUpper.toLowerCase());
      const matchesFullName = cleanNameLower.length >= 4 && haystack.includes(cleanNameLower);
      const matchesToken =
        nameTokens.length > 0 && nameTokens.some((tok) => haystack.includes(tok));
      if (!matchesSymbol && !matchesFullName && !matchesToken) continue;

      const diffMs = Math.max(0, nowMs - pubMs);
      if (diffMs > maxAgeMs) continue;
      const ageDays = Number((diffMs / 86400000).toFixed(1));

      items.push({
        title,
        url: urlClean,
        source,
        publishedAtUtc: new Date(pubMs).toISOString(),
        ageDays,
        sentiment: classifyTextSentiment(title),
      });
      if (items.length >= 12) break;
    }

    return items.sort((a, b) => b.publishedAtUtc.localeCompare(a.publishedAtUtc));
  } catch {
    return [];
  }
}

async function resolveBseScripCode(symbol: string): Promise<string> {
  const sym = symbol.trim().toUpperCase();
  const scripMap = loadBseScripMap();
  if (scripMap[sym]) return scripMap[sym];

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
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!res.ok) return '';
    const html = await res.text();
    for (const m of html.matchAll(/liclick\('(\d{6})','([^']+)'\)/g)) {
      const code = m[1];
      // Check if snippet near match has exact symbol
      const idx = m.index ?? 0;
      const windowSlice = html.slice(idx, idx + 350).toUpperCase();
      if (
        windowSlice.includes(`>${sym}<`) ||
        windowSlice.includes(`${sym}&NBSP;`) ||
        windowSlice.includes(`<strong>${sym}</strong>`)
      ) {
        scripMap[sym] = code;
        atomicWriteJson(bseScripMapPath(), scripMap);
        return code;
      }
    }
    const first = html.match(/liclick\('(\d{6})'/);
    if (first?.[1]) {
      scripMap[sym] = first[1];
      atomicWriteJson(bseScripMapPath(), scripMap);
      return first[1];
    }
  } catch {
    // ignore
  }
  return '';
}

function formatYmdCompact(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export async function fetchBseCorporateAnnouncements(
  symbol: string
): Promise<{ scripCode: string; items: CorporateAnnouncementItem[]; boardResultDate: string }> {
  const sym = symbol.trim().toUpperCase();
  const scripCode = await resolveBseScripCode(sym);
  if (!scripCode) return { scripCode: '', items: [], boardResultDate: '' };

  const toDt = new Date();
  const fromDt = new Date(toDt.getTime() - 45 * 24 * 60 * 60 * 1000);
  const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=${formatYmdCompact(
    fromDt
  )}&strScrip=${encodeURIComponent(scripCode)}&strSearch=P&strToDate=${formatYmdCompact(
    toDt
  )}&strType=C&subcategory=-1`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://www.bseindia.com/',
        Origin: 'https://www.bseindia.com',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { scripCode, items: [], boardResultDate: '' };
    const json = (await res.json()) as { Table?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json?.Table) ? json.Table : [];

    const items: CorporateAnnouncementItem[] = [];
    let boardResultDate = '';

    for (const r of rows.slice(0, 20)) {
      const subject = String(r.NEWSSUB || r.HEADLINE || '').replace(/\r?\n/g, ' ').trim();
      const details = String(r.HEADLINE || r.SUBCATNAME || r.CATEGORYNAME || '')
        .replace(/\r?\n/g, ' ')
        .trim();
      const dtRaw = String(r.DT_TM || r.NEWS_DT || '').slice(0, 10);
      const attach = String(r.ATTACHMENTNAME || '').trim();
      const attachmentUrl = attach
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attach}`
        : String(r.NSURL || '');

      const combined = `${subject} ${details}`.toLowerCase();
      let category: CorporateAnnouncementItem['category'] = 'GENERAL';
      if (
        /\b(order|contract|letter of award|loa|work order|bagged|awarded|purchase order|supply agreement)\b/i.test(
          combined
        )
      ) {
        category = 'ORDER_WIN';
      } else if (/\b(board meeting|financial result|unaudited|audited|quarter ended)\b/i.test(combined)) {
        category = 'RESULTS_BOARD_MEETING';
        const todayIso = toIstDateIso(toDt);
        const ymdMatch = combined.match(/(\d{4})-(\d{2})-(\d{2})/);
        const dmyMatch = combined.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
        let candidateIso = '';
        if (ymdMatch) {
          candidateIso = `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
        } else if (dmyMatch) {
          candidateIso = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
        }
        if (candidateIso && candidateIso >= todayIso && !boardResultDate) {
          boardResultDate = candidateIso;
        }
      } else if (/\b(acquisition|joint venture|capex|expansion|qip|preferential|rights|allotment)\b/i.test(combined)) {
        category = 'EXPANSION_FUNDRAISE';
      } else if (/\b(dividend|bonus|split|buyback|agm|egm|record date)\b/i.test(combined)) {
        category = 'CORPORATE_ACTION';
      }

      if (subject) {
        items.push({
          date: dtRaw,
          symbol: sym,
          category,
          subject,
          details,
          attachmentUrl,
          sentiment: category === 'ORDER_WIN' ? 'POSITIVE' : classifyTextSentiment(combined),
        });
      }
    }

    return { scripCode, items, boardResultDate };
  } catch {
    return { scripCode, items: [], boardResultDate: '' };
  }
}

export function computeResultPriorityTier(
  nextResultDate: string,
  refIso: string
): { tier: ResultPriorityTier; daysToResult: number | null } {
  if (!nextResultDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextResultDate)) {
    return { tier: 'UNSCHEDULED', daysToResult: null };
  }
  const refMs = Date.parse(`${refIso}T00:00:00Z`);
  const resMs = Date.parse(`${nextResultDate}T00:00:00Z`);
  if (!Number.isFinite(refMs) || !Number.isFinite(resMs)) {
    return { tier: 'UNSCHEDULED', daysToResult: null };
  }
  const days = Math.round((resMs - refMs) / 86400000);
  if (days < 0) return { tier: 'UNSCHEDULED', daysToResult: days };
  if (days <= 30) return { tier: 'WITHIN_1M', daysToResult: days };
  if (days <= 60) return { tier: 'WITHIN_2M', daysToResult: days };
  if (days <= 90) return { tier: 'WITHIN_3M', daysToResult: days };
  return { tier: 'BEYOND_3M', daysToResult: days };
}

export function evaluate3MonthResultPolarity(fund: FundamentalProfile | undefined): {
  polarity: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';
  reason: string;
} {
  if (!fund) {
    return { polarity: 'UNKNOWN', reason: '3M earnings/profit data not cached yet' };
  }
  const pg = fund.profitGrowthPct;
  const rg = fund.revenueGrowthPct;
  const epsP = fund.epsPrev;
  const epsC = fund.epsCurr;

  if (pg !== null) {
    if (pg < 0) {
      return {
        polarity: 'NEGATIVE',
        reason: `Negative 3M/YoY Profit Growth (${pg.toFixed(1)}%)`,
      };
    }
    if (epsC !== null && epsC < 0) {
      return {
        polarity: 'NEGATIVE',
        reason: `Negative latest quarterly EPS (₹${epsC.toFixed(2)})`,
      };
    }
    return {
      polarity: 'POSITIVE',
      reason: `Positive Profit Growth (+${pg.toFixed(1)}%${rg !== null ? `, Rev ${rg >= 0 ? '+' : ''}${rg.toFixed(1)}%` : ''})`,
    };
  }

  if (epsC !== null && epsP !== null) {
    if (epsC < 0 || (epsP > 0 && epsC < epsP * 0.9)) {
      return {
        polarity: 'NEGATIVE',
        reason: `Quarterly EPS fell from ₹${epsP.toFixed(2)} to ₹${epsC.toFixed(2)}`,
      };
    }
    if (epsC >= epsP) {
      return {
        polarity: 'POSITIVE',
        reason: `Positive Quarterly EPS momentum (₹${epsP.toFixed(2)} -> ₹${epsC.toFixed(2)})`,
      };
    }
  }

  if (epsC !== null) {
    if (epsC < 0) {
      return { polarity: 'NEGATIVE', reason: `Negative latest EPS (₹${epsC.toFixed(2)})` };
    }
    if (epsC > 0 && rg !== null && rg >= 0) {
      return { polarity: 'POSITIVE', reason: `Positive EPS (₹${epsC.toFixed(2)}) & Rev +${rg.toFixed(1)}%` };
    }
  }

  if (rg !== null) {
    return rg >= 0
      ? { polarity: 'POSITIVE', reason: `Positive Revenue Growth (+${rg.toFixed(1)}%)` }
      : { polarity: 'NEGATIVE', reason: `Negative Revenue Growth (${rg.toFixed(1)}%)` };
  }

  return { polarity: 'UNKNOWN', reason: '3M profit/EPS metrics missing — collect fundamentals' };
}

export function evaluateRejectionGate(params: {
  priority: ResultPriorityTier;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';
  polarityReason: string;
  bulkBlock30D: BulkBlock30DSummary;
}): {
  verdict: RejectionGateVerdict;
  reasons: string[];
  observationEligible: boolean;
} {
  const reasons: string[] = [];
  const in3MWindow =
    params.priority === 'WITHIN_1M' ||
    params.priority === 'WITHIN_2M' ||
    params.priority === 'WITHIN_3M';

  if (params.polarity === 'NEGATIVE') {
    reasons.push(params.polarityReason);
  }
  if (params.bulkBlock30D.sentiment === 'NEGATIVE') {
    reasons.push(
      `Net negative 30D bulk/block deals (₹${params.bulkBlock30D.netValueCr.toFixed(2)} Cr)`
    );
  }
  if (!in3MWindow) {
    reasons.push('Next result not within upcoming 3 months (0–90d)');
  }

  if (params.polarity === 'NEGATIVE') {
    return { verdict: 'REJECT_NEGATIVE_RESULT', reasons, observationEligible: false };
  }
  if (params.bulkBlock30D.sentiment === 'NEGATIVE') {
    return { verdict: 'REJECT_NEGATIVE_DEALS', reasons, observationEligible: false };
  }
  if (!in3MWindow) {
    return { verdict: 'REJECT_NO_3M_RESULT', reasons, observationEligible: false };
  }
  if (params.polarity === 'UNKNOWN') {
    return {
      verdict: 'PENDING_VERIFICATION',
      reasons: ['Result within 3M — verify/collect latest profit & EPS to pass gate'],
      observationEligible: false,
    };
  }

  return {
    verdict: 'PASS_OBSERVATION',
    reasons: [params.polarityReason],
    observationEligible: true,
  };
}

export function buildStockCatalystProfile(params: {
  row: ScreenerRow;
  fund: FundamentalProfile | undefined;
  cached?: CachedStockCatalyst;
  bulkBlockStore: BulkBlockStoreFile;
  refIso: string;
}): StockCatalystProfile {
  const { row, fund, cached, bulkBlockStore, refIso } = params;
  const rawDate = cached?.nextResultDate || row.nextEarningsDate || fund?.nextEarningsDate || '';
  const nextResultDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate >= refIso ? rawDate : '';
  const { tier, daysToResult } = computeResultPriorityTier(nextResultDate, refIso);
  const { polarity, reason: polarityReason } = evaluate3MonthResultPolarity(fund);
  const bulkBlock30D = getBulkBlock30DSummaryForSymbol(row.symbol, bulkBlockStore, refIso);
  const gate = evaluateRejectionGate({
    priority: tier,
    polarity,
    polarityReason,
    bulkBlock30D,
  });

  const news7D = cached?.news7D ?? [];
  const announcements = cached?.announcements ?? [];
  const orderWinsCount = announcements.filter((a) => a.category === 'ORDER_WIN').length;

  return {
    symbol: row.symbol,
    companyName: cached?.companyName || row.companyName || fund?.companyName || row.symbol,
    closePrice: row.closePrice,
    changePct: row.changePct,
    sector: row.providerSector || '',
    nextResultDate,
    daysToResult,
    resultPriority: tier,
    resultSource: cached?.resultSource || (nextResultDate ? 'Yahoo Finance Calendar' : ''),
    isResultEstimate: cached?.isResultEstimate ?? true,
    resultPolarity3M: polarity,
    result3MReason: polarityReason,
    profitGrowthPct: fund?.profitGrowthPct ?? null,
    revenueGrowthPct: fund?.revenueGrowthPct ?? null,
    epsPrev: fund?.epsPrev ?? null,
    epsCurr: fund?.epsCurr ?? null,
    rejectionGate: gate.verdict,
    rejectionReasons: gate.reasons,
    observationEligible: gate.observationEligible,
    news7D,
    announcements,
    orderWinsCount,
    bulkBlock30D,
    swingTier: row.swingTier,
    deliveryCategory: row.deliveryCategory,
    rvol: row.rvol,
    uTurnStatus: row.uTurnStatus,
    fundamentalCoverage: row.fundamentalCoverage,
    fundamentalFreshness: row.fundamentalFreshness,
    fetchedAtUtc: cached?.fetchedAtUtc || '',
    marketCapCr: row.marketCapCr,
    marketCapCategory: row.marketCapCategory,
    ema21AboveEma44: row.ema21AboveEma44,
    ema21Cross44Bullish: row.ema21Cross44Bullish,
  };
}

export async function fetchAndCacheStockCatalysts(params: {
  row: ScreenerRow;
  fund: FundamentalProfile | undefined;
  refIso: string;
  forceRefresh?: boolean;
}): Promise<StockCatalystProfile> {
  const { row, fund, refIso, forceRefresh } = params;
  const sym = row.symbol;
  const cache = loadCatalystCache();
  const existing = cache.bySymbol[sym];
  const ageMs = existing?.fetchedAtUtc ? Date.now() - Date.parse(existing.fetchedAtUtc) : Infinity;

  let bulkStore = loadBulkBlockStore();
  const bulkWindowDeals = filterDealsWithin30Days(bulkStore.deals, refIso, 30);
  const bulkDistinctDates = new Set(bulkWindowDeals.map((d) => d.date)).size;
  const bulkAgeMs = bulkStore.lastSyncedUtc ? Date.now() - Date.parse(bulkStore.lastSyncedUtc) : Infinity;
  if (
    !bulkStore.lastSyncedUtc ||
    bulkDistinctDates < 10 ||
    (forceRefresh ? bulkAgeMs > 60 * 1000 : bulkAgeMs > 2 * 60 * 60 * 1000)
  ) {
    bulkStore = await syncNseBulkBlockDeals(refIso, { force: forceRefresh });
  }

  if (!forceRefresh && existing && ageMs < 6 * 60 * 60 * 1000) {
    return buildStockCatalystProfile({
      row,
      fund,
      cached: existing,
      bulkBlockStore: bulkStore,
      refIso,
    });
  }

  const companyName = row.companyName || fund?.companyName || existing?.companyName || '';
  const [newsRes, bseRes] = await Promise.allSettled([
    fetch7DayGoogleNews(sym, companyName),
    fetchBseCorporateAnnouncements(sym),
  ]);

  const news7D = newsRes.status === 'fulfilled' ? newsRes.value : existing?.news7D ?? [];
  const bseData =
    bseRes.status === 'fulfilled'
      ? bseRes.value
      : { scripCode: existing?.bseScripCode || '', items: existing?.announcements ?? [], boardResultDate: '' };

  let nextResultDate = row.nextEarningsDate || fund?.nextEarningsDate || existing?.nextResultDate || '';
  let resultSource = nextResultDate ? 'Yahoo Finance Calendar' : '';
  if (bseData.boardResultDate) {
    nextResultDate = bseData.boardResultDate;
    resultSource = 'BSE Board Meeting + Yahoo Calendar';
  }

  const entry: CachedStockCatalyst = {
    symbol: sym,
    companyName: companyName || sym,
    bseScripCode: bseData.scripCode,
    nextResultDate,
    isResultEstimate: !bseData.boardResultDate,
    resultSource,
    news7D,
    announcements: bseData.items,
    fetchedAtUtc: new Date().toISOString(),
  };

  const latestCache = loadCatalystCache();
  latestCache.bySymbol[sym] = entry;
  atomicWriteJson(catalystsCachePath(), latestCache);

  return buildStockCatalystProfile({
    row,
    fund,
    cached: entry,
    bulkBlockStore: bulkStore,
    refIso,
  });
}

export function buildCatalystScreener(params: {
  rows: ScreenerRow[];
  fundamentalsBySymbol: Map<string, FundamentalProfile>;
  refIso: string;
  priority?: string;
  gate?: string;
  q?: string;
  onlyWithDeals?: boolean;
  onlyOrderWins?: boolean;
  limit?: number;
  offset?: number;
}): CatalystScreenerResponse {
  const cache = loadCatalystCache();
  const bulkStore = loadBulkBlockStore();

  const profiles = params.rows.map((row) =>
    buildStockCatalystProfile({
      row,
      fund: params.fundamentalsBySymbol.get(row.symbol),
      cached: cache.bySymbol[row.symbol],
      bulkBlockStore: bulkStore,
      refIso: params.refIso,
    })
  );

  const within1m = profiles.filter((p) => p.resultPriority === 'WITHIN_1M').length;
  const within2m = profiles.filter((p) => p.resultPriority === 'WITHIN_2M').length;
  const within3m = profiles.filter((p) => p.resultPriority === 'WITHIN_3M').length;

  const gateCounts = {
    passObservation: profiles.filter((p) => p.rejectionGate === 'PASS_OBSERVATION').length,
    rejectNegativeResult: profiles.filter((p) => p.rejectionGate === 'REJECT_NEGATIVE_RESULT').length,
    rejectNegativeDeals: profiles.filter((p) => p.rejectionGate === 'REJECT_NEGATIVE_DEALS').length,
    rejectNo3mResult: profiles.filter((p) => p.rejectionGate === 'REJECT_NO_3M_RESULT').length,
    pendingVerification: profiles.filter((p) => p.rejectionGate === 'PENDING_VERIFICATION').length,
  };

  let filtered = profiles;
  const q = (params.q || '').trim().toUpperCase();
  if (q) {
    filtered = filtered.filter(
      (p) =>
        p.symbol.includes(q) ||
        p.companyName.toUpperCase().includes(q) ||
        p.sector.toUpperCase().includes(q)
    );
  }

  const prio = (params.priority || 'UPCOMING_3M').toUpperCase();
  if (prio === 'UPCOMING_3M') {
    filtered = filtered.filter(
      (p) =>
        p.resultPriority === 'WITHIN_1M' ||
        p.resultPriority === 'WITHIN_2M' ||
        p.resultPriority === 'WITHIN_3M'
    );
  } else if (prio !== 'ALL') {
    filtered = filtered.filter((p) => p.resultPriority === prio);
  }

  const gate = (params.gate || 'ALL').toUpperCase();
  if (gate === 'OBSERVATION') {
    filtered = filtered.filter((p) => p.rejectionGate === 'PASS_OBSERVATION');
  } else if (gate === 'REJECTED') {
    filtered = filtered.filter(
      (p) =>
        p.rejectionGate === 'REJECT_NEGATIVE_RESULT' ||
        p.rejectionGate === 'REJECT_NEGATIVE_DEALS' ||
        p.rejectionGate === 'REJECT_NO_3M_RESULT'
    );
  } else if (gate !== 'ALL') {
    filtered = filtered.filter((p) => p.rejectionGate === gate);
  }

  if (params.onlyWithDeals) {
    filtered = filtered.filter((p) => p.bulkBlock30D.totalDeals > 0);
  }
  if (params.onlyOrderWins) {
    filtered = filtered.filter((p) => p.orderWinsCount > 0);
  }

  const prioRank: Record<ResultPriorityTier, number> = {
    WITHIN_1M: 0,
    WITHIN_2M: 1,
    WITHIN_3M: 2,
    BEYOND_3M: 3,
    UNSCHEDULED: 4,
  };
  const gateRank: Record<RejectionGateVerdict, number> = {
    PASS_OBSERVATION: 0,
    PENDING_VERIFICATION: 1,
    REJECT_NEGATIVE_DEALS: 2,
    REJECT_NEGATIVE_RESULT: 3,
    REJECT_NO_3M_RESULT: 4,
  };

  const sorted = [...filtered].sort((a, b) => {
    const pDiff = prioRank[a.resultPriority] - prioRank[b.resultPriority];
    if (pDiff !== 0) return pDiff;
    const gDiff = gateRank[a.rejectionGate] - gateRank[b.rejectionGate];
    if (gDiff !== 0) return gDiff;
    const dA = a.daysToResult ?? 9999;
    const dB = b.daysToResult ?? 9999;
    if (dA !== dB) return dA - dB;
    return (b.rvol ?? -1) - (a.rvol ?? -1);
  });

  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));

  const cleanWindowDeals = mergeAndDeduplicateBulkBlockDeals(
    [],
    filterDealsWithin30Days(bulkStore.deals, params.refIso, 30),
    params.refIso
  );
  const distinctDates = Array.from(new Set(cleanWindowDeals.map((d) => d.date))).sort();
  const symbolsWithDeals = new Set(cleanWindowDeals.map((d) => d.symbol)).size;
  const oldestDealDate = distinctDates[0] || '';
  const latestDealDate = distinctDates[distinctDates.length - 1] || '';

  return {
    asOfDate: params.refIso,
    priorityCounts: {
      within1m,
      within2m,
      within3m,
      total3m: within1m + within2m + within3m,
    },
    gateCounts,
    bulkBlockStats: {
      available: cleanWindowDeals.length > 0,
      totalDeals30D: cleanWindowDeals.length,
      symbolsWithDeals,
      distinctDatesCount: distinctDates.length,
      oldestDealDate,
      latestDealDate,
      lastSyncedUtc: bulkStore.lastSyncedUtc,
      note:
        cleanWindowDeals.length > 0
          ? `NSE Bulk & Block rolling 30D archive (${cleanWindowDeals.length} unique deals across ${symbolsWithDeals} stocks · ${distinctDates.length} trading days: ${oldestDealDate} to ${latestDealDate})`
          : 'Click Sync 3M Results & 30D Bulk/Block to load live NSE 30D Bulk & Block archive',
    },
    calendarStats: {
      scheduledUpcomingCount: within1m + within2m + within3m,
      lastSyncedUtc: cache.lastUniverseQuoteSyncUtc || universeQuoteScanState.lastSyncedUtc,
      scanning: universeQuoteScanState.running,
      processed: universeQuoteScanState.processed,
      total: universeQuoteScanState.total,
    },
    rows: sorted.slice(offset, offset + limit),
    total: sorted.length,
  };
}

export function getUpcomingResultObservationList(params: {
  rows: ScreenerRow[];
  fundamentalsBySymbol: Map<string, FundamentalProfile>;
  refIso: string;
  window?: string;
  polarity?: string;
  swingOnly?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}): UpcomingResultObservationResponse {
  const cache = loadCatalystCache();
  const bulkStore = loadBulkBlockStore();
  const refIso = params.refIso;

  const allUpcoming: UpcomingResultStockItem[] = [];
  for (const row of params.rows) {
    const fund = params.fundamentalsBySymbol.get(row.symbol);
    const cached = cache.bySymbol[row.symbol];
    const candidateDates = [cached?.nextResultDate, row.nextEarningsDate, fund?.nextEarningsDate]
      .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= refIso))
      .sort((a, b) => a.localeCompare(b));
    const nextResultDate = candidateDates[0] || '';
    if (!nextResultDate) continue;

    const { tier, daysToResult } = computeResultPriorityTier(nextResultDate, refIso);
    if (daysToResult === null || daysToResult < 0) continue;

    const { polarity, reason } = evaluate3MonthResultPolarity(fund);
    const bulkBlock30D = getBulkBlock30DSummaryForSymbol(row.symbol, bulkStore, refIso);
    const gate = evaluateRejectionGate({
      priority: tier,
      polarity,
      polarityReason: reason,
      bulkBlock30D,
    });

    allUpcoming.push({
      symbol: row.symbol,
      companyName: cached?.companyName || row.companyName || fund?.companyName || row.symbol,
      sector: row.providerSector || (row.isIpo ? 'IPO / Recent Listings' : ''),
      isIpo: row.isIpo,
      marketCapCr: row.marketCapCr,
      marketCapCategory: row.marketCapCategory,
      nextResultDate,
      daysToResult,
      resultPriority: tier,
      resultSource: cached?.resultSource || 'Yahoo Finance Calendar',
      isResultEstimate: cached?.isResultEstimate ?? true,
      resultPolarity3M: polarity,
      result3MReason: reason,
      rejectionGate: gate.verdict,
      profitGrowthPct: fund?.profitGrowthPct ?? null,
      revenueGrowthPct: fund?.revenueGrowthPct ?? null,
      epsPrev: fund?.epsPrev ?? null,
      epsCurr: fund?.epsCurr ?? null,
      closePrice: row.closePrice,
      changePct: row.changePct,
      swingTier: row.swingTier,
      deliveryCategory: row.deliveryCategory,
      delivPer: row.delivPer,
      rvol: row.rvol,
      delivQtyRatio: row.delivQtyRatio,
      ema21AboveEma44: row.ema21AboveEma44,
      ema21Cross44Bullish: row.ema21Cross44Bullish,
      uTurnStatus: row.uTurnStatus,
      fundamentalCoverage: row.fundamentalCoverage,
      fundamentalFreshness: row.fundamentalFreshness,
      bulkBlockNetCr: bulkBlock30D.netValueCr,
      bulkBlockDealsCount: bulkBlock30D.totalDeals,
    });
  }

  allUpcoming.sort((a, b) => {
    if (a.daysToResult !== b.daysToResult) return a.daysToResult - b.daysToResult;
    return (b.rvol ?? -1) - (a.rvol ?? -1);
  });

  const isSwingOrAB = (item: UpcomingResultStockItem) =>
    item.swingTier !== 'NONE' ||
    item.deliveryCategory === 'A_AND_B' ||
    item.deliveryCategory === 'A_ONLY' ||
    item.deliveryCategory === 'B_ONLY';

  const counts = {
    within1m: allUpcoming.filter((i) => i.resultPriority === 'WITHIN_1M').length,
    within2m: allUpcoming.filter((i) => i.resultPriority === 'WITHIN_2M').length,
    within3m: allUpcoming.filter((i) => i.resultPriority === 'WITHIN_3M').length,
    beyond3m: allUpcoming.filter((i) => i.resultPriority === 'BEYOND_3M').length,
    positive3m: allUpcoming.filter((i) => i.resultPolarity3M === 'POSITIVE').length,
    negative3m: allUpcoming.filter((i) => i.resultPolarity3M === 'NEGATIVE').length,
    unknown3m: allUpcoming.filter((i) => i.resultPolarity3M === 'UNKNOWN').length,
    swingOrDelivAb: allUpcoming.filter(isSwingOrAB).length,
  };

  let filtered = allUpcoming;
  const q = (params.q || '').trim().toUpperCase();
  if (q) {
    filtered = filtered.filter(
      (i) =>
        i.symbol.includes(q) ||
        i.companyName.toUpperCase().includes(q) ||
        i.sector.toUpperCase().includes(q)
    );
  }

  const win = (params.window || 'ALL').toUpperCase();
  if (win === 'WITHIN_1M') {
    filtered = filtered.filter((i) => i.daysToResult <= 30);
  } else if (win === 'WITHIN_2M') {
    filtered = filtered.filter((i) => i.daysToResult <= 60);
  } else if (win === 'WITHIN_3M' || win === 'UPCOMING_3M') {
    filtered = filtered.filter((i) => i.daysToResult <= 90);
  } else if (win === 'BEYOND_3M') {
    filtered = filtered.filter((i) => i.daysToResult > 90);
  }

  const pol = (params.polarity || 'ALL').toUpperCase();
  if (pol === 'POSITIVE' || pol === 'NEGATIVE' || pol === 'UNKNOWN') {
    filtered = filtered.filter((i) => i.resultPolarity3M === pol);
  }

  if (params.swingOnly) {
    filtered = filtered.filter(isSwingOrAB);
  }

  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(300, Math.max(1, params.limit ?? 100));

  return {
    asOfDate: refIso,
    totalUpcoming: allUpcoming.length,
    total: filtered.length,
    counts,
    items: filtered.slice(offset, offset + limit),
  };
}
