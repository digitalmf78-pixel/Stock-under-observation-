import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  AiStrategyAdvisorResult,
  BotStockAnalysis,
  LiveStockQuote,
  StockDetailData,
  StrategyAdvisorParams,
} from '../types/trading';
import { classifyBurstPowerProfile } from '../utils/burstPowerProfile';

interface AiStrategyAdvisorProps {
  stock: StockDetailData;
  liveQuote: LiveStockQuote | null;
  botAnalysis: BotStockAnalysis | null;
}

const DEFAULT_PARAMS: StrategyAdvisorParams = {
  zoneTolerancePct: 2,
  minDeliveryPct: 60,
  minRvol: 1.5,
  minUpwardBurst: 10,
  blockDistributionTrend: true,
};

export const AiStrategyAdvisor: React.FC<AiStrategyAdvisorProps> = ({
  stock,
  liveQuote,
  botAnalysis,
}) => {
  const symbol = stock.summary.symbol;
  const [params, setParams] = useState<StrategyAdvisorParams>(DEFAULT_PARAMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiStrategyAdvisorResult | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [symbol]);

  const burstProfile = useMemo(
    () => (botAnalysis ? classifyBurstPowerProfile(botAnalysis.phase4Movement) : null),
    [botAnalysis]
  );

  const epsPrev = stock.fundamentals?.epsPrev ?? null;
  const epsCurr = stock.fundamentals?.epsCurr ?? null;
  const epsDrop =
    epsPrev !== null && epsCurr !== null ? Number((epsPrev - epsCurr).toFixed(2)) : null;

  const livePrice =
    liveQuote?.available && liveQuote.livePrice !== null ? liveQuote.livePrice : null;

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stock/${encodeURIComponent(symbol)}/strategy-advisor`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setResult(json as AiStrategyAdvisorResult);
    } catch (err) {
      setError((err as Error).message || 'Failed to generate AI Strategy Advisor analysis.');
    } finally {
      setLoading(false);
    }
  };

  const recStyles = (rec: AiStrategyAdvisorResult['recommendation']) => {
    if (rec === 'BUY') {
      return 'bg-emerald-600 text-white border-emerald-700';
    }
    if (rec === 'AVOID') {
      return 'bg-rose-600 text-white border-rose-700';
    }
    return 'bg-amber-500 text-white border-amber-600';
  };

  const statusBadge = (status: 'PASS' | 'FAIL' | 'WATCH' | 'MISSING') => {
    if (status === 'PASS') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5" />
          PASS
        </span>
      );
    }
    if (status === 'FAIL') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-rose-700">
          <XCircle className="w-3.5 h-3.5" />
          FAIL
        </span>
      );
    }
    if (status === 'WATCH') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5" />
          WATCH
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-slate-500">
        <AlertTriangle className="w-3.5 h-3.5" />
        MISSING
      </span>
    );
  };

  return (
    <section
      aria-label="AI Strategy Advisor"
      className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              AI Strategy Advisor · U-Turn Viability &amp; Burst Alignment
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Compares live price, EPS drop valuation, and 252D Burst Power Profile against your strategy parameters for an automated Buy / Hold / Avoid verdict.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
          {loading ? 'Evaluating Strategy...' : 'Run AI Strategy Advisor'}
        </button>
      </div>

      {/* Live Comparison Inputs Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-blue-700" />
            <span>Price Snapshot</span>
          </div>
          <div className="font-mono font-bold text-slate-900 mt-1">
            {livePrice !== null ? `Live ₹${livePrice.toFixed(2)}` : `EOD ₹${stock.summary.closePrice.toFixed(2)}`}
            <span className="font-normal text-slate-500 ml-1.5 text-[11px]">
              (EOD ₹{stock.summary.closePrice.toFixed(2)})
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-600 mt-0.5">
            Deliv {stock.summary.delivPer !== null ? `${stock.summary.delivPer.toFixed(1)}%` : 'N/A'} · RVOL{' '}
            {stock.summary.rvol !== null ? `${stock.summary.rvol.toFixed(2)}x` : 'N/A'}
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1">
            <Target className="w-3.5 h-3.5 text-blue-700" />
            <span>EPS Drop &amp; U-Turn Context</span>
          </div>
          <div className="font-mono font-bold text-slate-900 mt-1">
            {epsDrop !== null
              ? epsDrop > 0
                ? `EPS Drop ₹${epsDrop.toFixed(2)} (${epsPrev?.toFixed(2)} → ${epsCurr?.toFixed(2)})`
                : `No EPS Drop (${epsPrev?.toFixed(2)} → ${epsCurr?.toFixed(2)})`
              : 'EPS DATA NOT AVAILABLE'}
          </div>
          <div className="text-[11px] font-mono text-slate-600 mt-0.5">
            U-Turn: {stock.summary.uTurnStatus || 'MONITOR'}
            {stock.summary.uTurnTarget !== null ? ` · Target ₹${stock.summary.uTurnTarget.toFixed(2)}` : ''}
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-blue-700" />
            <span>252D Burst Power Profile</span>
          </div>
          <div className="font-mono font-bold text-slate-900 mt-1">
            {burstProfile ? burstProfile.category : 'Evaluating 252D Profile...'}
          </div>
          <div className="text-[11px] font-mono text-slate-600 mt-0.5">
            {burstProfile && burstProfile.upwardNorm !== null
              ? `Up ${burstProfile.upwardNorm.toFixed(1)}% · Dn ${burstProfile.downwardNorm?.toFixed(1)}% · Net ${
                  (burstProfile.netNorm ?? 0) >= 0 ? '+' : ''
                }${burstProfile.netNorm?.toFixed(1)}% (${burstProfile.upwardSharePct}%/${burstProfile.downwardSharePct}% split)`
              : 'Waiting for 252D OHLCV metrics'}
          </div>
        </div>
      </div>

      {/* User Strategy Parameters Bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700" />
            <span>Your Strategy Parameters</span>
          </div>
          <button
            type="button"
            onClick={() => setParams(DEFAULT_PARAMS)}
            className="text-[11px] font-medium text-blue-700 hover:underline"
          >
            Reset Defaults
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
          <div>
            <span className="block text-[11px] text-slate-500 mb-1">U-Turn Zone Band</span>
            <div className="inline-flex w-full p-0.5 bg-slate-200/80 rounded">
              {([2, 3] as const).map((tol) => (
                <button
                  key={tol}
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, zoneTolerancePct: tol }))}
                  className={`flex-1 py-1 text-xs font-mono rounded ${
                    params.zoneTolerancePct === tol
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ±{tol}%
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">Min Delivery %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={params.minDeliveryPct}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  minDeliveryPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                }))
              }
              className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 font-mono text-slate-900"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">Min RVOL (x)</span>
            <input
              type="number"
              min={0.5}
              max={5}
              step={0.1}
              value={params.minRvol}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  minRvol: Math.max(0.1, Math.min(10, Number(e.target.value) || 0.1)),
                }))
              }
              className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 font-mono text-slate-900"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">Min 252D Upward Burst %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={params.minUpwardBurst}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  minUpwardBurst: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                }))
              }
              className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 font-mono text-slate-900"
            />
          </label>

          <label className="flex items-center gap-2 pt-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={params.blockDistributionTrend}
              onChange={(e) =>
                setParams((p) => ({ ...p, blockDistributionTrend: e.target.checked }))
              }
              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            <span className="text-[11px] font-medium text-slate-700">
              Block Distribution Trend
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
          {error}
        </div>
      )}

      {result && (
        <div className="pt-3 border-t border-slate-200 space-y-4">
          {/* Verdict Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`px-3 py-1 font-mono text-xs font-bold rounded border ${recStyles(
                  result.recommendation
                )}`}
              >
                RECOMMENDATION: {result.recommendation}
              </span>
              <span className="px-2.5 py-1 font-mono text-[11px] font-semibold rounded border bg-white border-slate-200 text-slate-800">
                U-Turn Viability: {result.uTurnViability.replace(/_/g, ' ')}
              </span>
              <span className="px-2.5 py-1 font-mono text-[11px] font-medium rounded border bg-white border-slate-200 text-slate-600">
                Confidence: {result.confidence}
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-500">
              {result.model} · {new Date(result.generatedAtUtc).toLocaleTimeString()}
            </div>
          </div>

          {/* Executive Summary */}
          <p className="text-xs leading-relaxed text-slate-800 bg-blue-50/40 border border-blue-200 rounded-md p-3.5">
            {result.executiveSummary}
          </p>

          {/* 3-Pillar Assessment */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="border border-slate-200 rounded-md p-3 space-y-1">
              <div className="font-semibold text-slate-900">Live Price vs U-Turn Zone</div>
              <p className="text-slate-600 leading-relaxed">{result.livePriceVsUTurnAnalysis}</p>
            </div>
            <div className="border border-slate-200 rounded-md p-3 space-y-1">
              <div className="font-semibold text-slate-900">EPS Drop &amp; Valuation</div>
              <p className="text-slate-600 leading-relaxed">{result.epsDropAssessment}</p>
            </div>
            <div className="border border-slate-200 rounded-md p-3 space-y-1">
              <div className="font-semibold text-slate-900">252D Burst Power Profile</div>
              <p className="text-slate-600 leading-relaxed">{result.burstProfileAssessment}</p>
            </div>
          </div>

          {/* Strategy Parameter Alignment Table */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-xs text-slate-800">
              Strategy Parameter Alignment Check
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                    <th className="py-2 px-3">Parameter</th>
                    <th className="py-2 px-3">Your Rule</th>
                    <th className="py-2 px-3">Actual Stock Data</th>
                    <th className="py-2 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.parameterAlignment.map((row) => (
                    <tr key={row.parameter}>
                      <td className="py-2 px-3 font-medium text-slate-800">{row.parameter}</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                        {row.userRule}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-900">
                        {row.actualValue}
                      </td>
                      <td className="py-2 px-3 text-right">{statusBadge(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Plan & Risks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="border border-slate-200 rounded-md p-3 bg-slate-50/40 space-y-1">
              <div className="font-semibold text-slate-900">Recommended Action Plan</div>
              <p className="text-slate-700 leading-relaxed">{result.actionPlan}</p>
            </div>
            <div className="border border-slate-200 rounded-md p-3 bg-slate-50/40 space-y-1">
              <div className="font-semibold text-rose-800">Key Risks &amp; Invalidation</div>
              <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                {result.keyRisks.length > 0 ? (
                  result.keyRisks.map((rk, idx) => <li key={idx}>{rk}</li>)
                ) : (
                  <li>Monitor stop-loss discipline and quarterly EPS revisions.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
