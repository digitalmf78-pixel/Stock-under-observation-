import type { BotStockAnalysis } from '../types/trading';

export type BurstPowerProfileCategory =
  | 'High-Intensity Accumulation'
  | 'Distribution Trend'
  | 'Consolidation Zone'
  | 'DATA NOT AVAILABLE';

export interface BurstPowerProfileSummary {
  category: BurstPowerProfileCategory;
  shortTag: string;
  headline: string;
  rationale: string;
  lookbackDays: number;
  upwardNorm: number | null;
  downwardNorm: number | null;
  netNorm: number | null;
  upwardRaw: number | null;
  downwardRaw: number | null;
  netRaw: number | null;
  upwardSharePct: number | null;
  downwardSharePct: number | null;
  upwardDayRatePct: number | null;
  downwardDayRatePct: number | null;
  netEdgePct: number | null;
  upDaysTotal: number;
  downDaysTotal: number;
}

export function classifyBurstPowerProfile(
  phase4: BotStockAnalysis['phase4Movement']
): BurstPowerProfileSummary {
  const upNorm = phase4.burstPowerNormalized;
  const dnNorm = phase4.downwardBurstNormalized;
  const netNorm = phase4.netBurstNormalized;
  const upRaw = phase4.burstPowerRaw;
  const dnRaw = phase4.downwardBurstRaw;
  const netRaw = phase4.netBurstRaw;

  const upDaysTotal =
    phase4.days5To10Pct + phase4.days10To19Pct + phase4.days19PlusPct;
  const downDaysTotal =
    phase4.downDays5To10Pct +
    phase4.downDays10To19Pct +
    phase4.downDays19PlusPct;

  if (upNorm === null || dnNorm === null || netNorm === null) {
    return {
      category: 'DATA NOT AVAILABLE',
      shortTag: 'INSUFFICIENT 252D DATA',
      headline: 'Insufficient 252D trading history to classify Burst Power Profile.',
      rationale: `At least 15 OHLCV sessions are required (currently ${phase4.lookbackDays} sessions).`,
      lookbackDays: phase4.lookbackDays,
      upwardNorm: null,
      downwardNorm: null,
      netNorm: null,
      upwardRaw: null,
      downwardRaw: null,
      netRaw: null,
      upwardSharePct: null,
      downwardSharePct: null,
      upwardDayRatePct: null,
      downwardDayRatePct: null,
      netEdgePct: null,
      upDaysTotal,
      downDaysTotal,
    };
  }

  const safeUpRaw = upRaw ?? 0;
  const safeDnRaw = dnRaw ?? 0;
  const totalRaw = safeUpRaw + safeDnRaw;
  const lookback = Math.max(1, phase4.lookbackDays || 1);

  const upwardSharePct =
    phase4.upwardBurstSharePct !== undefined && phase4.upwardBurstSharePct !== null
      ? phase4.upwardBurstSharePct
      : totalRaw > 0
        ? Number(((safeUpRaw / totalRaw) * 100).toFixed(1))
        : 0;
  const downwardSharePct =
    phase4.downwardBurstSharePct !== undefined && phase4.downwardBurstSharePct !== null
      ? phase4.downwardBurstSharePct
      : totalRaw > 0
        ? Number((100 - upwardSharePct).toFixed(1))
        : 0;
  const upwardDayRatePct =
    phase4.upwardBurstDaysPct !== undefined && phase4.upwardBurstDaysPct !== null
      ? phase4.upwardBurstDaysPct
      : Number(((upDaysTotal / lookback) * 100).toFixed(1));
  const downwardDayRatePct =
    phase4.downwardBurstDaysPct !== undefined && phase4.downwardBurstDaysPct !== null
      ? phase4.downwardBurstDaysPct
      : Number(((downDaysTotal / lookback) * 100).toFixed(1));
  const netEdgePct = Number((upwardSharePct - downwardSharePct).toFixed(1));

  const pctSummary =
    totalRaw > 0
      ? `Out of all ±5%+ burst moves in ${lookback}D, ${upwardSharePct}% were Upward vs ${downwardSharePct}% Downward (Intensity: Up ${upNorm.toFixed(1)}% vs Down ${dnNorm.toFixed(1)}%).`
      : `0% Upward / 0% Downward big (±5%+) burst moves recorded across ${lookback} sessions.`;

  // 1. High-Intensity Accumulation: Upward Burst >= 10% with Net > 0, OR Net Burst >= +5% with Upward > Downward
  if ((upNorm >= 10 && netNorm > 0) || (netNorm >= 5 && upNorm > dnNorm)) {
    return {
      category: 'High-Intensity Accumulation',
      shortTag: 'EXPANSION IMPULSE',
      headline:
        'Strong upward burst dominance over 252D shows buyers control the big moves.',
      rationale: `${pctSummary} ${upDaysTotal} big +5%+ gain days (${upwardDayRatePct}% of days) vs ${downDaysTotal} drop days (${downwardDayRatePct}% of days).`,
      lookbackDays: phase4.lookbackDays,
      upwardNorm: upNorm,
      downwardNorm: dnNorm,
      netNorm,
      upwardRaw: upRaw,
      downwardRaw: dnRaw,
      netRaw,
      upwardSharePct,
      downwardSharePct,
      upwardDayRatePct,
      downwardDayRatePct,
      netEdgePct,
      upDaysTotal,
      downDaysTotal,
    };
  }

  // 2. Distribution Trend: Net Burst <= -2%, OR Downward Burst >= 10% dominating Upward Burst
  if (netNorm <= -2 || (dnNorm >= 10 && netNorm < 0)) {
    return {
      category: 'Distribution Trend',
      shortTag: 'SUPPLY / CRASH RISK',
      headline:
        'Downward burst % exceeds upward burst % over 252D, signaling selling/supply pressure.',
      rationale: `${pctSummary} ${downDaysTotal} sharp -5%+ drop days (${downwardDayRatePct}% of days) outpace ${upDaysTotal} gain days (${upwardDayRatePct}% of days).`,
      lookbackDays: phase4.lookbackDays,
      upwardNorm: upNorm,
      downwardNorm: dnNorm,
      netNorm,
      upwardRaw: upRaw,
      downwardRaw: dnRaw,
      netRaw,
      upwardSharePct,
      downwardSharePct,
      upwardDayRatePct,
      downwardDayRatePct,
      netEdgePct,
      upDaysTotal,
      downDaysTotal,
    };
  }

  // 3. Consolidation Zone: Balanced / low-volatility coil without extreme directional burst dominance
  return {
    category: 'Consolidation Zone',
    shortTag: 'RANGEBOUND / BASE',
    headline:
      'Balanced Upward vs Downward Burst % over 252D — sideways base-building or equal two-way swings.',
    rationale: `${pctSummary} Net intensity spread (${netNorm >= 0 ? '+' : ''}${netNorm.toFixed(1)}%) sits inside the neutral -2% to +5% band.`,
    lookbackDays: phase4.lookbackDays,
    upwardNorm: upNorm,
    downwardNorm: dnNorm,
    netNorm,
    upwardRaw: upRaw,
    downwardRaw: dnRaw,
    netRaw,
    upwardSharePct,
    downwardSharePct,
    upwardDayRatePct,
    downwardDayRatePct,
    netEdgePct,
    upDaysTotal,
    downDaysTotal,
  };
}
