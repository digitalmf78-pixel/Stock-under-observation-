import type { RiskInput, RiskResult } from '../src/types/trading.ts';

function isPositiveFinite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isNonNegativeFinite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

export function evaluateRiskControls(input: RiskInput): RiskResult {
  const warnings: string[] = [];
  const statusReasons: string[] = [];

  const requiredValid =
    isPositiveFinite(input.accountEquityInr) &&
    isPositiveFinite(input.riskPerTradePct) &&
    isPositiveFinite(input.maxSinglePositionPct) &&
    isPositiveFinite(input.maxSectorExposurePct) &&
    isPositiveFinite(input.maxTotalExposurePct) &&
    isPositiveFinite(input.maxStopDistancePct) &&
    isNonNegativeFinite(input.currentTotalExposurePct) &&
    isNonNegativeFinite(input.currentSectorExposurePct) &&
    isPositiveFinite(input.maxOpenPositions) &&
    isNonNegativeFinite(input.currentOpenPositions) &&
    isPositiveFinite(input.entryPrice) &&
    isPositiveFinite(input.stopLoss);

  if (!requiredValid) {
    return {
      status: 'WAIT_FOR_DATA',
      statusReasons: ['Missing or invalid required portfolio or trade price parameters (fail-closed).'],
      warnings: [],
      stopDistanceInr: null,
      stopDistancePct: null,
      riskBudgetInr: null,
      rawSharesByRisk: 0,
      maxSharesBySingleCap: 0,
      maxSharesByTotalExposure: 0,
      maxSharesBySectorExposure: 0,
      recommendedShares: 0,
      positionValueInr: 0,
      actualRiskInr: 0,
      actualRiskPct: 0,
      positionPctOfEquity: 0,
      projectedTotalExposurePct: input.currentTotalExposurePct || 0,
      projectedSectorExposurePct: input.currentSectorExposurePct || 0,
      rewardRiskRatio: null,
      potentialProfitInr: null,
    };
  }

  // Replicate risk_config_warnings from risk_controls.py
  const impliedMinStopPct = (input.riskPerTradePct / input.maxSinglePositionPct) * 100;
  if (input.maxStopDistancePct < impliedMinStopPct) {
    warnings.push(
      `max_stop_distance_pct (${input.maxStopDistancePct.toFixed(2)}%) is tighter than the implied floor (${impliedMinStopPct.toFixed(2)}%) required to deploy full risk_per_trade_pct (${input.riskPerTradePct.toFixed(2)}%) within max_single_position_pct (${input.maxSinglePositionPct.toFixed(2)}%).`
    );
  }
  if (input.maxSinglePositionPct > input.maxTotalExposurePct) {
    warnings.push('max_single_position_pct exceeds max_total_exposure_pct.');
  }
  if (input.maxSectorExposurePct > input.maxTotalExposurePct) {
    warnings.push('max_sector_exposure_pct exceeds max_total_exposure_pct.');
  }

  if (input.stopLoss >= input.entryPrice) {
    return {
      status: 'WAIT_FOR_DATA',
      statusReasons: ['Stop loss must be strictly below entry price for long swing setups.'],
      warnings,
      stopDistanceInr: null,
      stopDistancePct: null,
      riskBudgetInr: null,
      rawSharesByRisk: 0,
      maxSharesBySingleCap: 0,
      maxSharesByTotalExposure: 0,
      maxSharesBySectorExposure: 0,
      recommendedShares: 0,
      positionValueInr: 0,
      actualRiskInr: 0,
      actualRiskPct: 0,
      positionPctOfEquity: 0,
      projectedTotalExposurePct: input.currentTotalExposurePct,
      projectedSectorExposurePct: input.currentSectorExposurePct,
      rewardRiskRatio: null,
      potentialProfitInr: null,
    };
  }

  const stopDistanceInr = input.entryPrice - input.stopLoss;
  const stopDistancePct = (stopDistanceInr / input.entryPrice) * 100;
  const riskBudgetInr = input.accountEquityInr * (input.riskPerTradePct / 100);

  const rawSharesByRisk = Math.floor(riskBudgetInr / stopDistanceInr);
  const maxSingleValue = input.accountEquityInr * (input.maxSinglePositionPct / 100);
  const maxSharesBySingleCap = Math.floor(maxSingleValue / input.entryPrice);

  const remainingTotalPct = Math.max(0, input.maxTotalExposurePct - input.currentTotalExposurePct);
  const maxSharesByTotalExposure = Math.floor(
    (input.accountEquityInr * (remainingTotalPct / 100)) / input.entryPrice
  );

  const remainingSectorPct = Math.max(0, input.maxSectorExposurePct - input.currentSectorExposurePct);
  const maxSharesBySectorExposure = Math.floor(
    (input.accountEquityInr * (remainingSectorPct / 100)) / input.entryPrice
  );

  const recommendedShares = Math.max(
    0,
    Math.min(
      rawSharesByRisk,
      maxSharesBySingleCap,
      maxSharesByTotalExposure,
      maxSharesBySectorExposure
    )
  );

  let status: RiskResult['status'] = 'PASS';

  if (input.currentOpenPositions >= input.maxOpenPositions) {
    status = 'REJECT_MAX_POSITIONS';
    statusReasons.push(
      `Current open positions (${input.currentOpenPositions}) reached max_open_positions (${input.maxOpenPositions}).`
    );
  } else if (stopDistancePct > input.maxStopDistancePct) {
    status = 'REJECT_STOP_TOO_WIDE';
    statusReasons.push(
      `Stop distance (${stopDistancePct.toFixed(2)}%) exceeds max_stop_distance_pct (${input.maxStopDistancePct.toFixed(2)}%).`
    );
  } else if (remainingTotalPct <= 0 || remainingSectorPct <= 0 || recommendedShares === 0) {
    status = 'REJECT_EXPOSURE_LIMIT';
    if (remainingTotalPct <= 0) {
      statusReasons.push('Total portfolio exposure limit reached.');
    }
    if (remainingSectorPct <= 0) {
      statusReasons.push('Sector exposure limit reached.');
    }
    if (recommendedShares === 0 && remainingTotalPct > 0 && remainingSectorPct > 0) {
      statusReasons.push('Calculated position size rounds down to 0 shares under current equity/exposure caps.');
    }
  } else {
    statusReasons.push(
      `Position fits within risk budget (₹${riskBudgetInr.toFixed(0)}) and all exposure caps.`
    );
  }

  const finalShares = status === 'PASS' ? recommendedShares : 0;
  const positionValueInr = finalShares * input.entryPrice;
  const actualRiskInr = finalShares * stopDistanceInr;
  const actualRiskPct = (actualRiskInr / input.accountEquityInr) * 100;
  const positionPctOfEquity = (positionValueInr / input.accountEquityInr) * 100;
  const projectedTotalExposurePct = input.currentTotalExposurePct + positionPctOfEquity;
  const projectedSectorExposurePct = input.currentSectorExposurePct + positionPctOfEquity;

  let rewardRiskRatio: number | null = null;
  let potentialProfitInr: number | null = null;
  if (isPositiveFinite(input.targetPrice) && input.targetPrice > input.entryPrice) {
    const rewardPerShare = input.targetPrice - input.entryPrice;
    rewardRiskRatio = rewardPerShare / stopDistanceInr;
    potentialProfitInr = finalShares * rewardPerShare;
  }

  return {
    status,
    statusReasons,
    warnings,
    stopDistanceInr,
    stopDistancePct,
    riskBudgetInr,
    rawSharesByRisk,
    maxSharesBySingleCap,
    maxSharesByTotalExposure,
    maxSharesBySectorExposure,
    recommendedShares: finalShares,
    positionValueInr,
    actualRiskInr,
    actualRiskPct,
    positionPctOfEquity,
    projectedTotalExposurePct,
    projectedSectorExposurePct,
    rewardRiskRatio,
    potentialProfitInr,
  };
}
