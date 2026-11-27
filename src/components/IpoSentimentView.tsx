import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Database,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  BotStockAnalysis,
  FundamentalFreshness,
  IpoOverviewData,
  ScreenerRow,
} from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { authFetch } from '../utils/authClient';
import { SwingTierSpecPanel } from './SwingTierSpecPanel';

interface IpoSentimentViewProps {
  onSelectSymbol: (symbol: string) => void;
  onReloadOverview: () => Promise<void>;
  externalReloadSeq?: number;
}

type AgeFilter = 'ALL_1Y' | 'UNDER_3M' | 'UNDER_6M';
type UTurnFilter = 'ALL' | 'CONFIRMED_OR_TRIGGER' | 'IN_ZONE' | 'TOP_WARN';
type DeliveryFilter = 'ALL' | 'UNION' | 'A_AND_B' | 'A_ONLY' | 'B_ONLY';
type FreshnessFilter = 'ALL' | FundamentalFreshness;
type SortKey = 'uTurn' | 'rvol' | 'delivPer' | 'ipoAge' | 'close' | 'changePct' | 'turnover';

export const IpoSentimentView: React.FC<IpoSentimentViewProps> = ({
  onSelectSymbol,
  onReloadOverview,
  externalReloadSeq = 0,
}) => {
  const [data, setData] = useState<IpoOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingIpos, setSyncingIpos] = useState(false);
  const [savingMissing, setSavingMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [ageFilter, setAgeFilter] = useState<AgeFilter>('ALL_1Y');
  const [uTurnFilter, setUTurnFilter] = useState<UTurnFilter>('ALL');
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('ALL');
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('uTurn');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [botIpoItems, setBotIpoItems] = useState<BotStockAnalysis[]>([]);
  const [botIpoLoading, setBotIpoLoading] = useState(true);
  const [botIpoError, setBotIpoError] = useState<string | null>(null);

  const fetchIpoOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ipo/overview');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message || 'Failed to load IPO Sentiment & Analysis');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBotIpoScan = useCallback(async (forceRefresh = false) => {
    setBotIpoLoading(true);
    setBotIpoError(null);
    try {
      const res = await fetch(`/api/bot/daily-scan?scope=IPO&limit=12${forceRefresh ? '&refresh=1' : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setBotIpoItems(json.items || []);
    } catch (err) {
      setBotIpoError((err as Error).message || 'Failed to run v3 IPO Bot scan');
    } finally {
      setBotIpoLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIpoOverview();
    void fetchBotIpoScan(false);
  }, [fetchIpoOverview, fetchBotIpoScan, externalReloadSeq]);

  const handleSyncIpoUniverse = async () => {
    setSyncingIpos(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/catalysts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ background: false }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchIpoOverview();
      await onReloadOverview();
      setNotice(
        `Scanned ${json.scan?.total ?? 'all'} NSE symbols for first-trade IPO dates (<1 year: ${json.scan?.ipoUnder1yCount ?? 0} identified) & upcoming 3M results.`
      );
    } catch (err) {
      setNotice(`IPO scan failed: ${(err as Error).message}`);
    } finally {
      setSyncingIpos(false);
    }
  };

  const handleSaveAllMissingFundamentals = async () => {
    setSavingMissing(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/fundamentals/save-to-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveAll: true, scope: 'MISSING_OR_OLD' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNotice(
        json.started
          ? `Started background save-to-cache across ${json.total} missing/old Tier 1–3 selected symbols.`
          : json.message || 'All Tier 1–3 fundamentals are already cached.'
      );
    } catch (err) {
      setNotice(`Save failed: ${(err as Error).message}`);
    } finally {
      setSavingMissing(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toUpperCase();
    const list = data.rows.filter((r) => {
      if (q && !r.symbol.includes(q) && !(r.companyName || '').toUpperCase().includes(q)) {
        return false;
      }
      const age = r.ipoAgeDays ?? null;
      if (ageFilter === 'UNDER_3M' && age !== null && age > 90) return false;
      if (ageFilter === 'UNDER_6M' && age !== null && age > 180) return false;

      if (deliveryFilter === 'UNION') {
        if (
          r.deliveryCategory !== 'A_AND_B' &&
          r.deliveryCategory !== 'A_ONLY' &&
          r.deliveryCategory !== 'B_ONLY'
        ) {
          return false;
        }
      } else if (deliveryFilter !== 'ALL' && r.deliveryCategory !== deliveryFilter) {
        return false;
      }

      if (freshnessFilter !== 'ALL' && r.fundamentalFreshness !== freshnessFilter) {
        return false;
      }

      if (uTurnFilter === 'CONFIRMED_OR_TRIGGER') {
        if (r.uTurnStatus !== 'CONFIRMED_SUPPORT' && r.uTurnStatus !== 'ACTIVE_TRIGGER') {
          return false;
        }
      } else if (uTurnFilter === 'IN_ZONE') {
        if (
          r.uTurnStatus !== 'IN_ZONE' &&
          r.uTurnStatus !== 'SUPPORT_HOLD' &&
          r.uTurnStatus !== 'CONFIRMED_SUPPORT' &&
          r.uTurnStatus !== 'ACTIVE_TRIGGER'
        ) {
          return false;
        }
      } else if (uTurnFilter === 'TOP_WARN') {
        if (r.topTurnStatus !== 'CONFIRMED_TOP' && r.topTurnStatus !== 'ACTIVE_TOP_TRIGGER') {
          return false;
        }
      }

      return true;
    });

    const mul = sortDir === 'asc' ? 1 : -1;
    const uRank: Record<string, number> = {
      CONFIRMED_SUPPORT: 5,
      ACTIVE_TRIGGER: 4,
      SUPPORT_HOLD: 3,
      IN_ZONE: 2,
      ABOVE_ZONE: 1,
      BROKEN_DOWN: 0,
    };

    return [...list].sort((a, b) => {
      let va = 0;
      let vb = 0;
      switch (sortKey) {
        case 'rvol':
          va = a.rvol ?? -1;
          vb = b.rvol ?? -1;
          break;
        case 'delivPer':
          va = a.delivPer ?? -1;
          vb = b.delivPer ?? -1;
          break;
        case 'ipoAge':
          va = a.ipoAgeDays ?? 9999;
          vb = b.ipoAgeDays ?? 9999;
          break;
        case 'close':
          va = a.closePrice;
          vb = b.closePrice;
          break;
        case 'changePct':
          va = a.changePct ?? -999;
          vb = b.changePct ?? -999;
          break;
        case 'turnover':
          va = a.avgTurnover20DCr ?? -1;
          vb = b.avgTurnover20DCr ?? -1;
          break;
        case 'uTurn':
        default:
          va = (a.uTurnStatus ? uRank[a.uTurnStatus] ?? -1 : -1) * 100 + (a.rvol ?? 0);
          vb = (b.uTurnStatus ? uRank[b.uTurnStatus] ?? -1 : -1) * 100 + (b.rvol ?? 0);
          break;
      }
      return mul * (va - vb);
    });
  }, [data, searchQuery, ageFilter, deliveryFilter, freshnessFilter, uTurnFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const renderAuditStatusText = (row: ScreenerRow) => {
    if (row.fundamentalFreshness === 'LATEST') {
      return (
        <span className="text-emerald-700 font-medium">
          Latest (&lt;3M){row.fundamentalAgeDays !== null ? ` · ${row.fundamentalAgeDays}d` : ''}
        </span>
      );
    }
    if (row.fundamentalFreshness === 'OLD_3M') {
      return (
        <span className="text-amber-700 font-medium">
          3M–Max Age{row.fundamentalAgeDays !== null ? ` · ${row.fundamentalAgeDays}d` : ''}
        </span>
      );
    }
    if (row.fundamentalFreshness === 'STALE') {
      return (
        <span className="text-rose-700 font-medium">
          Stale (&gt;Max Age){row.fundamentalAgeDays !== null ? ` · ${row.fundamentalAgeDays}d` : ''}
        </span>
      );
    }
    return <span className="text-rose-700">Unverified</span>;
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
        Loading IPO (&lt; 1 Year) U-Turn, Delivery A/B &amp; Fundamental Audit metrics...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-rose-700">
        {error || 'Unable to load IPO Sentiment & Analysis.'}
      </div>
    );
  }

  const { sentiment, stats } = data;
  const isBull = sentiment.status === 'BULLISH';
  const isBear = sentiment.status === 'BEARISH';
  const SentimentIcon = isBull ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900">
              IPO Sentiment &amp; Analysis (&lt; 1 Year Mainboard Listings)
            </h2>
            <span className="text-xs font-mono text-slate-500">EOD {data.asOfDate}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Applies identical V8 Delivery A/B institutional flow, 20D RVOL, U-Turn entry zones, Turnaround Top exits, and Fundamental Audit freshness to stocks listed within 365 days.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleSaveAllMissingFundamentals}
            disabled={savingMissing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
          >
            <Database className="w-3.5 h-3.5" />
            {savingMissing ? 'Starting Cache Save...' : 'Save Tier 1–3 Fundamentals'}
          </button>
          <button
            type="button"
            onClick={handleSyncIpoUniverse}
            disabled={syncingIpos}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingIpos ? 'animate-spin' : ''}`} />
            {syncingIpos ? 'Scanning All NSE First-Trade Dates...' : 'Scan All NSE IPOs (<1Y)'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-blue-700 hover:underline font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* IPO Sentiment & Strategy KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>IPO Cohort Sentiment</span>
            <SentimentIcon
              className={`w-4 h-4 ${
                isBull ? 'text-emerald-600' : isBear ? 'text-rose-600' : 'text-amber-600'
              }`}
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                isBull ? 'text-emerald-700' : isBear ? 'text-rose-700' : 'text-amber-700'
              }`}
            >
              {sentiment.score}/100
            </span>
            <span className="text-xs font-mono font-semibold text-slate-700">{sentiment.status}</span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
            {sentiment.advancers} Adv / {sentiment.decliners} Dec · Deliv Accum{' '}
            {sentiment.deliveryAccumPct.toFixed(0)}%
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Listed &lt; 1 Year Breakdown</div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {stats.totalIpos}
            </span>
            <span className="text-xs font-mono text-emerald-700 tabular-nums">
              {stats.liquidCount} Liquid (&gt;=₹1.5Cr)
            </span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
            &lt;3M: {stats.under3mCount} · &lt;6M: {stats.under6mCount} · &lt;1Y: {stats.under1yCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Delivery A/B &amp; U-Turn Signals</div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-blue-700">
              {stats.uTurnReadyCount}
            </span>
            <span className="text-xs font-mono text-slate-600 tabular-nums">
              U-Turn Trigger/Confirmed
            </span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
            Deliv A/B: {stats.deliveryABCount} · High RVOL: {stats.highRvolCount} · Top Warn:{' '}
            {stats.topTurnWarnCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">IPO Fundamental Audit Freshness</div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-emerald-700">
              {stats.auditUnder1m + stats.audit1To3m}
            </span>
            <span className="text-xs font-mono text-slate-600 tabular-nums">
              Verified &lt;= 3 Months
            </span>
          </div>
          <div className="mt-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
            &lt;1M: {stats.auditUnder1m} · 1–3M: {stats.audit1To3m} · Unverified:{' '}
            {stats.auditUnverified}
          </div>
        </div>
      </div>

      {/* Cohort Assessment Line */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
        <span>{sentiment.summary}</span>
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          Above EMA21: {sentiment.aboveEma21Pct.toFixed(1)}% · Avg Deliv:{' '}
          {sentiment.avgDeliveryPct.toFixed(1)}% · High-RVOL Up/Dn: {sentiment.highRvolUp}/
          {sentiment.highRvolDown}
        </span>
      </div>

      {/* v3 Bot IPO Sector Scan (<1Y Cohort) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                v3 Bot IPO Sector Scan (&lt;1Y Cohort · {botIpoItems.length} Ranked)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Applies Phase 1–8 v3 Bot scoring (Piotroski, Graham/DCF, Burst Power, EMA 21/44 Crossover, 30D Bulk/Block Sentiment &amp; ATR Risk) across active IPO listings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchBotIpoScan(true)}
            disabled={botIpoLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-md"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${botIpoLoading ? 'animate-spin' : ''}`} />
            {botIpoLoading ? 'Scanning IPOs...' : 'Refresh v3 IPO Bot'}
          </button>
        </div>

        {botIpoError ? (
          <div className="p-4 text-xs text-rose-700 bg-rose-50">{botIpoError}</div>
        ) : botIpoLoading && botIpoItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Running v3 Swing Bot Phase 1–8 evaluation across recent IPO listings...
          </div>
        ) : botIpoItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No active &lt;1Y IPO candidates returned from v3 Bot scan yet. Click &ldquo;Scan All NSE IPOs (&lt;1Y)&rdquo; above first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <th className="py-2 px-4">IPO Symbol</th>
                  <th className="py-2 px-3 text-right">Bot Score / Verdict</th>
                  <th className="py-2 px-3 text-right">Entry / SL / Target</th>
                  <th className="py-2 px-3">F-Score &amp; Burst % (Up/Dn)</th>
                  <th className="py-2 px-3">30D Bulk/Block Sentiment</th>
                  <th className="py-2 px-4 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {botIpoItems.map((item) => {
                  const bb = item.phase5Accumulation.bulkBlockConfirmation;
                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => onSelectSymbol(item.symbol)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-blue-700">{item.symbol}</span>
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
                          {item.phase6EntryTriggers.ema21Cross44Bullish ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              21×44 Cross
                            </span>
                          ) : item.phase6EntryTriggers.ema21AboveEma44 ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                              21&gt;44
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                          {item.companyName || item.sector}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <div className="font-bold text-slate-900">{item.scoring.totalScore}/100</div>
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                            item.scoring.verdict === 'STRONG BUY'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : item.scoring.verdict.startsWith('BUY')
                                ? 'bg-blue-50 text-blue-800 border-blue-200'
                                : item.scoring.verdict === 'HARD REJECT'
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {item.scoring.verdict}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <div className="font-semibold text-slate-900">
                          ₹{item.phase7Risk.entryPrice.toFixed(2)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          SL ₹{item.phase7Risk.stopLoss.toFixed(0)} · T ₹{item.phase7Risk.target15Pct.toFixed(0)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        <div className="text-slate-800">
                          F:{' '}
                          {item.phase3Fundamentals.piotroskiScore !== null
                            ? `${item.phase3Fundamentals.piotroskiScore}/${item.phase3Fundamentals.piotroskiAvailable}`
                            : 'N/A'}{' '}
                          ({item.phase3Fundamentals.hardRejectPassCount}/7)
                        </div>
                        <div
                          className="text-slate-600"
                          title="Upward Burst % vs Downward Burst % over 252D (e.g., Up 20% / Dn 20% = equal chop; Up 25% / Dn 5% = bullish dominance)"
                        >
                          Burst:{' '}
                          <span className="text-emerald-700 font-semibold">
                            {item.phase4Movement.burstPowerNormalized !== null
                              ? `Up ${item.phase4Movement.burstPowerNormalized.toFixed(1)}%`
                              : '—'}
                          </span>
                          {' / '}
                          <span className="text-rose-700 font-semibold">
                            {item.phase4Movement.downwardBurstNormalized !== null
                              ? `Dn ${item.phase4Movement.downwardBurstNormalized.toFixed(1)}%`
                              : '—'}
                          </span>
                          {item.phase4Movement.upwardBurstSharePct !== undefined &&
                            item.phase4Movement.upwardBurstSharePct !== null && (
                              <span className="text-slate-400">
                                {' '}
                                ({item.phase4Movement.upwardBurstSharePct}%/{item.phase4Movement.downwardBurstSharePct}%)
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {bb.totalDeals30d > 0 ? (
                          <>
                            <div
                              className={
                                bb.confirmationStatus === 'CONFIRMED'
                                  ? 'text-emerald-700 font-semibold'
                                  : bb.confirmationStatus === 'SELL_PRESSURE'
                                    ? 'text-rose-700 font-semibold'
                                    : 'text-blue-700'
                              }
                            >
                              {bb.confirmationStatus.replace(/_/g, ' ')} ·{' '}
                              {bb.netValueCr >= 0 ? '+' : ''}₹{bb.netValueCr}Cr
                              {bb.buyPct !== undefined ? ` (${bb.buyPct}% Buy)` : ''}
                            </div>
                            <div className="text-[10px] font-sans text-slate-500 truncate max-w-[230px]" title={bb.confirmationReason}>
                              {bb.confirmationReason}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">No 30D deals</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                          Audit <ArrowUpRight className="w-3 h-3" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* T1 / T2 / T3 Specification Guide */}
      <SwingTierSpecPanel defaultOpen={false} />

      {/* Filters & IPO Strategy Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              {(
                [
                  ['ALL_1Y', `All <1Y (${stats.totalIpos})`],
                  ['UNDER_6M', `<6M (${stats.under6mCount})`],
                  ['UNDER_3M', `<3M (${stats.under3mCount})`],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAgeFilter(k)}
                  className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    ageFilter === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <select
              aria-label="U-Turn Filter"
              value={uTurnFilter}
              onChange={(e) => setUTurnFilter(e.target.value as UTurnFilter)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700"
            >
              <option value="ALL">All U-Turn States</option>
              <option value="CONFIRMED_OR_TRIGGER">U-Turn Confirmed / Trigger</option>
              <option value="IN_ZONE">In U-Turn Support Zone</option>
              <option value="TOP_WARN">Turnaround Top Warn</option>
            </select>

            <select
              aria-label="Delivery Category Filter"
              value={deliveryFilter}
              onChange={(e) => setDeliveryFilter(e.target.value as DeliveryFilter)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700"
            >
              <option value="ALL">All Delivery Categories</option>
              <option value="UNION">30D Deliv A/B Union</option>
              <option value="A_AND_B">A_AND_B</option>
              <option value="A_ONLY">A_ONLY</option>
              <option value="B_ONLY">B_ONLY</option>
            </select>

            <select
              aria-label="Fundamental Audit Freshness Filter"
              value={freshnessFilter}
              onChange={(e) => setFreshnessFilter(e.target.value as FreshnessFilter)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700"
            >
              <option value="ALL">All Freshness Tiers</option>
              <option value="LATEST">Latest (&lt;=90d)</option>
              <option value="OLD_3M">3M–Max Age (Within Limit)</option>
              <option value="STALE">Old / Stale (&gt;Max Age)</option>
              <option value="NOT_AVAILABLE">Not Available</option>
            </select>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter IPO symbol / company..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-4">IPO Symbol &amp; Company</th>
                <th
                  className="py-2.5 px-3 cursor-pointer hover:text-slate-900"
                  onClick={() => toggleSort('ipoAge')}
                >
                  Listing / Age
                </th>
                <th
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  onClick={() => toggleSort('close')}
                >
                  Close / Chg
                </th>
                <th className="py-2.5 px-3">Delivery A/B</th>
                <th
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  onClick={() => toggleSort('delivPer')}
                >
                  Deliv % / Ratio
                </th>
                <th
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-900"
                  onClick={() => toggleSort('rvol')}
                >
                  RVOL
                </th>
                <th
                  className="py-2.5 px-3 cursor-pointer hover:text-slate-900"
                  onClick={() => toggleSort('uTurn')}
                >
                  U-Turn &amp; Target
                </th>
                <th className="py-2.5 px-3">Fundamental Audit</th>
                <th className="py-2.5 px-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No IPO stocks match the active filters. Click &ldquo;Scan All NSE IPOs (&lt;1Y)&rdquo; above to index recent listings across all NSE symbols.
                  </td>
                </tr>
              ) : (
                filteredRows.slice(0, 150).map((row) => (
                  <tr
                    key={row.symbol}
                    onClick={() => onSelectSymbol(row.symbol)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold text-blue-700">{row.symbol}</span>
                        {getCapShortLabel(row.marketCapCategory) && (
                          <span
                            title={formatMarketCapCr(row.marketCapCr)}
                            className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                              row.marketCapCategory
                            )}`}
                          >
                            {getCapShortLabel(row.marketCapCategory)}
                          </span>
                        )}
                        {row.ema21Cross44Bullish ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                            21×44
                          </span>
                        ) : row.ema21AboveEma44 ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                            21&gt;44
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[190px]">
                        {row.companyName || row.providerSector || 'Mainboard IPO'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top font-mono tabular-nums">
                      <div className="text-slate-800">{row.listingDate || '—'}</div>
                      <div className="text-[11px] text-slate-500">
                        {row.ipoAgeDays !== null && row.ipoAgeDays !== undefined
                          ? `${row.ipoAgeDays}d old`
                          : `${row.sessionsCount} sess`}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums">
                      <div className="text-slate-900 font-medium">₹{row.closePrice.toFixed(2)}</div>
                      <div
                        className={`text-[11px] ${
                          (row.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {row.changePct !== null
                          ? `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`
                          : '—'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top font-mono">
                      <div className="font-medium text-slate-800">{row.deliveryCategory}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        5D {row.avgDeliv5D !== null ? `${row.avgDeliv5D.toFixed(0)}%` : '—'} ·{' '}
                        {row.swingTier}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums">
                      <div className="text-slate-900">
                        {row.delivPer !== null ? `${row.delivPer.toFixed(1)}%` : '—'}
                      </div>
                      <div className="text-[11px] text-blue-700">
                        {row.delivQtyRatio !== null ? `${row.delivQtyRatio.toFixed(2)}x` : '—'}
                      </div>
                    </td>
                    <td
                      className={`py-2.5 px-3 align-top text-right font-mono tabular-nums font-semibold ${
                        row.rvolBand === 'HIGH' ? 'text-blue-700' : 'text-slate-600'
                      }`}
                    >
                      {row.rvol !== null ? `${row.rvol.toFixed(2)}x` : 'WAIT'}
                    </td>
                    <td className="py-2.5 px-3 align-top font-mono">
                      <div
                        className={`font-medium ${
                          row.uTurnStatus === 'CONFIRMED_SUPPORT' ||
                          row.uTurnStatus === 'ACTIVE_TRIGGER'
                            ? 'text-emerald-700'
                            : row.uTurnStatus === 'BROKEN_DOWN'
                              ? 'text-rose-700'
                              : 'text-slate-800'
                        }`}
                      >
                        {row.uTurnStatus || '—'}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {row.uTurnTarget !== null ? `Zone ₹${row.uTurnTarget.toFixed(1)}` : '—'}
                        {row.topTurnStatus === 'CONFIRMED_TOP' ||
                        row.topTurnStatus === 'ACTIVE_TOP_TRIGGER'
                          ? ` · TOP ${row.topTurnStatus}`
                          : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top font-mono">
                      <div className="text-slate-800">
                        {row.fundamentalCoverage} ({row.fundamentalPassCount}/7)
                      </div>
                      <div className="text-[11px]">{renderAuditStatusText(row)}</div>
                    </td>
                    <td className="py-2.5 px-4 align-top text-right">
                      <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                        Deep-Dive
                        <ArrowUpRight className="w-3 h-3" />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
