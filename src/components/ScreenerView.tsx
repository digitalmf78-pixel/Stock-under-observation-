import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Compass,
  Download,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import type {
  FundamentalFreshness,
  LiveStockQuote,
  ScreenerFilterPatch,
  ScreenerRow,
  SectorSentimentItem,
} from '../types/trading';
import { getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { evaluateQuoteFreshness } from '../utils/quoteFreshness';
import { authFetch } from '../utils/authClient';
import { T1T2DailyReportModal } from './T1T2DailyReportModal';
import { SwingTierSpecPanel } from './SwingTierSpecPanel';

interface ScreenerViewProps {
  onSelectSymbol: (symbol: string) => void;
  sector: string;
  onSectorChange: (sector: string) => void;
  sectorResetSeq?: number;
  freshness: FundamentalFreshness | 'ALL';
  onFreshnessChange: (freshness: FundamentalFreshness | 'ALL') => void;
  freshnessResetSeq?: number;
  screenerPreset?: { seq: number; patch: ScreenerFilterPatch } | null;
  availableSectors: string[];
  topSectors?: SectorSentimentItem[];
  watchlistSymbols?: Set<string>;
  onToggleWatchlist?: (symbol: string) => void;
  externalReloadSeq?: number;
}

export const ScreenerView: React.FC<ScreenerViewProps> = ({
  onSelectSymbol,
  sector,
  onSectorChange,
  sectorResetSeq = 0,
  freshness,
  onFreshnessChange,
  freshnessResetSeq = 0,
  screenerPreset = null,
  availableSectors,
  topSectors = [],
  watchlistSymbols,
  onToggleWatchlist,
  externalReloadSeq = 0,
}) => {
  const [q, setQ] = useState('');
  const [delivery, setDelivery] = useState<string>('UNION');
  const [swingTier, setSwingTier] = useState<string>('ALL');
  const [uTurn, setUTurn] = useState<string>('ALL');
  const [rvol, setRvol] = useState<string>('ALL');
  const [liquidity, setLiquidity] = useState<string>('PASS');
  const [fundamental, setFundamental] = useState<string>('ALL');
  const [cap, setCap] = useState<string>('ALL');
  const [emaCross, setEmaCross] = useState<string>('ALL');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [upcomingResultsOnly, setUpcomingResultsOnly] = useState(false);
  const [sort, setSort] = useState<string>('rvol');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [latestDate, setLatestDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataRenderSeq, setDataRenderSeq] = useState(0);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [batchFetching, setBatchFetching] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveStockQuote>>({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveCheckedAt, setLiveCheckedAt] = useState('');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [t1T2ReportOpen, setT1T2ReportOpen] = useState(false);

  useEffect(() => {
    if (freshnessResetSeq > 0) {
      setDelivery('ALL');
      setLiquidity('ALL');
      setSwingTier('ALL');
      setFundamental('ALL');
      setOffset(0);
    }
  }, [freshnessResetSeq]);

  useEffect(() => {
    if (sectorResetSeq > 0) {
      setDelivery('ALL');
      setLiquidity('ALL');
      setSwingTier('ALL');
      setUTurn('ALL');
      setRvol('ALL');
      setOffset(0);
    }
  }, [sectorResetSeq]);

  useEffect(() => {
    if (!screenerPreset) return;
    const p = screenerPreset.patch;
    if (p.q !== undefined) setQ(p.q);
    if (p.sector !== undefined) onSectorChange(p.sector);
    if (p.delivery !== undefined) setDelivery(p.delivery);
    if (p.swingTier !== undefined) setSwingTier(p.swingTier);
    if (p.uTurn !== undefined) setUTurn(p.uTurn);
    if (p.rvol !== undefined) setRvol(p.rvol);
    if (p.liquidity !== undefined) setLiquidity(p.liquidity);
    if (p.fundamental !== undefined) setFundamental(p.fundamental);
    if (p.freshness !== undefined) onFreshnessChange(p.freshness);
    if (p.cap !== undefined) setCap(p.cap);
    if (p.emaCross !== undefined) setEmaCross(p.emaCross);
    if (p.watchlistOnly !== undefined) setWatchlistOnly(p.watchlistOnly);
    if (p.upcomingResultsOnly !== undefined) setUpcomingResultsOnly(p.upcomingResultsOnly);
    if (p.sort !== undefined) setSort(p.sort);
    if (p.dir !== undefined) setDir(p.dir);
    setOffset(0);
  }, [screenerPreset?.seq]);

  useEffect(() => {
    const controller = new AbortController();
    let flashTimer: number | undefined;
    const timer = setTimeout(async () => {
      setLoading(true);
      setJustRefreshed(false);
      setError(null);
      try {
        const params = new URLSearchParams({
          q,
          sector,
          delivery,
          swingTier,
          uTurn,
          rvol,
          liquidity,
          fundamental,
          freshness,
          cap,
          emaCross,
          sort,
          dir,
          limit: String(limit),
          offset: String(offset),
        });
        if (watchlistOnly) {
          params.set('watchlistOnly', '1');
        }
        if (upcomingResultsOnly) {
          params.set('upcomingResults', '1');
        }
        const res = await fetch(`/api/screener?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setRows(json.rows || []);
        setTotal(json.total || 0);
        setLatestDate(json.latestDate || '');
        setDataRenderSeq((s) => s + 1);
        setLastRefreshedAt(new Date().toLocaleTimeString('en-IN', { hour12: false }));
        setJustRefreshed(true);
        flashTimer = window.setTimeout(() => {
          setJustRefreshed(false);
        }, 1250);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Failed to load screener data');
        }
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      if (flashTimer !== undefined) clearTimeout(flashTimer);
      controller.abort();
    };
  }, [
    q,
    sector,
    delivery,
    swingTier,
    uTurn,
    rvol,
    liquidity,
    fundamental,
    freshness,
    cap,
    emaCross,
    watchlistOnly,
    upcomingResultsOnly,
    sort,
    dir,
    offset,
    refreshTick,
    externalReloadSeq,
  ]);

  const handleBatchEnrich = async () => {
    setBatchFetching(true);
    setBatchNotice(null);
    try {
      const res = await authFetch('/api/refresh/fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchMissing: true, limit: 25 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setBatchNotice(json.message || 'Fundamentals updated.');
      if (json.succeeded?.length > 0) {
        setRefreshTick((t) => t + 1);
      }
    } catch (err) {
      setBatchNotice(`Batch fetch failed: ${(err as Error).message}`);
    } finally {
      setBatchFetching(false);
    }
  };

  const fetchLiveForRows = useCallback(
    async (targetRows: ScreenerRow[], forceRefresh = false, signal?: AbortSignal) => {
      const symbols = targetRows.slice(0, 50).map((r) => r.symbol);
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

  useEffect(() => {
    if (rows.length === 0) return;
    const controller = new AbortController();
    void fetchLiveForRows(rows, false, controller.signal);
    return () => controller.abort();
  }, [dataRenderSeq, fetchLiveForRows]);

  const liveSummary = useMemo(() => {
    let availableCount = 0;
    let upCount = 0;
    let downCount = 0;
    let flatCount = 0;
    let unavailableCount = 0;
    let staleCount = 0;
    let liveCount = 0;
    let sumMovePct = 0;

    for (const r of rows) {
      const q = liveQuotes[r.symbol];
      if (!q) continue;
      if (!q.available || q.livePrice === null || r.closePrice <= 0) {
        unavailableCount++;
        continue;
      }
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
      unavailableCount,
      staleCount,
      liveCount,
      avgMovePct: availableCount > 0 ? sumMovePct / availableCount : null,
      rightPct: availableCount > 0 ? (upCount / availableCount) * 100 : null,
    };
  }, [rows, liveQuotes]);

  const handleSort = (col: string) => {
    setOffset(0);
    if (sort === col) {
      setDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(col);
      setDir('desc');
    }
  };

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    const headers = [
      'Symbol',
      'MarketCapCr',
      'MarketCapCategory',
      'Date',
      'SwingTier',
      'ScannerEodClose',
      'EodChangePct',
      'LivePrice',
      'LiveVsScannerEODPct',
      'DeliveryCategory',
      'DeliveryPct',
      'DelivQtyRatio',
      'RVOL',
      'RSI14',
      'ATRPct',
      'SuggestedStopLoss',
      'EMA21',
      'EMA44',
      'AboveEMA21',
      'EMA21AboveEMA44',
      'EMA21Cross44Bullish',
      'AvgTurnover20DCr',
      'LiquidityTier',
      'FundamentalCoverage',
      'FundamentalPassCount',
      'FundamentalFreshness',
      'FundamentalAgeDays',
      'LatestFilingDate',
      'FundamentalSources',
      'FundamentalRemark',
      'UTurnStatus',
      'UTurnTarget',
      'UTurnDistPct',
      'TopTurnStatus',
      'TopTurnTarget',
      'TopTurnDistPct',
    ];
    const csvLines = [
      headers.join(','),
      ...rows.map((r) => {
        const lq = liveQuotes[r.symbol];
        const liveP = lq?.available && lq.livePrice !== null ? lq.livePrice : null;
        const liveVsEod =
          liveP !== null && r.closePrice > 0
            ? ((liveP - r.closePrice) / r.closePrice) * 100
            : null;
        return [
          r.symbol,
          r.marketCapCr ?? '',
          r.marketCapCategory ?? '',
          r.latestDate,
          r.swingTier,
          r.closePrice.toFixed(2),
          r.changePct !== null ? r.changePct.toFixed(2) : '',
          liveP !== null ? liveP.toFixed(2) : '',
          liveVsEod !== null ? liveVsEod.toFixed(2) : '',
          r.deliveryCategory,
          r.delivPer !== null ? r.delivPer.toFixed(2) : '',
          r.delivQtyRatio !== null ? r.delivQtyRatio.toFixed(2) : '',
          r.rvol !== null ? r.rvol.toFixed(2) : '',
          r.rsi14 !== null ? r.rsi14.toFixed(1) : '',
          r.atrPct !== null ? r.atrPct.toFixed(2) : '',
          r.suggestedStopLoss !== null ? r.suggestedStopLoss.toFixed(2) : '',
          r.ema21 !== null ? r.ema21.toFixed(2) : '',
          r.ema44 !== null ? r.ema44.toFixed(2) : '',
          r.aboveEma21 ?? '',
          r.ema21AboveEma44 ?? '',
          r.ema21Cross44Bullish ?? '',
          r.avgTurnover20DCr !== null ? r.avgTurnover20DCr.toFixed(2) : '',
          r.liquidityTier,
          r.fundamentalCoverage,
          r.fundamentalPassCount,
          r.fundamentalFreshness,
          r.fundamentalAgeDays ?? '',
          r.latestFilingDate,
          `"${(r.fundamentalSources || []).join(' + ').replace(/"/g, '""')}"`,
          `"${(r.fundamentalRemark || '').replace(/"/g, '""')}"`,
          r.uTurnStatus ?? '',
          r.uTurnTarget !== null ? r.uTurnTarget.toFixed(2) : '',
          r.uTurnDistPct !== null ? r.uTurnDistPct.toFixed(2) : '',
          r.topTurnStatus ?? '',
          r.topTurnTarget !== null ? r.topTurnTarget.toFixed(2) : '',
          r.topTurnDistPct !== null ? r.topTurnDistPct.toFixed(2) : '',
        ].join(',');
      }),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nse_v8_swing_screener_${latestDate || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sort !== col) return null;
    return dir === 'desc' ? (
      <ArrowDown className="w-3 h-3 inline ml-1" />
    ) : (
      <ArrowUp className="w-3 h-3 inline ml-1" />
    );
  };

  const applyPreset = (
    preset: 'SWING_T1' | 'UTURN_READY' | 'FUND_SWING' | 'IPO_WATCH' | 'TOP_WARN' | 'RESET'
  ) => {
    setOffset(0);
    setQ('');
    onFreshnessChange('ALL');
    setCap('ALL');
    setEmaCross('ALL');
    setDir('desc');

    if (preset === 'SWING_T1') {
      onSectorChange('ALL');
      setDelivery('ALL');
      setLiquidity('PASS');
      setSwingTier('TIER_1_READY');
      setUTurn('ALL');
      setRvol('HIGH');
      setFundamental('ALL');
      setSort('rvol');
    } else if (preset === 'UTURN_READY') {
      onSectorChange('ALL');
      setDelivery('ALL');
      setLiquidity('PASS');
      setSwingTier('ALL');
      setUTurn('CONFIRMED_OR_TRIGGER');
      setRvol('ALL');
      setFundamental('ALL');
      setSort('uTurn');
    } else if (preset === 'FUND_SWING') {
      onSectorChange('ALL');
      setDelivery('UNION');
      setLiquidity('PASS');
      setSwingTier('ANY_SWING');
      setUTurn('ALL');
      setRvol('ALL');
      setFundamental('PASS_4');
      setSort('rvol');
    } else if (preset === 'IPO_WATCH') {
      onSectorChange('IPO / Recent Listings');
      setDelivery('ALL');
      setLiquidity('PASS');
      setSwingTier('ALL');
      setUTurn('ALL');
      setRvol('ALL');
      setFundamental('ALL');
      setSort('rvol');
    } else if (preset === 'TOP_WARN') {
      onSectorChange('ALL');
      setDelivery('ALL');
      setLiquidity('PASS');
      setSwingTier('ALL');
      setUTurn('TOP_CONFIRMED_OR_TRIGGER');
      setRvol('ALL');
      setFundamental('ALL');
      setSort('rvol');
    } else {
      onSectorChange('ALL');
      setDelivery('UNION');
      setLiquidity('PASS');
      setSwingTier('ALL');
      setUTurn('ALL');
      setRvol('ALL');
      setFundamental('ALL');
      setWatchlistOnly(false);
      setUpcomingResultsOnly(false);
      setSort('rvol');
    }
  };

  const isPresetActive = (
    preset: 'SWING_T1' | 'UTURN_READY' | 'FUND_SWING' | 'IPO_WATCH' | 'TOP_WARN'
  ): boolean => {
    if (preset === 'SWING_T1') {
      return sector === 'ALL' && liquidity === 'PASS' && swingTier === 'TIER_1_READY' && rvol === 'HIGH' && uTurn === 'ALL';
    }
    if (preset === 'UTURN_READY') {
      return sector === 'ALL' && liquidity === 'PASS' && uTurn === 'CONFIRMED_OR_TRIGGER' && swingTier === 'ALL';
    }
    if (preset === 'FUND_SWING') {
      return sector === 'ALL' && delivery === 'UNION' && liquidity === 'PASS' && swingTier === 'ANY_SWING' && fundamental === 'PASS_4';
    }
    if (preset === 'IPO_WATCH') {
      return sector === 'IPO / Recent Listings' && liquidity === 'PASS' && swingTier === 'ALL' && uTurn === 'ALL';
    }
    if (preset === 'TOP_WARN') {
      return sector === 'ALL' && liquidity === 'PASS' && uTurn === 'TOP_CONFIRMED_OR_TRIGGER';
    }
    return false;
  };

  return (
    <div className="space-y-4">
      {/* 1-Click Stock Selection Playbook */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Quick Stock Picker — 1-Click Strategy Presets
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Step 1: Pick a strategy below · Step 2: Check Fundamentals (&gt;=4/7) &amp; Latest Freshness · Step 3: Open stock for U-Turn Zone &amp; ATR Stop · Step 4: Send to Risk Sizer
            </p>
          </div>
          <button
            type="button"
            onClick={() => applyPreset('RESET')}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline self-start lg:self-auto whitespace-nowrap"
          >
            Reset to Default View
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            {
              key: 'SWING_T1' as const,
              label: '1. Best Swing Breakout (T1 Ready)',
              desc: 'Delivery A/B + EMA21 + RVOL > 1.5x',
            },
            {
              key: 'UTURN_READY' as const,
              label: '2. U-Turn Support Ready / Trigger',
              desc: 'Price in Target Zone + Deliv >= 60% + RVOL >= 1.5x',
            },
            {
              key: 'FUND_SWING' as const,
              label: '3. Strong Fundamentals + Swing',
              desc: '>= 4/7 Fundamental Gates + Swing Setup',
            },
            {
              key: 'IPO_WATCH' as const,
              label: '4. IPO Active Watch (Liquid)',
              desc: 'Recent NSE Listings sorted by RVOL',
            },
            {
              key: 'TOP_WARN' as const,
              label: '5. Turnaround Top (Book Profit Alert)',
              desc: 'EPS Peak Exhaustion + Weak Delivery',
            },
          ].map((p) => {
            const active = isPresetActive(p.key);
            return (
              <button
                key={p.key}
                type="button"
                title={p.desc}
                onClick={() => applyPreset(p.key)}
                className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* T1 / T2 / T3 Specification Reference */}
      <SwingTierSpecPanel defaultOpen={true} />

      {/* Filter Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
          <div className="relative flex-1 w-full md:max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setOffset(0);
                setQ(e.target.value);
              }}
              placeholder="Filter symbol or sector (e.g., 360ONE, Financial)..."
              className="w-full min-h-[38px] pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono transition-all duration-300 ${
                loading
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : justRefreshed
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  loading
                    ? 'bg-blue-600 animate-ping'
                    : justRefreshed
                      ? 'bg-emerald-600'
                      : 'bg-slate-400'
                }`}
              />
              <span>
                {total.toLocaleString()} matching · EOD {latestDate || '—'}
              </span>
              {loading ? (
                <span className="text-blue-700 font-medium">· Syncing</span>
              ) : justRefreshed ? (
                <span className="text-emerald-700 font-semibold">· EOD Updated</span>
              ) : lastRefreshedAt ? (
                <span className="hidden sm:inline text-slate-400">· {lastRefreshedAt}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => {
                setOffset(0);
                const next = !watchlistOnly;
                setWatchlistOnly(next);
                if (next) {
                  setDelivery('ALL');
                  setLiquidity('ALL');
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                watchlistOnly
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  watchlistOnly ? 'text-amber-500 fill-amber-400' : 'text-slate-400'
                }`}
              />
              Starred ({watchlistSymbols?.size ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setOffset(0);
                const next = !upcomingResultsOnly;
                setUpcomingResultsOnly(next);
                if (next) {
                  setDelivery('ALL');
                  setLiquidity('ALL');
                  setSort('nextEarningsDate');
                  setDir('asc');
                } else if (sort === 'nextEarningsDate') {
                  setSort('rvol');
                  setDir('desc');
                }
              }}
              title="Filter to stocks with a scheduled upcoming quarterly result date (earliest result date first)"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                upcomingResultsOnly
                  ? 'bg-indigo-700 border-indigo-700 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Upcoming Results
            </button>
            <button
              type="button"
              onClick={() => void fetchLiveForRows(rows, true)}
              disabled={liveLoading || rows.length === 0}
              title="Check latest intraday live prices for visible scanner stocks and compare vs Scanner EOD close"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${liveLoading ? 'animate-spin' : ''}`} />
              {liveLoading ? 'Checking Live...' : 'Refresh Live Price'}
            </button>
            <button
              type="button"
              onClick={() => setT1T2ReportOpen(true)}
              title="Open memorized Daily T1 & T2 comparison (Kal vs Aaj + Daily Repeaters + IPO sector) and download full CSV"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              T1 &amp; T2 Daily Report
            </button>
            <a
              href="/api/reports/t1-t2/csv?live=1"
              download={`T1_T2_Daily_Report_${latestDate || 'latest'}.csv`}
              title="Download full daily T1 & T2 CSV report (all stocks including IPO sector, Today vs Yesterday & Repeaters)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Download T1+T2 CSV
            </a>
            <button
              onClick={handleBatchEnrich}
              disabled={batchFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${batchFetching ? 'animate-spin' : ''}`} />
              {batchFetching ? 'Collecting NSE+BSE+YF...' : 'Collect Missing (25)'}
            </button>
            <button
              onClick={handleExportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export Page CSV
            </button>
          </div>
        </div>

        {batchNotice && (
          <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {batchNotice}
          </div>
        )}

        {/* Capital Rotation Focus: Top 3 Best-Performing Sectors Visual Toggle */}
        {topSectors.length > 0 && (() => {
          const isTop3Active = sector === 'TOP_3_SECTORS';
          return (
            <div
              className={`flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-3.5 py-2.5 rounded-md border transition-colors ${
                isTop3Active
                  ? 'bg-emerald-50/70 border-emerald-300'
                  : 'bg-slate-50/70 border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isTop3Active}
                  onClick={() => {
                    setOffset(0);
                    onSectorChange(isTop3Active ? 'ALL' : 'TOP_3_SECTORS');
                  }}
                  className="inline-flex items-center gap-2.5 text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                >
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      isTop3Active ? 'bg-emerald-600' : 'bg-slate-300 group-hover:bg-slate-400'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                        isTop3Active ? 'translate-x-4.5' : 'translate-x-1'
                      }`}
                    />
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <Compass
                      className={`w-3.5 h-3.5 ${
                        isTop3Active ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    />
                    Top 3 Rotating Sectors Only
                  </span>
                </button>
                <span className="text-[11px] text-slate-500">
                  {isTop3Active
                    ? 'Filtering stocks in the 3 highest-ranked Sector Sentiment leaders'
                    : 'Toggle to focus strictly on the top 3 capital-rotation sectors'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {topSectors.map((sec, idx) => {
                  const selectedSingle = sector === sec.sector;
                  return (
                    <button
                      key={sec.sector}
                      type="button"
                      onClick={() => {
                        setOffset(0);
                        onSectorChange(selectedSingle ? 'ALL' : sec.sector);
                      }}
                      title={`${sec.sector} · Rotation Score ${sec.rotationScore}/100 · Breadth ${sec.breadthPct}% · 5D Avg ${
                        sec.avg5dReturnPct !== null ? `${sec.avg5dReturnPct >= 0 ? '+' : ''}${sec.avg5dReturnPct}%` : '—'
                      }`}
                      className={`px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap font-mono ${
                        selectedSingle
                          ? 'bg-slate-900 text-white border-slate-900 font-medium'
                          : isTop3Active
                            ? 'bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-100/60'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      <span className="opacity-70">#{idx + 1}</span> {sec.sector}{' '}
                      <span
                        className={
                          selectedSingle
                            ? 'text-emerald-300'
                            : sec.regime === 'LEADING'
                              ? 'text-emerald-700 font-semibold'
                              : 'text-blue-700 font-semibold'
                        }
                      >
                        ({sec.rotationScore})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Segmented Filter Groups */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-500">Sector:</span>
            <select
              value={sector}
              onChange={(e) => {
                const next = e.target.value;
                setOffset(0);
                onSectorChange(next);
                if (next === 'IPO / Recent Listings') {
                  setDelivery('ALL');
                  setLiquidity('ALL');
                }
              }}
              className="flex-1 sm:flex-none min-w-0 max-w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 sm:py-1 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Sectors</option>
              {topSectors.length > 0 && (
                <option value="TOP_3_SECTORS">Top 3 Best-Performing Sectors</option>
              )}
              {availableSectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">Swing Tier:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All', tip: 'Show all tiers' },
                { key: 'ANY_SWING', label: 'Any Tier', tip: 'T1 + T2 + T3 combined' },
                { key: 'T1_T2', label: 'T1+T2', tip: 'Tier 1 Ready + Tier 2 Accumulation combined' },
                {
                  key: 'TIER_1_READY',
                  label: 'T1 Ready',
                  tip: 'Breakout Ready: Liq>=1.5Cr + Deliv A/B + EMA21 + DelivQty>=1.2x + RVOL>1.5x + Green + RSI 45-78',
                },
                {
                  key: 'TIER_2_ACCUMULATION',
                  label: 'T2 Accum',
                  tip: 'Accumulation Watch: Liq>=1.5Cr + Deliv A/B + EMA21 + DelivQty>=1.2x (waiting for RVOL>1.5x breakout)',
                },
                {
                  key: 'TIER_3_RVOL_WATCH',
                  label: 'T3 RVOL',
                  tip: 'Early Volume Mover: Liq>=1.5Cr + RVOL>1.5x + Green close (not yet T1/T2)',
                },
              ].map((opt) => (
                <button
                  key={opt.key}
                  title={opt.tip}
                  onClick={() => {
                    setOffset(0);
                    setSwingTier(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    swingTier === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">Delivery 30D:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'UNION', label: 'A OR B' },
                { key: 'UNION_OR_RVOL', label: 'A/B or RVOL' },
                { key: 'A_AND_B', label: 'A_AND_B' },
                { key: 'A_ONLY', label: 'A_ONLY' },
                { key: 'B_ONLY', label: 'B_ONLY' },
                { key: 'ALL', label: 'All Mainboard' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    setDelivery(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    delivery === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">RVOL:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'HIGH', label: 'HIGH (>1.5x)' },
                { key: 'HIGH_OR_DELIV_EXP', label: 'RVOL>1.5 / Deliv>=1.2x' },
                { key: 'LOW', label: 'LOW' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    setRvol(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    rvol === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">Liquidity:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'PASS', label: 'PASS (>=1.5 Cr)' },
                { key: 'BELOW_MIN', label: 'Below Min' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    setLiquidity(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    liquidity === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">Fundamentals:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'VERIFIED_MUST', label: 'Verified Only (MUST)' },
                { key: 'STRONG_PASS', label: '>=5/7 Pass' },
                { key: 'PASS_4', label: '>=4/7 Pass' },
                { key: 'COMPLETE', label: 'Complete' },
                { key: 'PARTIAL_DATA', label: 'Partial' },
                { key: 'MISSING', label: 'Missing' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    setFundamental(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    fundamental === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Freshness:</span>
            <div className="inline-flex flex-wrap p-0.5 bg-slate-100 rounded-md">
              {(
                [
                  { key: 'ALL', label: 'All' },
                  { key: 'LATEST', label: 'Latest <=90d' },
                  { key: 'OLD_3M', label: '3M+ (91–548d)' },
                  { key: 'STALE', label: 'Stale (>548d)' },
                  { key: 'NOT_AVAILABLE', label: 'Abhi Mila Nahi' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    onFreshnessChange(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    freshness === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">U-Turn:</span>
            <div className="inline-flex flex-wrap p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'CONFIRMED_OR_TRIGGER', label: 'Ready / Trigger' },
                { key: 'CONFIRMED_SUPPORT', label: 'Confirmed' },
                { key: 'ACTIVE_TRIGGER', label: 'Active Trigger' },
                { key: 'SUPPORT_HOLD', label: 'Support Hold' },
                { key: 'IN_ZONE', label: 'In Zone ±2%' },
                { key: 'BROKEN_DOWN', label: 'Broken' },
                { key: 'TOP_CONFIRMED_OR_TRIGGER', label: 'Top Active/Conf' },
                { key: 'CONFIRMED_TOP', label: 'Top Conf' },
                { key: 'TOP_ZONE_WATCH', label: 'Top Zone' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    setUTurn(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    uTurn === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">Cap:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'LARGE_CAP', label: 'Large' },
                { key: 'MID_CAP', label: 'Mid' },
                { key: 'SMALL_CAP', label: 'Small' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setOffset(0);
                    setCap(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    cap === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-w-full">
            <span className="text-xs font-medium text-slate-500">EMA 21/44:</span>
            <div className="inline-flex flex-wrap max-w-full gap-0.5 p-0.5 bg-slate-100 rounded-md">
              {[
                { key: 'ALL', label: 'All', tip: 'Show all EMA trends' },
                {
                  key: 'BULLISH_ALIGNED',
                  label: '21 > 44 Bullish',
                  tip: 'EMA 21 above EMA 44 bullish alignment',
                },
                {
                  key: 'RECENT_CROSS',
                  label: '5D Crossover',
                  tip: 'Fresh bullish EMA 21 crossing above EMA 44 within last 5 sessions',
                },
                {
                  key: 'BELOW',
                  label: '21 < 44',
                  tip: 'EMA 21 below EMA 44',
                },
              ].map((opt) => (
                <button
                  key={opt.key}
                  title={opt.tip}
                  onClick={() => {
                    setOffset(0);
                    setEmaCross(opt.key);
                  }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    emaCross === opt.key
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Data Grid */}
      <div
        className={`bg-white border rounded-lg overflow-hidden transition-all duration-300 ${
          justRefreshed
            ? 'border-blue-300 ring-1 ring-blue-100'
            : loading && rows.length > 0
              ? 'border-blue-200'
              : 'border-slate-200'
        }`}
      >
        {/* Top Scan Sweep Progress Indicator */}
        <div
          className={`h-0.5 w-full overflow-hidden transition-opacity duration-200 ${
            loading ? 'bg-slate-100 opacity-100' : 'bg-transparent opacity-0'
          }`}
          aria-hidden={!loading}
        >
          {loading && <div className="h-full w-1/3 bg-blue-600 screener-scan-bar" />}
        </div>

        {/* Intraday Live Check vs Scanner EOD Validation Strip */}
        {rows.length > 0 && !error && (
          <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2 text-slate-700">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                <Activity className="w-3.5 h-3.5 text-blue-700" />
                {liveSummary.staleCount > 0 && liveSummary.liveCount === 0
                  ? `Kal EOD (${latestDate || 'Prev EOD'}) → Reference Quote:`
                  : `Kal EOD (${latestDate || 'Prev EOD'}) → Aaj Live:`}
                {liveSummary.staleCount > 0 && liveSummary.liveCount === 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-600 text-white">
                    STALE DATA
                  </span>
                )}
              </span>
              {liveLoading && liveSummary.availableCount === 0 ? (
                <span className="font-mono text-blue-700">
                  Fetching Yahoo live quotes for {rows.length} stocks...
                </span>
              ) : liveError ? (
                <span className="font-mono text-rose-700">{liveError}</span>
              ) : (
                <>
                  <span className="font-mono font-semibold text-emerald-700">
                    {liveSummary.upCount} Up (Right)
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono font-semibold text-rose-700">
                    {liveSummary.downCount} Down (Wrong)
                  </span>
                  {liveSummary.flatCount > 0 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-slate-600">
                        {liveSummary.flatCount} Flat
                      </span>
                    </>
                  )}
                  {liveSummary.rightPct !== null && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {liveSummary.rightPct.toFixed(0)}% Holding Above EOD
                      </span>
                    </>
                  )}
                  {liveSummary.avgMovePct !== null && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`font-mono font-semibold ${
                          liveSummary.avgMovePct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        Page Avg {liveSummary.avgMovePct >= 0 ? '+' : ''}
                        {liveSummary.avgMovePct.toFixed(2)}% vs EOD
                      </span>
                    </>
                  )}
                  {liveSummary.staleCount > 0 && liveSummary.liveCount > 0 && (
                    <span className="font-mono text-rose-700 font-semibold">
                      · {liveSummary.staleCount} Stale
                    </span>
                  )}
                  {liveSummary.unavailableCount > 0 && (
                    <span className="font-mono text-amber-700">
                      · {liveSummary.unavailableCount} N/A
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="font-mono text-slate-500">
              Scanner rules = EOD Bhavcopy · Live Check = Yahoo Finance
              {liveCheckedAt ? ` @ ${liveCheckedAt}` : ''}
            </div>
          </div>
        )}

        {error ? (
          <div className="p-8 text-center text-xs space-y-3">
            <div className="text-rose-700 font-mono">{error}</div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRefreshTick((t) => t + 1);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Screener Load
            </button>
          </div>
        ) : (
          <>
          {/* Mobile Card List (md:hidden) */}
          <div className="md:hidden divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="p-3.5 animate-pulse space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-1/3" />
                  <div className="h-3 bg-slate-100 rounded w-2/3" />
                </div>
              ))
            ) : rows.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No stocks match the selected pipeline filters. Try broadening one of the filters above.
              </div>
            ) : (
              rows.map((row) => {
                const liveQ = liveQuotes[row.symbol];
                const hasLive = Boolean(liveQ?.available && liveQ.livePrice !== null);
                const livePct =
                  hasLive && liveQ?.livePrice !== null && row.closePrice > 0
                    ? ((liveQ.livePrice - row.closePrice) / row.closePrice) * 100
                    : null;
                return (
                  <div
                    key={`m-${row.symbol}`}
                    onClick={() => onSelectSymbol(row.symbol)}
                    className="p-3.5 active:bg-slate-50 transition-colors space-y-2 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {onToggleWatchlist && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleWatchlist(row.symbol);
                              }}
                              aria-label={watchlistSymbols?.has(row.symbol) ? 'Unstar' : 'Star'}
                              className="p-1 -ml-1 rounded"
                            >
                              <Star
                                className={`w-4 h-4 ${
                                  watchlistSymbols?.has(row.symbol)
                                    ? 'text-amber-500 fill-amber-400'
                                    : 'text-slate-300'
                                }`}
                              />
                            </button>
                          )}
                          <span className="font-mono font-bold text-sm text-blue-700">
                            {row.symbol}
                          </span>
                          {getCapShortLabel(row.marketCapCategory) && (
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                                row.marketCapCategory
                              )}`}
                            >
                              {getCapShortLabel(row.marketCapCategory)}
                            </span>
                          )}
                          {row.isIpo && (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                              IPO
                            </span>
                          )}
                          {row.ema21Cross44Bullish ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              21×44
                            </span>
                          ) : row.ema21AboveEma44 ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50/70 text-emerald-700 border border-emerald-200 rounded">
                              21&gt;44
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                          {row.deliveryCategory}
                          {row.providerSector ? ` · ${row.providerSector}` : ''}
                        </div>
                      </div>

                      <div className="text-right font-mono shrink-0">
                        <div className="font-bold text-sm text-slate-900">
                          ₹{row.closePrice.toFixed(2)}
                        </div>
                        {hasLive && liveQ?.livePrice !== null ? (() => {
                          const mobileFreshness = evaluateQuoteFreshness({
                            lastUpdated: liveQ.lastUpdated,
                            marketTimeUnixSec: liveQ.marketTimestampSec,
                            marketTimeIst: liveQ.marketTimeIst,
                            marketDateIst: liveQ.marketDateIst,
                            marketState: liveQ.marketState,
                          });
                          return (
                            <div
                              className={`text-[11px] font-semibold inline-flex flex-wrap items-center justify-end gap-1 ${
                                mobileFreshness.isStale
                                  ? 'text-slate-600'
                                  : (livePct ?? 0) >= 0
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                              }`}
                            >
                              {mobileFreshness.isLive && (
                                <span className="inline-flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span>Live</span>
                                </span>
                              )}
                              <span>
                                ₹{liveQ.livePrice.toFixed(2)} ({(livePct ?? 0) >= 0 ? '+' : ''}
                                {livePct?.toFixed(2)}%)
                              </span>
                              {mobileFreshness.badgeLabel && (
                                <span
                                  className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase text-white ${
                                    mobileFreshness.isStale ? 'bg-rose-600' : 'bg-slate-600'
                                  }`}
                                >
                                  {mobileFreshness.badgeLabel}
                                </span>
                              )}
                            </div>
                          );
                        })() : (
                          <div
                            className={`text-[11px] ${
                              (row.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {row.changePct !== null
                              ? `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`
                              : '—'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono bg-slate-50 border border-slate-100 rounded p-2">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Tier</span>
                        <span
                          className={
                            row.swingTier === 'TIER_1_READY'
                              ? 'text-emerald-700 font-semibold'
                              : row.swingTier === 'TIER_2_ACCUMULATION'
                                ? 'text-blue-700 font-medium'
                                : 'text-slate-700'
                          }
                        >
                          {row.swingTier === 'TIER_1_READY'
                            ? 'T1'
                            : row.swingTier === 'TIER_2_ACCUMULATION'
                              ? 'T2'
                              : row.swingTier === 'TIER_3_RVOL_WATCH'
                                ? 'T3'
                                : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">RVOL</span>
                        <span className="font-semibold text-slate-900">
                          {row.rvol !== null ? `${row.rvol.toFixed(2)}x` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Deliv %</span>
                        <span className="font-semibold text-slate-900">
                          {row.delivPer !== null ? `${row.delivPer.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Fund</span>
                        <span className="font-semibold text-slate-900">
                          {row.fundamentalPassCount}/7
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium select-none">
                  <th
                    onClick={() => handleSort('symbol')}
                    className="py-2.5 px-4 cursor-pointer hover:text-slate-900"
                  >
                    Symbol <SortIcon col="symbol" />
                  </th>
                  <th className="py-2.5 px-3">Swing Tier</th>
                  <th
                    onClick={() => handleSort('close')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                    title="Previous NSE Bhavcopy EOD Close (scanner basis)"
                  >
                    Scanner EOD (₹) <SortIcon col="close" />
                  </th>
                  <th
                    onClick={() => handleSort('changePct')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                    title="NSE EOD session % change"
                  >
                    EOD Chg % <SortIcon col="changePct" />
                  </th>
                  <th
                    className="py-2.5 px-3 text-right whitespace-nowrap"
                    title="Current live price & intraday % move vs Scanner EOD Close"
                  >
                    Live Price &amp; Vs EOD
                  </th>
                  <th
                    onClick={() => handleSort('rvol')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  >
                    RVOL <SortIcon col="rvol" />
                  </th>
                  <th
                    onClick={() => handleSort('delivPer')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  >
                    Deliv % <SortIcon col="delivPer" />
                  </th>
                  <th
                    onClick={() => handleSort('delivQtyRatio')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  >
                    DelivQty Ratio <SortIcon col="delivQtyRatio" />
                  </th>
                  <th
                    onClick={() => handleSort('rsi14')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  >
                    RSI(14) <SortIcon col="rsi14" />
                  </th>
                  <th
                    onClick={() => handleSort('atrPct')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  >
                    ATR % <SortIcon col="atrPct" />
                  </th>
                  <th className="py-2.5 px-3">Trend (EMA 21/44)</th>
                  <th
                    onClick={() => handleSort('turnover')}
                    className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  >
                    20D Avg Turn <SortIcon col="turnover" />
                  </th>
                  <th
                    onClick={() => handleSort('uTurn')}
                    className="py-2.5 px-3 cursor-pointer hover:text-slate-900"
                  >
                    U-Turn <SortIcon col="uTurn" />
                  </th>
                  <th
                    onClick={() => handleSort('fundamental')}
                    className="py-2.5 px-3 cursor-pointer hover:text-slate-900"
                  >
                    Fundamentals <SortIcon col="fundamental" />
                  </th>
                  <th
                    onClick={() => handleSort('freshness')}
                    className="py-2.5 px-4 cursor-pointer hover:text-slate-900"
                  >
                    Freshness &amp; Remarks <SortIcon col="freshness" />
                  </th>
                </tr>
              </thead>
              <tbody
                className={`divide-y divide-slate-100 transition-opacity duration-200 ${
                  loading && rows.length > 0 ? 'opacity-50 pointer-events-none' : 'opacity-100'
                }`}
              >
                {loading && rows.length === 0 ? (
                  Array.from({ length: 10 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td colSpan={15} className="py-3 px-4">
                        <div className="h-3.5 bg-slate-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="py-10 text-center text-slate-500">
                      No stocks match the selected pipeline filters. Try broadening one of the filters above.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr
                      key={`${dataRenderSeq}-${row.symbol}`}
                      style={{ animationDelay: `${Math.min(idx * 14, 210)}ms` }}
                      onClick={() => onSelectSymbol(row.symbol)}
                      className={`hover:bg-slate-50 cursor-pointer transition-colors duration-200 ${
                        justRefreshed ? 'screener-row-flash' : 'screener-row-enter'
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          {onToggleWatchlist && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleWatchlist(row.symbol);
                              }}
                              aria-label={
                                watchlistSymbols?.has(row.symbol)
                                  ? `Unstar ${row.symbol} from Watchlist`
                                  : `Star ${row.symbol} to Watchlist`
                              }
                              title={
                                watchlistSymbols?.has(row.symbol)
                                  ? 'Remove from Watchlist'
                                  : 'Add to Watchlist'
                              }
                              className="p-0.5 rounded hover:bg-slate-100 shrink-0"
                            >
                              <Star
                                className={`w-3.5 h-3.5 transition-colors ${
                                  watchlistSymbols?.has(row.symbol)
                                    ? 'text-amber-500 fill-amber-400'
                                    : 'text-slate-300 hover:text-amber-500'
                                }`}
                              />
                            </button>
                          )}
                          <span className="font-mono font-semibold text-blue-700">{row.symbol}</span>
                          {getCapShortLabel(row.marketCapCategory) && (
                            <span
                              title={
                                row.marketCapCr
                                  ? `Market Cap: ₹${row.marketCapCr.toLocaleString('en-IN')} Cr (${row.marketCapCategory.replace('_', ' ')})`
                                  : row.marketCapCategory
                              }
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded whitespace-nowrap ${getCapBadgeClass(
                                row.marketCapCategory
                              )}`}
                            >
                              {getCapShortLabel(row.marketCapCategory)}
                            </span>
                          )}
                          {row.isIpo && (
                            <span
                              title={`IPO Listed ${row.listingDate} (${row.sessionsCount} sessions)`}
                              className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded whitespace-nowrap"
                            >
                              IPO · {row.sessionsCount}d
                            </span>
                          )}
                          {row.nextEarningsDate && (
                            <span
                              title={`Upcoming Quarterly Result Date: ${row.nextEarningsDate}`}
                              className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded whitespace-nowrap"
                            >
                              Res: {row.nextEarningsDate}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {row.deliveryCategory}
                          {row.providerSector ? ` · ${row.providerSector}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <span
                          title={
                            row.swingTier === 'TIER_1_READY'
                              ? 'T1_READY: Liq + Deliv A/B + EMA21 + DelivQty>=1.2x + RVOL>1.5x + Green + RSI 45-78'
                              : row.swingTier === 'TIER_2_ACCUMULATION'
                                ? 'T2_ACCUM: Liq + Deliv A/B + EMA21 + DelivQty>=1.2x (Waiting for RVOL breakout)'
                                : row.swingTier === 'TIER_3_RVOL_WATCH'
                                  ? 'T3_RVOL: Liq + RVOL>1.5x + Green (No Deliv A/B or EMA21 yet)'
                                  : 'Does not meet T1/T2/T3 swing criteria'
                          }
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
                          {row.swingTier === 'TIER_1_READY'
                            ? 'T1_READY'
                            : row.swingTier === 'TIER_2_ACCUMULATION'
                              ? 'T2_ACCUM'
                              : row.swingTier === 'TIER_3_RVOL_WATCH'
                                ? 'T3_RVOL'
                                : '—'}
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
                          if (!lq) {
                            return <span className="text-slate-400">—</span>;
                          }
                          if (!lq.available || lq.livePrice === null) {
                            return (
                              <span
                                className="text-[10px] font-medium text-amber-700"
                                title={lq.note}
                              >
                                DATA NOT AVAILABLE
                              </span>
                            );
                          }
                          const diffInr = lq.livePrice - row.closePrice;
                          const diffPct =
                            row.closePrice > 0 ? (diffInr / row.closePrice) * 100 : null;
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
                                lq.dayLow !== null && lq.dayHigh !== null
                                  ? ` · Day L/H ₹${lq.dayLow.toFixed(2)}–₹${lq.dayHigh.toFixed(2)}`
                                  : ''
                              }${lq.marketTimeIst ? ` · ${lq.marketTimeIst}` : ''}`}
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
                      <td className="py-2.5 px-3 text-right font-mono text-slate-900">
                        {row.delivPer !== null ? `${row.delivPer.toFixed(1)}%` : '—'}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono ${
                          (row.delivQtyRatio ?? 0) >= 1.5
                            ? 'text-emerald-700 font-semibold'
                            : 'text-slate-700'
                        }`}
                      >
                        {row.delivQtyRatio !== null ? `${row.delivQtyRatio.toFixed(2)}x` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {row.rsi14 !== null ? row.rsi14.toFixed(1) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {row.atrPct !== null ? `${row.atrPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                        <div>
                          {row.aboveEma21 === null ? (
                            <span className="text-slate-400">—</span>
                          ) : row.aboveEma21 ? (
                            <span className="text-emerald-700 font-medium">Above 21</span>
                          ) : (
                            <span className="text-rose-700">Below 21</span>
                          )}
                        </div>
                        {row.ema21Cross44Bullish ? (
                          <div
                            title={`Bullish EMA 21 crossed above EMA 44 (${row.ema21Cross44DaysAgo ?? 0}d ago)`}
                            className="text-[10px] font-semibold text-emerald-700"
                          >
                            21×44 Cross ({row.ema21Cross44DaysAgo ?? 0}d)
                          </div>
                        ) : row.ema21AboveEma44 === true ? (
                          <div className="text-[10px] text-emerald-600">21 &gt; 44 Bullish</div>
                        ) : row.ema21AboveEma44 === false ? (
                          <div className="text-[10px] text-slate-400">21 &lt; 44</div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {row.avgTurnover20DCr !== null
                          ? `₹${row.avgTurnover20DCr.toFixed(2)} Cr`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                        {(() => {
                          const isTopFilter =
                            uTurn === 'TOP_CONFIRMED_OR_TRIGGER' ||
                            uTurn === 'CONFIRMED_TOP' ||
                            uTurn === 'ACTIVE_TOP_TRIGGER' ||
                            uTurn === 'TOP_ZONE_WATCH' ||
                            uTurn === 'TOP_BREAKOUT' ||
                            uTurn === 'BELOW_TOP_ZONE';
                          const showTopPrimary =
                            isTopFilter ||
                            (row.topTurnStatus &&
                              (row.topTurnStatus === 'CONFIRMED_TOP' ||
                                row.topTurnStatus === 'ACTIVE_TOP_TRIGGER' ||
                                row.topTurnStatus === 'TOP_ZONE_WATCH') &&
                              row.uTurnStatus !== 'CONFIRMED_SUPPORT' &&
                              row.uTurnStatus !== 'ACTIVE_TRIGGER');

                          if (showTopPrimary && row.topTurnStatus) {
                            return (
                              <div>
                                <div
                                  className={
                                    row.topTurnStatus === 'CONFIRMED_TOP'
                                      ? 'text-rose-700 font-semibold'
                                      : row.topTurnStatus === 'ACTIVE_TOP_TRIGGER'
                                        ? 'text-amber-700 font-semibold'
                                        : row.topTurnStatus === 'TOP_ZONE_WATCH'
                                          ? 'text-amber-600 font-medium'
                                          : row.topTurnStatus === 'TOP_BREAKOUT'
                                            ? 'text-emerald-700 font-medium'
                                            : 'text-slate-400'
                                  }
                                >
                                  {row.topTurnStatus === 'CONFIRMED_TOP'
                                    ? 'TOP_CONF'
                                    : row.topTurnStatus === 'ACTIVE_TOP_TRIGGER'
                                      ? 'TOP_TRIG'
                                      : row.topTurnStatus === 'TOP_ZONE_WATCH'
                                        ? 'TOP_ZONE'
                                        : row.topTurnStatus === 'TOP_BREAKOUT'
                                          ? 'TOP_BRK'
                                          : 'BELOW_TOP'}
                                </div>
                                {row.topTurnTarget !== null && (
                                  <div className="text-[10px] text-slate-400">
                                    ₹{row.topTurnTarget.toFixed(0)} (
                                    {row.topTurnDistPct !== null
                                      ? `${row.topTurnDistPct >= 0 ? '+' : ''}${row.topTurnDistPct.toFixed(1)}%`
                                      : '—'}
                                    ) · EPS×PE
                                  </div>
                                )}
                              </div>
                            );
                          }

                          if (row.uTurnStatus) {
                            return (
                              <div>
                                <div
                                  className={
                                    row.uTurnStatus === 'CONFIRMED_SUPPORT'
                                      ? 'text-emerald-700 font-semibold'
                                      : row.uTurnStatus === 'ACTIVE_TRIGGER'
                                        ? 'text-blue-700 font-semibold'
                                        : row.uTurnStatus === 'SUPPORT_HOLD'
                                          ? 'text-teal-700 font-medium'
                                          : row.uTurnStatus === 'IN_ZONE'
                                            ? 'text-amber-700'
                                            : row.uTurnStatus === 'BROKEN_DOWN'
                                              ? 'text-rose-700'
                                              : 'text-slate-400'
                                  }
                                >
                                  {row.uTurnStatus === 'CONFIRMED_SUPPORT'
                                    ? 'CONFIRMED'
                                    : row.uTurnStatus === 'ACTIVE_TRIGGER'
                                      ? 'TRIGGER'
                                      : row.uTurnStatus === 'SUPPORT_HOLD'
                                        ? 'SUPP_HOLD'
                                        : row.uTurnStatus === 'IN_ZONE'
                                          ? 'IN_ZONE'
                                          : row.uTurnStatus === 'BROKEN_DOWN'
                                            ? 'BROKEN'
                                            : 'ABOVE'}
                                </div>
                                {row.uTurnTarget !== null && (
                                  <div className="text-[10px] text-slate-400">
                                    ₹{row.uTurnTarget.toFixed(0)} (
                                    {row.uTurnDistPct !== null
                                      ? `${row.uTurnDistPct >= 0 ? '+' : ''}${row.uTurnDistPct.toFixed(1)}%`
                                      : '—'}
                                    ){row.uTurnBasis === 'EPS_PE' ? ' · EPS×PE' : ''}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return <span className="text-slate-400">—</span>;
                        })()}
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                        <div>
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
                        </div>
                        <div
                          className={`text-[10px] mt-0.5 ${
                            row.fundamentalVerified
                              ? 'text-emerald-700 font-semibold'
                              : 'text-amber-700'
                          }`}
                        >
                          {row.fundamentalVerified ? 'VERIFIED (2Q EPS+PE)' : 'Verify EPS/PE'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 min-w-[230px]">
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span
                            className={
                              row.fundamentalFreshness === 'LATEST'
                                ? 'text-emerald-700 font-semibold'
                                : row.fundamentalFreshness === 'OLD_3M'
                                  ? 'text-amber-700 font-semibold'
                                  : row.fundamentalFreshness === 'STALE'
                                    ? 'text-orange-700 font-semibold'
                                    : 'text-rose-700 font-semibold'
                            }
                          >
                            {row.fundamentalFreshness === 'LATEST'
                              ? 'LATEST <=90d'
                              : row.fundamentalFreshness === 'OLD_3M'
                                ? '3M+ OLD'
                                : row.fundamentalFreshness === 'STALE'
                                  ? 'STALE (>MAX AGE)'
                                  : 'ABHI MILA NAHI'}
                          </span>
                          {row.fundamentalAgeDays !== null && (
                            <span className="text-slate-400">· {row.fundamentalAgeDays}d</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600 line-clamp-2" title={row.fundamentalRemark}>
                          {row.fundamentalRemark}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </>
        )}

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono">
            Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of{' '}
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={offset === 0}
              className="px-3 py-1 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset((o) => o + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <T1T2DailyReportModal
        open={t1T2ReportOpen}
        onClose={() => setT1T2ReportOpen(false)}
        onSelectSymbol={onSelectSymbol}
      />
    </div>
  );
};
