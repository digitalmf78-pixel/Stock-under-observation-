import React, { useMemo } from 'react';
import { Activity, BarChart3, Gauge, TrendingUp } from 'lucide-react';
import type { StockDetailData } from '../types/trading';

interface TrendStrengthCardProps {
  data: StockDetailData;
}

interface PillarBreakdown {
  key: 'eps' | 'rvol' | 'delivery';
  label: string;
  score: number;
  maxScore: number;
  headline: string;
  detail: string;
  barClass: string;
}

interface TrendStrengthResult {
  totalScore: number;
  tierLabel: string;
  potentialNote: string;
  accentTextClass: string;
  barFillClass: string;
  trackBgClass: string;
  pillars: PillarBreakdown[];
  potentialLeftPct: number | null;
}

export function computeTrendStrength(data: StockDetailData): TrendStrengthResult {
  const { summary, fundamentals, history } = data;

  // 1. EPS Growth Delta (0 - 35 points)
  const epsPrev = fundamentals?.epsPrev ?? null;
  const epsCurr = fundamentals?.epsCurr ?? null;
  let epsDeltaPct: number | null = null;
  let epsSourceLabel = 'No quarterly EPS';

  if (epsPrev !== null && epsCurr !== null && Math.abs(epsPrev) > 0) {
    epsDeltaPct = ((epsCurr - epsPrev) / Math.abs(epsPrev)) * 100;
    epsSourceLabel = `₹${epsPrev.toFixed(2)} → ₹${epsCurr.toFixed(2)} (${epsDeltaPct >= 0 ? '+' : ''}${epsDeltaPct.toFixed(1)}%)`;
  } else if (
    fundamentals?.profitGrowthPct !== null &&
    fundamentals?.profitGrowthPct !== undefined
  ) {
    epsDeltaPct = fundamentals.profitGrowthPct;
    epsSourceLabel = `Profit YoY ${epsDeltaPct >= 0 ? '+' : ''}${epsDeltaPct.toFixed(1)}%`;
  }

  let epsScore = 0;
  if (epsDeltaPct !== null) {
    const currPositive = epsCurr === null ? epsDeltaPct > 0 : epsCurr > 0;
    if (!currPositive && epsCurr !== null && epsCurr <= 0) {
      epsScore = epsDeltaPct > 0 ? 5 : 0;
    } else if (epsDeltaPct >= 0) {
      epsScore = Math.round(Math.min(35, 15 + (epsDeltaPct / 30) * 20));
    } else {
      epsScore = Math.round(Math.max(0, 14 + (epsDeltaPct / 25) * 14));
    }
  }

  // 2. RVOL Intensity (0 - 30 points)
  const rvol = summary.rvol;
  let rvolScore = 0;
  if (rvol !== null && rvol > 0) {
    if (rvol < 1.0) {
      rvolScore = Math.round(Math.max(2, (rvol / 1.0) * 14));
    } else if (rvol < 1.5) {
      rvolScore = Math.round(14 + ((rvol - 1.0) / 0.5) * 8);
    } else {
      rvolScore = Math.round(Math.min(30, 22 + ((rvol - 1.5) / 1.0) * 8));
    }
  }
  const rvolHeadline =
    rvol !== null ? `${rvol.toFixed(2)}x (${summary.rvolBand})` : 'WAIT_FOR_DATA';
  const rvolDetail =
    summary.upDownVolRatio10d !== null
      ? `10D Up/Dn Vol: ${summary.upDownVolRatio10d.toFixed(2)}x`
      : '20-session baseline RVOL';

  // 3. Delivery Volume Consistency (0 - 35 points)
  const recentValid = history.filter((h) => h.delivPer !== null).slice(-30);
  const validSessions =
    summary.valid30dSessions > 0 ? summary.valid30dSessions : recentValid.length;
  const gt60Sessions =
    summary.valid30dSessions > 0
      ? summary.dailyGt60Count
      : recentValid.filter((h) => (h.delivPer ?? 0) >= 60).length;

  const gt60Rate = validSessions > 0 ? gt60Sessions / validSessions : 0;
  const ratePts = Math.min(18, gt60Rate * 26);
  const streakPts =
    Math.min(7, summary.rolling5dGt60Count * 0.7) +
    Math.min(3, summary.consecutiveStreak * 0.6);
  const qtyRatio = summary.delivQtyRatio ?? 0;
  const ratioPts =
    qtyRatio > 0
      ? qtyRatio >= 1.0
        ? Math.min(7, 4 + ((qtyRatio - 1.0) / 0.5) * 3)
        : Math.max(0, qtyRatio * 4)
      : 0;
  const deliveryScore =
    validSessions > 0 ? Math.min(35, Math.round(ratePts + streakPts + ratioPts)) : 0;

  const delivHeadline =
    validSessions > 0
      ? `${gt60Sessions}/${validSessions} sess >=60%`
      : 'No delivery history';
  const delivDetail = `Cat ${summary.deliveryCategory} · 5D>=60%: ${summary.rolling5dGt60Count} · Qty ${
    summary.delivQtyRatio !== null ? `${summary.delivQtyRatio.toFixed(2)}x` : '—'
  }`;

  const totalScore = Math.max(0, Math.min(100, epsScore + rvolScore + deliveryScore));

  // Potential left estimation based on top target or 35D high room
  let potentialLeftPct: number | null = null;
  if (summary.topTurnTarget !== null && summary.closePrice > 0) {
    potentialLeftPct = ((summary.topTurnTarget - summary.closePrice) / summary.closePrice) * 100;
  } else if (summary.distFrom35dHighPct !== null) {
    // distFrom35dHighPct is typically <= 0 when below high
    potentialLeftPct =
      summary.distFrom35dHighPct < 0 ? Math.abs(summary.distFrom35dHighPct) : 0;
  }

  let tierLabel = 'Weak / Unconfirmed';
  let potentialNote = 'Low conviction: wait for EPS expansion, RVOL >= 1.5x, or delivery >= 60%.';
  let accentTextClass = 'text-rose-700';
  let barFillClass = 'bg-rose-600';
  let trackBgClass = 'bg-rose-100';

  if (totalScore >= 75) {
    tierLabel = 'Strong Trend Strength';
    accentTextClass = 'text-emerald-700';
    barFillClass = 'bg-emerald-600';
    trackBgClass = 'bg-emerald-100';
    potentialNote =
      potentialLeftPct !== null && potentialLeftPct <= 3
        ? 'High institutional & earnings momentum, though price is near ceiling — tighten stops.'
        : 'Strong EPS delta + RVOL + delivery accumulation support continuation upside.';
  } else if (totalScore >= 55) {
    tierLabel = 'Constructive Setup';
    accentTextClass = 'text-blue-700';
    barFillClass = 'bg-blue-600';
    trackBgClass = 'bg-blue-100';
    potentialNote =
      'Healthy base momentum; watch for RVOL follow-through or sustained 60%+ delivery to unlock upper runway.';
  } else if (totalScore >= 35) {
    tierLabel = 'Developing / Mixed';
    accentTextClass = 'text-amber-700';
    barFillClass = 'bg-amber-500';
    trackBgClass = 'bg-amber-100';
    potentialNote =
      'Partial trend alignment; one or more pillars (EPS, RVOL, or delivery consistency) still lagging.';
  }

  const pillars: PillarBreakdown[] = [
    {
      key: 'eps',
      label: 'EPS Growth Delta',
      score: epsScore,
      maxScore: 35,
      headline: epsDeltaPct !== null ? `${epsDeltaPct >= 0 ? '+' : ''}${epsDeltaPct.toFixed(1)}%` : 'MISSING',
      detail: epsSourceLabel,
      barClass: epsScore >= 24 ? 'bg-emerald-600' : epsScore >= 14 ? 'bg-blue-600' : 'bg-amber-500',
    },
    {
      key: 'rvol',
      label: 'RVOL Intensity',
      score: rvolScore,
      maxScore: 30,
      headline: rvolHeadline,
      detail: rvolDetail,
      barClass: rvolScore >= 22 ? 'bg-emerald-600' : rvolScore >= 14 ? 'bg-blue-600' : 'bg-amber-500',
    },
    {
      key: 'delivery',
      label: 'Delivery Consistency',
      score: deliveryScore,
      maxScore: 35,
      headline: delivHeadline,
      detail: delivDetail,
      barClass:
        deliveryScore >= 24 ? 'bg-emerald-600' : deliveryScore >= 14 ? 'bg-blue-600' : 'bg-amber-500',
    },
  ];

  return {
    totalScore,
    tierLabel,
    potentialNote,
    accentTextClass,
    barFillClass,
    trackBgClass,
    pillars,
    potentialLeftPct,
  };
}

export const TrendStrengthCard: React.FC<TrendStrengthCardProps> = ({ data }) => {
  const result = useMemo(() => computeTrendStrength(data), [data]);

  return (
    <section
      aria-label="Trend Strength Score"
      className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Trend Strength Score
            </h3>
            <span className="text-xs text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className={`text-xs font-semibold ${result.accentTextClass}`}>
              {result.tierLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{result.potentialNote}</p>
        </div>

        <div className="flex items-baseline gap-4 shrink-0">
          {result.potentialLeftPct !== null && (
            <div className="text-right">
              <div className="text-[11px] text-slate-500">
                {data.summary.topTurnTarget !== null ? 'Room to Top Target' : 'Room to 35D High'}
              </div>
              <div
                className={`text-xs font-mono font-semibold tabular-nums ${
                  result.potentialLeftPct > 5
                    ? 'text-emerald-700'
                    : result.potentialLeftPct >= 0
                      ? 'text-amber-700'
                      : 'text-rose-700'
                }`}
              >
                {result.potentialLeftPct >= 0 ? '+' : ''}
                {result.potentialLeftPct.toFixed(1)}%
              </div>
            </div>
          )}
          <div className="text-right">
            <div className="text-[11px] text-slate-500">Composite Score</div>
            <div className={`text-2xl font-bold font-mono tabular-nums ${result.accentTextClass}`}>
              {result.totalScore}
              <span className="text-xs font-normal text-slate-400">/100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main 0-100 Progress Bar */}
      <div className="space-y-1.5">
        <div
          role="progressbar"
          aria-label="Trend Strength Score"
          aria-valuenow={result.totalScore}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`relative h-3 w-full rounded-full overflow-hidden ${result.trackBgClass}`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${result.barFillClass}`}
            style={{ width: `${result.totalScore}%` }}
          />
          {/* Threshold ticks at 35, 55, 75 */}
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/80"
            style={{ left: '35%' }}
          />
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/80"
            style={{ left: '55%' }}
          />
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/80"
            style={{ left: '75%' }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
          <span>0 Weak</span>
          <span>35 Developing</span>
          <span>55 Constructive</span>
          <span>75 Strong</span>
          <span>100</span>
        </div>
      </div>

      {/* 3-Pillar Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
        {result.pillars.map((pillar) => {
          const pct = Math.round((pillar.score / pillar.maxScore) * 100);
          const Icon =
            pillar.key === 'eps'
              ? TrendingUp
              : pillar.key === 'rvol'
                ? Activity
                : BarChart3;

          return (
            <div key={pillar.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                  <Icon className="w-3.5 h-3.5 text-slate-500" />
                  {pillar.label}
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {pillar.score}/{pillar.maxScore}
                </span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${pillar.barClass}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-slate-700 font-medium truncate">{pillar.headline}</span>
                <span className="text-slate-500 truncate">{pillar.detail}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
