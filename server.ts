import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { nsePipeline } from './server/nsePipeline.ts';
import { evaluateRiskControls } from './server/riskControls.ts';
import { runEcmsGeminiResearch } from './server/geminiResearch.ts';
import { fetch5YearDividendHistory } from './server/dividendHistoryService.ts';
import {
  ensureLiveFundamentalsForSymbol,
  fetchNseBhavcopyForDate,
  getCollectionJobStatus,
  refreshFundamentalsBatch,
  saveSymbolFundamentalsToCache,
  startFullFundamentalCollection,
  syncLatestBhavcopiesCatchup,
} from './server/liveFetcher.ts';
import {
  buildCatalystScreener,
  fetchAndCacheStockCatalysts,
  getAllBulkBlockDeals30D,
  getUniverseQuoteScanStatus,
  getUpcomingResultObservationList,
  syncNseBulkBlockDeals,
  syncUniverseQuoteCalendarAndIpo,
} from './server/catalystFetcher.ts';
import { runStockDeliveryBacktest } from './server/backtester.ts';
import {
  createTradeJournalEntry,
  deleteTradeJournalEntry,
  listTradeJournalEntries,
  updateTradeJournalEntry,
} from './server/tradeJournalStore.ts';
import {
  buildWatchlistResponse,
  loadWatchlistSymbols,
  removeWatchlistSymbol,
  toggleWatchlistSymbol,
} from './server/watchlistStore.ts';
import { getOpenMacroAndNewsDashboard } from './server/openMacroNewsEngine.ts';
import {
  analyzeStockWithV3Bot,
  recommendStocksWithOpenAnalysis,
  runBotBacktestFramework,
  runDailyBotScanner,
} from './server/swingBotEngine.ts';
import {
  closePaperSellTrade,
  createPaperBuyTrade,
  deletePaperTrade,
  fetchBatchLiveYahooQuotes,
  fetchLiveYahooQuote,
  listPaperPortfolioSummary,
  syncPaperTrades,
} from './server/paperTradeStore.ts';
import {
  buildT1T2DailyReport,
  formatT1T2ReportCsv,
  syncT1T2DailySnapshots,
} from './server/t1T2ReportStore.ts';
import { fetchStockNews } from './server/stockNewsFetcher.ts';
import {
  evictFundamentalCache,
  getFundamentalServiceHealth,
  getVerifiedFundamentals,
} from './server/services/fundamentalService.ts';
import { getCatalystNewsWithAiSummary } from './server/services/catalystNewsService.ts';

const PORT = 3000;
const HOST = '0.0.0.0';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Preload NSE datasets & synchronize daily T1/T2 snapshot memory once on startup
  nsePipeline.ensureLoaded();
  syncT1T2DailySnapshots();

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // V8 Pipeline Overview & Funnel
  app.get('/api/overview', (_req, res) => {
    try {
      res.json(nsePipeline.getOverview());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/fundamentals/thresholds', (req, res) => {
    try {
      const updated = nsePipeline.updateThresholds(process.cwd(), req.body);
      res.json({ success: true, thresholds: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // IPO Sentiment & Analysis (<1 Year Cohort)
  app.get('/api/ipo/overview', (_req, res) => {
    try {
      res.json(nsePipeline.getIpoOverview());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delivery A/B, RVOL, Liquidity, Fundamental & Swing Tier Screener
  app.get('/api/screener', (req, res) => {
    try {
      const result = nsePipeline.queryScreener({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        sector: typeof req.query.sector === 'string' ? req.query.sector : undefined,
        delivery: typeof req.query.delivery === 'string' ? req.query.delivery : undefined,
        rvol: typeof req.query.rvol === 'string' ? req.query.rvol : undefined,
        liquidity: typeof req.query.liquidity === 'string' ? req.query.liquidity : undefined,
        fundamental: typeof req.query.fundamental === 'string' ? req.query.fundamental : undefined,
        freshness: typeof req.query.freshness === 'string' ? req.query.freshness : undefined,
        swingTier: typeof req.query.swingTier === 'string' ? req.query.swingTier : undefined,
        uTurn: typeof req.query.uTurn === 'string' ? req.query.uTurn : undefined,
        cap: typeof req.query.cap === 'string' ? req.query.cap : undefined,
        emaCross: typeof req.query.emaCross === 'string' ? req.query.emaCross : undefined,
        upcomingResults:
          req.query.upcomingResults === '1' || req.query.upcomingResults === 'true',
        symbols:
          req.query.watchlistOnly === '1' || req.query.watchlistOnly === 'true'
            ? loadWatchlistSymbols().join(',') || '__NONE__'
            : typeof req.query.symbols === 'string'
              ? req.query.symbols
              : undefined,
        sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
        dir: typeof req.query.dir === 'string' ? req.query.dir : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Dedicated Upcoming Quarterly Result Date Stocks Observation List
  app.get('/api/upcoming-results', (req, res) => {
    try {
      const result = getUpcomingResultObservationList({
        rows: nsePipeline.getAllScreenerRows(),
        fundamentalsBySymbol: nsePipeline.getFundamentalsMap(),
        refIso: nsePipeline.getLatestSessionRefIso(),
        window: typeof req.query.window === 'string' ? req.query.window : undefined,
        polarity: typeof req.query.polarity === 'string' ? req.query.polarity : undefined,
        swingOnly: req.query.swingOnly === '1' || req.query.swingOnly === 'true',
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3-Month Results Priority & Rejection Gate Screener
  app.get('/api/catalysts/screener', (req, res) => {
    try {
      const rows = nsePipeline.getAllScreenerRows();
      const fundamentalsBySymbol = nsePipeline.getFundamentalsMap();
      const refIso = nsePipeline.getLatestSessionRefIso();
      const result = buildCatalystScreener({
        rows,
        fundamentalsBySymbol,
        refIso,
        priority: typeof req.query.priority === 'string' ? req.query.priority : undefined,
        gate: typeof req.query.gate === 'string' ? req.query.gate : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        onlyWithDeals: req.query.onlyWithDeals === '1' || req.query.onlyWithDeals === 'true',
        onlyOrderWins: req.query.onlyOrderWins === '1' || req.query.onlyOrderWins === 'true',
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Direct 30-Day NSE Bulk & Block Deals Explorer (supports symbol, dealType, buySell, days, limit, refresh=1)
  app.get('/api/bulk-block-deals', async (req, res) => {
    try {
      const refIso = nsePipeline.getLatestSessionRefIso();
      if (req.query.refresh === '1' || req.query.refresh === 'true') {
        await syncNseBulkBlockDeals(refIso, { force: true });
      }
      const result = getAllBulkBlockDeals30D({
        symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
        dealType: typeof req.query.dealType === 'string' ? req.query.dealType : undefined,
        buySell: typeof req.query.buySell === 'string' ? req.query.buySell : undefined,
        days: typeof req.query.days === 'string' ? Number(req.query.days) : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        refIso,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Sync NSE Bulk/Block 30D Deals + Yahoo Quote Calendar & IPO First-Trade Dates across All NSE Symbols
  app.post('/api/catalysts/sync', async (req, res) => {
    try {
      const refIso = nsePipeline.getLatestSessionRefIso();
      const bulkStore = await syncNseBulkBlockDeals(refIso, { force: true });
      const background = Boolean(req.body?.background);
      const symbols = nsePipeline.getAllSymbols();
      const distinctDates = Array.from(new Set(bulkStore.deals.map((d) => d.date))).sort();

      if (background) {
        void syncUniverseQuoteCalendarAndIpo(symbols, refIso, () => nsePipeline.reload());
        return res.json({
          started: true,
          bulkDeals30D: bulkStore.deals.length,
          bulkDistinctDates: distinctDates.length,
          bulkDateRange: distinctDates.length > 0 ? `${distinctDates[0]} to ${distinctDates[distinctDates.length - 1]}` : '',
          scanStatus: getUniverseQuoteScanStatus(),
        });
      }

      const scan = await syncUniverseQuoteCalendarAndIpo(symbols, refIso, () =>
        nsePipeline.reload()
      );
      return res.json({
        completed: true,
        bulkDeals30D: bulkStore.deals.length,
        bulkDistinctDates: distinctDates.length,
        bulkDateRange: distinctDates.length > 0 ? `${distinctDates[0]} to ${distinctDates[distinctDates.length - 1]}` : '',
        scan,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Per-Stock 7D Google News + BSE Corporate Announcements/Orders + 30D Bulk/Block Deals + Rejection Gate
  app.get('/api/stock/:symbol/catalysts', async (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const detail = nsePipeline.getStockDetail(sym);
      if (!detail) {
        return res.status(404).json({
          error: `Symbol ${sym} not found in NSE Mainboard dataset.`,
        });
      }
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const profile = await fetchAndCacheStockCatalysts({
        row: detail.summary,
        fund: detail.fundamentals ?? undefined,
        refIso: nsePipeline.getLatestSessionRefIso(),
        forceRefresh,
      });
      return res.json(profile);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Live Open-Source Stock News & BSE Corporate Announcements (Daily Cached)
  app.get('/api/stock/:symbol/news', async (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const detail = nsePipeline.getStockDetail(sym);
      if (!detail) {
        return res.status(404).json({
          error: `Symbol ${sym} not found in NSE Mainboard dataset.`,
        });
      }
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const companyName =
        detail.fundamentals?.companyName || detail.summary.companyName || '';
      const news = await fetchStockNews(sym, companyName, forceRefresh);
      return res.json(news);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Catalyst News: Recent Corporate Filings + Gemini 3-Bullet Bull/Bear/Neutral Sentiment Summary
  app.get('/api/stock/:symbol/catalyst-news', async (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const detail = nsePipeline.getStockDetail(sym);
      if (!detail) {
        return res.status(404).json({
          error: `Symbol ${sym} not found in NSE Mainboard dataset.`,
        });
      }
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const companyName =
        detail.fundamentals?.companyName || detail.summary.companyName || '';
      const result = await getCatalystNewsWithAiSummary({
        symbol: sym,
        companyName,
        xbrlFilings: detail.xbrlFilings,
        forceRefresh,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Individual Stock Deep-Dive (35-Session History + Fundamentals + XBRL + Signals)
  app.get('/api/stock/:symbol', (req, res) => {
    try {
      const detail = nsePipeline.getStockDetail(req.params.symbol);
      if (!detail) {
        return res.status(404).json({
          error: `Symbol ${req.params.symbol.toUpperCase()} not found in NSE Mainboard dataset.`,
        });
      }
      return res.json(detail);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 14-Day (or custom window) Price & Return Correlation Matrix vs Top-3 Sector Peers
  app.get('/api/stock/:symbol/correlation', (req, res) => {
    try {
      const windowRaw = typeof req.query.window === 'string' ? Number(req.query.window) : 14;
      const windowDays = Number.isFinite(windowRaw) ? windowRaw : 14;
      const customPeers =
        typeof req.query.peers === 'string' && req.query.peers.trim()
          ? req.query.peers
              .split(',')
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          : undefined;
      const matrix = nsePipeline.getPeerCorrelationMatrix(req.params.symbol, {
        windowDays,
        customPeers,
      });
      if (!matrix) {
        return res.status(404).json({
          error: `Correlation data unavailable for ${req.params.symbol.toUpperCase()}.`,
        });
      }
      return res.json(matrix);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 5-Year Dividend Payout Ratio & Long-Term Stock Performance History
  app.get('/api/stock/:symbol/dividends', async (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const detail = nsePipeline.getStockDetail(sym);
      const companyName =
        detail?.fundamentals?.companyName || detail?.summary.companyName || sym;
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const result = await fetch5YearDividendHistory(sym, {
        companyName,
        forceRefresh,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 6-Month Delivery A/B Breakout Backtester
  app.get('/api/stock/:symbol/backtest', async (req, res) => {
    try {
      const holdDays =
        typeof req.query.holdDays === 'string' ? Number(req.query.holdDays) : undefined;
      const targetR =
        typeof req.query.targetR === 'string' ? Number(req.query.targetR) : undefined;
      const stopMode =
        req.query.stopMode === 'PCT_5' || req.query.stopMode === 'PCT_7'
          ? req.query.stopMode
          : 'ATR_1_5';
      const signalScope =
        req.query.signalScope === 'DELIV_AB_ONLY' ? 'DELIV_AB_ONLY' : 'ALL_6M';

      const result = await runStockDeliveryBacktest(req.params.symbol, {
        holdDays: Number.isFinite(holdDays) ? holdDays : undefined,
        targetR: Number.isFinite(targetR) ? targetR : undefined,
        stopMode,
        signalScope,
      });
      return res.json(result);
    } catch (err) {
      const msg = (err as Error).message || 'Backtest failed.';
      const status = msg.includes('not found') ? 404 : 500;
      return res.status(status).json({ error: msg });
    }
  });

  // U-Turn Target & Technical/Subsequent Confirmation Evaluator
  app.get('/api/stock/:symbol/uturn', async (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const detail = nsePipeline.getStockDetail(sym);
      if (!detail) {
        return res.status(404).json({
          error: `Symbol ${sym} not found in NSE Mainboard dataset.`,
        });
      }

      const hasManualEps =
        typeof req.query.epsPrev === 'string' && typeof req.query.epsCurr === 'string';
      if (
        !hasManualEps &&
        (detail.fundamentals?.epsPrev === null ||
          detail.fundamentals?.epsPrev === undefined ||
          detail.fundamentals?.epsCurr === null ||
          detail.fundamentals?.epsCurr === undefined)
      ) {
        const fetched = await ensureLiveFundamentalsForSymbol(
          sym,
          nsePipeline.getXbrlFilingsForSymbol(sym)
        );
        if (fetched && (fetched.epsCurr !== null || fetched.trailingPE !== null)) {
          nsePipeline.reload();
        }
      }

      const peakRaw =
        typeof req.query.peakPrice === 'string' ? Number(req.query.peakPrice) : undefined;
      const corrPctRaw =
        typeof req.query.correctionPct === 'string' ? Number(req.query.correctionPct) : undefined;
      const corrInrRaw =
        typeof req.query.correctionInr === 'string' ? Number(req.query.correctionInr) : undefined;
      const epsPrevRaw =
        typeof req.query.epsPrev === 'string' && req.query.epsPrev.trim() !== ''
          ? Number(req.query.epsPrev)
          : undefined;
      const epsCurrRaw =
        typeof req.query.epsCurr === 'string' && req.query.epsCurr.trim() !== ''
          ? Number(req.query.epsCurr)
          : undefined;
      const avgPeRaw =
        typeof req.query.avgPeRatio === 'string' && req.query.avgPeRatio.trim() !== ''
          ? Number(req.query.avgPeRatio)
          : undefined;
      const zoneTolRaw =
        typeof req.query.zoneTolerancePct === 'string'
          ? Number(req.query.zoneTolerancePct)
          : undefined;

      const rawMode = typeof req.query.correctionMode === 'string' ? req.query.correctionMode : '';
      const correctionMode =
        rawMode === 'EPS_VALUATION' || rawMode === 'INR' || rawMode === 'PCT'
          ? rawMode
          : undefined;

      const evaluation = nsePipeline.getUTurnEvaluation(sym, {
        customPeakPrice:
          peakRaw !== undefined && Number.isFinite(peakRaw) && peakRaw > 0 ? peakRaw : undefined,
        correctionMode,
        epsPrev: epsPrevRaw !== undefined && Number.isFinite(epsPrevRaw) ? epsPrevRaw : undefined,
        epsCurr: epsCurrRaw !== undefined && Number.isFinite(epsCurrRaw) ? epsCurrRaw : undefined,
        avgPeRatio:
          avgPeRaw !== undefined && Number.isFinite(avgPeRaw) && avgPeRaw > 0
            ? avgPeRaw
            : undefined,
        correctionPct:
          corrPctRaw !== undefined && Number.isFinite(corrPctRaw) && corrPctRaw > 0
            ? corrPctRaw
            : undefined,
        correctionInr:
          corrInrRaw !== undefined && Number.isFinite(corrInrRaw) && corrInrRaw > 0
            ? corrInrRaw
            : undefined,
        zoneTolerancePct: zoneTolRaw === 3 ? 3 : 2,
      });

      if (!evaluation) {
        return res.status(404).json({
          error: `U-Turn evaluation unavailable for ${sym} (insufficient history).`,
        });
      }
      return res.json(evaluation);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Turnaround Top Valuation & Exhaustion Evaluator (Effective TTM EPS * Peak PE)
  app.get('/api/stock/:symbol/uturn-top', async (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const detail = nsePipeline.getStockDetail(sym);
      if (!detail) {
        return res.status(404).json({
          error: `Symbol ${sym} not found in NSE Mainboard dataset.`,
        });
      }

      const hasManualOverride =
        (typeof req.query.effectiveEps === 'string' && req.query.effectiveEps.trim() !== '') ||
        (typeof req.query.peakPeRatio === 'string' && req.query.peakPeRatio.trim() !== '');

      if (
        !hasManualOverride &&
        (detail.fundamentals?.epsCurr === null ||
          detail.fundamentals?.epsCurr === undefined ||
          detail.fundamentals?.epsTtmCurr === null ||
          detail.fundamentals?.epsTtmCurr === undefined)
      ) {
        const fetched = await ensureLiveFundamentalsForSymbol(
          sym,
          nsePipeline.getXbrlFilingsForSymbol(sym)
        );
        if (fetched && (fetched.epsCurr !== null || fetched.epsTtmCurr !== null)) {
          nsePipeline.reload();
        }
      }

      const effEpsRaw =
        typeof req.query.effectiveEps === 'string' && req.query.effectiveEps.trim() !== ''
          ? Number(req.query.effectiveEps)
          : undefined;
      const peakPeRaw =
        typeof req.query.peakPeRatio === 'string' && req.query.peakPeRatio.trim() !== ''
          ? Number(req.query.peakPeRatio)
          : undefined;

      const evaluation = nsePipeline.getTurnaroundTopEvaluation(sym, {
        customEffectiveEps:
          effEpsRaw !== undefined && Number.isFinite(effEpsRaw) && effEpsRaw > 0
            ? effEpsRaw
            : undefined,
        customPeakPe:
          peakPeRaw !== undefined && Number.isFinite(peakPeRaw) && peakPeRaw > 0
            ? peakPeRaw
            : undefined,
      });

      if (!evaluation) {
        return res.status(404).json({
          error: `Turnaround Top evaluation unavailable for ${sym} (insufficient history).`,
        });
      }
      return res.json(evaluation);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Historical Signal Log & Evaluated Outcomes
  app.get('/api/signals', (req, res) => {
    try {
      const result = nsePipeline.querySignals({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        setup: typeof req.query.setup === 'string' ? req.query.setup : undefined,
        delivery: typeof req.query.delivery === 'string' ? req.query.delivery : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Portfolio Risk & Position Sizing Calculator
  app.post('/api/risk/calculate', (req, res) => {
    try {
      const result = evaluateRiskControls(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Automatic & Explicit Fundamental Save-to-Cache (Single Symbol or Full NSE Universe)
  app.post('/api/fundamentals/save-to-cache', async (req, res) => {
    try {
      const symbol =
        typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
      const saveAll = Boolean(req.body?.saveAll);

      if (symbol) {
        const forceBse = req.body?.force !== undefined ? Boolean(req.body.force) : true;
        const result = await saveSymbolFundamentalsToCache(
          symbol,
          nsePipeline.getXbrlFilingsForSymbol(symbol),
          forceBse
        );
        if (result.record) {
          nsePipeline.reload();
        }
        const detail = nsePipeline.getStockDetail(symbol);
        return res.json({
          saved: Boolean(result.record),
          symbol,
          totalSavedCount: result.totalSavedCount,
          error: result.error || null,
          summary: detail?.summary ?? null,
          auditEntry: detail?.fundamentalAuditRows?.[0] ?? null,
        });
      }

      if (saveAll) {
        const rawScope =
          typeof req.body?.scope === 'string' ? req.body.scope.toUpperCase() : 'MISSING_OR_OLD';
        const scope: 'MISSING_OR_OLD' | 'NOT_AVAILABLE' | 'LIQUID' | 'ALL' =
          rawScope === 'NOT_AVAILABLE' || rawScope === 'LIQUID' || rawScope === 'ALL'
            ? rawScope
            : 'MISSING_OR_OLD';

        const targets = nsePipeline.getAuditCollectionTargets(scope);
        if (targets.length === 0) {
          return res.json({
            started: false,
            ...getCollectionJobStatus(),
            message: 'All NSE stocks in selected scope are already saved & up to date in cache.',
          });
        }

        const status = startFullFundamentalCollection(
          targets,
          scope,
          nsePipeline.getXbrlBySymbolMap(),
          () => nsePipeline.reload()
        );
        return res.json({
          started: true,
          ...status,
        });
      }

      return res.status(400).json({
        error: 'Provide either { symbol } or { saveAll: true } in request body.',
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Live Fundamental Fetcher (Single Symbol or Batch Missing Liquidity-Qualified)
  app.post('/api/refresh/fundamentals', async (req, res) => {
    try {
      const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
      const batchMissing = Boolean(req.body?.batchMissing);
      const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 25)));

      let targets: string[] = [];
      if (symbol) {
        targets = [symbol];
      } else if (batchMissing) {
        targets = nsePipeline.getMissingFundamentalCandidates(limit);
      } else {
        return res.status(400).json({ error: 'Provide either symbol or batchMissing: true.' });
      }

      if (targets.length === 0) {
        return res.json({
          succeeded: [],
          failed: [],
          message: 'All liquidity-qualified candidates already have complete fundamentals.',
        });
      }

      const forceBse = Boolean(req.body?.forceBse);
      const result = await refreshFundamentalsBatch(targets, nsePipeline.getXbrlBySymbolMap(), forceBse);
      if (result.succeeded.length > 0) {
        nsePipeline.reload();
      }
      return res.json({
        ...result,
        message: `Collected & saved Screener.in + BSE Official + NSE XBRL fundamentals for ${result.succeeded.length}/${targets.length} symbol(s).`,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Fundamental Audit Universe Query (NSE/BSE Mapping & Freshness Tiers)
  app.get('/api/fundamentals/audit', (req, res) => {
    try {
      const result = nsePipeline.queryFundamentalAudit({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        tier: typeof req.query.tier === 'string' ? req.query.tier : undefined,
        exchange: typeof req.query.exchange === 'string' ? req.query.exchange : undefined,
        basis: typeof req.query.basis === 'string' ? req.query.basis : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Full-Universe Multi-Source Fundamental Collection (NSE XBRL + YFinance .NS + BSE .BO)
  app.post('/api/fundamentals/collect-all', (req, res) => {
    try {
      const rawScope = typeof req.body?.scope === 'string' ? req.body.scope.toUpperCase() : 'MISSING_OR_OLD';
      const scope: 'MISSING_OR_OLD' | 'NOT_AVAILABLE' | 'LIQUID' | 'ALL' =
        rawScope === 'NOT_AVAILABLE' || rawScope === 'LIQUID' || rawScope === 'ALL'
          ? rawScope
          : 'MISSING_OR_OLD';
      const limitNum = Number(req.body?.limit);
      const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(3000, limitNum) : undefined;

      const targets = nsePipeline.getAuditCollectionTargets(scope, limit);
      if (targets.length === 0) {
        return res.json({
          ...getCollectionJobStatus(),
          message: 'All stocks in selected scope already have latest fundamentals.',
        });
      }

      const status = startFullFundamentalCollection(
        targets,
        scope,
        nsePipeline.getXbrlBySymbolMap(),
        () => nsePipeline.reload()
      );
      return res.json(status);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/fundamentals/collect-status', (_req, res) => {
    res.json(getCollectionJobStatus());
  });

  // Verified Fundamental Data Service (Screener.in + BSE Official + NSE XBRL + guarded Yahoo fallback)
  app.get('/api/fundamentals/verified/:symbol', async (req, res) => {
    try {
      const sym = String(req.params.symbol || '').trim().toUpperCase();
      if (!sym) {
        return res.status(400).json({ error: 'Symbol is required.' });
      }
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const forceBseProbe = req.query.bse === '1' || req.query.bse === 'true';
      const allowYahooSupplement = req.query.yahoo !== '0';

      const result = await getVerifiedFundamentals(sym, {
        xbrlFilings: nsePipeline.getXbrlFilingsForSymbol(sym),
        forceRefresh,
        forceBseProbe,
        allowYahooSupplement,
      });

      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/fundamentals/service-health', (_req, res) => {
    try {
      return res.json(getFundamentalServiceHealth());
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/fundamentals/cache/evict', (req, res) => {
    try {
      const symbol =
        typeof req.body?.symbol === 'string' && req.body.symbol.trim()
          ? req.body.symbol.trim().toUpperCase()
          : undefined;
      return res.json(evictFundamentalCache(symbol));
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Live NSE Bhavcopy Sync (catches up all missing sessions automatically unless target date given)
  app.post('/api/refresh/bhavcopy', async (req, res) => {
    try {
      const targetDate = typeof req.body?.date === 'string' ? req.body.date.trim() : undefined;
      if (targetDate) {
        const result = await fetchNseBhavcopyForDate(targetDate);
        if (result.status === 'DOWNLOADED') {
          nsePipeline.reload();
        }
        return res.json(result);
      }
      const catchup = await syncLatestBhavcopiesCatchup(10);
      if (catchup.downloadedDates.length > 0) {
        nsePipeline.reload();
      }
      const overview = nsePipeline.getOverview();
      return res.json({
        status: catchup.downloadedDates.length > 0 ? 'DOWNLOADED' : 'ALREADY_CACHED',
        date: catchup.latestCachedDate,
        downloadedDates: catchup.downloadedDates,
        latestSessionDate: overview.latestSessionDate,
        sessionsLoaded: overview.sessionsLoaded,
        message: catchup.message,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // 1-Click Full Scanner Reload: Catch up missing Bhavcopies + Sync 30D Bulk/Block + Recompute Entire Pipeline
  app.post('/api/scanner/reload-all', async (_req, res) => {
    try {
      const catchup = await syncLatestBhavcopiesCatchup(12);
      nsePipeline.reload();
      syncT1T2DailySnapshots();
      const refIso = nsePipeline.getLatestSessionRefIso();
      const bulkStore = await syncNseBulkBlockDeals(refIso, { force: true });
      const overview = nsePipeline.getOverview();

      return res.json({
        reloaded: true,
        latestSessionDate: overview.latestSessionDate,
        sessionsLoaded: overview.sessionsLoaded,
        totalStocks: overview.funnel.universeMainboard,
        downloadedDates: catchup.downloadedDates,
        latestCachedDate: catchup.latestCachedDate,
        todayIstIso: catchup.todayIstIso,
        todayPublishedYet: catchup.todayPublishedYet,
        bulkDeals30D: bulkStore.deals.length,
        message: catchup.message,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Personal Trade Journal (Persistent Entry/Exit Notes, Sentiment Observations & Lessons Learned)
  app.get('/api/journal', (req, res) => {
    try {
      const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : undefined;
      return res.json({ entries: listTradeJournalEntries(symbol) });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/stock/:symbol/journal', (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      return res.json({ symbol: sym, entries: listTradeJournalEntries(sym) });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/stock/:symbol/journal', (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const result = createTradeJournalEntry({
        symbol: sym,
        tradeDate: typeof req.body?.tradeDate === 'string' ? req.body.tradeDate : undefined,
        action: req.body?.action,
        entryPrice: req.body?.entryPrice,
        exitPrice: req.body?.exitPrice,
        stopLoss: req.body?.stopLoss,
        sentiment: req.body?.sentiment,
        setupTag: req.body?.setupTag,
        entryExitNotes: req.body?.entryExitNotes,
        sentimentNotes: req.body?.sentimentNotes,
        lessonsLearned: req.body?.lessonsLearned,
      });
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/stock/:symbol/journal/:id', (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const id = req.params.id.trim();
      const result = updateTradeJournalEntry(sym, id, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      return res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  app.delete('/api/stock/:symbol/journal/:id', (req, res) => {
    try {
      const sym = req.params.symbol.trim().toUpperCase();
      const id = req.params.id.trim();
      const result = deleteTradeJournalEntry(sym, id);
      return res.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      return res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  // Starred Watchlist & U-Turn Entry Trigger Alerts
  app.get('/api/watchlist', (_req, res) => {
    try {
      return res.json(buildWatchlistResponse(nsePipeline.getAllScreenerRows()));
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/watchlist/toggle', (req, res) => {
    try {
      const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
      const toggled = toggleWatchlistSymbol(symbol);
      return res.json({
        starred: toggled.starred,
        ...buildWatchlistResponse(nsePipeline.getAllScreenerRows()),
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/watchlist/:symbol', (req, res) => {
    try {
      removeWatchlistSymbol(req.params.symbol);
      return res.json(buildWatchlistResponse(nsePipeline.getAllScreenerRows()));
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  // Open-Source v3 Swing Trading Bot (Zero API Keys, Zero Fake Data, Paper Trading Default)
  app.get('/api/bot/macro-news', async (req, res) => {
    try {
      const overview = nsePipeline.getOverview();
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const data = await getOpenMacroAndNewsDashboard({
        allRows: nsePipeline.getAllScreenerRows(),
        marketSentimentScore: overview.marketSentiment.score,
        ema21BreadthPct: overview.marketSentiment.aboveEma21Pct,
        forceRefresh,
      });
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/bot/daily-scan', async (req, res) => {
    try {
      const rawScope =
        typeof req.query.scope === 'string' ? req.query.scope.toUpperCase() : 'LIQUID_TIERS';
      const scope: 'LIQUID_TIERS' | 'WATCHLIST' | 'DELIV_HIGH' | 'TOP_SECTORS' | 'IPO' =
        rawScope === 'WATCHLIST' ||
        rawScope === 'DELIV_HIGH' ||
        rawScope === 'TOP_SECTORS' ||
        rawScope === 'IPO'
          ? rawScope
          : 'LIQUID_TIERS';
      const limit =
        typeof req.query.limit === 'string' && Number.isFinite(Number(req.query.limit))
          ? Number(req.query.limit)
          : 12;
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const result = await runDailyBotScanner({ scope, q, limit, forceRefresh });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/bot/stock/:symbol', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const analysis = await analyzeStockWithV3Bot(req.params.symbol, { forceRefresh });
      return res.json(analysis);
    } catch (err) {
      const msg = (err as Error).message || 'Bot evaluation failed.';
      return res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  app.get('/api/bot/stock/:symbol/backtest', async (req, res) => {
    try {
      const holdDays =
        typeof req.query.holdDays === 'string' ? Number(req.query.holdDays) : undefined;
      const stopPct =
        typeof req.query.stopPct === 'string' ? Number(req.query.stopPct) : undefined;
      const targetPct =
        typeof req.query.targetPct === 'string' ? Number(req.query.targetPct) : undefined;
      const report = await runBotBacktestFramework(req.params.symbol, {
        holdDays: Number.isFinite(holdDays) ? holdDays : undefined,
        stopPct: Number.isFinite(stopPct) ? stopPct : undefined,
        targetPct: Number.isFinite(targetPct) ? targetPct : undefined,
      });
      return res.json(report);
    } catch (err) {
      const msg = (err as Error).message || 'Bot backtest failed.';
      return res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  // Multi-Filter Confluence Recommended Stocks + Open-Source Research Briefs
  app.get('/api/bot/recommendations', async (req, res) => {
    try {
      const limit =
        typeof req.query.limit === 'string' && Number.isFinite(Number(req.query.limit))
          ? Number(req.query.limit)
          : 8;
      const result = await recommendStocksWithOpenAnalysis({ limit });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Live Checking Price Quote (Yahoo Finance .NS/.BO open-source feed — DATA NOT AVAILABLE if unreachable)
  app.get('/api/stock/:symbol/live-quote', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const quote = await fetchLiveYahooQuote(req.params.symbol, forceRefresh);
      return res.json(quote);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Batch Live Checking Quotes for Screener Page (max 50 symbols; preserves EOD Bhavcopy scanner)
  app.post('/api/stocks/live-quotes', async (req, res) => {
    try {
      const symbols = Array.isArray(req.body?.symbols)
        ? req.body.symbols.filter((s: unknown): s is string => typeof s === 'string')
        : [];
      const forceRefresh = req.body?.refresh === true || req.body?.refresh === '1';
      const quotes = await fetchBatchLiveYahooQuotes(symbols, forceRefresh);
      return res.json({
        fetchedAtUtc: new Date().toISOString(),
        quotes,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Daily T1 & T2 Report (All Stocks + IPO Sector + Yesterday/Today Memory + Daily Repeaters)
  app.get('/api/reports/t1-t2', async (req, res) => {
    try {
      const includeLive = req.query.live === '1' || req.query.live === 'true';
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const report = await buildT1T2DailyReport({ includeLive, forceRefresh });
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/reports/t1-t2/csv', async (req, res) => {
    try {
      const includeLive = req.query.live !== '0';
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const report = await buildT1T2DailyReport({ includeLive, forceRefresh });
      const csv = formatT1T2ReportCsv(report);
      const filename = `T1_T2_Daily_Report_${report.todayDate || 'latest'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Paper Trading BUY / SELL Journal & Strategy Profit Analytics
  app.get('/api/paper-trades', async (req, res) => {
    try {
      const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : undefined;
      const fetchLive = req.query.live !== '0';
      const summary = await listPaperPortfolioSummary({ symbol, fetchLive });
      return res.json(summary);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/paper-trades/sync', async (req, res) => {
    try {
      const clientTrades = Array.isArray(req.body?.trades) ? req.body.trades : [];
      const deletedIds = Array.isArray(req.body?.deletedIds) ? req.body.deletedIds : [];
      const fetchLive = req.body?.fetchLive !== false;
      const result = await syncPaperTrades({ clientTrades, deletedIds, fetchLive });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/paper-trades/buy', async (req, res) => {
    try {
      const result = await createPaperBuyTrade({
        symbol: typeof req.body?.symbol === 'string' ? req.body.symbol : '',
        quantity: req.body?.quantity,
        entryPrice: req.body?.entryPrice,
        stopLoss: req.body?.stopLoss,
        targetPrice: req.body?.targetPrice,
        strategyTag: req.body?.strategyTag,
        notes: req.body?.notes,
        preferLive: req.body?.preferLive !== false,
      });
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/paper-trades/:id/sell', async (req, res) => {
    try {
      const result = await closePaperSellTrade(req.params.id, {
        exitPrice: req.body?.exitPrice,
        notes: req.body?.notes,
      });
      return res.json(result);
    } catch (err) {
      const msg = (err as Error).message || 'Paper sell failed.';
      return res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  app.delete('/api/paper-trades/:id', async (req, res) => {
    try {
      const portfolio = await deletePaperTrade(req.params.id);
      return res.json(portfolio);
    } catch (err) {
      const msg = (err as Error).message || 'Delete failed.';
      return res.status(msg.includes('not found') ? 404 : 400).json({ error: msg });
    }
  });

  // ECMS Gemini Evidence-Aware Research (Untouched ECMS Workflow)
  app.post('/api/ecms/gemini-research', async (req, res) => {
    try {
      const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
      const useSearchGrounding = Boolean(req.body?.useSearchGrounding);
      if (!symbol.trim()) {
        return res.status(400).json({ error: 'Symbol is required.' });
      }
      const stock = nsePipeline.getStockDetail(symbol);
      if (!stock) {
        return res.status(404).json({ error: `Symbol ${symbol.toUpperCase()} not found.` });
      }
      const report = await runEcmsGeminiResearch(stock, useSearchGrounding);
      return res.json(report);
    } catch (err) {
      const message = (err as Error).message || 'Gemini research failed.';
      const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
      return res.status(status).json({ error: message });
    }
  });

  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`NSE V8 & ECMS Research server running at http://${HOST}:${PORT}`);

    // Non-blocking startup sync: Catch up latest NSE Bhavcopy + 30D Bulk/Block CSV + Quote Calendar & IPO Dates + Auto Fundamental Collector
    setTimeout(() => {
      void (async () => {
        try {
          const catchup = await syncLatestBhavcopiesCatchup(10);
          if (catchup.downloadedDates.length > 0) {
            console.log(`Startup Bhavcopy catchup downloaded: ${catchup.downloadedDates.join(', ')}`);
            nsePipeline.reload();
          }

          const refIso = nsePipeline.getLatestSessionRefIso();
          await syncNseBulkBlockDeals(refIso);

          const catalystCacheFile = path.join(
            process.cwd(),
            'data',
            'research',
            'catalysts_cache.json'
          );
          let lastQuoteSyncMs = 0;
          if (fs.existsSync(catalystCacheFile)) {
            try {
              const raw = JSON.parse(fs.readFileSync(catalystCacheFile, 'utf-8')) as {
                lastUniverseQuoteSyncUtc?: string;
              };
              if (raw?.lastUniverseQuoteSyncUtc) {
                lastQuoteSyncMs = Date.parse(raw.lastUniverseQuoteSyncUtc) || 0;
              }
            } catch {
              lastQuoteSyncMs = 0;
            }
          }

          if (!lastQuoteSyncMs || Date.now() - lastQuoteSyncMs > 6 * 60 * 60 * 1000) {
            await syncUniverseQuoteCalendarAndIpo(nsePipeline.getAllSymbols(), refIso, () =>
              nsePipeline.reload()
            );
          }

          if (!getCollectionJobStatus().running) {
            const missingTargets = nsePipeline.getAuditCollectionTargets('MISSING_OR_OLD', 40);
            if (missingTargets.length > 0) {
              startFullFundamentalCollection(
                missingTargets,
                'AUTO_MISSING_OR_OLD',
                nsePipeline.getXbrlBySymbolMap(),
                () => nsePipeline.reload()
              );
            }
          }
        } catch (err) {
          console.error('Startup background sync warning:', (err as Error).message);
        }
      })();
    }, 2500);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
