import React, { useCallback, useEffect, useState } from 'react';
import { Coins, RefreshCw } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DividendHistoryResponse, DividendYearPoint } from '../types/trading';

interface DividendHistoryChartCardProps {
  symbol: string;
  externalRefreshSeq?: number;
}

type ChartMode = 'PAYOUT_VS_PERF' | 'DPS_VS_YOY';

interface CustomTooltipPayloadItem {
  payload?: DividendYearPoint;
}

const DividendTooltip: React.FC<{
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
  mode: ChartMode;
}> = ({ active, payload, mode }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="bg-slate-900 text-slate-100 border border-slate-700 rounded-md p-3 shadow-lg text-xs font-mono tabular-nums space-y-1.5 min-w-[230px]">
      <div className="font-sans font-semibold text-white border-b border-slate-700 pb-1 flex items-center justify-between gap-3">
        <span>{pt.fyLabel}</span>
        <span className="text-[10px] font-mono text-slate-400">{pt.fyEndIso}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-300">Payout Ratio:</span>
        <span className="font-semibold text-blue-300">
          {pt.payoutRatioPct !== null ? `${pt.payoutRatioPct.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-300">Dividend / Share:</span>
        <span className="font-semibold text-emerald-300">
          {pt.dividendPerShareInr !== null ? `₹${pt.dividendPerShareInr.toFixed(2)}` : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-300">Annual EPS:</span>
        <span className="text-slate-100">
          {pt.epsInr !== null ? `₹${pt.epsInr.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className="border-t border-slate-700/80 pt-1 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-300">FY Close Price:</span>
          <span className="text-slate-100">
            {pt.fyEndPriceInr !== null ? `₹${pt.fyEndPriceInr.toFixed(2)}` : '—'}
          </span>
        </div>
        {mode === 'PAYOUT_VS_PERF' ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-300">Price Perf (Base 100):</span>
              <span className="font-semibold text-amber-300">
                {pt.cumulativePerfBase100 !== null ? pt.cumulativePerfBase100.toFixed(1) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-300">Total Return (Base 100):</span>
              <span className="font-semibold text-emerald-300">
                {pt.totalReturnBase100 !== null ? pt.totalReturnBase100.toFixed(1) : '—'}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-300">Annual Price Return:</span>
            <span
              className={`font-semibold ${
                (pt.annualReturnPct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {pt.annualReturnPct !== null
                ? `${pt.annualReturnPct >= 0 ? '+' : ''}${pt.annualReturnPct.toFixed(1)}%`
                : '—'}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-300">Div Yield (on FY Close):</span>
          <span className="text-slate-200">
            {pt.dividendYieldOnClosePct !== null
              ? `${pt.dividendYieldOnClosePct.toFixed(2)}%`
              : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};

export const DividendHistoryChartCard: React.FC<DividendHistoryChartCardProps> = ({
  symbol,
  externalRefreshSeq = 0,
}) => {
  const [data, setData] = useState<DividendHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChartMode>('PAYOUT_VS_PERF');

  const loadDividends = useCallback(async (sym: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = refresh ? '?refresh=1' : '';
      const res = await fetch(
        `/api/stock/${encodeURIComponent(sym)}/dividends${qs}`
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json as DividendHistoryResponse);
    } catch (err) {
      setError((err as Error).message || 'Failed to load 5-year dividend history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDividends(symbol, false);
  }, [symbol, loadDividends]);

  useEffect(() => {
    if (externalRefreshSeq > 0) {
      void loadDividends(symbol, true);
    }
  }, [externalRefreshSeq, symbol, loadDividends]);

  const consistencyTone =
    data?.summary.payoutConsistencyLabel.includes('Consistent')
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : data?.summary.payoutConsistencyLabel.includes('Regular')
        ? 'text-blue-700 bg-blue-50 border-blue-200'
        : 'text-slate-700 bg-slate-100 border-slate-200';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Coins className="w-4 h-4 text-blue-700 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900">
              5-Year Dividend Payout History &amp; Long-Term Stock Performance
            </h3>
            {data && (
              <span
                className={`px-2 py-0.5 text-[11px] font-mono font-semibold border rounded ${consistencyTone}`}
              >
                {data.summary.payoutConsistencyLabel}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tracks 5 financial years of dividend payout ratios and cash DPS alongside price &amp; dividend-reinvested total return (Sources: Screener.in &amp; Yahoo Finance).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Dividend chart view mode"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs"
          >
            <button
              type="button"
              onClick={() => setMode('PAYOUT_VS_PERF')}
              aria-pressed={mode === 'PAYOUT_VS_PERF'}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'PAYOUT_VS_PERF'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Payout % vs 5Y Perf
            </button>
            <button
              type="button"
              onClick={() => setMode('DPS_VS_YOY')}
              aria-pressed={mode === 'DPS_VS_YOY'}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'DPS_VS_YOY'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Annual DPS (₹) vs YoY %
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadDividends(symbol, true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="h-64 flex items-center justify-center text-xs font-mono text-slate-500">
          Loading 5-year dividend payout &amp; stock performance history for {symbol}...
        </div>
      ) : data && data.years.length > 0 ? (
        <>
          {/* 4-Card Long-Term Holder KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">5Y Avg Payout Ratio</div>
              <div className="text-base font-bold font-mono tabular-nums text-blue-700 mt-0.5">
                {data.summary.avgPayoutRatio5yPct !== null
                  ? `${data.summary.avgPayoutRatio5yPct.toFixed(1)}%`
                  : '—'}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {(data.summary.avgPayoutRatio5yPct ?? 0) > 85
                  ? 'High distribution (>85%)'
                  : (data.summary.avgPayoutRatio5yPct ?? 0) >= 25
                    ? 'Balanced payout & retention'
                    : (data.summary.avgPayoutRatio5yPct ?? 0) > 0
                      ? 'Growth reinvestment bias'
                      : 'No / minimal payout'}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">5Y Total Cash Dividends</div>
              <div className="text-base font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                ₹{data.summary.totalDividends5yInr.toFixed(2)}
                <span className="text-[11px] font-normal text-slate-500"> / sh</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                Paid in {data.summary.consecutivePayingYears}/{data.years.length} FYs
                {data.summary.dividendCagrPct !== null
                  ? ` · DPS CAGR ${data.summary.dividendCagrPct >= 0 ? '+' : ''}${data.summary.dividendCagrPct.toFixed(1)}%`
                  : ''}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">5Y Price vs Total Return CAGR</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {data.summary.priceCagr5yPct !== null
                  ? `${data.summary.priceCagr5yPct >= 0 ? '+' : ''}${data.summary.priceCagr5yPct.toFixed(1)}%`
                  : '—'}
                <span className="text-xs font-semibold text-emerald-700 ml-1.5">
                  {data.summary.totalReturnCagr5yPct !== null
                    ? `(${data.summary.totalReturnCagr5yPct >= 0 ? '+' : ''}${data.summary.totalReturnCagr5yPct.toFixed(1)}% TR)`
                    : ''}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                Price CAGR vs Reinvested Divs
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">Latest FY DPS &amp; Yield</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {data.years[data.years.length - 1]?.dividendPerShareInr !== null
                  ? `₹${data.years[data.years.length - 1].dividendPerShareInr?.toFixed(2)}`
                  : '—'}
                {data.summary.latestDividendYieldPct !== null && (
                  <span className="text-xs font-semibold text-blue-700 ml-1.5">
                    ({data.summary.latestDividendYieldPct.toFixed(2)}%)
                  </span>
                )}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {data.years[data.years.length - 1]?.fyLabel || 'Latest FY'}
              </div>
            </div>
          </div>

          {/* Recharts Dual-Axis Chart */}
          <div className="w-full h-72 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              {mode === 'PAYOUT_VS_PERF' ? (
                <ComposedChart
                  data={data.years}
                  margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 11, fill: '#475569', fontFamily: 'monospace' }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#1D4ED8', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                    label={{
                      value: 'Payout %',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: 10, fill: '#64748B' },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v: number) => `${v}`}
                    tick={{ fontSize: 11, fill: '#0F172A', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    label={{
                      value: 'Perf (100)',
                      angle: 90,
                      position: 'insideRight',
                      style: { fontSize: 10, fill: '#64748B' },
                    }}
                  />
                  <Tooltip content={<DividendTooltip mode={mode} />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={100}
                    stroke="#94A3B8"
                    strokeDasharray="4 3"
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="payoutRatioPct"
                    name="Dividend Payout Ratio (%)"
                    fill="#3B82F6"
                    fillOpacity={0.85}
                    barSize={34}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativePerfBase100"
                    name="Price Perf (Base 100)"
                    stroke="#D97706"
                    strokeWidth={2.2}
                    dot={{ r: 4, fill: '#D97706', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="totalReturnBase100"
                    name="Total Return w/ Divs (Base 100)"
                    stroke="#059669"
                    strokeWidth={2.4}
                    dot={{ r: 4, fill: '#059669', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                    connectNulls
                  />
                </ComposedChart>
              ) : (
                <ComposedChart
                  data={data.years}
                  margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 11, fill: '#475569', fontFamily: 'monospace' }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v: number) => `₹${v}`}
                    tick={{ fontSize: 11, fill: '#059669', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#0F172A', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<DividendTooltip mode={mode} />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <ReferenceLine
                    yAxisId="right"
                    y={0}
                    stroke="#94A3B8"
                    strokeDasharray="4 3"
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="dividendPerShareInr"
                    name="Annual Dividend / Share (₹)"
                    fill="#10B981"
                    fillOpacity={0.85}
                    barSize={34}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="annualReturnPct"
                    name="Annual FY Price Return (%)"
                    stroke="#0F172A"
                    strokeWidth={2.2}
                    dot={{ r: 4, fill: '#0F172A', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                    connectNulls
                  />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* 5-Year Breakdown Table */}
          <div className="overflow-x-auto border-t border-slate-100 pt-3">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200 font-medium">
                  <th className="py-1.5 pr-3">Fiscal Year</th>
                  <th className="py-1.5 px-3 text-right">Payout Ratio</th>
                  <th className="py-1.5 px-3 text-right">DPS (₹)</th>
                  <th className="py-1.5 px-3 text-right">EPS (₹)</th>
                  <th className="py-1.5 px-3 text-right">FY Close (₹)</th>
                  <th className="py-1.5 px-3 text-right">FY Price Ret</th>
                  <th className="py-1.5 pl-3 text-right">Div Yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {data.years.map((y) => (
                  <tr key={y.fyEndIso} className="hover:bg-slate-50/70">
                    <td className="py-1.5 pr-3 font-sans font-medium text-slate-900">
                      {y.fyLabel}
                    </td>
                    <td className="py-1.5 px-3 text-right font-semibold text-blue-700">
                      {y.payoutRatioPct !== null ? `${y.payoutRatioPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right font-semibold text-emerald-700">
                      {y.dividendPerShareInr !== null
                        ? `₹${y.dividendPerShareInr.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right text-slate-700">
                      {y.epsInr !== null ? `₹${y.epsInr.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right text-slate-800">
                      {y.fyEndPriceInr !== null ? `₹${y.fyEndPriceInr.toFixed(2)}` : '—'}
                    </td>
                    <td
                      className={`py-1.5 px-3 text-right font-medium ${
                        (y.annualReturnPct ?? 0) >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                      }`}
                    >
                      {y.annualReturnPct !== null
                        ? `${y.annualReturnPct >= 0 ? '+' : ''}${y.annualReturnPct.toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="py-1.5 pl-3 text-right text-slate-600">
                      {y.dividendYieldOnClosePct !== null
                        ? `${y.dividendYieldOnClosePct.toFixed(2)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent Ex-Dividend Payout Events */}
          {data.recentEvents.length > 0 && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span className="font-sans font-medium text-slate-500 mr-1">
                Recent Ex-Dates:
              </span>
              {data.recentEvents.slice(0, 6).map((ev) => (
                <span
                  key={`${ev.exDate}-${ev.amountInr}`}
                  className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-700 tabular-nums"
                >
                  {ev.exDate}: <strong className="text-emerald-700">₹{ev.amountInr.toFixed(2)}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="py-6 text-center text-xs text-slate-500">
          No 5-year dividend or annual price records found for {symbol}.
        </div>
      )}
    </div>
  );
};
