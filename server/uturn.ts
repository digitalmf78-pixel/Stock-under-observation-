import type {
  DailyBhavRow,
  TurnaroundTopChartPoint,
  TurnaroundTopEvaluation,
  TurnaroundTopSessionCheck,
  TurnaroundTopStatus,
  UTurnChartPoint,
  UTurnEvaluation,
  UTurnSessionCheck,
  UTurnStatus,
} from '../src/types/trading.ts';
import { calculateRvolSeries } from './technicalIndicators.ts';

export interface UTurnOptions {
  symbol?: string;
  customPeakPrice?: number;
  correctionMode?: 'EPS_VALUATION' | 'PCT' | 'INR';
  epsPrev?: number | null;
  epsCurr?: number | null;
  epsPrevPeriod?: string;
  epsCurrPeriod?: string;
  avgPeRatio?: number | null;
  correctionPct?: number;
  correctionInr?: number;
  zoneTolerancePct?: number;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function evaluateUTurnConfirmation(
  history: DailyBhavRow[],
  options?: UTurnOptions
): UTurnEvaluation | null {
  const valid = history.filter(
    (d): d is DailyBhavRow & { close: number } => d.close !== null && d.close > 0
  );
  if (valid.length < 2) return null;

  const symbol = (options?.symbol || valid[0].symbol || '').trim().toUpperCase();
  const lastIdx = valid.length - 1;
  const latestBar = valid[lastIdx];
  const latestClose = latestBar.close;

  const zoneTolerancePct =
    typeof options?.zoneTolerancePct === 'number' && options.zoneTolerancePct === 3 ? 3 : 2;
  const tolFrac = zoneTolerancePct / 100;

  // Precompute RVOL per session (strict 21-point minimum: 20 prior sessions + 1 current day)
  const rvolSeries: Array<number | null> = calculateRvolSeries(
    valid.map((b) => b.volume),
    20
  );

  // Auto-detect Peak Price & Date from cached window (take latest occurrence if tied)
  let autoPeakIdx = 0;
  let autoPeakPrice = -1;
  for (let i = 0; i < valid.length; i++) {
    const h = valid[i].high ?? valid[i].close;
    if (h >= autoPeakPrice) {
      autoPeakPrice = h;
      autoPeakIdx = i;
    }
  }

  const hasCustomPeak =
    typeof options?.customPeakPrice === 'number' &&
    Number.isFinite(options.customPeakPrice) &&
    options.customPeakPrice > 0;

  const isCustomPeak =
    hasCustomPeak && Math.abs((options!.customPeakPrice as number) - autoPeakPrice) > 0.01;

  const peakPrice = isCustomPeak ? (options!.customPeakPrice as number) : autoPeakPrice;

  // Find peak anchor index when custom peak sits inside window; if above window max (e.g. 52W peak), scan entire window
  let peakIdx = autoPeakIdx;
  let peakDate = valid[autoPeakIdx].date;
  let scanStartIdx = autoPeakIdx + 1;

  if (isCustomPeak) {
    if (peakPrice > autoPeakPrice * 1.01) {
      peakIdx = 0;
      peakDate = 'External / Prior Peak';
      scanStartIdx = 0;
    } else {
      let matchedIdx = -1;
      for (let i = valid.length - 1; i >= 0; i--) {
        const h = valid[i].high ?? valid[i].close;
        if (h >= peakPrice * 0.995) {
          matchedIdx = i;
          break;
        }
      }
      if (matchedIdx >= 0) {
        peakIdx = matchedIdx;
        peakDate = valid[matchedIdx].date;
        scanStartIdx = matchedIdx + 1;
      } else {
        peakIdx = 0;
        peakDate = valid[0].date;
        scanStartIdx = 0;
      }
    }
  }

  const epsPrev =
    typeof options?.epsPrev === 'number' && Number.isFinite(options.epsPrev)
      ? round2(options.epsPrev)
      : null;
  const epsCurr =
    typeof options?.epsCurr === 'number' && Number.isFinite(options.epsCurr)
      ? round2(options.epsCurr)
      : null;
  const avgPeRatio =
    typeof options?.avgPeRatio === 'number' &&
    Number.isFinite(options.avgPeRatio) &&
    options.avgPeRatio > 0
      ? round2(options.avgPeRatio)
      : null;
  const epsPrevPeriod = options?.epsPrevPeriod || '';
  const epsCurrPeriod = options?.epsCurrPeriod || '';
  const epsDrop = epsPrev !== null && epsCurr !== null ? round2(epsPrev - epsCurr) : null;

  const requestedMode = options?.correctionMode;
  const correctionMode: 'EPS_VALUATION' | 'PCT' | 'INR' =
    requestedMode === 'EPS_VALUATION' || requestedMode === 'INR' || requestedMode === 'PCT'
      ? requestedMode
      : 'EPS_VALUATION';

  let expectedCorrectionPct: number;
  let expectedCorrectionInr: number;
  let noEpsDropInData = false;

  if (correctionMode === 'EPS_VALUATION') {
    if (epsDrop !== null && epsDrop > 0 && avgPeRatio !== null && avgPeRatio > 0) {
      const rawCorr = epsDrop * avgPeRatio;
      expectedCorrectionInr = Math.min(peakPrice * 0.9, Math.max(0, rawCorr));
      expectedCorrectionPct = (expectedCorrectionInr / peakPrice) * 100;
    } else {
      noEpsDropInData = true;
      expectedCorrectionInr = 0;
      expectedCorrectionPct = 0;
    }
  } else if (correctionMode === 'INR') {
    const rawInr =
      typeof options?.correctionInr === 'number' && Number.isFinite(options.correctionInr)
        ? options.correctionInr
        : peakPrice * 0.1;
    expectedCorrectionInr = Math.min(peakPrice * 0.9, Math.max(0.05, rawInr));
    expectedCorrectionPct = (expectedCorrectionInr / peakPrice) * 100;
  } else {
    const rawPct =
      typeof options?.correctionPct === 'number' && Number.isFinite(options.correctionPct)
        ? options.correctionPct
        : 10;
    expectedCorrectionPct = Math.min(90, Math.max(1, rawPct));
    expectedCorrectionInr = peakPrice * (expectedCorrectionPct / 100);
  }

  const uTurnTarget = Math.max(0.05, peakPrice - expectedCorrectionInr);
  const zoneLow = uTurnTarget * (1 - tolFrac);
  const zoneHigh = uTurnTarget * (1 + tolFrac);
  const distFromTargetPct = ((latestClose - uTurnTarget) / uTurnTarget) * 100;
  const inTargetZoneNow = latestClose >= zoneLow && latestClose <= zoneHigh;

  const barTouchesZone = (b: DailyBhavRow & { close: number }): boolean => {
    const lo = b.low ?? b.close;
    const hi = b.high ?? b.close;
    return (b.close >= zoneLow && b.close <= zoneHigh) || (lo <= zoneHigh && hi >= zoneLow);
  };

  // Scan sessions after Peak to locate first entry into Target Zone
  let zoneTouchIdx: number | null = null;
  for (let i = Math.min(scanStartIdx, valid.length); i < valid.length; i++) {
    if (barTouchesZone(valid[i])) {
      zoneTouchIdx = i;
      break;
    }
  }

  const touchedTargetZone = zoneTouchIdx !== null;
  const latestRvol = rvolSeries[lastIdx];
  const latestDelivPer = latestBar.delivPer;

  // Evaluate all sessions from zoneTouchIdx onward (touch day + subsequent sessions)
  const subsequentSessions: UTurnSessionCheck[] = [];
  let triggerIdx: number | null = null;

  if (zoneTouchIdx !== null) {
    for (let i = zoneTouchIdx; i < valid.length; i++) {
      const b = valid[i];
      const prevC = i > 0 ? valid[i - 1].close : b.prevClose;
      const changePct = prevC && prevC > 0 ? ((b.close - prevC) / prevC) * 100 : null;
      const rvol = rvolSeries[i];
      const inZone = barTouchesZone(b);
      const delivOk = (b.delivPer ?? 0) >= 60;
      const rvolOk = (rvol ?? 0) >= 1.5;
      const techTriggerMet = inZone && delivOk && rvolOk;

      if (techTriggerMet && triggerIdx === null) {
        triggerIdx = i;
      }

      let action: UTurnSessionCheck['action'];
      if (b.close < zoneLow) {
        action = 'BROKE_BELOW';
      } else if (techTriggerMet && b.close >= zoneLow && b.close <= zoneHigh) {
        action = 'IN_ZONE_TRIGGER';
      } else if (b.close > zoneHigh) {
        action = 'BOUNCED_ABOVE';
      } else if (i === zoneTouchIdx) {
        action = 'IN_ZONE';
      } else {
        action = 'HELD_SUPPORT';
      }

      subsequentSessions.push({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: round2(b.close),
        changePct: changePct !== null ? round2(changePct) : null,
        delivPer: b.delivPer !== null ? round2(b.delivPer) : null,
        rvol: rvol !== null ? round2(rvol) : null,
        vsTargetPct: round2(((b.close - uTurnTarget) / uTurnTarget) * 100),
        inZone,
        techTriggerMet,
        action,
      });
    }
  }

  const afterTouch = subsequentSessions.slice(1);
  const subsequentSessionsCount = afterTouch.length;
  const heldSessionsCount = afterTouch.filter((s) => s.close >= zoneLow).length;
  const brokeSessionsCount = afterTouch.filter((s) => s.close < zoneLow).length;

  const lowestCloseAfterZone =
    afterTouch.length > 0 ? round2(Math.min(...afterTouch.map((s) => s.close))) : null;
  const highestCloseAfterZone =
    afterTouch.length > 0 ? round2(Math.max(...afterTouch.map((s) => s.close))) : null;
  const bounceFromTargetPct =
    subsequentSessions.length > 0
      ? round2(((latestClose - uTurnTarget) / uTurnTarget) * 100)
      : null;

  // Determine Reference Delivery & RVOL (trigger session if fired, else latest session)
  const triggerBar = triggerIdx !== null ? valid[triggerIdx] : null;
  const triggerRvol = triggerIdx !== null ? rvolSeries[triggerIdx] : null;
  const refDeliv = triggerBar ? triggerBar.delivPer : latestDelivPer;
  const refRvol = triggerBar ? triggerRvol : latestRvol;

  const deliveryPass = (refDeliv ?? 0) >= 60;
  const rvolPass = (refRvol ?? 0) >= 1.5;
  const targetZonePass = inTargetZoneNow || touchedTargetZone;
  const subsequentSupportPass: boolean | null =
    afterTouch.length > 0 ? brokeSessionsCount === 0 && latestClose >= zoneLow : null;

  const latestTechTriggerMet =
    inTargetZoneNow && (latestDelivPer ?? 0) >= 60 && (latestRvol ?? 0) >= 1.5;

  let status: UTurnStatus;
  let verdictLabel: string;
  let verdictDetail: string;

  if (noEpsDropInData) {
    status = 'ABOVE_ZONE';
    if (epsPrev === null || epsCurr === null || avgPeRatio === null) {
      verdictLabel = 'EPS / PE Data Unavailable for Valuation Formula';
      verdictDetail =
        'Quarterly EPS or Average PE is not available yet. Click "Fetch Live EPS & PE", enter EPS Prev / EPS Curr / Avg PE manually, or switch to % Drop mode.';
    } else {
      verdictLabel = `No Quarterly EPS Drop (EPS ${epsPrev.toFixed(2)} -> ${epsCurr.toFixed(2)})`;
      verdictDetail = `Latest quarter EPS did not decline (${epsPrevPeriod || 'Prev'} ₹${epsPrev.toFixed(2)} -> ${epsCurrPeriod || 'Curr'} ₹${epsCurr.toFixed(2)}), so EPS Drop = ₹0.00. Enter a prior peak-quarter EPS manually or switch to % Drop mode.`;
    }
  } else if (latestClose < zoneLow) {
    status = 'BROKEN_DOWN';
    verdictLabel = `Zone Broken Down (Target - ${zoneTolerancePct}% Breached)`;
    verdictDetail = `Latest close ₹${latestClose.toFixed(2)} slipped below Zone Low ₹${zoneLow.toFixed(2)} (${distFromTargetPct.toFixed(1)}% vs Target). Support failed in subsequent sessions — avoid catching falling knife.`;
  } else if (!touchedTargetZone) {
    status = 'ABOVE_ZONE';
    verdictLabel = 'Above Target Zone (Pullback Pending)';
    verdictDetail = `Price (₹${latestClose.toFixed(2)}) is +${distFromTargetPct.toFixed(1)}% above U-Turn Target ₹${uTurnTarget.toFixed(2)}. Wait for correction into ₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)} zone.`;
  } else if (afterTouch.length === 0) {
    if (latestTechTriggerMet) {
      status = 'ACTIVE_TRIGGER';
      verdictLabel = 'Active Technical Trigger — Check Next Sessions';
      verdictDetail = `Price entered ±${zoneTolerancePct}% Target Zone (₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)}) with Delivery ${latestDelivPer?.toFixed(1)}% (>=60%) & RVOL ${latestRvol?.toFixed(2)}x (>=1.5x). Watch subsequent sessions to confirm support holds above ₹${zoneLow.toFixed(2)}.`;
    } else {
      status = 'IN_ZONE';
      verdictLabel = `In Target Zone (±${zoneTolerancePct}%) — Awaiting Deliv/RVOL & Support`;
      verdictDetail = `Price touched Target Zone today (₹${latestClose.toFixed(2)}); confirm Delivery >=60%, RVOL >=1.5x, and subsequent-session support hold above ₹${zoneLow.toFixed(2)}.`;
    }
  } else if (brokeSessionsCount > 0) {
    if (latestTechTriggerMet) {
      status = 'ACTIVE_TRIGGER';
      verdictLabel = 'Re-Entered Target Zone on Volume — Re-Verify Support';
      verdictDetail = `Stock previously closed below ₹${zoneLow.toFixed(2)} (${brokeSessionsCount}x) but triggered Deliv >=60% & RVOL >=1.5x today inside zone. Wait for subsequent closes above ₹${zoneLow.toFixed(2)}.`;
    } else if (inTargetZoneNow) {
      status = 'IN_ZONE';
      verdictLabel = 'In Zone After Prior Breach — Watch Closely';
      verdictDetail = `Price had ${brokeSessionsCount} close(s) below ₹${zoneLow.toFixed(2)} after touching zone on ${valid[zoneTouchIdx!].date}. Needs clean hold above ₹${zoneLow.toFixed(2)} with Deliv >=60% & RVOL >=1.5x.`;
    } else {
      status = 'BROKEN_DOWN';
      verdictLabel = 'Prior Support Breached Below Zone';
      verdictDetail = `After touching Target Zone on ${valid[zoneTouchIdx!].date}, ${brokeSessionsCount} of ${subsequentSessionsCount} subsequent session(s) closed below ₹${zoneLow.toFixed(2)}.`;
    }
  } else if (triggerIdx !== null) {
    status = 'CONFIRMED_SUPPORT';
    verdictLabel = 'U-Turn Confirmed (Support Banaya)';
    verdictDetail = `Touched Target Zone on ${valid[zoneTouchIdx!].date}, confirmed Deliv ${refDeliv?.toFixed(1)}% & RVOL ${refRvol?.toFixed(2)}x on ${valid[triggerIdx].date}, and held >= ₹${zoneLow.toFixed(2)} across all ${subsequentSessionsCount} subsequent session(s) (${bounceFromTargetPct !== null && bounceFromTargetPct >= 0 ? '+' : ''}${bounceFromTargetPct?.toFixed(1)}% vs target).`;
  } else {
    status = 'SUPPORT_HOLD';
    verdictLabel = 'Price Support Held — Awaiting Deliv/RVOL Confirmation';
    verdictDetail = `Held >= ₹${zoneLow.toFixed(2)} across ${subsequentSessionsCount} subsequent session(s) since ${valid[zoneTouchIdx!].date}, but Delivery >=60% & RVOL >=1.5x did not align together in the zone.`;
  }

  // Build trajectory chart points from just before Peak through latest session
  const chartStart = Math.max(0, peakIdx - 2);
  const subByDate = new Map(subsequentSessions.map((s) => [s.date, s]));
  const chartPoints: UTurnChartPoint[] = [];
  for (let i = chartStart; i < valid.length; i++) {
    const b = valid[i];
    const sub = subByDate.get(b.date);
    chartPoints.push({
      date: b.date,
      close: round2(b.close),
      high: round2(b.high ?? b.close),
      low: round2(b.low ?? b.close),
      delivPer: b.delivPer !== null ? round2(b.delivPer) : null,
      rvol: rvolSeries[i] !== null ? round2(rvolSeries[i]!) : null,
      isPeak: i === peakIdx && !isCustomPeak,
      isZoneTouch: i === zoneTouchIdx,
      action: sub ? sub.action : 'PRE_ZONE',
    });
  }

  return {
    symbol,
    latestDate: latestBar.date,
    latestClose: round2(latestClose),
    peakPrice: round2(peakPrice),
    peakDate,
    isCustomPeak,
    correctionMode,
    epsPrev,
    epsCurr,
    epsPrevPeriod,
    epsCurrPeriod,
    epsDrop,
    avgPeRatio,
    noEpsDropInData,
    zoneTolerancePct,
    expectedCorrectionPct: round2(expectedCorrectionPct),
    expectedCorrectionInr: round2(expectedCorrectionInr),
    uTurnTarget: round2(uTurnTarget),
    zoneLow: round2(zoneLow),
    zoneHigh: round2(zoneHigh),
    distFromTargetPct: round2(distFromTargetPct),
    inTargetZoneNow,
    touchedTargetZone,
    zoneTouchDate: zoneTouchIdx !== null ? valid[zoneTouchIdx].date : null,
    triggerDate: triggerBar ? triggerBar.date : null,
    triggerDelivPer: refDeliv !== null ? round2(refDeliv) : null,
    triggerRvol: refRvol !== null ? round2(refRvol) : null,
    latestDelivPer: latestDelivPer !== null ? round2(latestDelivPer) : null,
    latestRvol: latestRvol !== null ? round2(latestRvol) : null,
    gates: {
      targetZonePass,
      deliveryPass,
      rvolPass,
      subsequentSupportPass,
    },
    subsequentSessionsCount,
    heldSessionsCount,
    brokeSessionsCount,
    lowestCloseAfterZone,
    highestCloseAfterZone,
    bounceFromTargetPct,
    status,
    verdictLabel,
    verdictDetail,
    subsequentSessions,
    chartPoints,
  };
}

export interface TurnaroundTopOptions {
  symbol?: string;
  epsQPrev?: number | null;
  epsQCurr?: number | null;
  epsPrevPeriod?: string;
  epsCurrPeriod?: string;
  epsTtmPrev?: number | null;
  epsTtmCurr?: number | null;
  liveTrailingPE?: number | null;
  customEffectiveEps?: number | null;
  customPeakPe?: number | null;
}

export function evaluateTurnaroundTopConfirmation(
  history: DailyBhavRow[],
  options?: TurnaroundTopOptions
): TurnaroundTopEvaluation | null {
  const valid = history.filter(
    (d): d is DailyBhavRow & { close: number } => d.close !== null && d.close > 0
  );
  if (valid.length < 2) return null;

  const symbol = (options?.symbol || valid[0].symbol || '').trim().toUpperCase();
  const lastIdx = valid.length - 1;
  const latestBar = valid[lastIdx];
  const latestClose = latestBar.close;

  const rvolSeries: Array<number | null> = calculateRvolSeries(
    valid.map((b) => b.volume),
    20
  );

  const avgDelivSeries: Array<number | null> = valid.map((_b, i) => {
    if (i < 2) return null;
    const start = Math.max(0, i - 20);
    const priorDeliv = valid
      .slice(start, i)
      .map((p) => p.delivPer)
      .filter((d): d is number => d !== null && Number.isFinite(d));
    if (priorDeliv.length < 2) return null;
    return priorDeliv.reduce((s, d) => s + d, 0) / priorDeliv.length;
  });

  const avgDelivery20D = avgDelivSeries[lastIdx];
  const latestRvol = rvolSeries[lastIdx];
  const latestDelivPer = latestBar.delivPer;

  let autoPeakPrice = -1;
  for (let i = 0; i < valid.length; i++) {
    const h = valid[i].high ?? valid[i].close;
    if (h >= autoPeakPrice) {
      autoPeakPrice = h;
    }
  }

  const epsQPrev =
    typeof options?.epsQPrev === 'number' && Number.isFinite(options.epsQPrev)
      ? round2(options.epsQPrev)
      : null;
  const epsQCurr =
    typeof options?.epsQCurr === 'number' && Number.isFinite(options.epsQCurr)
      ? round2(options.epsQCurr)
      : null;
  const epsPrevPeriod = options?.epsPrevPeriod || '';
  const epsCurrPeriod = options?.epsCurrPeriod || '';

  let epsJumpPct: number | null = null;
  if (epsQPrev !== null && epsQCurr !== null && Math.abs(epsQPrev) > 0) {
    epsJumpPct = round2(((epsQCurr - epsQPrev) / Math.abs(epsQPrev)) * 100);
  }

  const epsTtmPrev =
    typeof options?.epsTtmPrev === 'number' && Number.isFinite(options.epsTtmPrev)
      ? round2(options.epsTtmPrev)
      : null;
  const epsTtmCurr =
    typeof options?.epsTtmCurr === 'number' && Number.isFinite(options.epsTtmCurr)
      ? round2(options.epsTtmCurr)
      : null;
  const liveTrailingPE =
    typeof options?.liveTrailingPE === 'number' &&
    Number.isFinite(options.liveTrailingPE) &&
    options.liveTrailingPE > 0
      ? round2(options.liveTrailingPE)
      : null;

  const hasCustomEps =
    typeof options?.customEffectiveEps === 'number' &&
    Number.isFinite(options.customEffectiveEps) &&
    options.customEffectiveEps > 0;
  const hasCustomPe =
    typeof options?.customPeakPe === 'number' &&
    Number.isFinite(options.customPeakPe) &&
    options.customPeakPe > 0;
  const hasCustomOverride = hasCustomEps || hasCustomPe;

  const effectiveEps = hasCustomEps
    ? round2(options!.customEffectiveEps!)
    : epsTtmCurr !== null && epsTtmCurr > 0
      ? epsTtmCurr
      : epsQCurr !== null && epsQCurr > 0
        ? round2(epsQCurr * 4)
        : null;

  const peakPeRatio = hasCustomPe
    ? round2(options!.customPeakPe!)
    : liveTrailingPE !== null && effectiveEps !== null && effectiveEps > 0
      ? round2(Math.max(liveTrailingPE, autoPeakPrice / effectiveEps))
      : liveTrailingPE;

  const noEpsJump =
    !hasCustomOverride &&
    epsQPrev !== null &&
    epsQCurr !== null &&
    epsQCurr <= epsQPrev;

  const noDataOrNoJump =
    noEpsJump ||
    effectiveEps === null ||
    effectiveEps <= 0 ||
    peakPeRatio === null ||
    peakPeRatio <= 0;

  const topTargetPrice =
    !noDataOrNoJump && effectiveEps !== null && peakPeRatio !== null
      ? round2(effectiveEps * peakPeRatio)
      : null;
  const zoneLow = topTargetPrice !== null ? round2(topTargetPrice * 0.96) : null;
  const zoneHigh = topTargetPrice !== null ? round2(topTargetPrice * 1.02) : null;
  const distFromTopPct =
    topTargetPrice !== null && topTargetPrice > 0
      ? round2(((latestClose - topTargetPrice) / topTargetPrice) * 100)
      : null;

  const inTopZoneNow =
    zoneLow !== null &&
    zoneHigh !== null &&
    latestClose >= zoneLow &&
    latestClose <= zoneHigh;

  const isLowDelivBar = (delivPer: number | null, priorAvg: number | null): boolean => {
    if (delivPer === null) return false;
    return delivPer < 50 || (priorAvg !== null && delivPer <= priorAvg - 5);
  };

  if (noDataOrNoJump || topTargetPrice === null || zoneLow === null || zoneHigh === null) {
    const reasonLabel = noEpsJump
      ? `No Quarterly EPS Turnaround Jump (EPS ${epsQPrev?.toFixed(2) ?? '—'} -> ${epsQCurr?.toFixed(2) ?? '—'})`
      : 'Turnaround Top EPS / Peak PE Data Unavailable';
    const reasonDetail = noEpsJump
      ? `Latest quarter EPS did not rebound higher (${epsPrevPeriod || 'Prev'} ₹${epsQPrev?.toFixed(2) ?? '—'} -> ${epsCurrPeriod || 'Curr'} ₹${epsQCurr?.toFixed(2) ?? '—'}). Enter Effective EPS & Peak PE manually to model a turnaround top scenario.`
      : 'Trailing TTM EPS or Peak PE is missing. Enter Effective EPS & Peak PE manually to compute Top Price = EPS × Peak PE.';

    return {
      symbol,
      latestDate: latestBar.date,
      latestClose: round2(latestClose),
      epsQPrev,
      epsQCurr,
      epsPrevPeriod,
      epsCurrPeriod,
      epsJumpPct,
      epsTtmPrev,
      epsTtmCurr,
      effectiveEps,
      liveTrailingPE,
      peakPeRatio,
      topTargetPrice,
      zoneLow,
      zoneHigh,
      distFromTopPct,
      avgDelivery20D: avgDelivery20D !== null ? round2(avgDelivery20D) : null,
      latestDelivPer: latestDelivPer !== null ? round2(latestDelivPer) : null,
      latestRvol: latestRvol !== null ? round2(latestRvol) : null,
      triggerDate: null,
      triggerDelivPer: null,
      triggerRvol: null,
      zoneTouchDate: null,
      inTopZoneNow: false,
      touchedTopZone: false,
      noDataOrNoJump: true,
      gates: {
        topZonePass: false,
        highRvolPass: (latestRvol ?? 0) >= 1.5,
        lowDeliveryPass: isLowDelivBar(latestDelivPer, avgDelivery20D),
        subsequentTopPass: null,
      },
      subsequentSessionsCount: 0,
      rejectedSessionsCount: 0,
      breakoutSessionsCount: 0,
      status: 'BELOW_TOP_ZONE',
      verdictLabel: reasonLabel,
      verdictDetail: reasonDetail,
      subsequentSessions: [],
      chartPoints: valid.slice(-30).map((b, idx, arr) => {
        const origIdx = valid.length - arr.length + idx;
        return {
          date: b.date,
          close: round2(b.close),
          high: round2(b.high ?? b.close),
          low: round2(b.low ?? b.close),
          delivPer: b.delivPer !== null ? round2(b.delivPer) : null,
          rvol: rvolSeries[origIdx] !== null ? round2(rvolSeries[origIdx]!) : null,
          action: 'PRE_TOP',
        };
      }),
    };
  }

  const barTouchesTopZone = (b: DailyBhavRow & { close: number }): boolean => {
    const hi = b.high ?? b.close;
    const lo = b.low ?? b.close;
    return (b.close >= zoneLow && b.close <= zoneHigh) || (hi >= zoneLow && lo <= zoneHigh);
  };

  let zoneTouchIdx: number | null = null;
  for (let i = 0; i < valid.length; i++) {
    if (barTouchesTopZone(valid[i]) || valid[i].close >= zoneLow) {
      zoneTouchIdx = i;
      break;
    }
  }

  const touchedTopZone = zoneTouchIdx !== null;
  const subsequentSessions: TurnaroundTopSessionCheck[] = [];
  let triggerIdx: number | null = null;

  if (zoneTouchIdx !== null) {
    const touchClose = valid[zoneTouchIdx].close;
    for (let i = zoneTouchIdx; i < valid.length; i++) {
      const b = valid[i];
      const prevC = i > 0 ? valid[i - 1].close : b.prevClose;
      const changePct = prevC && prevC > 0 ? ((b.close - prevC) / prevC) * 100 : null;
      const rvol = rvolSeries[i];
      const priorAvgDeliv = avgDelivSeries[i];
      const inTopZone = barTouchesTopZone(b);
      const rvolOk = (rvol ?? 0) >= 1.5;
      const lowDelivOk = isLowDelivBar(b.delivPer, priorAvgDeliv);
      const exhaustionTriggerMet = inTopZone && rvolOk && lowDelivOk;

      if (exhaustionTriggerMet && triggerIdx === null) {
        triggerIdx = i;
      }

      let action: TurnaroundTopSessionCheck['action'];
      if (b.close > zoneHigh && (b.delivPer ?? 0) >= 50) {
        action = 'TOP_BREAKOUT';
      } else if (exhaustionTriggerMet && b.close >= zoneLow && b.close <= zoneHigh) {
        action = 'TOP_TRIGGER';
      } else if (
        i > zoneTouchIdx &&
        (b.close < touchClose || b.close < topTargetPrice * 0.98 || b.close < zoneLow)
      ) {
        action = 'TOP_REJECTION';
      } else {
        action = 'TOP_ZONE';
      }

      subsequentSessions.push({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: round2(b.close),
        changePct: changePct !== null ? round2(changePct) : null,
        delivPer: b.delivPer !== null ? round2(b.delivPer) : null,
        rvol: rvol !== null ? round2(rvol) : null,
        vsTopPct: round2(((b.close - topTargetPrice) / topTargetPrice) * 100),
        inTopZone,
        exhaustionTriggerMet,
        action,
      });
    }
  }

  const afterTouch = subsequentSessions.slice(1);
  const subsequentSessionsCount = afterTouch.length;
  const rejectedSessionsCount = afterTouch.filter((s) => s.action === 'TOP_REJECTION').length;
  const breakoutSessionsCount = afterTouch.filter((s) => s.action === 'TOP_BREAKOUT').length;

  const triggerBar = triggerIdx !== null ? valid[triggerIdx] : null;
  const triggerRvol = triggerIdx !== null ? rvolSeries[triggerIdx] : null;
  const triggerPriorAvgDeliv = triggerIdx !== null ? avgDelivSeries[triggerIdx] : avgDelivery20D;

  const refDeliv = triggerBar ? triggerBar.delivPer : latestDelivPer;
  const refRvol = triggerBar ? triggerRvol : latestRvol;
  const refAvgDeliv = triggerBar ? triggerPriorAvgDeliv : avgDelivery20D;

  const topZonePass = inTopZoneNow || touchedTopZone;
  const highRvolPass = (refRvol ?? 0) >= 1.5;
  const lowDeliveryPass = isLowDelivBar(refDeliv, refAvgDeliv);
  const subsequentTopPass: boolean | null =
    afterTouch.length > 0
      ? rejectedSessionsCount > 0 && !(latestClose > zoneHigh && (latestDelivPer ?? 0) >= 50)
      : null;

  const latestExhaustionMet =
    inTopZoneNow &&
    (latestRvol ?? 0) >= 1.5 &&
    isLowDelivBar(latestDelivPer, avgDelivery20D);

  let status: TurnaroundTopStatus;
  let verdictLabel: string;
  let verdictDetail: string;

  if (latestClose > zoneHigh && (latestDelivPer ?? 0) >= 50) {
    status = 'TOP_BREAKOUT';
    verdictLabel = 'Upside Breakout Above Top Target (Strong Delivery)';
    verdictDetail = `Latest close ₹${latestClose.toFixed(2)} cleared Top Zone High ₹${zoneHigh.toFixed(2)} with strong Delivery ${latestDelivPer?.toFixed(1) ?? '—'}% (>=50%) — valuation expansion continues.`;
  } else if (!touchedTopZone) {
    status = 'BELOW_TOP_ZONE';
    verdictLabel = 'Below Top Target Zone (Runway Remaining)';
    verdictDetail = `Price (₹${latestClose.toFixed(2)}) is ${distFromTopPct?.toFixed(1)}% vs Top Target ₹${topTargetPrice.toFixed(2)} (Zone ₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)}). Watch for exhaustion when price reaches this band with RVOL >= 1.5x & falling delivery.`;
  } else if (afterTouch.length === 0) {
    if (latestExhaustionMet) {
      status = 'ACTIVE_TOP_TRIGGER';
      verdictLabel = 'Active Top Exhaustion Warning — Watch Next Sessions';
      verdictDetail = `Price reached Top Zone (₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)}) with heavy RVOL ${latestRvol?.toFixed(2)}x (>=1.5x) & low Delivery ${latestDelivPer?.toFixed(1)}% (20D avg ${avgDelivery20D?.toFixed(1) ?? '—'}%) — watch subsequent closes for distribution top.`;
    } else {
      status = 'TOP_ZONE_WATCH';
      verdictLabel = 'Inside Top Target Zone — Check RVOL & Delivery Drop';
      verdictDetail = `Price entered Top Target Zone today (₹${latestClose.toFixed(2)}); confirm RVOL >= 1.5x with falling delivery (<50% or <=20D avg - 5%) before calling major top.`;
    }
  } else if (
    triggerIdx !== null &&
    (rejectedSessionsCount > 0 ||
      latestClose < valid[triggerIdx].close ||
      latestClose < topTargetPrice * 0.98)
  ) {
    status = 'CONFIRMED_TOP';
    verdictLabel = 'Turnaround Major Top Confirmed (Distribution)';
    verdictDetail = `Entered Top Zone ₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)} on ${valid[zoneTouchIdx!].date}, flashed RVOL ${refRvol?.toFixed(2) ?? '—'}x with weak Delivery ${refDeliv?.toFixed(1) ?? '—'}% on ${valid[triggerIdx].date}, and rejected in ${rejectedSessionsCount}/${subsequentSessionsCount} subsequent session(s) (latest ₹${latestClose.toFixed(2)}).`;
  } else if (latestExhaustionMet) {
    status = 'ACTIVE_TOP_TRIGGER';
    verdictLabel = 'Active Top Exhaustion Warning — Check Next Sessions';
    verdictDetail = `Latest session triggered high RVOL ${latestRvol?.toFixed(2)}x with weak Delivery ${latestDelivPer?.toFixed(1)}% inside Top Zone ₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)}. Watch next closes for reversal confirmation.`;
  } else {
    status = 'TOP_ZONE_WATCH';
    verdictLabel = 'Top Zone Tested — Exhaustion Signal Unconfirmed';
    verdictDetail = `Touched Top Zone ₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)} on ${valid[zoneTouchIdx!].date} with ${subsequentSessionsCount} subsequent session(s), without simultaneous RVOL >= 1.5x & falling delivery exhaustion trigger.`;
  }

  const chartStart = Math.max(0, (zoneTouchIdx ?? lastIdx) - 10);
  const subByDate = new Map(subsequentSessions.map((s) => [s.date, s]));
  const chartPoints: TurnaroundTopChartPoint[] = [];
  for (let i = chartStart; i < valid.length; i++) {
    const b = valid[i];
    const sub = subByDate.get(b.date);
    chartPoints.push({
      date: b.date,
      close: round2(b.close),
      high: round2(b.high ?? b.close),
      low: round2(b.low ?? b.close),
      delivPer: b.delivPer !== null ? round2(b.delivPer) : null,
      rvol: rvolSeries[i] !== null ? round2(rvolSeries[i]!) : null,
      action: sub ? sub.action : 'PRE_TOP',
    });
  }

  return {
    symbol,
    latestDate: latestBar.date,
    latestClose: round2(latestClose),
    epsQPrev,
    epsQCurr,
    epsPrevPeriod,
    epsCurrPeriod,
    epsJumpPct,
    epsTtmPrev,
    epsTtmCurr,
    effectiveEps,
    liveTrailingPE,
    peakPeRatio,
    topTargetPrice,
    zoneLow,
    zoneHigh,
    distFromTopPct,
    avgDelivery20D: avgDelivery20D !== null ? round2(avgDelivery20D) : null,
    latestDelivPer: latestDelivPer !== null ? round2(latestDelivPer) : null,
    latestRvol: latestRvol !== null ? round2(latestRvol) : null,
    triggerDate: triggerBar ? triggerBar.date : null,
    triggerDelivPer: refDeliv !== null ? round2(refDeliv) : null,
    triggerRvol: refRvol !== null ? round2(refRvol) : null,
    zoneTouchDate: zoneTouchIdx !== null ? valid[zoneTouchIdx].date : null,
    inTopZoneNow,
    touchedTopZone,
    noDataOrNoJump: false,
    gates: {
      topZonePass,
      highRvolPass,
      lowDeliveryPass,
      subsequentTopPass,
    },
    subsequentSessionsCount,
    rejectedSessionsCount,
    breakoutSessionsCount,
    status,
    verdictLabel,
    verdictDetail,
    subsequentSessions,
    chartPoints,
  };
}

