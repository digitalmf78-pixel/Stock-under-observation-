import React, { useEffect, useState } from 'react';
import { Calculator, Search } from 'lucide-react';
import type { SignalLogEntry, SignalSummaryStats } from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';

interface SignalsViewProps {
  onSelectSymbol: (symbol: string) => void;
  onSendToRisk: (signal: SignalLogEntry) => void;
  externalReloadSeq?: number;
}

export const SignalsView: React.FC<SignalsViewProps> = ({
  onSelectSymbol,
  onSendToRisk,
  externalReloadSeq = 0,
}) => {
  const [q, setQ] = useState('');
  const [date, setDate] = useState('ALL');
  const [setup, setSetup] = useState('ALL');
  const [delivery, setDelivery] = useState('ALL');
  const [rows, setRows] = useState<SignalLogEntry[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [setups, setSetups] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<SignalSummaryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q,
          date,
          setup,
          delivery,
          limit: '120',
        });
        const res = await fetch(`/api/signals?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = await res.json();
        setRows(json.rows || []);
        setTotal(json.total || 0);
        setDates(json.dates || []);
        setSetups(json.setups || []);
        setSummary(json.summary || null);
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, date, setup, delivery, externalReloadSeq]);

  return (
    <div className="space-y-4">
      {/* Signal Outcome & Rejection Audit Strip */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Evaluated Signals</div>
              <div className="mt-1 text-lg font-semibold font-mono text-slate-900">
                {summary.evaluatedCount} / {summary.total}
              </div>
              <div className="text-[11px] text-slate-500">With post-signal sessions</div>
            </div>
            <div>
              <div className="text-slate-500">Forward Win Rate</div>
              <div className="mt-1 text-lg font-semibold font-mono text-blue-700">
                {summary.winRatePct !== null ? `${summary.winRatePct.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {summary.positiveReturnCount} positive
              </div>
            </div>
            <div>
              <div className="text-slate-500">Avg Fwd Return</div>
              <div
                className={`mt-1 text-base font-semibold font-mono ${
                  (summary.avgReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {summary.avgReturnPct !== null
                  ? `${summary.avgReturnPct >= 0 ? '+' : ''}${summary.avgReturnPct.toFixed(2)}%`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Avg MFE / MAE</div>
              <div className="mt-1 text-base font-semibold font-mono text-slate-800">
                {summary.avgMfePct !== null ? `+${summary.avgMfePct.toFixed(1)}%` : '—'} /{' '}
                {summary.avgMaePct !== null ? `${summary.avgMaePct.toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-900 mb-2">
              Why Signals Were Marked SKIP (Gate Rejection Breakdown)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {summary.rejectionBreakdown.slice(0, 8).map((item) => (
                <div key={item.reason} className="p-2 bg-slate-50 border border-slate-200 rounded">
                  <div className="text-slate-600 truncate">{item.reason}</div>
                  <div className="font-mono font-semibold text-slate-900 mt-0.5">
                    {item.count.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 sm:gap-3">
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3 flex-1">
          <div className="relative w-full sm:w-auto sm:min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol..."
              className="w-full min-h-[38px] pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full sm:w-auto min-h-[38px] px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="ALL">All Dates ({dates.length})</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <select
            value={setup}
            onChange={(e) => setSetup(e.target.value)}
            className="w-full sm:w-auto min-h-[38px] px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="ALL">All Setup Types</option>
            {setups.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
            className="w-full sm:w-auto min-h-[38px] px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="ALL">All Delivery Categories</option>
            <option value="A">Category A</option>
            <option value="B">Category B</option>
            <option value="A_AND_B">A_AND_B</option>
            <option value="A_ONLY">A_ONLY</option>
            <option value="B_ONLY">B_ONLY</option>
          </select>
        </div>

        <div className="text-xs font-mono text-slate-500">
          {total.toLocaleString()} logged entries
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-4">EOD Date</th>
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Setup &amp; Trend</th>
                <th className="py-2.5 px-3 text-right">Score</th>
                <th className="py-2.5 px-3 text-right">RVOL</th>
                <th className="py-2.5 px-3 text-right">Stop %</th>
                <th className="py-2.5 px-3 text-right">Fwd Return</th>
                <th className="py-2.5 px-3 text-right">MFE / MAE</th>
                <th className="py-2.5 px-3">Gate Rejection Reasons</th>
                <th className="py-2.5 px-4 text-right">Risk Sizer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={10} className="py-3 px-4">
                      <div className="h-3.5 bg-slate-100 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    No signal history records match the active filters.
                  </td>
                </tr>
              ) : (
                rows.map((sig, i) => (
                  <tr
                    key={`${sig.eodDate}-${sig.symbol}-${i}`}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {sig.eodDate}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => onSelectSymbol(sig.symbol)}
                          className="font-mono font-semibold text-blue-700 hover:underline"
                        >
                          {sig.symbol}
                        </button>
                        {getCapShortLabel(sig.marketCapCategory) && (
                          <span
                            title={formatMarketCapCr(sig.marketCapCr)}
                            className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                              sig.marketCapCategory
                            )}`}
                          >
                            {getCapShortLabel(sig.marketCapCategory)}
                          </span>
                        )}
                        {sig.ema21Cross44Bullish ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                            21×44
                          </span>
                        ) : sig.ema21AboveEma44 ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                            21&gt;44
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {sig.deliveryCategory} · {sig.liquidityTier}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900">{sig.setupType}</div>
                      <div className="text-[11px] text-slate-500">{sig.trendClassification}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                      {sig.v8Score ?? '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {sig.rvol !== null ? `${sig.rvol.toFixed(2)}x` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {sig.stopDistancePct !== null ? `${sig.stopDistancePct.toFixed(1)}%` : '—'}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-semibold ${
                        sig.evalReturnPct === null
                          ? 'text-slate-400'
                          : sig.evalReturnPct >= 0
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                      }`}
                    >
                      {sig.evalReturnPct !== null
                        ? `${sig.evalReturnPct >= 0 ? '+' : ''}${sig.evalReturnPct.toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                      {sig.evalMfePct !== null && sig.evalMaePct !== null
                        ? `+${sig.evalMfePct.toFixed(1)}% / ${sig.evalMaePct.toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 max-w-[220px]">
                      {sig.skipReasons.length > 0
                        ? sig.skipReasons.join(' · ')
                        : sig.watchlistStatus}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={() => onSendToRisk(sig)}
                        disabled={sig.entryZoneHigh === null || sig.stopLoss === null}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded transition-colors whitespace-nowrap shrink-0"
                      >
                        <Calculator className="w-3 h-3" />
                        Size Trade
                      </button>
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
