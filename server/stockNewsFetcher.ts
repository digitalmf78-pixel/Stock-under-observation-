import path from 'node:path';
import Parser from 'rss-parser';
import { fetchBseCorporateAnnouncements } from './catalystFetcher.ts';
import {
  atomicWriteJsonSync,
  readJsonSafe,
  withFileLock,
} from './filePersistence.ts';
import { toIstDateIso } from './liveFetcher.ts';
import type {
  CorporateAnnouncementItem,
  StockLiveNewsItem,
  StockLiveNewsResponse,
} from '../src/types/trading.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const rssParser = new Parser({
  timeout: 7000,
  headers: {
    'User-Agent': UA,
    Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  },
});

const RISK_ALERT_REGEX = /\b(fraud|penalty|penalties|downgrade|downgraded|downgrades)\b/i;

const GENERIC_COMPANY_WORDS = new Set([
  'INDIA',
  'LIMITED',
  'LTD',
  'INDUSTRIES',
  'INDUSTRIAL',
  'CORPORATION',
  'CORP',
  'ENTERPRISES',
  'HOLDINGS',
  'FINANCE',
  'FINANCIAL',
  'SERVICES',
  'SOLUTIONS',
  'SYSTEMS',
  'TECHNOLOGIES',
  'TECHNOLOGY',
  'PHARMA',
  'PHARMACEUTICALS',
  'PRIVATE',
  'PUBLIC',
  'THE',
  'AND',
  'CO',
  'COMPANY',
  'GROUP',
  'GLOBAL',
  'INTERNATIONAL',
  'NATIONAL',
  'INDIAN',
  'BANK',
  'INFRA',
  'INFRASTRUCTURE',
  'POWER',
  'ENERGY',
  'TEXTILES',
  'CHEMICALS',
  'ENGINEERING',
  'MOTORS',
  'AUTO',
  'CEMENT',
  'STEEL',
  'METALS',
  'CAPITAL',
  'VENTURES',
  'HOTELS',
]);

const AMBIGUOUS_SYMBOL_EXCLUSIONS: Record<string, RegExp> = {
  SAFARI:
    /\b(apple\s+safari|safari\s+browser|ios\s+\d+|macos|webkit|gorewada|zoo|wildlife|tiger\s+safari|jungle\s+safari|desert\s+safari|national\s+park|ranthambore|corbett|kaziranga|tatoba|tadoba)\b/i,
  OIL: /\b(cooking\s+oil|olive\s+oil|palm\s+oil|hair\s+oil|sunflower\s+oil)\b/i,
  TIMKEN: /\b(podcast|episode)\b/i,
  RELIANCE: /\b(reliance\s+infra|reliance\s+power|reliance\s+home|reliance\s+comm|rpower|rinfra|rcom)\b/i,
};

const GENERAL_FINANCE_CONTEXT_REGEX =
  /\b(nse|bse|stock|share|shares|equity|market|quarter|q1|q2|q3|q4|profit|revenue|ebitda|dividend|acquisition|order|results|margin|sebi|broker|target|rating|buy|sell|hold|listing|capex|ipo|brokerage|nifty|sensex|earnings|crore|rs\.|₹)\b/i;

function newsCachePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'daily_stock_news_cache.json');
}

interface DailyNewsCacheFile {
  entries: Record<string, StockLiveNewsResponse>;
}

let memoryDailyCache: DailyNewsCacheFile | null = null;

function isNewsCacheShape(val: unknown): val is Partial<DailyNewsCacheFile> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function loadDailyNewsCache(throwOnCorruptWithoutBackup = false): DailyNewsCacheFile {
  if (memoryDailyCache && !throwOnCorruptWithoutBackup) return memoryDailyCache;
  const parsed = readJsonSafe<Partial<DailyNewsCacheFile>>(
    newsCachePath(),
    { entries: {} },
    {
      validate: isNewsCacheShape,
      throwOnCorruptWithoutBackup,
    }
  );
  const normalized: DailyNewsCacheFile = {
    entries:
      parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
        ? parsed.entries
        : {},
  };
  memoryDailyCache = normalized;
  return normalized;
}

async function saveDailyNewsEntry(entry: StockLiveNewsResponse): Promise<void> {
  const file = newsCachePath();
  await withFileLock(file, () => {
    const cache = loadDailyNewsCache(true);
    cache.entries[entry.symbol] = entry;
    memoryDailyCache = cache;
    atomicWriteJsonSync(file, cache, { preserveBackup: true });
  });
}

interface SharedRssEntry {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  dateIso: string;
}

let sharedRssCache: { fetchedAtMs: number; items: SharedRssEntry[] } | null = null;
const SHARED_RSS_TTL_MS = 30 * 60 * 1000;

const PUBLIC_RSS_FEEDS: Array<{ url: string; source: string }> = [
  { url: 'https://www.moneycontrol.com/rss/latestnews.xml', source: 'Moneycontrol' },
  { url: 'https://www.moneycontrol.com/rss/MCtopnews.xml', source: 'Moneycontrol' },
  {
    url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms',
    source: 'Economic Times',
  },
  {
    url: 'https://www.business-standard.com/rss/markets-106.rss',
    source: 'Business Standard',
  },
];

function normalizeDateFields(rawDate?: string): { publishedAt: string; dateIso: string } {
  if (!rawDate) {
    const iso = toIstDateIso();
    return { publishedAt: iso, dateIso: iso };
  }
  const parsed = Date.parse(rawDate);
  if (Number.isFinite(parsed)) {
    const dt = new Date(parsed);
    const istIso = toIstDateIso(dt);
    return { publishedAt: dt.toISOString(), dateIso: istIso };
  }
  const ymd = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    return { publishedAt: iso, dateIso: iso };
  }
  const iso = toIstDateIso();
  return { publishedAt: rawDate, dateIso: iso };
}

async function getSharedIndianFinancialRss(): Promise<SharedRssEntry[]> {
  if (sharedRssCache && Date.now() - sharedRssCache.fetchedAtMs < SHARED_RSS_TTL_MS) {
    return sharedRssCache.items;
  }

  const settled = await Promise.allSettled(
    PUBLIC_RSS_FEEDS.map(async (f) => {
      const feed = await rssParser.parseURL(f.url);
      const out: SharedRssEntry[] = [];
      for (const item of (feed.items ?? []).slice(0, 60)) {
        const title = (item.title || '').replace(/\s+/g, ' ').trim();
        const link = (item.link || '').trim();
        if (!title) continue;
        const { publishedAt, dateIso } = normalizeDateFields(item.isoDate || item.pubDate);
        out.push({ title, link, source: f.source, publishedAt, dateIso });
      }
      return out;
    })
  );

  const combined: SharedRssEntry[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') combined.push(...r.value);
  }
  sharedRssCache = { fetchedAtMs: Date.now(), items: combined };
  return combined;
}

function buildEntityMatcher(symbol: string, companyName: string): (headline: string) => boolean {
  const sym = symbol.trim().toUpperCase();
  const cleanName = (companyName || '')
    .replace(/\b(limited|ltd\.?|industries|ind\.?|india|corp\.?|corporation|private|pvt\.?)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9\s&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleanName
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !GENERIC_COMPANY_WORDS.has(w.toUpperCase()));

  const escapedSym = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const symRegex = new RegExp(`\\b${escapedSym}\\b`, 'i');
  const twoWordPhrase = words.length >= 2 ? `${words[0]} ${words[1]}` : '';
  const twoWordRegex = twoWordPhrase
    ? new RegExp(`\\b${twoWordPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    : null;
  const primaryWordRegex =
    words.length >= 1 && words[0].length >= 5
      ? new RegExp(`\\b${words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      : null;

  const exclRegex = AMBIGUOUS_SYMBOL_EXCLUSIONS[sym];

  return (headline: string): boolean => {
    if (!headline) return false;
    if (exclRegex && exclRegex.test(headline)) return false;
    const hitSym = symRegex.test(headline);
    const hitPhrase = twoWordRegex ? twoWordRegex.test(headline) : false;
    const hitPrimary = primaryWordRegex ? primaryWordRegex.test(headline) : false;
    if (!hitSym && !hitPhrase && !hitPrimary) return false;
    // For ambiguous single words (e.g., SAFARI), require Indian equity/financial context unless full company phrase matches
    if (!hitPhrase && sym.length <= 6 && !GENERAL_FINANCE_CONTEXT_REGEX.test(headline)) {
      return false;
    }
    return true;
  };
}

async function tryEthosIndiaNewsPackage(
  symbol: string,
  companyName: string
): Promise<{ used: boolean; items: StockLiveNewsItem[] }> {
  try {
    const mod = (await import('@ethosagent/tools-india-news')) as Record<string, unknown>;
    const factory =
      (typeof mod.createIndiaNewsTools === 'function' ? mod.createIndiaNewsTools : null) ||
      (typeof mod.default === 'function' ? mod.default : null);
    if (!factory) return { used: false, items: [] };

    const tools = (await factory()) as unknown;
    const items: StockLiveNewsItem[] = [];
    const matcher = buildEntityMatcher(symbol, companyName);

    if (Array.isArray(tools)) {
      for (const tool of tools) {
        const t = tool as { name?: string; execute?: (args: Record<string, unknown>) => Promise<unknown> };
        if (typeof t?.execute !== 'function') continue;
        if (/search|news|announcement/i.test(t.name || '')) {
          try {
            const raw = (await t.execute({ query: symbol, symbol, limit: 10 })) as {
              articles?: Array<{ title?: string; url?: string; link?: string; source?: string; publishedAt?: string; date?: string }>;
              items?: Array<{ title?: string; url?: string; link?: string; source?: string; publishedAt?: string; date?: string }>;
            };
            const arr = raw?.articles ?? raw?.items ?? [];
            for (const a of arr) {
              const headline = (a.title || '').trim();
              if (!headline || !matcher(headline)) continue;
              const { publishedAt, dateIso } = normalizeDateFields(a.publishedAt || a.date);
              items.push({
                id: `ethos-${Buffer.from(headline).toString('base64').slice(0, 14)}`,
                headline,
                source: a.source || 'India News',
                publishedAt,
                dateIso,
                url: a.url || a.link || '',
                kind: 'NEWS',
                isRiskAlert: RISK_ALERT_REGEX.test(headline),
              });
            }
          } catch {
            // try next tool
          }
        }
      }
    }
    return { used: items.length > 0, items };
  } catch {
    // Package depends on unbundled @ethosagent/plugin-sdk in some runtimes; fall back cleanly to rss-parser
    return { used: false, items: [] };
  }
}

async function fetchSymbolGoogleNewsRss(
  symbol: string,
  companyName: string
): Promise<StockLiveNewsItem[]> {
  const sym = symbol.trim().toUpperCase();
  const cleanName = (companyName || '')
    .replace(/\b(limited|ltd\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const query =
    cleanName && cleanName.toUpperCase() !== sym
      ? `"${cleanName}" OR "${sym}" NSE stock share`
      : `"${sym}" NSE BSE stock share`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

  try {
    const feed = await rssParser.parseURL(url);
    const matcher = buildEntityMatcher(sym, companyName);
    const out: StockLiveNewsItem[] = [];
    for (const item of (feed.items ?? []).slice(0, 25)) {
      const rawTitle = (item.title || '').replace(/\s+/g, ' ').trim();
      if (!rawTitle) continue;
      // Google News titles often end with " - Source Name"
      const dashIdx = rawTitle.lastIndexOf(' - ');
      const headline = dashIdx > 20 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
      const extractedSource = dashIdx > 20 ? rawTitle.slice(dashIdx + 3).trim() : '';
      if (!matcher(headline)) continue;

      const { publishedAt, dateIso } = normalizeDateFields(item.isoDate || item.pubDate);
      out.push({
        id: `gn-${Buffer.from(headline).toString('base64').slice(0, 14)}`,
        headline,
        source: extractedSource || 'Google News India',
        publishedAt,
        dateIso,
        url: (item.link || '').trim(),
        kind: 'NEWS',
        isRiskAlert: RISK_ALERT_REGEX.test(headline),
      });
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
}

function mapBseAnnouncementTag(ann: CorporateAnnouncementItem): string {
  const combined = `${ann.subject} ${ann.details}`.toLowerCase();
  if (/\b(dividend|interim dividend|final dividend)\b/i.test(combined)) {
    return 'Dividend';
  }
  if (ann.category === 'RESULTS_BOARD_MEETING' || /\b(result|quarter ended|board meeting)\b/i.test(combined)) {
    return 'Results';
  }
  if (/\b(acqui|merger|stake|buyout|joint venture)\b/i.test(combined)) {
    return 'Acquisition';
  }
  if (ann.category === 'ORDER_WIN' || /\b(order|contract|loa|awarded)\b/i.test(combined)) {
    return 'Order Win';
  }
  if (ann.category === 'CORPORATE_ACTION') return 'Corp Action';
  if (ann.category === 'EXPANSION_FUNDRAISE') return 'Expansion';
  return 'Announcement';
}

function isRecentWithinDays(dateIso: string, maxDays = 14): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const dt = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(dt)) return false;
  return Date.now() - dt <= maxDays * 86400000;
}

export async function fetchStockNews(
  symbol: string,
  companyName = '',
  forceRefresh = false
): Promise<StockLiveNewsResponse> {
  const sym = symbol.trim().toUpperCase();
  const todayIst = toIstDateIso();
  const cache = loadDailyNewsCache();
  const existing = cache.entries[sym];

  if (!forceRefresh && existing && existing.cacheDateIst === todayIst) {
    return existing;
  }

  const [ethosRes, bseRes, sharedRssRes] = await Promise.allSettled([
    tryEthosIndiaNewsPackage(sym, companyName),
    fetchBseCorporateAnnouncements(sym),
    getSharedIndianFinancialRss(),
  ]);

  const providers: string[] = [];
  const rawItems: StockLiveNewsItem[] = [];

  if (ethosRes.status === 'fulfilled' && ethosRes.value.used) {
    providers.push('@ethosagent/tools-india-news');
    rawItems.push(...ethosRes.value.items);
  }

  const matcher = buildEntityMatcher(sym, companyName);

  if (sharedRssRes.status === 'fulfilled') {
    let rssMatched = 0;
    for (const r of sharedRssRes.value) {
      if (!matcher(r.title)) continue;
      rssMatched++;
      rawItems.push({
        id: `rss-${Buffer.from(r.title).toString('base64').slice(0, 14)}`,
        headline: r.title,
        source: r.source,
        publishedAt: r.publishedAt,
        dateIso: r.dateIso,
        url: r.link,
        kind: 'NEWS',
        isRiskAlert: RISK_ALERT_REGEX.test(r.title),
      });
    }
    if (rssMatched > 0) providers.push('Moneycontrol/ET/BS RSS');
  }

  if (bseRes.status === 'fulfilled' && bseRes.value.items.length > 0) {
    providers.push('BSE Announcements');
    for (const ann of bseRes.value.items.slice(0, 6)) {
      const tag = mapBseAnnouncementTag(ann);
      const { publishedAt, dateIso } = normalizeDateFields(ann.date);
      rawItems.push({
        id: `bse-${Buffer.from(`${ann.date}-${ann.subject}`).toString('base64').slice(0, 14)}`,
        headline: ann.subject,
        source: 'BSE Corporate Announcement',
        publishedAt,
        dateIso,
        url: ann.attachmentUrl,
        kind: 'ANNOUNCEMENT',
        announcementTag: tag,
        isRiskAlert: RISK_ALERT_REGEX.test(`${ann.subject} ${ann.details}`),
      });
    }
  }

  // If public RSS feeds had fewer than 5 headlines for this specific stock, supplement with targeted Google News India RSS
  const newsOnlyCount = rawItems.filter((i) => i.kind === 'NEWS').length;
  if (newsOnlyCount < 5) {
    const gnItems = await fetchSymbolGoogleNewsRss(sym, companyName);
    if (gnItems.length > 0) {
      providers.push('Google News RSS');
      rawItems.push(...gnItems);
    }
  }

  // Deduplicate by normalized headline prefix and sort newest first (cap 10)
  const seen = new Set<string>();
  const deduped: StockLiveNewsItem[] = [];
  for (const item of rawItems.sort((a, b) => b.dateIso.localeCompare(a.dateIso))) {
    const key = item.headline
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 48);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= 10) break;
  }

  const recentAnn = deduped.find(
    (i) => i.kind === 'ANNOUNCEMENT' && isRecentWithinDays(i.dateIso, 21)
  );
  const keywordAnn = !recentAnn
    ? deduped.find(
        (i) =>
          isRecentWithinDays(i.dateIso, 14) &&
          /\b(q[1-4]|results|dividend|acqui|order win|contract|bonus|buyback|split)\b/i.test(
            i.headline
          )
      )
    : null;

  const activeAnn = recentAnn || keywordAnn;
  const hasRecentAnnouncement = Boolean(activeAnn);
  const recentAnnouncementLabel = activeAnn
    ? activeAnn.announcementTag || 'News'
    : '';
  const hasRiskAlert = deduped.some((i) => i.isRiskAlert);

  const response: StockLiveNewsResponse = {
    symbol: sym,
    companyName: companyName || sym,
    cacheDateIst: todayIst,
    fetchedAtUtc: new Date().toISOString(),
    providerUsed:
      providers.length > 0 ? providers.join(' + ') : 'Moneycontrol/ET/BS RSS + BSE',
    hasRecentAnnouncement,
    recentAnnouncementLabel,
    hasRiskAlert,
    items: deduped,
  };

  await saveDailyNewsEntry(response);
  return response;
}
