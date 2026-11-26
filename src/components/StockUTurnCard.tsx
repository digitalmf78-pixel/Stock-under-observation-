import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock,
  RotateCcw,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import type {
  TurnaroundTopEvaluation,
  TurnaroundTopSessionCheck,
  TurnaroundTopStatus,
  UTurnEvaluation,
  UTurnSessionCheck,
  UTurnStatus,
} from '../types/trading';

interface StockUTurnCardProps {
  symbol: string;
  onSendToRisk?: (symbol: string, entryPrice: number, stopLoss: number) => void;
}

const PRESET_PCTS = [8, 10, 12, 15, 20];

const STATUS_STYLE: Record<
  UTurnStatus,
  { banner: string; text: string; badge: string }
> = {
  CONFIRMED_SUPPORT: {
    banner: 'bg-emerald-50/70 border-emerald-200',
    text: 'text-emerald-800',
    badge: 'text-emerald-700',
  },
  ACTIVE_TRIGGER: {
    banner: 'bg-blue-50/70 border-blue-200',
    text: 'text-blue-900',
    badge: 'text-blue-700',
  },
  SUPPORT_HOLD: {
    banner: 'bg-teal-50/70 border-teal-200',
    text: 'text-teal-900',
    badge: 'text-teal-700',
  },
  IN_ZONE: {
    banner: 'bg-amber-50/70 border-amber-200',
    text: 'text-amber-900',
    badge: 'text-amber-700',
  },
  BROKEN_DOWN: {
    banner: 'bg-rose-50/70 border-rose-200',
    text: 'text-rose-900',
    badge: 'text-rose-700',
  },
  ABOVE_ZONE: {
    banner: 'bg-slate-50 border-slate-200',
    text: 'text-slate-800',
    badge: 'text-slate-600',
  },
};

const TOP_STATUS_STYLE: Record<
  TurnaroundTopStatus,
  { banner: string; text: string; badge: string }
> = {
  CONFIRMED_TOP: {
    banner: 'bg-rose-50/70 border-rose-200',
    text: 'text-rose-900',
    badge: 'text-rose-700',
  },
  ACTIVE_TOP_TRIGGER: {
    banner: 'bg-amber-50/80 border-amber-200',
    text: 'text-amber-900',
    badge: 'text-amber-800',
  },
  TOP_ZONE_WATCH: {
    banner: 'bg-amber-50/50 border-amber-200',
    text: 'text-amber-900',
    badge: 'text-amber-700',
  },
  TOP_BREAKOUT: {
    banner: 'bg-emerald-50/70 border-emerald-200',
    text: 'text-emerald-800',
    badge: 'text-emerald-700',
  },
  BELOW_TOP_ZONE: {
    banner: 'bg-slate-50 border-slate-200',
    text: 'text-slate-800',
    badge: 'text-slate-600',
  },
};

function formatActionLabel(action: UTurnSessionCheck['action']): {
  label: string;
  cls: string;
} {
  switch (action) {
    case 'IN_ZONE_TRIGGER':
      return { label: 'ZONE + VOL/DELIV TRIGGER', cls: 'text-blue-700 font-semibold' };
    case 'BOUNCED_ABOVE':
      return { label: 'BOUNCED ABOVE ZONE', cls: 'text-emerald-700 font-semibold' };
    case 'HELD_SUPPORT':
      return { label: 'HELD SUPPORT', cls: 'text-emerald-700 font-medium' };
    case 'BROKE_BELOW':
      return { label: 'BROKE ZONE LOW', cls: 'text-rose-700 font-semibold' };
    case 'IN_ZONE':
    default:
      return { label: 'IN ZONE', cls: 'text-amber-700 font-medium' };
  }
}

function formatTopActionLabel(action: TurnaroundTopSessionCheck['action']): {
  label: string;
  cls: string;
} {
  switch (action) {
    case 'TOP_TRIGGER':
      return { label: 'EXHAUSTION (HIGH RVOL + LOW DELIV)', cls: 'text-amber-800 font-semibold' };
    case 'TOP_REJECTION':
      return { label: 'TOP REJECTION / DISTRIBUTION', cls: 'text-rose-700 font-semibold' };
    case 'TOP_BREAKOUT':
      return { label: 'BREAKOUT (DELIV >= 50%)', cls: 'text-emerald-700 font-semibold' };
    case 'TOP_ZONE':
    default:
      return { label: 'IN TOP ZONE', cls: 'text-amber-700 font-medium' };
  }
}

export const StockUTurnCard: React.FC<StockUTurnCardProps> = ({ symbol, onSendToRisk }) => {
  const [strategy, setStrategy] = useState<'BOTTOM' | 'TOP'>('BOTTOM');
  const [userPickedStrategy, setUserPickedStrategy] = useState<boolean>(false);

  // Bottom U-Turn State
  const [correctionMode, setCorrectionMode] = useState<'AUTO' | 'EPS_VALUATION' | 'PCT' | 'INR'>(
    'AUTO'
  );
  const [zoneTolerancePct, setZoneTolerancePct] = useState<2 | 3>(2);
  const [correctionPctInput, setCorrectionPctInput] = useState<string>('10');
  const [correctionInrInput, setCorrectionInrInput] = useState<string>('');
  const [customPeakInput, setCustomPeakInput] = useState<string>('');
  const [epsPrevInput, setEpsPrevInput] = useState<string>('');
  const [epsCurrInput, setEpsCurrInput] = useState<string>('');
  const [avgPeInput, setAvgPeInput] = useState<string>('');

  const [data, setData] = useState<UTurnEvaluation | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Turnaround Top State
  const [topEffectiveEpsInput, setTopEffectiveEpsInput] = useState<string>('');
  const [topPeakPeInput, setTopPeakPeInput] = useState<string>('');
  const [topData, setTopData] = useState<TurnaroundTopEvaluation | null>(null);
  const [topLoading, setTopLoading] = useState<boolean>(false);
  const [topError, setTopError] = useState<string | null>(null);

  // Reset overrides when switching symbol
  useEffect(() => {
    setStrategy('BOTTOM');
    setUserPickedStrategy(false);
    setCustomPeakInput('');
    setCorrectionInrInput('');
    setEpsPrevInput('');
    setEpsCurrInput('');
    setAvgPeInput('');
    setCorrectionMode('AUTO');
    setTopEffectiveEpsInput('');
    setTopPeakPeInput('');
    setTopData(null);
    setTopError(null);
  }, [symbol]);

  // Fetch Bottom U-Turn Evaluation
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          zoneTolerancePct: String(zoneTolerancePct),
        });
        if (correctionMode !== 'AUTO') {
          qs.set('correctionMode', correctionMode);
        }
        const peakNum = Number(customPeakInput);
        if (customPeakInput.trim() !== '' && Number.isFinite(peakNum) && peakNum > 0) {
          qs.set('peakPrice', String(peakNum));
        }

        if (correctionMode === 'EPS_VALUATION' || correctionMode === 'AUTO') {
          if (epsPrevInput.trim() !== '' && Number.isFinite(Number(epsPrevInput))) {
            qs.set('epsPrev', epsPrevInput.trim());
          }
          if (epsCurrInput.trim() !== '' && Number.isFinite(Number(epsCurrInput))) {
            qs.set('epsCurr', epsCurrInput.trim());
          }
          if (
            avgPeInput.trim() !== '' &&
            Number.isFinite(Number(avgPeInput)) &&
            Number(avgPeInput) > 0
          ) {
            qs.set('avgPeRatio', avgPeInput.trim());
          }
        }
        if (correctionMode === 'INR') {
          const inrNum = Number(correctionInrInput);
          if (correctionInrInput.trim() !== '' && Number.isFinite(inrNum) && inrNum > 0) {
            qs.set('correctionInr', String(inrNum));
          }
        } else if (correctionMode === 'PCT') {
          const pctNum = Number(correctionPctInput);
          if (correctionPctInput.trim() !== '' && Number.isFinite(pctNum) && pctNum > 0) {
            qs.set('correctionPct', String(pctNum));
          }
        }

        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/uturn?${qs.toString()}`,
          { signal: controller.signal }
        );
        const json: UTurnEvaluation & { error?: string } = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);

        // If live quarterly EPS actually jumped instead of dropping, auto-switch to Turnaround Top on initial load
        if (
          !userPickedStrategy &&
          correctionMode === 'AUTO' &&
          json.epsPrev !== null &&
          json.epsCurr !== null &&
          json.epsCurr > json.epsPrev
        ) {
          setStrategy('TOP');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'U-Turn evaluation failed.');
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    symbol,
    correctionMode,
    zoneTolerancePct,
    correctionPctInput,
    correctionInrInput,
    customPeakInput,
    epsPrevInput,
    epsCurrInput,
    avgPeInput,
    userPickedStrategy,
  ]);

  // Fetch Turnaround Top Evaluation whenever TOP tab is active (or symbol changes with EPS jump)
  useEffect(() => {
    if (strategy !== 'TOP') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setTopLoading(true);
      setTopError(null);
      try {
        const qs = new URLSearchParams();
        const effNum = Number(topEffectiveEpsInput);
        if (topEffectiveEpsInput.trim() !== '' && Number.isFinite(effNum) && effNum > 0) {
          qs.set('effectiveEps', String(effNum));
        }
        const peNum = Number(topPeakPeInput);
        if (topPeakPeInput.trim() !== '' && Number.isFinite(peNum) && peNum > 0) {
          qs.set('peakPeRatio', String(peNum));
        }

        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/uturn-top?${qs.toString()}`,
          { signal: controller.signal }
        );
        const json: TurnaroundTopEvaluation & { error?: string } = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setTopData(json);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setTopError((err as Error).message || 'Turnaround Top evaluation failed.');
          setTopData(null);
        }
      } finally {
        setTopLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, strategy, topEffectiveEpsInput, topPeakPeInput]);

  // SVG Geometry for Bottom U-Turn
  const svgGeom = useMemo(() => {
    if (!data || data.chartPoints.length < 2) return null;
    const pts = data.chartPoints;
    const width = 880;
    const height = 165;
    const padL = 56;
    const padR = 88;
    const padT = 14;
    const padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allPrices = [
      data.zoneLow,
      data.zoneHigh,
      data.uTurnTarget,
      ...pts.map((p) => p.close),
      ...pts.map((p) => p.low),
    ];
    const minY = Math.min(...allPrices) * 0.985;
    const maxY = Math.max(...allPrices) * 1.015;
    const span = Math.max(maxY - minY, 0.01);

    const xFor = (i: number) =>
      pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
    const yFor = (p: number) => padT + (1 - (p - minY) / span) * plotH;

    const polyline = pts
      .map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.close).toFixed(1)}`)
      .join(' ');

    const zoneTopY = yFor(data.zoneHigh);
    const zoneBotY = yFor(data.zoneLow);
    const targetY = yFor(data.uTurnTarget);

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      minY,
      maxY,
      xFor,
      yFor,
      polyline,
      zoneTopY,
      zoneBotY,
      zoneBandH: Math.max(2, zoneBotY - zoneTopY),
      targetY,
    };
  }, [data]);

  // SVG Geometry for Turnaround Top
  const topSvgGeom = useMemo(() => {
    if (
      !topData ||
      topData.noDataOrNoJump ||
      topData.chartPoints.length < 2 ||
      topData.zoneLow === null ||
      topData.zoneHigh === null ||
      topData.topTargetPrice === null
    ) {
      return null;
    }
    const pts = topData.chartPoints;
    const width = 880;
    const height = 165;
    const padL = 56;
    const padR = 88;
    const padT = 14;
    const padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allPrices = [
      topData.zoneLow,
      topData.zoneHigh,
      topData.topTargetPrice,
      ...pts.map((p) => p.close),
      ...pts.map((p) => p.high),
    ];
    const minY = Math.min(...allPrices) * 0.985;
    const maxY = Math.max(...allPrices) * 1.015;
    const span = Math.max(maxY - minY, 0.01);

    const xFor = (i: number) =>
      pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
    const yFor = (p: number) => padT + (1 - (p - minY) / span) * plotH;

    const polyline = pts
      .map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.close).toFixed(1)}`)
      .join(' ');

    const zoneTopY = yFor(topData.zoneHigh);
    const zoneBotY = yFor(topData.zoneLow);
    const targetY = yFor(topData.topTargetPrice);

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      xFor,
      yFor,
      polyline,
      zoneTopY,
      zoneBotY,
      zoneBandH: Math.max(2, zoneBotY - zoneTopY),
      targetY,
    };
  }, [topData]);

  const handleSwitchMode = (mode: 'EPS_VALUATION' | 'PCT' | 'INR') => {
    setCorrectionMode(mode);
    if (mode === 'INR' && correctionInrInput.trim() === '' && data && data.expectedCorrectionInr > 0) {
      setCorrectionInrInput(data.expectedCorrectionInr.toFixed(2));
    }
    if (mode === 'PCT' && correctionPctInput.trim() === '') {
      setCorrectionPctInput('10');
    }
  };

  const activeMode: 'EPS_VALUATION' | 'PCT' | 'INR' =
    correctionMode === 'AUTO' ? (data?.correctionMode ?? 'EPS_VALUATION') : correctionMode;

  const hasEpsOverride =
    epsPrevInput.trim() !== '' || epsCurrInput.trim() !== '' || avgPeInput.trim() !== '';
  const hasTopOverride = topEffectiveEpsInput.trim() !== '' || topPeakPeInput.trim() !== '';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      {/* Top Strategy Switcher & Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            {strategy === 'BOTTOM' ? (
              <Target className="w-4 h-4 text-blue-700" />
            ) : (
              <TrendingUp className="w-4 h-4 text-amber-700" />
            )}
            EPS Valuation &amp; U-Turn / Turnaround Top Confirmation ({symbol})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">
            {strategy === 'BOTTOM'
              ? 'Bottom U-Turn: EPS Drop = EPS_prev − EPS_curr · Target = Peak − (EPS Drop × Avg PE)'
              : 'Turnaround Top: EPS Jump (Prev -> Curr) · Top Target = Effective TTM EPS × Peak PE · Low Deliv + High RVOL Exhaustion'}
          </p>
        </div>

        <div className="inline-flex p-0.5 bg-slate-100 rounded-md self-start lg:self-center">
          <button
            type="button"
            onClick={() => {
              setUserPickedStrategy(true);
              setStrategy('BOTTOM');
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              strategy === 'BOTTOM'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Bottom U-Turn (EPS Drop)
          </button>
          <button
            type="button"
            onClick={() => {
              setUserPickedStrategy(true);
              setStrategy('TOP');
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              strategy === 'TOP'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Turnaround Top (EPS × Peak PE)
          </button>
        </div>
      </div>

      {strategy === 'BOTTOM' ? (
        <>
          {/* Bottom Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-slate-600">
                <span>Peak ₹</span>
                <input
                  type="number"
                  step="0.05"
                  min="1"
                  value={customPeakInput}
                  placeholder={data ? data.peakPrice.toFixed(2) : 'Auto'}
                  onChange={(e) => setCustomPeakInput(e.target.value)}
                  className="w-24 bg-slate-50 border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </label>
              {customPeakInput.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => setCustomPeakInput('')}
                  title="Reset to 35-session Bhavcopy Peak"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  <RotateCcw className="w-3 h-3" />
                  35D Peak
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex p-0.5 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('EPS_VALUATION')}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    activeMode === 'EPS_VALUATION'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  EPS × PE
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('PCT')}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    activeMode === 'PCT'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  % Drop
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('INR')}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    activeMode === 'INR'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ₹ Drop
                </button>
              </div>

              <div className="inline-flex p-0.5 bg-slate-100 rounded-md" title="Target Zone Band">
                {([2, 3] as const).map((tol) => (
                  <button
                    key={tol}
                    type="button"
                    onClick={() => setZoneTolerancePct(tol)}
                    className={`px-2 py-1 rounded font-mono text-xs transition-colors ${
                      zoneTolerancePct === tol
                        ? 'bg-white text-slate-900 font-medium shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ±{tol}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom Parameter Row */}
          {activeMode === 'EPS_VALUATION' ? (
            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-slate-600">
                  <span>
                    EPS Prev{data?.epsPrevPeriod ? ` (${data.epsPrevPeriod})` : ''}: ₹
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={epsPrevInput}
                    placeholder={
                      data?.epsPrev !== null && data?.epsPrev !== undefined
                        ? data.epsPrev.toFixed(2)
                        : '—'
                    }
                    onChange={(e) => setEpsPrevInput(e.target.value)}
                    className="w-20 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>

                <label className="flex items-center gap-1.5 text-slate-600">
                  <span>
                    EPS Curr{data?.epsCurrPeriod ? ` (${data.epsCurrPeriod})` : ''}: ₹
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={epsCurrInput}
                    placeholder={
                      data?.epsCurr !== null && data?.epsCurr !== undefined
                        ? data.epsCurr.toFixed(2)
                        : '—'
                    }
                    onChange={(e) => setEpsCurrInput(e.target.value)}
                    className="w-20 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>

                <label className="flex items-center gap-1.5 text-slate-600">
                  <span>Avg PE:</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={avgPeInput}
                    placeholder={
                      data?.avgPeRatio !== null && data?.avgPeRatio !== undefined
                        ? data.avgPeRatio.toFixed(2)
                        : '—'
                    }
                    onChange={(e) => setAvgPeInput(e.target.value)}
                    className="w-20 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>

                {hasEpsOverride && (
                  <button
                    type="button"
                    onClick={() => {
                      setEpsPrevInput('');
                      setEpsCurrInput('');
                      setAvgPeInput('');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Live EPS/PE
                  </button>
                )}
              </div>

              {data && (
                <div className="font-mono text-slate-700">
                  EPS Drop:{' '}
                  <span
                    className={`font-semibold ${
                      (data.epsDrop ?? 0) > 0 ? 'text-rose-700' : 'text-slate-600'
                    }`}
                  >
                    {data.epsDrop !== null ? `₹${data.epsDrop.toFixed(2)}` : '—'}
                  </span>
                  <span className="mx-2 text-slate-300">×</span>
                  PE{' '}
                  <span className="font-semibold text-slate-900">
                    {data.avgPeRatio !== null ? data.avgPeRatio.toFixed(2) : '—'}
                  </span>
                  <span className="mx-2 text-slate-300">=</span>
                  Exp Drop{' '}
                  <span className="font-semibold text-blue-700">
                    ₹{data.expectedCorrectionInr.toFixed(2)} ({data.expectedCorrectionPct.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
          ) : activeMode === 'PCT' ? (
            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-600">Fallback % Pullback:</span>
              {PRESET_PCTS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setCorrectionPctInput(String(pct))}
                  className={`px-2 py-1 rounded font-mono text-xs border transition-colors ${
                    Number(correctionPctInput) === pct
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {pct}%
                </button>
              ))}
              <input
                type="number"
                step="0.5"
                min="1"
                max="80"
                value={correctionPctInput}
                onChange={(e) => setCorrectionPctInput(e.target.value)}
                aria-label="Custom expected correction percentage"
                className="w-16 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-slate-600">
                <span>Custom Expected Correction ₹</span>
                <input
                  type="number"
                  step="1"
                  min="0.5"
                  value={correctionInrInput}
                  onChange={(e) => setCorrectionInrInput(e.target.value)}
                  className="w-24 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </label>
            </div>
          )}

          {loading && !data ? (
            <div className="py-6 text-center text-xs text-slate-500">
              Fetching live quarterly EPS &amp; PE and evaluating U-Turn support confirmation...
            </div>
          ) : error || !data ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
              {error || 'Unable to compute U-Turn confirmation.'}
            </div>
          ) : (
            <>
              <div
                className={`border rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${STATUS_STYLE[data.status].banner}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-bold uppercase tracking-wide ${STATUS_STYLE[data.status].badge}`}>
                      {data.verdictLabel}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono text-slate-700">
                      U-Turn Target: ₹{data.peakPrice.toFixed(2)} ({data.peakDate}) − ₹
                      {data.expectedCorrectionInr.toFixed(2)} ({data.expectedCorrectionPct.toFixed(1)}%) ={' '}
                      <strong className="text-slate-900">₹{data.uTurnTarget.toFixed(2)}</strong>
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${STATUS_STYLE[data.status].text}`}>
                    {data.verdictDetail}
                  </p>
                </div>

                {onSendToRisk && !data.noEpsDropInData && (
                  <button
                    type="button"
                    onClick={() =>
                      onSendToRisk(
                        data.symbol,
                        data.latestClose,
                        Number((data.zoneLow * 0.985).toFixed(2))
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0 self-start lg:self-center"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Size U-Turn (Stop ₹{(data.zoneLow * 0.985).toFixed(2)})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>1. Target Zone (±{data.zoneTolerancePct}%)</span>
                    {data.gates.targetZonePass && !data.noEpsDropInData ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="mt-1 font-mono font-bold text-slate-900">
                    ₹{data.zoneLow.toFixed(2)} – ₹{data.zoneHigh.toFixed(2)}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-600">
                    Close ₹{data.latestClose.toFixed(2)} ({data.distFromTargetPct >= 0 ? '+' : ''}
                    {data.distFromTargetPct.toFixed(1)}% vs target)
                    {data.zoneTouchDate ? ` · Touch ${data.zoneTouchDate}` : ''}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>2. Delivery &gt;= 60%</span>
                    {data.gates.deliveryPass ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600" />
                    )}
                  </div>
                  <div
                    className={`mt-1 text-base font-mono font-bold ${
                      data.gates.deliveryPass ? 'text-emerald-700' : 'text-slate-900'
                    }`}
                  >
                    {data.triggerDelivPer !== null
                      ? `${data.triggerDelivPer.toFixed(1)}%`
                      : data.latestDelivPer !== null
                        ? `${data.latestDelivPer.toFixed(1)}%`
                        : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                    {data.triggerDate
                      ? `Trigger ${data.triggerDate} · EOD ${data.latestDelivPer?.toFixed(1) ?? '—'}%`
                      : `Latest EOD (${data.latestDate})`}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>3. RVOL &gt;= 1.5x</span>
                    {data.gates.rvolPass ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600" />
                    )}
                  </div>
                  <div
                    className={`mt-1 text-base font-mono font-bold ${
                      data.gates.rvolPass ? 'text-blue-700' : 'text-slate-900'
                    }`}
                  >
                    {data.triggerRvol !== null
                      ? `${data.triggerRvol.toFixed(2)}x`
                      : data.latestRvol !== null
                        ? `${data.latestRvol.toFixed(2)}x`
                        : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                    {data.triggerDate
                      ? `Trigger ${data.triggerDate} · EOD ${data.latestRvol?.toFixed(2) ?? '—'}x`
                      : `20D relative volume`}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>4. Subsequent Sessions</span>
                    {data.gates.subsequentSupportPass === true ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    ) : data.gates.subsequentSupportPass === false || data.status === 'BROKEN_DOWN' ? (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-600" />
                    )}
                  </div>
                  <div
                    className={`mt-1 text-base font-mono font-bold ${
                      data.status === 'BROKEN_DOWN'
                        ? 'text-rose-700'
                        : data.gates.subsequentSupportPass
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                    }`}
                  >
                    {data.subsequentSessionsCount > 0
                      ? `${data.heldSessionsCount}/${data.subsequentSessionsCount} Held`
                      : data.touchedTargetZone && !data.noEpsDropInData
                        ? '0 Sessions After'
                        : 'Not Touched'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                    {data.subsequentSessionsCount > 0
                      ? `Low ₹${data.lowestCloseAfterZone?.toFixed(1) ?? '—'} · High ₹${data.highestCloseAfterZone?.toFixed(1) ?? '—'}`
                      : `Checks closes >= ₹${data.zoneLow.toFixed(2)}`}
                  </div>
                </div>
              </div>

              {svgGeom && !data.noEpsDropInData && (
                <div className="border border-slate-200/80 rounded-md p-3 bg-slate-50/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px] text-slate-600">
                    <span className="font-medium text-slate-800">
                      Peak → Target Zone (±{data.zoneTolerancePct}%) → Subsequent Sessions Trajectory
                    </span>
                    <div className="flex flex-wrap items-center gap-4 font-mono">
                      <span className="text-blue-700">Target ₹{data.uTurnTarget.toFixed(2)}</span>
                      <span className="text-emerald-700">
                        Band ₹{data.zoneLow.toFixed(2)}–₹{data.zoneHigh.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <svg
                      viewBox={`0 0 ${svgGeom.width} ${svgGeom.height}`}
                      className="w-full min-w-[600px] h-auto select-none"
                    >
                      <rect
                        x={svgGeom.padL}
                        y={svgGeom.zoneTopY}
                        width={svgGeom.plotW}
                        height={svgGeom.zoneBandH}
                        fill="#3B82F6"
                        fillOpacity="0.10"
                      />
                      <line
                        x1={svgGeom.padL}
                        x2={svgGeom.width - svgGeom.padR}
                        y1={svgGeom.zoneTopY}
                        y2={svgGeom.zoneTopY}
                        stroke="#60A5FA"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={svgGeom.padL}
                        x2={svgGeom.width - svgGeom.padR}
                        y1={svgGeom.zoneBotY}
                        y2={svgGeom.zoneBotY}
                        stroke="#DC2626"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={svgGeom.padL}
                        x2={svgGeom.width - svgGeom.padR}
                        y1={svgGeom.targetY}
                        y2={svgGeom.targetY}
                        stroke="#1D4ED8"
                        strokeWidth="1.25"
                        strokeDasharray="5 3"
                      />

                      <text
                        x={svgGeom.width - svgGeom.padR + 6}
                        y={svgGeom.targetY + 3}
                        className="fill-blue-700 text-[10px] font-mono font-semibold"
                      >
                        Tgt {data.uTurnTarget.toFixed(1)}
                      </text>
                      <text
                        x={svgGeom.width - svgGeom.padR + 6}
                        y={svgGeom.zoneBotY + 3}
                        className="fill-rose-700 text-[10px] font-mono"
                      >
                        Low {data.zoneLow.toFixed(1)}
                      </text>

                      <polyline
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth="2"
                        points={svgGeom.polyline}
                      />

                      {data.chartPoints.map((pt, i) => {
                        const cx = svgGeom.xFor(i);
                        const cy = svgGeom.yFor(pt.close);
                        const fill =
                          pt.action === 'BROKE_BELOW'
                            ? '#E11D48'
                            : pt.action === 'IN_ZONE_TRIGGER'
                              ? '#1D4ED8'
                              : pt.action === 'HELD_SUPPORT' || pt.action === 'BOUNCED_ABOVE'
                                ? '#059669'
                                : pt.action === 'IN_ZONE'
                                  ? '#D97706'
                                  : pt.isPeak
                                    ? '#0F172A'
                                    : '#64748B';
                        const r = pt.action !== 'PRE_ZONE' || pt.isPeak ? 3.5 : 2;
                        return (
                          <circle
                            key={pt.date}
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={fill}
                            stroke="#FFFFFF"
                            strokeWidth="1"
                          />
                        );
                      })}

                      {[0, Math.floor(data.chartPoints.length / 2), data.chartPoints.length - 1].map(
                        (idx) => {
                          const p = data.chartPoints[idx];
                          if (!p) return null;
                          return (
                            <text
                              key={`ut-x-${idx}`}
                              x={svgGeom.xFor(idx)}
                              y={svgGeom.height - 6}
                              textAnchor="middle"
                              className="fill-slate-400 text-[10px] font-mono"
                            >
                              {p.date}
                            </text>
                          );
                        }
                      )}
                    </svg>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                    <span>Shaded Blue: Target Zone (±{data.zoneTolerancePct}%)</span>
                    <span className="text-blue-700">Blue Dot: Zone + Deliv≥60% + RVOL≥1.5x</span>
                    <span className="text-emerald-700">Green Dot: Subsequent Support Held / Bounced</span>
                    <span className="text-rose-700">Red Dot: Broke Below Zone Low</span>
                  </div>
                </div>
              )}

              {data.subsequentSessions.length > 0 && !data.noEpsDropInData && (
                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                        <th className="py-2 px-3">Session</th>
                        <th className="py-2 px-3 text-right">Close ₹</th>
                        <th className="py-2 px-3 text-right">Day %</th>
                        <th className="py-2 px-3 text-right">Low ₹</th>
                        <th className="py-2 px-3 text-right">vs Target</th>
                        <th className="py-2 px-3 text-right">Deliv %</th>
                        <th className="py-2 px-3 text-right">RVOL</th>
                        <th className="py-2 px-3">Subsequent Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...data.subsequentSessions].reverse().map((s, idx, arr) => {
                        const isFirstTouch = idx === arr.length - 1;
                        const act = formatActionLabel(s.action);
                        return (
                          <tr key={s.date} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono text-slate-800 whitespace-nowrap">
                              {s.date}
                              {isFirstTouch && (
                                <span className="ml-1.5 text-[10px] text-blue-700 font-semibold">
                                  (Touch)
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-900">
                              {s.close.toFixed(2)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                (s.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {s.changePct !== null
                                ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`
                                : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                s.low !== null && s.low < data.zoneLow
                                  ? 'text-rose-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {s.low !== null ? s.low.toFixed(2) : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                s.vsTargetPct < -data.zoneTolerancePct
                                  ? 'text-rose-700'
                                  : s.vsTargetPct <= data.zoneTolerancePct
                                    ? 'text-blue-700'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {s.vsTargetPct >= 0 ? '+' : ''}
                              {s.vsTargetPct.toFixed(2)}%
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                (s.delivPer ?? 0) >= 60
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-slate-600'
                              }`}
                            >
                              {s.delivPer !== null ? `${s.delivPer.toFixed(1)}%` : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                (s.rvol ?? 0) >= 1.5 ? 'text-blue-700 font-semibold' : 'text-slate-600'
                              }`}
                            >
                              {s.rvol !== null ? `${s.rvol.toFixed(2)}x` : '—'}
                            </td>
                            <td className={`py-2 px-3 font-mono whitespace-nowrap ${act.cls}`}>
                              {act.label}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {/* TURNAROUND TOP VIEW */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {topData && topData.epsQPrev !== null && topData.epsQCurr !== null && (
                <div className="font-mono text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1">
                  Q-EPS:{' '}
                  <span className="text-slate-500">₹{topData.epsQPrev.toFixed(2)}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span
                    className={`font-semibold ${
                      topData.epsQCurr > topData.epsQPrev ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    ₹{topData.epsQCurr.toFixed(2)}
                  </span>
                  {topData.epsJumpPct !== null && (
                    <span
                      className={`ml-1.5 ${
                        topData.epsJumpPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      ({topData.epsJumpPct >= 0 ? '+' : ''}
                      {topData.epsJumpPct.toFixed(1)}%)
                    </span>
                  )}
                </div>
              )}

              <label className="flex items-center gap-1.5 text-slate-600">
                <span>Effective TTM EPS: ₹</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  value={topEffectiveEpsInput}
                  placeholder={
                    topData?.effectiveEps !== null && topData?.effectiveEps !== undefined
                      ? topData.effectiveEps.toFixed(2)
                      : 'e.g. 20'
                  }
                  onChange={(e) => setTopEffectiveEpsInput(e.target.value)}
                  className="w-24 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </label>

              <label className="flex items-center gap-1.5 text-slate-600">
                <span>Peak PE:</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  value={topPeakPeInput}
                  placeholder={
                    topData?.peakPeRatio !== null && topData?.peakPeRatio !== undefined
                      ? topData.peakPeRatio.toFixed(2)
                      : 'e.g. 25'
                  }
                  onChange={(e) => setTopPeakPeInput(e.target.value)}
                  className="w-24 bg-white border border-slate-200 rounded px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </label>

              {hasTopOverride && (
                <button
                  type="button"
                  onClick={() => {
                    setTopEffectiveEpsInput('');
                    setTopPeakPeInput('');
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded"
                >
                  <RotateCcw className="w-3 h-3" />
                  Live TTM EPS / PE
                </button>
              )}
            </div>

            {topData && topData.topTargetPrice !== null && (
              <div className="font-mono text-slate-700">
                Top Target:{' '}
                <span className="font-semibold text-slate-900">
                  ₹{topData.effectiveEps?.toFixed(2)} × {topData.peakPeRatio?.toFixed(2)}x = ₹
                  {topData.topTargetPrice.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {topLoading && !topData ? (
            <div className="py-6 text-center text-xs text-slate-500">
              Fetching live trailing TTM EPS &amp; Peak PE and evaluating Turnaround Top exhaustion...
            </div>
          ) : topError || !topData ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
              {topError || 'Unable to compute Turnaround Top evaluation.'}
            </div>
          ) : (
            <>
              <div
                className={`border rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${TOP_STATUS_STYLE[topData.status].banner}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-bold uppercase tracking-wide ${TOP_STATUS_STYLE[topData.status].badge}`}
                    >
                      {topData.verdictLabel}
                    </span>
                    {topData.topTargetPrice !== null &&
                      topData.zoneLow !== null &&
                      topData.zoneHigh !== null && (
                        <>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-700">
                            Top Zone (-4%..+2%):{' '}
                            <strong className="text-slate-900">
                              ₹{topData.zoneLow.toFixed(2)} – ₹{topData.zoneHigh.toFixed(2)}
                            </strong>{' '}
                            (Target ₹{topData.topTargetPrice.toFixed(2)})
                          </span>
                        </>
                      )}
                  </div>
                  <p className={`text-xs leading-relaxed ${TOP_STATUS_STYLE[topData.status].text}`}>
                    {topData.verdictDetail}
                  </p>
                </div>
              </div>

              {/* 4-Gate Exhaustion Matrix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>1. Top Target Zone (-4%..+2%)</span>
                    {topData.gates.topZonePass && !topData.noDataOrNoJump ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="mt-1 font-mono font-bold text-slate-900">
                    {topData.zoneLow !== null && topData.zoneHigh !== null
                      ? `₹${topData.zoneLow.toFixed(2)} – ₹${topData.zoneHigh.toFixed(2)}`
                      : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-600">
                    Close ₹{topData.latestClose.toFixed(2)}
                    {topData.distFromTopPct !== null
                      ? ` (${topData.distFromTopPct >= 0 ? '+' : ''}${topData.distFromTopPct.toFixed(1)}% vs top)`
                      : ''}
                    {topData.zoneTouchDate ? ` · Touch ${topData.zoneTouchDate}` : ''}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>2. High RVOL (&gt;= 1.5x)</span>
                    {topData.gates.highRvolPass ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div
                    className={`mt-1 text-base font-mono font-bold ${
                      topData.gates.highRvolPass ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {topData.triggerRvol !== null
                      ? `${topData.triggerRvol.toFixed(2)}x`
                      : topData.latestRvol !== null
                        ? `${topData.latestRvol.toFixed(2)}x`
                        : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                    {topData.triggerDate
                      ? `Trigger ${topData.triggerDate} · EOD ${topData.latestRvol?.toFixed(2) ?? '—'}x`
                      : `Latest EOD (${topData.latestDate})`}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>3. Low / Falling Delivery</span>
                    {topData.gates.lowDeliveryPass ? (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    )}
                  </div>
                  <div
                    className={`mt-1 text-base font-mono font-bold ${
                      topData.gates.lowDeliveryPass ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {topData.triggerDelivPer !== null
                      ? `${topData.triggerDelivPer.toFixed(1)}%`
                      : topData.latestDelivPer !== null
                        ? `${topData.latestDelivPer.toFixed(1)}%`
                        : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                    20D Avg: {topData.avgDelivery20D !== null ? `${topData.avgDelivery20D.toFixed(1)}%` : '—'}{' '}
                    (&lt;50% or Avg−5%)
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>4. Subsequent Distribution</span>
                    {topData.status === 'CONFIRMED_TOP' ? (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    ) : topData.status === 'TOP_BREAKOUT' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div
                    className={`mt-1 text-base font-mono font-bold ${
                      topData.status === 'CONFIRMED_TOP'
                        ? 'text-rose-700'
                        : topData.status === 'TOP_BREAKOUT'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                    }`}
                  >
                    {topData.subsequentSessionsCount > 0
                      ? `${topData.rejectedSessionsCount}/${topData.subsequentSessionsCount} Rejected`
                      : topData.touchedTopZone && !topData.noDataOrNoJump
                        ? '0 Sessions After'
                        : 'Not Touched'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                    {topData.breakoutSessionsCount > 0
                      ? `${topData.breakoutSessionsCount} breakout close(s) above zone`
                      : 'Checks follow-through rejection'}
                  </div>
                </div>
              </div>

              {topSvgGeom && topData.topTargetPrice !== null && topData.zoneLow !== null && topData.zoneHigh !== null && (
                <div className="border border-slate-200/80 rounded-md p-3 bg-slate-50/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px] text-slate-600">
                    <span className="font-medium text-slate-800">
                      Turnaround Top Zone (-4%..+2%) &amp; Subsequent Exhaustion Trajectory
                    </span>
                    <div className="flex flex-wrap items-center gap-4 font-mono">
                      <span className="text-rose-700">Top Target ₹{topData.topTargetPrice.toFixed(2)}</span>
                      <span className="text-amber-700">
                        Zone ₹{topData.zoneLow.toFixed(2)}–₹{topData.zoneHigh.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <svg
                      viewBox={`0 0 ${topSvgGeom.width} ${topSvgGeom.height}`}
                      className="w-full min-w-[600px] h-auto select-none"
                    >
                      <rect
                        x={topSvgGeom.padL}
                        y={topSvgGeom.zoneTopY}
                        width={topSvgGeom.plotW}
                        height={topSvgGeom.zoneBandH}
                        fill="#F59E0B"
                        fillOpacity="0.14"
                      />
                      <line
                        x1={topSvgGeom.padL}
                        x2={topSvgGeom.width - topSvgGeom.padR}
                        y1={topSvgGeom.zoneTopY}
                        y2={topSvgGeom.zoneTopY}
                        stroke="#059669"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={topSvgGeom.padL}
                        x2={topSvgGeom.width - topSvgGeom.padR}
                        y1={topSvgGeom.zoneBotY}
                        y2={topSvgGeom.zoneBotY}
                        stroke="#D97706"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={topSvgGeom.padL}
                        x2={topSvgGeom.width - topSvgGeom.padR}
                        y1={topSvgGeom.targetY}
                        y2={topSvgGeom.targetY}
                        stroke="#E11D48"
                        strokeWidth="1.25"
                        strokeDasharray="5 3"
                      />

                      <text
                        x={topSvgGeom.width - topSvgGeom.padR + 6}
                        y={topSvgGeom.targetY + 3}
                        className="fill-rose-700 text-[10px] font-mono font-semibold"
                      >
                        Top {topData.topTargetPrice.toFixed(1)}
                      </text>
                      <text
                        x={topSvgGeom.width - topSvgGeom.padR + 6}
                        y={topSvgGeom.zoneBotY + 3}
                        className="fill-amber-700 text-[10px] font-mono"
                      >
                        Zone {topData.zoneLow.toFixed(1)}
                      </text>

                      <polyline
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth="2"
                        points={topSvgGeom.polyline}
                      />

                      {topData.chartPoints.map((pt, i) => {
                        const cx = topSvgGeom.xFor(i);
                        const cy = topSvgGeom.yFor(pt.close);
                        const fill =
                          pt.action === 'TOP_REJECTION'
                            ? '#E11D48'
                            : pt.action === 'TOP_TRIGGER'
                              ? '#D97706'
                              : pt.action === 'TOP_BREAKOUT'
                                ? '#059669'
                                : pt.action === 'TOP_ZONE'
                                  ? '#F59E0B'
                                  : '#64748B';
                        const r = pt.action !== 'PRE_TOP' ? 3.5 : 2;
                        return (
                          <circle
                            key={pt.date}
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={fill}
                            stroke="#FFFFFF"
                            strokeWidth="1"
                          />
                        );
                      })}

                      {[
                        0,
                        Math.floor(topData.chartPoints.length / 2),
                        topData.chartPoints.length - 1,
                      ].map((idx) => {
                        const p = topData.chartPoints[idx];
                        if (!p) return null;
                        return (
                          <text
                            key={`top-x-${idx}`}
                            x={topSvgGeom.xFor(idx)}
                            y={topSvgGeom.height - 6}
                            textAnchor="middle"
                            className="fill-slate-400 text-[10px] font-mono"
                          >
                            {p.date}
                          </text>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                    <span>Shaded Amber: Top Exhaustion Band (-4%..+2%)</span>
                    <span className="text-amber-700">Amber Dot: High RVOL ≥1.5x + Low Delivery</span>
                    <span className="text-rose-700">Red Dot: Top Rejection / Distribution</span>
                    <span className="text-emerald-700">Green Dot: Clean Breakout (Deliv≥50%)</span>
                  </div>
                </div>
              )}

              {topData.subsequentSessions.length > 0 && !topData.noDataOrNoJump && (
                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                        <th className="py-2 px-3">Session</th>
                        <th className="py-2 px-3 text-right">Close ₹</th>
                        <th className="py-2 px-3 text-right">Day %</th>
                        <th className="py-2 px-3 text-right">High ₹</th>
                        <th className="py-2 px-3 text-right">vs Top</th>
                        <th className="py-2 px-3 text-right">Deliv %</th>
                        <th className="py-2 px-3 text-right">RVOL</th>
                        <th className="py-2 px-3">Top Exhaustion Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...topData.subsequentSessions].reverse().map((s, idx, arr) => {
                        const isFirstTouch = idx === arr.length - 1;
                        const act = formatTopActionLabel(s.action);
                        return (
                          <tr key={s.date} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono text-slate-800 whitespace-nowrap">
                              {s.date}
                              {isFirstTouch && (
                                <span className="ml-1.5 text-[10px] text-amber-700 font-semibold">
                                  (Touch)
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-900">
                              {s.close.toFixed(2)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                (s.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {s.changePct !== null
                                ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`
                                : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-600">
                              {s.high !== null ? s.high.toFixed(2) : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                s.vsTopPct > 2
                                  ? 'text-emerald-700'
                                  : s.vsTopPct >= -4
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                              }`}
                            >
                              {s.vsTopPct >= 0 ? '+' : ''}
                              {s.vsTopPct.toFixed(2)}%
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                s.delivPer !== null && s.delivPer < 50
                                  ? 'text-rose-700 font-semibold'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {s.delivPer !== null ? `${s.delivPer.toFixed(1)}%` : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono ${
                                (s.rvol ?? 0) >= 1.5 ? 'text-amber-700 font-semibold' : 'text-slate-600'
                              }`}
                            >
                              {s.rvol !== null ? `${s.rvol.toFixed(2)}x` : '—'}
                            </td>
                            <td className={`py-2 px-3 font-mono whitespace-nowrap ${act.cls}`}>
                              {act.label}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
