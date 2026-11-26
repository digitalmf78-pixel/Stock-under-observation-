import fs from 'node:fs';
import path from 'node:path';
import type {
  MacroNewsDashboardResponse,
  MacroNewsItem,
  MarketRegimeSnapshot,
  NewsImpactCategory,
  ScreenerRow,
  SectorNewsImpactSummary,
} from '../src/types/trading.ts';
import { calculateLatestEma } from './technicalIndicators.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface YahooMacroSeries {
  available: boolean;
  latestPrice: number | null;
  prevClose: number | null;
  changePct: number | null;
  return1mPct: number | null;
  return1wPct: number | null;
  aboveEma20: boolean | null;
  asOfDate: string;
  source: string;
  error?: string;
}

const MACRO_CACHE_TTL_MS = 10 * 60 * 1000;
let cachedDashboard: { fetchedAt: number; data: MacroNewsDashboardResponse } | null = null;

function toIso(unixSec: number): string {
  return new Date((unixSec + 19800) * 1000).toISOString().slice(0, 10);
}

export async function fetchYahooMacroSeries(
  ticker: string,
  label: string,
  fetchFn: typeof fetch = fetch
): Promise<YahooMacroSeries> {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastError = '';

  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
      const res = await fetchFn(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number };
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const result = json.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
      const points: Array<{ date: string; close: number }> = [];
      for (let i = 0; i < ts.length; i++) {
        const c = rawCloses[i];
        if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
          points.push({ date: toIso(ts[i]), close: c });
        }
      }

      const metaPrice =
        typeof result?.meta?.regularMarketPrice === 'number' &&
        Number.isFinite(result.meta.regularMarketPrice) &&
        result.meta.regularMarketPrice > 0
          ? result.meta.regularMarketPrice
          : null;

      const latestBar = points[points.length - 1];
      const latestPrice = metaPrice ?? latestBar?.close ?? null;
      if (latestPrice === null) {
        lastError = 'No valid close or regularMarketPrice';
        continue;
      }

      const prevClose =
        points.length >= 2
          ? points[points.length - 2].close
          : typeof result?.meta?.previousClose === 'number' && result.meta.previousClose > 0
            ? result.meta.previousClose
            : typeof result?.meta?.chartPreviousClose === 'number' && result.meta.chartPreviousClose > 0
              ? result.meta.chartPreviousClose
              : null;
      const changePct =
        prevClose && prevClose > 0 ? ((latestPrice - prevClose) / prevClose) * 100 : null;
      const base1w = points.length >= 6 ? points[points.length - 6].close : null;
      const return1wPct = base1w && base1w > 0 ? ((latestPrice - base1w) / base1w) * 100 : null;
      const base1m =
        points.length >= 22 ? points[points.length - 22].close : points[0]?.close ?? null;
      const return1mPct = base1m && base1m > 0 ? ((latestPrice - base1m) / base1m) * 100 : null;

      const ema20 = calculateLatestEma(
        points.map((p) => p.close),
        20
      );
      const aboveEma20 = ema20 !== null ? latestPrice > ema20 : null;

      return {
        available: true,
        latestPrice: Number(latestPrice.toFixed(2)),
        prevClose: prevClose !== null ? Number(prevClose.toFixed(2)) : null,
        changePct: changePct !== null ? Number(changePct.toFixed(2)) : null,
        return1mPct: return1mPct !== null ? Number(return1mPct.toFixed(2)) : null,
        return1wPct: return1wPct !== null ? Number(return1wPct.toFixed(2)) : null,
        aboveEma20,
        asOfDate: latestBar?.date || new Date().toISOString().slice(0, 10),
        source: `Yahoo Finance (${ticker})`,
      };
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  return {
    available: false,
    latestPrice: null,
    prevClose: null,
    changePct: null,
    return1mPct: null,
    return1wPct: null,
    aboveEma20: null,
    asOfDate: '',
    source: `${label} (Yahoo Finance ${ticker})`,
    error: lastError || 'Unavailable',
  };
}

export async function fetchNifty50MacroSeries(
  fetchFn: typeof fetch = fetch
): Promise<YahooMacroSeries> {
  const yahoo = await fetchYahooMacroSeries('^NSEI', 'Nifty 50', fetchFn);
  if (yahoo.available && yahoo.latestPrice !== null && yahoo.latestPrice > 0) {
    return yahoo;
  }

  try {
    const res = await fetchFn('https://www.nseindia.com/api/allIndices', {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Referer: 'https://www.nseindia.com/',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{
          index?: string;
          indexSymbol?: string;
          last?: number;
          previousClose?: number;
          percentChange?: number;
        }>;
      };
      const row = (json.data || []).find(
        (d) =>
          (d.index || '').trim().toUpperCase() === 'NIFTY 50' ||
          (d.indexSymbol || '').trim().toUpperCase() === 'NIFTY 50'
      );
      if (row && typeof row.last === 'number' && Number.isFinite(row.last) && row.last > 0) {
        const prev =
          typeof row.previousClose === 'number' && Number.isFinite(row.previousClose)
            ? row.previousClose
            : null;
        const chg =
          typeof row.percentChange === 'number' && Number.isFinite(row.percentChange)
            ? row.percentChange
            : prev && prev > 0
              ? ((row.last - prev) / prev) * 100
              : null;
        return {
          available: true,
          latestPrice: Number(row.last.toFixed(2)),
          prevClose: prev !== null ? Number(prev.toFixed(2)) : null,
          changePct: chg !== null ? Number(chg.toFixed(2)) : null,
          return1mPct: null,
          return1wPct: null,
          aboveEma20: null,
          asOfDate: new Date().toISOString().slice(0, 10),
          source: 'NSE India (allIndices NIFTY 50)',
        };
      }
    }
  } catch {
    // preserve yahoo failure response below
  }

  return yahoo;
}

async function fetchNseFiiDiiAggregate(): Promise<MarketRegimeSnapshot['fiiDiiDaily']> {
  const tryFetchJson = async (cookie?: string) => {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://www.nseindia.com/',
    };
    if (cookie) headers.Cookie = cookie;
    return fetch('https://www.nseindia.com/api/fiidiiTradeReact', {
      headers,
      signal: AbortSignal.timeout(5000),
    });
  };

  try {
    let res = await tryFetchJson();
    if (!res.ok) {
      try {
        const home = await fetch('https://www.nseindia.com', {
          headers: { 'User-Agent': UA, Accept: 'text/html' },
          signal: AbortSignal.timeout(3500),
        });
        const setCookies =
          typeof home.headers.getSetCookie === 'function'
            ? home.headers.getSetCookie()
            : [home.headers.get('set-cookie')].filter((x): x is string => Boolean(x));
        const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
        if (cookie) res = await tryFetchJson(cookie);
      } catch {
        // keep original status
      }
    }

    if (!res.ok) {
      return {
        available: false,
        fiiNetCr: null,
        diiNetCr: null,
        status: 'DATA NOT AVAILABLE',
        source: 'NSE fiidiiTradeReact',
        note: `DATA NOT AVAILABLE (NSE HTTP ${res.status} — no fake values substituted)`,
      };
    }
    const rows = (await res.json()) as Array<{ category?: string; date?: string; netValue?: string }>;
    let fiiNet: number | null = null;
    let diiNet: number | null = null;
    let tradeDate = '';
    for (const r of Array.isArray(rows) ? rows : []) {
      const cat = (r.category || '').toUpperCase();
      const val = Number(String(r.netValue || '').replace(/,/g, ''));
      if (r.date && !tradeDate) tradeDate = r.date;
      if (!Number.isFinite(val)) continue;
      if (cat.includes('FII') || cat.includes('FPI')) fiiNet = val;
      if (cat.includes('DII')) diiNet = val;
    }
    if (fiiNet === null && diiNet === null) {
      return {
        available: false,
        fiiNetCr: null,
        diiNetCr: null,
        status: 'DATA NOT AVAILABLE',
        source: 'NSE fiidiiTradeReact',
        note: 'DATA NOT AVAILABLE (empty NSE aggregate response)',
      };
    }
    const bothSellers = fiiNet !== null && diiNet !== null && fiiNet < 0 && diiNet < 0;
    return {
      available: true,
      fiiNetCr: fiiNet,
      diiNetCr: diiNet,
      status: bothSellers ? 'BOTH_SELLERS_STOP' : 'OK',
      source: `NSE fiidiiTradeReact${tradeDate ? ` (${tradeDate})` : ''}`,
      note: bothSellers
        ? `STOP: FII (${fiiNet} Cr) & DII (${diiNet} Cr) both net sellers (${tradeDate})`
        : `FII Net ${fiiNet !== null && fiiNet >= 0 ? '+' : ''}₹${fiiNet ?? '—'} Cr · DII Net ${diiNet !== null && diiNet >= 0 ? '+' : ''}₹${diiNet ?? '—'} Cr (${tradeDate || 'Latest'})`,
    };
  } catch {
    return {
      available: false,
      fiiNetCr: null,
      diiNetCr: null,
      status: 'DATA NOT AVAILABLE',
      source: 'NSE fiidiiTradeReact',
      note: 'DATA NOT AVAILABLE (NSE endpoint unreachable from server IP — never fabricated)',
    };
  }
}

function formatDdmmyyyyIst(dateObj: Date): string {
  const ist = new Date(dateObj.getTime() + 19800 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(ist.getUTCFullYear());
  return `${dd}${mm}${yyyy}`;
}

async function fetchFaoParticipantFiiRatioForDate(
  ddmmyyyy: string
): Promise<{ dateTag: string; ratio: number; longPct: number; longContracts: number; shortContracts: number } | null> {
  try {
    const url = `https://archives.nseindia.com/content/nsccl/fao_participant_oi_${ddmmyyyy}.csv`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,text/plain,*/*' },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trimStart().startsWith('<')) return null;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cols[0]?.toUpperCase() === 'FII' && cols.length >= 3) {
        const longIdx = Number(cols[1].replace(/,/g, ''));
        const shortIdx = Number(cols[2].replace(/,/g, ''));
        if (Number.isFinite(longIdx) && Number.isFinite(shortIdx) && longIdx + shortIdx > 0) {
          const ratio = shortIdx > 0 ? Number((longIdx / shortIdx).toFixed(2)) : 99;
          const longPct = Number(((longIdx / (longIdx + shortIdx)) * 100).toFixed(1));
          return {
            dateTag: `${ddmmyyyy.slice(0, 2)}-${ddmmyyyy.slice(2, 4)}-${ddmmyyyy.slice(4)}`,
            ratio,
            longPct,
            longContracts: longIdx,
            shortContracts: shortIdx,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchNseFiiLongShortRatio(): Promise<MarketRegimeSnapshot['fiiLongShortRatio']> {
  try {
    const now = Date.now();
    let latest: Awaited<ReturnType<typeof fetchFaoParticipantFiiRatioForDate>> = null;
    let latestOffsetDays = 0;

    for (let d = 0; d <= 6; d++) {
      const tag = formatDdmmyyyyIst(new Date(now - d * 86400_000));
      const parsed = await fetchFaoParticipantFiiRatioForDate(tag);
      if (parsed) {
        latest = parsed;
        latestOffsetDays = d;
        break;
      }
    }

    if (!latest) {
      return {
        available: false,
        value: null,
        status: 'DATA NOT AVAILABLE',
        source: 'NSE F&O Participant OI',
        note: 'DATA NOT AVAILABLE (NSE archive CSV unreachable)',
      };
    }

    let twoWeeksAgo: Awaited<ReturnType<typeof fetchFaoParticipantFiiRatioForDate>> = null;
    for (let d = latestOffsetDays + 14; d <= latestOffsetDays + 19; d++) {
      const tag = formatDdmmyyyyIst(new Date(now - d * 86400_000));
      const parsed = await fetchFaoParticipantFiiRatioForDate(tag);
      if (parsed) {
        twoWeeksAgo = parsed;
        break;
      }
    }

    const falling =
      twoWeeksAgo !== null &&
      (latest.ratio < twoWeeksAgo.ratio * 0.9 || latest.longPct <= twoWeeksAgo.longPct - 3);

    return {
      available: true,
      value: latest.ratio,
      status: falling ? 'FALLING_REDUCE' : 'OK',
      source: `NSE FAO Participant OI (${latest.dateTag})`,
      note: twoWeeksAgo
        ? `FII Index L/S ${latest.ratio}x (${latest.longPct}% Long) vs 2W ago ${twoWeeksAgo.ratio}x (${twoWeeksAgo.longPct}% Long)${falling ? ' — FALLING (Size Reduce)' : ' — Stable/Rising'}`
        : `FII Index L/S ${latest.ratio}x (${latest.longPct}% Long · ${latest.longContracts.toLocaleString('en-IN')}L / ${latest.shortContracts.toLocaleString('en-IN')}S)`,
    };
  } catch {
    return {
      available: false,
      value: null,
      status: 'DATA NOT AVAILABLE',
      source: 'NSE F&O Participant OI',
      note: 'DATA NOT AVAILABLE',
    };
  }
}

function compute200DmaBreadthFromYahooCache(): {
  available: boolean;
  pct: number | null;
  above: number;
  total: number;
} {
  try {
    const file = path.join(process.cwd(), 'data', 'research', 'bot_yahoo_cache.json');
    if (!fs.existsSync(file)) return { available: false, pct: null, above: 0, total: 0 };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
      string,
      { bars?: Array<{ close?: number }> }
    >;
    let total = 0;
    let above = 0;
    for (const entry of Object.values(parsed)) {
      const bars = entry?.bars;
      if (!Array.isArray(bars) || bars.length < 200) continue;
      const last200 = bars.slice(-200);
      const closes = last200.map((b) => b.close ?? 0).filter((c) => c > 0);
      if (closes.length < 200) continue;
      const sma200 = closes.reduce((a, b) => a + b, 0) / 200;
      const lastClose = closes[closes.length - 1];
      total++;
      if (lastClose > sma200) above++;
    }
    if (total < 10) return { available: false, pct: null, above, total };
    return {
      available: true,
      pct: Number(((above / total) * 100).toFixed(1)),
      above,
      total,
    };
  } catch {
    return { available: false, pct: null, above: 0, total: 0 };
  }
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface NewsRule {
  pattern: RegExp;
  category: NewsImpactCategory;
  horizon: 'TEMPORARY' | 'STRUCTURAL';
  matchedRule: string;
  negativeSectors: string[];
  positiveSectors: string[];
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

const NEWS_IMPACT_RULES: NewsRule[] = [
  {
    pattern: /\b(india[- ]pakistan|loc|border tension|airstrike|surgical strike|indo[- ]pak)\b/i,
    category: 'GEOPOLITICAL',
    horizon: 'STRUCTURAL',
    matchedRule: 'India-Pak Tension Matrix',
    negativeSectors: ['Aviation', 'Tourism', 'Consumer Cyclical'],
    positiveSectors: ['Defence', 'Industrials'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(middle east|iran|israel|red sea|hormuz|gaza|houthi|oil war)\b/i,
    category: 'GEOPOLITICAL',
    horizon: 'STRUCTURAL',
    matchedRule: 'Middle East Conflict Matrix',
    negativeSectors: ['Oil Marketing', 'Aviation', 'Chemicals', 'Logistics'],
    positiveSectors: ['Oil Exploration', 'Energy', 'Defence', 'Industrials'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(recession|hard landing|global slowdown|tariff war|trade war)\b/i,
    category: 'GLOBAL_MACRO',
    horizon: 'STRUCTURAL',
    matchedRule: 'Global Recession Fear Matrix',
    negativeSectors: ['Basic Materials', 'Metals', 'Technology', 'Commodities'],
    positiveSectors: ['Consumer Defensive', 'Healthcare'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(rbi.*rate hike|repo rate hike|rbi hawkish|tightening)\b/i,
    category: 'RBI_POLICY',
    horizon: 'STRUCTURAL',
    matchedRule: 'RBI Rate Hike',
    negativeSectors: ['Real Estate', 'Auto', 'NBFC', 'Consumer Cyclical'],
    positiveSectors: ['Financial Services', 'Banks'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(rbi.*rate cut|repo rate cut|rbi dovish|liquidity injection|crr cut)\b/i,
    category: 'RBI_POLICY',
    horizon: 'STRUCTURAL',
    matchedRule: 'RBI Rate Cut / Dovish',
    negativeSectors: ['Banks'],
    positiveSectors: ['Real Estate', 'Auto', 'NBFC', 'Consumer Cyclical', 'Financial Services'],
    sentiment: 'POSITIVE',
  },
  {
    pattern: /\b(brent|crude.*spike|crude.*surge|oil.*jump|opec.*cut)\b/i,
    category: 'COMMODITY',
    horizon: 'TEMPORARY',
    matchedRule: 'Crude Oil Spike',
    negativeSectors: ['Aviation', 'Paint', 'Tyre', 'Oil Marketing', 'Chemicals', 'Consumer Cyclical'],
    positiveSectors: ['Oil Exploration', 'Energy'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(rupee.*(fall|slump|low|weaken|depreciat)|usd\/inr.*high|dollar.*surge)\b/i,
    category: 'CURRENCY',
    horizon: 'TEMPORARY',
    matchedRule: 'Rupee Depreciation / Dollar Rise',
    negativeSectors: ['Energy', 'Electronics', 'Aviation'],
    positiveSectors: ['Technology', 'Healthcare'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(gold.*(crash|plunge|slump|tumble))\b/i,
    category: 'COMMODITY',
    horizon: 'TEMPORARY',
    matchedRule: 'Gold Price Crash',
    negativeSectors: ['Jewellery', 'Consumer Cyclical'],
    positiveSectors: [],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(fed.*hawkish|powell.*rate|us yield.*surge|fomc.*hike)\b/i,
    category: 'GLOBAL_MACRO',
    horizon: 'STRUCTURAL',
    matchedRule: 'US Fed Hawkish',
    negativeSectors: ['Technology', 'Basic Materials', 'Metals'],
    positiveSectors: ['Consumer Defensive', 'Healthcare'],
    sentiment: 'NEGATIVE',
  },
  {
    pattern: /\b(china.*stimulus|beijing.*stimulus|pboc.*cut)\b/i,
    category: 'GLOBAL_MACRO',
    horizon: 'TEMPORARY',
    matchedRule: 'China Stimulus',
    negativeSectors: [],
    positiveSectors: ['Basic Materials', 'Metals'],
    sentiment: 'POSITIVE',
  },
];

function classifyMacroHeadline(title: string): Omit<MacroNewsItem, 'title' | 'url' | 'source' | 'publishedAtUtc'> {
  for (const rule of NEWS_IMPACT_RULES) {
    if (rule.pattern.test(title)) {
      return {
        category: rule.category,
        horizon: rule.horizon,
        matchedRule: rule.matchedRule,
        negativeSectors: rule.negativeSectors,
        positiveSectors: rule.positiveSectors,
        sentiment: rule.sentiment,
      };
    }
  }

  let category: NewsImpactCategory = 'GENERAL';
  if (/\b(rbi|mpc|repo|inflation|cpi|gdp)\b/i.test(title)) category = 'RBI_POLICY';
  else if (/\b(war|tension|sanction|election|geopolit|missile)\b/i.test(title)) category = 'GEOPOLITICAL';
  else if (/\b(crude|brent|gold|silver|copper|steel|coal)\b/i.test(title)) category = 'COMMODITY';
  else if (/\b(rupee|dollar|dxy|forex|inr)\b/i.test(title)) category = 'CURRENCY';
  else if (/\b(fed|us |fomc|china|europe|ecb|nasdaq)\b/i.test(title)) category = 'GLOBAL_MACRO';
  else if (/\b(q1|q2|q3|q4|profit|ebitda|sebi|merger|acquisition|order)\b/i.test(title))
    category = 'CORPORATE';

  const posWords = /\b(rally|surge|record high|beat|upgrade|stimulus|growth|inflow|gain)\b/i.test(title);
  const negWords = /\b(crash|slump|plunge|outflow|selloff|warning|miss|downgrade|risk|loss)\b/i.test(title);
  const sentiment: MacroNewsItem['sentiment'] =
    posWords && !negWords ? 'POSITIVE' : negWords && !posWords ? 'NEGATIVE' : 'NEUTRAL';

  return {
    category,
    horizon: /\b(sebi|policy|war|structural|regulatory|reform)\b/i.test(title)
      ? 'STRUCTURAL'
      : 'TEMPORARY',
    matchedRule: 'Keyword Sentiment Scan',
    negativeSectors: [],
    positiveSectors: [],
    sentiment,
  };
}

const RSS_FEEDS = [
  {
    name: 'Economic Times Markets',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
  },
  {
    name: 'Business Standard Markets',
    url: 'https://www.business-standard.com/rss/markets-106.rss',
  },
  {
    name: 'LiveMint Markets',
    url: 'https://www.livemint.com/rss/markets',
  },
];

async function fetchRssFeed(
  feedName: string,
  url: string
): Promise<{ status: 'OK' | 'UNAVAILABLE'; items: MacroNewsItem[] }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return { status: 'UNAVAILABLE', items: [] };
    const xml = await res.text();
    const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    const items: MacroNewsItem[] = [];

    for (const block of itemMatches.slice(0, 18)) {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
      const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
      const itemUrl = linkMatch ? decodeXmlEntities(linkMatch[1]) : '';
      if (!title || title.length < 10) continue;

      const parsedMs = pubMatch ? Date.parse(decodeXmlEntities(pubMatch[1])) : NaN;
      const publishedAtUtc = Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : '';
      const cls = classifyMacroHeadline(title);
      items.push({
        title,
        url: itemUrl,
        source: feedName,
        publishedAtUtc,
        ...cls,
      });
    }
    return { status: items.length > 0 ? 'OK' : 'UNAVAILABLE', items };
  } catch {
    return { status: 'UNAVAILABLE', items: [] };
  }
}

export async function getOpenMacroAndNewsDashboard(params: {
  allRows: ScreenerRow[];
  marketSentimentScore: number | null;
  ema21BreadthPct: number | null;
  forceRefresh?: boolean;
}): Promise<MacroNewsDashboardResponse> {
  if (!params.forceRefresh && cachedDashboard && Date.now() - cachedDashboard.fetchedAt < MACRO_CACHE_TTL_MS) {
    return cachedDashboard.data;
  }

  const [vixRes, dxyRes, brentRes, niftyRes, usdInrRes, fiiDiiRes, fiiLsRes, ...rssResults] =
    await Promise.all([
      fetchYahooMacroSeries('^INDIAVIX', 'India VIX'),
      fetchYahooMacroSeries('DX-Y.NYB', 'US Dollar Index'),
      fetchYahooMacroSeries('BZ=F', 'Brent Crude'),
      fetchNifty50MacroSeries(),
      fetchYahooMacroSeries('INR=X', 'USD/INR'),
      fetchNseFiiDiiAggregate(),
      fetchNseFiiLongShortRatio(),
      ...RSS_FEEDS.map((f) => fetchRssFeed(f.name, f.url)),
    ]);

  const dma200Breadth = compute200DmaBreadthFromYahooCache();

  // Phase 1 Evaluation (strictly open-source, zero fake values)
  const vixStatus: 'STOP' | 'CAUTION' | 'SAFE' | 'DATA NOT AVAILABLE' = !vixRes.available || vixRes.latestPrice === null
    ? 'DATA NOT AVAILABLE'
    : vixRes.latestPrice > 20
      ? 'STOP'
      : vixRes.latestPrice >= 17
        ? 'CAUTION'
        : 'SAFE';

  const dxyStrong =
    dxyRes.available &&
    dxyRes.latestPrice !== null &&
    (dxyRes.latestPrice >= 103 || (dxyRes.return1mPct ?? 0) >= 2.0);
  const dxyBias: MarketRegimeSnapshot['dxy']['bias'] = !dxyRes.available || dxyRes.latestPrice === null
    ? 'DATA NOT AVAILABLE'
    : dxyStrong
      ? 'STRONG_RISK'
      : dxyRes.latestPrice <= 100 || (dxyRes.return1mPct ?? 0) <= -1.0
        ? 'WEAK_SUPPORTIVE'
        : 'NEUTRAL';

  const brentBias: MarketRegimeSnapshot['brentCrude']['bias'] = !brentRes.available || brentRes.latestPrice === null
    ? 'DATA NOT AVAILABLE'
    : brentRes.latestPrice > 105
      ? 'SEVERE_RISK'
      : brentRes.latestPrice >= 95
        ? 'CAUTION'
        : brentRes.latestPrice >= 90
          ? 'NEUTRAL'
          : 'PROCEED';

  const mmiVal = params.marketSentimentScore;
  const mmiZone =
    mmiVal === null
      ? 'DATA NOT AVAILABLE'
      : mmiVal > 70
        ? 'EXTREME_GREED'
        : mmiVal < 30
          ? 'EXTREME_FEAR'
          : 'NEUTRAL';

  const reasons: string[] = [];
  let verdict: MarketRegimeSnapshot['regimeVerdict'] = 'PROCEED';
  let sizeMult = 1.0;

  if (vixStatus === 'STOP') {
    verdict = 'HARD_STOP';
    sizeMult = 0;
    reasons.push(`India VIX ${vixRes.latestPrice} > 20 (HARD STOP — no new trades)`);
  }
  if (fiiDiiRes.status === 'BOTH_SELLERS_STOP') {
    verdict = 'HARD_STOP';
    sizeMult = 0;
    reasons.push(fiiDiiRes.note);
  }
  if (brentBias === 'SEVERE_RISK') {
    verdict = 'HARD_STOP';
    sizeMult = 0;
    reasons.push(`Brent Crude $${brentRes.latestPrice} > $105 (SEVERE RISK — no new positions)`);
  }

  if (verdict !== 'HARD_STOP') {
    if (vixStatus === 'CAUTION') {
      verdict = 'CAUTION_50_PCT';
      sizeMult = 0.5;
      reasons.push(`India VIX elevated (${vixRes.latestPrice})`);
    }
    if (brentBias === 'CAUTION') {
      verdict = 'CAUTION_50_PCT';
      sizeMult = 0.5;
      reasons.push(`Brent Crude $${brentRes.latestPrice} in $95–105 caution zone`);
    }
    if (dxyBias === 'STRONG_RISK') {
      verdict = 'CAUTION_50_PCT';
      sizeMult = Math.min(sizeMult, 0.75);
      reasons.push(
        `DXY strong at ${dxyRes.latestPrice} (FII outflow pressure — avoid Banking/NBFC/OMC/CapGoods)`
      );
    }
    if (mmiVal !== null && (mmiVal > 70 || mmiVal < 30)) {
      verdict = 'CAUTION_50_PCT';
      sizeMult = Math.min(sizeMult, 0.5);
      reasons.push(`Market Sentiment Proxy at ${mmiVal}/100 (${mmiZone}) — size 50%`);
    }
    if (fiiLsRes.status === 'FALLING_REDUCE') {
      verdict = 'CAUTION_50_PCT';
      sizeMult = Math.min(sizeMult, 0.75);
      reasons.push(fiiLsRes.note);
    }
    if (dma200Breadth.available && dma200Breadth.pct !== null && dma200Breadth.pct < 60) {
      verdict = 'CAUTION_50_PCT';
      sizeMult = Math.min(sizeMult, 0.5);
      reasons.push(
        `200-DMA Breadth ${dma200Breadth.pct}% (${dma200Breadth.above}/${dma200Breadth.total} stocks > 200-DMA) < 60%`
      );
    } else if (params.ema21BreadthPct !== null && params.ema21BreadthPct < 60) {
      verdict = 'CAUTION_50_PCT';
      sizeMult = Math.min(sizeMult, 0.5);
      reasons.push(
        `NSE Liquid EMA21 Breadth ${params.ema21BreadthPct.toFixed(1)}% < 60%`
      );
    }
  }

  if (reasons.length === 0) {
    reasons.push('VIX <= 20, Brent < $95, and regime gates clear — normal swing sizing allowed.');
  }

  const regime: MarketRegimeSnapshot = {
    fetchedAtUtc: new Date().toISOString(),
    regimeVerdict: verdict,
    positionSizeMultiplier: sizeMult,
    regimeReasons: reasons,
    indiaVix: {
      available: vixRes.available,
      value: vixRes.latestPrice,
      changePct: vixRes.changePct,
      statusLabel: vixStatus,
      detail: vixRes.available
        ? `VIX ${vixRes.latestPrice} (Rule: > 20 HARD STOP)`
        : 'DATA NOT AVAILABLE',
      source: vixRes.source,
      asOfDate: vixRes.asOfDate,
    },
    dxy: {
      available: dxyRes.available,
      value: dxyRes.latestPrice,
      change1mPct: dxyRes.return1mPct,
      bias: dxyBias,
      statusLabel: dxyBias,
      detail: dxyRes.available
        ? `DXY ${dxyRes.latestPrice} (1M ${dxyRes.return1mPct !== null ? `${dxyRes.return1mPct >= 0 ? '+' : ''}${dxyRes.return1mPct}%` : '—'})`
        : 'DATA NOT AVAILABLE',
      source: dxyRes.source,
      asOfDate: dxyRes.asOfDate,
    },
    brentCrude: {
      available: brentRes.available,
      value: brentRes.latestPrice,
      change1mPct: brentRes.return1mPct,
      bias: brentBias,
      statusLabel: brentBias,
      detail: brentRes.available
        ? `Brent $${brentRes.latestPrice} (Rule: >$105 STOP, $95–105 CAUTION, <$90 PROCEED)`
        : 'DATA NOT AVAILABLE',
      source: brentRes.source,
      asOfDate: brentRes.asOfDate,
    },
    nifty50: {
      available: niftyRes.available,
      value: niftyRes.latestPrice,
      return1mPct: niftyRes.return1mPct,
      return1wPct: niftyRes.return1wPct,
      aboveEma20: niftyRes.aboveEma20,
      statusLabel: niftyRes.available
        ? `1M ${niftyRes.return1mPct !== null ? `${niftyRes.return1mPct >= 0 ? '+' : ''}${niftyRes.return1mPct}%` : '—'}`
        : 'DATA NOT AVAILABLE',
      detail: niftyRes.available
        ? `Nifty ${niftyRes.latestPrice} · ${niftyRes.aboveEma20 ? 'Above EMA20' : 'Below EMA20'}`
        : 'DATA NOT AVAILABLE',
      source: niftyRes.source,
      asOfDate: niftyRes.asOfDate,
    },
    usdInr: {
      available: usdInrRes.available,
      value: usdInrRes.latestPrice,
      change1mPct: usdInrRes.return1mPct,
      statusLabel: usdInrRes.available ? `₹${usdInrRes.latestPrice}` : 'DATA NOT AVAILABLE',
      detail: usdInrRes.available
        ? `1M ${usdInrRes.return1mPct !== null ? `${usdInrRes.return1mPct >= 0 ? '+' : ''}${usdInrRes.return1mPct}%` : '—'}`
        : 'DATA NOT AVAILABLE',
      source: usdInrRes.source,
      asOfDate: usdInrRes.asOfDate,
    },
    mmiProxy: {
      available: mmiVal !== null,
      value: mmiVal,
      zone: mmiZone,
      isProxy: true,
      statusLabel: mmiVal !== null ? `${mmiVal}/100 (NSE Proxy)` : 'DATA NOT AVAILABLE',
      detail:
        'External TickerTape MMI requires paid subscription; using real NSE Delivery/RVOL/Breadth Sentiment Score (0-100)',
      source: 'Open-Source NSE Bhavcopy Sentiment Proxy',
      asOfDate: niftyRes.asOfDate,
    },
    breadth200Dma: {
      available: dma200Breadth.available,
      value: dma200Breadth.pct,
      ema21BreadthPct: params.ema21BreadthPct,
      statusLabel: dma200Breadth.available && dma200Breadth.pct !== null
        ? dma200Breadth.pct < 60
          ? `CAUTION ${dma200Breadth.pct}% (<60%)`
          : `PROCEED ${dma200Breadth.pct}%`
        : params.ema21BreadthPct !== null && params.ema21BreadthPct < 60
          ? 'CAUTION (EMA21 < 60%)'
          : '200-DMA N/A',
      detail: dma200Breadth.available
        ? `${dma200Breadth.above}/${dma200Breadth.total} Yahoo-cached NSE stocks > 200-DMA (Live EMA21 liquid: ${params.ema21BreadthPct?.toFixed(1) ?? '—'}%)`
        : 'Need >=10 stocks with 200+ sessions cached; showing live EMA21 liquid breadth',
      source: dma200Breadth.available
        ? 'Yahoo 3Y Cache (200-DMA Breadth)'
        : 'NSE Bhavcopy 37-Session Cache',
      asOfDate: niftyRes.asOfDate,
    },
    fiiDiiDaily: fiiDiiRes,
    fiiLongShortRatio: fiiLsRes,
  };

  // Aggregate RSS feeds & build Sector Impact Matrix
  const feeds = RSS_FEEDS.map((f, idx) => ({
    name: f.name,
    status: rssResults[idx]?.status ?? 'UNAVAILABLE',
    count: rssResults[idx]?.items.length ?? 0,
  }));

  const seenTitles = new Set<string>();
  const allNews: MacroNewsItem[] = [];
  for (const res of rssResults) {
    for (const item of res?.items ?? []) {
      const k = item.title.toLowerCase();
      if (seenTitles.has(k)) continue;
      seenTitles.add(k);
      allNews.push(item);
    }
  }
  allNews.sort((a, b) => (b.publishedAtUtc || '').localeCompare(a.publishedAtUtc || ''));

  const sectorAgg = new Map<
    string,
    { pos: number; neg: number; reasons: Set<string> }
  >();
  const geoAlerts = new Set<string>();

  for (const n of allNews) {
    if (n.category === 'GEOPOLITICAL' && n.matchedRule !== 'Keyword Sentiment Scan') {
      geoAlerts.add(`${n.matchedRule}: ${n.title}`);
    }
    for (const s of n.negativeSectors) {
      const cur = sectorAgg.get(s) || { pos: 0, neg: 0, reasons: new Set<string>() };
      cur.neg += 1;
      cur.reasons.add(`[-] ${n.matchedRule}`);
      sectorAgg.set(s, cur);
    }
    for (const s of n.positiveSectors) {
      const cur = sectorAgg.get(s) || { pos: 0, neg: 0, reasons: new Set<string>() };
      cur.pos += 1;
      cur.reasons.add(`[+] ${n.matchedRule}`);
      sectorAgg.set(s, cur);
    }
  }

  const sectorImpacts: SectorNewsImpactSummary[] = Array.from(sectorAgg.entries())
    .map(([sector, v]) => {
      const netScore = v.pos - v.neg;
      const bias: SectorNewsImpactSummary['bias'] =
        netScore <= -1 ? 'AVOID' : netScore >= 1 ? 'BOOST' : 'NEUTRAL';
      return {
        sector,
        positiveHits: v.pos,
        negativeHits: v.neg,
        netScore,
        bias,
        reasons: Array.from(v.reasons).slice(0, 4),
      };
    })
    .sort((a, b) => Math.abs(b.netScore) - Math.abs(a.netScore));

  const dxyAvoidSectors = dxyStrong
    ? ['Financial Services', 'Banks', 'NBFC', 'Industrials', 'Energy', 'Aviation']
    : [];
  const dxyDefensiveSectors = dxyStrong ? ['Consumer Defensive', 'Healthcare'] : [];

  const result: MacroNewsDashboardResponse = {
    regime,
    feeds,
    geopoliticalAlerts: Array.from(geoAlerts).slice(0, 5),
    dxyAvoidSectors,
    dxyDefensiveSectors,
    newsItems: allNews.slice(0, 30),
    sectorImpacts,
  };

  cachedDashboard = { fetchedAt: Date.now(), data: result };
  return result;
}
