import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { LRUCache } from 'lru-cache';
import { NSEClient } from 'nse-bse-api';
import { fetchBseCorporateAnnouncements } from '../catalystFetcher.ts';
import type {
  CatalystNewsResponse,
  CatalystSentimentBullet,
  CatalystSentimentLabel,
  CorporateFilingHeadline,
  XbrlFiling,
} from '../../src/types/trading.ts';

const CATALYST_AI_MODEL = 'gemini-4-hydrogen';

const catalystNewsCache = new LRUCache<string, CatalystNewsResponse>({
  max: 250,
  ttl: 30 * 60 * 1000, // 30 minutes
});

const inFlightCatalystNews = new Map<string, Promise<CatalystNewsResponse>>();

let sharedNseAnnouncementsClient: NSEClient | null = null;
function getNseClient(): NSEClient {
  if (!sharedNseAnnouncementsClient) {
    const dir = path.join(os.tmpdir(), 'nse-bse-api-cache');
    fs.mkdirSync(dir, { recursive: true });
    sharedNseAnnouncementsClient = new NSEClient(dir, {
      server: true,
      timeout: 10_000,
    });
  }
  return sharedNseAnnouncementsClient;
}

export interface CatalystAiDeps {
  generateSummary: (params: {
    symbol: string;
    companyName: string;
    filings: CorporateFilingHeadline[];
  }) => Promise<{
    overallSentiment: CatalystSentimentLabel;
    sentimentBullets: CatalystSentimentBullet[];
    model: string;
  }>;
  fetchBseFilings?: (symbol: string) => Promise<CorporateFilingHeadline[]>;
  fetchNseFilings?: (symbol: string) => Promise<CorporateFilingHeadline[]>;
}

function normalizeSentiment(raw: unknown): CatalystSentimentLabel {
  const up = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (up === 'BULL' || up === 'BULLISH' || up === 'POSITIVE') return 'BULL';
  if (up === 'BEAR' || up === 'BEARISH' || up === 'NEGATIVE') return 'BEAR';
  return 'NEUTRAL';
}

function normalizeDateIso(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return s.slice(0, 10);
}

function mapCategoryLabel(category: string): string {
  switch (category) {
    case 'ORDER_WIN':
      return 'Order / Contract';
    case 'RESULTS_BOARD_MEETING':
      return 'Results / Board';
    case 'CORPORATE_ACTION':
      return 'Corporate Action';
    case 'EXPANSION_FUNDRAISE':
      return 'Expansion / Capital';
    default:
      return 'Regulatory Filing';
  }
}

async function fetchDefaultBseFilings(symbol: string): Promise<CorporateFilingHeadline[]> {
  const bse = await fetchBseCorporateAnnouncements(symbol);
  return bse.items.map((item, idx) => ({
    id: `bse-${symbol}-${normalizeDateIso(item.date)}-${idx}`,
    date: normalizeDateIso(item.date),
    source: 'BSE Filing' as const,
    category: mapCategoryLabel(item.category),
    headline: item.subject.trim(),
    details: item.details.trim(),
    url: item.attachmentUrl.trim(),
  }));
}

async function fetchDefaultNseFilings(symbol: string): Promise<CorporateFilingHeadline[]> {
  try {
    const nse = getNseClient();
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 45 * 86_400_000);
    const raw = await nse.announcements({
      index: 'equities',
      symbol: symbol.toUpperCase(),
      from_date: fromDate,
      to_date: toDate,
    });
    const rows = Array.isArray(raw) ? raw : [];
    const out: CorporateFilingHeadline[] = [];
    for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
      const r = rows[i] as Record<string, unknown>;
      const headline = String(r.desc ?? r.attchmntText ?? r.smIndustry ?? '').trim();
      const details = String(r.attchmntText ?? r.desc ?? '').trim();
      const dt = normalizeDateIso(r.an_dt ?? r.sort_date ?? r.exchdisstime);
      const url = String(r.attchmntFile ?? '').trim();
      if (!headline) continue;
      out.push({
        id: `nse-${symbol}-${dt}-${i}`,
        date: dt,
        source: 'NSE Filing',
        category: String(r.desc ?? 'NSE Filing').slice(0, 32) || 'NSE Filing',
        headline,
        details: details !== headline ? details : '',
        url,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mapXbrlFilings(symbol: string, xbrlFilings: XbrlFiling[]): CorporateFilingHeadline[] {
  return xbrlFilings.slice(0, 6).map((f, idx) => ({
    id: `xbrl-${symbol}-${f.publicationDate}-${idx}`,
    date: normalizeDateIso(f.publicationDate || f.financialPeriodEnd),
    source: 'NSE XBRL' as const,
    category: f.financialPeriodEnd ? `XBRL (${f.financialPeriodEnd})` : 'XBRL Filing',
    headline: f.filingDescription || `Financial Results Filing (${f.financialPeriodEnd})`,
    details: `Period end ${f.financialPeriodEnd} · Status: ${f.publicationDateStatus}`,
    url: f.officialFilingUrl || '',
  }));
}

export function deduplicateFilings(
  filings: CorporateFilingHeadline[],
  limit = 12
): CorporateFilingHeadline[] {
  const seen = new Set<string>();
  const sorted = [...filings].sort((a, b) => b.date.localeCompare(a.date));
  const out: CorporateFilingHeadline[] = [];

  for (const item of sorted) {
    const norm = `${item.date}:${item.headline.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 56)}`;
    if (!item.headline.trim() || seen.has(norm)) continue;
    seen.add(norm);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function generateGeminiCatalystSummary(params: {
  symbol: string;
  companyName: string;
  filings: CorporateFilingHeadline[];
}): Promise<{
  overallSentiment: CatalystSentimentLabel;
  sentimentBullets: CatalystSentimentBullet[];
  model: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const filingContext = params.filings.slice(0, 12).map((f) => ({
    date: f.date,
    source: f.source,
    category: f.category,
    headline: f.headline,
    details: f.details && f.details !== f.headline ? f.details.slice(0, 240) : undefined,
  }));

  const prompt = `Analyze these recent corporate filing headlines for Indian listed equity ${params.symbol}${
    params.companyName ? ` (${params.companyName})` : ''
  }.

Task:
Summarize the filings into an exact 3-bullet Bull/Bear/Neutral sentiment list for equity researchers.
Rules:
1. Return EXACTLY 3 bullet items in "sentimentBullets".
2. Base every statement strictly on the supplied filings below; never fabricate contracts, numbers, or announcements.
3. Classify each bullet honestly as "BULL", "BEAR", or "NEUTRAL" based on whether the filing is growth/shareholder-positive (e.g., order wins, expansion, strong results, dividends/buybacks), adverse/risk-bearing (e.g., penalties, resignations, litigation, margin/earnings contraction), or routine compliance/procedural (e.g., newspaper notices, trading window closures, routine board meeting intimations, investor meet schedules).
4. Set "overallSentiment" to "BULL", "BEAR", or "NEUTRAL" reflecting the net tone of the filings.
5. Keep each bullet topic to 2-4 words and each summary to 1-2 crisp, factual sentences citing the filing date or topic.

CORPORATE FILINGS:
${JSON.stringify(filingContext, null, 2)}`;

  let responseText = '';
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: CATALYST_AI_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a concise Indian capital-markets corporate filings analyst. Strictly summarize only the provided regulatory disclosures into 3 Bull/Bear/Neutral sentiment bullets.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallSentiment: {
                type: Type.STRING,
                description: 'Must be strictly BULL, BEAR, or NEUTRAL.',
              },
              sentimentBullets: {
                type: Type.ARRAY,
                description: 'Exactly 3 summarized sentiment bullet points.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sentiment: {
                      type: Type.STRING,
                      description: 'Must be strictly BULL, BEAR, or NEUTRAL.',
                    },
                    topic: {
                      type: Type.STRING,
                      description: '2-4 word catalyst topic title.',
                    },
                    summary: {
                      type: Type.STRING,
                      description: '1-2 factual sentences grounded in the filings.',
                    },
                  },
                  required: ['sentiment', 'topic', 'summary'],
                },
              },
            },
            required: ['overallSentiment', 'sentimentBullets'],
          },
        },
      });
      responseText = (response.text ?? '').trim();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/i.test(msg);
      if (!isTransient || attempt === 2) {
        break;
      }
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }

  if (lastErr) {
    const rawMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    try {
      const parsedErr = JSON.parse(rawMsg) as { error?: { message?: string; code?: number } };
      if (parsedErr?.error?.message) {
        throw new Error(
          parsedErr.error.code
            ? `Gemini API (${parsedErr.error.code}): ${parsedErr.error.message}`
            : parsedErr.error.message
        );
      }
    } catch (parseFail) {
      if (parseFail instanceof Error && parseFail !== lastErr && parseFail.message.startsWith('Gemini API')) {
        throw parseFail;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(rawMsg);
  }

  const parsed = JSON.parse(responseText) as {
    overallSentiment?: string;
    sentimentBullets?: Array<{ sentiment?: string; topic?: string; summary?: string }>;
  };

  const bulletsRaw = Array.isArray(parsed.sentimentBullets) ? parsed.sentimentBullets : [];
  const sentimentBullets: CatalystSentimentBullet[] = bulletsRaw
    .slice(0, 3)
    .map((b) => ({
      sentiment: normalizeSentiment(b.sentiment),
      topic: String(b.topic || 'Corporate Disclosure').trim(),
      summary: String(b.summary || '').trim(),
    }))
    .filter((b) => b.summary.length > 0);

  if (sentimentBullets.length === 0) {
    throw new Error('Gemini returned an empty catalyst sentiment summary.');
  }

  return {
    overallSentiment: normalizeSentiment(parsed.overallSentiment),
    sentimentBullets,
    model: CATALYST_AI_MODEL,
  };
}

export async function getCatalystNewsWithAiSummary(
  params: {
    symbol: string;
    companyName?: string;
    xbrlFilings?: XbrlFiling[];
    forceRefresh?: boolean;
  },
  deps?: Partial<CatalystAiDeps>
): Promise<CatalystNewsResponse> {
  const sym = params.symbol.trim().toUpperCase();
  const companyName = (params.companyName || '').trim();
  const forceRefresh = Boolean(params.forceRefresh);
  const cacheKey = `catalyst-news:${sym}`;

  if (!forceRefresh && !deps) {
    const cached = catalystNewsCache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  if (!forceRefresh && !deps) {
    const existingFlight = inFlightCatalystNews.get(cacheKey);
    if (existingFlight) {
      return existingFlight;
    }
  }

  const task = (async (): Promise<CatalystNewsResponse> => {
    const bseFetcher = deps?.fetchBseFilings ?? fetchDefaultBseFilings;
    const nseFetcher = deps?.fetchNseFilings ?? fetchDefaultNseFilings;
    const aiSummarizer = deps?.generateSummary ?? generateGeminiCatalystSummary;

    const [bseSettled, nseSettled] = await Promise.allSettled([
      bseFetcher(sym),
      nseFetcher(sym),
    ]);

    const rawFilings: CorporateFilingHeadline[] = [];
    if (bseSettled.status === 'fulfilled') rawFilings.push(...bseSettled.value);
    if (nseSettled.status === 'fulfilled') rawFilings.push(...nseSettled.value);
    if (params.xbrlFilings && params.xbrlFilings.length > 0) {
      rawFilings.push(...mapXbrlFilings(sym, params.xbrlFilings));
    }

    const filings = deduplicateFilings(rawFilings, 12);

    if (filings.length === 0) {
      return {
        symbol: sym,
        companyName: companyName || sym,
        fetchedAtUtc: new Date().toISOString(),
        fromCache: false,
        filings: [],
        overallSentiment: null,
        sentimentBullets: [],
        aiModel: null,
        aiError: null,
      };
    }

    let overallSentiment: CatalystSentimentLabel | null = null;
    let sentimentBullets: CatalystSentimentBullet[] = [];
    let aiModel: string | null = null;
    let aiError: string | null = null;

    try {
      const aiResult = await aiSummarizer({
        symbol: sym,
        companyName,
        filings,
      });
      overallSentiment = aiResult.overallSentiment;
      sentimentBullets = aiResult.sentimentBullets;
      aiModel = aiResult.model;
    } catch (err) {
      aiError = err instanceof Error ? err.message : 'AI sentiment summarization failed.';
    }

    const result: CatalystNewsResponse = {
      symbol: sym,
      companyName: companyName || sym,
      fetchedAtUtc: new Date().toISOString(),
      fromCache: false,
      filings,
      overallSentiment,
      sentimentBullets,
      aiModel,
      aiError,
    };

    // Only cache when AI succeeded (so transient missing-key / 429 doesn't stick for 30 min)
    if (!deps && !aiError && sentimentBullets.length > 0) {
      catalystNewsCache.set(cacheKey, result);
    }

    return result;
  })();

  if (!deps) {
    inFlightCatalystNews.set(cacheKey, task);
  }
  try {
    return await task;
  } finally {
    if (!deps) {
      inFlightCatalystNews.delete(cacheKey);
    }
  }
}
