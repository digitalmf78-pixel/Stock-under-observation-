import React from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  Gauge,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { FundamentalProfile, ScreenerRow } from '../types/trading';

interface QuarterlyEpsValuationPanelProps {
  symbol: string;
  summary: ScreenerRow;
  fundamentals: FundamentalProfile | null;
  detectedPeakPrice: number;
  detectedPeakDate: string;
  verifying: boolean;
  onVerifyFundamentals: () => void;
}

export const QuarterlyEpsValuationPanel: React.FC<QuarterlyEpsValuationPanelProps> = ({
  symbol,
  summary,
  fundamentals,
  detectedPeakPrice,
  detectedPeakDate,
  verifying,
  onVerifyFundamentals,
}) => {
  const close = summary.closePrice;
  const peak = detectedPeakPrice > 0 ? detectedPeakPrice : close;

  const epsPrev = fundamentals?.epsPrev ?? null;
  const epsCurr = fundamentals?.epsCurr ?? null;
  const epsPrevPeriod = fundamentals?.epsPrevPeriod || 'Prev Qtr (Q-1)';
  const epsCurrPeriod = fundamentals?.epsCurrPeriod || 'Latest Qtr (Q2)';
  const epsTtmCurr = fundamentals?.epsTtmCurr ?? null;
  const trailingPE =
    fundamentals?.trailingPE !== null &&
    fundamentals?.trailingPE !== undefined &&
    fundamentals.trailingPE > 0
      ? fundamentals.trailingPE
      : null;

  // Mandatory Fundamental Verification Checks
  const hasSources = (summary.fundamentalSources?.length ?? 0) > 0 && summary.fundamentalCoverage !== 'MISSING';
  const isFreshEnough =
    summary.fundamentalFreshness === 'LATEST' || summary.fundamentalFreshness === 'OLD_3M';
  const hasTwoQuartersEps = epsPrev !== null && epsCurr !== null;
  const hasValidPE = trailingPE !== null && trailingPE > 0;
  const allVerified = hasSources && isFreshEnough && hasTwoQuartersEps && hasValidPE;

  // 2-Quarterly EPS Calculations
  const twoQDelta = epsPrev !== null && epsCurr !== null ? epsCurr - epsPrev : null;
  const twoQDeltaPct =
    epsPrev !== null && epsCurr !== null && Math.abs(epsPrev) > 0
      ? ((epsCurr - epsPrev) / Math.abs(epsPrev)) * 100
      : null;
  const twoQSumEps = epsPrev !== null && epsCurr !== null ? epsPrev + epsCurr : null;
  const twoQAnnualizedEps = twoQSumEps !== null ? twoQSumEps * 2 : null;
  const latestQAnnualizedEps = epsCurr !== null ? epsCurr * 4 : null;

  // Effective EPS for Top calculation (compare TTM vs 2Q Annualized vs Latest Qx4)
  const effectiveTtmEps =
    epsTtmCurr !== null && epsTtmCurr > 0
      ? epsTtmCurr
      : twoQAnnualizedEps !== null && twoQAnnualizedEps > 0
        ? twoQAnnualizedEps
        : latestQAnnualizedEps !== null && latestQAnnualizedEps > 0
          ? latestQAnnualizedEps
          : null;

  const peakPe =
    trailingPE !== null && effectiveTtmEps !== null && effectiveTtmEps > 0
      ? Math.max(trailingPE, peak / effectiveTtmEps)
      : trailingPE;

  // 1) U-Turn Support Formula (Peak - (EPS Drop * Avg PE))
  const epsDrop =
    epsPrev !== null && epsCurr !== null ? Math.max(0, epsPrev - epsCurr) : null;
  const hasEpsDropFormula =
    epsDrop !== null && epsDrop > 0 && trailingPE !== null && trailingPE > 0;
  const expectedCorrectionInr = hasEpsDropFormula
    ? Math.min(peak * 0.9, epsDrop! * trailingPE!)
    : null;
  const uTurnSupportPrice =
    expectedCorrectionInr !== null ? Math.max(0.05, peak - expectedCorrectionInr) : null;
  const uTurnSupportLow = uTurnSupportPrice !== null ? uTurnSupportPrice * 0.98 : null;
  const uTurnSupportHigh = uTurnSupportPrice !== null ? uTurnSupportPrice * 1.02 : null;

  // When EPS did not drop (growth stock), compute Earnings Valuation Floor + 10% Pullback reference
  const earningsValuationFloor =
    !hasEpsDropFormula && twoQAnnualizedEps !== null && twoQAnnualizedEps > 0 && trailingPE !== null
      ? Number((twoQAnnualizedEps * (trailingPE * 0.9)).toFixed(2))
      : !hasEpsDropFormula
        ? Number((peak * 0.9).toFixed(2))
        : null;

  const activeSupportFloor = uTurnSupportPrice ?? earningsValuationFloor;

  // 2) Turnaround Top Formula (EPS * Peak PE) across TTM, 2Q Run-Rate, and Latest Qx4
  const topTargetTtm =
    effectiveTtmEps !== null && effectiveTtmEps > 0 && peakPe !== null
      ? Number((effectiveTtmEps * peakPe).toFixed(2))
      : null;
  const topTarget2Q =
    twoQAnnualizedEps !== null && twoQAnnualizedEps > 0 && peakPe !== null
      ? Number((twoQAnnualizedEps * peakPe).toFixed(2))
      : null;
  const topTargetLatestQ =
    latestQAnnualizedEps !== null && latestQAnnualizedEps > 0 && peakPe !== null
      ? Number((latestQAnnualizedEps * peakPe).toFixed(2))
      : null;

  // Primary Top Target prioritizes 2Q Run-Rate if available & positive, else TTM
  const activeTopTarget = topTarget2Q ?? topTargetTtm;
  const activeTopZoneLow = activeTopTarget !== null ? Number((activeTopTarget * 0.96).toFixed(2)) : null;
  const activeTopZoneHigh = activeTopTarget !== null ? Number((activeTopTarget * 1.02).toFixed(2)) : null;

  // 3) Remaining Strength Calculation ("Kitna Strength Bacha Hai")
  const upsideInr = activeTopTarget !== null ? activeTopTarget - close : null;
  const upsidePct = activeTopTarget !== null && close > 0 ? ((activeTopTarget - close) / close) * 100 : null;
  const downsideInr = activeSupportFloor !== null ? close - activeSupportFloor : null;
  const downsidePct =
    activeSupportFloor !== null && close > 0 ? ((close - activeSupportFloor) / close) * 100 : null;

  const totalRange =
    activeTopTarget !== null && activeSupportFloor !== null && activeTopTarget > activeSupportFloor
      ? activeTopTarget - activeSupportFloor
      : null;

  const rangePositionPct =
    totalRange !== null && activeSupportFloor !== null
      ? Math.max(0, Math.min(100, ((close - activeSupportFloor) / totalRange) * 100))
      : null;
  const strengthRemainingPct =
    rangePositionPct !== null ? Math.max(0, Math.min(100, 100 - rangePositionPct)) : null;

  const rewardRiskRatio =
    upsideInr !== null && downsideInr !== null && downsideInr > 0.01 && upsideInr > 0
      ? upsideInr / downsideInr
      : null;

  const strengthVerdict = (() => {
    if (!allVerified) {
      return {
        tone: 'amber' as const,
        title: 'Verification Required Before Relying on Targets',
        detail:
          'Fundamental verification is mandatory. Click "Verify & Save Fundamentals" above to pull live Screener.in + BSE Official + NSE XBRL 2-quarter EPS and P/E before sizing.',
      };
    }
    if (hasEpsDropFormula && uTurnSupportPrice !== null && close > uTurnSupportPrice * 1.02) {
      return {
        tone: 'rose' as const,
        title: 'EPS Declined — Wait for U-Turn Support Correction',
        detail: `Quarterly EPS fell ₹${epsDrop!.toFixed(2)} (${epsPrev!.toFixed(2)} -> ${epsCurr!.toFixed(2)}). Formula predicts Support at ₹${uTurnSupportPrice.toFixed(2)} (${downsidePct !== null ? `-${downsidePct.toFixed(1)}%` : ''} below close). Wait for pullback into ₹${uTurnSupportLow?.toFixed(0)}–₹${uTurnSupportHigh?.toFixed(0)}.`,
      };
    }
    if (upsidePct !== null && upsidePct >= 15) {
      return {
        tone: 'emerald' as const,
        title: `High Strength Remaining (+${upsidePct.toFixed(1)}% Upside to Top)`,
        detail: `Based on 2-quarter EPS & Peak P/E (${peakPe?.toFixed(2)}x), stock has +₹${upsideInr!.toFixed(2)} (+${upsidePct.toFixed(1)}%) valuation runway before Turnaround Top ₹${activeTopTarget!.toFixed(2)} (${strengthRemainingPct?.toFixed(0) ?? '—'}% range strength left).`,
      };
    }
    if (upsidePct !== null && upsidePct >= 5) {
      return {
        tone: 'blue' as const,
        title: `Moderate Strength Remaining (+${upsidePct.toFixed(1)}% Upside Left)`,
        detail: `Stock has +₹${upsideInr!.toFixed(2)} (+${upsidePct.toFixed(1)}%) room left to Top Target ₹${activeTopTarget!.toFixed(2)} vs ${downsidePct !== null ? `${downsidePct.toFixed(1)}%` : '—'} buffer above Support ₹${activeSupportFloor?.toFixed(2) ?? '—'}.`,
      };
    }
    if (upsidePct !== null && upsidePct < 5) {
      return {
        tone: 'rose' as const,
        title:
          upsidePct <= 0
            ? `Valuation Top Reached / Stretched (${upsidePct.toFixed(1)}% vs Top)`
            : `Limited Strength Left (+${upsidePct.toFixed(1)}% to Top Exhaustion Zone)`,
        detail: `Price ₹${close.toFixed(2)} is right inside or above the Turnaround Top Zone (₹${activeTopZoneLow?.toFixed(0)}–₹${activeTopZoneHigh?.toFixed(0)}). Risk-reward favors caution / partial profit booking unless next quarter EPS accelerates.`,
      };
    }
    return {
      tone: 'amber' as const,
      title: 'Partial Valuation Strength — Check EPS & P/E Inputs',
      detail: 'Verify both quarterly EPS figures and trailing P/E to compute full Support-to-Top strength.',
    };
  })();

  return (
    <section
      aria-label="Fundamental Verification & 2-Quarter EPS Valuation Strength"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header + Verification MUST Banner */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-700" />
            Fundamental Verification Gate &amp; 2-Quarter EPS Valuation Strength
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Mandatory fundamental verification check + separate 2-quarter EPS &amp; P/E calculation for U-Turn Support, Turnaround Top, and remaining upside strength in {symbol}.
          </p>
        </div>

        {summary.swingTier === 'NONE' ? (
          <span
            title="Fundamental Deep Audit runs strictly on stocks selected into Tier 1, Tier 2, or Tier 3."
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 text-slate-500 whitespace-nowrap shrink-0"
          >
            Deep Audit: Tier 1–3 Only
          </span>
        ) : (
          <button
            type="button"
            onClick={onVerifyFundamentals}
            disabled={verifying}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              allVerified
                ? 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                : 'bg-blue-700 text-white hover:bg-blue-800'
            } disabled:opacity-50`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
            {verifying
              ? 'Verifying Screener+BSE+NSE...'
              : allVerified
                ? 'Re-Verify Fundamentals'
                : 'Verify & Save Fundamentals (MUST)'}
          </button>
        )}
      </div>

      <div className="p-5 space-y-5 text-xs">
        {/* Mandatory Fundamental Verification Gate Strip */}
        <div
          className={`p-3.5 rounded-md border flex flex-col xl:flex-row xl:items-center justify-between gap-3 ${
            allVerified
              ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
              : 'bg-rose-50/60 border-rose-200 text-rose-950'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {allVerified ? (
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-mono font-semibold">
                {allVerified
                  ? `FUNDAMENTALS VERIFIED (${summary.fundamentalSources.join(' + ')})`
                  : 'FUNDAMENTAL VERIFICATION INCOMPLETE / REQUIRED'}
              </div>
              <div className="mt-0.5 text-[11px] opacity-90">
                Period End: <span className="font-mono">{fundamentals?.financialPeriodEnd || '—'}</span> · Rules Pass:{' '}
                <span className="font-mono font-semibold">{summary.fundamentalPassCount}/7</span> · Freshness:{' '}
                <span className="font-mono font-semibold">{summary.fundamentalFreshness}</span>
                {summary.fundamentalAgeDays !== null ? ` (${summary.fundamentalAgeDays}d)` : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono shrink-0">
            {[
              { label: 'Multi-Source', ok: hasSources },
              { label: 'Within Max Age', ok: isFreshEnough },
              { label: '2-Qtr EPS', ok: hasTwoQuartersEps },
              { label: 'Trailing P/E', ok: hasValidPE },
            ].map((chk) => (
              <div
                key={chk.label}
                className={`px-2 py-1 rounded border inline-flex items-center gap-1 ${
                  chk.ok
                    ? 'bg-white/80 border-emerald-200 text-emerald-800'
                    : 'bg-white/80 border-rose-200 text-rose-800'
                }`}
              >
                {chk.ok ? (
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                )}
                <span>{chk.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step 1: 2-Quarterly Results Comparison & Run-Rate Calculation */}
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-800">
              Step 1 — Two-Quarterly Results EPS Calculation (Q-1 vs Latest Q)
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              Trailing P/E: {trailingPE !== null ? `${trailingPE.toFixed(2)}x` : 'Missing'} · Peak P/E:{' '}
              {peakPe !== null ? `${peakPe.toFixed(2)}x` : 'Missing'}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-slate-100">
            <div className="p-3.5">
              <div className="text-slate-500">Quarter 1 (Prev Q)</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                {epsPrev !== null ? `₹${epsPrev.toFixed(2)}` : '—'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-400">{epsPrevPeriod}</div>
            </div>

            <div className="p-3.5">
              <div className="text-slate-500">Quarter 2 (Latest Q)</div>
              <div
                className={`mt-1 text-base font-bold font-mono tabular-nums ${
                  twoQDelta !== null
                    ? twoQDelta >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                    : 'text-slate-900'
                }`}
              >
                {epsCurr !== null ? `₹${epsCurr.toFixed(2)}` : '—'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-400">{epsCurrPeriod}</div>
            </div>

            <div className="p-3.5">
              <div className="text-slate-500">2Q Change (Q2 − Q1)</div>
              <div
                className={`mt-1 text-base font-bold font-mono tabular-nums flex items-center gap-1 ${
                  twoQDelta === null
                    ? 'text-slate-400'
                    : twoQDelta >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                }`}
              >
                {twoQDelta !== null ? (
                  <>
                    {twoQDelta >= 0 ? (
                      <ArrowUpRight className="w-4 h-4 shrink-0" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      {twoQDelta >= 0 ? '+' : ''}₹{twoQDelta.toFixed(2)}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                {twoQDeltaPct !== null
                  ? `${twoQDeltaPct >= 0 ? '+' : ''}${twoQDeltaPct.toFixed(1)}% QoQ`
                  : 'Needs 2 quarters'}
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-slate-500">2Q Annualized EPS</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-blue-700">
                {twoQAnnualizedEps !== null ? `₹${twoQAnnualizedEps.toFixed(2)}` : '—'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                {twoQSumEps !== null ? `(Sum ₹${twoQSumEps.toFixed(2)}) × 2` : '(Q1 + Q2) × 2'}
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-slate-500">TTM EPS (4Q) / Q2×4</div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                {epsTtmCurr !== null ? `₹${epsTtmCurr.toFixed(2)}` : '—'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                Q2×4 Run-Rate: {latestQAnnualizedEps !== null ? `₹${latestQAnnualizedEps.toFixed(2)}` : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Separate U-Turn Support (Floor) vs Turnaround Top (Ceiling) Calculations */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: U-Turn Support Formula */}
          <div className="border border-slate-200 rounded-md p-4 space-y-3 bg-slate-50/40">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <TrendingDown className="w-4 h-4 text-blue-700" />
                U-Turn Support Formula (Downside Floor)
              </div>
              <span
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                  hasEpsDropFormula
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {hasEpsDropFormula ? 'EPS DROP ACTIVE' : 'NO EPS DROP'}
              </span>
            </div>

            {hasEpsDropFormula && uTurnSupportPrice !== null ? (
              <div className="space-y-2 font-mono text-[11px]">
                <div className="p-2.5 bg-white border border-slate-200 rounded space-y-1">
                  <div className="text-slate-500">
                    Formula: Peak − ((Q1 − Q2) × Avg P/E)
                  </div>
                  <div className="text-slate-800">
                    EPS Drop = ₹{epsPrev!.toFixed(2)} − ₹{epsCurr!.toFixed(2)} ={' '}
                    <span className="font-semibold text-rose-700">₹{epsDrop!.toFixed(2)}</span>
                  </div>
                  <div className="text-slate-800">
                    Correction = ₹{epsDrop!.toFixed(2)} × {trailingPE!.toFixed(2)}x ={' '}
                    <span className="font-semibold">₹{expectedCorrectionInr!.toFixed(2)}</span>
                  </div>
                  <div className="text-slate-900 font-semibold pt-1 border-t border-slate-100">
                    Support Target = ₹{peak.toFixed(2)} − ₹{expectedCorrectionInr!.toFixed(2)} ={' '}
                    <span className="text-blue-700 text-sm">₹{uTurnSupportPrice.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>
                    Support Zone (±2%): ₹{uTurnSupportLow!.toFixed(2)} – ₹{uTurnSupportHigh!.toFixed(2)}
                  </span>
                  <span className="font-semibold text-slate-900">
                    Buffer: {downsidePct !== null ? `${downsidePct >= 0 ? '+' : ''}${downsidePct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 font-mono text-[11px]">
                <div className="p-2.5 bg-white border border-slate-200 rounded space-y-1">
                  <div className="text-emerald-800 font-medium">
                    Latest Quarter EPS did not drop ({epsPrev !== null ? `₹${epsPrev.toFixed(2)}` : '—'} →{' '}
                    {epsCurr !== null ? `₹${epsCurr.toFixed(2)}` : '—'})
                  </div>
                  <div className="text-slate-600">
                    EPS Drop = ₹0.00 → Peak Correction = ₹0.00 (Peak ₹{peak.toFixed(2)}
                    {detectedPeakDate ? ` on ${detectedPeakDate}` : ''})
                  </div>
                  <div className="text-slate-900 font-semibold pt-1 border-t border-slate-100">
                    Valuation Floor (2Q EPS × 90% P/E / 10% Pullback):{' '}
                    <span className="text-blue-700 text-sm">
                      {activeSupportFloor !== null ? `₹${activeSupportFloor.toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Current Close: ₹{close.toFixed(2)}</span>
                  <span className="font-semibold text-slate-900">
                    Downside Buffer: {downsidePct !== null ? `${downsidePct >= 0 ? '+' : ''}${downsidePct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Turnaround Top Formula */}
          <div className="border border-slate-200 rounded-md p-4 space-y-3 bg-slate-50/40">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-700" />
                Turnaround Top Formula (Upside Ceiling)
              </div>
              <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-blue-100 text-blue-800">
                EPS × PEAK P/E
              </span>
            </div>

            {activeTopTarget !== null && peakPe !== null ? (
              <div className="space-y-2 font-mono text-[11px]">
                <div className="p-2.5 bg-white border border-slate-200 rounded space-y-1.5">
                  <div className="text-slate-500">
                    Formula: Annualized EPS × Peak P/E ({peakPe.toFixed(2)}x)
                  </div>
                  {topTarget2Q !== null && twoQAnnualizedEps !== null && (
                    <div className="flex items-center justify-between text-slate-900">
                      <span>2Q Annualized (₹{twoQAnnualizedEps.toFixed(2)} × {peakPe.toFixed(2)}x):</span>
                      <span className="font-bold text-blue-700 text-sm">₹{topTarget2Q.toFixed(2)}</span>
                    </div>
                  )}
                  {topTargetTtm !== null && effectiveTtmEps !== null && (
                    <div className="flex items-center justify-between text-slate-700">
                      <span>TTM 4Q Basis (₹{effectiveTtmEps.toFixed(2)} × {peakPe.toFixed(2)}x):</span>
                      <span className="font-semibold">₹{topTargetTtm.toFixed(2)}</span>
                    </div>
                  )}
                  {topTargetLatestQ !== null && latestQAnnualizedEps !== null && (
                    <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-100">
                      <span>Latest Q×4 Run-Rate (₹{latestQAnnualizedEps.toFixed(2)} × {peakPe.toFixed(2)}x):</span>
                      <span className="font-semibold">₹{topTargetLatestQ.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>
                    Top Exhaustion Zone: ₹{activeTopZoneLow!.toFixed(2)} – ₹{activeTopZoneHigh!.toFixed(2)}
                  </span>
                  <span
                    className={`font-semibold ${
                      (upsidePct ?? 0) >= 10
                        ? 'text-emerald-700'
                        : (upsidePct ?? 0) > 0
                          ? 'text-amber-700'
                          : 'text-rose-700'
                    }`}
                  >
                    Upside Left: {upsidePct !== null ? `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-white border border-slate-200 rounded text-slate-500 font-mono text-[11px]">
                Positive Annualized EPS &amp; Trailing P/E required to compute Top Price = EPS × Peak P/E.
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Remaining Strength Gauge ("Stock Mai Kitna Strength Bacha Hai") */}
        <div
          className={`border rounded-md p-4 space-y-3 ${
            strengthVerdict.tone === 'emerald'
              ? 'bg-emerald-50/50 border-emerald-200'
              : strengthVerdict.tone === 'blue'
                ? 'bg-blue-50/50 border-blue-200'
                : strengthVerdict.tone === 'rose'
                  ? 'bg-rose-50/50 border-rose-200'
                  : 'bg-amber-50/50 border-amber-200'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <Gauge className="w-4 h-4 text-blue-700 shrink-0" />
              <span>Remaining Strength Check: {strengthVerdict.title}</span>
            </div>
            {strengthRemainingPct !== null && (
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {strengthRemainingPct.toFixed(0)}% Runway Remaining
                {rewardRiskRatio !== null ? ` · R:R ${rewardRiskRatio.toFixed(2)}:1` : ''}
              </span>
            )}
          </div>

          {activeSupportFloor !== null && activeTopTarget !== null && rangePositionPct !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-700">
                <span>Support Floor: ₹{activeSupportFloor.toFixed(2)}</span>
                <span className="font-semibold text-slate-900">
                  Close: ₹{close.toFixed(2)} ({rangePositionPct.toFixed(0)}% of range)
                </span>
                <span>Top Target: ₹{activeTopTarget.toFixed(2)}</span>
              </div>
              <div className="relative h-3 bg-white border border-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    strengthVerdict.tone === 'emerald'
                      ? 'bg-emerald-500'
                      : strengthVerdict.tone === 'blue'
                        ? 'bg-blue-600'
                        : strengthVerdict.tone === 'rose'
                          ? 'bg-rose-500'
                          : 'bg-amber-500'
                  }`}
                  style={{ width: `${rangePositionPct}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                <div className="text-slate-700">
                  Downside Buffer:{' '}
                  <strong className="text-slate-900">
                    {downsideInr !== null ? `${downsideInr >= 0 ? '+' : ''}₹${downsideInr.toFixed(2)}` : '—'} (
                    {downsidePct !== null ? `${downsidePct.toFixed(1)}%` : '—'})
                  </strong>
                </div>
                <div className="text-center text-slate-700">
                  Upside Left to Top:{' '}
                  <strong
                    className={
                      (upsidePct ?? 0) >= 10
                        ? 'text-emerald-700'
                        : (upsidePct ?? 0) > 0
                          ? 'text-blue-700'
                          : 'text-rose-700'
                    }
                  >
                    {upsideInr !== null ? `${upsideInr >= 0 ? '+' : ''}₹${upsideInr.toFixed(2)}` : '—'} (
                    {upsidePct !== null ? `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)}%` : '—'})
                  </strong>
                </div>
                <div className="text-right text-slate-700">
                  Reward : Risk:{' '}
                  <strong className="text-slate-900">
                    {rewardRiskRatio !== null ? `${rewardRiskRatio.toFixed(2)} : 1` : '—'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs leading-relaxed text-slate-700">{strengthVerdict.detail}</p>
        </div>
      </div>
    </section>
  );
};
