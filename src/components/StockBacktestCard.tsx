import React, { useEffect, useMemo, useState } from 'react';
import { History, Play } from 'lucide-react';
import type {
  BacktestResult,
  BacktestSignalScope,
  BacktestStopMode,
} from '../types/trading';

interface StockBacktestCardProps {
  symbol: string;
}

export const StockBacktestCard: React.FC<StockBacktestCardProps> = ({ symbol }) => {
  const [holdDays, setHoldDays] = useState<number>(10);
  const [targetR, setTargetR] = useState<number>(2);
  const [stopMode, setStopMode] = useState<BacktestStopMode>('ATR_1_5');
  const [signalScope, setSignalScope] = useState<BacktestSignalScope>('ALL_6M');

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          holdDays: String(holdDays),
          targetR: String(targetR),
          stopMode,
          signalScope,
        });
        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/backtest?${qs.toString()}`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setResult(json);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Backtest request failed.');
          setResult(null);
        }
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [symbol, holdDays, targetR, stopMode, signalScope]);

  const equityCurve = useMemo(() => {
    if (!result) return null;
    const closedChrono = [...result.trades]
      .filter((t) => t.outcome !== 'OPEN')
      .reverse();
    if (closedChrono.length < 2) return null;

    const points = [{ label: 'Start', cumR: 0 }, ...closedChrono.map((t) => ({ label: t.exitDate, cumR: t.cumR }))];
    const width = 460;
    const height = 74;
    const padX = 12;
    const padY = 10;
    const vals = points.map((p) => p.cumR);
    const minV = Math.min(0, ...vals);
    const maxV = Math.max(0.5, ...vals);
    const span = Math.max(maxV - minV, 0.5);

    const xFor = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
    const yFor = (v: number) => padY + (1 - (v - minV) / span) * (height - padY * 2);

    const polyline = points.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.cumR).toFixed(1)}`).join(' ');
    const zeroY = yFor(0);
    const finalR = points[points.length - 1].cumR;

    return { width, height, polyline, zeroY, finalR, padX };
  }, [result]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-blue-700" />
            6-Month Delivery A/B Breakout Backtester ({symbol})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {result
              ? `${result.coverage.sourceLabel} · Window ${result.coverage.fromDate} to ${result.coverage.toDate} · Lookahead-free Next-Open Entry`
              : 'Evaluating 6-month historical breakout win rate and realized Risk:Reward ratio...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600">
            <span>Hold</span>
            <select
              value={holdDays}
              onChange={(e) => setHoldDays(Number(e.target.value))}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value={5}>5D</option>
              <option value={10}>10D</option>
              <option value={15}>15D</option>
              <option value={20}>20D</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-600">
            <span>Target</span>
            <select
              value={targetR}
              onChange={(e) => setTargetR(Number(e.target.value))}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value={1.5}>1.5R</option>
              <option value={2}>2.0R</option>
              <option value={2.5}>2.5R</option>
              <option value={3}>3.0R</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-600">
            <span>Stop</span>
            <select
              value={stopMode}
              onChange={(e) => setStopMode(e.target.value as BacktestStopMode)}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ATR_1_5">1.5x ATR14 (Cap 8%)</option>
              <option value="PCT_5">Fixed 5%</option>
              <option value="PCT_7">Fixed 7%</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-600">
            <span>Scope</span>
            <select
              value={signalScope}
              onChange={(e) => setSignalScope(e.target.value as BacktestSignalScope)}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL_6M">All 6M Breakouts</option>
              <option value="DELIV_AB_ONLY">NSE Deliv A/B Only</option>
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-500">
          Running 6-month breakout simulation for {symbol}...
        </div>
      ) : error || !result ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
          {error || 'Unable to compute backtest.'}
        </div>
      ) : (
        <>
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
              <div className="text-slate-500">Historical Win Rate</div>
              <div
                className={`mt-1 text-lg font-bold font-mono ${
                  result.metrics.winRatePct === null
                    ? 'text-slate-400'
                    : result.metrics.winRatePct >= 50
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                }`}
              >
                {result.metrics.winRatePct !== null ? `${result.metrics.winRatePct.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {result.metrics.wins}W / {result.metrics.losses}L ({result.metrics.closedTrades} closed)
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
              <div className="text-slate-500">Avg Realized R:R</div>
              <div className="mt-1 text-lg font-bold font-mono text-slate-900">
                {result.metrics.avgRiskRewardRatio !== null
                  ? `${result.metrics.avgRiskRewardRatio.toFixed(2)} : 1`
                  : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Expectancy:{' '}
                {result.metrics.expectancyR !== null
                  ? `${result.metrics.expectancyR >= 0 ? '+' : ''}${result.metrics.expectancyR.toFixed(2)}R`
                  : '—'}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
              <div className="text-slate-500">Profit Factor</div>
              <div
                className={`mt-1 text-lg font-bold font-mono ${
                  result.metrics.profitFactor === null
                    ? 'text-slate-400'
                    : result.metrics.profitFactor >= 1.5
                      ? 'text-emerald-700'
                      : result.metrics.profitFactor >= 1
                        ? 'text-slate-900'
                        : 'text-rose-700'
                }`}
              >
                {result.metrics.profitFactor !== null ? result.metrics.profitFactor.toFixed(2) : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Win {result.metrics.avgWinPct !== null ? `+${result.metrics.avgWinPct}%` : '—'} · Loss{' '}
                {result.metrics.avgLossPct !== null ? `${result.metrics.avgLossPct}%` : '—'}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
              <div className="text-slate-500">6M Compounded Ret</div>
              <div
                className={`mt-1 text-lg font-bold font-mono ${
                  result.metrics.compoundedReturnPct === null
                    ? 'text-slate-400'
                    : result.metrics.compoundedReturnPct >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                }`}
              >
                {result.metrics.compoundedReturnPct !== null
                  ? `${result.metrics.compoundedReturnPct >= 0 ? '+' : ''}${result.metrics.compoundedReturnPct.toFixed(2)}%`
                  : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Max DD:{' '}
                {result.metrics.maxDrawdownPct !== null
                  ? `-${result.metrics.maxDrawdownPct.toFixed(2)}%`
                  : '—'}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
              <div className="text-slate-500">Signals Tested</div>
              <div className="mt-1 text-lg font-bold font-mono text-blue-700">
                {result.metrics.totalSignals}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {result.metrics.verifiedDelivSignals} Deliv A/B · {result.metrics.proxySignals} 6M RVOL
              </div>
            </div>
          </div>

          {/* Cumulative R Equity Strip */}
          {equityCurve && (
            <div className="bg-slate-50/70 border border-slate-200/70 rounded-md px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs">
                <span className="font-medium text-slate-700">Cumulative Risk Multiple (R)</span>
                <span className="ml-2 font-mono font-semibold text-slate-900">
                  {equityCurve.finalR >= 0 ? `+${equityCurve.finalR.toFixed(2)}R` : `${equityCurve.finalR.toFixed(2)}R`}
                </span>
                <span className="ml-2 text-[11px] text-slate-500">
                  Avg Hold: {result.metrics.avgHoldDays ?? '—'}d
                </span>
              </div>
              <svg
                viewBox={`0 0 ${equityCurve.width} ${equityCurve.height}`}
                className="w-full sm:w-80 h-14 shrink-0"
              >
                <line
                  x1={equityCurve.padX}
                  x2={equityCurve.width - equityCurve.padX}
                  y1={equityCurve.zeroY}
                  y2={equityCurve.zeroY}
                  stroke="#CBD5E1"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <polyline
                  fill="none"
                  stroke={equityCurve.finalR >= 0 ? '#059669' : '#E11D48'}
                  strokeWidth="2"
                  points={equityCurve.polyline}
                />
              </svg>
            </div>
          )}

          {/* Simulated Trades Table */}
          {result.trades.length === 0 ? (
            <div className="p-5 bg-slate-50 border border-slate-200/80 rounded-md text-xs text-slate-600 flex items-center gap-2">
              <Play className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              No qualifying {signalScope === 'DELIV_AB_ONLY' ? 'NSE Delivery A/B ' : ''}breakout signals fired for {symbol} in the selected window ({result.coverage.fromDate} to {result.coverage.toDate}).
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                    <th className="py-2 px-3">Signal</th>
                    <th className="py-2 px-3">Entry → Exit</th>
                    <th className="py-2 px-3">Basis</th>
                    <th className="py-2 px-3 text-right">Deliv / RVOL</th>
                    <th className="py-2 px-3 text-right">Entry ₹</th>
                    <th className="py-2 px-3 text-right">Stop / Target</th>
                    <th className="py-2 px-3 text-right">Exit ₹</th>
                    <th className="py-2 px-3">Outcome</th>
                    <th className="py-2 px-3 text-right">Return %</th>
                    <th className="py-2 px-3 text-right">Realized R</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.trades.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                        {t.signalDate}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {t.entryDate} → {t.exitDate}
                        <span className="text-slate-400 ml-1">({t.barsHeld}d)</span>
                      </td>
                      <td className="py-2 px-3 font-mono whitespace-nowrap">
                        <span
                          className={
                            t.signalBasis === 'VERIFIED_DELIV_AB'
                              ? 'text-blue-700 font-medium'
                              : 'text-slate-500'
                          }
                        >
                          {t.signalBasis === 'VERIFIED_DELIV_AB'
                            ? `DELIV ${t.deliveryCategory}`
                            : '6M RVOL PROXY'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                        {t.delivPer !== null ? `${t.delivPer.toFixed(0)}%` : '—'} ·{' '}
                        {t.rvol !== null ? `${t.rvol.toFixed(1)}x` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-900">
                        {t.entryPrice.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500 whitespace-nowrap">
                        {t.stopLoss.toFixed(1)} / {t.targetPrice.toFixed(1)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-900">
                        {t.exitPrice.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 font-mono whitespace-nowrap">
                        <span
                          className={
                            t.outcome === 'TARGET_HIT'
                              ? 'text-emerald-700 font-semibold'
                              : t.outcome === 'STOP_HIT'
                                ? 'text-rose-700 font-semibold'
                                : t.outcome === 'OPEN'
                                  ? 'text-blue-700'
                                  : 'text-slate-700'
                          }
                        >
                          {t.outcome}
                        </span>
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono font-medium ${
                          t.returnPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {t.returnPct >= 0 ? '+' : ''}
                        {t.returnPct.toFixed(2)}%
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono font-semibold ${
                          t.realizedR > 0
                            ? 'text-emerald-700'
                            : t.realizedR < 0
                              ? 'text-rose-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {t.realizedR > 0 ? '+' : ''}
                        {t.realizedR.toFixed(2)}R
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};
