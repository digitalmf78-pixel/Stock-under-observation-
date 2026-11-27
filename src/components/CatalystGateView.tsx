import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Newspaper,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  CatalystScreenerResponse,
  RejectionGateVerdict,
  ResultPriorityTier,
  StockCatalystProfile,
} from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { authFetch } from '../utils/authClient';

interface CatalystGateViewProps {
  onSelectSymbol: (symbol: string) => void;
  externalReloadSeq?: number;
}

export const CatalystGateView: React.FC<CatalystGateViewProps> = ({
  onSelectSymbol,
  externalReloadSeq = 0,
}) => {
  const [data, setData] = useState<CatalystScreenerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [priorityFilter, setPriorityFilter] = useState<string>('UPCOMING_3M');
  const [gateFilter, setGateFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithDeals, setOnlyWithDeals] = useState(false);

  const [inspectingSymbol, setInspectingSymbol] = useState<string | null>(null);
  const [inspectedProfile, setInspectedProfile] = useState<StockCatalystProfile | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  const [drawerQ, setDrawerQ] = useState('');
  const [drawerSentiment, setDrawerSentiment] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL');
  const [drawerType, setDrawerType] = useState<
    'ALL' | 'NEWS_7D' | 'ORDER_WIN' | 'RESULTS_BOARD_MEETING' | 'EXPANSION_FUNDRAISE' | 'CORPORATE_ACTION'
  >('ALL');

  const fetchScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('priority', priorityFilter);
      qs.set('gate', gateFilter);
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (onlyWithDeals) qs.set('onlyWithDeals', '1');
      qs.set('limit', '100');

      const res = await fetch(`/api/catalysts/screener?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message || 'Failed to load 3M Results & Rejection Gate');
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, gateFilter, searchQuery, onlyWithDeals]);

  useEffect(() => {
    void fetchScreener();
  }, [fetchScreener, externalReloadSeq]);

  const handleSyncAllCatalysts = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/catalysts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ background: false }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchScreener();
      setNotice(
        `Synced 30D Bulk/Block (${json.bulkDeals30D} unique deals${
          json.bulkDistinctDates ? ` across ${json.bulkDistinctDates} trading days` : ''
        }${json.bulkDateRange ? `: ${json.bulkDateRange}` : ''}) & scanned ${json.scan?.total ?? 0} stocks (${json.scan?.upcoming3mCount ?? 0} results in next 3M).`
      );
    } catch (err) {
      setNotice(`Catalyst sync error: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleInspectStockCatalysts = async (sym: string, refresh = false) => {
    setInspectingSymbol(sym);
    setDrawerQ('');
    setDrawerSentiment('ALL');
    setDrawerType('ALL');
    setInspectLoading(true);
    try {
      const url = `/api/stock/${encodeURIComponent(sym)}/catalysts${refresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setInspectedProfile(json);
      await fetchScreener();
    } catch (err) {
      setNotice(`Failed to fetch 7D news & orders for ${sym}: ${(err as Error).message}`);
    } finally {
      setInspectLoading(false);
    }
  };

  const filteredDrawerNews = useMemo(() => {
    if (!inspectedProfile) return [];
    if (drawerType !== 'ALL' && drawerType !== 'NEWS_7D') return [];
    const q = drawerQ.trim().toLowerCase();
    return inspectedProfile.news7D.filter((n) => {
      if (drawerSentiment !== 'ALL' && n.sentiment !== drawerSentiment) return false;
      if (q && !`${n.title} ${n.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [inspectedProfile, drawerQ, drawerSentiment, drawerType]);

  const filteredDrawerAnnouncements = useMemo(() => {
    if (!inspectedProfile) return [];
    if (drawerType === 'NEWS_7D') return [];
    const q = drawerQ.trim().toLowerCase();
    return inspectedProfile.announcements.filter((a) => {
      if (drawerSentiment !== 'ALL' && a.sentiment !== drawerSentiment) return false;
      if (drawerType !== 'ALL' && a.category !== drawerType) return false;
      if (q && !`${a.subject} ${a.details} ${a.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [inspectedProfile, drawerQ, drawerSentiment, drawerType]);

  const renderPriorityLabel = (tier: ResultPriorityTier, days: number | null) => {
    if (tier === 'WITHIN_1M') {
      return (
        <span className="font-mono font-semibold text-blue-700">
          P1 · Within 1M ({days ?? 0}d)
        </span>
      );
    }
    if (tier === 'WITHIN_2M') {
      return (
        <span className="font-mono font-medium text-indigo-700">
          P2 · Within 2M ({days ?? 0}d)
        </span>
      );
    }
    if (tier === 'WITHIN_3M') {
      return (
        <span className="font-mono font-medium text-slate-700">
          P3 · Within 3M ({days ?? 0}d)
        </span>
      );
    }
    if (tier === 'BEYOND_3M') {
      return <span className="font-mono text-slate-400">&gt; 3M ({days ?? 0}d)</span>;
    }
    return <span className="font-mono text-slate-400">Unscheduled</span>;
  };

  const renderGateVerdict = (verdict: RejectionGateVerdict) => {
    switch (verdict) {
      case 'PASS_OBSERVATION':
        return (
          <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            PASS · Observation
          </span>
        );
      case 'REJECT_NEGATIVE_RESULT':
        return (
          <span className="inline-flex items-center gap-1 font-mono font-semibold text-rose-700">
            <ShieldAlert className="w-3.5 h-3.5" />
            REJECT · Neg 3M Result
          </span>
        );
      case 'REJECT_NEGATIVE_DEALS':
        return (
          <span className="inline-flex items-center gap-1 font-mono font-semibold text-rose-700">
            <ShieldAlert className="w-3.5 h-3.5" />
            REJECT · Neg 30D Deals
          </span>
        );
      case 'REJECT_NO_3M_RESULT':
        return (
          <span className="font-mono text-slate-500">REJECT · Outside 3M Result</span>
        );
      case 'PENDING_VERIFICATION':
      default:
        return (
          <span className="font-mono font-medium text-amber-700">
            PENDING · Verify 3M EPS
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Rejection Gate Rule Summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-blue-700" />
            3-Month Results Priority, 7D News, Orders &amp; 30D Bulk/Block Rejection Gate
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Priority: <span className="font-medium text-slate-700">Within 1M (0–30d)</span> &gt;{' '}
            <span className="font-medium text-slate-700">Within 2M (31–60d)</span> &gt;{' '}
            <span className="font-medium text-slate-700">Within 3M (61–90d)</span> · Hard Rejection
            Gate filters out negative 3M results or negative 30D Bulk/Block deals before observation.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSyncAllCatalysts}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing NSE Deals & Results...' : 'Sync 3M Results & 30D Bulk/Block'}
        </button>
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

      {data && (
        <>
          {/* Priority & Gate KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <button
              type="button"
              onClick={() => {
                setPriorityFilter('WITHIN_1M');
                setGateFilter('ALL');
              }}
              className="text-left bg-white border border-slate-200 hover:border-blue-300 rounded-lg p-4 transition-colors"
            >
              <div className="text-xs font-medium text-slate-500">Priority 1 · Within 1 Month</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-blue-700">
                {data.priorityCounts.within1m}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500">0–30 days to result</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setPriorityFilter('WITHIN_2M');
                setGateFilter('ALL');
              }}
              className="text-left bg-white border border-slate-200 hover:border-indigo-300 rounded-lg p-4 transition-colors"
            >
              <div className="text-xs font-medium text-slate-500">Priority 2 · Within 2 Months</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-indigo-700">
                {data.priorityCounts.within2m}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500">31–60 days to result</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setPriorityFilter('WITHIN_3M');
                setGateFilter('ALL');
              }}
              className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-lg p-4 transition-colors"
            >
              <div className="text-xs font-medium text-slate-500">Priority 3 · Within 3 Months</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {data.priorityCounts.within3m}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500">61–90 days to result</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setPriorityFilter('UPCOMING_3M');
                setGateFilter('OBSERVATION');
              }}
              className="text-left bg-white border border-emerald-200 hover:border-emerald-400 rounded-lg p-4 transition-colors"
            >
              <div className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Gate Passed (Observation)
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {data.gateCounts.passObservation}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500">
                3M +ve Result &amp; Non-Neg Deals
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setPriorityFilter('UPCOMING_3M');
                setGateFilter('REJECTED');
              }}
              className="text-left bg-white border border-rose-200 hover:border-rose-300 rounded-lg p-4 transition-colors"
            >
              <div className="text-xs font-medium text-rose-700">Gate Rejected (3M Neg)</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-rose-700">
                {data.gateCounts.rejectNegativeResult + data.gateCounts.rejectNegativeDeals}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500">
                Neg Result {data.gateCounts.rejectNegativeResult} · Neg Deals{' '}
                {data.gateCounts.rejectNegativeDeals}
              </div>
            </button>
          </div>

          {/* 30D Bulk & Block Status Line */}
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <span>{data.bulkBlockStats.note}</span>
            <span className="font-mono text-[11px] text-slate-500">
              Upcoming 3M Total: {data.priorityCounts.total3m} stocks · Pending Verification:{' '}
              {data.gateCounts.pendingVerification}
            </span>
          </div>

          {/* Filter & Table Card */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  aria-label="Priority Tier Filter"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700"
                >
                  <option value="UPCOMING_3M">Upcoming Within 3 Months (All)</option>
                  <option value="WITHIN_1M">Priority 1 · Within 1 Month (0–30d)</option>
                  <option value="WITHIN_2M">Priority 2 · Within 2 Months (31–60d)</option>
                  <option value="WITHIN_3M">Priority 3 · Within 3 Months (61–90d)</option>
                  <option value="ALL">All Mainboard Stocks</option>
                </select>

                <select
                  aria-label="Rejection Gate Filter"
                  value={gateFilter}
                  onChange={(e) => setGateFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700"
                >
                  <option value="ALL">All Gate Verdicts</option>
                  <option value="OBSERVATION">PASS · Observation Ready</option>
                  <option value="PENDING_VERIFICATION">PENDING · Need 3M Profit/EPS</option>
                  <option value="REJECTED">REJECTED (Negative Result / Deals)</option>
                </select>

                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-md cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={onlyWithDeals}
                    onChange={(e) => setOnlyWithDeals(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  Only 30D Bulk/Block Deals
                </label>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbol / sector..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading catalyst gate...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <th className="py-2.5 px-4">Symbol</th>
                      <th className="py-2.5 px-3">Priority &amp; Result Date</th>
                      <th className="py-2.5 px-3">3M Profit / EPS Polarity</th>
                      <th className="py-2.5 px-3">Rejection Gate</th>
                      <th className="py-2.5 px-3 text-right">30D Bulk/Block</th>
                      <th className="py-2.5 px-3">Strategy / Deliv A/B</th>
                      <th className="py-2.5 px-4 text-right">7D News &amp; Orders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-500">
                          No stocks match this Priority &amp; Gate filter.
                        </td>
                      </tr>
                    ) : (
                      data.rows.map((p) => (
                        <tr key={p.symbol} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-4 align-top">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(p.symbol)}
                                className="font-mono font-semibold text-blue-700 hover:underline text-left"
                              >
                                {p.symbol}
                              </button>
                              {getCapShortLabel(p.marketCapCategory) && (
                                <span
                                  title={formatMarketCapCr(p.marketCapCr)}
                                  className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                                    p.marketCapCategory
                                  )}`}
                                >
                                  {getCapShortLabel(p.marketCapCategory)}
                                </span>
                              )}
                              {p.ema21Cross44Bullish ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                  21×44
                                </span>
                              ) : p.ema21AboveEma44 ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                                  21&gt;44
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                              {p.companyName || p.sector}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <div>{renderPriorityLabel(p.resultPriority, p.daysToResult)}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {p.nextResultDate || 'No date'}
                              {p.isResultEstimate && p.nextResultDate ? ' (Est)' : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <div
                              className={`font-mono font-medium ${
                                p.resultPolarity3M === 'POSITIVE'
                                  ? 'text-emerald-700'
                                  : p.resultPolarity3M === 'NEGATIVE'
                                    ? 'text-rose-700'
                                    : 'text-amber-700'
                              }`}
                            >
                              {p.resultPolarity3M}
                            </div>
                            <div className="text-[11px] text-slate-500 max-w-[230px]">
                              {p.result3MReason}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <div>{renderGateVerdict(p.rejectionGate)}</div>
                            <div className="text-[11px] text-slate-500 max-w-[220px]">
                              {p.rejectionReasons[0] || ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums">
                            {p.bulkBlock30D.totalDeals > 0 ? (
                              <>
                                <div
                                  className={`font-semibold ${
                                    p.bulkBlock30D.sentiment === 'POSITIVE'
                                      ? 'text-emerald-700'
                                      : p.bulkBlock30D.sentiment === 'NEGATIVE'
                                        ? 'text-rose-700'
                                        : 'text-slate-700'
                                  }`}
                                >
                                  {p.bulkBlock30D.netValueCr >= 0 ? '+' : '-'}₹
                                  {Math.abs(p.bulkBlock30D.netValueCr).toFixed(2)} Cr
                                </div>
                                <div className="text-[11px] text-slate-600">
                                  {p.bulkBlock30D.buyCount}B / {p.bulkBlock30D.sellCount}S
                                  {p.bulkBlock30D.buyPct !== undefined ? ` · ${p.bulkBlock30D.buyPct}% Buy` : ''}
                                </div>
                                {p.bulkBlock30D.sentimentLabel && (
                                  <div className="text-[10px] font-sans text-slate-500">
                                    {p.bulkBlock30D.sentimentLabel}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400">0 deals</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 align-top font-mono">
                            <div className="text-slate-800">
                              {p.deliveryCategory} ·{' '}
                              {p.rvol !== null ? `${p.rvol.toFixed(2)}x` : 'WAIT'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {p.swingTier}
                              {p.uTurnStatus ? ` · ${p.uTurnStatus}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 align-top text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void handleInspectStockCatalysts(p.symbol, false)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                              >
                                <Newspaper className="w-3 h-3" />
                                Fetch 7D News &amp; Orders
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(p.symbol)}
                                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-700 hover:text-slate-900"
                              >
                                Detail
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Inline Catalyst Drawer / Detail Card for Inspected Stock */}
      {inspectingSymbol && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {inspectingSymbol} — Live 7-Day News, Official Announcements/Orders &amp; 30D Deals
              </h3>
              <p className="text-xs text-slate-500">
                {inspectedProfile
                  ? `${inspectedProfile.companyName} · Expected Result: ${inspectedProfile.nextResultDate || 'Unscheduled'} · Gate: ${inspectedProfile.rejectionGate}`
                  : 'Fetching live RSS & BSE corporate filings...'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleInspectStockCatalysts(inspectingSymbol, true)}
                disabled={inspectLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
              >
                <RefreshCw className={`w-3 h-3 ${inspectLoading ? 'animate-spin' : ''}`} />
                Refresh Live
              </button>
              <button
                type="button"
                onClick={() => setInspectingSymbol(null)}
                className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
              >
                Close
              </button>
            </div>
          </div>

          {inspectLoading ? (
            <div className="py-6 text-center text-xs text-slate-500">
              Querying Google News (last 7 days), BSE Corporate Announcements &amp; NSE 30D Deals...
            </div>
          ) : inspectedProfile ? (
            <div className="space-y-4 text-xs">
              {/* Open 30D Bulk & Block Sentiment Breakdown */}
              <div
                className={`border rounded-md p-3.5 space-y-2 ${
                  inspectedProfile.bulkBlock30D.sentiment === 'POSITIVE'
                    ? 'bg-emerald-50/40 border-emerald-200'
                    : inspectedProfile.bulkBlock30D.sentiment === 'NEGATIVE'
                      ? 'bg-rose-50/40 border-rose-200'
                      : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">
                    30D Bulk &amp; Block Deal Sentiment:{' '}
                    <span
                      className={
                        inspectedProfile.bulkBlock30D.sentiment === 'POSITIVE'
                          ? 'text-emerald-700'
                          : inspectedProfile.bulkBlock30D.sentiment === 'NEGATIVE'
                            ? 'text-rose-700'
                            : 'text-slate-700'
                      }
                    >
                      {inspectedProfile.bulkBlock30D.sentimentLabel || inspectedProfile.bulkBlock30D.sentiment}
                    </span>
                  </div>
                  <div className="font-mono text-[11px]">
                    Net:{' '}
                    <strong>
                      {inspectedProfile.bulkBlock30D.netValueCr >= 0 ? '+' : '-'}₹
                      {Math.abs(inspectedProfile.bulkBlock30D.netValueCr).toFixed(2)} Cr
                    </strong>{' '}
                    · Buy ₹{inspectedProfile.bulkBlock30D.buyValueCr.toFixed(2)}Cr ({inspectedProfile.bulkBlock30D.buyCount}) /
                    Sell ₹{inspectedProfile.bulkBlock30D.sellValueCr.toFixed(2)}Cr ({inspectedProfile.bulkBlock30D.sellCount})
                  </div>
                </div>

                {inspectedProfile.bulkBlock30D.totalDeals > 0 &&
                  inspectedProfile.bulkBlock30D.buyPct !== undefined && (
                    <div className="space-y-1">
                      <div className="h-2 w-full rounded-full overflow-hidden bg-slate-200 flex">
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${inspectedProfile.bulkBlock30D.buyPct}%` }}
                        />
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${100 - inspectedProfile.bulkBlock30D.buyPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between font-mono text-[10px] text-slate-600">
                        <span className="text-emerald-700">Buy Share {inspectedProfile.bulkBlock30D.buyPct}%</span>
                        <span className="text-rose-700">
                          Sell Share {(100 - inspectedProfile.bulkBlock30D.buyPct).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}

                {inspectedProfile.bulkBlock30D.sentimentReason && (
                  <div className="text-[11px] text-slate-700">
                    {inspectedProfile.bulkBlock30D.sentimentReason}
                  </div>
                )}

                {((inspectedProfile.bulkBlock30D.topBuyClients &&
                  inspectedProfile.bulkBlock30D.topBuyClients.length > 0) ||
                  (inspectedProfile.bulkBlock30D.topSellClients &&
                    inspectedProfile.bulkBlock30D.topSellClients.length > 0)) && (
                  <div className="flex flex-wrap gap-3 text-[11px]">
                    {inspectedProfile.bulkBlock30D.topBuyClients &&
                      inspectedProfile.bulkBlock30D.topBuyClients.length > 0 && (
                        <div>
                          <span className="font-semibold text-emerald-800">Top Buyers:</span>{' '}
                          <span className="text-slate-700">
                            {inspectedProfile.bulkBlock30D.topBuyClients.join(', ')}
                          </span>
                        </div>
                      )}
                    {inspectedProfile.bulkBlock30D.topSellClients &&
                      inspectedProfile.bulkBlock30D.topSellClients.length > 0 && (
                        <div>
                          <span className="font-semibold text-rose-800">Top Sellers:</span>{' '}
                          <span className="text-slate-700">
                            {inspectedProfile.bulkBlock30D.topSellClients.join(', ')}
                          </span>
                        </div>
                      )}
                  </div>
                )}

                {inspectedProfile.bulkBlock30D.deals.length > 0 && (
                  <div className="mt-2 bg-white border border-slate-200 rounded overflow-x-auto max-h-56 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-1.5 px-2.5">Date</th>
                          <th className="py-1.5 px-2.5">Type</th>
                          <th className="py-1.5 px-2.5">Client</th>
                          <th className="py-1.5 px-2.5">Side</th>
                          <th className="py-1.5 px-2.5 text-right">Qty</th>
                          <th className="py-1.5 px-2.5 text-right">Price</th>
                          <th className="py-1.5 px-2.5 text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {inspectedProfile.bulkBlock30D.deals.slice(0, 15).map((d, idx) => {
                          const isBuy = d.buySell === 'BUY';
                          const valLabel =
                            Math.abs(d.valueCr) > 0 && Math.abs(d.valueCr) < 0.01
                              ? `₹${(Math.abs(d.valueCr) * 100).toFixed(2)} L`
                              : `₹${Math.abs(d.valueCr).toFixed(2)} Cr`;
                          return (
                            <tr key={`${d.date}-${d.dealType}-${d.clientName}-${idx}`}>
                              <td className="py-1.5 px-2.5 font-mono text-slate-600 whitespace-nowrap">{d.date}</td>
                              <td className="py-1.5 px-2.5 font-mono text-slate-700">{d.dealType}</td>
                              <td className="py-1.5 px-2.5 text-slate-900 max-w-[220px] truncate" title={d.clientName}>{d.clientName}</td>
                              <td className={`py-1.5 px-2.5 font-mono font-semibold ${isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>{d.buySell}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">{d.quantity.toLocaleString()}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">₹{d.tradePrice.toFixed(2)}</td>
                              <td className={`py-1.5 px-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {isBuy ? '+' : '-'}{valLabel}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Filter Bar for 7D News & Corporate Filings */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={drawerQ}
                      onChange={(e) => setDrawerQ(e.target.value)}
                      placeholder="Filter 7D headlines or filings..."
                      className="pl-7 pr-2.5 py-1 bg-white border border-slate-200 rounded text-xs w-52 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>
                  <select
                    aria-label="Drawer News Sentiment Filter"
                    value={drawerSentiment}
                    onChange={(e) => setDrawerSentiment(e.target.value as typeof drawerSentiment)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
                  >
                    <option value="ALL">All Sentiments</option>
                    <option value="POSITIVE">Positive</option>
                    <option value="NEGATIVE">Negative</option>
                    <option value="NEUTRAL">Neutral</option>
                  </select>
                  <select
                    aria-label="Drawer Event Type Filter"
                    value={drawerType}
                    onChange={(e) => setDrawerType(e.target.value as typeof drawerType)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
                  >
                    <option value="ALL">All News &amp; Filings</option>
                    <option value="NEWS_7D">7D News Only</option>
                    <option value="ORDER_WIN">Order Wins</option>
                    <option value="RESULTS_BOARD_MEETING">Results / Board Meeting</option>
                    <option value="EXPANSION_FUNDRAISE">Expansion / Fundraise</option>
                    <option value="CORPORATE_ACTION">Corporate Actions</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                  <span>
                    News {filteredDrawerNews.length}/{inspectedProfile.news7D.length} · Filings{' '}
                    {filteredDrawerAnnouncements.length}/{inspectedProfile.announcements.length}
                  </span>
                  {(drawerQ || drawerSentiment !== 'ALL' || drawerType !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerQ('');
                        setDrawerSentiment('ALL');
                        setDrawerType('ALL');
                      }}
                      className="px-2 py-0.5 text-[11px] font-sans font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 7D News */}
                <div className="space-y-2.5">
                  <div className="font-semibold text-slate-800">
                    Last 7 Days News ({filteredDrawerNews.length})
                  </div>
                  {filteredDrawerNews.length === 0 ? (
                    <div className="text-slate-500">No matching news headlines within last 7 days.</div>
                  ) : (
                    <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md max-h-72 overflow-y-auto">
                      {filteredDrawerNews.slice(0, 15).map((n, idx) => (
                        <li key={idx} className="p-2.5 hover:bg-slate-50">
                          <a
                            href={n.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-slate-900 hover:text-blue-700 inline-flex items-start gap-1"
                          >
                            <span>{n.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
                          </a>
                          <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                            <span>{n.source || 'News'}</span>
                            <span>·</span>
                            <span>{n.ageDays}d ago</span>
                            <span>·</span>
                            <span
                              className={
                                n.sentiment === 'POSITIVE'
                                  ? 'text-emerald-700 font-semibold'
                                  : n.sentiment === 'NEGATIVE'
                                    ? 'text-rose-700 font-semibold'
                                    : 'text-slate-500'
                              }
                            >
                              {n.sentiment}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Official Announcements / Order Wins */}
                <div className="space-y-2.5">
                  <div className="font-semibold text-slate-800">
                    BSE Corporate Announcements &amp; Order Wins ({filteredDrawerAnnouncements.length})
                  </div>
                  {filteredDrawerAnnouncements.length === 0 ? (
                    <div className="text-slate-500">No matching BSE corporate filings cached in 45D window.</div>
                  ) : (
                    <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md max-h-72 overflow-y-auto">
                      {filteredDrawerAnnouncements.slice(0, 15).map((a, idx) => (
                        <li key={idx} className="p-2.5">
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                            <span
                              className={
                                a.category === 'ORDER_WIN'
                                  ? 'font-semibold text-emerald-700'
                                  : a.category === 'RESULTS_BOARD_MEETING'
                                    ? 'font-semibold text-blue-700'
                                    : 'text-slate-600'
                              }
                            >
                              {a.category}
                            </span>
                            <span className="text-slate-500">{a.date}</span>
                          </div>
                          <div className="mt-0.5 text-slate-900 font-medium">{a.subject}</div>
                          {a.attachmentUrl && (
                            <a
                              href={a.attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline"
                            >
                              Filing PDF
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
