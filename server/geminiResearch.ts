import { GoogleGenAI, Type } from '@google/genai';
import type {
  AiStrategyAdvisorResult,
  BotStockAnalysis,
  GeminiResearchResult,
  LiveStockQuote,
  StockDetailData,
  StrategyAdvisorParameterCheck,
  StrategyAdvisorParams,
  UTurnEvaluation,
} from '../src/types/trading.ts';

const RESEARCH_MODEL = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function runEcmsGeminiResearch(
  stock: StockDetailData,
  useSearchGrounding: boolean
): Promise<GeminiResearchResult> {
  const ai = getGeminiClient();

  const recent10 = stock.history.slice(-10).map((d) => ({
    date: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
    turnoverLacs: d.turnoverLacs,
    delivPer: d.delivPer,
  }));

  const payload = {
    symbol: stock.summary.symbol,
    latestDate: stock.summary.latestDate,
    closePriceINR: stock.summary.closePrice,
    changePct: stock.summary.changePct,
    rvol20D: stock.summary.rvol,
    rvolBand: stock.summary.rvolBand,
    deliveryPctLatest: stock.summary.delivPer,
    avgDelivery5D: stock.summary.avgDeliv5D,
    deliveryCategory30D: stock.summary.deliveryCategory,
    rolling5dGt60Count: stock.summary.rolling5dGt60Count,
    dailyGt60Count: stock.summary.dailyGt60Count,
    consecutiveAorBStreak: stock.summary.consecutiveStreak,
    avgTurnover20DCr: stock.summary.avgTurnover20DCr,
    liquidityTier: stock.summary.liquidityTier,
    sma20: stock.summary.sma20,
    closeLocationValue: stock.summary.clv,
    recent10Sessions: recent10,
    fundamentals: stock.fundamentals
      ? {
          coverage: stock.fundamentals.coverage,
          source: stock.fundamentals.source,
          financialPeriodEnd: stock.fundamentals.financialPeriodEnd,
          publicationDate: stock.fundamentals.publicationDate,
          periodAlignmentStatus: stock.fundamentals.periodAlignmentStatus,
          sector: stock.fundamentals.providerSector,
          revenueGrowthPct: stock.fundamentals.revenueGrowthPct,
          profitGrowthPct: stock.fundamentals.profitGrowthPct,
          roePct: stock.fundamentals.roePct,
          rocePct: stock.fundamentals.rocePct,
          debtToEquity: stock.fundamentals.debtToEquity,
          interestCoverage: stock.fundamentals.interestCoverage,
          operatingCashFlowInr: stock.fundamentals.operatingCashFlowInr,
          freeCashFlowInr: stock.fundamentals.freeCashFlowInr,
          trailingPE: stock.fundamentals.trailingPE,
          priceToBook: stock.fundamentals.priceToBook,
          marketCapInr: stock.fundamentals.marketCapInr,
          promoterHoldingPct: stock.fundamentals.promoterHoldingPct,
          fiiHoldingPct: stock.fundamentals.fiiHoldingPct,
          diiHoldingPct: stock.fundamentals.diiHoldingPct,
        }
      : null,
    officialXbrlFilings: stock.xbrlFilings.slice(0, 6).map((f) => ({
      periodEnd: f.financialPeriodEnd,
      pubDate: f.publicationDate,
      description: f.filingDescription,
      url: f.officialFilingUrl,
    })),
    signalHistory: stock.signals.slice(0, 5),
  };

  const prompt = `You are a disciplined Indian equity (NSE) research analyst conducting an evidence-aware ECMS review for ${stock.summary.symbol}.
Treat this strictly as research, NOT a buy/sell recommendation.
Rules:
1. Never invent missing numbers or guess unverified financial results.
2. Explicitly cite supplied figures and periods where available.
3. Call out missing, stale, or unverified data clearly.
4. Classification of STRONG requires strong multi-metric fundamentals, clean cashflow/debt, and supportive volume/delivery evidence. Use INSUFFICIENT_DATA or WATCH when data is incomplete.

STOCK & PIPELINE DATA:
${JSON.stringify(payload, null, 2)}`;

  if (useSearchGrounding) {
    const response = await ai.models.generateContent({
      model: RESEARCH_MODEL,
      contents: `${prompt}\n\nReturn ONLY valid JSON with keys: research_classification (STRONG|WATCH|CAUTION|AVOID|INSUFFICIENT_DATA), confidence (HIGH|MEDIUM|LOW), business_quality, financial_strength, growth_and_profitability, debt_and_cashflow, valuation, latest_results_and_announcements, sector_context, positive_factors (string[]), negative_factors (string[]), red_flags (string[]), missing_or_unverified_data (string[]), analyst_conclusion, not_a_trade_signal (boolean true).`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const rawText = (response.text ?? '').trim();
    const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/gi, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('Gemini search-grounded response did not contain a valid JSON object.');
    }
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const groundingSources = chunks
      .map((c) => {
        const web = (c as { web?: { title?: string; uri?: string } }).web;
        return web?.uri ? { title: web.title || web.uri, url: web.uri } : null;
      })
      .filter((x): x is { title: string; url: string } => x !== null);

    return {
      symbol: stock.summary.symbol,
      research_classification: parsed.research_classification ?? 'INSUFFICIENT_DATA',
      confidence: parsed.confidence ?? 'LOW',
      business_quality: parsed.business_quality ?? '',
      financial_strength: parsed.financial_strength ?? '',
      growth_and_profitability: parsed.growth_and_profitability ?? '',
      debt_and_cashflow: parsed.debt_and_cashflow ?? '',
      valuation: parsed.valuation ?? 'Unavailable',
      latest_results_and_announcements: parsed.latest_results_and_announcements ?? 'Unavailable',
      sector_context: parsed.sector_context ?? 'Unavailable',
      positive_factors: Array.isArray(parsed.positive_factors) ? parsed.positive_factors : [],
      negative_factors: Array.isArray(parsed.negative_factors) ? parsed.negative_factors : [],
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
      missing_or_unverified_data: Array.isArray(parsed.missing_or_unverified_data)
        ? parsed.missing_or_unverified_data
        : [],
      analyst_conclusion: parsed.analyst_conclusion ?? '',
      not_a_trade_signal: true,
      research_model: RESEARCH_MODEL,
      research_timestamp_utc: new Date().toISOString(),
      grounding_sources: groundingSources,
    };
  }

  const response = await ai.models.generateContent({
    model: RESEARCH_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          research_classification: {
            type: Type.STRING,
            description: 'One of STRONG, WATCH, CAUTION, AVOID, INSUFFICIENT_DATA',
          },
          confidence: {
            type: Type.STRING,
            description: 'One of HIGH, MEDIUM, LOW',
          },
          business_quality: { type: Type.STRING },
          financial_strength: { type: Type.STRING },
          growth_and_profitability: { type: Type.STRING },
          debt_and_cashflow: { type: Type.STRING },
          valuation: { type: Type.STRING },
          latest_results_and_announcements: { type: Type.STRING },
          sector_context: { type: Type.STRING },
          positive_factors: { type: Type.ARRAY, items: { type: Type.STRING } },
          negative_factors: { type: Type.ARRAY, items: { type: Type.STRING } },
          red_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
          missing_or_unverified_data: { type: Type.ARRAY, items: { type: Type.STRING } },
          analyst_conclusion: { type: Type.STRING },
          not_a_trade_signal: { type: Type.BOOLEAN },
        },
        required: [
          'research_classification',
          'confidence',
          'business_quality',
          'financial_strength',
          'growth_and_profitability',
          'debt_and_cashflow',
          'valuation',
          'latest_results_and_announcements',
          'sector_context',
          'positive_factors',
          'negative_factors',
          'red_flags',
          'missing_or_unverified_data',
          'analyst_conclusion',
          'not_a_trade_signal',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return {
    symbol: stock.summary.symbol,
    research_classification: parsed.research_classification ?? 'INSUFFICIENT_DATA',
    confidence: parsed.confidence ?? 'LOW',
    business_quality: parsed.business_quality ?? '',
    financial_strength: parsed.financial_strength ?? '',
    growth_and_profitability: parsed.growth_and_profitability ?? '',
    debt_and_cashflow: parsed.debt_and_cashflow ?? '',
    valuation: parsed.valuation ?? 'Unavailable',
    latest_results_and_announcements: parsed.latest_results_and_announcements ?? 'Unavailable',
    sector_context: parsed.sector_context ?? 'Unavailable',
    positive_factors: Array.isArray(parsed.positive_factors) ? parsed.positive_factors : [],
    negative_factors: Array.isArray(parsed.negative_factors) ? parsed.negative_factors : [],
    red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
    missing_or_unverified_data: Array.isArray(parsed.missing_or_unverified_data)
      ? parsed.missing_or_unverified_data
      : [],
    analyst_conclusion: parsed.analyst_conclusion ?? '',
    not_a_trade_signal: true,
    research_model: RESEARCH_MODEL,
    research_timestamp_utc: new Date().toISOString(),
    grounding_sources: [],
  };
}

function classifyBurstProfileServer(
  phase4: BotStockAnalysis['phase4Movement']
): 'High-Intensity Accumulation' | 'Distribution Trend' | 'Consolidation Zone' | 'DATA NOT AVAILABLE' {
  const up = phase4.burstPowerNormalized;
  const dn = phase4.downwardBurstNormalized;
  const net = phase4.netBurstNormalized;
  if (up === null || dn === null || net === null) return 'DATA NOT AVAILABLE';
  if ((up >= 10 && net > 0) || (net >= 5 && up > dn)) return 'High-Intensity Accumulation';
  if (net <= -2 || (dn >= 10 && net < 0)) return 'Distribution Trend';
  return 'Consolidation Zone';
}

export async function runAiStrategyAdvisor(params: {
  stock: StockDetailData;
  liveQuote: LiveStockQuote | null;
  uTurn: UTurnEvaluation | null;
  botAnalysis: BotStockAnalysis;
  strategyParams: StrategyAdvisorParams;
}): Promise<AiStrategyAdvisorResult> {
  const { stock, liveQuote, uTurn, botAnalysis, strategyParams } = params;
  const ai = getGeminiClient();

  const sym = stock.summary.symbol;
  const eodClose = stock.summary.closePrice;
  const livePrice =
    liveQuote?.available && liveQuote.livePrice !== null ? liveQuote.livePrice : null;
  const effectivePrice = livePrice ?? eodClose;
  const liveVsEodPct =
    livePrice !== null && eodClose > 0
      ? Number((((livePrice - eodClose) / eodClose) * 100).toFixed(2))
      : null;

  const epsPrev = uTurn?.epsPrev ?? stock.fundamentals?.epsPrev ?? null;
  const epsCurr = uTurn?.epsCurr ?? stock.fundamentals?.epsCurr ?? null;
  const epsDrop =
    epsPrev !== null && epsCurr !== null ? Number((epsPrev - epsCurr).toFixed(2)) : null;
  const epsDropPct =
    epsDrop !== null && epsPrev !== null && Math.abs(epsPrev) > 0
      ? Number(((epsDrop / Math.abs(epsPrev)) * 100).toFixed(2))
      : null;

  const burstCategory = classifyBurstProfileServer(botAnalysis.phase4Movement);
  const upBurst = botAnalysis.phase4Movement.burstPowerNormalized;
  const dnBurst = botAnalysis.phase4Movement.downwardBurstNormalized;
  const netBurst = botAnalysis.phase4Movement.netBurstNormalized;

  const uTurnTarget = uTurn && !uTurn.noEpsDropInData ? uTurn.uTurnTarget : null;
  const zoneLow = uTurn && !uTurn.noEpsDropInData ? uTurn.zoneLow : null;
  const zoneHigh = uTurn && !uTurn.noEpsDropInData ? uTurn.zoneHigh : null;

  const parameterAlignment: StrategyAdvisorParameterCheck[] = [];

  // 1. Live Price vs U-Turn Zone
  if (zoneLow !== null && zoneHigh !== null && uTurnTarget !== null) {
    const inZone = effectivePrice >= zoneLow && effectivePrice <= zoneHigh;
    const distPct = Number((((effectivePrice - uTurnTarget) / uTurnTarget) * 100).toFixed(2));
    parameterAlignment.push({
      parameter: 'Live Price vs U-Turn Zone',
      userRule: `Within ±${strategyParams.zoneTolerancePct}% of Target ₹${uTurnTarget.toFixed(2)} (₹${zoneLow.toFixed(2)}–₹${zoneHigh.toFixed(2)})`,
      actualValue: `₹${effectivePrice.toFixed(2)} (${distPct >= 0 ? '+' : ''}${distPct}% vs target · ${livePrice !== null ? 'Live' : 'EOD fallback'})`,
      status: inZone ? 'PASS' : effectivePrice < zoneLow ? 'FAIL' : 'WATCH',
    });
  } else {
    parameterAlignment.push({
      parameter: 'Live Price vs U-Turn Zone',
      userRule: `Within ±${strategyParams.zoneTolerancePct}% of EPS-derived U-Turn Target`,
      actualValue: uTurn?.noEpsDropInData
        ? 'No EPS drop valuation zone (EPS grew or missing)'
        : 'DATA NOT AVAILABLE',
      status: 'MISSING',
    });
  }

  // 2. EPS Drop Valuation Check
  if (epsPrev !== null && epsCurr !== null && epsDrop !== null) {
    parameterAlignment.push({
      parameter: 'EPS Drop & Valuation Pullback',
      userRule: 'EPS drop > 0 with Avg PE valuation anchor',
      actualValue:
        epsDrop > 0
          ? `EPS ₹${epsPrev.toFixed(2)} → ₹${epsCurr.toFixed(2)} (Drop ₹${epsDrop.toFixed(2)} / ${epsDropPct ?? 0}%)`
          : `No drop: EPS ₹${epsPrev.toFixed(2)} → ₹${epsCurr.toFixed(2)}`,
      status: epsDrop > 0 ? 'PASS' : 'WATCH',
    });
  } else {
    parameterAlignment.push({
      parameter: 'EPS Drop & Valuation Pullback',
      userRule: 'Verified EPS Prev & EPS Curr required',
      actualValue: 'DATA NOT AVAILABLE',
      status: 'MISSING',
    });
  }

  // 3. 252D Burst Power Profile Check
  if (upBurst !== null && netBurst !== null) {
    const passesUp = upBurst >= strategyParams.minUpwardBurst;
    const blockedDist =
      strategyParams.blockDistributionTrend && burstCategory === 'Distribution Trend';
    const upShare = botAnalysis.phase4Movement.upwardBurstSharePct;
    const dnShare = botAnalysis.phase4Movement.downwardBurstSharePct;
    const splitTxt =
      upShare !== undefined && upShare !== null && dnShare !== undefined && dnShare !== null
        ? ` · Split ${upShare}%/${dnShare}%`
        : '';
    parameterAlignment.push({
      parameter: '252D Burst Power Profile',
      userRule: `Upward >= ${strategyParams.minUpwardBurst}%${strategyParams.blockDistributionTrend ? ' · Block Distribution Trend' : ''}`,
      actualValue: `${burstCategory} (Up ${upBurst.toFixed(1)}% / Dn ${(dnBurst ?? 0).toFixed(1)}% / Net ${netBurst >= 0 ? '+' : ''}${netBurst.toFixed(1)}%${splitTxt})`,
      status: blockedDist
        ? 'FAIL'
        : burstCategory === 'High-Intensity Accumulation' && passesUp
          ? 'PASS'
          : 'WATCH',
    });
  } else {
    parameterAlignment.push({
      parameter: '252D Burst Power Profile',
      userRule: `Upward >= ${strategyParams.minUpwardBurst}%`,
      actualValue: 'DATA NOT AVAILABLE',
      status: 'MISSING',
    });
  }

  // 4. Delivery % Gate
  if (stock.summary.delivPer !== null) {
    parameterAlignment.push({
      parameter: 'Delivery % Conviction',
      userRule: `>= ${strategyParams.minDeliveryPct}%`,
      actualValue: `${stock.summary.delivPer.toFixed(1)}% (5D Avg ${stock.summary.avgDeliv5D?.toFixed(1) ?? '—'}%)`,
      status: stock.summary.delivPer >= strategyParams.minDeliveryPct ? 'PASS' : 'FAIL',
    });
  } else {
    parameterAlignment.push({
      parameter: 'Delivery % Conviction',
      userRule: `>= ${strategyParams.minDeliveryPct}%`,
      actualValue: 'DATA NOT AVAILABLE',
      status: 'MISSING',
    });
  }

  // 5. RVOL Gate
  if (stock.summary.rvol !== null) {
    parameterAlignment.push({
      parameter: 'Relative Volume (RVOL)',
      userRule: `>= ${strategyParams.minRvol}x`,
      actualValue: `${stock.summary.rvol.toFixed(2)}x (${stock.summary.rvolBand})`,
      status: stock.summary.rvol >= strategyParams.minRvol ? 'PASS' : 'FAIL',
    });
  } else {
    parameterAlignment.push({
      parameter: 'Relative Volume (RVOL)',
      userRule: `>= ${strategyParams.minRvol}x`,
      actualValue: 'DATA NOT AVAILABLE',
      status: 'MISSING',
    });
  }

  const contextPayload = {
    symbol: sym,
    sector: stock.summary.providerSector || 'Unclassified',
    userStrategyParameters: strategyParams,
    priceContext: {
      eodDate: stock.summary.latestDate,
      eodClose,
      livePrice,
      liveVsEodPct,
      liveAvailable: livePrice !== null,
      ema21: stock.summary.ema21,
      aboveEma21: stock.summary.aboveEma21,
      rsi14: stock.summary.rsi14,
    },
    uTurnSetup: uTurn
      ? {
          status: uTurn.status,
          noEpsDropInData: uTurn.noEpsDropInData,
          detectedPeakPrice: uTurn.peakPrice,
          epsPrev,
          epsCurr,
          epsDrop,
          epsDropPct,
          avgPeRatio: uTurn.avgPeRatio,
          expectedCorrectionInr: uTurn.expectedCorrectionInr,
          expectedCorrectionPct: uTurn.expectedCorrectionPct,
          uTurnTarget,
          zoneLow,
          zoneHigh,
          delivPer: stock.summary.delivPer,
          avgDeliv5D: stock.summary.avgDeliv5D,
          rvol: stock.summary.rvol,
        }
      : null,
    burstPowerProfile252D: {
      category: burstCategory,
      lookbackDays: botAnalysis.phase4Movement.lookbackDays,
      upwardBurstNormalized: upBurst,
      downwardBurstNormalized: dnBurst,
      netBurstNormalized: netBurst,
      upDays: `${botAnalysis.phase4Movement.days5To10Pct}/${botAnalysis.phase4Movement.days10To19Pct}/${botAnalysis.phase4Movement.days19PlusPct}`,
      downDays: `${botAnalysis.phase4Movement.downDays5To10Pct}/${botAnalysis.phase4Movement.downDays10To19Pct}/${botAnalysis.phase4Movement.downDays19PlusPct}`,
    },
    periodicAndRiskContext: {
      periodicScore: botAnalysis.periodicAnalysis.periodicScore.score,
      periodicGrade: botAnalysis.periodicAnalysis.periodicScore.grade,
      mtfAlignment: botAnalysis.periodicAnalysis.sentiment.mtfAlignment,
      nearestSupportS1: botAnalysis.periodicAnalysis.supportResistance.nearestSupport,
      nearestResistanceR1: botAnalysis.periodicAnalysis.supportResistance.nearestResistance,
      positionStatus: botAnalysis.periodicAnalysis.supportResistance.positionStatus,
      phase3HardRejectPass: botAnalysis.phase3Fundamentals.hardRejectPass,
      hardRejectReasons: botAnalysis.phase3Fundamentals.hardRejectReasons,
      botVerdict: botAnalysis.scoring.verdict,
      botScore: botAnalysis.scoring.totalScore,
    },
    computedParameterAlignment: parameterAlignment,
  };

  const prompt = `You are a quantitative NSE swing-trading Strategy Advisor evaluating U-Turn Strategy viability for ${sym}.
Compare ONLY the verified inputs below against the user's defined strategy parameters:
1. Live Price (or EOD fallback if market closed) vs EPS-derived U-Turn Support Zone (${zoneLow ?? 'N/A'}–${zoneHigh ?? 'N/A'}) and Support S1 / Resistance R1.
2. EPS Drop magnitude (${epsDrop ?? 'N/A'}) and implied correction vs current price pullback.
3. 252D Burst Power Profile (${burstCategory}, Upward ${upBurst ?? 'N/A'}/100, Downward ${dnBurst ?? 'N/A'}/100, Net ${netBurst ?? 'N/A'}) plus Delivery % and RVOL gates.

Decision rules:
- Recommend BUY only when U-Turn support or High-Intensity Accumulation aligns with supportive Delivery/RVOL/S1 support and is NOT in Distribution Trend (if blocked).
- Recommend HOLD when some criteria pass or price is in Consolidation Zone / above the U-Turn buy zone waiting for trigger confirmation.
- Recommend AVOID when price broke below U-Turn support, 252D Burst Profile shows Distribution Trend, or key fundamental/technical gates clearly fail.
- Never invent or alter any numeric values; cite exact figures provided in the JSON context.

VERIFIED DATA:
${JSON.stringify(contextPayload, null, 2)}`;

  const response = await ai.models.generateContent({
    model: RESEARCH_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'Be concise, analytical, and strictly grounded in the supplied numbers. Keep each section 1-3 crisp sentences.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendation: {
            type: Type.STRING,
            description: 'Must be strictly one of: BUY, HOLD, AVOID',
          },
          confidence: {
            type: Type.STRING,
            description: 'Must be strictly one of: HIGH, MEDIUM, LOW',
          },
          uTurnViability: {
            type: Type.STRING,
            description:
              'Must be strictly one of: HIGH_VIABILITY, MODERATE_VIABILITY, LOW_VIABILITY, NO_EPS_DROP_SETUP',
          },
          executiveSummary: { type: Type.STRING },
          livePriceVsUTurnAnalysis: { type: Type.STRING },
          epsDropAssessment: { type: Type.STRING },
          burstProfileAssessment: { type: Type.STRING },
          actionPlan: { type: Type.STRING },
          keyRisks: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'recommendation',
          'confidence',
          'uTurnViability',
          'executiveSummary',
          'livePriceVsUTurnAnalysis',
          'epsDropAssessment',
          'burstProfileAssessment',
          'actionPlan',
          'keyRisks',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    recommendation?: string;
    confidence?: string;
    uTurnViability?: string;
    executiveSummary?: string;
    livePriceVsUTurnAnalysis?: string;
    epsDropAssessment?: string;
    burstProfileAssessment?: string;
    actionPlan?: string;
    keyRisks?: string[];
  };

  const recNorm =
    parsed.recommendation === 'BUY' ||
    parsed.recommendation === 'HOLD' ||
    parsed.recommendation === 'AVOID'
      ? parsed.recommendation
      : 'HOLD';
  const confNorm =
    parsed.confidence === 'HIGH' ||
    parsed.confidence === 'MEDIUM' ||
    parsed.confidence === 'LOW'
      ? parsed.confidence
      : 'MEDIUM';
  const viaNorm =
    parsed.uTurnViability === 'HIGH_VIABILITY' ||
    parsed.uTurnViability === 'MODERATE_VIABILITY' ||
    parsed.uTurnViability === 'LOW_VIABILITY' ||
    parsed.uTurnViability === 'NO_EPS_DROP_SETUP'
      ? parsed.uTurnViability
      : uTurn?.noEpsDropInData
        ? 'NO_EPS_DROP_SETUP'
        : 'MODERATE_VIABILITY';

  return {
    symbol: sym,
    recommendation: recNorm,
    confidence: confNorm,
    uTurnViability: viaNorm,
    executiveSummary: parsed.executiveSummary ?? '',
    livePriceVsUTurnAnalysis: parsed.livePriceVsUTurnAnalysis ?? '',
    epsDropAssessment: parsed.epsDropAssessment ?? '',
    burstProfileAssessment: parsed.burstProfileAssessment ?? '',
    actionPlan: parsed.actionPlan ?? '',
    keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks.slice(0, 5) : [],
    parameterAlignment,
    snapshotMetrics: {
      eodDate: stock.summary.latestDate,
      eodClose,
      livePrice,
      liveVsEodPct,
      uTurnTarget,
      zoneLow,
      zoneHigh,
      uTurnStatus: uTurn?.status ?? 'DATA NOT AVAILABLE',
      epsPrev,
      epsCurr,
      epsDrop,
      epsDropPct,
      avgPeRatio: uTurn?.avgPeRatio ?? stock.fundamentals?.trailingPE ?? null,
      burstProfileCategory: burstCategory,
      upwardBurstNorm: upBurst,
      downwardBurstNorm: dnBurst,
      netBurstNorm: netBurst,
      delivPer: stock.summary.delivPer,
      rvol: stock.summary.rvol,
      periodicScore: botAnalysis.periodicAnalysis.periodicScore.score,
      periodicGrade: botAnalysis.periodicAnalysis.periodicScore.grade,
      nearestSupport: botAnalysis.periodicAnalysis.supportResistance.nearestSupport,
      nearestResistance: botAnalysis.periodicAnalysis.supportResistance.nearestResistance,
    },
    model: RESEARCH_MODEL,
    generatedAtUtc: new Date().toISOString(),
  };
}
