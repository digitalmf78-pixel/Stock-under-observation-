import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Compass,
  Database,
  Download,
  Filter,
  Layers,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react';
import type {
  FundamentalCollectionStatus,
  FundamentalFreshness,
  LiveStockQuote,
  MacroNewsDashboardResponse,
  OverviewData,
  ScreenerFilterPatch,
  UpcomingResultObservationResponse,
} from '../types/trading';
import { getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { evaluateQuoteFreshness } from '../utils/quoteFreshness';
import { SwingTierSpecPanel } from './SwingTierSpecPanel';
import { T1T2DailyReportModal } from './T1T2DailyReportModal';
import { EmaTrendHeatmap } from './EmaTrendHeatmap';
import { SectorDeliverySparklines } from './SectorDeliverySparklines';

interface OverviewViewProps {
  data: OverviewData;
  onSelectSymbol: (symbol: string) => void;
  onNavigate: (tab: 'bot' | 'screener' | 'ipo' | 'catalysts' | 'signals' | 'risk') => void;
  onOpenScreener?: (patch: ScreenerFilterPatch) => void;
  onOpenBotIpo?: () => void;
  onFilterBySector: (sector: string) => void;
  onFilterByFreshness: (freshness: FundamentalFreshness | 'ALL') => void;
  onReloadOverview: () => Promise<void>;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  data,
  onSelectSymbol,
  onNavigate,
  onOpenScreener,
  onOpenBotIpo,
  onFilterBySector,
  onFilterByFreshness,
  onReloadOverview,
}) => {
  const { funnel, thresholds, fundamentalAudit } = data;
  const maxCount = Math.max(funnel.universeMainboard, 1);

  const [syncingBhav, setSyncingBhav] = useState(false);
  const [fetchingFund, setFetchingFund] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [collectStatus, setCollectStatus] = useState<FundamentalCollectionStatus | null>(null);
  const [botMacro, setBotMacro] = useState<MacroNewsDashboardResponse | null>(null);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveStockQuote>>({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveCheckedAt, setLiveCheckedAt] = useState('');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [t1T2ReportOpen, setT1T2ReportOpen] = useState(false);

  const [editRulesOpen, setEditRulesOpen] = useState(false);
  const [ruleRevGrowth, setRuleRevGrowth] = useState(thresholds.min_revenue_growth_pct);
  const [ruleProfGrowth, setRuleProfGrowth] = useState(thresholds.min_profit_growth_pct);
  const [ruleRoe, setRuleRoe] = useState(thresholds.min_roe_pct);
  const [ruleRoce, setRuleRoce] = useState(thresholds.min_roce_pct);
  const [ruleDebtEquity, setRuleDebtEquity] = useState(thresholds.max_debt_to_equity);
  const [ruleIntCov, setRuleIntCov] = useState(thresholds.min_interest_coverage);
  const [ruleOcfPos, setRuleOcfPos] = useState(thresholds.require_positive_operating_cash_flow);
  const [ruleMaxDataAgeDays, setRuleMaxDataAgeDays] = useState(thresholds.max_data_age_days);
  const [ruleSaving, setRuleSaving] = useState(false);

  useEffect(() => {
    setRuleRevGrowth(thresholds.min_revenue_growth_pct);
    setRuleProfGrowth(thresholds.min_profit_growth_pct);
    setRuleRoe(thresholds.min_roe_pct);
    setRuleRoce(thresholds.min_roce_pct);
    setRuleDebtEquity(thresholds.max_debt_to_equity);
    setRuleIntCov(thresholds.min_interest_coverage);
    setRuleOcfPos(thresholds.require_positive_operating_cash_flow);
    setRuleMaxDataAgeDays(thresholds.max_data_age_days);
  }, [thresholds]);

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setRuleSaving(true);
    try {
      const res = await fetch('/api/fundamentals/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          min_revenue_growth_pct: Number(ruleRevGrowth),
          min_profit_growth_pct: Number(ruleProfGrowth),
          min_roe_pct: Number(ruleRoe),
          min_roce_pct: Number(ruleRoce),
          max_debt_to_equity: Number(ruleDebtEquity),
          min_interest_coverage: Number(ruleIntCov),
          require_positive_operating_cash_flow: Boolean(ruleOcfPos),
          max_data_age_days: Math.max(90, Math.round(Number(ruleMaxDataAgeDays) || 548)),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditRulesOpen(false);
      await onReloadOverview();
      setSyncNotice({ tone: 'ok', text: 'Fundamental filter rules updated successfully!' });
    } catch (err) {
      setSyncNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setRuleSaving(false);
    }
  };

  // Dedicated Upcoming Result Date Stocks Observation List state
  const [upcomingData, setUpcomingData] = useState<UpcomingResultObservationResponse | null>(null);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingWindow, setUpcomingWindow] = useState<'ALL' | 'WITHIN_1M' | 'WITHIN_2M' | 'WITHIN_3M' | 'BEYOND_3M'>('ALL');
  const [upcomingPolarity, setUpcomingPolarity] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN'>('ALL');
  const [upcomingSwingOnly, setUpcomingSwingOnly] = useState(false);
  const [upcomingQ, setUpcomingQ] = useState('');

  const fetchBatchLiveQuotes = useCallback(
    async (rawSymbols: string[], forceRefresh = false, signal?: AbortSignal) => {
      const symbols = Array.from(new Set(rawSymbols.filter(Boolean))).slice(0, 50);
      if (symbols.length === 0) return;
      setLiveLoading(true);
      setLiveError(null);
      try {
        const res = await fetch('/api/stocks/live-quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols, refresh: forceRefresh }),
          signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (json.quotes && typeof json.quotes === 'object') {
          setLiveQuotes((prev) => ({ ...prev, ...json.quotes }));
          setLiveCheckedAt(new Date().toLocaleTimeString('en-IN', { hour12: false }));
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setLiveError((err as Error).message || 'Live quote fetch failed');
        }
      } finally {
        if (!signal?.aborted) setLiveLoading(false);
      }
    },
    []
  );

  const fetchTopMoversLive = useCallback(
    async (forceRefresh = false, signal?: AbortSignal) => {
      const combined = [
        ...data.topDeliveryMovers.map((r) => r.symbol),
        ...data.recentSignals.map((s) => s.symbol),
      ];
      await fetchBatchLiveQuotes(combined, forceRefresh, signal);
    },
    [data.topDeliveryMovers, data.recentSignals, fetchBatchLiveQuotes]
  );

  useEffect(() => {
    if (data.topDeliveryMovers.length === 0 && data.recentSignals.length === 0) return;
    const controller = new AbortController();
    void fetchTopMoversLive(false, controller.signal);
    return () => controller.abort();
  }, [fetchTopMoversLive, data.topDeliveryMovers.length, data.recentSignals.length]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setUpcomingLoading(true);
      try {
        const params = new URLSearchParams({
          window: upcomingWindow,
          polarity: upcomingPolarity,
          limit: '100',
        });
        if (upcomingSwingOnly) params.set('swingOnly', '1');
        if (upcomingQ.trim()) params.set('q', upcomingQ.trim());
        const res = await fetch(`/api/upcoming-results?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json: UpcomingResultObservationResponse = await res.json();
        setUpcomingData(json);
      } catch {
        // ignore abort
      } finally {
        if (!controller.signal.aborted) setUpcomingLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [upcomingWindow, upcomingPolarity, upcomingSwingOnly, upcomingQ, data.latestSessionDate]);

  useEffect(() => {
    if (!upcomingData?.items?.length) return;
    const controller = new AbortController();
    void fetchBatchLiveQuotes(
      upcomingData.items.slice(0, 30).map((i) => i.symbol),
      false,
      controller.signal
    );
    return () => controller.abort();
  }, [upcomingData?.items, fetchBatchLiveQuotes]);

  const topMoversLiveSummary = useMemo(() => {
    let availableCount = 0;
    let upCount = 0;
    let downCount = 0;
    let flatCount = 0;
    let staleCount = 0;
    let liveCount = 0;
    let sumMovePct = 0;

    for (const r of data.topDeliveryMovers) {
      const q = liveQuotes[r.symbol];
      if (!q || !q.available || q.livePrice === null || r.closePrice <= 0) continue;
      availableCount++;
      const freshness = evaluateQuoteFreshness({
        lastUpdated: q.lastUpdated,
        marketTimeUnixSec: q.marketTimestampSec,
        marketTimeIst: q.marketTimeIst,
        marketDateIst: q.marketDateIst,
        marketState: q.marketState,
      });
      if (freshness.isStale) staleCount++;
      if (freshness.isLive) liveCount++;
      const pct = ((q.livePrice - r.closePrice) / r.closePrice) * 100;
      sumMovePct += pct;
      if (pct > 0.05) upCount++;
      else if (pct < -0.05) downCount++;
      else flatCount++;
    }

    return {
      availableCount,
      upCount,
      downCount,
      flatCount,
      staleCount,
      liveCount,
      avgMovePct: availableCount > 0 ? sumMovePct / availableCount : null,
      rightPct: availableCount > 0 ? (upCount / availableCount) * 100 : null,
    };
  }, [data.topDeliveryMovers, liveQuotes]);

  useEffect(() => {
    let active = true;
    fetch('/api/fundamentals/collect-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (active && s) setCollectStatus(s);
      })
      .catch(() => {});
    fetch('/api/bot/macro-news')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (active && m) setBotMacro(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!collectStatus?.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/fundamentals/collect-status');
        if (!res.ok) return;
        const st: FundamentalCollectionStatus = await res.json();
        setCollectStatus(st);
        if (!st.running) {
          await onReloadOverview();
          setSyncNotice({
            tone: 'ok',
            text: `Multi-source collection finished (${st.scope}): ${st.succeeded}/${st.total} updated (NSE XBRL ${st.nseXbrlHits} · Screener.in ${st.yahooNsHits} · BSE Official ${st.bseBoHits}).`,
          });
        }
      } catch {
        // ignore transient poll errors
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [collectStatus?.running, onReloadOverview]);

  const handleSaveAllNseToCache = async (
    scope: 'LIQUID' | 'MISSING_OR_OLD' | 'NOT_AVAILABLE' | 'ALL'
  ) => {
    setSyncNotice(null);
    try {
      const res = await fetch('/api/fundamentals/save-to-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveAll: true, scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCollectStatus(json);
      setSyncNotice({
        tone: 'ok',
        text: json.started
          ? `Saving all ${json.total} NSE symbols (${scope}) to disk cache in background...`
          : json.message || 'All NSE fundamentals already saved & up to date.',
      });
    } catch (err) {
      setSyncNotice({ tone: 'err', text: (err as Error).message });
    }
  };

  const handleStartCollection = async (
    scope: 'LIQUID' | 'MISSING_OR_OLD' | 'NOT_AVAILABLE' | 'ALL',
    limit?: number
  ) => {
    setSyncNotice(null);
    try {
      const res = await fetch('/api/fundamentals/collect-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, limit }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCollectStatus(json);
      if (!json.running && json.message) {
        setSyncNotice({ tone: 'ok', text: json.message });
      }
    } catch (err) {
      setSyncNotice({ tone: 'err', text: (err as Error).message });
    }
  };

  const handleSyncBhavcopy = async () => {
    setSyncingBhav(true);
    setSyncNotice(null);
    try {
      const res = await fetch('/api/scanner/reload-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await onReloadOverview();
      setSyncNotice({
        tone: 'ok',
        text: json.message || `Scanner reloaded through ${json.latestSessionDate}.`,
      });
    } catch (err) {
      setSyncNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setSyncingBhav(false);
    }
  };

  const handleBatchFundamentals = async () => {
    setFetchingFund(true);
    setSyncNotice(null);
    try {
      const res = await fetch('/api/refresh/fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchMissing: true, limit: 20 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.succeeded?.length > 0) {
        await onReloadOverview();
      }
      setSyncNotice({
        tone: json.succeeded?.length > 0 ? 'ok' : 'err',
        text: json.message || 'Batch refresh complete.',
      });
    } catch (err) {
      setSyncNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setFetchingFund(false);
    }
  };

  const openScreenerPreset = (patch: ScreenerFilterPatch) => {
    if (onOpenScreener) {
      onOpenScreener({
        q: '',
        sector: 'ALL',
        delivery: 'ALL',
        swingTier: 'ALL',
        uTurn: 'ALL',
        rvol: 'ALL',
        liquidity: 'ALL',
        fundamental: 'ALL',
        freshness: 'ALL',
        cap: 'ALL',
        emaCross: 'ALL',
        watchlistOnly: false,
        upcomingResultsOnly: false,
        sort: 'rvol',
        dir: 'desc',
        ...patch,
      });
    } else {
      onNavigate('screener');
    }
  };

  const totalWatchlistCount =
    funnel.tier1ReadyCount + funnel.tier2AccumulationCount + funnel.tier3RvolWatchCount;

  const stages = [
    {
      step: '01',
      title: 'NSE Mainboard Universe',
      detail: 'Eligible EQ/BE series (SME, ETF, and Debt excluded)',
      count: funnel.universeMainboard,
      pct: 100,
      tone: 'bg-slate-800',
      preset: { delivery: 'ALL', liquidity: 'ALL', swingTier: 'ALL' } as ScreenerFilterPatch,
      chips: [] as Array<{ label: string; preset: ScreenerFilterPatch }>,
    },
    {
      step: '02',
      title: '30-Day Delivery A OR B Union',
      detail: `${funnel.deliveryAAndB} A_AND_B · ${funnel.deliveryAOnly} A_ONLY · ${funnel.deliveryBOnly} B_ONLY`,
      count: funnel.deliveryAorBUnion,
      pct: (funnel.deliveryAorBUnion / maxCount) * 100,
      tone: 'bg-blue-700',
      preset: { delivery: 'UNION', liquidity: 'ALL' } as ScreenerFilterPatch,
      chips: [
        { label: `A_AND_B (${funnel.deliveryAAndB})`, preset: { delivery: 'A_AND_B', liquidity: 'ALL' } },
        { label: `A_ONLY (${funnel.deliveryAOnly})`, preset: { delivery: 'A_ONLY', liquidity: 'ALL' } },
        { label: `B_ONLY (${funnel.deliveryBOnly})`, preset: { delivery: 'B_ONLY', liquidity: 'ALL' } },
      ],
    },
    {
      step: '03',
      title: '20-Session Liquidity Gate (Avg >= ₹1.5 Cr)',
      detail: `${funnel.liquidityPassInUnion} PASS · ${funnel.liquidityBelowMinInUnion} BELOW_MIN`,
      count: funnel.liquidityPassInUnion,
      pct: (funnel.liquidityPassInUnion / maxCount) * 100,
      tone: 'bg-emerald-600',
      preset: { delivery: 'UNION', liquidity: 'PASS' } as ScreenerFilterPatch,
      chips: [
        { label: `PASS (${funnel.liquidityPassInUnion})`, preset: { delivery: 'UNION', liquidity: 'PASS' } },
        { label: `BELOW_MIN (${funnel.liquidityBelowMinInUnion})`, preset: { delivery: 'UNION', liquidity: 'BELOW_MIN' } },
      ],
    },
    {
      step: '04',
      title: 'RVOL > 1.5x in Liquid A/B Union',
      detail: `${funnel.rvolHighInLiquidUnion} HIGH · ${funnel.rvolLowInLiquidUnion} LOW · ${funnel.rvolWaitInLiquidUnion} WAIT_FOR_DATA`,
      count: funnel.rvolHighInLiquidUnion,
      pct: (funnel.rvolHighInLiquidUnion / maxCount) * 100,
      tone: 'bg-indigo-600',
      preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH' } as ScreenerFilterPatch,
      chips: [
        { label: `HIGH (${funnel.rvolHighInLiquidUnion})`, preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH' } },
        { label: `LOW (${funnel.rvolLowInLiquidUnion})`, preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'LOW' } },
      ],
    },
    {
      step: '05',
      title: 'Tiered Swing Watchlist (Stage 4 Sequential Subset)',
      detail: `T1 Ready: ${funnel.sequentialTier1Count} · T2 Accum: ${funnel.sequentialTier2Count} · T3 RVOL: ${funnel.sequentialTier3Count} · All-Universe Watchlist: ${totalWatchlistCount} (${funnel.tier1ReadyCount}+${funnel.tier2AccumulationCount}+${funnel.tier3RvolWatchCount})`,
      count: funnel.sequentialTieredCount,
      pct: (funnel.sequentialTieredCount / maxCount) * 100,
      tone: 'bg-teal-600',
      preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH', swingTier: 'ANY_SWING' } as ScreenerFilterPatch,
      chips: [
        { label: `T1 Ready (${funnel.sequentialTier1Count})`, preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH', swingTier: 'TIER_1_READY' } },
        { label: `T2 Accum (${funnel.sequentialTier2Count})`, preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH', swingTier: 'TIER_2_ACCUMULATION' } },
        { label: `T3 RVOL (${funnel.sequentialTier3Count})`, preset: { delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH', swingTier: 'TIER_3_RVOL_WATCH' } },
        { label: `All Watchlist (${totalWatchlistCount})`, preset: { delivery: 'ALL', liquidity: 'PASS', swingTier: 'ANY_SWING' } },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Open-Source v3 Swing Bot Live Macro & Regime Quick Card */}
      <div className="bg-white border border-emerald-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="text-sm font-semibold text-slate-900">
              Open-Source v3 Swing Bot (Phases 1–8 · Paper Trading Mode)
            </span>
            {botMacro && (
              <span
                className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${
                  botMacro.regime.regimeVerdict === 'PROCEED'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : botMacro.regime.regimeVerdict === 'HARD_STOP'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {botMacro.regime.regimeVerdict} ({(botMacro.regime.positionSizeMultiplier * 100).toFixed(0)}% Size)
              </span>
            )}
          </div>
          {botMacro ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-slate-700">
              <span>VIX: {botMacro.regime.indiaVix.available ? botMacro.regime.indiaVix.value : 'DATA NOT AVAILABLE'}</span>
              <span>DXY: {botMacro.regime.dxy.available ? botMacro.regime.dxy.value : 'DATA NOT AVAILABLE'} ({botMacro.regime.dxy.bias})</span>
              <span>Brent: {botMacro.regime.brentCrude.available ? `$${botMacro.regime.brentCrude.value}` : 'DATA NOT AVAILABLE'}</span>
              <span>
                Nifty:{' '}
                {botMacro.regime.nifty50.available && botMacro.regime.nifty50.value !== null
                  ? `${botMacro.regime.nifty50.value.toLocaleString('en-IN')}${
                      botMacro.regime.nifty50.return1wPct !== null
                        ? ` (${botMacro.regime.nifty50.return1wPct >= 0 ? '+' : ''}${botMacro.regime.nifty50.return1wPct.toFixed(2)}% 1W)`
                        : ''
                    }`
                  : 'DATA NOT AVAILABLE'}
              </span>
              <span>FII/DII Daily: {botMacro.regime.fiiDiiDaily.available ? botMacro.regime.fiiDiiDaily.note : 'DATA NOT AVAILABLE'}</span>
              <span>RSS: {botMacro.feeds.reduce((a, b) => a + b.count, 0)} live headlines</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              Loading live Yahoo Finance macro (India VIX, DXY, Brent, Nifty 50) &amp; ET/BS/LiveMint RSS...
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onNavigate('bot')}
          className="w-full lg:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 lg:py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors text-center sm:whitespace-nowrap shrink-0"
        >
          <span>Open Full v3 Bot, Daily Scan &amp; 3Y Backtest</span>
          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
        </button>
      </div>

      {/* Live Data Sync Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">Live Data Collection</span>
          <span className="mx-2 text-slate-300">·</span>
          <span>
            Cached {data.sessionsLoaded} NSE sessions ({data.sessionDateRange.from} to{' '}
            {data.latestSessionDate})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto shrink-0">
          <button
            onClick={handleSyncBhavcopy}
            disabled={syncingBhav}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingBhav ? 'animate-spin' : ''}`} />
            {syncingBhav ? 'Reloading Scanner...' : 'Sync Bhavcopy'}
          </button>
          <button
            onClick={handleBatchFundamentals}
            disabled={fetchingFund}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetchingFund ? 'animate-spin' : ''}`} />
            {fetchingFund ? 'Fetching Screener/BSE...' : 'Fetch Missing (20)'}
          </button>
        </div>
      </div>

      {syncNotice && (
        <div
          className={`px-4 py-2.5 rounded-lg border text-xs ${
            syncNotice.tone === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          {syncNotice.text}
        </div>
      )}

      {/* Top KPI Summary Strip — All cards & sub-pills clickable to open exact stock lists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'ALL', swingTier: 'ALL' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openScreenerPreset({ delivery: 'ALL', liquidity: 'ALL', swingTier: 'ALL' });
            }
          }}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-lg p-4 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Mainboard Universe</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-700 transition-colors" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono text-slate-900">
              {funnel.universeMainboard.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-mono">{data.latestSessionDate}</span>
          </div>
          <div className="mt-1.5 text-xs font-mono">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'UNION', liquidity: 'ALL', swingTier: 'ALL' });
              }}
              className="text-blue-700 hover:underline font-medium text-left"
            >
              30D A/B Union: {funnel.deliveryAorBUnion.toLocaleString()} ({((funnel.deliveryAorBUnion / maxCount) * 100).toFixed(1)}%) →
            </button>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', swingTier: 'T1_T2' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', swingTier: 'T1_T2' });
            }
          }}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-lg p-4 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Tier 1 &amp; 2 Swing Setups</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-700 transition-colors" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono text-blue-700">
              {(funnel.tier1ReadyCount + funnel.tier2AccumulationCount).toLocaleString()}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', swingTier: 'TIER_1_READY' });
              }}
              className="text-xs font-mono text-emerald-700 hover:underline font-semibold"
            >
              {funnel.tier1ReadyCount} T1 Ready →
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 font-mono">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', swingTier: 'TIER_2_ACCUMULATION' });
              }}
              className="hover:text-blue-700 hover:underline"
            >
              T2 Accum {funnel.tier2AccumulationCount}
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', swingTier: 'TIER_3_RVOL_WATCH' });
              }}
              className="hover:text-amber-700 hover:underline"
            >
              T3 RVOL {funnel.tier3RvolWatchCount}
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', swingTier: 'ANY_SWING' });
              }}
              className="text-teal-700 hover:underline font-medium"
            >
              Watchlist {totalWatchlistCount}
            </button>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => openScreenerPreset({ delivery: 'UNION', liquidity: 'PASS', swingTier: 'ALL' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openScreenerPreset({ delivery: 'UNION', liquidity: 'PASS', swingTier: 'ALL' });
            }
          }}
          className="bg-white border border-slate-200 hover:border-emerald-300 rounded-lg p-4 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Liquidity Qualified (&gt;= ₹1.5 Cr)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-700 transition-colors" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono text-emerald-700">
              {funnel.liquidityPassInUnion.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'UNION', liquidity: 'PASS', rvol: 'HIGH' });
              }}
              className="text-xs font-mono text-slate-700 hover:text-blue-700 hover:underline"
            >
              {funnel.rvolHighInLiquidUnion} High RVOL →
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'UNION', liquidity: 'PASS', fundamental: 'COMPLETE' });
              }}
              className="hover:text-emerald-700 hover:underline"
            >
              {funnel.fundamentalsCompleteInLiquidity} complete
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScreenerPreset({ delivery: 'UNION', liquidity: 'PASS', fundamental: 'PARTIAL_DATA' });
              }}
              className="hover:text-amber-700 hover:underline"
            >
              {funnel.fundamentalsPartialInLiquidity} partial fundamentals
            </button>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate('signals')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onNavigate('signals');
            }
          }}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-lg p-4 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Official XBRL &amp; Signal Index</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-700 transition-colors" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono text-slate-900">
              {funnel.xbrlFilingsTotalRows.toLocaleString()}
            </span>
            <span className="text-xs font-mono text-blue-700 font-medium">
              {funnel.signalLogTotalRows.toLocaleString()} signals →
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            NSE Integrated Filings &amp; evaluated signal log
          </div>
        </div>
      </div>

      {/* EMA 21/44 Crossover Breadth & Category Shortcuts Strip */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-800">Bullish EMA 21/44 &amp; Cap Cohorts:</span>
          <button
            type="button"
            onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', emaCross: 'BULLISH_ALIGNED' })}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono font-semibold transition-colors"
          >
            EMA 21 &gt; EMA 44 ({data.marketSentiment.aboveEma21And44Pct?.toFixed(1) ?? '—'}%)
            <ArrowUpRight className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'ALL', emaCross: 'RECENT_CROSS' })}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-600 bg-emerald-700 hover:bg-emerald-800 text-white font-mono font-semibold transition-colors"
          >
            5D EMA 21×44 Cross ({data.marketSentiment.emaCrossBullishCount ?? 0})
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 font-mono">
          <button
            type="button"
            onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', cap: 'LARGE_CAP' })}
            className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold"
          >
            Large Cap
          </button>
          <button
            type="button"
            onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', cap: 'MID_CAP' })}
            className="px-2 py-1 rounded border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-semibold"
          >
            Mid Cap
          </button>
          <button
            type="button"
            onClick={() => openScreenerPreset({ delivery: 'ALL', liquidity: 'PASS', cap: 'SMALL_CAP' })}
            className="px-2 py-1 rounded border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-semibold"
          >
            Small Cap
          </button>
          <button
            type="button"
            onClick={() => (onOpenBotIpo ? onOpenBotIpo() : onNavigate('ipo'))}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold"
          >
            v3 Bot · IPO (&lt;1Y)
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* T1 / T2 / T3 Swing Tier Specification Guide */}
      <SwingTierSpecPanel defaultOpen={true} />

      {/* Multi-Source Fundamental Audit & Freshness Breakdown (Screener.in + BSE Official + NSE XBRL) */}
      {fundamentalAudit && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-700" />
                All-Stock Fundamental Audit &amp; Freshness Remarks (Screener.in + BSE + NSE XBRL)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Audits all {fundamentalAudit.totalStocks.toLocaleString()} Mainboard stocks · Click any status card below to inspect stocks &amp; remarks in Screener
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => handleSaveAllNseToCache('MISSING_OR_OLD')}
                disabled={Boolean(collectStatus?.running)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${collectStatus?.running ? 'animate-spin' : ''}`} />
                Save All NSE Fundamentals
              </button>
              <button
                onClick={() => handleStartCollection('LIQUID', 150)}
                disabled={Boolean(collectStatus?.running)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                Liquid Batch (150)
              </button>
              <button
                onClick={() => handleStartCollection('NOT_AVAILABLE', 250)}
                disabled={Boolean(collectStatus?.running)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                Abhi Mila Nahi (250)
              </button>
            </div>
          </div>

          {collectStatus && (collectStatus.running || collectStatus.processed > 0) && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                <span className="font-semibold text-slate-900">
                  {collectStatus.running
                    ? `Collecting ${collectStatus.scope} (${collectStatus.currentSymbol})...`
                    : `Last Collector Run (${collectStatus.scope}) Complete`}
                </span>
                <span className="text-slate-600 tabular-nums">
                  {collectStatus.processed}/{collectStatus.total} · OK {collectStatus.succeeded} · N/A {collectStatus.failed} · NSE XBRL {collectStatus.nseXbrlHits} · Screener.in {collectStatus.yahooNsHits} · BSE Official {collectStatus.bseBoHits}
                </span>
              </div>
              <div className="h-1.5 w-full bg-slate-200 rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    collectStatus.running ? 'bg-blue-700' : 'bg-emerald-600'
                  }`}
                  style={{
                    width: `${
                      collectStatus.total > 0
                        ? Math.min(100, Math.round((collectStatus.processed / collectStatus.total) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => onFilterByFreshness('LATEST')}
              className="text-left p-3.5 rounded-md border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 transition-colors"
            >
              <div className="flex items-center justify-between text-xs font-medium text-emerald-800">
                <span>Latest (&lt;= 3 Months Old)</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-emerald-900">
                {fundamentalAudit.latestCount.toLocaleString()}
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-emerald-700">
                {((fundamentalAudit.latestCount / Math.max(fundamentalAudit.totalStocks, 1)) * 100).toFixed(1)}% · Period &lt;= 90d old
              </div>
            </button>

            <button
              type="button"
              onClick={() => onFilterByFreshness('OLD_3M')}
              className="text-left p-3.5 rounded-md border border-amber-200 bg-amber-50/40 hover:bg-amber-50 transition-colors"
            >
              <div className="flex items-center justify-between text-xs font-medium text-amber-800">
                <span>3+ Months Old (91–{thresholds.max_data_age_days}d)</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-amber-900">
                {fundamentalAudit.old3mCount.toLocaleString()}
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-amber-700">
                {((fundamentalAudit.old3mCount / Math.max(fundamentalAudit.totalStocks, 1)) * 100).toFixed(1)}% · Within {thresholds.max_data_age_days}d max age
              </div>
            </button>

            <button
              type="button"
              onClick={() => onFilterByFreshness('STALE')}
              className="text-left p-3.5 rounded-md border border-orange-200 bg-orange-50/40 hover:bg-orange-50 transition-colors"
            >
              <div className="flex items-center justify-between text-xs font-medium text-orange-800">
                <span>Old / Stale (&gt; {thresholds.max_data_age_days}d)</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-orange-900">
                {fundamentalAudit.staleCount.toLocaleString()}
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-orange-700">
                {((fundamentalAudit.staleCount / Math.max(fundamentalAudit.totalStocks, 1)) * 100).toFixed(1)}% · Exceeds {thresholds.max_data_age_days}d limit
              </div>
            </button>

            <button
              type="button"
              onClick={() => onFilterByFreshness('NOT_AVAILABLE')}
              className="text-left p-3.5 rounded-md border border-rose-200 bg-rose-50/40 hover:bg-rose-50 transition-colors"
            >
              <div className="flex items-center justify-between text-xs font-medium text-rose-800">
                <span>Abhi Mila Nahi (Not Available)</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-rose-900">
                {fundamentalAudit.notAvailableCount.toLocaleString()}
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-rose-700">
                {((fundamentalAudit.notAvailableCount / Math.max(fundamentalAudit.totalStocks, 1)) * 100).toFixed(1)}% · Ratios missing/uncollected
              </div>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] font-mono text-slate-600">
            <div>
              Sources Active: NSE XBRL Filings ({fundamentalAudit.withXbrlFilingsCount.toLocaleString()} stocks,{' '}
              {fundamentalAudit.recentFiling90dCount.toLocaleString()} &lt;= 90d) · Screener.in ({fundamentalAudit.sourcesBreakdown.yahooNs}) · BSE Official ({fundamentalAudit.sourcesBreakdown.bseBo}) · CSV Baseline ({fundamentalAudit.sourcesBreakdown.csvBaseline})
            </div>
            <button
              type="button"
              onClick={() => onFilterByFreshness('ALL')}
              className="text-blue-700 hover:underline font-medium"
            >
              View All Remarks in Screener →
            </button>
          </div>
        </div>
      )}

      {/* Pipeline Funnel + Fundamental Thresholds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                NSE V8 Selection Funnel (Delivery A/B + Swing Tiers)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                30-calendar-day inclusive window ending {data.latestSessionDate} · EMA21, RSI(14), ATR(14) &amp; DelivQty expansion
              </p>
            </div>
            <button
              onClick={() => onNavigate('screener')}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Open Full Screener
            </button>
          </div>

          <div className="space-y-3">
            {stages.map((s) => (
              <div
                key={s.step}
                role="button"
                tabIndex={0}
                onClick={() => openScreenerPreset(s.preset)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openScreenerPreset(s.preset);
                  }
                }}
                className="p-2 -mx-2 rounded-md hover:bg-slate-50 cursor-pointer transition-colors space-y-1 group"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-slate-400">{s.step}.</span>
                    <span className="font-medium text-slate-800 group-hover:text-blue-700 truncate">
                      {s.title}
                    </span>
                    <ArrowUpRight className="w-3 h-3 text-slate-300 group-hover:text-blue-700 shrink-0" />
                  </div>
                  <span className="font-mono font-semibold text-slate-900 shrink-0 ml-2">
                    {s.count.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${s.tone} transition-all duration-300`}
                    style={{ width: `${Math.max(1.5, s.pct)}%` }}
                  />
                </div>
                {s.chips.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] font-mono">
                    {s.chips.map((ch) => (
                      <button
                        key={ch.label}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openScreenerPreset(ch.preset);
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-200 transition-colors"
                      >
                        {ch.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 font-mono">{s.detail}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Fundamental Thresholds Reference */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-500" />
                Fundamental Rules
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Active thresholds from fundamental_thresholds.json
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditRulesOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors shadow-sm"
            >
              Edit Rules
            </button>
          </div>

          <dl className="divide-y divide-slate-100 text-xs">
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Min Revenue Growth</dt>
              <dd className="font-mono font-medium text-slate-900">&gt;= {thresholds.min_revenue_growth_pct}%</dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Min Profit Growth</dt>
              <dd className="font-mono font-medium text-slate-900">&gt;= {thresholds.min_profit_growth_pct}%</dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Min ROE</dt>
              <dd className="font-mono font-medium text-slate-900">&gt;= {thresholds.min_roe_pct}%</dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Min ROCE</dt>
              <dd className="font-mono font-medium text-slate-900">&gt;= {thresholds.min_roce_pct}%</dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Max Debt / Equity</dt>
              <dd className="font-mono font-medium text-slate-900">&lt;= {thresholds.max_debt_to_equity}</dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Min Interest Coverage</dt>
              <dd className="font-mono font-medium text-slate-900">&gt;= {thresholds.min_interest_coverage}x</dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Operating Cash Flow</dt>
              <dd className="font-mono font-medium text-slate-900">
                {thresholds.require_positive_operating_cash_flow ? 'Positive (> 0)' : 'Optional'}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between">
              <dt className="text-slate-600">Max Data Age</dt>
              <dd className="font-mono font-medium text-slate-900">{thresholds.max_data_age_days} days</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Top 3 Rotating Sectors Progress Bar */}
      {data.sectorSentiment && data.sectorSentiment.length > 0 && (() => {
        const top3Sectors = [...data.sectorSentiment]
          .sort((a, b) => b.rotationScore - a.rotationScore)
          .slice(0, 3);
        return (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 sm:p-5 text-xs text-slate-100 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Top 3 Rotating Sectors (Momentum Score Leaders)
              </h3>
              <span className="font-mono text-[11px] text-slate-400">
                Session: {data.latestSessionDate}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {top3Sectors.map((sec, idx) => (
                <div key={sec.sector} className="bg-slate-900 border border-slate-800 rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-bold text-slate-100 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                        #{idx + 1}
                      </span>
                      {sec.sector}
                    </span>
                    <span className="text-emerald-400 font-bold">{sec.rotationScore}%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, sec.rotationScore))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>Breadth: {sec.breadthPct.toFixed(0)}%</span>
                    <span>Avg Ret: {sec.avgChangePct >= 0 ? '+' : ''}{sec.avgChangePct.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* EMA 21 / 44 / 200 Sector Trend Heatmap */}
      {data.sectorSentiment && data.sectorSentiment.length > 0 && (
        <EmaTrendHeatmap
          marketSentiment={data.marketSentiment}
          sectors={data.sectorSentiment}
          latestSessionDate={data.latestSessionDate}
          onSelectSector={onFilterBySector}
          onOpenEmaFilter={openScreenerPreset}
        />
      )}

      {/* 30-Day Sector Delivery % Sparkline Rows (Rotation Shifts) */}
      {data.sectorSentiment && data.sectorSentiment.length > 0 && (
        <SectorDeliverySparklines
          sectors={data.sectorSentiment}
          latestSessionDate={data.latestSessionDate}
          onSelectSector={onFilterBySector}
        />
      )}

      {/* Sector Sentiment & Rotation Card */}
      {data.sectorSentiment && data.sectorSentiment.length > 0 && (() => {
        const sectors = data.sectorSentiment;
        const leader = sectors[0];
        const laggard = sectors[sectors.length - 1];
        return (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-blue-700" />
                  Sector Sentiment &amp; Rotation ({data.latestSessionDate})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ranks NSE sectors by 5D Momentum, EOD Breadth, EMA21 Participation &amp; Delivery Flow · Click any sector to filter Screener
                </p>
              </div>
              {leader && laggard && (
                <div className="text-xs font-mono flex flex-wrap items-center gap-3 shrink-0">
                  <span className="text-emerald-700 font-medium">
                    Leading: {leader.sector} ({leader.rotationScore})
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="text-rose-700 font-medium">
                    Lagging: {laggard.sector} ({laggard.rotationScore})
                  </span>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                    <th className="py-2.5 px-4">Sector</th>
                    <th className="py-2.5 px-3">Rotation</th>
                    <th className="py-2.5 px-3 w-44">Momentum Score</th>
                    <th className="py-2.5 px-3 text-right">5D Avg Ret</th>
                    <th className="py-2.5 px-3 text-right">EOD Chg</th>
                    <th className="py-2.5 px-3 text-right">Breadth (A/D)</th>
                    <th className="py-2.5 px-3 text-right">Above EMA21</th>
                    <th className="py-2.5 px-3 text-right">Avg Deliv (30D Trend)</th>
                    <th className="py-2.5 px-3 text-right">T1+T2 Setups</th>
                    <th className="py-2.5 px-4 text-right">Screener</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sectors.map((sec) => {
                    const barTone =
                      sec.regime === 'LEADING'
                        ? 'bg-emerald-600'
                        : sec.regime === 'IMPROVING'
                          ? 'bg-blue-600'
                          : sec.regime === 'NEUTRAL'
                            ? 'bg-amber-500'
                            : 'bg-rose-500';
                    const regimeTone =
                      sec.regime === 'LEADING'
                        ? 'text-emerald-700 font-semibold'
                        : sec.regime === 'IMPROVING'
                          ? 'text-blue-700 font-medium'
                          : sec.regime === 'NEUTRAL'
                            ? 'text-amber-700'
                            : 'text-rose-700';

                    return (
                      <tr
                        key={sec.sector}
                        onClick={() => onFilterBySector(sec.sector)}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{sec.sector}</span>
                            {sec.sector === 'IPO / Recent Listings' && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                                IPO
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {sec.stockCount} stocks · {sec.liquidCount} liquid
                          </div>
                        </td>
                        <td className={`py-2.5 px-3 font-mono ${regimeTone}`}>
                          {sec.regime}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-100 rounded-sm overflow-hidden">
                              <div
                                className={`h-full ${barTone} transition-all duration-300`}
                                style={{ width: `${sec.rotationScore}%` }}
                              />
                            </div>
                            <span className="font-mono font-semibold text-slate-800 w-7 text-right">
                              {sec.rotationScore}
                            </span>
                          </div>
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-medium ${
                            (sec.avg5dReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {sec.avg5dReturnPct !== null
                            ? `${sec.avg5dReturnPct >= 0 ? '+' : ''}${sec.avg5dReturnPct.toFixed(2)}%`
                            : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono ${
                            sec.avgChangePct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {sec.avgChangePct >= 0 ? '+' : ''}
                          {sec.avgChangePct.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {sec.breadthPct.toFixed(0)}%{' '}
                          <span className="text-slate-400">
                            ({sec.advancers}↑/{sec.decliners}↓)
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {sec.aboveEma21Pct.toFixed(0)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          <div className="inline-flex items-center justify-end gap-2">
                            {sec.deliveryTrend30d && sec.deliveryTrend30d.length >= 3 && (() => {
                              const pts = sec.deliveryTrend30d;
                              const vals = pts.map((p) => p.avgDeliveryPct);
                              const minV = Math.min(...vals);
                              const maxV = Math.max(...vals);
                              const rng = Math.max(maxV - minV, 2);
                              const poly = pts
                                .map((p, i) => {
                                  const x = (i / Math.max(pts.length - 1, 1)) * 52;
                                  const y = 14 - ((p.avgDeliveryPct - minV) / rng) * 12;
                                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                                })
                                .join(' ');
                              const shift = sec.deliveryShiftPp ?? 0;
                              const stroke =
                                shift >= 0.8
                                  ? '#059669'
                                  : shift <= -0.8
                                    ? '#E11D48'
                                    : '#2563EB';
                              return (
                                <svg
                                  viewBox="0 0 52 16"
                                  className="w-[52px] h-4 shrink-0"
                                  aria-hidden="true"
                                >
                                  <polyline
                                    fill="none"
                                    stroke={stroke}
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={poly}
                                  />
                                </svg>
                              );
                            })()}
                            <span>{sec.avgDeliveryPct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          <span className="font-semibold text-blue-700">
                            {sec.tier1Count + sec.tier2Count}
                          </span>
                          <span className="text-slate-400 ml-1">
                            ({sec.tier1Count} T1)
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                            Filter
                            <ArrowUpRight className="w-3 h-3" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Top Swing Candidates */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Top Tiered Swing &amp; Delivery Accumulation Candidates
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Scanner rules stay on EOD Bhavcopy ({data.latestSessionDate}) · Live Price compares current market move vs Scanner EOD
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setT1T2ReportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-colors whitespace-nowrap"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              T1 &amp; T2 Daily Memory
            </button>
            <a
              href="/api/reports/t1-t2/csv?live=1"
              download={`T1_T2_Daily_Report_${data.latestSessionDate || 'latest'}.csv`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download T1+T2 CSV
            </a>
            <button
              type="button"
              onClick={() => void fetchTopMoversLive(true)}
              disabled={liveLoading || data.topDeliveryMovers.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${liveLoading ? 'animate-spin' : ''}`} />
              {liveLoading ? 'Checking Live...' : 'Refresh Live Price'}
            </button>
            <button
              onClick={() => onNavigate('screener')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              Open Screener
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {data.topDeliveryMovers.length > 0 && (
          <div className="px-5 py-2 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2 text-slate-700">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                <Activity className="w-3.5 h-3.5 text-blue-700" />
                {topMoversLiveSummary.staleCount > 0 && topMoversLiveSummary.liveCount === 0
                  ? `Kal EOD (${data.latestSessionDate}) → Reference Quote:`
                  : `Kal EOD (${data.latestSessionDate}) → Aaj Live:`}
                {topMoversLiveSummary.staleCount > 0 && topMoversLiveSummary.liveCount === 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-600 text-white">
                    STALE DATA
                  </span>
                )}
              </span>
              {liveLoading && topMoversLiveSummary.availableCount === 0 ? (
                <span className="font-mono text-blue-700">Checking Yahoo live prices...</span>
              ) : liveError ? (
                <span className="font-mono text-rose-700">{liveError}</span>
              ) : (
                <>
                  <span className="font-mono font-semibold text-emerald-700">
                    {topMoversLiveSummary.upCount} Up (Right)
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono font-semibold text-rose-700">
                    {topMoversLiveSummary.downCount} Down (Wrong)
                  </span>
                  {topMoversLiveSummary.rightPct !== null && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {topMoversLiveSummary.rightPct.toFixed(0)}% Holding Above EOD
                      </span>
                    </>
                  )}
                  {topMoversLiveSummary.avgMovePct !== null && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`font-mono font-semibold ${
                          topMoversLiveSummary.avgMovePct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        Avg {topMoversLiveSummary.avgMovePct >= 0 ? '+' : ''}
                        {topMoversLiveSummary.avgMovePct.toFixed(2)}% vs EOD
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="font-mono text-slate-500">
              Yahoo Live Check{liveCheckedAt ? ` @ ${liveCheckedAt}` : ''}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-4">Symbol</th>
                <th className="py-2.5 px-3">Swing Tier</th>
                <th className="py-2.5 px-3 text-right">Scanner EOD (₹)</th>
                <th className="py-2.5 px-3 text-right">EOD Chg %</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Live Price &amp; Vs EOD</th>
                <th className="py-2.5 px-3 text-right">RVOL</th>
                <th className="py-2.5 px-3 text-right">DelivQty Ratio</th>
                <th className="py-2.5 px-3 text-right">RSI(14)</th>
                <th className="py-2.5 px-3 text-right">ATR %</th>
                <th className="py-2.5 px-3 text-right">20D Avg Turn</th>
                <th className="py-2.5 px-4">Fundamentals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.topDeliveryMovers.map((row) => (
                <tr
                  key={row.symbol}
                  onClick={() => onSelectSymbol(row.symbol)}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono font-semibold text-blue-700">{row.symbol}</span>
                      {getCapShortLabel(row.marketCapCategory) && (
                        <span
                          title={row.marketCapCr ? `MCap ₹${row.marketCapCr.toLocaleString('en-IN')} Cr` : undefined}
                          className={`px-1 py-0.2 text-[9px] font-mono font-semibold border rounded ${getCapBadgeClass(
                            row.marketCapCategory
                          )}`}
                        >
                          {getCapShortLabel(row.marketCapCategory)}
                        </span>
                      )}
                      {row.ema21Cross44Bullish && (
                        <span className="px-1 py-0.2 text-[9px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                          21×44
                        </span>
                      )}
                    </div>
                    {row.providerSector && (
                      <div className="text-[11px] text-slate-500 truncate max-w-[150px]">
                        {row.providerSector}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono">
                    <span
                      className={
                        row.swingTier === 'TIER_1_READY'
                          ? 'text-emerald-700 font-semibold'
                          : row.swingTier === 'TIER_2_ACCUMULATION'
                            ? 'text-blue-700 font-medium'
                            : row.swingTier === 'TIER_3_RVOL_WATCH'
                              ? 'text-amber-700'
                              : 'text-slate-400'
                      }
                    >
                      {row.swingTier}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-900">
                    {row.closePrice.toFixed(2)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-medium ${
                      (row.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {row.changePct !== null
                      ? `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`
                      : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                    {(() => {
                      const lq = liveQuotes[row.symbol];
                      if (!lq && liveLoading) {
                        return <span className="text-[11px] text-slate-400">Checking...</span>;
                      }
                      if (!lq) return <span className="text-slate-400">—</span>;
                      if (!lq.available || lq.livePrice === null) {
                        return (
                          <span className="text-[10px] font-medium text-amber-700" title={lq.note}>
                            DATA NOT AVAILABLE
                          </span>
                        );
                      }
                      const diffInr = lq.livePrice - row.closePrice;
                      const diffPct = row.closePrice > 0 ? (diffInr / row.closePrice) * 100 : null;
                      const isUp = diffInr >= 0;
                      const freshness = evaluateQuoteFreshness({
                        lastUpdated: lq.lastUpdated,
                        marketTimeUnixSec: lq.marketTimestampSec,
                        marketTimeIst: lq.marketTimeIst,
                        marketDateIst: lq.marketDateIst,
                        marketState: lq.marketState,
                      });
                      return (
                        <div
                          title={`${freshness.isStale ? 'Stale Quote' : freshness.isMarketClosed ? 'Closed Market Quote' : 'Live'} ₹${lq.livePrice.toFixed(2)} vs Scanner EOD ₹${row.closePrice.toFixed(2)}${
                            lq.marketTimeIst ? ` · ${lq.marketTimeIst}` : ''
                          }`}
                        >
                          <div className="font-semibold text-slate-900 inline-flex items-center gap-1">
                            {freshness.isLive && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                                title="Live current session quote"
                              />
                            )}
                            <span>₹{lq.livePrice.toFixed(2)}</span>
                            {freshness.badgeLabel && (
                              <span
                                className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase text-white ${
                                  freshness.isStale ? 'bg-rose-600' : 'bg-slate-600'
                                }`}
                              >
                                {freshness.badgeLabel}
                              </span>
                            )}
                          </div>
                          <div
                            className={`text-[10px] font-semibold ${
                              freshness.isStale
                                ? 'text-slate-500'
                                : isUp
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {diffInr >= 0 ? '+' : ''}
                            {diffInr.toFixed(2)}{' '}
                            {diffPct !== null
                              ? `(${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)}%)`
                              : ''}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-semibold ${
                      row.rvolBand === 'HIGH' ? 'text-blue-700' : 'text-slate-600'
                    }`}
                  >
                    {row.rvol !== null ? `${row.rvol.toFixed(2)}x` : 'WAIT'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                    {row.delivQtyRatio !== null ? `${row.delivQtyRatio.toFixed(2)}x` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                    {row.rsi14 !== null ? row.rsi14.toFixed(1) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                    {row.atrPct !== null ? `${row.atrPct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                    {row.avgTurnover20DCr !== null ? `₹${row.avgTurnover20DCr.toFixed(2)} Cr` : '—'}
                  </td>
                  <td className="py-2.5 px-4 font-mono">
                    <span
                      className={
                        row.fundamentalCoverage === 'COMPLETE'
                          ? 'text-emerald-700 font-medium'
                          : row.fundamentalCoverage === 'PARTIAL_DATA'
                            ? 'text-amber-700'
                            : 'text-slate-400'
                      }
                    >
                      {row.fundamentalCoverage}
                    </span>
                    {row.fundamentalCoverage !== 'MISSING' && (
                      <span className="text-slate-400 ml-1">
                        ({row.fundamentalPassCount}/7)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Signal History Snapshot */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Latest EOD Signal Log Snapshot
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest Signal EOD: <span className="font-mono font-semibold text-slate-700">{data.latestSessionDate}</span> · Forward returns evaluated on subsequent Bhavcopy sessions (NSE publishes today&apos;s EOD Bhavcopy after ~18:00 IST)
            </p>
          </div>
          <button
            onClick={() => onNavigate('signals')}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            Explore all {funnel.signalLogTotalRows.toLocaleString()}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-4">EOD Date</th>
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Watch</th>
                <th className="py-2.5 px-3">Setup</th>
                <th className="py-2.5 px-3 text-right">V8 Score</th>
                <th className="py-2.5 px-3 text-right">RVOL</th>
                <th className="py-2.5 px-3 text-right">EOD Close</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Live Price &amp; Vs EOD</th>
                <th className="py-2.5 px-3 text-right">Fwd Return</th>
                <th className="py-2.5 px-4">Notes / Skip Reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentSignals.map((sig, i) => {
                const lq = liveQuotes[sig.symbol];
                const hasLive = Boolean(lq?.available && lq.livePrice !== null && sig.closePrice && sig.closePrice > 0);
                const liveDiffPct =
                  hasLive && sig.closePrice
                    ? (((lq!.livePrice as number) - sig.closePrice) / sig.closePrice) * 100
                    : null;
                return (
                  <tr
                    key={`${sig.eodDate}-${sig.symbol}-${i}`}
                    onClick={() => onSelectSymbol(sig.symbol)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {sig.eodDate}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-blue-700">
                      <div>{sig.symbol}</div>
                      <div className="text-[10px] font-normal text-slate-400">
                        {sig.deliveryCategory} · {sig.liquidityTier}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                          sig.watchlistStatus === 'WATCH'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {sig.watchlistStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-800">{sig.setupType}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                      {sig.v8Score ?? '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {sig.rvol !== null ? `${sig.rvol.toFixed(2)}x` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                      {sig.closePrice !== null ? `₹${sig.closePrice.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                      {hasLive ? (() => {
                        const freshness = evaluateQuoteFreshness({
                          lastUpdated: lq!.lastUpdated,
                          marketTimeUnixSec: lq!.marketTimestampSec,
                          marketTimeIst: lq!.marketTimeIst,
                          marketDateIst: lq!.marketDateIst,
                          marketState: lq!.marketState,
                        });
                        return (
                        <div>
                          <div className="font-semibold text-slate-900 inline-flex items-center gap-1">
                            {freshness.isLive && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                                title="Live current session quote"
                              />
                            )}
                            <span>₹{(lq!.livePrice as number).toFixed(2)}</span>
                            {freshness.badgeLabel && (
                              <span
                                className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase text-white ${
                                  freshness.isStale ? 'bg-rose-600' : 'bg-slate-600'
                                }`}
                              >
                                {freshness.badgeLabel}
                              </span>
                            )}
                          </div>
                          {liveDiffPct !== null && (
                            <div
                              className={`text-[10px] font-semibold ${
                                freshness.isStale
                                  ? 'text-slate-500'
                                  : liveDiffPct >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                              }`}
                            >
                              {liveDiffPct >= 0 ? '+' : ''}
                              {liveDiffPct.toFixed(2)}%
                            </div>
                          )}
                        </div>
                        );
                      })() : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-medium whitespace-nowrap ${
                        sig.evalReturnPct === null
                          ? 'text-slate-400'
                          : sig.evalReturnPct >= 0
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                      }`}
                    >
                      {sig.evalReturnPct !== null
                        ? `${sig.evalReturnPct >= 0 ? '+' : ''}${sig.evalReturnPct.toFixed(2)}% (${sig.evalSessionsAfter}d)`
                        : '0 sess (Latest EOD)'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500">
                      {sig.skipReasons.length > 0 ? sig.skipReasons.join(' · ') : 'All Gates Passed'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dedicated Upcoming Result Date Stocks Observation List */}
      <div className="bg-white border border-indigo-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-indigo-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Upcoming Result Date Stocks — Observation Watch
              </h2>
              {upcomingData && (
                <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 rounded">
                  {upcomingData.totalUpcoming} Scheduled
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Earliest upcoming quarterly result dates first (as of {upcomingData?.asOfDate || data.latestSessionDate}) · Track Delivery A/B, Swing Tier &amp; 3M Result Polarity ahead of results
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!upcomingData?.items?.length) return;
                void fetchBatchLiveQuotes(
                  upcomingData.items.slice(0, 50).map((i) => i.symbol),
                  true
                );
              }}
              disabled={liveLoading || !upcomingData?.items?.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${liveLoading ? 'animate-spin' : ''}`} />
              {liveLoading ? 'Checking Live...' : 'Refresh Live Price'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!upcomingData?.items?.length) return;
                const headers = [
                  'Symbol',
                  'CompanyName',
                  'Sector',
                  'NextResultDate',
                  'DaysLeft',
                  'ResultWindow',
                  'ResultPolarity3M',
                  'RejectionGate',
                  'ProfitGrowthPct',
                  'RevenueGrowthPct',
                  'EpsPrev',
                  'EpsCurr',
                  'SwingTier',
                  'DeliveryCategory',
                  'DeliveryPct',
                  'RVOL',
                  'ScannerEODClose',
                  'LivePrice',
                  'LiveVsEODPct',
                ];
                const lines = [
                  headers.join(','),
                  ...upcomingData.items.map((it) => {
                    const lq = liveQuotes[it.symbol];
                    const lp = lq?.available && lq.livePrice !== null ? lq.livePrice : null;
                    const diff = lp !== null && it.closePrice > 0 ? ((lp - it.closePrice) / it.closePrice) * 100 : null;
                    return [
                      it.symbol,
                      `"${(it.companyName || '').replace(/"/g, '""')}"`,
                      `"${(it.sector || '').replace(/"/g, '""')}"`,
                      it.nextResultDate,
                      it.daysToResult,
                      it.resultPriority,
                      it.resultPolarity3M,
                      it.rejectionGate,
                      it.profitGrowthPct !== null ? it.profitGrowthPct.toFixed(2) : '',
                      it.revenueGrowthPct !== null ? it.revenueGrowthPct.toFixed(2) : '',
                      it.epsPrev !== null ? it.epsPrev.toFixed(2) : '',
                      it.epsCurr !== null ? it.epsCurr.toFixed(2) : '',
                      it.swingTier,
                      it.deliveryCategory,
                      it.delivPer !== null ? it.delivPer.toFixed(2) : '',
                      it.rvol !== null ? it.rvol.toFixed(2) : '',
                      it.closePrice.toFixed(2),
                      lp !== null ? lp.toFixed(2) : '',
                      diff !== null ? diff.toFixed(2) : '',
                    ].join(',');
                  }),
                ];
                const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `upcoming_result_stocks_${upcomingData.asOfDate || 'latest'}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={!upcomingData?.items?.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => onNavigate('catalysts')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 whitespace-nowrap"
            >
              3M Catalyst Gate
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Summary & Filter Controls */}
        <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { key: 'ALL', label: `All Upcoming (${upcomingData?.totalUpcoming ?? 0})` },
                { key: 'WITHIN_1M', label: `<=30d (${upcomingData?.counts.within1m ?? 0})` },
                { key: 'WITHIN_2M', label: `<=60d (${(upcomingData?.counts.within1m ?? 0) + (upcomingData?.counts.within2m ?? 0)})` },
                { key: 'WITHIN_3M', label: `<=90d (${(upcomingData?.counts.within1m ?? 0) + (upcomingData?.counts.within2m ?? 0) + (upcomingData?.counts.within3m ?? 0)})` },
                { key: 'BEYOND_3M', label: `>90d (${upcomingData?.counts.beyond3m ?? 0})` },
              ] as const
            ).map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => setUpcomingWindow(btn.key)}
                className={`px-2.5 py-1 text-xs rounded border font-mono transition-colors ${
                  upcomingWindow === btn.key
                    ? 'bg-indigo-700 text-white border-indigo-700 font-semibold'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {btn.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setUpcomingSwingOnly((prev) => !prev)}
              className={`px-2.5 py-1 text-xs rounded border font-medium transition-colors ${
                upcomingSwingOnly
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Swing / Deliv A/B Only ({upcomingData?.counts.swingOrDelivAb ?? 0})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={upcomingPolarity}
              onChange={(e) =>
                setUpcomingPolarity(e.target.value as 'ALL' | 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN')
              }
              className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-600"
            >
              <option value="ALL">All 3M Result Polarity</option>
              <option value="POSITIVE">Positive 3M ({upcomingData?.counts.positive3m ?? 0})</option>
              <option value="NEGATIVE">Negative 3M ({upcomingData?.counts.negative3m ?? 0})</option>
              <option value="UNKNOWN">Pending Verify ({upcomingData?.counts.unknown3m ?? 0})</option>
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={upcomingQ}
                onChange={(e) => setUpcomingQ(e.target.value)}
                placeholder="Search upcoming symbol..."
                className="pl-8 pr-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-600 w-44"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="py-2.5 px-4">Result Date</th>
                <th className="py-2.5 px-3">Symbol &amp; Sector</th>
                <th className="py-2.5 px-3">3M Result Polarity</th>
                <th className="py-2.5 px-3">Swing / Deliv</th>
                <th className="py-2.5 px-3 text-right">RVOL / Deliv%</th>
                <th className="py-2.5 px-3 text-right">Scanner EOD (₹)</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Live Price &amp; Vs EOD</th>
                <th className="py-2.5 px-4 text-right">30D Bulk/Block</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {upcomingLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td colSpan={8} className="py-3 px-4">
                      <div className="h-3.5 bg-slate-100 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : !upcomingData || upcomingData.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No upcoming result stocks match the selected filter ({upcomingWindow}). Note: NSE Q3 results typically start in early Jan; try &ldquo;All Upcoming&rdquo;.
                  </td>
                </tr>
              ) : (
                upcomingData.items.map((item) => {
                  const lq = liveQuotes[item.symbol];
                  const hasLive = Boolean(lq?.available && lq.livePrice !== null && item.closePrice > 0);
                  const liveDiffPct =
                    hasLive && item.closePrice > 0
                      ? (((lq!.livePrice as number) - item.closePrice) / item.closePrice) * 100
                      : null;

                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => onSelectSymbol(item.symbol)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap font-mono">
                        <div className="font-semibold text-indigo-800">{item.nextResultDate}</div>
                        <div className="text-[10px] text-slate-500">
                          in {item.daysToResult}d {item.isResultEstimate ? '· Est' : '· BSE'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-semibold text-blue-700">{item.symbol}</span>
                          {getCapShortLabel(item.marketCapCategory) && (
                            <span
                              title={item.marketCapCr ? `MCap ₹${item.marketCapCr.toLocaleString('en-IN')} Cr` : undefined}
                              className={`px-1 py-0.2 text-[9px] font-mono font-semibold border rounded ${getCapBadgeClass(
                                item.marketCapCategory
                              )}`}
                            >
                              {getCapShortLabel(item.marketCapCategory)}
                            </span>
                          )}
                          {item.isIpo && (
                            <span className="px-1 py-0.2 text-[9px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                              IPO
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                          {item.companyName || item.sector || '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                            item.resultPolarity3M === 'POSITIVE'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : item.resultPolarity3M === 'NEGATIVE'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {item.resultPolarity3M}
                        </span>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[200px]" title={item.result3MReason}>
                          {item.result3MReason}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <div
                          className={
                            item.swingTier === 'TIER_1_READY'
                              ? 'text-emerald-700 font-semibold'
                              : item.swingTier === 'TIER_2_ACCUMULATION'
                                ? 'text-blue-700 font-medium'
                                : item.swingTier === 'TIER_3_RVOL_WATCH'
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                          }
                        >
                          {item.swingTier}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Deliv: {item.deliveryCategory}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <div className={item.rvol !== null && item.rvol > 1.5 ? 'text-blue-700 font-semibold' : 'text-slate-700'}>
                          {item.rvol !== null ? `${item.rvol.toFixed(2)}x` : '—'}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {item.delivPer !== null ? `${item.delivPer.toFixed(1)}%` : '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <div className="text-slate-900">₹{item.closePrice.toFixed(2)}</div>
                        {item.changePct !== null && (
                          <div className={`text-[10px] ${item.changePct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {item.changePct >= 0 ? '+' : ''}
                            {item.changePct.toFixed(2)}%
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                        {hasLive ? (() => {
                          const freshness = evaluateQuoteFreshness({
                            lastUpdated: lq!.lastUpdated,
                            marketTimeUnixSec: lq!.marketTimestampSec,
                            marketTimeIst: lq!.marketTimeIst,
                            marketDateIst: lq!.marketDateIst,
                            marketState: lq!.marketState,
                          });
                          return (
                          <div>
                            <div className="font-semibold text-slate-900 inline-flex items-center gap-1">
                              {freshness.isLive && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                                  title="Live current session quote"
                                />
                              )}
                              <span>₹{(lq!.livePrice as number).toFixed(2)}</span>
                              {freshness.badgeLabel && (
                                <span
                                  className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase text-white ${
                                    freshness.isStale ? 'bg-rose-600' : 'bg-slate-600'
                                  }`}
                                >
                                  {freshness.badgeLabel}
                                </span>
                              )}
                            </div>
                            {liveDiffPct !== null && (
                              <div
                                className={`text-[10px] font-semibold ${
                                  freshness.isStale
                                    ? 'text-slate-500'
                                    : liveDiffPct >= 0
                                      ? 'text-emerald-700'
                                      : 'text-rose-700'
                                }`}
                              >
                                {liveDiffPct >= 0 ? '+' : ''}
                                {liveDiffPct.toFixed(2)}%
                              </div>
                            )}
                          </div>
                          );
                        })() : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {item.bulkBlockDealsCount > 0 ? (
                          <div>
                            <span
                              className={`font-semibold ${
                                item.bulkBlockNetCr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {item.bulkBlockNetCr >= 0 ? '+' : ''}₹{item.bulkBlockNetCr.toFixed(1)}Cr
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {item.bulkBlockDealsCount} deal{item.bulkBlockDealsCount > 1 ? 's' : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <T1T2DailyReportModal
        open={t1T2ReportOpen}
        onClose={() => setT1T2ReportOpen(false)}
        onSelectSymbol={onSelectSymbol}
      />

      {editRulesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg space-y-4 text-slate-100 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="font-bold text-base text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                <span>Edit Fundamental Filter Rules</span>
              </div>
              <button
                type="button"
                onClick={() => setEditRulesOpen(false)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRules} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Min Revenue Growth (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={ruleRevGrowth}
                  onChange={(e) => setRuleRevGrowth(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Min Profit Growth (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={ruleProfGrowth}
                  onChange={(e) => setRuleProfGrowth(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Min ROE (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={ruleRoe}
                  onChange={(e) => setRuleRoe(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Min ROCE (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={ruleRoce}
                  onChange={(e) => setRuleRoce(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Max Debt / Equity</label>
                <input
                  type="number"
                  step="0.1"
                  value={ruleDebtEquity}
                  onChange={(e) => setRuleDebtEquity(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Min Interest Coverage (x)</label>
                <input
                  type="number"
                  step="0.5"
                  value={ruleIntCov}
                  onChange={(e) => setRuleIntCov(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Max Data Age (Days)</label>
                <input
                  type="number"
                  min={90}
                  step={1}
                  value={ruleMaxDataAgeDays}
                  onChange={(e) => setRuleMaxDataAgeDays(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="ocfPositive"
                  checked={ruleOcfPos}
                  onChange={(e) => setRuleOcfPos(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <label htmlFor="ocfPositive" className="text-slate-300 font-medium cursor-pointer">
                  Require Positive Operating Cash Flow (&gt; 0)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditRulesOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ruleSaving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs transition-colors disabled:opacity-50"
                >
                  {ruleSaving ? 'Saving...' : 'Save & Recompute Rules'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
