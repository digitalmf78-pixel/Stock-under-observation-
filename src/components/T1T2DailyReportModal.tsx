import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Download,
  RefreshCw,
  Repeat,
  Sparkles,
  X,
} from 'lucide-react';
import type { T1T2DailyReportResponse } from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { evaluateQuoteFreshness } from '../utils/quoteFreshness';

interface T1T2DailyReportModalProps {
  open: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string) => void;
}

type ReportTab =
  | 'TODAY_ALL'
  | 'DAILY_REPEAT'
  | 'NEW_TODAY'
  | 'YESTERDAY_ONLY'
  | 'IPO_ONLY'
  | 'COMPARISON_ALL';

export const T1T2DailyReportModal: React.FC<T1T2DailyReportModalProps> = ({
  open,
  onClose,
  onSelectSymbol,
}) => {
  const [report, setReport] = useState<T1T2DailyReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReportTab>('TODAY_ALL');
  const [searchQ, setSearchQ] = useState('');

  const loadReport = useCallback(async (withLive = true, forceRefresh = false) => {
    if (forceRefresh) setLiveRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (withLive) qs.set('live', '1');
      if (forceRefresh) qs.set('refresh', '1');
      const res = await fetch(`/api/reports/t1-t2?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setReport(json);
    } catch (err) {
      setError((err as Error).message || 'Failed to load T1/T2 daily report');
    } finally {
      setLoading(false);
      setLiveRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadReport(true, false);
    }
  }, [open, loadReport]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const filteredItems = useMemo(() => {
    if (!report) return [];
    let list = report.items;
    if (tab === 'TODAY_ALL') {
      list = list.filter((i) => i.todayTier !== 'NONE');
    } else if (tab === 'DAILY_REPEAT') {
      list = list.filter((i) => i.presenceStatus === 'DAILY_REPEAT');
    } else if (tab === 'NEW_TODAY') {
      list = list.filter((i) => i.presenceStatus === 'NEW_TODAY');
    } else if (tab === 'YESTERDAY_ONLY') {
      list = list.filter((i) => i.presenceStatus === 'YESTERDAY_ONLY');
    } else if (tab === 'IPO_ONLY') {
      list = list.filter((i) => i.isIpo || i.sector.toUpperCase().includes('IPO'));
    }

    const q = searchQ.trim().toUpperCase();
    if (q) {
      list = list.filter(
        (i) =>
          i.symbol.includes(q) ||
          i.sector.toUpperCase().includes(q) ||
          i.companyName.toUpperCase().includes(q) ||
          (i.isIpo && 'IPO'.includes(q))
      );
    }
    return list;
  }, [report, tab, searchQ]);

  const handleDownloadCsv = () => {
    const a = document.createElement('a');
    a.href = '/api/reports/t1-t2/csv?live=1';
    a.download = `T1_T2_Daily_Report_${report?.todayDate || 'latest'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-5">
      <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-700 shrink-0" />
              <h2 className="text-xs sm:text-base font-bold text-slate-900">
                Daily T1 &amp; T2 Memory Report (Kal vs Aaj + Daily Repeaters + All IPOs)
              </h2>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
              Memorizes every Bhavcopy session&apos;s T1_READY &amp; T2_ACCUM stocks (including IPO sector), marks daily repeaters (her rooj anewale), and exports full universe CSV.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => void loadReport(true, true)}
              disabled={loading || liveRefreshing}
              className="flex-1 sm:flex-none min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${liveRefreshing ? 'animate-spin' : ''}`} />
              {liveRefreshing ? 'Refreshing...' : 'Live Prices'}
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={!report || loading}
              className="flex-1 sm:flex-none min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close T1/T2 Report"
              className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-200/70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        {report && (
          <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 border-b border-slate-200 bg-white grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3 text-xs shrink-0">
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-[11px] text-slate-500">Today ({report.todayDate})</div>
              <div className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                {report.counts.todayTotal} Stocks
              </div>
              <div className="font-mono text-[11px] text-slate-600">
                T1: {report.counts.todayT1} · T2: {report.counts.todayT2} · IPO: {report.counts.todayIpoCount}
              </div>
            </div>

            <div className="p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-md">
              <div className="text-[11px] text-emerald-800 font-medium flex items-center gap-1">
                <Repeat className="w-3 h-3" />
                Daily Repeaters (Kal + Aaj)
              </div>
              <div className="font-mono font-bold text-emerald-900 text-sm mt-0.5">
                {report.counts.dailyRepeatCount} Repeat
              </div>
              <div className="font-mono text-[11px] text-emerald-700">
                Present in T1/T2 both days
              </div>
            </div>

            <div className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-md">
              <div className="text-[11px] text-blue-800 font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                New Today (Aaj Naye)
              </div>
              <div className="font-mono font-bold text-blue-900 text-sm mt-0.5">
                +{report.counts.newTodayCount} New
              </div>
              <div className="font-mono text-[11px] text-blue-700">
                Fresh entry in {report.todayDate}
              </div>
            </div>

            <div className="p-2.5 bg-amber-50/60 border border-amber-200 rounded-md">
              <div className="text-[11px] text-amber-800 font-medium">
                Yesterday Only ({report.yesterdayDate || 'N/A'})
              </div>
              <div className="font-mono font-bold text-amber-900 text-sm mt-0.5">
                {report.counts.yesterdayOnlyCount} Dropped
              </div>
              <div className="font-mono text-[11px] text-amber-700">
                Were T1/T2 yesterday ({report.counts.yesterdayTotal} total)
              </div>
            </div>

            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-[11px] text-slate-500">Memorized EOD History</div>
              <div className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                {report.memorizedDates.length} Days Saved
              </div>
              <div className="font-mono text-[10px] text-slate-500 truncate">
                {report.memorizedDates[0] || ''} → {report.memorizedDates[report.memorizedDates.length - 1] || ''}
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs & Search */}
        {report && (
          <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'TODAY_ALL', label: `Today T1+T2 (${report.counts.todayTotal})` },
                  { id: 'DAILY_REPEAT', label: `Daily Repeaters (${report.counts.dailyRepeatCount})` },
                  { id: 'NEW_TODAY', label: `New Today (${report.counts.newTodayCount})` },
                  { id: 'YESTERDAY_ONLY', label: `Kal Only (${report.counts.yesterdayOnlyCount})` },
                  {
                    id: 'IPO_ONLY',
                    label: `IPO Sector (${report.items.filter((i) => i.isIpo).length})`,
                  },
                  { id: 'COMPARISON_ALL', label: `All Kal+Aaj (${report.items.length})` },
                ] as Array<{ id: ReportTab; label: string }>
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    tab === t.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Filter symbol, sector, or IPO..."
              className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && !report ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Building daily T1 &amp; T2 memory report (including all IPOs &amp; Yahoo live comparison)...
            </div>
          ) : error ? (
            <div className="p-8 text-center text-xs text-rose-700 font-mono">{error}</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No stocks match the selected T1/T2 report filter.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-medium z-10">
                <tr>
                  <th className="py-2.5 px-4">Symbol &amp; Sector</th>
                  <th className="py-2.5 px-3">Daily Status</th>
                  <th className="py-2.5 px-3">Today ({report?.todayDate})</th>
                  <th className="py-2.5 px-3">Kal ({report?.yesterdayDate || 'Prev'})</th>
                  <th className="py-2.5 px-3 text-right">Scanner EOD (₹)</th>
                  <th className="py-2.5 px-3 text-right">Live Price &amp; Vs EOD</th>
                  <th className="py-2.5 px-3 text-right">RVOL</th>
                  <th className="py-2.5 px-3 text-right">Deliv % / Ratio</th>
                  <th className="py-2.5 px-4 text-right">Streak / Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const isUp = (item.liveVsScannerEodInr ?? 0) >= 0;
                  return (
                    <tr
                      key={item.symbol}
                      onClick={() => {
                        onClose();
                        onSelectSymbol(item.symbol);
                      }}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2 px-4">
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
                          {item.isIpo && (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                              IPO · {item.sessionsCount}d
                            </span>
                          )}
                          {item.ema21Cross44Bullish ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              21×44
                            </span>
                          ) : item.ema21AboveEma44 ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                              21&gt;44
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                          {item.sector}
                        </div>
                      </td>

                      <td className="py-2 px-3 font-mono">
                        {item.presenceStatus === 'DAILY_REPEAT' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <Repeat className="w-3 h-3" />
                            DAILY REPEAT ({item.consecutiveDays}d)
                          </span>
                        ) : item.presenceStatus === 'NEW_TODAY' ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-50 text-blue-800 border border-blue-200">
                            NEW TODAY
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-50 text-amber-800 border border-amber-200">
                            KAL ONLY
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-3 font-mono">
                        {item.todayTier === 'TIER_1_READY' ? (
                          <span className="text-emerald-700 font-semibold">T1_READY</span>
                        ) : item.todayTier === 'TIER_2_ACCUMULATION' ? (
                          <span className="text-blue-700 font-medium">T2_ACCUM</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2 px-3 font-mono">
                        {item.yesterdayTier === 'TIER_1_READY' ? (
                          <span className="text-emerald-700">T1_READY</span>
                        ) : item.yesterdayTier === 'TIER_2_ACCUMULATION' ? (
                          <span className="text-blue-700">T2_ACCUM</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2 px-3 text-right font-mono text-slate-900">
                        <div>₹{item.scannerEodClose.toFixed(2)}</div>
                        <div
                          className={`text-[10px] ${
                            (item.eodChangePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {item.eodChangePct !== null
                            ? `${item.eodChangePct >= 0 ? '+' : ''}${item.eodChangePct.toFixed(2)}%`
                            : '—'}
                        </div>
                      </td>

                      <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                        {item.livePrice !== null ? (() => {
                          const freshness = evaluateQuoteFreshness({
                            lastUpdated: item.liveLastUpdated,
                            marketTimeIst: item.liveMarketTimeIst,
                            marketDateIst: item.liveMarketDateIst,
                            marketState: item.liveMarketState,
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
                              <span>₹{item.livePrice.toFixed(2)}</span>
                              {freshness.badgeLabel && (
                                <span
                                  title={freshness.reason ?? undefined}
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
                              {item.liveVsScannerEodInr !== null
                                ? `${item.liveVsScannerEodInr >= 0 ? '+' : ''}${item.liveVsScannerEodInr.toFixed(2)}`
                                : ''}{' '}
                              {item.liveVsScannerEodPct !== null
                                ? `(${item.liveVsScannerEodPct >= 0 ? '+' : ''}${item.liveVsScannerEodPct.toFixed(2)}%)`
                                : ''}
                            </div>
                          </div>
                          );
                        })() : (
                          <span className="text-[10px] text-amber-700">DATA NOT AVAILABLE</span>
                        )}
                      </td>

                      <td className="py-2 px-3 text-right font-mono text-slate-700">
                        {item.rvol !== null ? `${item.rvol.toFixed(2)}x` : '—'}
                      </td>

                      <td className="py-2 px-3 text-right font-mono text-slate-700">
                        {item.delivPer !== null ? `${item.delivPer.toFixed(1)}%` : '—'} /{' '}
                        {item.delivQtyRatio !== null ? `${item.delivQtyRatio.toFixed(2)}x` : '—'}
                      </td>

                      <td
                        className="py-2 px-4 text-right font-mono text-slate-600"
                        title={`Dates in T1/T2: ${item.datesAppeared.join(', ')}`}
                      >
                        {item.consecutiveDays}d streak · {item.daysSeenInHistory}d total
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
