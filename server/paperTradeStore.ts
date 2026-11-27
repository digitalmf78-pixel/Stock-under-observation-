import crypto from 'node:crypto';
import path from 'node:path';
import type {
  LiveStockQuote,
  PaperPortfolioSummary,
  PaperStrategyStat,
  PaperTrade,
  PaperTradeMarked,
} from '../src/types/trading.ts';
import {
  atomicWriteJsonSync,
  readJsonSafe,
  withFileLock,
} from './filePersistence.ts';
import { toIstDateIso } from './liveFetcher.ts';
import { nsePipeline } from './nsePipeline.ts';
import { evaluateQuoteFreshness } from '../src/utils/quoteFreshness.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface PaperTradesFile {
  updatedAtUtc: string;
  trades: PaperTrade[];
  deletedIds?: string[];
}

const LIVE_QUOTE_TTL_MS = 60 * 1000;
const liveQuoteCache = new Map<string, { fetchedAt: number; quote: LiveStockQuote }>();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(paperTradesPath(), fn);
}

function paperTradesPath(): string {
  return path.join(process.cwd(), 'data', 'research', 'paper_trades.json');
}

function atomicWriteJson(filePath: string, data: PaperTradesFile): void {
  atomicWriteJsonSync(filePath, data, { pretty: true, preserveBackup: true });
}

function isPaperTradesShape(val: unknown): val is Partial<PaperTradesFile> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function loadPaperTradesFile(throwOnCorruptWithoutBackup = false): PaperTradesFile {
  const parsed = readJsonSafe<Partial<PaperTradesFile>>(
    paperTradesPath(),
    { updatedAtUtc: '', trades: [], deletedIds: [] },
    {
      validate: isPaperTradesShape,
      throwOnCorruptWithoutBackup,
    }
  );
  return {
    updatedAtUtc: typeof parsed.updatedAtUtc === 'string' ? parsed.updatedAtUtc : '',
    trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
  };
}

function formatIstTimestamp(unixSec: number | undefined): string {
  if (!unixSec || !Number.isFinite(unixSec)) return '';
  const d = new Date((unixSec + 19800) * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' IST';
}

async function fetchSingleYahooQuote(tickerWithSuffix: string): Promise<LiveStockQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      tickerWithSuffix
    )}?range=2d&interval=5m`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            symbol?: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            regularMarketDayHigh?: number;
            regularMarketDayLow?: number;
            regularMarketVolume?: number;
            regularMarketTime?: number;
            marketState?: string;
          };
        }>;
      };
    };
    const meta = json.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return null;
    }
    const prev =
      typeof meta?.previousClose === 'number' && meta.previousClose > 0
        ? meta.previousClose
        : typeof meta?.chartPreviousClose === 'number' && meta.chartPreviousClose > 0
          ? meta.chartPreviousClose
          : null;
    const changePct =
      prev !== null ? Number((((price - prev) / prev) * 100).toFixed(2)) : null;

    const marketTimeSec =
      typeof meta?.regularMarketTime === 'number' && Number.isFinite(meta.regularMarketTime)
        ? meta.regularMarketTime
        : null;
    const lastUpdated =
      marketTimeSec !== null ? new Date(marketTimeSec * 1000).toISOString() : null;
    const marketTimeIst = formatIstTimestamp(marketTimeSec ?? undefined);
    const marketState = String(meta?.marketState || '');
    const freshness = evaluateQuoteFreshness({
      lastUpdated,
      marketTimeUnixSec: marketTimeSec,
      marketTimeIst,
      marketState,
    });

    return {
      available: true,
      symbol: tickerWithSuffix.replace(/\.(NS|BO)$/i, ''),
      tickerUsed: tickerWithSuffix,
      livePrice: Number(price.toFixed(2)),
      prevClose: prev !== null ? Number(prev.toFixed(2)) : null,
      changePct,
      dayHigh:
        typeof meta?.regularMarketDayHigh === 'number' && Number.isFinite(meta.regularMarketDayHigh)
          ? Number(meta.regularMarketDayHigh.toFixed(2))
          : null,
      dayLow:
        typeof meta?.regularMarketDayLow === 'number' && Number.isFinite(meta.regularMarketDayLow)
          ? Number(meta.regularMarketDayLow.toFixed(2))
          : null,
      volume:
        typeof meta?.regularMarketVolume === 'number' && Number.isFinite(meta.regularMarketVolume)
          ? meta.regularMarketVolume
          : null,
      marketTimeIst,
      marketState,
      lastUpdated,
      marketTimestampSec: marketTimeSec,
      marketDateIst: freshness.quoteDateIst,
      systemDateIst: freshness.systemDateIst,
      isStale: freshness.isStale,
      staleReason: freshness.reason,
      source: `Yahoo Finance (${tickerWithSuffix})`,
      note: 'Checking / Paper Trading Reference Quote (Yahoo Finance free feed)',
    };
  } catch {
    return null;
  }
}

export function applyLiveQuoteFreshness(
  quote: LiveStockQuote,
  now: Date = new Date()
): LiveStockQuote {
  if (!quote.available) return quote;
  const freshness = evaluateQuoteFreshness({
    lastUpdated: quote.lastUpdated ?? quote.marketTimeIst,
    marketTimeUnixSec: quote.marketTimestampSec,
    marketTimeIst: quote.marketTimeIst,
    marketDateIst: quote.marketDateIst,
    marketState: quote.marketState,
    now,
  });
  return {
    ...quote,
    marketDateIst: freshness.quoteDateIst,
    systemDateIst: freshness.systemDateIst,
    isStale: freshness.isStale,
    staleReason: freshness.reason,
  };
}

export async function fetchLiveYahooQuote(
  symbol: string,
  forceRefresh = false
): Promise<LiveStockQuote> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return {
      available: false,
      symbol: '',
      tickerUsed: '',
      livePrice: null,
      prevClose: null,
      changePct: null,
      dayHigh: null,
      dayLow: null,
      volume: null,
      marketTimeIst: '',
      marketState: '',
      lastUpdated: null,
      marketTimestampSec: null,
      marketDateIst: null,
      systemDateIst: toIstDateIso(),
      isStale: true,
      staleReason: 'Empty symbol',
      source: 'Yahoo Finance',
      note: 'DATA NOT AVAILABLE',
    };
  }

  const cached = liveQuoteCache.get(sym);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < LIVE_QUOTE_TTL_MS) {
    return applyLiveQuoteFreshness(cached.quote);
  }

  const nsQuote = await fetchSingleYahooQuote(`${sym}.NS`);
  const resolved = nsQuote ?? (await fetchSingleYahooQuote(`${sym}.BO`));
  if (resolved) {
    const checked = applyLiveQuoteFreshness(resolved);
    liveQuoteCache.set(sym, { fetchedAt: Date.now(), quote: checked });
    return checked;
  }

  const unavailable: LiveStockQuote = {
    available: false,
    symbol: sym,
    tickerUsed: `${sym}.NS`,
    livePrice: null,
    prevClose: null,
    changePct: null,
    dayHigh: null,
    dayLow: null,
    volume: null,
    marketTimeIst: '',
    marketState: '',
    lastUpdated: null,
    marketTimestampSec: null,
    marketDateIst: null,
    systemDateIst: toIstDateIso(),
    isStale: true,
    staleReason: 'Quote unreachable',
    source: 'Yahoo Finance',
    note: 'DATA NOT AVAILABLE (Yahoo live quote unreachable — using EOD or manual check)',
  };
  liveQuoteCache.set(sym, { fetchedAt: Date.now(), quote: unavailable });
  return unavailable;
}

export const fetchLiveQuote = fetchLiveYahooQuote;

export async function fetchBatchLiveYahooQuotes(
  symbols: string[],
  forceRefresh = false
): Promise<Record<string, LiveStockQuote>> {
  const cleaned = Array.from(
    new Set(
      symbols
        .map((s) => String(s || '').trim().toUpperCase())
        .filter((s) => s.length > 0 && s.length <= 24)
    )
  ).slice(0, 50);

  const result: Record<string, LiveStockQuote> = {};
  for (let i = 0; i < cleaned.length; i += 8) {
    const chunk = cleaned.slice(i, i + 8);
    const quotes = await Promise.all(
      chunk.map((sym) => fetchLiveYahooQuote(sym, forceRefresh))
    );
    for (let j = 0; j < chunk.length; j++) {
      result[chunk[j]] = quotes[j];
    }
  }
  return result;
}

function summarizeStrategyStats(
  strategyTag: string,
  trades: PaperTradeMarked[]
): PaperStrategyStat {
  const openList = trades.filter((t) => t.status === 'OPEN');
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const wins = closed.filter((t) => (t.realizedPnlInr ?? 0) > 0).length;
  const losses = closed.filter((t) => (t.realizedPnlInr ?? 0) <= 0).length;

  const capitalDeployedInr = Number(
    trades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0).toFixed(2)
  );
  const closedCapitalInr = Number(
    closed.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0).toFixed(2)
  );

  const realizedPnlInr = Number(
    closed.reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0).toFixed(2)
  );
  const unrealizedPnlInr = Number(
    openList.reduce((acc, t) => acc + (t.unrealizedPnlInr ?? 0), 0).toFixed(2)
  );
  const netPnlInr = Number((realizedPnlInr + unrealizedPnlInr).toFixed(2));

  const grossWin = closed
    .filter((t) => (t.realizedPnlInr ?? 0) > 0)
    .reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0);
  const grossLoss = Math.abs(
    closed
      .filter((t) => (t.realizedPnlInr ?? 0) < 0)
      .reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0)
  );

  const returns = closed
    .map((t) => t.realizedPnlPct)
    .filter((r): r is number => r !== null);
  const avgReturnPct =
    returns.length > 0
      ? Number((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2))
      : null;

  const rMults = closed
    .map((t) => t.rMultiple)
    .filter((r): r is number => r !== null);
  const avgRMultiple =
    rMults.length > 0
      ? Number((rMults.reduce((a, b) => a + b, 0) / rMults.length).toFixed(2))
      : null;

  const roiPct =
    capitalDeployedInr > 0
      ? Number(((netPnlInr / capitalDeployedInr) * 100).toFixed(2))
      : null;

  return {
    strategyTag,
    totalTrades: trades.length,
    openTrades: openList.length,
    closedTrades: closed.length,
    wins,
    losses,
    winRatePct:
      closed.length > 0 ? Number(((wins / closed.length) * 100).toFixed(1)) : null,
    capitalDeployedInr,
    closedCapitalInr,
    realizedPnlInr,
    unrealizedPnlInr,
    netPnlInr,
    roiPct,
    avgReturnPct,
    avgRMultiple,
    profitFactor:
      grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : null,
  };
}

export async function listPaperPortfolioSummary(options?: {
  symbol?: string;
  fetchLive?: boolean;
}): Promise<PaperPortfolioSummary> {
  const file = loadPaperTradesFile();
  const symFilter = options?.symbol ? options.symbol.trim().toUpperCase() : '';
  const allTrades = [...file.trades].sort((a, b) =>
    b.createdAtUtc.localeCompare(a.createdAtUtc)
  );

  const openSymbols = Array.from(
    new Set(allTrades.filter((t) => t.status === 'OPEN').map((t) => t.symbol))
  );

  const liveMap = new Map<string, LiveStockQuote>();
  if (options?.fetchLive !== false && openSymbols.length > 0) {
    const batch = await fetchBatchLiveYahooQuotes(openSymbols, false);
    for (const [s, q] of Object.entries(batch)) {
      liveMap.set(s, q);
    }
  }

  const markTrade = (t: PaperTrade): PaperTradeMarked => {
    if (t.status === 'CLOSED') {
      return {
        ...t,
        currentPrice: t.exitPrice,
        currentPriceSource:
          t.exitPriceSource === 'LIVE_YAHOO'
            ? 'LIVE_YAHOO'
            : t.exitPriceSource === 'NSE_EOD'
              ? 'NSE_EOD'
              : 'NSE_EOD',
        unrealizedPnlInr: null,
        unrealizedPnlPct: null,
      };
    }

    const liveQ = liveMap.get(t.symbol);
    const eodRow = nsePipeline.getStockDetail(t.symbol)?.summary ?? null;
    let currentPrice: number | null = null;
    let currentPriceSource: PaperTradeMarked['currentPriceSource'] = 'DATA NOT AVAILABLE';

    if (liveQ?.available && liveQ.livePrice !== null) {
      currentPrice = liveQ.livePrice;
      currentPriceSource = 'LIVE_YAHOO';
    } else if (eodRow && eodRow.closePrice > 0) {
      currentPrice = eodRow.closePrice;
      currentPriceSource = 'NSE_EOD';
    }

    const unrealizedPnlInr =
      currentPrice !== null
        ? Number(((currentPrice - t.entryPrice) * t.quantity).toFixed(2))
        : null;
    const unrealizedPnlPct =
      currentPrice !== null && t.entryPrice > 0
        ? Number((((currentPrice - t.entryPrice) / t.entryPrice) * 100).toFixed(2))
        : null;

    return {
      ...t,
      currentPrice,
      currentPriceSource,
      unrealizedPnlInr,
      unrealizedPnlPct,
    };
  };

  const markedAll = allTrades.map(markTrade);
  const trades = symFilter ? markedAll.filter((t) => t.symbol === symFilter) : markedAll;

  const openTrades = markedAll.filter((t) => t.status === 'OPEN');
  const closedTrades = markedAll.filter((t) => t.status === 'CLOSED');
  const wins = closedTrades.filter((t) => (t.realizedPnlInr ?? 0) > 0).length;
  const losses = closedTrades.filter((t) => (t.realizedPnlInr ?? 0) <= 0).length;

  const totalRealizedPnlInr = Number(
    closedTrades.reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0).toFixed(2)
  );
  const totalUnrealizedPnlInr = Number(
    openTrades.reduce((acc, t) => acc + (t.unrealizedPnlInr ?? 0), 0).toFixed(2)
  );
  const netPnlInr = Number((totalRealizedPnlInr + totalUnrealizedPnlInr).toFixed(2));
  const openCapitalInr = Number(
    openTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0).toFixed(2)
  );
  const closedInvestedCapitalInr = Number(
    closedTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0).toFixed(2)
  );
  const totalInvestedCapitalInr = Number(
    (openCapitalInr + closedInvestedCapitalInr).toFixed(2)
  );

  const overallClosedStat = summarizeStrategyStats('ALL', markedAll);

  const winPcts = closedTrades
    .filter((t) => (t.realizedPnlInr ?? 0) > 0 && t.realizedPnlPct !== null)
    .map((t) => t.realizedPnlPct as number);
  const lossPcts = closedTrades
    .filter((t) => (t.realizedPnlInr ?? 0) <= 0 && t.realizedPnlPct !== null)
    .map((t) => t.realizedPnlPct as number);
  const avgWinPct =
    winPcts.length > 0
      ? Number((winPcts.reduce((a, b) => a + b, 0) / winPcts.length).toFixed(2))
      : null;
  const avgLossPct =
    lossPcts.length > 0
      ? Number((lossPcts.reduce((a, b) => a + b, 0) / lossPcts.length).toFixed(2))
      : null;

  const realizedRoiPct =
    closedInvestedCapitalInr > 0
      ? Number(((totalRealizedPnlInr / closedInvestedCapitalInr) * 100).toFixed(2))
      : null;
  const totalRoiPct =
    totalInvestedCapitalInr > 0
      ? Number(((netPnlInr / totalInvestedCapitalInr) * 100).toFixed(2))
      : null;

  const stratMap = new Map<string, PaperTradeMarked[]>();
  for (const t of markedAll) {
    const tag = t.strategyTag || 'Manual';
    const arr = stratMap.get(tag) || [];
    arr.push(t);
    stratMap.set(tag, arr);
  }
  const byStrategy = Array.from(stratMap.entries())
    .map(([tag, list]) => summarizeStrategyStats(tag, list))
    .sort((a, b) => b.totalTrades - a.totalTrades);

  return {
    trades,
    stats: {
      totalTrades: markedAll.length,
      openCount: openTrades.length,
      closedCount: closedTrades.length,
      wins,
      losses,
      winRatePct: overallClosedStat.winRatePct,
      totalRealizedPnlInr,
      totalUnrealizedPnlInr,
      netPnlInr,
      avgReturnPct: overallClosedStat.avgReturnPct,
      avgWinPct,
      avgLossPct,
      avgRMultiple: overallClosedStat.avgRMultiple,
      profitFactor: overallClosedStat.profitFactor,
      openCapitalInr,
      closedInvestedCapitalInr,
      totalInvestedCapitalInr,
      realizedRoiPct,
      totalRoiPct,
    },
    byStrategy,
  };
}

export async function createPaperBuyTrade(input: {
  symbol: string;
  quantity?: unknown;
  entryPrice?: unknown;
  stopLoss?: unknown;
  targetPrice?: unknown;
  strategyTag?: unknown;
  notes?: unknown;
  preferLive?: boolean;
}): Promise<{ trade: PaperTrade; portfolio: PaperPortfolioSummary }> {
  const sym = input.symbol.trim().toUpperCase();
  if (!sym) throw new Error('Symbol is required.');
  const detail = nsePipeline.getStockDetail(sym);

  let entryPrice = Number(input.entryPrice);
  let entryPriceSource: PaperTrade['entryPriceSource'] = 'MANUAL';

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    if (input.preferLive !== false) {
      const liveQ = await fetchLiveYahooQuote(sym, false);
      if (liveQ.available && liveQ.livePrice !== null) {
        entryPrice = liveQ.livePrice;
        entryPriceSource = 'LIVE_YAHOO';
      }
    }
    if ((!Number.isFinite(entryPrice) || entryPrice <= 0) && detail) {
      entryPrice = detail.summary.closePrice;
      entryPriceSource = 'NSE_EOD';
    }
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      throw new Error(`Symbol ${sym} not found in NSE dataset and live price unavailable.`);
    }
  } else {
    entryPrice = Number(entryPrice.toFixed(2));
    if (input.preferLive) {
      const liveQ = await fetchLiveYahooQuote(sym, false);
      if (liveQ.available && liveQ.livePrice === entryPrice) {
        entryPriceSource = 'LIVE_YAHOO';
      } else if (detail && detail.summary.closePrice === entryPrice) {
        entryPriceSource = 'NSE_EOD';
      }
    }
  }

  let qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    qty = Math.max(1, Math.floor(25000 / entryPrice));
  } else {
    qty = Math.max(1, Math.round(qty));
  }

  const stopRaw = Number(input.stopLoss);
  const stopLoss =
    Number.isFinite(stopRaw) && stopRaw > 0
      ? Number(stopRaw.toFixed(2))
      : detail?.summary.suggestedStopLoss ?? Number((entryPrice * 0.92).toFixed(2));

  const targetRaw = Number(input.targetPrice);
  const targetPrice =
    Number.isFinite(targetRaw) && targetRaw > 0
      ? Number(targetRaw.toFixed(2))
      : Number((entryPrice * 1.15).toFixed(2));

  const nowUtc = new Date().toISOString();
  const trade: PaperTrade = {
    id: crypto.randomUUID(),
    symbol: sym,
    sector: detail?.summary.providerSector || 'Unclassified',
    strategyTag:
      typeof input.strategyTag === 'string' && input.strategyTag.trim()
        ? input.strategyTag.trim().slice(0, 50)
        : 'v3 Bot',
    status: 'OPEN',
    quantity: qty,
    entryDate: toIstDateIso(),
    entryPrice,
    entryPriceSource,
    stopLoss,
    targetPrice,
    exitDate: null,
    exitPrice: null,
    exitPriceSource: null,
    realizedPnlInr: null,
    realizedPnlPct: null,
    rMultiple: null,
    notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 300) : '',
    createdAtUtc: nowUtc,
    closedAtUtc: null,
  };

  await withWriteLock(async () => {
    const file = loadPaperTradesFile(true);
    const nextTrades = [trade, ...file.trades];
    atomicWriteJson(paperTradesPath(), {
      updatedAtUtc: nowUtc,
      trades: nextTrades,
      deletedIds: file.deletedIds || [],
    });
  });

  const portfolio = await listPaperPortfolioSummary({ fetchLive: true });
  return { trade, portfolio };
}

export async function closePaperSellTrade(
  id: string,
  input?: { exitPrice?: unknown; notes?: unknown }
): Promise<{ trade: PaperTrade; portfolio: PaperPortfolioSummary }> {
  const fileSnapshot = loadPaperTradesFile(false);
  const cur = fileSnapshot.trades.find((t) => t.id === id);
  if (!cur) throw new Error(`Paper trade ${id} not found.`);
  if (cur.status === 'CLOSED') {
    throw new Error(`Paper trade ${cur.symbol} is already closed.`);
  }

  let exitPrice = Number(input?.exitPrice);
  let exitPriceSource: PaperTrade['exitPriceSource'] = 'MANUAL';

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    const liveQ = await fetchLiveYahooQuote(cur.symbol, true);
    if (liveQ.available && liveQ.livePrice !== null) {
      exitPrice = liveQ.livePrice;
      exitPriceSource = 'LIVE_YAHOO';
    } else {
      const eod = nsePipeline.getStockDetail(cur.symbol)?.summary.closePrice;
      if (eod && eod > 0) {
        exitPrice = eod;
        exitPriceSource = 'NSE_EOD';
      } else {
        throw new Error(
          `Cannot auto-determine exit price for ${cur.symbol} (DATA NOT AVAILABLE). Enter a manual exit price.`
        );
      }
    }
  } else {
    exitPrice = Number(exitPrice.toFixed(2));
  }

  const updated = await withWriteLock(async () => {
    const file = loadPaperTradesFile(true);
    const idx = file.trades.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`Paper trade ${id} not found.`);
    const latest = file.trades[idx];
    if (latest.status === 'CLOSED') {
      throw new Error(`Paper trade ${latest.symbol} is already closed.`);
    }

    const realizedPnlInr = Number(((exitPrice - latest.entryPrice) * latest.quantity).toFixed(2));
    const realizedPnlPct = Number(
      (((exitPrice - latest.entryPrice) / latest.entryPrice) * 100).toFixed(2)
    );
    const riskPerShare =
      latest.stopLoss !== null && latest.entryPrice > latest.stopLoss
        ? latest.entryPrice - latest.stopLoss
        : null;
    const rMultiple =
      riskPerShare !== null && riskPerShare > 0
        ? Number(((exitPrice - latest.entryPrice) / riskPerShare).toFixed(2))
        : null;

    const nowUtc = new Date().toISOString();
    const extraNote =
      typeof input?.notes === 'string' && input.notes.trim() ? input.notes.trim() : '';

    const closedTrade: PaperTrade = {
      ...latest,
      status: 'CLOSED',
      exitDate: toIstDateIso(),
      exitPrice,
      exitPriceSource,
      realizedPnlInr,
      realizedPnlPct,
      rMultiple,
      notes: extraNote
        ? latest.notes
          ? `${latest.notes} | Exit: ${extraNote}`
          : `Exit: ${extraNote}`
        : latest.notes,
      closedAtUtc: nowUtc,
    };

    file.trades[idx] = closedTrade;
    atomicWriteJson(paperTradesPath(), {
      updatedAtUtc: nowUtc,
      trades: file.trades,
      deletedIds: file.deletedIds || [],
    });
    return closedTrade;
  });

  const portfolio = await listPaperPortfolioSummary({ fetchLive: true });
  return { trade: updated, portfolio };
}

export async function deletePaperTrade(id: string): Promise<PaperPortfolioSummary> {
  await withWriteLock(async () => {
    const file = loadPaperTradesFile(true);
    const next = file.trades.filter((t) => t.id !== id);
    if (next.length === file.trades.length) {
      throw new Error(`Paper trade ${id} not found.`);
    }
    const deletedSet = new Set(file.deletedIds || []);
    deletedSet.add(id);
    atomicWriteJson(paperTradesPath(), {
      updatedAtUtc: new Date().toISOString(),
      trades: next,
      deletedIds: Array.from(deletedSet).slice(-200),
    });
  });
  return listPaperPortfolioSummary({ fetchLive: true });
}

function sanitizeIncomingTrade(raw: unknown): PaperTrade | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PaperTrade>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const symbol = typeof r.symbol === 'string' ? r.symbol.trim().toUpperCase() : '';
  const entryPrice = Number(r.entryPrice);
  const quantity = Number(r.quantity);
  if (!id || !symbol || !Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const status: PaperTrade['status'] = r.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  return {
    id: id.slice(0, 80),
    symbol: symbol.slice(0, 24),
    sector: typeof r.sector === 'string' && r.sector.trim() ? r.sector.trim().slice(0, 60) : 'Unclassified',
    strategyTag: typeof r.strategyTag === 'string' && r.strategyTag.trim() ? r.strategyTag.trim().slice(0, 50) : 'Manual',
    status,
    quantity: Math.max(1, Math.round(quantity)),
    entryDate: typeof r.entryDate === 'string' && r.entryDate ? r.entryDate.slice(0, 20) : toIstDateIso(),
    entryPrice: Number(entryPrice.toFixed(2)),
    entryPriceSource:
      r.entryPriceSource === 'LIVE_YAHOO' || r.entryPriceSource === 'NSE_EOD'
        ? r.entryPriceSource
        : 'MANUAL',
    stopLoss: r.stopLoss !== null && r.stopLoss !== undefined && Number.isFinite(Number(r.stopLoss))
      ? Number(Number(r.stopLoss).toFixed(2))
      : null,
    targetPrice: r.targetPrice !== null && r.targetPrice !== undefined && Number.isFinite(Number(r.targetPrice))
      ? Number(Number(r.targetPrice).toFixed(2))
      : null,
    exitDate: status === 'CLOSED' && typeof r.exitDate === 'string' ? r.exitDate.slice(0, 20) : null,
    exitPrice:
      status === 'CLOSED' && r.exitPrice !== null && r.exitPrice !== undefined && Number.isFinite(Number(r.exitPrice))
        ? Number(Number(r.exitPrice).toFixed(2))
        : null,
    exitPriceSource:
      status === 'CLOSED' &&
      (r.exitPriceSource === 'LIVE_YAHOO' || r.exitPriceSource === 'NSE_EOD' || r.exitPriceSource === 'MANUAL')
        ? r.exitPriceSource
        : null,
    realizedPnlInr:
      status === 'CLOSED' && r.realizedPnlInr !== null && r.realizedPnlInr !== undefined && Number.isFinite(Number(r.realizedPnlInr))
        ? Number(Number(r.realizedPnlInr).toFixed(2))
        : null,
    realizedPnlPct:
      status === 'CLOSED' && r.realizedPnlPct !== null && r.realizedPnlPct !== undefined && Number.isFinite(Number(r.realizedPnlPct))
        ? Number(Number(r.realizedPnlPct).toFixed(2))
        : null,
    rMultiple:
      status === 'CLOSED' && r.rMultiple !== null && r.rMultiple !== undefined && Number.isFinite(Number(r.rMultiple))
        ? Number(Number(r.rMultiple).toFixed(2))
        : null,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 300) : '',
    createdAtUtc:
      typeof r.createdAtUtc === 'string' && r.createdAtUtc ? r.createdAtUtc.slice(0, 40) : new Date().toISOString(),
    closedAtUtc:
      status === 'CLOSED' && typeof r.closedAtUtc === 'string' ? r.closedAtUtc.slice(0, 40) : null,
  };
}

export async function syncPaperTrades(options: {
  clientTrades?: unknown[];
  deletedIds?: unknown[];
  fetchLive?: boolean;
}): Promise<{ restoredCount: number; portfolio: PaperPortfolioSummary }> {
  const restoredCount = await withWriteLock(async () => {
    const file = loadPaperTradesFile(true);
    const serverDeleted = new Set(file.deletedIds || []);
    const clientDeleted = new Set(
      Array.isArray(options.deletedIds)
        ? options.deletedIds.filter((x): x is string => typeof x === 'string')
        : []
    );

    const byId = new Map<string, PaperTrade>();
    for (const st of file.trades) {
      if (!clientDeleted.has(st.id)) {
        byId.set(st.id, st);
      }
    }

    let restored = 0;
    let changed = clientDeleted.size > 0 && byId.size !== file.trades.length;

    if (Array.isArray(options.clientTrades)) {
      for (const raw of options.clientTrades) {
        const ct = sanitizeIncomingTrade(raw);
        if (!ct) continue;
        if (serverDeleted.has(ct.id) || clientDeleted.has(ct.id)) continue;

        const existing = byId.get(ct.id);
        if (!existing) {
          byId.set(ct.id, ct);
          restored += 1;
          changed = true;
        } else if (existing.status === 'OPEN' && ct.status === 'CLOSED') {
          // Preserve explicit client-recorded exit if server rolled back before sell
          byId.set(ct.id, ct);
          changed = true;
        }
      }
    }

    if (changed) {
      const mergedDeleted = Array.from(new Set([...serverDeleted, ...clientDeleted])).slice(-200);
      const mergedTrades = Array.from(byId.values()).sort((a, b) =>
        b.createdAtUtc.localeCompare(a.createdAtUtc)
      );
      atomicWriteJson(paperTradesPath(), {
        updatedAtUtc: new Date().toISOString(),
        trades: mergedTrades,
        deletedIds: mergedDeleted,
      });
    }

    return restored;
  });

  const portfolio = await listPaperPortfolioSummary({ fetchLive: options.fetchLive !== false });
  return { restoredCount, portfolio };
}
