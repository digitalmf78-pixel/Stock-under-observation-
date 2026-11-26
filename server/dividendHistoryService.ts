import fs from 'node:fs';
import path from 'node:path';
import type { DividendHistoryResponse, DividendYearPoint } from '../src/types/trading.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedDividendEntry {
  cachedAtMs: number;
  payload: DividendHistoryResponse;
}

let writeQueue: Promise<void> = Promise.resolve();

function cacheFilePath(): string {
  return path.resolve(process.cwd(), 'data', 'cache', 'dividend_history_cache.json');
}

function loadCache(): Record<string, CachedDividendEntry> {
  const file = cacheFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, CachedDividendEntry>)
      : {};
  } catch {
    return {};
  }
}

async function saveCacheEntry(symbol: string, payload: DividendHistoryResponse): Promise<void> {
  const cache = loadCache();
  cache[symbol] = { cachedAtMs: Date.now(), payload };
  const op = writeQueue.then(() => {
    const file = cacheFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf-8');
    fs.renameSync(tmp, file);
  });
  writeQueue = op.catch(() => {});
  await op;
}

function toIstIso(unixSec: number): string {
  return new Date((unixSec + 19800) * 1000).toISOString().slice(0, 10);
}

function cleanText(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNum(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,%Cr,\s]/gi, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === 'N/A') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function periodHeaderToIso(label: string): string {
  const m = label.trim().match(/^([A-Za-z]{3})[\s-]+(\d{2,4})$/);
  if (!m) return '';
  const monMap: Record<string, string> = {
    JAN: '01-31',
    FEB: '02-28',
    MAR: '03-31',
    APR: '04-30',
    MAY: '05-31',
    JUN: '06-30',
    JUL: '07-31',
    AUG: '08-31',
    SEP: '09-30',
    OCT: '10-31',
    NOV: '11-30',
    DEC: '12-31',
  };
  const mmdd = monMap[m[1].toUpperCase()];
  if (!mmdd) return '';
  const yr = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${yr}-${mmdd}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function subtractOneYearPlusOneDay(endIso: string): string {
  const d = new Date(`${endIso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface ScreenerDividendColumns {
  fyColumns: Array<{
    label: string;
    fyEndIso: string;
    epsInr: number | null;
    payoutPct: number | null;
  }>;
  sourceFound: boolean;
}

async function fetchScreenerPayoutColumns(symbol: string): Promise<ScreenerDividendColumns> {
  const sym = encodeURIComponent(symbol.trim().toUpperCase());
  const urls = [
    `https://www.screener.in/company/${sym}/consolidated/`,
    `https://www.screener.in/company/${sym}/`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const secMatch = html.match(/<section[^>]*id="profit-loss"[\s\S]*?<\/section>/i);
      if (!secMatch) continue;
      const section = secMatch[0];
      const tableMatch = section.match(/<table[\s\S]*?<\/table>/i);
      if (!tableMatch) continue;
      const tableHtml = tableMatch[0];

      const headerMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
      if (!headerMatch) continue;
      const headers = [...headerMatch[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
        cleanText(m[1])
      );

      const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i);
      if (!tbodyMatch) continue;

      let epsCells: string[] | null = null;
      let payoutCells: string[] | null = null;

      for (const tr of tbodyMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
        const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
          cleanText(m[1])
        );
        if (cells.length < 2) continue;
        const rowTitle = cells[0].toLowerCase().replace(/\s*\+\s*$/, '').trim();
        if (rowTitle.includes('eps in rs') && !epsCells) {
          epsCells = cells;
        } else if (rowTitle.includes('dividend payout') && !payoutCells) {
          payoutCells = cells;
        }
      }

      const fyIndices: Array<{ idx: number; label: string; fyEndIso: string }> = [];
      for (let i = 1; i < headers.length; i++) {
        const h = headers[i];
        if (!/^[A-Za-z]{3}\s+\d{4}$/.test(h)) continue;
        const iso = periodHeaderToIso(h);
        if (iso) fyIndices.push({ idx: i, label: h, fyEndIso: iso });
      }

      const last5 = fyIndices.slice(-5);
      if (last5.length === 0) continue;

      // Require at least one valid EPS or Payout entry before accepting consolidated over standalone
      const cols = last5.map((col) => ({
        label: col.label,
        fyEndIso: col.fyEndIso,
        epsInr: epsCells ? parseNum(epsCells[col.idx]) : null,
        payoutPct: payoutCells ? parseNum(payoutCells[col.idx]) : null,
      }));
      const hasAnyData = cols.some((c) => c.epsInr !== null || c.payoutPct !== null);
      if (!hasAnyData) continue;

      return {
        fyColumns: cols,
        sourceFound: true,
      };
    } catch {
      // try next url
    }
  }

  return { fyColumns: [], sourceFound: false };
}

interface Yahoo5YData {
  bars: Array<{ date: string; close: number; adjClose: number }>;
  dividends: Array<{ exDate: string; amountInr: number }>;
  longName: string;
}

async function fetchYahoo5YPricesAndDividends(symbol: string): Promise<Yahoo5YData | null> {
  const cleanSym = symbol.trim().toUpperCase();
  const candidates = [`${cleanSym}.NS`, `${cleanSym}.BO`];

  for (const ticker of candidates) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        ticker
      )}?range=10y&interval=1mo&events=div`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;

      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { longName?: string; shortName?: string };
            timestamp?: number[];
            events?: {
              dividends?: Record<string, { amount?: number; date?: number }>;
            };
            indicators?: {
              quote?: Array<{ close?: Array<number | null> }>;
              adjclose?: Array<{ adjclose?: Array<number | null> }>;
            };
          }>;
        };
      };

      const result = json.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const adjCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
      if (ts.length === 0 || closes.length === 0) continue;

      const barMap = new Map<string, { date: string; close: number; adjClose: number }>();
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
        const adj = adjCloses[i];
        const validAdj =
          typeof adj === 'number' && Number.isFinite(adj) && adj > 0 ? adj : c;
        const date = toIstIso(ts[i]);
        barMap.set(date, { date, close: c, adjClose: validAdj });
      }
      const bars = Array.from(barMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      if (bars.length < 3) continue;

      const rawDivs = Object.values(result?.events?.dividends ?? {});
      const dividends = rawDivs
        .filter(
          (d) =>
            typeof d.amount === 'number' &&
            Number.isFinite(d.amount) &&
            d.amount > 0 &&
            typeof d.date === 'number' &&
            Number.isFinite(d.date)
        )
        .map((d) => ({
          exDate: toIstIso(d.date as number),
          amountInr: Number((d.amount as number).toFixed(2)),
        }))
        .sort((a, b) => a.exDate.localeCompare(b.exDate));

      return {
        bars,
        dividends,
        longName: result?.meta?.longName || result?.meta?.shortName || cleanSym,
      };
    } catch {
      // try next suffix
    }
  }
  return null;
}

function buildFallbackFyColumns(latestBarDate: string): ScreenerDividendColumns['fyColumns'] {
  const [yrStr, moStr] = latestBarDate.split('-');
  const yr = Number(yrStr) || new Date().getUTCFullYear();
  const mo = Number(moStr) || 3;
  const latestMarYear = mo >= 4 ? yr + 1 : yr;
  const cols: ScreenerDividendColumns['fyColumns'] = [];
  for (let y = latestMarYear - 4; y <= latestMarYear; y++) {
    cols.push({
      label: `Mar ${y}`,
      fyEndIso: `${y}-03-31`,
      epsInr: null,
      payoutPct: null,
    });
  }
  return cols;
}

export async function fetch5YearDividendHistory(
  symbol: string,
  options?: { companyName?: string; forceRefresh?: boolean }
): Promise<DividendHistoryResponse> {
  const sym = symbol.trim().toUpperCase();
  const cache = loadCache();
  const cached = cache[sym];
  if (
    !options?.forceRefresh &&
    cached &&
    Date.now() - cached.cachedAtMs < CACHE_TTL_MS &&
    cached.payload?.years?.length > 0
  ) {
    return cached.payload;
  }

  const [screenerData, yahooData] = await Promise.all([
    fetchScreenerPayoutColumns(sym),
    fetchYahoo5YPricesAndDividends(sym),
  ]);

  const bars = yahooData?.bars ?? [];
  const latestBarDate =
    bars.length > 0 ? bars[bars.length - 1].date : new Date().toISOString().slice(0, 10);

  const fyCols =
    screenerData.fyColumns.length > 0
      ? screenerData.fyColumns
      : buildFallbackFyColumns(latestBarDate);

  // Determine anchor baseline before FY[0] start (for 5-year Base-100 & Year 0 return)
  const firstFyStartIso = subtractOneYearPlusOneDay(fyCols[0].fyEndIso);
  let anchorBar =
    [...bars].reverse().find((b) => b.date <= firstFyStartIso) ?? bars[0] ?? null;

  let prevFyEndIso = addDaysIso(firstFyStartIso, -1);
  let prevClose = anchorBar?.close ?? null;

  const years: DividendYearPoint[] = [];

  for (let i = 0; i < fyCols.length; i++) {
    const col = fyCols[i];
    const startIso = addDaysIso(prevFyEndIso, 1);
    const endIso = col.fyEndIso;

    // Last monthly bar on or before FY end (within or up to endIso)
    const barAtEnd =
      [...bars].reverse().find((b) => b.date <= endIso && b.date >= startIso) ??
      [...bars].reverse().find((b) => b.date <= endIso) ??
      (i === fyCols.length - 1 && bars.length > 0 ? bars[bars.length - 1] : null);

    const fyEndPriceInr = barAtEnd ? Number(barAtEnd.close.toFixed(2)) : null;
    const fyEndAdjClose = barAtEnd ? barAtEnd.adjClose : null;

    if (!anchorBar && barAtEnd) {
      anchorBar = barAtEnd;
    }

    const annualReturnPct =
      fyEndPriceInr !== null && prevClose !== null && prevClose > 0
        ? Number((((fyEndPriceInr - prevClose) / prevClose) * 100).toFixed(1))
        : null;

    const cumulativePerfBase100 =
      fyEndPriceInr !== null && anchorBar && anchorBar.close > 0
        ? Number(((fyEndPriceInr / anchorBar.close) * 100).toFixed(1))
        : null;

    const totalReturnBase100 =
      fyEndAdjClose !== null && anchorBar && anchorBar.adjClose > 0
        ? Number(((fyEndAdjClose / anchorBar.adjClose) * 100).toFixed(1))
        : null;

    // Sum cash dividends with exDate in (prevFyEndIso, endIso]
    let dividendPerShareInr: number | null = null;
    if (yahooData) {
      const fyDivs = yahooData.dividends.filter(
        (d) => d.exDate > prevFyEndIso && d.exDate <= endIso
      );
      dividendPerShareInr = Number(
        fyDivs.reduce((sum, d) => sum + d.amountInr, 0).toFixed(2)
      );
    }

    let payoutRatioPct: number | null = col.payoutPct;
    let payoutSource: DividendYearPoint['payoutSource'] =
      col.payoutPct !== null ? 'Screener.in' : 'Unavailable';

    if (
      payoutRatioPct === null &&
      dividendPerShareInr !== null &&
      col.epsInr !== null &&
      col.epsInr > 0
    ) {
      payoutRatioPct = Number(((dividendPerShareInr / col.epsInr) * 100).toFixed(1));
      payoutSource = 'Derived (DPS/EPS)';
    }

    const dividendYieldOnClosePct =
      dividendPerShareInr !== null && fyEndPriceInr !== null && fyEndPriceInr > 0
        ? Number(((dividendPerShareInr / fyEndPriceInr) * 100).toFixed(2))
        : null;

    const yrMatch = col.label.match(/(\d{4})/);
    const yr2 = yrMatch ? yrMatch[1].slice(-2) : String(i + 1);

    years.push({
      fyLabel: `FY${yr2} (${col.label})`,
      shortLabel: `FY${yr2}`,
      fyEndIso: endIso,
      payoutRatioPct,
      dividendPerShareInr,
      epsInr: col.epsInr,
      fyEndPriceInr,
      annualReturnPct,
      cumulativePerfBase100,
      totalReturnBase100,
      dividendYieldOnClosePct,
      payoutSource,
    });

    prevFyEndIso = endIso;
    if (fyEndPriceInr !== null) {
      prevClose = fyEndPriceInr;
    }
  }

  // Summary metrics
  const validPayouts = years
    .map((y) => y.payoutRatioPct)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const avgPayoutRatio5yPct =
    validPayouts.length > 0
      ? Number(
          (validPayouts.reduce((a, b) => a + b, 0) / validPayouts.length).toFixed(1)
        )
      : null;

  const totalDividends5yInr = Number(
    years
      .reduce((sum, y) => sum + (y.dividendPerShareInr ?? 0), 0)
      .toFixed(2)
  );

  const consecutivePayingYears = years.filter(
    (y) => (y.dividendPerShareInr ?? 0) > 0 || (y.payoutRatioPct ?? 0) > 0
  ).length;

  const lastYear = years[years.length - 1];
  const priceSpanYears = Math.max(1, years.length);
  const priceCagr5yPct =
    lastYear?.cumulativePerfBase100 !== null &&
    lastYear?.cumulativePerfBase100 !== undefined &&
    lastYear.cumulativePerfBase100 > 0
      ? Number(
          ((Math.pow(lastYear.cumulativePerfBase100 / 100, 1 / priceSpanYears) - 1) * 100).toFixed(
            1
          )
        )
      : null;

  const totalReturnCagr5yPct =
    lastYear?.totalReturnBase100 !== null &&
    lastYear?.totalReturnBase100 !== undefined &&
    lastYear.totalReturnBase100 > 0
      ? Number(
          ((Math.pow(lastYear.totalReturnBase100 / 100, 1 / priceSpanYears) - 1) * 100).toFixed(
            1
          )
        )
      : null;

  const firstDps = years[0]?.dividendPerShareInr ?? null;
  const lastDps = lastYear?.dividendPerShareInr ?? null;
  const dividendCagrPct =
    firstDps !== null &&
    lastDps !== null &&
    firstDps > 0 &&
    lastDps > 0 &&
    years.length >= 2
      ? Number(
          ((Math.pow(lastDps / firstDps, 1 / (years.length - 1)) - 1) * 100).toFixed(1)
        )
      : null;

  const payoutConsistencyLabel =
    consecutivePayingYears >= 5 && (avgPayoutRatio5yPct ?? 0) >= 35
      ? 'Consistent High-Payout'
      : consecutivePayingYears >= 5
        ? 'Consistent Dividend Payer'
        : consecutivePayingYears >= 3
          ? 'Regular Payer'
          : consecutivePayingYears >= 1
            ? 'Occasional Payer'
            : 'Non-Dividend / Reinvesting';

  const sources: string[] = [];
  if (screenerData.sourceFound) sources.push('Screener.in (Annual P&L)');
  if (yahooData) sources.push('Yahoo Finance (5Y Prices & Div Events)');

  const payload: DividendHistoryResponse = {
    symbol: sym,
    companyName: options?.companyName || yahooData?.longName || sym,
    years,
    recentEvents: (yahooData?.dividends ?? []).slice(-10).reverse(),
    summary: {
      avgPayoutRatio5yPct,
      totalDividends5yInr,
      consecutivePayingYears,
      priceCagr5yPct,
      totalReturnCagr5yPct,
      dividendCagrPct,
      latestDividendYieldPct: lastYear?.dividendYieldOnClosePct ?? null,
      payoutConsistencyLabel,
    },
    sources,
    fetchedAtUtc: new Date().toISOString(),
  };

  if (sources.length > 0) {
    await saveCacheEntry(sym, payload);
  }

  return payload;
}
