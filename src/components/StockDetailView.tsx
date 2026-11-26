import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Calculator,
  CheckCircle2,
  ExternalLink,
  GitCompareArrows,
  Info,
  Newspaper,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  BotStockAnalysis,
  GeminiResearchResult,
  LiveStockQuote,
  StockCatalystProfile,
  StockDetailData,
  StockLiveNewsResponse,
} from '../types/trading';
import { classifyBurstPowerProfile } from '../utils/burstPowerProfile';
import { formatMarketCapCr, getCapBadgeClass, getCapLabel } from '../utils/marketCap';
import { evaluateQuoteFreshness } from '../utils/quoteFreshness';
import { StockBacktestCard } from './StockBacktestCard';
import { InstitutionalFlowChart } from './InstitutionalFlowChart';
import { UTurnStrategyMonitor } from './UTurnStrategyMonitor';
import { FundamentalAuditTable } from './FundamentalAuditTable';
import { SwingTierSpecPanel } from './SwingTierSpecPanel';
import { UpcomingEventsNewsPanel } from './UpcomingEventsNewsPanel';
import { QuarterlyEpsValuationPanel } from './QuarterlyEpsValuationPanel';
import { TrendStrengthCard } from './TrendStrengthCard';
import { TradeJournalPanel } from './TradeJournalPanel';
import { BotStockAuditCard } from './BotStockAuditCard';
import { PaperTradingPanel } from './PaperTradingPanel';
import { StockComparisonPanel } from './StockComparisonPanel';
import { PeerCorrelationMatrixCard } from './PeerCorrelationMatrixCard';
import { DividendHistoryChartCard } from './DividendHistoryChartCard';
import { PriceAlertPanel } from './PriceAlertPanel';
import { CatalystNewsCard } from './CatalystNewsCard';
import { RsiDivergenceCard } from './RsiDivergenceCard';
import { executePaperBuy, getOpenVaultSymbolCounts } from '../utils/paperTradeClient';
import {
  detectRsiDivergences,
  type RsiDivergenceSignal,
} from '../utils/rsiDivergence';
import {
  evaluatePriceAlerts,
  loadPriceAlerts,
  PRICE_ALERTS_STORAGE_KEY,
  PRICE_ALERTS_UPDATED_EVENT,
} from '../utils/priceAlerts';

interface StockDetailViewProps {
  symbol: string;
  onSelectSymbol: (symbol: string) => void;
  onSendToRisk: (symbol: string, entryPrice: number, stopLoss: number) => void;
  isStarred?: boolean;
  onToggleWatchlist?: (symbol: string) => void;
  externalRefreshSeq?: number;
}

export const StockDetailView: React.FC<StockDetailViewProps> = ({
  symbol,
  onSelectSymbol,
  onSendToRisk,
  isStarred = false,
  onToggleWatchlist,
  externalRefreshSeq = 0,
}) => {
  const [searchInput, setSearchInput] = useState(symbol);
  const [data, setData] = useState<StockDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const [fundFetching, setFundFetching] = useState(false);
  const [fundNotice, setFundNotice] = useState<string | null>(null);

  const [useSearchGrounding, setUseSearchGrounding] = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiReport, setGeminiReport] = useState<GeminiResearchResult | null>(null);

  const [catalystData, setCatalystData] = useState<StockCatalystProfile | null>(null);
  const [catalystLoading, setCatalystLoading] = useState(false);
  const [catalystError, setCatalystError] = useState<string | null>(null);

  const [stockNews, setStockNews] = useState<StockLiveNewsResponse | null>(null);
  const [stockNewsLoading, setStockNewsLoading] = useState(false);
  const [stockNewsError, setStockNewsError] = useState<string | null>(null);

  const [liveQuote, setLiveQuote] = useState<LiveStockQuote | null>(null);
  const [liveQuoteLoading, setLiveQuoteLoading] = useState(false);
  const [paperSeq, setPaperSeq] = useState(0);
  const [paperBuying, setPaperBuying] = useState(false);
  const [paperNotice, setPaperNotice] = useState<string | null>(null);
  const [botAnalysis, setBotAnalysis] = useState<BotStockAnalysis | null>(null);
  const [showBurstTooltip, setShowBurstTooltip] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [symbolAlertCount, setSymbolAlertCount] = useState(0);
  const [selectedDivergenceId, setSelectedDivergenceId] = useState<string | null>(null);
  const [chartOverlayMode, setChartOverlayMode] = useState<
    'PRICE_DELIV' | 'VOLATILITY_ATR' | 'RSI_DIVERGENCE'
  >('PRICE_DELIV');

  const rsiDivergence = useMemo(
    () => (data ? detectRsiDivergences(data.history) : null),
    [data]
  );

  const burstProfile = useMemo(
    () => (botAnalysis ? classifyBurstPowerProfile(botAnalysis.phase4Movement) : null),
    [botAnalysis]
  );

  const activeReferencePrice = useMemo(() => {
    if (liveQuote?.available && liveQuote.livePrice !== null && liveQuote.livePrice > 0) {
      return liveQuote.livePrice;
    }
    return data?.summary.closePrice ?? null;
  }, [liveQuote, data]);

  useEffect(() => {
    const syncAlertCount = () => {
      const upper = symbol.trim().toUpperCase();
      const count = loadPriceAlerts().filter(
        (a) => a.symbol === upper && a.triggeredAt === null
      ).length;
      setSymbolAlertCount(count);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PRICE_ALERTS_STORAGE_KEY) syncAlertCount();
    };
    syncAlertCount();
    window.addEventListener(PRICE_ALERTS_UPDATED_EVENT, syncAlertCount);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PRICE_ALERTS_UPDATED_EVENT, syncAlertCount);
      window.removeEventListener('storage', onStorage);
    };
  }, [symbol]);

  useEffect(() => {
    if (!data || activeReferencePrice === null) return;
    evaluatePriceAlerts({ [data.summary.symbol]: activeReferencePrice });
  }, [data, activeReferencePrice]);

  const loadLiveQuote = useCallback(async (sym: string, forceRefresh = false) => {
    setLiveQuoteLoading(true);
    try {
      const res = await fetch(
        `/api/stock/${encodeURIComponent(sym)}/live-quote${forceRefresh ? '?refresh=1' : ''}`
      );
      if (!res.ok) return;
      const json: LiveStockQuote = await res.json();
      setLiveQuote(json);
    } catch {
      // ignore transient quote error
    } finally {
      setLiveQuoteLoading(false);
    }
  }, []);

  const loadCatalysts = useCallback(async (sym: string, forceRefresh = false) => {
    setCatalystLoading(true);
    setCatalystError(null);
    try {
      const url = `/api/stock/${encodeURIComponent(sym)}/catalysts${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCatalystData(json);
    } catch (err) {
      setCatalystError((err as Error).message || 'Failed to load stock catalysts');
    } finally {
      setCatalystLoading(false);
    }
  }, []);

  const loadStockNews = useCallback(async (sym: string, forceRefresh = false) => {
    setStockNewsLoading(true);
    setStockNewsError(null);
    try {
      const url = `/api/stock/${encodeURIComponent(sym)}/news${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setStockNews(json);
    } catch (err) {
      setStockNewsError((err as Error).message || 'Failed to load live news & announcements');
    } finally {
      setStockNewsLoading(false);
    }
  }, []);

  const loadStock = useCallback(async (sym: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/${encodeURIComponent(sym)}`, { signal });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setHoverIdx(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSearchInput(symbol);
    setGeminiReport(null);
    setGeminiError(null);
    setFundNotice(null);
    setCatalystData(null);
    setStockNews(null);
    setStockNewsError(null);
    setLiveQuote(null);
    setPaperNotice(null);
    setBotAnalysis(null);
    setShowBurstTooltip(false);
    setSelectedDivergenceId(null);
    const controller = new AbortController();
    void loadStock(symbol, controller.signal);
    void loadCatalysts(symbol, false);
    void loadStockNews(symbol, false);
    void loadLiveQuote(symbol, false);
    return () => controller.abort();
  }, [symbol, loadStock, loadCatalysts, loadStockNews, loadLiveQuote]);

  const [heldCounts, setHeldCounts] = useState<Record<string, number>>(() =>
    getOpenVaultSymbolCounts()
  );

  useEffect(() => {
    const refreshHeld = () => setHeldCounts(getOpenVaultSymbolCounts());
    window.addEventListener('paper-portfolio-updated', refreshHeld);
    return () => window.removeEventListener('paper-portfolio-updated', refreshHeld);
  }, []);

  useEffect(() => {
    if (externalRefreshSeq > 0) {
      void loadStock(symbol);
      void loadCatalysts(symbol, true);
      void loadStockNews(symbol, true);
      void loadLiveQuote(symbol, true);
    }
  }, [externalRefreshSeq, symbol, loadStock, loadCatalysts, loadStockNews, loadLiveQuote]);

  const handleQuickPaperBuy = async () => {
    if (!data || paperBuying) return;
    setPaperBuying(true);
    setPaperNotice(null);
    try {
      const refPrice =
        liveQuote?.available && liveQuote.livePrice !== null
          ? liveQuote.livePrice
          : data.summary.closePrice;
      const strategyTag =
        data.summary.uTurnStatus === 'ACTIVE_TRIGGER' ||
        data.summary.uTurnStatus === 'CONFIRMED_SUPPORT'
          ? 'U-Turn'
          : data.summary.swingTier === 'TIER_1_READY'
            ? 'Swing Tier 1'
            : data.summary.deliveryCategory !== 'NONE'
              ? 'Delivery A/B'
              : 'v3 Bot';
      const json = await executePaperBuy({
        symbol: data.summary.symbol,
        entryPrice: refPrice,
        stopLoss:
          data.summary.suggestedStopLoss ?? Number((refPrice * 0.92).toFixed(2)),
        targetPrice: Number((refPrice * 1.15).toFixed(2)),
        strategyTag,
        notes: `1-Click Paper BUY (${strategyTag})`,
        preferLive: true,
      });
      setPaperSeq((n) => n + 1);
      setPaperNotice(
        `Paper BUY locked in portfolio: ${json.trade.symbol} x ${json.trade.quantity} @ ₹${json.trade.entryPrice.toFixed(2)} (${json.trade.entryPriceSource})`
      );
      document.getElementById('paper-trading-section')?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      setPaperNotice(`Paper BUY error: ${(err as Error).message}`);
    } finally {
      setPaperBuying(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = searchInput.trim().toUpperCase();
    if (cleaned && cleaned !== symbol) {
      onSelectSymbol(cleaned);
    }
  };

  const handleFetchLiveFundamentals = async () => {
    if (!data) return;
    setFundFetching(true);
    setFundNotice(null);
    try {
      const res = await fetch('/api/fundamentals/save-to-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: data.summary.symbol, force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await loadStock(data.summary.symbol);
      if (json.saved) {
        setFundNotice(
          `Verified & saved fundamentals from Screener.in + BSE Official + NSE XBRL (${json.totalSavedCount} cached).`
        );
      } else {
        const failMsg = json.error || 'No additional metrics returned.';
        setFundNotice(`Verification incomplete: ${failMsg}`);
      }
    } catch (err) {
      setFundNotice(`Verification failed: ${(err as Error).message}`);
    } finally {
      setFundFetching(false);
    }
  };

  // Untouched ECMS Gemini Research handler
  const handleRunGeminiResearch = async () => {
    if (!data) return;
    setGeminiLoading(true);
    setGeminiError(null);
    try {
      const res = await fetch('/api/ecms/gemini-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: data.summary.symbol,
          useSearchGrounding,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setGeminiReport(json);
    } catch (err) {
      setGeminiError((err as Error).message || 'Gemini research failed.');
    } finally {
      setGeminiLoading(false);
    }
  };

  const chartModel = useMemo(() => {
    if (!data || data.history.length === 0) return null;
    const h = data.history;
    const width = 880;
    const priceHeight = 200;
    const volHeight = 110;
    const padL = 56;
    const padR = 52;
    const plotW = width - padL - padR;

    // Compute per-session True Range, 14-session rolling ATR, ATR%, and 30-day rolling ATR% baseline
    const trueRanges: number[] = h.map((d, i) => {
      const prevClose =
        i > 0
          ? (h[i - 1].close ?? d.prevClose ?? d.open ?? d.close)
          : (d.prevClose ?? d.open ?? d.close);
      const hi = d.high ?? d.close ?? prevClose ?? 0;
      const lo = d.low ?? d.close ?? prevClose ?? 0;
      if (prevClose === null || prevClose === undefined) return Math.max(0, hi - lo);
      return Math.max(hi - lo, Math.abs(hi - prevClose), Math.abs(lo - prevClose));
    });

    const atr14Series: Array<number | null> = h.map((_, i) => {
      const lookback = Math.min(14, i + 1);
      if (lookback < 2) return null;
      const slice = trueRanges.slice(i - lookback + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    const atrPctSeries: Array<number | null> = h.map((d, i) => {
      const atr = atr14Series[i];
      const close = d.close;
      if (atr === null || close === null || close <= 0) return null;
      return (atr / close) * 100;
    });

    const atrPct30MeanSeries: Array<number | null> = h.map((_, i) => {
      const start = Math.max(0, i - 29);
      const slice = atrPctSeries
        .slice(start, i + 1)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (slice.length < 3) return null;
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    const volMetrics = h.map((d, i) => {
      const atr14 = atr14Series[i];
      const atrPct = atrPctSeries[i];
      const atrPct30Mean = atrPct30MeanSeries[i];
      const anchor = d.ema21 ?? d.sma20 ?? d.close;
      const upperEnv =
        atr14 !== null && anchor !== null ? anchor + 1.5 * atr14 : null;
      const lowerEnv =
        atr14 !== null && anchor !== null ? Math.max(0.05, anchor - 1.5 * atr14) : null;
      const compressionRatio =
        atrPct !== null && atrPct30Mean !== null && atrPct30Mean > 0
          ? atrPct / atrPct30Mean
          : null;
      const isSqueeze =
        compressionRatio !== null && compressionRatio <= 0.88;
      return {
        date: d.date,
        atr14,
        atrPct,
        atrPct30Mean,
        upperEnv,
        lowerEnv,
        compressionRatio,
        isSqueeze,
      };
    });

    const closes = h.map((d) => d.close ?? 0).filter((c) => c > 0);
    const smas = h.map((d) => d.sma20).filter((c): c is number => c !== null);
    const emas = h.map((d) => d.ema21).filter((c): c is number => c !== null);
    const ema44s = h.map((d) => d.ema44).filter((c): c is number => c !== null);
    const upperEnvs = volMetrics.map((m) => m.upperEnv).filter((v): v is number => v !== null);
    const lowerEnvs = volMetrics.map((m) => m.lowerEnv).filter((v): v is number => v !== null);

    const allPrices = [...closes, ...smas, ...emas, ...ema44s];
    const minP = Math.min(...allPrices) * 0.985;
    const maxP = Math.max(...allPrices) * 1.015;
    const pRange = Math.max(maxP - minP, 0.01);

    const divPivotPrices = [
      ...(rsiDivergence?.swingHighs.map((p) => p.price) ?? []),
      ...(rsiDivergence?.swingLows.map((p) => p.price) ?? []),
    ];
    const allDivPrices = [...closes, ...emas, ...divPivotPrices];
    const minDivP = (allDivPrices.length > 0 ? Math.min(...allDivPrices) : minP) * 0.985;
    const maxDivP = (allDivPrices.length > 0 ? Math.max(...allDivPrices) : maxP) * 1.015;
    const divPRange = Math.max(maxDivP - minDivP, 0.01);

    const allVolPrices = [...allPrices, ...upperEnvs, ...lowerEnvs];
    const minVolP = Math.min(...allVolPrices) * 0.985;
    const maxVolP = Math.max(...allVolPrices) * 1.015;
    const volPRange = Math.max(maxVolP - minVolP, 0.01);

    const maxVol = Math.max(...h.map((d) => d.volume), 1);

    const atrVals = [
      ...volMetrics.map((m) => m.atrPct),
      ...volMetrics.map((m) => m.atrPct30Mean),
    ].filter((v): v is number => v !== null && Number.isFinite(v));
    const atrMinPct = atrVals.length > 0 ? Math.max(0, Math.min(...atrVals) * 0.8) : 0;
    const atrMaxPct = atrVals.length > 0 ? Math.max(...atrVals) * 1.12 : 6;
    const atrRange = Math.max(atrMaxPct - atrMinPct, 0.5);

    const xFor = (i: number) =>
      h.length <= 1 ? padL + plotW / 2 : padL + (i / (h.length - 1)) * plotW;
    const yPriceFor = (p: number) =>
      16 + (1 - (p - minP) / pRange) * (priceHeight - 32);
    const yDivPriceFor = (p: number) =>
      16 + (1 - (p - minDivP) / divPRange) * (priceHeight - 32);
    const yVolPriceFor = (p: number) =>
      16 + (1 - (p - minVolP) / volPRange) * (priceHeight - 32);
    const yDelivFor = (pct: number) =>
      10 + (1 - Math.min(100, Math.max(0, pct)) / 100) * (volHeight - 24);
    const yRsiFor = (rsi: number) =>
      12 + (1 - Math.min(100, Math.max(0, rsi)) / 100) * (volHeight - 24);
    const yAtrFor = (pct: number) =>
      12 + (1 - (pct - atrMinPct) / atrRange) * (volHeight - 24);

    const pricePoints = h
      .map((d, i) => (d.close !== null ? `${xFor(i).toFixed(1)},${yPriceFor(d.close).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const priceVolOverlayPoints = h
      .map((d, i) => (d.close !== null ? `${xFor(i).toFixed(1)},${yVolPriceFor(d.close).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const smaPoints = h
      .map((d, i) => (d.sma20 !== null ? `${xFor(i).toFixed(1)},${yPriceFor(d.sma20).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const emaPoints = h
      .map((d, i) => (d.ema21 !== null ? `${xFor(i).toFixed(1)},${yPriceFor(d.ema21).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const emaVolOverlayPoints = h
      .map((d, i) => (d.ema21 !== null ? `${xFor(i).toFixed(1)},${yVolPriceFor(d.ema21).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const ema44Points = h
      .map((d, i) => (d.ema44 !== null ? `${xFor(i).toFixed(1)},${yPriceFor(d.ema44).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const delivPoints = h
      .map((d, i) =>
        d.delivPer !== null ? `${xFor(i).toFixed(1)},${yDelivFor(d.delivPer).toFixed(1)}` : null
      )
      .filter((x): x is string => x !== null)
      .join(' ');

    const upperEnvCoords: string[] = [];
    const lowerEnvCoords: string[] = [];
    const upperEnvPairs: Array<{ x: number; y: number }> = [];
    const lowerEnvPairs: Array<{ x: number; y: number }> = [];
    volMetrics.forEach((m, i) => {
      if (m.upperEnv !== null && m.lowerEnv !== null) {
        const x = xFor(i);
        const yu = yVolPriceFor(m.upperEnv);
        const yl = yVolPriceFor(m.lowerEnv);
        upperEnvCoords.push(`${x.toFixed(1)},${yu.toFixed(1)}`);
        lowerEnvCoords.push(`${x.toFixed(1)},${yl.toFixed(1)}`);
        upperEnvPairs.push({ x, y: yu });
        lowerEnvPairs.push({ x, y: yl });
      }
    });

    const atrEnvAreaPath =
      upperEnvPairs.length >= 2
        ? `M ${upperEnvPairs.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} L ${[
            ...lowerEnvPairs,
          ]
            .reverse()
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' L ')} Z`
        : '';

    const atrPctPoints = volMetrics
      .map((m, i) => (m.atrPct !== null ? `${xFor(i).toFixed(1)},${yAtrFor(m.atrPct).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const atr30MeanPoints = volMetrics
      .map((m, i) =>
        m.atrPct30Mean !== null ? `${xFor(i).toFixed(1)},${yAtrFor(m.atrPct30Mean).toFixed(1)}` : null
      )
      .filter((x): x is string => x !== null)
      .join(' ');

    const priceDivPoints = h
      .map((d, i) => (d.close !== null ? `${xFor(i).toFixed(1)},${yDivPriceFor(d.close).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const emaDivPoints = h
      .map((d, i) => (d.ema21 !== null ? `${xFor(i).toFixed(1)},${yDivPriceFor(d.ema21).toFixed(1)}` : null))
      .filter((x): x is string => x !== null)
      .join(' ');

    const rsiSeries = rsiDivergence?.rsiSeries ?? [];
    const rsiPoints = rsiSeries
      .map((val, i) =>
        val !== null && Number.isFinite(val) ? `${xFor(i).toFixed(1)},${yRsiFor(val).toFixed(1)}` : null
      )
      .filter((x): x is string => x !== null)
      .join(' ');

    const squeezeSessionsCount = volMetrics.slice(-30).filter((m) => m.isSqueeze).length;
    const latestVolMetric = volMetrics[volMetrics.length - 1] ?? null;

    return {
      width,
      priceHeight,
      volHeight,
      padL,
      padR,
      plotW,
      minP,
      maxP,
      minDivP,
      maxDivP,
      minVolP,
      maxVolP,
      maxVol,
      atrMinPct,
      atrMaxPct,
      xFor,
      yPriceFor,
      yDivPriceFor,
      yVolPriceFor,
      yDelivFor,
      yRsiFor,
      yAtrFor,
      pricePoints,
      priceDivPoints,
      priceVolOverlayPoints,
      smaPoints,
      emaPoints,
      emaDivPoints,
      emaVolOverlayPoints,
      ema44Points,
      delivPoints,
      rsiSeries,
      rsiPoints,
      upperEnvPoints: upperEnvCoords.join(' '),
      lowerEnvPoints: lowerEnvCoords.join(' '),
      atrEnvAreaPath,
      atrPctPoints,
      atr30MeanPoints,
      volMetrics,
      squeezeSessionsCount,
      latestVolMetric,
      barW: Math.max(4, Math.min(16, plotW / Math.max(h.length, 1) - 3)),
      sliceW: plotW / Math.max(h.length - 1, 1),
    };
  }, [data, rsiDivergence]);

  const activeIdx =
    data && data.history.length > 0
      ? hoverIdx !== null && data.history[hoverIdx]
        ? hoverIdx
        : data.history.length - 1
      : 0;

  const activePoint =
    data && data.history.length > 0 ? data.history[activeIdx] : null;
  const activeVolMetric =
    chartModel && chartModel.volMetrics[activeIdx] ? chartModel.volMetrics[activeIdx] : null;

  const detectedPeak = useMemo(() => {
    if (!data || data.history.length === 0) {
      return { price: data?.summary.closePrice ?? 0, date: data?.summary.latestDate ?? '' };
    }
    let bestPrice = -1;
    let bestDate = '';
    for (const bar of data.history) {
      const high = bar.high ?? bar.close ?? 0;
      if (high >= bestPrice) {
        bestPrice = high;
        bestDate = bar.date;
      }
    }
    return {
      price: bestPrice > 0 ? bestPrice : data.summary.closePrice,
      date: bestDate || data.summary.latestDate,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Top Symbol Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full lg:flex-1 lg:max-w-md">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Enter NSE symbol (e.g., 360ONE, BEL)..."
              className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs font-mono uppercase bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>
          <button
            type="submit"
            className="min-h-[40px] px-3.5 sm:px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Load
          </button>
        </form>

        {data && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleQuickPaperBuy()}
              disabled={paperBuying}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {paperBuying
                ? 'Buying...'
                : (heldCounts[data.summary.symbol.toUpperCase()] || 0) > 0
                  ? `Paper BUY (${heldCounts[data.summary.symbol.toUpperCase()]} Held)`
                  : 'Paper BUY'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCompareMode((prev) => {
                  const next = !prev;
                  if (next) {
                    window.setTimeout(() => {
                      document
                        .getElementById('stock-comparison-section')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 50);
                  }
                  return next;
                });
              }}
              aria-pressed={compareMode}
              className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                compareMode
                  ? 'bg-blue-700 text-white border-blue-700 hover:bg-blue-800'
                  : 'text-slate-700 bg-slate-50 hover:bg-slate-100 border-slate-200'
              }`}
            >
              <GitCompareArrows className="w-3.5 h-3.5" />
              Compare Stock
            </button>
            <button
              type="button"
              onClick={() => {
                setAlertPanelOpen((prev) => {
                  const next = !prev;
                  if (next) {
                    window.setTimeout(() => {
                      document
                        .getElementById('price-alert-section')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 50);
                  }
                  return next;
                });
              }}
              aria-pressed={alertPanelOpen}
              className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                alertPanelOpen
                  ? 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700'
                  : 'text-amber-900 bg-amber-50 hover:bg-amber-100 border-amber-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>
                Set Price Alert{symbolAlertCount > 0 ? ` (${symbolAlertCount})` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                document.getElementById('v3-bot-audit')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              v3 Bot Audit
            </button>
            <button
              onClick={() =>
                onSendToRisk(
                  data.summary.symbol,
                  data.summary.closePrice,
                  data.summary.suggestedStopLoss ??
                    Number((data.summary.closePrice * 0.93).toFixed(2))
                )
              }
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Calculator className="w-3.5 h-3.5" />
              Size Position
            </button>
            <button
              onClick={handleRunGeminiResearch}
              disabled={geminiLoading}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {geminiLoading ? 'Running...' : 'Gemini Research'}
            </button>
          </div>
        )}
      </div>

      {paperNotice && (
        <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-mono text-emerald-900">
          {paperNotice}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
          Loading {symbol} Bhavcopy history, swing indicators, fundamentals, and NSE XBRL filings...
        </div>
      ) : error || !data ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-rose-700">
          {error || `Unable to load symbol ${symbol}`}
        </div>
      ) : (
        <>
          {/* Summary Header + Swing Technicals */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-bold font-mono text-slate-900">
                    {data.summary.symbol}
                  </h2>
                  {onToggleWatchlist && (
                    <button
                      type="button"
                      onClick={() => onToggleWatchlist(data.summary.symbol)}
                      aria-pressed={isStarred}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                        isStarred
                          ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100/70'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          isStarred ? 'text-amber-500 fill-amber-400' : 'text-slate-400'
                        }`}
                      />
                      <span>{isStarred ? 'Starred in Watchlist' : 'Star Stock'}</span>
                    </button>
                  )}
                  {getCapLabel(data.summary.marketCapCategory) && (
                    <span
                      title={formatMarketCapCr(data.summary.marketCapCr)}
                      className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border whitespace-nowrap ${getCapBadgeClass(
                        data.summary.marketCapCategory
                      )}`}
                    >
                      {getCapLabel(data.summary.marketCapCategory)}
                    </span>
                  )}
                  {data.summary.ema21Cross44Bullish ? (
                    <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded whitespace-nowrap">
                      EMA 21×44 Bullish Cross ({data.summary.ema21Cross44DaysAgo ?? 0}d)
                    </span>
                  ) : data.summary.ema21AboveEma44 ? (
                    <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-emerald-50/70 text-emerald-700 border border-emerald-200 rounded whitespace-nowrap">
                      EMA 21 &gt; EMA 44 Bullish
                    </span>
                  ) : data.summary.ema21AboveEma44 === false ? (
                    <span className="px-2 py-0.5 text-[11px] font-mono text-slate-600 bg-slate-100 border border-slate-200 rounded whitespace-nowrap">
                      EMA 21 &lt; EMA 44
                    </span>
                  ) : null}
                  {data.summary.isIpo && (
                    <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded whitespace-nowrap">
                      IPO · Listed {data.summary.listingDate} ({data.summary.sessionsCount} sess)
                    </span>
                  )}
                  <span className="text-xs font-mono text-slate-500">
                    {data.summary.series} Series · {data.summary.latestDate} · {data.summary.swingTier}
                  </span>
                  {burstProfile && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono font-semibold rounded border whitespace-nowrap ${
                        burstProfile.category === 'High-Intensity Accumulation'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : burstProfile.category === 'Distribution Trend'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : burstProfile.category === 'Consolidation Zone'
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      <Zap className="w-3 h-3" />
                      {burstProfile.category}
                    </span>
                  )}
                  {rsiDivergence?.latestDivergence && (() => {
                    const div = rsiDivergence.latestDivergence;
                    const isBull = div.polarity === 'BULLISH';
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setChartOverlayMode('RSI_DIVERGENCE');
                          setSelectedDivergenceId(div.id);
                          setHoverIdx(div.to.index);
                          document
                            .getElementById('stock-price-chart')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }}
                        title={div.description}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono font-semibold rounded border whitespace-nowrap transition-opacity hover:opacity-90 ${
                          isBull
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-rose-50 text-rose-800 border-rose-300'
                        }`}
                      >
                        {isBull ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span>
                          {div.shortLabel} ({div.barsSinceEnd}d ago)
                        </span>
                      </button>
                    );
                  })()}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {data.summary.providerSector || 'Sector unmapped'}
                  {data.fundamentals?.marketCapInr ? (
                    <>
                      {' '}
                      · MCap{' '}
                      <span className="font-mono text-slate-900">
                        ₹{(data.fundamentals.marketCapInr / 1e7).toFixed(0)} Cr
                      </span>
                    </>
                  ) : null}
                  {' '}
                  · {data.xbrlFilings.length} XBRL filings
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap items-stretch justify-end gap-2.5 sm:gap-3 w-full md:w-auto">
                {/* 1. Scanner EOD Price */}
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2 text-left md:text-right">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-mono">
                    Scanner EOD Close ({data.summary.latestDate})
                  </div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-slate-900 mt-0.5">
                    ₹{data.summary.closePrice.toFixed(2)}{' '}
                    <span
                      className={`text-xs font-medium ${
                        (data.summary.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {data.summary.changePct !== null
                        ? `(${data.summary.changePct >= 0 ? '+' : ''}${data.summary.changePct.toFixed(2)}%)`
                        : ''}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    Bhavcopy Scanner Basis
                  </div>
                </div>

                {/* 2. Current Live Price vs Scanner EOD */}
                {(() => {
                  const quoteFreshness =
                    liveQuote?.available && liveQuote.livePrice !== null
                      ? evaluateQuoteFreshness({
                          lastUpdated: liveQuote.lastUpdated,
                          marketTimeUnixSec: liveQuote.marketTimestampSec,
                          marketTimeIst: liveQuote.marketTimeIst,
                          marketDateIst: liveQuote.marketDateIst,
                          marketState: liveQuote.marketState,
                        })
                      : null;
                  const showLiveGreen = Boolean(quoteFreshness?.isLive);
                  return (
                <div
                  className={`border rounded-md px-3.5 py-2 text-left md:text-right w-full sm:w-auto sm:min-w-[210px] ${
                    liveQuote?.available && liveQuote.livePrice !== null
                      ? quoteFreshness?.isStale
                        ? 'bg-amber-50/70 border-rose-300'
                        : quoteFreshness?.isMarketClosed
                          ? 'bg-slate-50 border-slate-300'
                          : liveQuote.livePrice >= data.summary.closePrice
                            ? 'bg-emerald-50/60 border-emerald-200'
                            : 'bg-rose-50/60 border-rose-200'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between md:justify-end gap-1.5 text-[10px] uppercase tracking-wide text-slate-600 font-mono">
                    {showLiveGreen && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[9px] tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        LIVE
                      </span>
                    )}
                    <span>{quoteFreshness?.headerLabel ?? 'Current Live Price (vs EOD)'}</span>
                    <button
                      type="button"
                      onClick={() => void loadLiveQuote(data.summary.symbol, true)}
                      title="Refresh Yahoo live checking price"
                      className="p-1 text-slate-600 hover:text-blue-700 rounded border border-slate-200 bg-white"
                    >
                      <RefreshCw className={`w-3 h-3 ${liveQuoteLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {liveQuoteLoading && !liveQuote ? (
                    <div className="text-xs font-mono text-slate-500 mt-1.5">
                      Checking live price...
                    </div>
                  ) : liveQuote?.available && liveQuote.livePrice !== null ? (
                    (() => {
                      const diffInr = liveQuote.livePrice - data.summary.closePrice;
                      const diffPct =
                        data.summary.closePrice > 0
                          ? (diffInr / data.summary.closePrice) * 100
                          : null;
                      const isUp = diffInr >= 0;
                      return (
                        <>
                          <div className="text-xl font-bold font-mono text-slate-900 mt-0.5 flex flex-wrap items-center md:justify-end gap-1.5">
                            <span>₹{liveQuote.livePrice.toFixed(2)}</span>
                            {quoteFreshness?.badgeLabel && (
                              <span
                                title={quoteFreshness.reason ?? undefined}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-white ${
                                  quoteFreshness.isStale ? 'bg-rose-600' : 'bg-slate-600'
                                }`}
                              >
                                {quoteFreshness.badgeLabel}
                              </span>
                            )}
                            <span
                              className={`text-xs font-semibold ${
                                quoteFreshness?.isStale
                                  ? 'text-slate-600'
                                  : isUp
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                              }`}
                            >
                              {diffInr >= 0 ? '+' : ''}₹{diffInr.toFixed(2)}{' '}
                              {diffPct !== null
                                ? `(${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)}%)`
                                : ''}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {liveQuote.dayLow !== null && liveQuote.dayHigh !== null
                              ? `Day ₹${liveQuote.dayLow.toFixed(2)}–₹${liveQuote.dayHigh.toFixed(2)} · `
                              : ''}
                            {liveQuote.marketTimeIst || 'Yahoo Finance'}
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <div className="text-xs font-mono font-semibold text-amber-800 mt-1.5">
                        DATA NOT AVAILABLE
                      </div>
                      <div className="text-[10px] font-mono text-amber-700">
                        Yahoo live quote unreachable
                      </div>
                    </>
                  )}
                </div>
                  );
                })()}
              </div>
            </div>

            {/* Pipeline & Swing Indicators Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-5 pt-4 border-t border-slate-100 text-xs">
              <div>
                <div className="text-slate-500">30D Delivery A/B</div>
                <div className="mt-0.5 font-mono font-semibold text-slate-900">
                  {data.summary.deliveryCategory}
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  5D&gt;=60%: {data.summary.rolling5dGt60Count} · Day&gt;=60%: {data.summary.dailyGt60Count}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Deliv % &amp; Qty Ratio</div>
                <div className="mt-0.5 font-mono font-semibold text-slate-900">
                  {data.summary.delivPer !== null ? `${data.summary.delivPer.toFixed(1)}%` : '—'}{' '}
                  <span className="text-blue-700">
                    ({data.summary.delivQtyRatio !== null ? `${data.summary.delivQtyRatio.toFixed(2)}x` : '—'})
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  Deliv Val: {data.summary.delivValueCr !== null ? `₹${data.summary.delivValueCr.toFixed(2)} Cr` : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">RVOL &amp; Up/Dn Vol</div>
                <div
                  className={`mt-0.5 font-mono font-semibold ${
                    data.summary.rvolBand === 'HIGH' ? 'text-blue-700' : 'text-slate-900'
                  }`}
                >
                  {data.summary.rvol !== null ? `${data.summary.rvol.toFixed(2)}x` : 'WAIT'} ({data.summary.rvolBand})
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  10D U/D: {data.summary.upDownVolRatio10d !== null ? `${data.summary.upDownVolRatio10d.toFixed(2)}x` : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">EMA 21 / 44 &amp; RSI(14)</div>
                <div className="mt-0.5 font-mono font-semibold text-slate-900">
                  {data.summary.ema21 !== null ? `₹${data.summary.ema21.toFixed(1)}` : '—'} /{' '}
                  <span className="text-violet-700">
                    {data.summary.ema44 !== null ? `₹${data.summary.ema44.toFixed(1)}` : '—'}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  <span className={data.summary.ema21AboveEma44 ? 'text-emerald-700 font-semibold' : 'text-slate-600'}>
                    {data.summary.ema21Cross44Bullish
                      ? `21×44 (${data.summary.ema21Cross44DaysAgo ?? 0}d)`
                      : data.summary.ema21AboveEma44
                        ? '21>44 Bullish'
                        : data.summary.ema21AboveEma44 === false
                          ? '21<44'
                          : data.summary.aboveEma21
                            ? 'Above 21'
                            : 'Below 21'}
                  </span>{' '}
                  · RSI: {data.summary.rsi14 !== null ? data.summary.rsi14.toFixed(1) : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">ATR(14) &amp; Stop</div>
                <div className="mt-0.5 font-mono font-semibold text-slate-900">
                  {data.summary.atrPct !== null ? `${data.summary.atrPct.toFixed(2)}%` : '—'}
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  1.5x ATR Stop: {data.summary.suggestedStopLoss !== null ? `₹${data.summary.suggestedStopLoss}` : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">20D Turn &amp; High Dist</div>
                <div
                  className={`mt-0.5 font-mono font-semibold ${
                    data.summary.liquidityPass ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {data.summary.avgTurnover20DCr !== null
                    ? `₹${data.summary.avgTurnover20DCr.toFixed(2)} Cr`
                    : '—'}
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  35D High: {data.summary.distFrom35dHighPct !== null ? `${data.summary.distFrom35dHighPct.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Set Price Alert Panel (localStorage-backed threshold alerts) */}
          {alertPanelOpen && activeReferencePrice !== null && (
            <div id="price-alert-section">
              <PriceAlertPanel
                symbol={data.summary.symbol}
                currentPrice={activeReferencePrice}
                suggestedStopLoss={data.summary.suggestedStopLoss}
                onClose={() => setAlertPanelOpen(false)}
              />
            </div>
          )}

          {/* Stock Comparison Mode (Dual-Line RVOL & Delivery % Trends) */}
          {compareMode && (
            <div id="stock-comparison-section">
              <StockComparisonPanel
                primaryData={data}
                onSelectSymbol={onSelectSymbol}
                onClose={() => setCompareMode(false)}
              />
            </div>
          )}

          {/* Burst Power Profile (252D Behavioral Classification + Hoverable Methodology Tooltip) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-blue-700" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Burst Power Profile (252D Lookback Classification)
                  </h3>
                </div>

                {/* Hoverable Methodology Tooltip Trigger */}
                <div
                  className="relative inline-block"
                  onMouseEnter={() => setShowBurstTooltip(true)}
                  onMouseLeave={() => setShowBurstTooltip(false)}
                >
                  <button
                    type="button"
                    onFocus={() => setShowBurstTooltip(true)}
                    onBlur={() => setShowBurstTooltip(false)}
                    onClick={() => setShowBurstTooltip((v) => !v)}
                    aria-label="Burst Power Profile methodology"
                    aria-expanded={showBurstTooltip}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded transition-colors"
                  >
                    <Info className="w-3.5 h-3.5 text-blue-700" />
                    <span>Methodology</span>
                  </button>

                  {showBurstTooltip && (
                    <div
                      role="tooltip"
                      className="fixed inset-x-3 top-20 sm:inset-x-auto sm:top-full sm:left-0 sm:mt-2 sm:absolute z-40 w-auto sm:w-96 max-h-[75vh] overflow-y-auto p-3.5 rounded-lg bg-slate-900 text-slate-100 shadow-xl border border-slate-700 text-[11px] leading-relaxed space-y-2"
                    >
                      <div className="font-semibold text-white flex items-center justify-between gap-1.5 border-b border-slate-700 pb-1.5">
                        <span className="flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span>252D Burst Power Score Explained in %</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowBurstTooltip(false)}
                          className="sm:hidden px-1.5 py-0.5 text-[10px] text-slate-300 bg-slate-800 rounded"
                        >
                          Close
                        </button>
                      </div>
                      <p className="text-slate-300">
                        Measures how often and how strongly a stock jumps <strong className="text-emerald-300">+5% or more (Upward)</strong> vs drops <strong className="text-rose-300">-5% or more (Downward)</strong> in a day over 1 year (252 sessions):
                      </p>
                      <div className="font-mono text-[10px] bg-slate-800/90 border border-slate-700 rounded p-2 space-y-1 text-slate-200">
                        <div>• Burst Split (%): Upward % = Up Moves ÷ Total Big Moves (e.g. Up 80% / Down 20%)</div>
                        <div>• Burst Intensity (0–100%): Up 20% vs Down 20% = equal strength; Up 25% vs Down 5% = strong uptrend</div>
                        <div>• Weights: ±5–10% = 1× · ±10–19% = 2× · ±19%+ = 3×</div>
                      </div>
                      <ul className="space-y-1 text-slate-200">
                        <li>
                          <strong className="text-emerald-400">High-Intensity Accumulation:</strong>{' '}
                          Upward Intensity ≥ 10% &amp; Up &gt; Down (or Net ≥ +5%) — buyers dominate big moves.
                        </li>
                        <li>
                          <strong className="text-rose-400">Distribution Trend:</strong>{' '}
                          Net ≤ -2%, or Downward Intensity ≥ 10% &amp; Down &gt; Up — crash/selling risk dominates.
                        </li>
                        <li>
                          <strong className="text-sky-400">Consolidation Zone:</strong>{' '}
                          Balanced (like Up 20% / Down 20% or 50% / 50% split) — sideways base-building.
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {burstProfile ? (
                <span
                  className={`px-3 py-1 font-mono text-xs font-bold rounded-md border ${
                    burstProfile.category === 'High-Intensity Accumulation'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : burstProfile.category === 'Distribution Trend'
                        ? 'bg-rose-50 text-rose-800 border-rose-300'
                        : burstProfile.category === 'Consolidation Zone'
                          ? 'bg-blue-50 text-blue-800 border-blue-300'
                          : 'bg-amber-50 text-amber-800 border-amber-300'
                  }`}
                >
                  {burstProfile.category} · {burstProfile.shortTag}
                </span>
              ) : (
                <span className="px-2.5 py-1 font-mono text-[11px] text-slate-500 bg-slate-100 border border-slate-200 rounded-md">
                  Evaluating 252D Profile...
                </span>
              )}
            </div>

            {burstProfile ? (
              <div className="mt-3 space-y-3">
                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900">{burstProfile.headline}</span>{' '}
                    <span className="text-slate-600">{burstProfile.rationale}</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">
                    Window: {burstProfile.lookbackDays}D
                  </span>
                </div>

                {/* Clear % Breakdown Grid for This Stock */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                  <div className="bg-emerald-50/40 border border-emerald-200 rounded-md p-2.5">
                    <div className="text-[10px] font-sans text-emerald-800 font-medium">
                      Upward Burst % (Gain Power)
                    </div>
                    <div className="text-base font-bold text-emerald-700 mt-0.5 tabular-nums">
                      {burstProfile.upwardNorm !== null ? `Up ${burstProfile.upwardNorm.toFixed(1)}%` : 'N/A'}
                    </div>
                    <div className="text-[10px] text-slate-600">
                      {burstProfile.upwardSharePct !== null
                        ? `${burstProfile.upwardSharePct}% of bursts · ${burstProfile.upDaysTotal} days (${burstProfile.upwardDayRatePct}%)`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-rose-50/40 border border-rose-200 rounded-md p-2.5">
                    <div className="text-[10px] font-sans text-rose-800 font-medium">
                      Downward Burst % (Drop Risk)
                    </div>
                    <div className="text-base font-bold text-rose-700 mt-0.5 tabular-nums">
                      {burstProfile.downwardNorm !== null ? `Down ${burstProfile.downwardNorm.toFixed(1)}%` : 'N/A'}
                    </div>
                    <div className="text-[10px] text-slate-600">
                      {burstProfile.downwardSharePct !== null
                        ? `${burstProfile.downwardSharePct}% of bursts · ${burstProfile.downDaysTotal} days (${burstProfile.downwardDayRatePct}%)`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-50/70 border border-slate-200 rounded-md p-2.5">
                    <div className="text-[10px] font-sans text-slate-500">
                      Net Burst % (Up − Down)
                    </div>
                    <div
                      className={`text-base font-bold mt-0.5 tabular-nums ${
                        (burstProfile.netNorm ?? 0) > 0
                          ? 'text-emerald-700'
                          : (burstProfile.netNorm ?? 0) < 0
                            ? 'text-rose-700'
                            : 'text-slate-800'
                      }`}
                    >
                      {burstProfile.netNorm !== null
                        ? `${burstProfile.netNorm >= 0 ? '+' : ''}${burstProfile.netNorm.toFixed(1)}%`
                        : 'N/A'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {burstProfile.netEdgePct !== null
                        ? `Split Edge: ${burstProfile.netEdgePct >= 0 ? '+' : ''}${burstProfile.netEdgePct}%`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-50/70 border border-slate-200 rounded-md p-2.5">
                    <div className="text-[10px] font-sans text-slate-500">Profile Classification</div>
                    <div className="text-xs font-bold text-slate-900 mt-1 leading-snug">
                      {burstProfile.category}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Raw +{burstProfile.upwardRaw ?? '—'} / -{burstProfile.downwardRaw ?? '—'}
                    </div>
                  </div>
                </div>

                {/* Visual Upward % vs Downward % Split Bar */}
                {burstProfile.upwardSharePct !== null && burstProfile.downwardSharePct !== null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-slate-600">
                      <span className="text-emerald-700 font-semibold">
                        Upward Share: {burstProfile.upwardSharePct}% (Intensity {burstProfile.upwardNorm?.toFixed(1)}%)
                      </span>
                      <span className="text-rose-700 font-semibold">
                        Downward Share: {burstProfile.downwardSharePct}% (Intensity {burstProfile.downwardNorm?.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full overflow-hidden bg-slate-200 flex">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{
                          width: `${
                            burstProfile.upwardSharePct === 0 && burstProfile.downwardSharePct === 0
                              ? 50
                              : burstProfile.upwardSharePct
                          }%`,
                        }}
                      />
                      <div
                        className="bg-rose-500 h-full"
                        style={{
                          width: `${
                            burstProfile.upwardSharePct === 0 && burstProfile.downwardSharePct === 0
                              ? 50
                              : burstProfile.downwardSharePct
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Always-visible Plain-English % Definition Guide */}
                <div className="text-[11px] bg-blue-50/50 border border-blue-200 rounded-md px-3 py-2 text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">How to read Burst Score in %:</strong>{' '}
                  <strong>Upward %</strong> measures big <code>+5%+</code> rally days and{' '}
                  <strong>Downward %</strong> measures big <code>-5%+</code> crash days over the past year ({burstProfile.lookbackDays} sessions).
                  Example: <span className="font-mono font-semibold text-slate-900">Up 20% / Down 20%</span> means equal buying &amp; selling bursts (50% / 50% sideways);{' '}
                  <span className="font-mono font-semibold text-emerald-700">Up 25% / Down 5%</span> means buyers dominate ~83% vs 17%;{' '}
                  <span className="font-mono font-semibold text-rose-700">Up 5% / Down 25%</span> warns sellers dominate ~83% vs 17%.
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-slate-500">
                Computing 252D Burst Power Profile from Yahoo OHLCV &amp; NSE Bhavcopy sessions...
              </div>
            )}
          </div>

          {/* Open-Source v3 Swing Bot Phase 1-8 Audit (All Prompt Parameters: Burst Power, Bulk/Block Deals, Piotroski, Graham/DCF, Wyckoff/VCP, Fast Triggers, Risk & Score) */}
          <div id="v3-bot-audit">
            <BotStockAuditCard
              symbol={data.summary.symbol}
              externalRefreshSeq={externalRefreshSeq}
              onAnalysisLoaded={setBotAnalysis}
            />
          </div>

          {/* Trend Strength Score (0-100): EPS Growth Delta + RVOL Intensity + Delivery Consistency */}
          <TrendStrengthCard data={data} />

          {/* T1 / T2 / T3 Specification & Active Stock Gate Check */}
          <SwingTierSpecPanel
            defaultOpen={false}
            activeStock={data.summary}
            compactToggleLabel={`Swing Tier Spec (${data.summary.symbol}: ${data.summary.swingTier})`}
          />

          {/* Session Price Chart with Daily Price / 30-Day Rolling Volatility / RSI Divergence Toggle */}
          {chartModel && activePoint && (
            <div id="stock-price-chart" className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {chartOverlayMode === 'VOLATILITY_ATR'
                        ? 'Price + 30-Day Rolling Volatility (1.5× ATR Envelope & Contraction Precursors)'
                        : chartOverlayMode === 'RSI_DIVERGENCE'
                          ? 'Price + Automated Wilder RSI(14) Divergence Detector'
                          : `${data.history.length}-Session Bhavcopy Price, EMA21, EMA44, Volume & Delivery %`}
                    </h3>
                    {chartOverlayMode === 'VOLATILITY_ATR' && (
                      <span
                        className={`text-[11px] font-mono font-semibold ${
                          chartModel.latestVolMetric?.isSqueeze
                            ? 'text-emerald-700'
                            : 'text-slate-600'
                        }`}
                      >
                        · {chartModel.squeezeSessionsCount} squeeze sessions (30D)
                      </span>
                    )}
                    {chartOverlayMode === 'RSI_DIVERGENCE' && rsiDivergence && (
                      <span className="text-[11px] font-mono font-semibold text-blue-700">
                        · {rsiDivergence.divergences.length} divergence
                        {rsiDivergence.divergences.length === 1 ? '' : 's'} detected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {chartOverlayMode === 'VOLATILITY_ATR'
                      ? 'Shaded channel shows EMA21 ± 1.5× ATR(14); green bands mark ATR compression (<0.88× 30D mean) signaling breakout precursors'
                      : chartOverlayMode === 'RSI_DIVERGENCE'
                        ? 'Green trendlines flag Bullish Divergence (Price LL + RSI HL / HL + LL); Red trendlines flag Bearish Divergence (Price HH + RSI LH / LH + HH)'
                        : 'Hover across sessions to inspect OHLC, EMA21, EMA44, Turnover, and Delivery %'}
                  </p>
                </div>

                {/* Segmented Toggle: Daily Price & Delivery vs 30D ATR Volatility vs RSI Divergence */}
                <div
                  role="group"
                  aria-label="Chart overlay mode"
                  className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md text-xs self-start lg:self-auto shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => setChartOverlayMode('PRICE_DELIV')}
                    aria-pressed={chartOverlayMode === 'PRICE_DELIV'}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      chartOverlayMode === 'PRICE_DELIV'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Daily Price &amp; Delivery
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartOverlayMode('VOLATILITY_ATR')}
                    aria-pressed={chartOverlayMode === 'VOLATILITY_ATR'}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      chartOverlayMode === 'VOLATILITY_ATR'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5 text-blue-700" />
                    30D Volatility (ATR)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartOverlayMode('RSI_DIVERGENCE')}
                    aria-pressed={chartOverlayMode === 'RSI_DIVERGENCE'}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      chartOverlayMode === 'RSI_DIVERGENCE'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
                    <span>RSI Divergence</span>
                    {rsiDivergence && rsiDivergence.divergences.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-mono text-[10px] font-bold">
                        {rsiDivergence.divergences.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Hover Inspection Readout Strip */}
              {chartOverlayMode === 'PRICE_DELIV' ? (
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-700 mb-3 px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-md">
                  <span className="font-semibold text-slate-900">{activePoint.date}</span>
                  <span>O {activePoint.open?.toFixed(2) ?? '—'}</span>
                  <span>H {activePoint.high?.toFixed(2) ?? '—'}</span>
                  <span>L {activePoint.low?.toFixed(2) ?? '—'}</span>
                  <span className="font-semibold text-slate-900">
                    C {activePoint.close?.toFixed(2) ?? '—'}
                  </span>
                  <span className="text-emerald-700">
                    E21 {activePoint.ema21?.toFixed(1) ?? '—'}
                  </span>
                  <span className="text-violet-700">
                    E44 {activePoint.ema44?.toFixed(1) ?? '—'}
                  </span>
                  <span className="text-blue-700">
                    Deliv {activePoint.delivPer !== null ? `${activePoint.delivPer.toFixed(1)}%` : '—'}
                  </span>
                  <span>Turn ₹{(activePoint.turnoverLacs / 100).toFixed(2)}Cr</span>
                </div>
              ) : chartOverlayMode === 'RSI_DIVERGENCE' ? (
                (() => {
                  const activeRsi = chartModel.rsiSeries[activeIdx] ?? null;
                  const matchingDiv =
                    rsiDivergence?.divergences.find(
                      (d) =>
                        d.id === selectedDivergenceId ||
                        d.to.index === activeIdx ||
                        d.from.index === activeIdx
                    ) ?? rsiDivergence?.latestDivergence ?? null;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-700 mb-3 px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-md">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-slate-900">{activePoint.date}</span>
                        <span>H {activePoint.high?.toFixed(2) ?? '—'}</span>
                        <span>L {activePoint.low?.toFixed(2) ?? '—'}</span>
                        <span className="font-semibold text-slate-900">
                          C ₹{activePoint.close?.toFixed(2) ?? '—'}
                        </span>
                        <span
                          className={`font-semibold ${
                            activeRsi !== null && activeRsi >= 70
                              ? 'text-rose-700'
                              : activeRsi !== null && activeRsi <= 30
                                ? 'text-emerald-700'
                                : 'text-blue-700'
                          }`}
                        >
                          RSI(14): {activeRsi !== null ? activeRsi.toFixed(1) : 'Warm-up'}
                        </span>
                      </div>
                      {matchingDiv && (
                        <div
                          className={`text-[11px] font-semibold ${
                            matchingDiv.polarity === 'BULLISH'
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {matchingDiv.label}: {matchingDiv.from.date} → {matchingDiv.to.date} (RSI{' '}
                          {matchingDiv.from.rsi.toFixed(1)}→{matchingDiv.to.rsi.toFixed(1)})
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-700 mb-3 px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-md">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-slate-900">{activePoint.date}</span>
                    <span>Close ₹{activePoint.close?.toFixed(2) ?? '—'}</span>
                    <span className="text-blue-700">
                      ATR(14):{' '}
                      {activeVolMetric?.atr14 !== null && activeVolMetric?.atr14 !== undefined
                        ? `₹${activeVolMetric.atr14.toFixed(2)}`
                        : '—'}{' '}
                      (
                      {activeVolMetric?.atrPct !== null && activeVolMetric?.atrPct !== undefined
                        ? `${activeVolMetric.atrPct.toFixed(2)}%`
                        : '—'}
                      )
                    </span>
                    <span className="text-slate-600">
                      30D Avg ATR%:{' '}
                      {activeVolMetric?.atrPct30Mean !== null &&
                      activeVolMetric?.atrPct30Mean !== undefined
                        ? `${activeVolMetric.atrPct30Mean.toFixed(2)}%`
                        : '—'}
                    </span>
                    {activeVolMetric?.upperEnv !== null &&
                      activeVolMetric?.upperEnv !== undefined &&
                      activeVolMetric?.lowerEnv !== null &&
                      activeVolMetric?.lowerEnv !== undefined && (
                        <span className="text-slate-500">
                          Band: ₹{activeVolMetric.lowerEnv.toFixed(1)}–₹
                          {activeVolMetric.upperEnv.toFixed(1)}
                        </span>
                      )}
                  </div>
                  <div className="flex items-center gap-2">
                    {activeVolMetric?.compressionRatio !== null &&
                      activeVolMetric?.compressionRatio !== undefined && (
                        <span
                          className={`font-semibold ${
                            activeVolMetric.isSqueeze
                              ? 'text-emerald-700'
                              : activeVolMetric.compressionRatio > 1.15
                                ? 'text-amber-700'
                                : 'text-slate-700'
                          }`}
                        >
                          {activeVolMetric.compressionRatio.toFixed(2)}× 30D Mean ·{' '}
                          {activeVolMetric.isSqueeze
                            ? 'Breakout Precursor (Squeeze)'
                            : activeVolMetric.compressionRatio > 1.15
                              ? 'Volatility Expansion'
                              : 'Normal Volatility'}
                        </span>
                      )}
                  </div>
                </div>
              )}

              <div className="md:hidden text-[10px] font-mono text-slate-400 mb-1">
                Swipe chart horizontally →
              </div>
              <div className="overflow-x-auto touch-pan-x">
                <svg
                  viewBox={`0 0 ${chartModel.width} ${chartModel.priceHeight + chartModel.volHeight + 28}`}
                  className="w-full min-w-[640px] h-auto select-none"
                  onMouseLeave={() => setHoverIdx(null)}
                >
                  {/* Top Price Grid */}
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const y = 16 + frac * (chartModel.priceHeight - 32);
                    const minBound =
                      chartOverlayMode === 'VOLATILITY_ATR'
                        ? chartModel.minVolP
                        : chartOverlayMode === 'RSI_DIVERGENCE'
                          ? chartModel.minDivP
                          : chartModel.minP;
                    const maxBound =
                      chartOverlayMode === 'VOLATILITY_ATR'
                        ? chartModel.maxVolP
                        : chartOverlayMode === 'RSI_DIVERGENCE'
                          ? chartModel.maxDivP
                          : chartModel.maxP;
                    const priceVal = maxBound - frac * (maxBound - minBound);
                    return (
                      <g key={frac}>
                        <line
                          x1={chartModel.padL}
                          x2={chartModel.width - chartModel.padR}
                          y1={y}
                          y2={y}
                          stroke="#E2E8F0"
                          strokeWidth="1"
                        />
                        <text
                          x={chartModel.padL - 8}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {priceVal.toFixed(0)}
                        </text>
                      </g>
                    );
                  })}

                  {chartOverlayMode === 'VOLATILITY_ATR' ? (
                    <>
                      {/* Squeeze Precursor Vertical Highlights */}
                      {chartModel.volMetrics.map((m, i) => {
                        if (!m.isSqueeze) return null;
                        const x = Math.max(chartModel.padL, chartModel.xFor(i) - chartModel.sliceW / 2);
                        const w = Math.min(
                          chartModel.sliceW,
                          chartModel.width - chartModel.padR - x
                        );
                        return (
                          <rect
                            key={`sq-top-${m.date}`}
                            x={x}
                            y={14}
                            width={Math.max(1, w)}
                            height={chartModel.priceHeight - 26}
                            fill="#10B981"
                            fillOpacity="0.10"
                          />
                        );
                      })}

                      {/* Shaded 1.5x ATR Volatility Channel */}
                      {chartModel.atrEnvAreaPath && (
                        <path
                          d={chartModel.atrEnvAreaPath}
                          fill="#2563EB"
                          fillOpacity="0.12"
                        />
                      )}
                      {chartModel.upperEnvPoints && (
                        <polyline
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="1.25"
                          strokeDasharray="3 3"
                          points={chartModel.upperEnvPoints}
                        />
                      )}
                      {chartModel.lowerEnvPoints && (
                        <polyline
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="1.25"
                          strokeDasharray="3 3"
                          points={chartModel.lowerEnvPoints}
                        />
                      )}

                      {chartModel.emaVolOverlayPoints && (
                        <polyline
                          fill="none"
                          stroke="#16A34A"
                          strokeWidth="1.5"
                          points={chartModel.emaVolOverlayPoints}
                        />
                      )}
                      <polyline
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth="2.1"
                        points={chartModel.priceVolOverlayPoints}
                      />

                      {/* Bottom Sub-Panel: 30-Day Rolling ATR% Volatility & Compression Precursors */}
                      <g transform={`translate(0, ${chartModel.priceHeight + 8})`}>
                        <text
                          x={chartModel.padL}
                          y={8}
                          className="fill-slate-600 text-[10px] font-semibold uppercase tracking-wide"
                        >
                          ATR(14) % Volatility vs 30-Day Rolling Mean
                        </text>

                        {[0, 0.5, 1].map((frac) => {
                          const y = chartModel.yAtrFor(
                            chartModel.atrMaxPct -
                              frac * (chartModel.atrMaxPct - chartModel.atrMinPct)
                          );
                          const val =
                            chartModel.atrMaxPct -
                            frac * (chartModel.atrMaxPct - chartModel.atrMinPct);
                          return (
                            <g key={`atr-g-${frac}`}>
                              <line
                                x1={chartModel.padL}
                                x2={chartModel.width - chartModel.padR}
                                y1={y}
                                y2={y}
                                stroke="#E2E8F0"
                                strokeWidth="1"
                              />
                              <text
                                x={chartModel.padL - 8}
                                y={y + 3}
                                textAnchor="end"
                                className="fill-slate-400 text-[10px] font-mono"
                              >
                                {val.toFixed(1)}%
                              </text>
                            </g>
                          );
                        })}

                        {/* Squeeze Zones in Sub-Panel */}
                        {chartModel.volMetrics.map((m, i) => {
                          if (!m.isSqueeze) return null;
                          const x = Math.max(
                            chartModel.padL,
                            chartModel.xFor(i) - chartModel.sliceW / 2
                          );
                          const w = Math.min(
                            chartModel.sliceW,
                            chartModel.width - chartModel.padR - x
                          );
                          return (
                            <rect
                              key={`sq-bot-${m.date}`}
                              x={x}
                              y={10}
                              width={Math.max(1, w)}
                              height={chartModel.volHeight - 20}
                              fill="#10B981"
                              fillOpacity="0.14"
                            />
                          );
                        })}

                        {chartModel.atr30MeanPoints && (
                          <polyline
                            fill="none"
                            stroke="#64748B"
                            strokeWidth="1.4"
                            strokeDasharray="4 3"
                            points={chartModel.atr30MeanPoints}
                          />
                        )}
                        {chartModel.atrPctPoints && (
                          <polyline
                            fill="none"
                            stroke="#EA580C"
                            strokeWidth="2"
                            points={chartModel.atrPctPoints}
                          />
                        )}

                        {/* Squeeze Precursor Markers */}
                        {chartModel.volMetrics.map((m, i) => {
                          if (!m.isSqueeze || m.atrPct === null) return null;
                          return (
                            <circle
                              key={`sq-dot-${m.date}`}
                              cx={chartModel.xFor(i)}
                              cy={chartModel.yAtrFor(m.atrPct)}
                              r="3"
                              fill="#059669"
                              stroke="#FFFFFF"
                              strokeWidth="1"
                            />
                          );
                        })}
                      </g>
                    </>
                  ) : chartOverlayMode === 'RSI_DIVERGENCE' ? (
                    <>
                      {/* Top Price Pane with Divergence Pivot Markers & Trendlines */}
                      {chartModel.emaDivPoints && (
                        <polyline
                          fill="none"
                          stroke="#16A34A"
                          strokeWidth="1.2"
                          strokeOpacity="0.6"
                          points={chartModel.emaDivPoints}
                        />
                      )}
                      <polyline
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth="2"
                        points={chartModel.priceDivPoints}
                      />

                      {rsiDivergence?.divergences.slice(0, 6).map((sig) => {
                        const isBull = sig.polarity === 'BULLISH';
                        const stroke = isBull ? '#059669' : '#E11D48';
                        const isHighlighted = selectedDivergenceId === sig.id || sig.isRecent;
                        const x1 = chartModel.xFor(sig.from.index);
                        const y1 = chartModel.yDivPriceFor(sig.from.price);
                        const x2 = chartModel.xFor(sig.to.index);
                        const y2 = chartModel.yDivPriceFor(sig.to.price);
                        const labelY = isBull
                          ? Math.min(chartModel.priceHeight - 10, Math.max(y1, y2) + 12)
                          : Math.max(14, Math.min(y1, y2) - 8);
                        return (
                          <g key={`div-top-${sig.id}`}>
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={stroke}
                              strokeWidth={isHighlighted ? 2.2 : 1.5}
                              strokeDasharray={sig.category === 'REGULAR' ? undefined : '4 2'}
                            />
                            <circle
                              cx={x1}
                              cy={y1}
                              r="3.5"
                              fill={stroke}
                              stroke="#FFFFFF"
                              strokeWidth="1"
                            />
                            <circle
                              cx={x2}
                              cy={y2}
                              r="4"
                              fill={stroke}
                              stroke="#FFFFFF"
                              strokeWidth="1.2"
                            />
                            <text
                              x={(x1 + x2) / 2}
                              y={labelY}
                              textAnchor="middle"
                              className="text-[9px] font-mono font-bold"
                              fill={stroke}
                            >
                              {sig.shortLabel}
                            </text>
                          </g>
                        );
                      })}

                      {/* Bottom Sub-Panel: Wilder RSI(14) with 70/30 Bands & Divergence Segments */}
                      <g transform={`translate(0, ${chartModel.priceHeight + 8})`}>
                        <text
                          x={chartModel.padL}
                          y={8}
                          className="fill-slate-600 text-[10px] font-semibold uppercase tracking-wide"
                        >
                          Wilder RSI(14) &amp; Swing Pivot Divergences
                        </text>

                        {/* 30-70 Neutral Zone Shading */}
                        <rect
                          x={chartModel.padL}
                          y={chartModel.yRsiFor(70)}
                          width={chartModel.plotW}
                          height={Math.max(1, chartModel.yRsiFor(30) - chartModel.yRsiFor(70))}
                          fill="#F1F5F9"
                          fillOpacity="0.65"
                        />

                        {[70, 50, 30].map((lvl) => {
                          const y = chartModel.yRsiFor(lvl);
                          const lineStroke =
                            lvl === 70 ? '#FB7185' : lvl === 30 ? '#34D399' : '#CBD5E1';
                          const textFill =
                            lvl === 70 ? '#BE123C' : lvl === 30 ? '#047857' : '#64748B';
                          return (
                            <g key={`rsi-lvl-${lvl}`}>
                              <line
                                x1={chartModel.padL}
                                x2={chartModel.width - chartModel.padR}
                                y1={y}
                                y2={y}
                                stroke={lineStroke}
                                strokeWidth="1"
                                strokeDasharray={lvl === 50 ? '2 3' : '3 3'}
                              />
                              <text
                                x={chartModel.padL - 8}
                                y={y + 3}
                                textAnchor="end"
                                className="text-[10px] font-mono"
                                fill={textFill}
                              >
                                {lvl}
                              </text>
                            </g>
                          );
                        })}

                        {chartModel.rsiPoints && (
                          <polyline
                            fill="none"
                            stroke="#1D4ED8"
                            strokeWidth="2"
                            points={chartModel.rsiPoints}
                          />
                        )}

                        {rsiDivergence?.divergences.slice(0, 6).map((sig) => {
                          const isBull = sig.polarity === 'BULLISH';
                          const stroke = isBull ? '#059669' : '#E11D48';
                          const isHighlighted = selectedDivergenceId === sig.id || sig.isRecent;
                          const x1 = chartModel.xFor(sig.from.index);
                          const y1 = chartModel.yRsiFor(sig.from.rsi);
                          const x2 = chartModel.xFor(sig.to.index);
                          const y2 = chartModel.yRsiFor(sig.to.rsi);
                          return (
                            <g key={`div-bot-${sig.id}`}>
                              <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke={stroke}
                                strokeWidth={isHighlighted ? 2.2 : 1.5}
                                strokeDasharray={sig.category === 'REGULAR' ? undefined : '4 2'}
                              />
                              <circle
                                cx={x1}
                                cy={y1}
                                r="3.5"
                                fill={stroke}
                                stroke="#FFFFFF"
                                strokeWidth="1"
                              />
                              <circle
                                cx={x2}
                                cy={y2}
                                r="4"
                                fill={stroke}
                                stroke="#FFFFFF"
                                strokeWidth="1.2"
                              />
                            </g>
                          );
                        })}
                      </g>
                    </>
                  ) : (
                    <>
                      <polyline
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth="2"
                        points={chartModel.pricePoints}
                      />
                      {chartModel.emaPoints && (
                        <polyline
                          fill="none"
                          stroke="#16A34A"
                          strokeWidth="1.5"
                          points={chartModel.emaPoints}
                        />
                      )}
                      {chartModel.ema44Points && (
                        <polyline
                          fill="none"
                          stroke="#7C3AED"
                          strokeWidth="1.4"
                          strokeDasharray="3 2"
                          points={chartModel.ema44Points}
                        />
                      )}
                      {chartModel.smaPoints && (
                        <polyline
                          fill="none"
                          stroke="#D97706"
                          strokeWidth="1.25"
                          strokeDasharray="4 3"
                          points={chartModel.smaPoints}
                        />
                      )}

                      <g transform={`translate(0, ${chartModel.priceHeight + 8})`}>
                        <line
                          x1={chartModel.padL}
                          x2={chartModel.width - chartModel.padR}
                          y1={chartModel.yDelivFor(60)}
                          y2={chartModel.yDelivFor(60)}
                          stroke="#16A34A"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={chartModel.width - chartModel.padR + 6}
                          y={chartModel.yDelivFor(60) + 3}
                          className="fill-emerald-700 text-[10px] font-mono"
                        >
                          60% Del
                        </text>

                        {data.history.map((d, i) => {
                          const x = chartModel.xFor(i);
                          const barH = (d.volume / chartModel.maxVol) * (chartModel.volHeight - 22);
                          const y = chartModel.volHeight - 10 - barH;
                          const isHighDeliv = (d.delivPer ?? 0) >= 60;
                          return (
                            <rect
                              key={d.date}
                              x={x - chartModel.barW / 2}
                              y={y}
                              width={chartModel.barW}
                              height={Math.max(1, barH)}
                              fill={isHighDeliv ? '#93C5FD' : '#CBD5E1'}
                              rx="1"
                            />
                          );
                        })}

                        <polyline
                          fill="none"
                          stroke="#1D4ED8"
                          strokeWidth="1.75"
                          points={chartModel.delivPoints}
                        />
                      </g>
                    </>
                  )}

                  {data.history.map((d, i) => {
                    const x = chartModel.xFor(i);
                    const sliceW = chartModel.plotW / Math.max(data.history.length - 1, 1);
                    return (
                      <rect
                        key={`hit-${d.date}`}
                        x={x - sliceW / 2}
                        y={0}
                        width={sliceW}
                        height={chartModel.priceHeight + chartModel.volHeight + 10}
                        fill="transparent"
                        onMouseEnter={() => setHoverIdx(i)}
                      />
                    );
                  })}

                  {hoverIdx !== null && data.history[hoverIdx] && (
                    <line
                      x1={chartModel.xFor(hoverIdx)}
                      x2={chartModel.xFor(hoverIdx)}
                      y1={10}
                      y2={chartModel.priceHeight + chartModel.volHeight}
                      stroke="#94A3B8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  )}

                  {[0, Math.floor(data.history.length / 2), data.history.length - 1].map((idx) => {
                    const item = data.history[idx];
                    if (!item) return null;
                    return (
                      <text
                        key={`lbl-${idx}`}
                        x={chartModel.xFor(idx)}
                        y={chartModel.priceHeight + chartModel.volHeight + 22}
                        textAnchor="middle"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {item.date}
                      </text>
                    );
                  })}
                </svg>
              </div>
              {chartOverlayMode === 'PRICE_DELIV' ? (
                <div className="mt-2 flex flex-wrap items-center gap-5 text-[11px] text-slate-500">
                  <span>Black: Close Price</span>
                  <span className="text-emerald-700">Green: 21-Session EMA</span>
                  <span className="text-violet-700">Purple dashed: 44-Session EMA</span>
                  <span className="text-amber-700">Amber dashed: 20-Session SMA</span>
                  <span className="text-blue-700">Blue: Delivery % (60% threshold)</span>
                </div>
              ) : chartOverlayMode === 'RSI_DIVERGENCE' ? (
                <div className="mt-2 flex flex-wrap items-center gap-5 text-[11px] text-slate-500">
                  <span>Black: Close Price</span>
                  <span className="text-blue-700">Blue: Wilder RSI(14) (70/30 bands)</span>
                  <span className="text-emerald-700 font-medium">
                    Green solid/dashed: Regular / Hidden Bullish Divergence
                  </span>
                  <span className="text-rose-700 font-medium">
                    Red solid/dashed: Regular / Hidden Bearish Divergence
                  </span>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-5 text-[11px] text-slate-500">
                  <span>Black: Close Price</span>
                  <span className="text-emerald-700">Green: 21-Session EMA</span>
                  <span className="text-blue-700">Blue shaded / dashed: EMA21 ± 1.5× ATR(14) Channel</span>
                  <span className="text-orange-700">Orange: Daily ATR(14) %</span>
                  <span className="text-slate-600">Slate dashed: 30D Rolling Mean ATR %</span>
                  <span className="text-emerald-700 font-medium">
                    Green Band / Dots: ATR Squeeze Precursor (&le;0.88× 30D Mean)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Automated RSI(14) Divergence Detection Engine */}
          {rsiDivergence && (
            <RsiDivergenceCard
              symbol={data.summary.symbol}
              analysis={rsiDivergence}
              selectedDivergenceId={selectedDivergenceId}
              onInspectDivergence={(sig: RsiDivergenceSignal) => {
                setChartOverlayMode('RSI_DIVERGENCE');
                setSelectedDivergenceId(sig.id);
                setHoverIdx(sig.to.index);
                document
                  .getElementById('stock-price-chart')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
            />
          )}

          {/* 30-Day Cumulative Institutional Flow (Delivery Quantity Trends) */}
          <InstitutionalFlowChart symbol={data.summary.symbol} history={data.history} />

          {/* 14-Day Price & Return Correlation Matrix vs Top-3 Sector Peers */}
          <PeerCorrelationMatrixCard
            initialData={data.peerCorrelation}
            symbol={data.summary.symbol}
            onSelectSymbol={onSelectSymbol}
          />

          {/* EPS Drop Active Rejection Banner */}
          {data.fundamentals?.epsPrev !== null && data.fundamentals?.epsPrev !== undefined && data.fundamentals?.epsCurr !== null && data.fundamentals?.epsCurr !== undefined && data.fundamentals.epsCurr < data.fundamentals.epsPrev && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <div className="text-xs font-bold text-rose-900 uppercase">
                  REJECTED: EPS DROP ACTIVE ({(((data.fundamentals.epsCurr - data.fundamentals.epsPrev) / Math.abs(data.fundamentals.epsPrev)) * 100).toFixed(1)}%)
                </div>
                <div className="text-xs text-rose-700 mt-0.5">
                  Quarterly EPS declined from ₹{data.fundamentals.epsPrev.toFixed(2)} to ₹{data.fundamentals.epsCurr.toFixed(2)}. Fundamental Contradiction gate rejects this stock in Deep-Dive.
                </div>
              </div>
            </div>
          )}

          {/* Seasonality Heatmap (3-Year Monthly Returns) */}
          {data.seasonality && data.seasonality.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">3-Year Seasonality Heatmap</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Historical monthly return averages ({data.summary.symbol}). Current month historically {data.currentMonthNegative ? 'Negative (Applied -5 Score Penalty)' : 'Positive'}.
                  </p>
                </div>
                {data.currentMonthNegative && (
                  <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-rose-50 text-rose-800 border border-rose-200 rounded">
                    Current Month Negative (-5 Penalty)
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 pt-2">
                {data.seasonality.map((s, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded border text-center ${
                      s.isPositive
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50/70 border-rose-200 text-rose-900'
                    }`}
                  >
                    <div className="text-xs font-bold">{s.month}</div>
                    <div className={`text-sm font-mono font-semibold mt-1 ${s.isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {s.avgReturnPct >= 0 ? '+' : ''}{s.avgReturnPct.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5-Year Dividend Payout History & Long-Term Stock Performance (Recharts) */}
          <DividendHistoryChartCard
            symbol={data.summary.symbol}
            externalRefreshSeq={externalRefreshSeq}
          />

          {/* Mandatory Fundamental Verification + 2-Quarterly EPS & Remaining Strength */}
          <QuarterlyEpsValuationPanel
            symbol={data.summary.symbol}
            summary={data.summary}
            fundamentals={data.fundamentals}
            detectedPeakPrice={detectedPeak.price}
            detectedPeakDate={detectedPeak.date}
            verifying={fundFetching}
            onVerifyFundamentals={handleFetchLiveFundamentals}
          />

          {/* U-Turn Strategy Monitor (Peak Price & EPS Drop vs Live Delivery % & RVOL) */}
          <UTurnStrategyMonitor
            symbol={data.summary.symbol}
            latestDate={data.summary.latestDate}
            currentClose={data.summary.closePrice}
            detectedPeakPrice={detectedPeak.price}
            detectedPeakDate={detectedPeak.date}
            epsPrev={data.fundamentals?.epsPrev ?? null}
            epsCurr={data.fundamentals?.epsCurr ?? null}
            epsPrevPeriod={data.fundamentals?.epsPrevPeriod}
            epsCurrPeriod={data.fundamentals?.epsCurrPeriod}
            trailingPE={data.fundamentals?.trailingPE ?? null}
            liveDeliveryPct={data.summary.delivPer}
            liveRvol={data.summary.rvol}
            onSelectSymbol={onSelectSymbol}
            onSendToRisk={onSendToRisk}
          />

          {/* 6-Month Delivery A/B Breakout Backtester */}
          <StockBacktestCard symbol={data.summary.symbol} />

          {/* ECMS Gemini Research Panel (Untouched ECMS Workflow) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  ECMS Evidence-Aware Gemini Research (gemini-4-hydrogen)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Replicates tools/ecms_gemini_research.py using verified Bhavcopy, Fundamental &amp; XBRL data. Supplementary research only, not a trade signal.
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSearchGrounding}
                    onChange={(e) => setUseSearchGrounding(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  Google Search Grounding
                </label>
                <button
                  onClick={handleRunGeminiResearch}
                  disabled={geminiLoading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {geminiLoading ? 'Analyzing...' : 'Analyze Stock'}
                </button>
              </div>
            </div>

            {geminiError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
                {geminiError}
              </div>
            )}

            {geminiReport && (
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span
                      className={`font-semibold ${
                        geminiReport.research_classification === 'STRONG'
                          ? 'text-emerald-700'
                          : geminiReport.research_classification === 'AVOID' ||
                              geminiReport.research_classification === 'CAUTION'
                            ? 'text-rose-700'
                            : 'text-amber-700'
                      }`}
                    >
                      Classification: {geminiReport.research_classification}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-700">Confidence: {geminiReport.confidence}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{geminiReport.research_model}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    not_a_trade_signal=true
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded p-3.5">
                  {geminiReport.analyst_conclusion}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <div>
                      <div className="font-semibold text-slate-700">Business Quality</div>
                      <p className="text-slate-600 mt-0.5">{geminiReport.business_quality}</p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700">Financial Strength</div>
                      <p className="text-slate-600 mt-0.5">{geminiReport.financial_strength}</p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700">Growth &amp; Profitability</div>
                      <p className="text-slate-600 mt-0.5">{geminiReport.growth_and_profitability}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="font-semibold text-slate-700">Debt &amp; Cashflow</div>
                      <p className="text-slate-600 mt-0.5">{geminiReport.debt_and_cashflow}</p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700">Valuation &amp; Sector Context</div>
                      <p className="text-slate-600 mt-0.5">
                        {geminiReport.valuation} — {geminiReport.sector_context}
                      </p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700">Latest Results &amp; Filings</div>
                      <p className="text-slate-600 mt-0.5">
                        {geminiReport.latest_results_and_announcements}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
                  <div>
                    <div className="font-semibold text-emerald-700 mb-1">Positive Factors</div>
                    <ul className="space-y-1 text-slate-600 list-disc list-inside">
                      {geminiReport.positive_factors.length > 0 ? (
                        geminiReport.positive_factors.map((f, i) => <li key={i}>{f}</li>)
                      ) : (
                        <li>None identified</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <div className="font-semibold text-rose-700 mb-1">Negative Factors &amp; Red Flags</div>
                    <ul className="space-y-1 text-slate-600 list-disc list-inside">
                      {[...geminiReport.negative_factors, ...geminiReport.red_flags].length > 0 ? (
                        [...geminiReport.negative_factors, ...geminiReport.red_flags].map((f, i) => (
                          <li key={i}>{f}</li>
                        ))
                      ) : (
                        <li>None flagged</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <div className="font-semibold text-amber-700 mb-1">Missing / Unverified Data</div>
                    <ul className="space-y-1 text-slate-600 list-disc list-inside">
                      {geminiReport.missing_or_unverified_data.length > 0 ? (
                        geminiReport.missing_or_unverified_data.map((f, i) => <li key={i}>{f}</li>)
                      ) : (
                        <li>None reported</li>
                      )}
                    </ul>
                  </div>
                </div>

                {geminiReport.grounding_sources && geminiReport.grounding_sources.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 text-xs">
                    <div className="font-semibold text-slate-700 mb-1">Google Search Sources</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {geminiReport.grounding_sources.map((src, i) => (
                        <a
                          key={i}
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          {src.title}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fundamentals Scorecard + Valuation */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    7-Metric Fundamental Scorecard
                  </h3>
                  <p className="text-xs text-slate-500">
                    {data.fundamentals
                      ? `${data.fundamentals.source || 'Cached'} · Period End ${data.fundamentals.financialPeriodEnd || '—'} · Pub ${data.fundamentals.publicationDate || data.summary.latestFilingDate || '—'}`
                      : 'No fundamental ratio record cached for this symbol yet'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {data.fundamentals && (
                    <span className="font-mono text-xs text-slate-700">
                      {data.fundamentals.coverage} ({data.fundamentals.passCount}/7 Pass)
                    </span>
                  )}
                  <button
                    onClick={handleFetchLiveFundamentals}
                    disabled={fundFetching}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${fundFetching ? 'animate-spin' : ''}`} />
                    {fundFetching ? 'Collecting...' : 'Collect Live (NSE+BSE+YF)'}
                  </button>
                </div>
              </div>

              <div
                className={`px-5 py-2.5 border-b border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2 ${
                  data.summary.fundamentalFreshness === 'LATEST'
                    ? 'bg-emerald-50/50 text-emerald-900'
                    : data.summary.fundamentalFreshness === 'OLD_3M'
                      ? 'bg-amber-50/50 text-amber-900'
                      : data.summary.fundamentalFreshness === 'STALE'
                        ? 'bg-orange-50/50 text-orange-900'
                        : 'bg-rose-50/50 text-rose-900'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <span className="font-mono uppercase font-semibold">
                    {data.summary.fundamentalFreshness === 'LATEST'
                      ? 'Remark: Latest (<=3M)'
                      : data.summary.fundamentalFreshness === 'OLD_3M'
                        ? 'Remark: 3+ Months Old'
                        : data.summary.fundamentalFreshness === 'STALE'
                          ? 'Remark: Old / Stale (>Max Age)'
                          : 'Remark: Abhi Mila Nahi'}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span>{data.summary.fundamentalRemark}</span>
                </div>
                {data.summary.fundamentalSources.length > 0 && (
                  <span className="font-mono text-[11px] text-slate-600">
                    Sources: {data.summary.fundamentalSources.join(' · ')}
                  </span>
                )}
              </div>

              {fundNotice && (
                <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
                  {fundNotice}
                </div>
              )}

              {data.fundamentals ? (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <th className="py-2 px-4">Metric</th>
                      <th className="py-2 px-3 text-right">Value</th>
                      <th className="py-2 px-3 text-right">Threshold</th>
                      <th className="py-2 px-4 text-right">Gate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.fundamentals.checks.map((c) => (
                      <tr key={c.key}>
                        <td className="py-2.5 px-4 text-slate-800 font-medium">{c.label}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-900">
                          {c.formattedValue}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                          {c.thresholdLabel}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">
                          {c.status === 'PASS' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              PASS
                            </span>
                          ) : c.status === 'FAIL' ? (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                              <XCircle className="w-3.5 h-3.5" />
                              FAIL
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              MISSING
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-xs text-slate-500">
                  Click &ldquo;Verify &amp; Save Fundamentals&rdquo; above to retrieve live Screener.in + BSE Official + NSE XBRL statements and ratios for {data.summary.symbol}.
                </div>
              )}
            </div>

            {/* Valuation & Shareholding */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Valuation &amp; Ownership Snapshot
              </h3>
              {data.fundamentals ? (
                <dl className="divide-y divide-slate-100 text-xs">
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">Trailing P/E</dt>
                    <dd className="font-mono text-slate-900">
                      {data.fundamentals.trailingPE?.toFixed(2) ?? '—'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">Price / Book</dt>
                    <dd className="font-mono text-slate-900">
                      {data.fundamentals.priceToBook?.toFixed(2) ?? '—'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">Dividend Yield</dt>
                    <dd className="font-mono text-slate-900">
                      {data.fundamentals.dividendYieldPct !== null
                        ? `${data.fundamentals.dividendYieldPct.toFixed(2)}%`
                        : '—'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">Promoter Holding</dt>
                    <dd className="font-mono text-slate-900">
                      {data.fundamentals.promoterHoldingPct !== null
                        ? `${data.fundamentals.promoterHoldingPct.toFixed(2)}%`
                        : '—'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">FII / DII Holding</dt>
                    <dd className="font-mono text-slate-900">
                      {data.fundamentals.fiiHoldingPct !== null
                        ? `${data.fundamentals.fiiHoldingPct.toFixed(1)}%`
                        : '—'}{' '}
                      /{' '}
                      {data.fundamentals.diiHoldingPct !== null
                        ? `${data.fundamentals.diiHoldingPct.toFixed(1)}%`
                        : '—'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">Earnings Quality</dt>
                    <dd className="font-mono text-slate-700">
                      {data.fundamentals.earningsQualityStatus || '—'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between">
                    <dt className="text-slate-500">Period Alignment</dt>
                    <dd className="font-mono text-slate-700">
                      {data.fundamentals.periodAlignmentStatus || '—'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="text-xs text-slate-500">No valuation snapshot available.</div>
              )}
            </div>
          </div>

          {/* Fundamental Audit Table (Symbol -> NSE/BSE Exchange Mapping, Timestamp, Freshness) */}
          <FundamentalAuditTable
            activeSymbol={data.summary.symbol}
            initialRows={data.fundamentalAuditRows || []}
            onSelectSymbol={onSelectSymbol}
            onStockRefreshed={async () => {
              await loadStock(data.summary.symbol);
            }}
          />

          {/* Catalyst News: Recent Corporate Filings + Gemini 3-Bullet Bull/Bear/Neutral Sentiment */}
          <CatalystNewsCard
            symbol={data.summary.symbol}
            externalRefreshSeq={externalRefreshSeq}
          />

          {/* Latest News & Announcements (Free India Financial RSS + BSE Corporate Announcements) */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Newspaper className="w-4 h-4 text-blue-700" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Latest News &amp; Announcements
                  </h3>
                  {stockNews?.hasRecentAnnouncement && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                      <Bell className="w-3 h-3" />
                      {stockNews.recentAnnouncementLabel || 'Announcement'}
                    </span>
                  )}
                  {stockNews?.hasRiskAlert && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 rounded">
                      <AlertTriangle className="w-3 h-3" />
                      Risk Headline Alert
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Latest financial news ({stockNews?.providerUsed || 'Moneycontrol, ET, Business Standard'}) &amp; BSE corporate announcements · Daily cached ({stockNews?.cacheDateIst || 'Today IST'})
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadStockNews(data.summary.symbol, true)}
                disabled={stockNewsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 disabled:opacity-50 rounded-md transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${stockNewsLoading ? 'animate-spin' : ''}`} />
                {stockNewsLoading ? 'Fetching News...' : 'Refresh News'}
              </button>
            </div>

            {stockNewsLoading && !stockNews ? (
              <div className="p-6 text-xs text-slate-500">
                Fetching latest headlines and BSE corporate announcements for {data.summary.symbol}...
              </div>
            ) : stockNewsError ? (
              <div className="p-6 text-xs text-rose-700 bg-rose-50/50">{stockNewsError}</div>
            ) : !stockNews || stockNews.items.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                No recent stock-specific news or corporate announcements matched {data.summary.symbol}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {stockNews.items.map((item, idx) => (
                  <div
                    key={item.id || `${item.source}-${idx}`}
                    className={`px-5 py-3 transition-colors ${
                      item.isRiskAlert
                        ? 'bg-rose-50/90 border-l-4 border-l-rose-600'
                        : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-xs font-medium inline-flex items-start gap-1.5 hover:underline ${
                              item.isRiskAlert ? 'text-rose-800 font-semibold' : 'text-slate-900 hover:text-blue-700'
                            }`}
                          >
                            <span>{item.headline}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                          </a>
                        ) : (
                          <div
                            className={`text-xs font-medium ${
                              item.isRiskAlert ? 'text-rose-800 font-semibold' : 'text-slate-900'
                            }`}
                          >
                            {item.headline}
                          </div>
                        )}
                        <div
                          className={`flex flex-wrap items-center gap-2 text-[11px] font-mono ${
                            item.isRiskAlert ? 'text-rose-700' : 'text-slate-500'
                          }`}
                        >
                          <span>Source: {item.source}</span>
                          <span>·</span>
                          <span>{item.dateIso}</span>
                          {item.kind === 'ANNOUNCEMENT' && item.announcementTag && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-50 text-amber-800 border border-amber-200">
                              {item.announcementTag}
                            </span>
                          )}
                          {item.isRiskAlert && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-800 border border-rose-300">
                              RED ALERT (Fraud / Penalty / Downgrade)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Events & News (7D News, Upcoming 3M Result Announcements & 30D Bulk/Block Deals) */}
          <UpcomingEventsNewsPanel
            symbol={data.summary.symbol}
            data={catalystData}
            loading={catalystLoading}
            error={catalystError}
            onRefresh={() => void loadCatalysts(data.summary.symbol, true)}
          />

          {/* Paper Trading BUY / SELL Journal & Strategy Profit Tracker */}
          <div id="paper-trading-section">
            <PaperTradingPanel
              symbol={data.summary.symbol}
              currentClose={data.summary.closePrice}
              livePrice={liveQuote?.available ? liveQuote.livePrice : null}
              suggestedStopLoss={data.summary.suggestedStopLoss}
              defaultStrategyTag={
                data.summary.uTurnStatus === 'ACTIVE_TRIGGER' ||
                data.summary.uTurnStatus === 'CONFIRMED_SUPPORT'
                  ? 'U-Turn'
                  : data.summary.swingTier === 'TIER_1_READY'
                    ? 'Swing Tier 1'
                    : 'v3 Bot'
              }
              onSelectSymbol={onSelectSymbol}
              externalSeq={paperSeq}
            />
          </div>

          {/* Personal Trade Journal (Entry/Exit Notes, Sentiment & Lessons Learned) */}
          <TradeJournalPanel
            symbol={data.summary.symbol}
            latestDate={data.summary.latestDate}
            currentClose={data.summary.closePrice}
            suggestedStopLoss={data.summary.suggestedStopLoss}
            defaultSetupTag={
              data.summary.swingTier !== 'NONE'
                ? data.summary.swingTier
                : data.summary.uTurnStatus || ''
            }
            onSelectSymbol={onSelectSymbol}
          />

          {/* Official NSE XBRL Filings */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Official NSE Integrated XBRL Financial Filings ({data.xbrlFilings.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Direct filing links from outputs/v8_official_financial_results_filings.csv
                </p>
              </div>
            </div>
            {data.xbrlFilings.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                No official XBRL filings indexed for {data.summary.symbol}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <th className="py-2 px-4">Period End</th>
                      <th className="py-2 px-3">Publication Date</th>
                      <th className="py-2 px-3">Filing Description</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-4 text-right">Official XBRL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.xbrlFilings.slice(0, 12).map((f, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-4 font-mono text-slate-700">
                          {f.financialPeriodEnd}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-600">
                          {f.publicationDate}
                        </td>
                        <td className="py-2 px-3 text-slate-800">{f.filingDescription}</td>
                        <td className="py-2 px-3 font-mono text-emerald-700">
                          {f.publicationDateStatus}
                        </td>
                        <td className="py-2 px-4 text-right">
                          <a
                            href={f.officialFilingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                          >
                            View XML
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
