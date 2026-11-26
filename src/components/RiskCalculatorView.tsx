import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { RiskInput, RiskResult } from '../types/trading';

interface RiskCalculatorViewProps {
  prefill?: {
    symbol: string;
    entryPrice: number;
    stopLoss: number;
    targetPrice?: number | null;
  } | null;
}

export const RiskCalculatorView: React.FC<RiskCalculatorViewProps> = ({ prefill }) => {
  const [input, setInput] = useState<RiskInput>({
    symbol: prefill?.symbol || '360ONE',
    accountEquityInr: 1000000,
    riskPerTradePct: 1.0,
    maxSinglePositionPct: 15.0,
    maxSectorExposurePct: 30.0,
    maxTotalExposurePct: 75.0,
    maxStopDistancePct: 8.0,
    currentTotalExposurePct: 20.0,
    currentSectorExposurePct: 0.0,
    maxOpenPositions: 8,
    currentOpenPositions: 2,
    entryPrice: prefill?.entryPrice || 1175.0,
    stopLoss: prefill?.stopLoss || 1095.0,
    targetPrice: prefill?.targetPrice ?? 1360.0,
  });

  const [result, setResult] = useState<RiskResult | null>(null);

  useEffect(() => {
    if (prefill) {
      setInput((prev) => ({
        ...prev,
        symbol: prefill.symbol,
        entryPrice: prefill.entryPrice,
        stopLoss: prefill.stopLoss,
        targetPrice: prefill.targetPrice ?? prev.targetPrice,
      }));
    }
  }, [prefill]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/risk/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (res.ok) {
          setResult(await res.json());
        }
      } catch {
        // ignore abort
      }
    })();
    return () => controller.abort();
  }, [input]);

  const updateNum = (field: keyof RiskInput, raw: string) => {
    const num = raw === '' ? 0 : Number(raw);
    setInput((prev) => ({ ...prev, [field]: Number.isFinite(num) ? num : 0 }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Configuration Inputs */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Fail-Closed Position Sizing &amp; Portfolio Risk Controls
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Replicates risk_controls.py rules: sizes shares to risk budget, caps by single-position, sector, total exposure, and max stop distance.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-600 font-medium mb-1">Symbol</label>
            <input
              type="text"
              value={input.symbol || ''}
              onChange={(e) => setInput((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))}
              className="w-full px-3 py-2 font-mono uppercase bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Entry Price (₹)</label>
            <input
              type="number"
              step="0.05"
              value={input.entryPrice}
              onChange={(e) => updateNum('entryPrice', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Stop Loss (₹)</label>
            <input
              type="number"
              step="0.05"
              value={input.stopLoss}
              onChange={(e) => updateNum('stopLoss', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Target Price (₹, optional)</label>
            <input
              type="number"
              step="0.05"
              value={input.targetPrice ?? ''}
              onChange={(e) =>
                setInput((p) => ({
                  ...p,
                  targetPrice: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Account Equity (₹)</label>
            <input
              type="number"
              step="10000"
              value={input.accountEquityInr}
              onChange={(e) => updateNum('accountEquityInr', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Risk Per Trade (%)</label>
            <input
              type="number"
              step="0.1"
              value={input.riskPerTradePct}
              onChange={(e) => updateNum('riskPerTradePct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Max Stop Distance (%)</label>
            <input
              type="number"
              step="0.5"
              value={input.maxStopDistancePct}
              onChange={(e) => updateNum('maxStopDistancePct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Max Single Position (%)</label>
            <input
              type="number"
              step="1"
              value={input.maxSinglePositionPct}
              onChange={(e) => updateNum('maxSinglePositionPct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Max Total Exposure (%)</label>
            <input
              type="number"
              step="5"
              value={input.maxTotalExposurePct}
              onChange={(e) => updateNum('maxTotalExposurePct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Current Total Exposure (%)</label>
            <input
              type="number"
              step="1"
              value={input.currentTotalExposurePct}
              onChange={(e) => updateNum('currentTotalExposurePct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Max Sector Exposure (%)</label>
            <input
              type="number"
              step="1"
              value={input.maxSectorExposurePct}
              onChange={(e) => updateNum('maxSectorExposurePct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Current Sector Exposure (%)</label>
            <input
              type="number"
              step="1"
              value={input.currentSectorExposurePct}
              onChange={(e) => updateNum('currentSectorExposurePct', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Max Open Positions</label>
            <input
              type="number"
              step="1"
              value={input.maxOpenPositions}
              onChange={(e) => updateNum('maxOpenPositions', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-medium mb-1">Current Open Positions</label>
            <input
              type="number"
              step="1"
              value={input.currentOpenPositions}
              onChange={(e) => updateNum('currentOpenPositions', e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Sizing Decision Output */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Position Sizing Output</h3>
          {result && (
            <span
              className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                result.status === 'PASS'
                  ? 'text-emerald-700'
                  : result.status === 'WAIT_FOR_DATA'
                    ? 'text-amber-700'
                    : 'text-rose-700'
              }`}
            >
              {result.status === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : result.status === 'WAIT_FOR_DATA' ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {result.status}
            </span>
          )}
        </div>

        {result && (
          <>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-xs text-slate-500">Recommended Shares ({input.symbol || 'TRADE'})</div>
              <div className="text-3xl font-bold font-mono text-slate-900 mt-1">
                {result.recommendedShares.toLocaleString()}
              </div>
              <div className="text-xs font-mono text-slate-600 mt-1">
                Position Value: ₹{result.positionValueInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({result.positionPctOfEquity.toFixed(2)}% of equity)
              </div>
            </div>

            <dl className="divide-y divide-slate-100 text-xs">
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Stop Distance</dt>
                <dd className="font-mono text-slate-900">
                  {result.stopDistanceInr !== null
                    ? `₹${result.stopDistanceInr.toFixed(2)} (${result.stopDistancePct?.toFixed(2)}%)`
                    : '—'}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Actual Trade Risk</dt>
                <dd className="font-mono text-slate-900">
                  ₹{result.actualRiskInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({result.actualRiskPct.toFixed(2)}%)
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Reward : Risk</dt>
                <dd className="font-mono text-slate-900">
                  {result.rewardRiskRatio !== null ? `${result.rewardRiskRatio.toFixed(2)}R` : '—'}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Projected Total Exposure</dt>
                <dd className="font-mono text-slate-900">
                  {result.projectedTotalExposurePct.toFixed(2)}% / {input.maxTotalExposurePct}%
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Cap: Risk / Single / Total / Sector</dt>
                <dd className="font-mono text-slate-600">
                  {result.rawSharesByRisk} / {result.maxSharesBySingleCap} / {result.maxSharesByTotalExposure} / {result.maxSharesBySectorExposure}
                </dd>
              </div>
            </dl>

            <div className="space-y-2 text-xs">
              {result.statusReasons.map((r, i) => (
                <div key={i} className="p-2.5 bg-slate-50 border border-slate-200 rounded text-slate-700">
                  {r}
                </div>
              ))}
              {result.warnings.map((w, i) => (
                <div key={i} className="p-2.5 bg-amber-50 border border-amber-200 rounded text-amber-800">
                  {w}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
