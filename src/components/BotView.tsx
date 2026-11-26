import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart2,
  Bell,
  Calculator,
  ChevronDown,
  ChevronUp,
  Newspaper,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  BotBacktestReport,
  BotStockAnalysis,
  MacroNewsDashboardResponse,
  MacroNewsItem,
} from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { RecommendedPicksPanel } from './RecommendedPicksPanel';
import { PaperTradingPanel } from './PaperTradingPanel';

type ScanScope = 'LIQUID_TIERS' | 'TOP_SECTORS' | 'DELIV_HIGH' | 'WATCHLIST' | 'IPO';

interface BotViewProps {
  onSelectSymbol: (symbol: string) => void;
  externalReloadSeq?: number;
  externalScopePreset?: { seq: number; scope: ScanScope } | null;
}

export const BotView: React.FC<BotViewProps> = ({
  onSelectSymbol,
  externalReloadSeq = 0,
  externalScopePreset = null,
}) => {
  const [macroData, setMacroData] = useState<MacroNewsDashboardResponse | null>(null);
  const [scanItems, setScanItems] = useState<BotStockAnalysis[]>([]);
  const [scannedCandidates, setScannedCandidates] = useState(0);
  const [scanLoading, setScanLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);

  const [scope, setScope] = useState<ScanScope>('LIQUID_TIERS');
  const [searchQ, setSearchQ] = useState('');
  const [limit, setLimit] = useState<number>(8);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [newsOpen, setNewsOpen] = useState(true);
  const [paperSeq, setPaperSeq] = useState(0);

  // Macro RSS News filter state
  const [newsQ, setNewsQ] = useState('');
  const [newsSentiment, setNewsSentiment] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL');
  const [newsCategory, setNewsCategory] = useState<'ALL' | MacroNewsItem['category']>('ALL');
  const [newsHorizon, setNewsHorizon] = useState<'ALL' | 'STRUCTURAL' | 'TEMPORARY'>('ALL');
  const [newsSector, setNewsSector] = useState<string>('ALL');

  // Section 13 Backtest state
  const [btSymbol, setBtSymbol] = useState('BEL');
  const [btHoldDays, setBtHoldDays] = useState(25);
  const [btStopPct, setBtStopPct] = useState(10);
  const [btTargetPct, setBtTargetPct] = useState(20);
  const [btReport, setBtReport] = useState<BotBacktestReport | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);

  const [riskModalItem, setRiskModalItem] = useState<BotStockAnalysis | null>(null);
  const [riskCapital, setRiskCapital] = useState<number>(100000);
  const [riskPercentage, setRiskPercentage] = useState<number>(1.0);

  const runScan = useCallback(
    async (opts?: { forceRefresh?: boolean; customQ?: string }) => {
      setScanLoading(true);
      setScanError(null);
      try {
        const params = new URLSearchParams({
          scope,
          limit: String(limit),
        });
        const qVal = (opts?.customQ !== undefined ? opts.customQ : searchQ).trim();
        if (qVal) params.set('q', qVal);
        if (opts?.forceRefresh) params.set('refresh', '1');

        const res = await fetch(`/api/bot/daily-scan?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setMacroData(json.dashboard);
        setScanItems(json.items || []);
        setScannedCandidates(json.scannedCandidates || 0);
        if ((json.items || []).length > 0 && !opts?.customQ && btSymbol === 'BEL') {
          const first = json.items[0].symbol;
          if (first) setBtSymbol(first);
        }
      } catch (err) {
        setScanError((err as Error).message || 'Failed to run daily open-source bot scan');
      } finally {
        setScanLoading(false);
      }
    },
    [scope, limit, searchQ, btSymbol]
  );

  const runBacktest = useCallback(
    async (symOverride?: string) => {
      const sym = (symOverride || btSymbol).trim().toUpperCase();
      if (!sym) return;
      if (symOverride) setBtSymbol(sym);
      setBtLoading(true);
      setBtError(null);
      try {
        const params = new URLSearchParams({
          holdDays: String(btHoldDays),
          stopPct: String(btStopPct),
          targetPct: String(btTargetPct),
        });
        const res = await fetch(`/api/bot/stock/${encodeURIComponent(sym)}/backtest?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setBtReport(json);
      } catch (err) {
        setBtError((err as Error).message || 'Backtest failed');
      } finally {
        setBtLoading(false);
      }
    },
    [btSymbol, btHoldDays, btStopPct, btTargetPct]
  );

  useEffect(() => {
    if (externalScopePreset) {
      setScope(externalScopePreset.scope);
      setSearchQ('');
    }
  }, [externalScopePreset?.seq]);

  useEffect(() => {
    void runScan();
  }, [scope, limit, externalReloadSeq]);

  useEffect(() => {
    void runBacktest('BEL');
  }, []);

  const newsCategories = useMemo(() => {
    if (!macroData) return [];
    return Array.from(new Set(macroData.newsItems.map((n) => n.category)));
  }, [macroData]);

  const newsSectors = useMemo(() => {
    if (!macroData) return [];
    const set = new Set<string>();
    for (const n of macroData.newsItems) {
      for (const s of n.positiveSectors) set.add(s);
      for (const s of n.negativeSectors) set.add(s);
    }
    return Array.from(set).sort();
  }, [macroData]);

  const filteredMacroNews = useMemo(() => {
    if (!macroData) return [];
    const q = newsQ.trim().toLowerCase();
    return macroData.newsItems.filter((n) => {
      if (newsSentiment !== 'ALL' && n.sentiment !== newsSentiment) return false;
      if (newsCategory !== 'ALL' && n.category !== newsCategory) return false;
      if (newsHorizon !== 'ALL' && n.horizon !== newsHorizon) return false;
      if (
        newsSector !== 'ALL' &&
        !n.positiveSectors.includes(newsSector) &&
        !n.negativeSectors.includes(newsSector)
      ) {
        return false;
      }
      if (q) {
        const hay = `${n.title} ${n.source} ${n.category} ${n.matchedRule} ${n.positiveSectors.join(' ')} ${n.negativeSectors.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [macroData, newsQ, newsSentiment, newsCategory, newsHorizon, newsSector]);

  const regime = macroData?.regime;
  const verdictTone = (v?: string) => {
    if (v === 'PROCEED' || v === 'STRONG BUY')
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (v === 'CAUTION_50_PCT' || v === 'BUY (75% SIZE)' || v === 'BUY (50% SIZE)')
      return 'bg-amber-50 text-amber-800 border-amber-200';
    if (v === 'HARD_STOP' || v === 'HARD REJECT')
      return 'bg-rose-50 text-rose-800 border-rose-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-slate-900">
              v3 Swing Trading Bot (100% Open-Source · Paper Trading Mode)
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded">
              PAPER MODE DEFAULT
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Zero API Keys · Zero Subscriptions · Screener.in + BSE Official + NSE XBRL (Fundamentals &amp; Shareholding), Yahoo Finance (VIX, DXY, Brent &amp; 3Y OHLCV), NSE Bhavcopy/Bulk Deals &amp; Free Moneycontrol/ET/BS RSS. Missing metrics strictly report{' '}
            <span className="font-mono font-semibold text-amber-700">DATA NOT AVAILABLE</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runScan({ forceRefresh: true })}
          disabled={scanLoading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanLoading ? 'animate-spin' : ''}`} />
          {scanLoading ? 'Scanning Open Feeds...' : 'Refresh Live Macro & Bot Scan'}
        </button>
      </div>

      {/* All-Filter Recommended Confluence Picks + Live Price + Open-Source AI Brief */}
      <RecommendedPicksPanel
        onSelectSymbol={onSelectSymbol}
        onPaperBought={() => setPaperSeq((n) => n + 1)}
      />

      {/* Phase 1: Market Regime & Macro Hard Stop Dashboard */}
      {regime && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
            <div className="flex items-center gap-2">
              {regime.regimeVerdict === 'PROCEED' ? (
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-700" />
              )}
              <h2 className="text-sm font-semibold text-slate-900">
                Phase 1 · Market Regime Hard Stop &amp; Macro Pulse
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2.5 py-1 border rounded font-mono text-xs font-bold ${verdictTone(regime.regimeVerdict)}`}>
                {regime.regimeVerdict} · Size Multiplier {(regime.positionSizeMultiplier * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="border border-slate-200 rounded-md p-3">
                <div className="text-[11px] text-slate-500">India VIX (&gt;20 STOP)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900">
                  {regime.indiaVix.available ? regime.indiaVix.value : 'DATA NOT AVAILABLE'}
                </div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {regime.indiaVix.statusLabel}
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3">
                <div className="text-[11px] text-slate-500">US Dollar Index (DXY)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900">
                  {regime.dxy.available ? regime.dxy.value : 'DATA NOT AVAILABLE'}
                </div>
                <div
                  className={`font-mono text-[11px] mt-0.5 ${
                    regime.dxy.bias === 'STRONG_RISK' ? 'text-rose-700 font-semibold' : 'text-slate-600'
                  }`}
                >
                  {regime.dxy.bias}{' '}
                  {regime.dxy.change1mPct !== null
                    ? `(${regime.dxy.change1mPct >= 0 ? '+' : ''}${regime.dxy.change1mPct}% 1M)`
                    : ''}
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3">
                <div className="text-[11px] text-slate-500">Brent Crude (&gt;$105 STOP)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900">
                  {regime.brentCrude.available ? `$${regime.brentCrude.value}` : 'DATA NOT AVAILABLE'}
                </div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {regime.brentCrude.bias}
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3">
                <div className="text-[11px] text-slate-500">Nifty 50 (1M / EMA20)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900">
                  {regime.nifty50.available
                    ? regime.nifty50.value?.toLocaleString('en-IN')
                    : 'DATA NOT AVAILABLE'}
                </div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {regime.nifty50.statusLabel}
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3">
                <div className="text-[11px] text-slate-500">USD / INR</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900">
                  {regime.usdInr.available ? `₹${regime.usdInr.value}` : 'DATA NOT AVAILABLE'}
                </div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {regime.usdInr.detail}
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3">
                <div className="text-[11px] text-slate-500">MMI (NSE Proxy)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900">
                  {regime.mmiProxy.available ? `${regime.mmiProxy.value}/100` : 'DATA NOT AVAILABLE'}
                </div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {regime.mmiProxy.zone}
                </div>
              </div>
            </div>

            {/* Open-Source Institutional & Breadth Indicators Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <span className="font-semibold text-slate-700">200-DMA Universe Breadth:</span>{' '}
                {regime.breadth200Dma.available && regime.breadth200Dma.value !== null ? (
                  <>
                    <span className="font-mono text-slate-900 font-semibold">
                      {regime.breadth200Dma.value.toFixed(1)}%
                    </span>{' '}
                    <span className="text-slate-600">
                      ({regime.breadth200Dma.detail}
                      {regime.breadth200Dma.ema21BreadthPct !== null
                        ? ` · Live EMA21: ${regime.breadth200Dma.ema21BreadthPct.toFixed(1)}%`
                        : ''}
                      )
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-amber-700 font-semibold">DATA NOT AVAILABLE</span>{' '}
                    <span className="text-slate-600">
                      ({regime.breadth200Dma.detail || '37D cache'}; live Liquid EMA21 breadth ={' '}
                      {regime.breadth200Dma.ema21BreadthPct !== null
                        ? `${regime.breadth200Dma.ema21BreadthPct.toFixed(1)}%`
                        : '—'}
                      )
                    </span>
                  </>
                )}
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <span className="font-semibold text-slate-700">FII/DII Daily Aggregate:</span>{' '}
                <span
                  className={`font-mono font-semibold ${
                    regime.fiiDiiDaily.available ? 'text-slate-900' : 'text-amber-700'
                  }`}
                >
                  {regime.fiiDiiDaily.note}
                </span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <span className="font-semibold text-slate-700">FII Long-Short Ratio:</span>{' '}
                {regime.fiiLongShortRatio.available && regime.fiiLongShortRatio.value !== null ? (
                  <>
                    <span
                      className={`font-mono font-semibold ${
                        regime.fiiLongShortRatio.status === 'FALLING_REDUCE'
                          ? 'text-rose-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {regime.fiiLongShortRatio.value.toFixed(2)}x
                    </span>{' '}
                    <span className="text-slate-600">({regime.fiiLongShortRatio.note})</span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-amber-700 font-semibold">DATA NOT AVAILABLE</span>{' '}
                    <span className="text-slate-600">
                      ({regime.fiiLongShortRatio.note || 'participant OI CSV unavailable'})
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="text-xs text-slate-700 font-mono bg-slate-50 border border-slate-200 rounded px-3.5 py-2">
              {regime.regimeReasons.map((r, i) => (
                <div key={i}>• {r}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Phase 2: Live RSS News Impact Engine & Geopolitical Matrix */}
      {macroData && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-blue-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Phase 2 · Live RSS News Impact Engine &amp; Geopolitical / DXY Matrix
              </h2>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              {macroData.feeds.map((f) => (
                <span
                  key={f.name}
                  className={f.status === 'OK' ? 'text-emerald-700' : 'text-amber-700'}
                >
                  {f.name.split(' ')[0]}: {f.status} ({f.count})
                </span>
              ))}
              <button
                type="button"
                onClick={() => setNewsOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-blue-700 hover:underline font-sans font-medium"
              >
                {newsOpen ? 'Collapse' : 'Expand'}
                {newsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {newsOpen && (
            <div className="p-5 space-y-4 text-xs">
              {(macroData.geopoliticalAlerts.length > 0 || macroData.dxyAvoidSectors.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {macroData.geopoliticalAlerts.length > 0 && (
                    <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-md">
                      <div className="font-semibold text-rose-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Active Geopolitical Alerts
                      </div>
                      <ul className="mt-1 space-y-1 text-[11px] text-rose-800">
                        {macroData.geopoliticalAlerts.map((g, i) => (
                          <li key={i}>• {g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {macroData.dxyAvoidSectors.length > 0 && (
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-md">
                      <div className="font-semibold text-amber-900">
                        DXY Strong (&gt;=103) Sector Filter Active
                      </div>
                      <div className="mt-1 text-[11px] text-amber-900">
                        <strong>AVOID:</strong> {macroData.dxyAvoidSectors.join(', ')}
                      </div>
                      <div className="mt-0.5 text-[11px] text-emerald-800">
                        <strong>DEFENSIVE BUY:</strong> {macroData.dxyDefensiveSectors.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {macroData.sectorImpacts.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  {macroData.sectorImpacts.map((s) => (
                    <div
                      key={s.sector}
                      className={`p-2.5 rounded border text-[11px] ${
                        s.bias === 'AVOID'
                          ? 'bg-rose-50/60 border-rose-200'
                          : s.bias === 'BOOST'
                            ? 'bg-emerald-50/60 border-emerald-200'
                            : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="font-semibold text-slate-900 truncate">{s.sector}</div>
                      <div className="font-mono mt-0.5">
                        <span className={s.bias === 'AVOID' ? 'text-rose-700 font-bold' : s.bias === 'BOOST' ? 'text-emerald-700 font-bold' : 'text-slate-600'}>
                          {s.bias}
                        </span>{' '}
                        (+{s.positiveHits}/-{s.negativeHits})
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Interactive Macro News Filter Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={newsQ}
                      onChange={(e) => setNewsQ(e.target.value)}
                      placeholder="Filter news, rule, or sector..."
                      className="pl-7 pr-2.5 py-1 bg-white border border-slate-200 rounded text-xs w-48 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <select
                    aria-label="Macro News Sentiment Filter"
                    value={newsSentiment}
                    onChange={(e) => setNewsSentiment(e.target.value as typeof newsSentiment)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
                  >
                    <option value="ALL">All Sentiments</option>
                    <option value="POSITIVE">Positive</option>
                    <option value="NEGATIVE">Negative</option>
                    <option value="NEUTRAL">Neutral</option>
                  </select>

                  <select
                    aria-label="Macro News Category Filter"
                    value={newsCategory}
                    onChange={(e) => setNewsCategory(e.target.value as typeof newsCategory)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
                  >
                    <option value="ALL">All Categories</option>
                    {newsCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Macro News Horizon Filter"
                    value={newsHorizon}
                    onChange={(e) => setNewsHorizon(e.target.value as typeof newsHorizon)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
                  >
                    <option value="ALL">All Horizons</option>
                    <option value="STRUCTURAL">Structural</option>
                    <option value="TEMPORARY">Temporary</option>
                  </select>

                  <select
                    aria-label="Macro News Sector Filter"
                    value={newsSector}
                    onChange={(e) => setNewsSector(e.target.value)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
                  >
                    <option value="ALL">All Sectors</option>
                    {newsSectors.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                  <span>
                    Showing {filteredMacroNews.length} / {macroData.newsItems.length}
                  </span>
                  {(newsQ || newsSentiment !== 'ALL' || newsCategory !== 'ALL' || newsHorizon !== 'ALL' || newsSector !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewsQ('');
                        setNewsSentiment('ALL');
                        setNewsCategory('ALL');
                        setNewsHorizon('ALL');
                        setNewsSector('ALL');
                      }}
                      className="px-2 py-0.5 text-[11px] font-sans font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                {filteredMacroNews.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">
                    No macro news headlines match these filters.
                  </div>
                ) : (
                  filteredMacroNews.slice(0, 40).map((n, idx) => (
                    <div key={idx} className="px-3.5 py-2 flex items-start justify-between gap-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-slate-900 hover:text-blue-700 inline-flex items-center gap-1"
                        >
                          <span className="line-clamp-1">{n.title}</span>
                          <ArrowUpRight className="w-3 h-3 shrink-0" />
                        </a>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          {n.source} · {n.category} · {n.horizon} · {n.matchedRule}
                          {n.negativeSectors.length > 0 && ` · Neg: ${n.negativeSectors.join('/')}`}
                          {n.positiveSectors.length > 0 && ` · Pos: ${n.positiveSectors.join('/')}`}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded border ${
                          n.sentiment === 'POSITIVE'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : n.sentiment === 'NEGATIVE'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        {n.sentiment}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 12: Daily Ranked Bot Scanner */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Section 12 · Daily Open-Source Swing Bot Ranked Output ({scanItems.length}/{scannedCandidates} Evaluated)
            </h2>
            <p className="text-xs text-slate-500">
              Applies Section 11 Scoring (Base 50 on Hard Reject pass; 0 on Fundamental Reject; &gt;=85 STRONG BUY, 70–84 BUY 75%, 60–69 BUY 50%)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScanScope)}
              className="flex-1 sm:flex-none min-h-[38px] px-2.5 py-1.5 border border-slate-200 rounded-md bg-white text-slate-700"
            >
              <option value="LIQUID_TIERS">Liquid Tiers &amp; High RVOL</option>
              <option value="IPO">IPO Sector (&lt;1Y Listings)</option>
              <option value="TOP_SECTORS">Top 3 Rotating Sectors</option>
              <option value="DELIV_HIGH">Delivery 5D &gt;= 60%</option>
              <option value="WATCHLIST">Starred Watchlist</option>
            </select>

            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="min-h-[38px] px-2.5 py-1.5 border border-slate-200 rounded-md bg-white text-slate-700 font-mono"
            >
              <option value={8}>Top 8</option>
              <option value={12}>Top 12</option>
              <option value={16}>Top 16</option>
            </select>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runScan({ customQ: searchQ });
              }}
              className="flex items-center gap-1 w-full sm:w-auto"
            >
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Filter symbol..."
                className="flex-1 sm:flex-none sm:w-32 min-h-[38px] px-2.5 py-1.5 border border-slate-200 rounded-md text-xs font-mono"
              />
              <button
                type="submit"
                className="min-w-[38px] min-h-[38px] flex items-center justify-center p-1.5 border border-slate-200 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-700"
                title="Scan Symbol"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>

        {scanError && <div className="p-4 text-xs text-rose-700 bg-rose-50">{scanError}</div>}

        {scanLoading ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Running Phase 1–8 evaluation on Screener.in + BSE Official + NSE XBRL fundamentals, Yahoo 3Y OHLCV &amp; NSE Bhavcopy...
          </div>
        ) : scanItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No stocks matched this scan filter. Try switching scope or clearing symbol search.
          </div>
        ) : (
          <>
          {/* Mobile Card View for Daily Ranked Bot Scan (md:hidden) */}
          <div className="md:hidden divide-y divide-slate-100">
            {scanItems.map((item) => {
              const isExp = expandedSymbol === item.symbol;
              return (
                <div key={`m-bot-${item.symbol}`} className="p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(item.symbol)}
                          className="font-mono text-sm font-bold text-blue-700 hover:underline"
                        >
                          {item.symbol}
                        </button>
                        {getCapShortLabel(item.marketCapCategory) && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                              item.marketCapCategory
                            )}`}
                          >
                            {getCapShortLabel(item.marketCapCategory)}
                          </span>
                        )}
                        {item.isIpo && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                            IPO
                          </span>
                        )}
                        {item.phase6EntryTriggers.ema21Cross44Bullish ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                            21×44
                          </span>
                        ) : item.phase6EntryTriggers.ema21AboveEma44 ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                            21&gt;44
                          </span>
                        ) : null}
                        {(item.newsBadge?.hasAnnouncement || item.newsBadge?.hasRiskAlert) && (
                          <span
                            title={`Recent Announcement/News: ${item.newsBadge.label} (${item.newsBadge.headlineCount} items)`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${
                              item.newsBadge.hasRiskAlert
                                ? 'bg-rose-50 text-rose-800 border-rose-300'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            <Bell className="w-2.5 h-2.5" />
                            News
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {item.sector}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {!item.phase3Fundamentals.hardRejectPass ? (
                        <span className="inline-block px-2 py-1 text-[10px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 rounded">
                          REJECTED: FUNDAMENTAL FAIL
                        </span>
                      ) : (
                        <>
                          <div className="font-mono font-bold text-slate-900">
                            {item.scoring.totalScore}/100
                          </div>
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${verdictTone(
                              item.scoring.verdict
                            )}`}
                          >
                            {item.scoring.verdict}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] bg-slate-50 border border-slate-100 rounded p-2">
                    <div>
                      <span className="text-[10px] text-slate-400 font-sans block">
                        Entry / SL / Target
                      </span>
                      <span className="font-semibold text-slate-900">
                        ₹{item.phase7Risk.entryPrice.toFixed(1)} · SL ₹{item.phase7Risk.stopLoss.toFixed(0)} · T ₹
                        {item.phase7Risk.target15Pct.toFixed(0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-sans block">
                        Burst 252D %
                      </span>
                      <span>
                        <strong className="text-emerald-700">
                          {item.phase4Movement.burstPowerNormalized !== null
                            ? `Up ${item.phase4Movement.burstPowerNormalized.toFixed(1)}%`
                            : 'N/A'}
                        </strong>
                        {' / '}
                        <strong className="text-rose-700">
                          {item.phase4Movement.downwardBurstNormalized !== null
                            ? `Dn ${item.phase4Movement.downwardBurstNormalized.toFixed(1)}%`
                            : 'N/A'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600">
                    <span>
                      F:{' '}
                      {item.phase3Fundamentals.piotroskiScore !== null
                        ? `${item.phase3Fundamentals.piotroskiScore}/${item.phase3Fundamentals.piotroskiAvailable}`
                        : 'N/A'}{' '}
                      · Size {item.phase7Risk.suggestedPositionSizePct}%
                      {item.periodicAnalysis
                        ? ` · Per ${item.periodicAnalysis.periodicScore.score ?? 'N/A'}`
                        : ''}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void runBacktest(item.symbol)}
                        className="min-h-[34px] px-2.5 py-1 text-[11px] font-sans font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
                      >
                        3Y Backtest
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedSymbol(isExp ? null : item.symbol)}
                        className="min-h-[34px] px-2.5 py-1 text-[11px] font-sans font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
                      >
                        {isExp ? 'Hide' : 'Audit'}
                      </button>
                    </div>
                  </div>

                  {isExp && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-1.5 text-[11px] font-mono">
                      <div>
                        Flags: {item.phase2SectorMacroNews.flags.join(' · ') || 'Neutral'}
                      </div>
                      {item.periodicAnalysis && (
                        <div>
                          S1 ₹{item.periodicAnalysis.supportResistance.nearestSupport ?? '—'} · R1 ₹
                          {item.periodicAnalysis.supportResistance.nearestResistance ?? '—'} · D/W/M{' '}
                          {item.periodicAnalysis.sentiment.daily.status[0]}/
                          {item.periodicAnalysis.sentiment.weekly.status[0]}/
                          {item.periodicAnalysis.sentiment.monthly.status[0]}
                        </div>
                      )}
                      <div>
                        {item.phase3Fundamentals.gates.slice(0, 4).map((g) => (
                          <div key={g.label} className="flex justify-between">
                            <span className="text-slate-500">{g.label}</span>
                            <span>{g.valueText}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <th className="py-2.5 px-4">Symbol / Sector</th>
                  <th className="py-2.5 px-3 text-right">Score / Verdict</th>
                  <th className="py-2.5 px-3 text-right">Entry / Stop / Target</th>
                  <th className="py-2.5 px-3 text-right">Size</th>
                  <th className="py-2.5 px-3">Piotroski &amp; Value Zone</th>
                  <th className="py-2.5 px-3">Burst % (Up/Dn) / RS / Triggers</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scanItems.map((item) => {
                  const isExp = expandedSymbol === item.symbol;
                  return (
                    <React.Fragment key={item.symbol}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(item.symbol)}
                              className="font-mono font-bold text-blue-700 hover:underline"
                            >
                              {item.symbol}
                            </button>
                            {getCapShortLabel(item.marketCapCategory) && (
                              <span
                                title={formatMarketCapCr(item.marketCapCr)}
                                className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                                  item.marketCapCategory
                                )}`}
                              >
                                {getCapShortLabel(item.marketCapCategory)}
                              </span>
                            )}
                            {item.isIpo && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                                IPO
                              </span>
                            )}
                            {item.phase6EntryTriggers.ema21Cross44Bullish ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                21×44 Cross
                              </span>
                            ) : item.phase6EntryTriggers.ema21AboveEma44 ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                                21&gt;44
                              </span>
                            ) : null}
                            {(item.newsBadge?.hasAnnouncement || item.newsBadge?.hasRiskAlert) && (
                              <span
                                title={`Recent Announcement/News: ${item.newsBadge.label} (${item.newsBadge.headlineCount} items)`}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${
                                  item.newsBadge.hasRiskAlert
                                    ? 'bg-rose-50 text-rose-800 border-rose-300'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                <Bell className="w-2.5 h-2.5" />
                                News
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            {item.sector}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {!item.phase3Fundamentals.hardRejectPass ? (
                            <span className="inline-block px-2 py-1 text-[10px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 rounded">
                              REJECTED: FUNDAMENTAL FAIL
                            </span>
                          ) : (
                            <>
                              <div className="font-mono font-bold text-slate-900">
                                {item.scoring.totalScore}/100
                              </div>
                              <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${verdictTone(item.scoring.verdict)}`}>
                                {item.scoring.verdict}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          <div className="text-slate-900 font-semibold">
                            ₹{item.phase7Risk.entryPrice.toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            SL ₹{item.phase7Risk.stopLoss.toFixed(0)} (-{item.phase7Risk.stopPct}%) · T ₹{item.phase7Risk.target15Pct.toFixed(0)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                          {item.phase7Risk.suggestedPositionSizePct}%
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-mono text-[11px] text-slate-800">
                            F-Score:{' '}
                            {item.phase3Fundamentals.piotroskiScore !== null
                              ? `${item.phase3Fundamentals.piotroskiScore}/${item.phase3Fundamentals.piotroskiAvailable}`
                              : 'DATA NOT AVAILABLE'}{' '}
                            ({item.phase3Fundamentals.hardRejectPassCount}/7 gates)
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            Graham: {item.phase3Fundamentals.valuation.grahamZone} · DCF: {item.phase3Fundamentals.valuation.dcfZone}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div
                            className="font-mono text-[11px] text-slate-800"
                            title="Upward Burst % vs Downward Burst % over 252D (e.g., Up 20% / Dn 20% = balanced chop; Up 25% / Dn 5% = bullish dominance)"
                          >
                            Burst:{' '}
                            <span className="text-emerald-700 font-semibold">
                              {item.phase4Movement.burstPowerNormalized !== null
                                ? `Up ${item.phase4Movement.burstPowerNormalized.toFixed(1)}%`
                                : 'N/A'}
                            </span>
                            {' / '}
                            <span className="text-rose-700 font-semibold">
                              {item.phase4Movement.downwardBurstNormalized !== null
                                ? `Dn ${item.phase4Movement.downwardBurstNormalized.toFixed(1)}%`
                                : 'N/A'}
                            </span>
                            {item.phase4Movement.upwardBurstSharePct !== undefined &&
                              item.phase4Movement.upwardBurstSharePct !== null && (
                                <span className="text-slate-500">
                                  {' '}
                                  ({item.phase4Movement.upwardBurstSharePct}%/{item.phase4Movement.downwardBurstSharePct}%)
                                </span>
                              )}
                            {' · '}RS:{' '}
                            {item.phase4Movement.relativeStrengthPctRank !== null
                              ? `${item.phase4Movement.relativeStrengthPctRank}%ile`
                              : 'N/A'}
                          </div>
                          {item.periodicAnalysis && (
                            <div className="font-mono text-[10px] text-slate-600 mt-0.5">
                              Periodic:{' '}
                              <strong
                                className={
                                  (item.periodicAnalysis.periodicScore.score ?? 0) >= 60
                                    ? 'text-emerald-700'
                                    : (item.periodicAnalysis.periodicScore.score ?? 50) < 45
                                      ? 'text-rose-700'
                                      : 'text-slate-800'
                                }
                              >
                                {item.periodicAnalysis.periodicScore.score ?? 'N/A'}/100
                              </strong>{' '}
                              · {item.periodicAnalysis.sentiment.daily.status[0]}/
                              {item.periodicAnalysis.sentiment.weekly.status[0]}/
                              {item.periodicAnalysis.sentiment.monthly.status[0]} · S1 ₹
                              {item.periodicAnalysis.supportResistance.nearestSupport ?? '—'} / R1 ₹
                              {item.periodicAnalysis.supportResistance.nearestResistance ?? '—'}
                            </div>
                          )}
                          <div className="text-[11px] text-emerald-700 font-mono truncate max-w-[260px]">
                            {item.phase6EntryTriggers.fastSignalsTriggered[0] ||
                              (item.phase5Accumulation.wyckoffSpring ? 'Wyckoff Spring' : 'Monitoring')}
                          </div>
                          {item.phase5Accumulation.bulkBlockConfirmation.totalDeals30d > 0 && (
                            <div
                              className={`text-[10px] font-mono truncate max-w-[260px] mt-0.5 ${
                                item.phase5Accumulation.bulkBlockConfirmation.confirmationStatus === 'CONFIRMED'
                                  ? 'text-emerald-700 font-semibold'
                                  : item.phase5Accumulation.bulkBlockConfirmation.confirmationStatus === 'SELL_PRESSURE'
                                    ? 'text-rose-700 font-semibold'
                                    : 'text-blue-700'
                              }`}
                              title={item.phase5Accumulation.bulkBlockConfirmation.confirmationReason}
                            >
                              Bulk/Block: {item.phase5Accumulation.bulkBlockConfirmation.confirmationStatus.replace(/_/g, ' ')} ·{' '}
                              {item.phase5Accumulation.bulkBlockConfirmation.netValueCr >= 0 ? '+' : ''}
                              ₹{item.phase5Accumulation.bulkBlockConfirmation.netValueCr}Cr
                              {item.phase5Accumulation.bulkBlockConfirmation.buyPct !== undefined
                                ? ` (${item.phase5Accumulation.bulkBlockConfirmation.buyPct}% Buy)`
                                : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void runBacktest(item.symbol)}
                              className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
                            >
                              3Y Backtest
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedSymbol(isExp ? null : item.symbol)}
                              className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
                            >
                              {isExp ? 'Hide' : 'Audit'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExp && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={7} className="p-4 text-xs space-y-2 border-t border-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <div className="font-semibold text-slate-800">Hard Reject / Fund Gates</div>
                                {item.phase3Fundamentals.gates.map((g) => (
                                  <div key={g.label} className="flex justify-between font-mono text-[11px]">
                                    <span className="text-slate-600">{g.label}</span>
                                    <span className={g.status === 'PASS' ? 'text-emerald-700' : g.status === 'FAIL' ? 'text-rose-700' : 'text-amber-700'}>
                                      {g.valueText} ({g.status})
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-800">Macro, News &amp; Institutional</div>
                                <div className="text-[11px] text-slate-600 space-y-0.5 mt-1">
                                  <div>Flags: {item.phase2SectorMacroNews.flags.join(' · ') || 'Neutral'}</div>
                                  <div>
                                    Promoter: {item.phase5Accumulation.promoterHoldingPct ?? 'N/A'}% · FII:{' '}
                                    {item.phase5Accumulation.fiiHoldingPct ?? 'N/A'}% · DII:{' '}
                                    {item.phase5Accumulation.diiHoldingPct ?? 'N/A'}% · Multi-Qtr:{' '}
                                    <span
                                      className={`font-mono font-semibold ${
                                        item.phase5Accumulation.fiiDiiMultiQuarterTrend === 'INCREASING'
                                          ? 'text-emerald-700'
                                          : item.phase5Accumulation.fiiDiiMultiQuarterTrend === 'DECREASING'
                                            ? 'text-rose-700'
                                            : item.phase5Accumulation.fiiDiiMultiQuarterTrend === 'DATA NOT AVAILABLE'
                                              ? 'text-amber-700'
                                              : 'text-slate-800'
                                      }`}
                                    >
                                      {item.phase5Accumulation.fiiDiiMultiQuarterTrend}
                                    </span>
                                  </div>
                                  <div>
                                    30D Bulk Repeats: {item.phase5Accumulation.bulkDealRepeatedPrints} · VCP:{' '}
                                    {item.phase5Accumulation.vcpDetail}
                                  </div>
                                  {item.periodicAnalysis && (
                                    <div className="pt-1 border-t border-slate-200 font-mono text-[11px] text-slate-700 space-y-0.5">
                                      <div>
                                        S/R: S2 ₹{item.periodicAnalysis.supportResistance.secondarySupport ?? '—'} · S1 ₹
                                        {item.periodicAnalysis.supportResistance.nearestSupport ?? '—'} · R1 ₹
                                        {item.periodicAnalysis.supportResistance.nearestResistance ?? '—'} · R2 ₹
                                        {item.periodicAnalysis.supportResistance.secondaryResistance ?? '—'} (
                                        {item.periodicAnalysis.supportResistance.positionStatus.replace(/_/g, ' ')})
                                      </div>
                                      <div>
                                        Sentiment D/W/M: {item.periodicAnalysis.sentiment.daily.status} (
                                        {item.periodicAnalysis.sentiment.daily.score ?? 'N/A'}) /{' '}
                                        {item.periodicAnalysis.sentiment.weekly.status} (
                                        {item.periodicAnalysis.sentiment.weekly.score ?? 'N/A'}) /{' '}
                                        {item.periodicAnalysis.sentiment.monthly.status} (
                                        {item.periodicAnalysis.sentiment.monthly.score ?? 'N/A'}) · Periodic Score:{' '}
                                        <strong>
                                          {item.periodicAnalysis.periodicScore.score ?? 'N/A'}/100 (
                                          {item.periodicAnalysis.periodicScore.grade.replace(/_/g, ' ')})
                                        </strong>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="font-semibold text-slate-800">Active Scoring Weights</div>
                                <div className="text-[11px] font-mono text-slate-700 mt-1 space-y-0.5">
                                  {item.scoring.breakdown
                                    .filter((b) => b.active)
                                    .map((b, i) => (
                                      <div key={i} className="flex justify-between">
                                        <span>{b.label}</span>
                                        <span>{b.points >= 0 ? `+${b.points}` : b.points}</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Paper Trading Portfolio & Strategy Profit Tracker */}
      <PaperTradingPanel
        onSelectSymbol={onSelectSymbol}
        externalSeq={paperSeq + externalReloadSeq}
      />

      {/* Section 13: 2-3 Year Out-of-Sample & Phase-by-Phase Backtest Framework */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-blue-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Section 13 · 2–3 Year Out-of-Sample &amp; Phase-by-Phase Backtest Framework (Paper Trading)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Tests real Yahoo 3Y OHLCV with 3%+ next-day gap-up skip, +20% breakeven trailing stop, 60/40 In-Sample vs Out-of-Sample split, and Phase Ablation.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runBacktest();
            }}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <input
              type="text"
              value={btSymbol}
              onChange={(e) => setBtSymbol(e.target.value.toUpperCase())}
              className="w-24 px-2.5 py-1.5 border border-slate-200 rounded-md font-mono font-bold"
              placeholder="SYMBOL"
            />
            <label className="text-slate-600 flex items-center gap-1">
              Hold
              <input
                type="number"
                value={btHoldDays}
                onChange={(e) => setBtHoldDays(Number(e.target.value))}
                className="w-14 px-2 py-1 border border-slate-200 rounded font-mono"
              />
              d
            </label>
            <label className="text-slate-600 flex items-center gap-1">
              SL%
              <input
                type="number"
                value={btStopPct}
                onChange={(e) => setBtStopPct(Number(e.target.value))}
                className="w-14 px-2 py-1 border border-slate-200 rounded font-mono"
              />
            </label>
            <label className="text-slate-600 flex items-center gap-1">
              Tgt%
              <input
                type="number"
                value={btTargetPct}
                onChange={(e) => setBtTargetPct(Number(e.target.value))}
                className="w-14 px-2 py-1 border border-slate-200 rounded font-mono"
              />
            </label>
            <button
              type="submit"
              disabled={btLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md"
            >
              <Play className="w-3.5 h-3.5" />
              {btLoading ? 'Simulating...' : 'Run 3Y Backtest'}
            </button>
          </form>
        </div>

        {btError && <div className="p-4 text-xs text-rose-700 bg-rose-50">{btError}</div>}

        {btReport && (
          <div className="p-5 space-y-5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600">
              <span>
                <Activity className="w-3.5 h-3.5 inline mr-1 text-blue-700" />
                {btReport.symbol} · {btReport.dataSource} · {btReport.fromDate} → {btReport.toDate} ({btReport.totalSessions} sessions)
              </span>
              <span>Out-of-Sample Split Date: {btReport.splitDate}</span>
            </div>

            {/* Overall vs In-Sample vs Out-of-Sample */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[btReport.overall, btReport.inSample, btReport.outOfSample].map((m) => (
                <div key={m.label} className="border border-slate-200 rounded-md p-3.5 space-y-1.5">
                  <div className="font-semibold text-slate-900">{m.label}</div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                    <div>
                      <div className="text-slate-500">Trades</div>
                      <div className="font-bold text-slate-900">{m.trades}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Win Rate</div>
                      <div className="font-bold text-slate-900">
                        {m.winRatePct !== null ? `${m.winRatePct}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Profit Factor</div>
                      <div className="font-bold text-slate-900">{m.profitFactor ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Avg Return</div>
                      <div className={`font-bold ${(m.avgReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {m.avgReturnPct !== null ? `${m.avgReturnPct >= 0 ? '+' : ''}${m.avgReturnPct}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Max DD</div>
                      <div className="font-bold text-rose-700">
                        {m.maxDrawdownPct !== null ? `-${m.maxDrawdownPct}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Sharpe</div>
                      <div className="font-bold text-slate-900">{m.sharpeRatio ?? '—'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Phase-by-Phase Ablation Table */}
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800">
                Phase-by-Phase Value-Add Ablation (Which Filter Improves Risk-Adjusted Return)
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 px-4">Phase Filter Stack</th>
                    <th className="py-2 px-3 text-right">Trades</th>
                    <th className="py-2 px-3 text-right">Win %</th>
                    <th className="py-2 px-3 text-right">Avg Ret</th>
                    <th className="py-2 px-3 text-right">Profit Factor</th>
                    <th className="py-2 px-3 text-right">Max DD</th>
                    <th className="py-2 px-3 text-right">Sharpe</th>
                    <th className="py-2 px-4 text-right">Compounded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {btReport.phaseAblation.map((p) => (
                    <tr key={p.label}>
                      <td className="py-2 px-4 font-sans font-medium text-slate-800">{p.label}</td>
                      <td className="py-2 px-3 text-right">{p.trades}</td>
                      <td className="py-2 px-3 text-right">
                        {p.winRatePct !== null ? `${p.winRatePct}%` : '—'}
                      </td>
                      <td className={`py-2 px-3 text-right ${(p.avgReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {p.avgReturnPct !== null ? `${p.avgReturnPct >= 0 ? '+' : ''}${p.avgReturnPct}%` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">{p.profitFactor ?? '—'}</td>
                      <td className="py-2 px-3 text-right text-rose-700">
                        {p.maxDrawdownPct !== null ? `-${p.maxDrawdownPct}%` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">{p.sharpeRatio ?? '—'}</td>
                      <td className={`py-2 px-4 text-right font-semibold ${(p.compoundedReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {p.compoundedReturnPct !== null ? `${p.compoundedReturnPct >= 0 ? '+' : ''}${p.compoundedReturnPct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recent Paper Trades */}
            {btReport.recentTrades.length > 0 && (
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800">
                  Recent Simulated Paper Trades ({btReport.recentTrades.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-sans">
                        <th className="py-1.5 px-4">Entry Date</th>
                        <th className="py-1.5 px-3">Exit Date</th>
                        <th className="py-1.5 px-3 text-right">Entry</th>
                        <th className="py-1.5 px-3 text-right">Exit</th>
                        <th className="py-1.5 px-3 text-right">Return</th>
                        <th className="py-1.5 px-3">Outcome</th>
                        <th className="py-1.5 px-4 text-right">Sample</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {btReport.recentTrades.map((t, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-4">{t.entryDate}</td>
                          <td className="py-1.5 px-3">{t.exitDate}</td>
                          <td className="py-1.5 px-3 text-right">₹{t.entryPrice.toFixed(2)}</td>
                          <td className="py-1.5 px-3 text-right">₹{t.exitPrice.toFixed(2)}</td>
                          <td className={`py-1.5 px-3 text-right font-semibold ${t.returnPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {t.returnPct >= 0 ? '+' : ''}
                            {t.returnPct}%
                          </td>
                          <td className="py-1.5 px-3">{t.outcome}</td>
                          <td className="py-1.5 px-4 text-right text-slate-500">
                            {t.inSample ? 'In-Sample' : 'Out-of-Sample'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {riskModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="font-bold text-base flex items-center gap-2">
                <Calculator className="w-5 h-5 text-emerald-400" />
                <span>Risk Sizer Calculator ({riskModalItem.symbol})</span>
              </div>
              <button
                type="button"
                onClick={() => setRiskModalItem(null)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Total Capital (₹)</label>
                <input
                  type="number"
                  value={riskCapital}
                  onChange={(e) => setRiskCapital(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Risk % (Default 1%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={riskPercentage}
                  onChange={(e) => setRiskPercentage(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 font-mono"
                />
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5 font-mono text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>CMP / LTP:</span>
                  <span className="text-white">₹{riskModalItem.closePrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>ATR Stop Loss:</span>
                  <span className="text-rose-400">₹{riskModalItem.phase7Risk.stopLoss.toFixed(2)} (-{riskModalItem.phase7Risk.stopPct}%)</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Risk Budget:</span>
                  <span className="text-amber-400">₹{(riskCapital * (riskPercentage / 100)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-white font-bold pt-1.5 border-t border-slate-800">
                  <span>Buy Quantity:</span>
                  <span className="text-emerald-400 text-sm">
                    {Math.floor((riskCapital * (riskPercentage / 100)) / Math.max(riskModalItem.closePrice - riskModalItem.phase7Risk.stopLoss, 0.01))} Shares
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Position Value:</span>
                  <span>₹{(Math.floor((riskCapital * (riskPercentage / 100)) / Math.max(riskModalItem.closePrice - riskModalItem.phase7Risk.stopLoss, 0.01)) * riskModalItem.closePrice).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setRiskModalItem(null)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
