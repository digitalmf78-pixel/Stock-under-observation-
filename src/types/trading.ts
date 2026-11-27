export type DeliveryCategory = 'A_AND_B' | 'A_ONLY' | 'B_ONLY' | 'NONE' | 'WAIT_FOR_DATA';
export type RvolBand = 'HIGH' | 'LOW' | 'WAIT_FOR_DATA';
export type LiquidityTier = 'STRONG' | 'MODERATE' | 'LOW' | 'BELOW_MIN' | 'WAIT_FOR_DATA';
export type FundamentalCoverage = 'COMPLETE' | 'PARTIAL_DATA' | 'MISSING';
export type FundamentalFreshness = 'LATEST' | 'OLD_3M' | 'STALE' | 'NOT_AVAILABLE';
export type AuditFreshnessTier = 'UNDER_1M' | 'ONE_TO_3M' | 'OVER_3M' | 'UNVERIFIED';
export type SwingTier =
  | 'TIER_1_READY'
  | 'TIER_2_ACCUMULATION'
  | 'TIER_3_RVOL_WATCH'
  | 'NONE';
export type MarketCapCategory = 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP' | 'UNKNOWN';

export interface ScreenerFilterPatch {
  q?: string;
  sector?: string;
  delivery?: string;
  swingTier?: string;
  uTurn?: string;
  rvol?: string;
  liquidity?: string;
  fundamental?: string;
  freshness?: FundamentalFreshness | 'ALL';
  cap?: 'ALL' | MarketCapCategory;
  emaCross?: 'ALL' | 'BULLISH_ALIGNED' | 'RECENT_CROSS' | 'BELOW';
  watchlistOnly?: boolean;
  upcomingResultsOnly?: boolean;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface FundamentalAuditEntry {
  symbol: string;
  series: string;
  sector: string;
  nseMapped: boolean;
  nseTicker: string;
  nseXbrlCount: number;
  nseLatestFilingDate: string;
  bseMapped: boolean;
  bseTicker: string;
  financialPeriodEnd: string;
  lastUpdatedUtc: string;
  verifiedAgeDays: number | null;
  periodAgeDays: number | null;
  freshnessTier: AuditFreshnessTier;
  coverage: FundamentalCoverage;
  passCount: number;
  sources: string[];
}

export interface FundamentalCollectionStatus {
  running: boolean;
  scope: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  nseXbrlHits: number;
  yahooNsHits: number;
  bseBoHits: number;
  currentSymbol: string;
  startedAtUtc: string;
  finishedAtUtc: string;
  lastError: string | null;
}

export interface DailyBhavRow {
  date: string; // YYYY-MM-DD
  symbol: string;
  series: string;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  avgPrice: number | null;
  volume: number;
  turnoverLacs: number;
  trades: number;
  delivQty: number | null;
  delivPer: number | null;
}

export interface FundamentalMetricCheck {
  key: string;
  label: string;
  value: number | null;
  formattedValue: string;
  thresholdLabel: string;
  status: 'PASS' | 'FAIL' | 'MISSING';
}

export interface FundamentalProfile {
  symbol: string;
  asOfDate: string;
  source: string;
  sourceUrl: string;
  financialPeriodEnd: string;
  publicationDate: string;
  publicationDateStatus: string;
  officialFilingUrl: string;
  officialFilingSource: string;
  periodAlignmentStatus: string;
  providerSector: string;
  revenueGrowthPct: number | null;
  profitGrowthPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  operatingCashFlowInr: number | null;
  freeCashFlowInr: number | null;
  earningsQualityStatus: string;
  valuationStatus: string;
  trailingPE: number | null;
  priceToBook: number | null;
  marketCapInr: number | null;
  enterpriseValueInr: number | null;
  dividendYieldPct: number | null;
  promoterHoldingPct: number | null;
  fiiHoldingPct: number | null;
  diiHoldingPct: number | null;
  publicHoldingPct: number | null;
  epsPrev: number | null;
  epsCurr: number | null;
  epsPrevPeriod: string;
  epsCurrPeriod: string;
  epsTtmPrev: number | null;
  epsTtmCurr: number | null;
  coverage: FundamentalCoverage;
  fundamentalFreshness: FundamentalFreshness;
  fundamentalAgeDays: number | null;
  fundamentalRemark: string;
  fundamentalSources: string[];
  latestFilingDate: string;
  lastUpdatedUtc: string;
  firstTradeDateIso?: string;
  nextEarningsDate?: string;
  companyName?: string;
  checks: FundamentalMetricCheck[];
  passCount: number;
  failCount: number;
  missingCount: number;
}

export interface XbrlFiling {
  symbol: string;
  financialPeriodEnd: string;
  publicationDate: string;
  publicationDateStatus: string;
  filingDescription: string;
  officialFilingUrl: string;
  officialSource: string;
  retrievedAtUtc: string;
}

export interface SignalLogEntry {
  eodDate: string;
  symbol: string;
  watchlistStatus: string;
  deliveryCategory: string;
  liquidityTier: string;
  rvol: number | null;
  setupType: string;
  trendClassification: string;
  relativeStrengthNifty: number | null;
  v8Score: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stopLoss: number | null;
  targetRiskReward: string;
  stopDistancePct: number | null;
  sectorStrengthStatus: string;
  marketRegimeStatus: string;
  closePrice: number | null;
  evalSessionsAfter: number;
  evalReturnPct: number | null;
  evalMfePct: number | null;
  evalMaePct: number | null;
  skipReasons: string[];
  marketCapCr?: number | null;
  marketCapCategory?: MarketCapCategory;
  ema21AboveEma44?: boolean | null;
  ema21Cross44Bullish?: boolean | null;
}

export interface SignalSummaryStats {
  total: number;
  evaluatedCount: number;
  positiveReturnCount: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
  rejectionBreakdown: Array<{ reason: string; count: number }>;
}

export type UTurnStatus =
  | 'CONFIRMED_SUPPORT'
  | 'ACTIVE_TRIGGER'
  | 'SUPPORT_HOLD'
  | 'IN_ZONE'
  | 'BROKEN_DOWN'
  | 'ABOVE_ZONE';

export interface UTurnSessionCheck {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changePct: number | null;
  delivPer: number | null;
  rvol: number | null;
  vsTargetPct: number;
  inZone: boolean;
  techTriggerMet: boolean;
  action: 'IN_ZONE_TRIGGER' | 'IN_ZONE' | 'HELD_SUPPORT' | 'BOUNCED_ABOVE' | 'BROKE_BELOW';
}

export interface UTurnChartPoint {
  date: string;
  close: number;
  high: number;
  low: number;
  delivPer: number | null;
  rvol: number | null;
  isPeak: boolean;
  isZoneTouch: boolean;
  action: UTurnSessionCheck['action'] | 'PRE_ZONE';
}

export interface UTurnEvaluation {
  symbol: string;
  latestDate: string;
  latestClose: number;
  peakPrice: number;
  peakDate: string;
  isCustomPeak: boolean;
  correctionMode: 'EPS_VALUATION' | 'PCT' | 'INR';
  epsPrev: number | null;
  epsCurr: number | null;
  epsPrevPeriod: string;
  epsCurrPeriod: string;
  epsDrop: number | null;
  avgPeRatio: number | null;
  noEpsDropInData: boolean;
  zoneTolerancePct: number;
  expectedCorrectionPct: number;
  expectedCorrectionInr: number;
  uTurnTarget: number;
  zoneLow: number;
  zoneHigh: number;
  distFromTargetPct: number;
  inTargetZoneNow: boolean;
  touchedTargetZone: boolean;
  zoneTouchDate: string | null;
  triggerDate: string | null;
  triggerDelivPer: number | null;
  triggerRvol: number | null;
  latestDelivPer: number | null;
  latestRvol: number | null;
  gates: {
    targetZonePass: boolean;
    deliveryPass: boolean;
    rvolPass: boolean;
    subsequentSupportPass: boolean | null;
  };
  subsequentSessionsCount: number;
  heldSessionsCount: number;
  brokeSessionsCount: number;
  lowestCloseAfterZone: number | null;
  highestCloseAfterZone: number | null;
  bounceFromTargetPct: number | null;
  status: UTurnStatus;
  verdictLabel: string;
  verdictDetail: string;
  subsequentSessions: UTurnSessionCheck[];
  chartPoints: UTurnChartPoint[];
}

export type TurnaroundTopStatus =
  | 'CONFIRMED_TOP'
  | 'ACTIVE_TOP_TRIGGER'
  | 'TOP_ZONE_WATCH'
  | 'TOP_BREAKOUT'
  | 'BELOW_TOP_ZONE';

export interface TurnaroundTopSessionCheck {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changePct: number | null;
  delivPer: number | null;
  rvol: number | null;
  vsTopPct: number;
  inTopZone: boolean;
  exhaustionTriggerMet: boolean;
  action: 'TOP_TRIGGER' | 'TOP_ZONE' | 'TOP_REJECTION' | 'TOP_BREAKOUT';
}

export interface TurnaroundTopChartPoint {
  date: string;
  close: number;
  high: number;
  low: number;
  delivPer: number | null;
  rvol: number | null;
  action: TurnaroundTopSessionCheck['action'] | 'PRE_TOP';
}

export interface TurnaroundTopEvaluation {
  symbol: string;
  latestDate: string;
  latestClose: number;
  epsQPrev: number | null;
  epsQCurr: number | null;
  epsPrevPeriod: string;
  epsCurrPeriod: string;
  epsJumpPct: number | null;
  epsTtmPrev: number | null;
  epsTtmCurr: number | null;
  effectiveEps: number | null;
  liveTrailingPE: number | null;
  peakPeRatio: number | null;
  topTargetPrice: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  distFromTopPct: number | null;
  avgDelivery20D: number | null;
  latestDelivPer: number | null;
  latestRvol: number | null;
  triggerDate: string | null;
  triggerDelivPer: number | null;
  triggerRvol: number | null;
  zoneTouchDate: string | null;
  inTopZoneNow: boolean;
  touchedTopZone: boolean;
  noDataOrNoJump: boolean;
  gates: {
    topZonePass: boolean;
    highRvolPass: boolean;
    lowDeliveryPass: boolean;
    subsequentTopPass: boolean | null;
  };
  subsequentSessionsCount: number;
  rejectedSessionsCount: number;
  breakoutSessionsCount: number;
  status: TurnaroundTopStatus;
  verdictLabel: string;
  verdictDetail: string;
  subsequentSessions: TurnaroundTopSessionCheck[];
  chartPoints: TurnaroundTopChartPoint[];
}

export interface ScreenerRow {
  symbol: string;
  series: string;
  latestDate: string;
  closePrice: number;
  prevClose: number | null;
  changePct: number | null;
  volume: number;
  turnoverCr: number;
  avgTurnover20DCr: number | null;
  delivQty: number | null;
  delivPer: number | null;
  avgDeliv5D: number | null;
  delivQtyRatio: number | null;
  delivValueCr: number | null;
  deliveryCategory: DeliveryCategory;
  deliveryStatus: string;
  rolling5dGt60Count: number;
  maxConsecutiveRolling5dGt60?: number;
  dailyGt60Count: number;
  valid30dSessions: number;
  consecutiveStreak: number;
  totalQualifyingSessions: number;
  firstStreakDate: string;
  rvol: number | null;
  rvolBand: RvolBand;
  liquidityTier: LiquidityTier;
  liquidityPass: boolean;
  fundamentalCoverage: FundamentalCoverage;
  fundamentalPassCount: number;
  fundamentalFailCount: number;
  fundamentalFreshness: FundamentalFreshness;
  fundamentalAgeDays: number | null;
  fundamentalRemark: string;
  fundamentalSources: string[];
  fundamentalVerified?: boolean;
  latestFilingDate: string;
  lastUpdatedUtc: string;
  providerSector: string;
  isIpo: boolean;
  listingDate: string;
  ipoAgeDays?: number | null;
  companyName?: string;
  nextEarningsDate?: string;
  sessionsCount: number;
  sma20: number | null;
  ema21: number | null;
  ema44: number | null;
  ema200?: number | null;
  aboveSma20: boolean | null;
  aboveEma21: boolean | null;
  aboveEma44?: boolean | null;
  aboveEma200?: boolean | null;
  ema21AboveEma44: boolean | null;
  ema21Cross44Bullish: boolean | null;
  ema21Cross44DaysAgo: number | null;
  marketCapInr: number | null;
  marketCapCr: number | null;
  marketCapCategory: MarketCapCategory;
  rsi14: number | null;
  atr14: number | null;
  atrPct: number | null;
  suggestedStopLoss: number | null;
  suggestedStopPct: number | null;
  distFrom35dHighPct: number | null;
  upDownVolRatio10d: number | null;
  swingTier: SwingTier;
  clv: number | null;
  xbrlFilingCount: number;
  latestSignalSetup: string | null;
  latestV8Score: number | null;
  uTurnPeakPrice: number | null;
  uTurnTarget: number | null;
  uTurnDistPct: number | null;
  uTurnStatus: UTurnStatus | null;
  uTurnSubsequentCount: number;
  uTurnBasis: 'EPS_PE' | 'PCT_10' | null;
  topTurnTarget: number | null;
  topTurnDistPct: number | null;
  topTurnStatus: TurnaroundTopStatus | null;
}

export interface MarketSentiment {
  status: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  score: number; // 0 to 100
  asOfDate: string;
  advancers: number;
  decliners: number;
  unchanged: number;
  breadthPct: number;
  avgDeliveryPct: number;
  deliveryExpandingUp: number;
  deliveryExpandingDown: number;
  deliveryAccumPct: number;
  highRvolUp: number;
  highRvolDown: number;
  aboveEma21Pct: number;
  aboveEma21Count?: number;
  ema21EligibleCount?: number;
  aboveEma44Pct?: number;
  aboveEma44Count?: number;
  ema44EligibleCount?: number;
  aboveEma200Pct?: number | null;
  aboveEma200Count?: number;
  ema200SampleCount?: number;
  aboveEma21And44Pct?: number;
  aboveEma21And44Count?: number;
  ema21And44EligibleCount?: number;
  emaCrossBullishCount?: number;
  unionPct: number;
  summary: string;
}

export interface SectorDeliveryTrendPoint {
  date: string;
  avgDeliveryPct: number;
}

export interface SectorSentimentItem {
  sector: string;
  stockCount: number;
  liquidCount: number;
  advancers: number;
  decliners: number;
  breadthPct: number;
  avgChangePct: number;
  avg5dReturnPct: number | null;
  avgDeliveryPct: number;
  deliveryTrend30d?: SectorDeliveryTrendPoint[];
  delivery30dAvg?: number;
  delivery5dAvg?: number;
  deliveryShiftPp?: number;
  avgRvol: number | null;
  delivExpandingUp: number;
  delivExpandingDown: number;
  aboveEma21Pct: number;
  aboveEma21Count?: number;
  ema21EligibleCount?: number;
  aboveEma44Pct?: number;
  aboveEma44Count?: number;
  ema44EligibleCount?: number;
  aboveEma200Pct?: number | null;
  aboveEma200Count?: number;
  ema200SampleCount?: number;
  ema21Above44Pct?: number;
  ema21Cross44Count?: number;
  emaTrendCompositePct?: number;
  tier1Count: number;
  tier2Count: number;
  rotationScore: number; // 0 to 100
  regime: 'LEADING' | 'IMPROVING' | 'NEUTRAL' | 'LAGGING';
}

export interface OverviewData {
  latestSessionDate: string;
  sessionsLoaded: number;
  sessionDateRange: { from: string; to: string };
  marketSentiment: MarketSentiment;
  sectorSentiment: SectorSentimentItem[];
  funnel: {
    universeMainboard: number;
    funnelStep2FlowCount?: number;
    nonAbHighRvolCount?: number;
    funnelStep3LiquidityCount?: number;
    funnelStep4TriggerCount?: number;
    liquidHighRvolTotalCount?: number;
    liquidDelivExpLowRvolCount?: number;
    deliveryAorBUnion: number;
    deliveryAAndB: number;
    deliveryAOnly: number;
    deliveryBOnly: number;
    liquidityPassInUnion: number;
    liquidityBelowMinInUnion: number;
    rvolHighInLiquidUnion: number;
    rvolLowInLiquidUnion: number;
    rvolWaitInLiquidUnion: number;
    rvolHighInUnion: number;
    rvolLowInUnion: number;
    rvolWaitInUnion: number;
    fundamentalsCompleteInLiquidity: number;
    fundamentalsPartialInLiquidity: number;
    sequentialTieredCount: number;
    sequentialTier1Count: number;
    sequentialTier2Count: number;
    sequentialTier3Count: number;
    tier1ReadyCount: number;
    tier2AccumulationCount: number;
    tier3RvolWatchCount: number;
    tieredWatchlistCount: number;
    signalLogTotalRows: number;
    xbrlFilingsTotalRows: number;
  };
  thresholds: {
    min_revenue_growth_pct: number;
    min_profit_growth_pct: number;
    min_roe_pct: number;
    min_roce_pct: number;
    max_debt_to_equity: number;
    min_interest_coverage: number;
    require_positive_operating_cash_flow: boolean;
    require_positive_free_cash_flow: boolean;
    max_data_age_days: number;
  };
  fundamentalAudit: {
    totalStocks: number;
    latestCount: number;
    old3mCount: number;
    staleCount: number;
    notAvailableCount: number;
    withXbrlFilingsCount: number;
    recentFiling90dCount: number;
    sourcesBreakdown: {
      nseXbrl: number;
      yahooNs: number;
      bseBo: number;
      csvBaseline: number;
    };
  };
  topDeliveryMovers: ScreenerRow[];
  recentSignals: SignalLogEntry[];
}

export interface CorrelationPeerMeta {
  symbol: string;
  companyName: string;
  sector: string;
  isPrimary: boolean;
  isSameSector: boolean;
  closePrice: number;
  changePct: number | null;
  returnWindowPct: number | null;
  avgTurnover20DCr: number | null;
  delivPer: number | null;
}

export interface CorrelationCellStats {
  r: number | null;
  sampleCount: number;
}

export interface PeerCorrelationMatrixData {
  primarySymbol: string;
  sector: string;
  windowDays: number;
  startDate: string;
  endDate: string;
  sessionDates: string[];
  sameSectorPeerCount: number;
  peers: CorrelationPeerMeta[];
  priceMatrix: CorrelationCellStats[][];
  returnMatrix: CorrelationCellStats[][];
  normalizedSeries: Array<{
    symbol: string;
    points: Array<{
      date: string;
      close: number | null;
      normBase100: number | null;
      dailyRetPct: number | null;
    }>;
  }>;
  availableSectorPeers: Array<{
    symbol: string;
    companyName: string;
    avgTurnover20DCr: number | null;
  }>;
}

export interface DividendYearPoint {
  fyLabel: string;
  shortLabel: string;
  fyEndIso: string;
  payoutRatioPct: number | null;
  dividendPerShareInr: number | null;
  epsInr: number | null;
  fyEndPriceInr: number | null;
  annualReturnPct: number | null;
  cumulativePerfBase100: number | null;
  totalReturnBase100: number | null;
  dividendYieldOnClosePct: number | null;
  payoutSource: 'Screener.in' | 'Derived (DPS/EPS)' | 'Unavailable';
}

export interface DividendHistoryResponse {
  symbol: string;
  companyName: string;
  years: DividendYearPoint[];
  recentEvents: Array<{
    exDate: string;
    amountInr: number;
  }>;
  summary: {
    avgPayoutRatio5yPct: number | null;
    totalDividends5yInr: number;
    consecutivePayingYears: number;
    priceCagr5yPct: number | null;
    totalReturnCagr5yPct: number | null;
    dividendCagrPct: number | null;
    latestDividendYieldPct: number | null;
    payoutConsistencyLabel: string;
  };
  sources: string[];
  fetchedAtUtc: string;
}

export interface StockDetailData {
  summary: ScreenerRow;
  history: Array<
    DailyBhavRow & {
      sma20: number | null;
      ema21: number | null;
      ema44: number | null;
      rvol?: number | null;
      rsi14?: number | null;
    }
  >;
  fundamentals: FundamentalProfile | null;
  xbrlFilings: XbrlFiling[];
  signals: SignalLogEntry[];
  fundamentalAuditRows: FundamentalAuditEntry[];
  seasonality?: Array<{ month: string; avgReturnPct: number; isPositive: boolean }>;
  currentMonthNegative?: boolean;
  peerCorrelation?: PeerCorrelationMatrixData;
}

export interface RiskInput {
  symbol?: string;
  accountEquityInr: number;
  riskPerTradePct: number;
  maxSinglePositionPct: number;
  maxSectorExposurePct: number;
  maxTotalExposurePct: number;
  maxStopDistancePct: number;
  currentTotalExposurePct: number;
  currentSectorExposurePct: number;
  maxOpenPositions: number;
  currentOpenPositions: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number | null;
}

export interface RiskResult {
  status:
    | 'PASS'
    | 'REJECT_STOP_TOO_WIDE'
    | 'REJECT_EXPOSURE_LIMIT'
    | 'REJECT_MAX_POSITIONS'
    | 'WAIT_FOR_DATA';
  statusReasons: string[];
  warnings: string[];
  stopDistanceInr: number | null;
  stopDistancePct: number | null;
  riskBudgetInr: number | null;
  rawSharesByRisk: number;
  maxSharesBySingleCap: number;
  maxSharesByTotalExposure: number;
  maxSharesBySectorExposure: number;
  recommendedShares: number;
  positionValueInr: number;
  actualRiskInr: number;
  actualRiskPct: number;
  positionPctOfEquity: number;
  projectedTotalExposurePct: number;
  projectedSectorExposurePct: number;
  rewardRiskRatio: number | null;
  potentialProfitInr: number | null;
}

export interface GeminiResearchResult {
  symbol: string;
  research_classification:
    | 'STRONG'
    | 'WATCH'
    | 'CAUTION'
    | 'AVOID'
    | 'INSUFFICIENT_DATA';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  business_quality: string;
  financial_strength: string;
  growth_and_profitability: string;
  debt_and_cashflow: string;
  valuation: string;
  latest_results_and_announcements: string;
  sector_context: string;
  positive_factors: string[];
  negative_factors: string[];
  red_flags: string[];
  missing_or_unverified_data: string[];
  analyst_conclusion: string;
  not_a_trade_signal: boolean;
  research_model: string;
  research_timestamp_utc: string;
  grounding_sources?: Array<{ title: string; url: string }>;
}

export type BacktestStopMode = 'ATR_1_5' | 'PCT_5' | 'PCT_7';
export type BacktestSignalScope = 'ALL_6M' | 'DELIV_AB_ONLY';

export interface BacktestTrade {
  id: number;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  signalBasis: 'VERIFIED_DELIV_AB' | 'OHLCV_6M_PROXY';
  deliveryCategory: DeliveryCategory | 'UNVERIFIED_6M';
  delivPer: number | null;
  rvol: number | null;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  exitPrice: number;
  stopPct: number;
  outcome: 'TARGET_HIT' | 'STOP_HIT' | 'TIME_EXIT' | 'OPEN';
  returnPct: number;
  realizedR: number;
  mfePct: number;
  maePct: number;
  barsHeld: number;
  cumReturnPct: number;
  cumR: number;
}

export interface BacktestResult {
  symbol: string;
  params: {
    holdDays: number;
    targetR: number;
    stopMode: BacktestStopMode;
    signalScope: BacktestSignalScope;
  };
  coverage: {
    fromDate: string;
    toDate: string;
    totalTradingSessions: number;
    nseDeliverySessions: number;
    sourceLabel: string;
  };
  metrics: {
    totalSignals: number;
    closedTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
    avgWinR: number | null;
    avgLossR: number | null;
    avgRiskRewardRatio: number | null;
    expectancyR: number | null;
    profitFactor: number | null;
    compoundedReturnPct: number | null;
    maxDrawdownPct: number | null;
    avgHoldDays: number | null;
    verifiedDelivSignals: number;
    proxySignals: number;
  };
  trades: BacktestTrade[];
}

export interface IpoOverviewData {
  asOfDate: string;
  cutoffDays: number;
  sentiment: MarketSentiment;
  stats: {
    totalIpos: number;
    under3mCount: number;
    under6mCount: number;
    under1yCount: number;
    deliveryABCount: number;
    highRvolCount: number;
    liquidCount: number;
    uTurnReadyCount: number;
    topTurnWarnCount: number;
    auditUnder1m: number;
    audit1To3m: number;
    auditOver3m: number;
    auditUnverified: number;
  };
  rows: ScreenerRow[];
}

export type ResultPriorityTier =
  | 'WITHIN_1M'
  | 'WITHIN_2M'
  | 'WITHIN_3M'
  | 'BEYOND_3M'
  | 'UNSCHEDULED';

export type RejectionGateVerdict =
  | 'PASS_OBSERVATION'
  | 'REJECT_NEGATIVE_RESULT'
  | 'REJECT_NO_3M_RESULT'
  | 'REJECT_NEGATIVE_DEALS'
  | 'PENDING_VERIFICATION';

export interface StockNewsItem {
  title: string;
  url: string;
  source: string;
  publishedAtUtc: string;
  ageDays: number;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export interface CorporateAnnouncementItem {
  date: string;
  symbol: string;
  category:
    | 'ORDER_WIN'
    | 'RESULTS_BOARD_MEETING'
    | 'CORPORATE_ACTION'
    | 'EXPANSION_FUNDRAISE'
    | 'GENERAL';
  subject: string;
  details: string;
  attachmentUrl: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export interface BulkBlockDealItem {
  date: string;
  dealType: 'BULK' | 'BLOCK';
  symbol: string;
  clientName: string;
  buySell: 'BUY' | 'SELL';
  quantity: number;
  tradePrice: number;
  valueCr: number;
}

export interface BulkBlock30DSummary {
  totalDeals: number;
  buyCount: number;
  sellCount: number;
  buyValueCr: number;
  sellValueCr: number;
  netValueCr: number;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'NONE';
  sentimentLabel?: string;
  sentimentReason?: string;
  buyPct?: number;
  topBuyClients?: string[];
  topSellClients?: string[];
  deals: BulkBlockDealItem[];
}

export interface StockCatalystProfile {
  symbol: string;
  companyName: string;
  closePrice: number;
  changePct: number | null;
  sector: string;
  nextResultDate: string;
  daysToResult: number | null;
  resultPriority: ResultPriorityTier;
  resultSource: string;
  isResultEstimate: boolean;
  resultPolarity3M: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';
  result3MReason: string;
  profitGrowthPct: number | null;
  revenueGrowthPct: number | null;
  epsPrev: number | null;
  epsCurr: number | null;
  rejectionGate: RejectionGateVerdict;
  rejectionReasons: string[];
  observationEligible: boolean;
  news7D: StockNewsItem[];
  announcements: CorporateAnnouncementItem[];
  orderWinsCount: number;
  bulkBlock30D: BulkBlock30DSummary;
  swingTier: SwingTier;
  deliveryCategory: DeliveryCategory;
  rvol: number | null;
  uTurnStatus: UTurnStatus | null;
  fundamentalCoverage: FundamentalCoverage;
  fundamentalFreshness: FundamentalFreshness;
  fetchedAtUtc: string;
  marketCapCr?: number | null;
  marketCapCategory?: MarketCapCategory;
  ema21AboveEma44?: boolean | null;
  ema21Cross44Bullish?: boolean | null;
}

export interface CatalystScreenerResponse {
  asOfDate: string;
  priorityCounts: {
    within1m: number;
    within2m: number;
    within3m: number;
    total3m: number;
  };
  gateCounts: {
    passObservation: number;
    rejectNegativeResult: number;
    rejectNegativeDeals: number;
    rejectNo3mResult: number;
    pendingVerification: number;
  };
  bulkBlockStats: {
    available: boolean;
    totalDeals30D: number;
    symbolsWithDeals: number;
    distinctDatesCount?: number;
    oldestDealDate?: string;
    latestDealDate?: string;
    lastSyncedUtc: string;
    note: string;
  };
  calendarStats: {
    scheduledUpcomingCount: number;
    lastSyncedUtc: string;
    scanning: boolean;
    processed: number;
    total: number;
  };
  rows: StockCatalystProfile[];
  total: number;
}

export interface UpcomingResultStockItem {
  symbol: string;
  companyName: string;
  sector: string;
  isIpo: boolean;
  nextResultDate: string;
  daysToResult: number;
  resultPriority: ResultPriorityTier;
  resultSource: string;
  isResultEstimate: boolean;
  resultPolarity3M: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';
  result3MReason: string;
  rejectionGate: RejectionGateVerdict;
  profitGrowthPct: number | null;
  revenueGrowthPct: number | null;
  epsPrev: number | null;
  epsCurr: number | null;
  closePrice: number;
  changePct: number | null;
  swingTier: SwingTier;
  deliveryCategory: DeliveryCategory;
  delivPer: number | null;
  rvol: number | null;
  delivQtyRatio: number | null;
  uTurnStatus: UTurnStatus | null;
  fundamentalCoverage: FundamentalCoverage;
  fundamentalFreshness: FundamentalFreshness;
  bulkBlockNetCr: number;
  bulkBlockDealsCount: number;
  marketCapCr?: number | null;
  marketCapCategory?: MarketCapCategory;
  ema21AboveEma44?: boolean | null;
  ema21Cross44Bullish?: boolean | null;
}

export interface UpcomingResultObservationResponse {
  asOfDate: string;
  totalUpcoming: number;
  total: number;
  counts: {
    within1m: number;
    within2m: number;
    within3m: number;
    beyond3m: number;
    positive3m: number;
    negative3m: number;
    unknown3m: number;
    swingOrDelivAb: number;
  };
  items: UpcomingResultStockItem[];
}

export type TradeJournalSentiment = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type TradeJournalAction = 'WATCHING' | 'ENTERED' | 'EXITED' | 'SKIPPED';

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  tradeDate: string;
  action: TradeJournalAction;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number | null;
  sentiment: TradeJournalSentiment;
  setupTag: string;
  entryExitNotes: string;
  sentimentNotes: string;
  lessonsLearned: string;
  pnlPct: number | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface WatchlistResponse {
  symbols: string[];
  items: ScreenerRow[];
  triggered: ScreenerRow[];
  triggeredCount: number;
}

export type MacroAvailability<T> = {
  available: boolean;
  value: T | null;
  statusLabel: string;
  detail: string;
  source: string;
  asOfDate: string;
};

export interface MarketRegimeSnapshot {
  fetchedAtUtc: string;
  regimeVerdict: 'PROCEED' | 'CAUTION_50_PCT' | 'HARD_STOP';
  positionSizeMultiplier: number; // 1.0 | 0.5 | 0
  regimeReasons: string[];
  indiaVix: MacroAvailability<number> & { changePct: number | null };
  dxy: MacroAvailability<number> & { change1mPct: number | null; bias: 'STRONG_RISK' | 'NEUTRAL' | 'WEAK_SUPPORTIVE' | 'DATA NOT AVAILABLE' };
  brentCrude: MacroAvailability<number> & { change1mPct: number | null; bias: 'SEVERE_RISK' | 'CAUTION' | 'NEUTRAL' | 'PROCEED' | 'DATA NOT AVAILABLE' };
  nifty50: MacroAvailability<number> & { return1mPct: number | null; return1wPct: number | null; aboveEma20: boolean | null };
  usdInr: MacroAvailability<number> & { change1mPct: number | null };
  mmiProxy: MacroAvailability<number> & { zone: string; isProxy: boolean };
  breadth200Dma: MacroAvailability<number> & { ema21BreadthPct: number | null };
  fiiDiiDaily: {
    available: boolean;
    fiiNetCr: number | null;
    diiNetCr: number | null;
    status: 'BOTH_SELLERS_STOP' | 'OK' | 'DATA NOT AVAILABLE';
    source: string;
    note: string;
  };
  fiiLongShortRatio: {
    available: boolean;
    value: number | null;
    status: 'FALLING_REDUCE' | 'OK' | 'DATA NOT AVAILABLE';
    source: string;
    note: string;
  };
}

export type NewsImpactCategory =
  | 'RBI_POLICY'
  | 'GEOPOLITICAL'
  | 'COMMODITY'
  | 'CURRENCY'
  | 'CORPORATE'
  | 'GLOBAL_MACRO'
  | 'GENERAL';

export interface MacroNewsItem {
  title: string;
  url: string;
  source: string;
  publishedAtUtc: string;
  category: NewsImpactCategory;
  horizon: 'TEMPORARY' | 'STRUCTURAL';
  matchedRule: string;
  negativeSectors: string[];
  positiveSectors: string[];
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export interface SectorNewsImpactSummary {
  sector: string;
  positiveHits: number;
  negativeHits: number;
  netScore: number;
  bias: 'BOOST' | 'AVOID' | 'NEUTRAL';
  reasons: string[];
}

export interface MacroNewsDashboardResponse {
  regime: MarketRegimeSnapshot;
  feeds: Array<{ name: string; status: 'OK' | 'UNAVAILABLE'; count: number }>;
  geopoliticalAlerts: string[];
  dxyAvoidSectors: string[];
  dxyDefensiveSectors: string[];
  newsItems: MacroNewsItem[];
  sectorImpacts: SectorNewsImpactSummary[];
}

export type CheckGateStatus = 'PASS' | 'FAIL' | 'DATA NOT AVAILABLE';

export interface PiotroskiCheckItem {
  key: string;
  label: string;
  status: CheckGateStatus;
  detail: string;
}

export interface BotValuationSnapshot {
  epsTtm: number | null;
  bookValuePerShare: number | null;
  grahamNumber: number | null;
  grahamRatio: number | null;
  grahamZone: 'DEEP_VALUE' | 'FAIR_VALUE' | 'OVERVALUED' | 'DATA NOT AVAILABLE';
  fcfInr: number | null;
  sharesOutstanding: number | null;
  dcfIntrinsicPerShare: number | null;
  dcfZone: 'MARGIN_OF_SAFETY' | 'FAIR_OR_FULL' | 'DATA NOT AVAILABLE';
  evToEbitda: number | null;
  evToEbitda5YrAvg: number | null;
  evToEbitdaZone: string;
  evToEbitdaHistLabel?: string;
}

export interface BotStockAnalysis {
  symbol: string;
  companyName: string;
  sector: string;
  asOfDate: string;
  closePrice: number;
  isIpo?: boolean;
  swingTier?: string;
  delivPer?: number | null;
  marketCapCr?: number | null;
  marketCapCategory?: MarketCapCategory;
  paperTradingMode: boolean;
  dataCoverageNotes: string[];
  phase1Regime: {
    verdict: MarketRegimeSnapshot['regimeVerdict'];
    reasons: string[];
  };
  phase2SectorMacroNews: {
    sector1mReturnPct: number | null;
    nifty1mReturnPct: number | null;
    sectorOutperformsNifty: boolean | null;
    newsBias: 'BOOST' | 'AVOID' | 'NEUTRAL';
    dxySectorFlag: 'AVOID' | 'DEFENSIVE_BUY' | 'NEUTRAL';
    brentFlag: MarketRegimeSnapshot['brentCrude']['bias'];
    flags: string[];
  };
  phase3Fundamentals: {
    hardRejectPass: boolean;
    hardRejectAvailableCount: number;
    hardRejectPassCount: number;
    hardRejectFailCount: number;
    hardRejectReasons: string[];
    piotroskiScore: number | null;
    piotroskiAvailable: number;
    piotroskiChecks: PiotroskiCheckItem[];
    roe3YrAvgPct: number | null;
    debtToEquity: number | null;
    interestCoverage: number | null;
    earningsQualityOcfNi: number | null;
    epsGrowthYoyPct: number | null;
    freeFloatMcapCr: number | null;
    gates: Array<{ label: string; valueText: string; threshold: string; status: CheckGateStatus }>;
    valuation: BotValuationSnapshot;
  };
  phase4Movement: {
    lookbackDays: number;
    days5To10Pct: number;
    days10To19Pct: number;
    days19PlusPct: number;
    downDays5To10Pct: number;
    downDays10To19Pct: number;
    downDays19PlusPct: number;
    burstPowerRaw: number | null;
    burstPowerNormalized: number | null;
    downwardBurstRaw: number | null;
    downwardBurstNormalized: number | null;
    netBurstRaw: number | null;
    netBurstNormalized: number | null;
    upwardBurstSharePct?: number | null;
    downwardBurstSharePct?: number | null;
    upwardBurstDaysPct?: number | null;
    downwardBurstDaysPct?: number | null;
    burstBias: 'UPWARD_DOMINANT' | 'BALANCED' | 'DOWNWARD_RISK' | 'DATA NOT AVAILABLE';
    burstPass: boolean | null;
    high52W: number | null;
    distFrom52wHighPct: number | null;
    within25PctOf52wHigh: boolean | null;
    relativeStrengthPctRank: number | null;
    rsPass: boolean | null;
  };
  periodicAnalysis: {
    supportResistance: {
      nearestSupport: number | null;
      nearestSupportLabel: string;
      supportDistPct: number | null;
      secondarySupport: number | null;
      secondarySupportLabel: string;
      nearestResistance: number | null;
      nearestResistanceLabel: string;
      resistanceDistPct: number | null;
      secondaryResistance: number | null;
      secondaryResistanceLabel: string;
      pivot: number | null;
      pivotS1: number | null;
      pivotR1: number | null;
      riskRewardToR1: number | null;
      low52W: number | null;
      high52W: number | null;
      positionStatus:
        | 'NEAR_SUPPORT'
        | 'BREAKOUT_ABOVE_R1'
        | 'NEAR_RESISTANCE'
        | 'MID_RANGE'
        | 'BELOW_SUPPORT'
        | 'DATA NOT AVAILABLE';
      swingSupports: Array<{ price: number; date: string; label: string }>;
      swingResistances: Array<{ price: number; date: string; label: string }>;
    };
    sentiment: {
      daily: {
        timeframe: 'DAILY';
        status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'DATA NOT AVAILABLE';
        score: number | null;
        candlesCount: number;
        returnPct: number | null;
        returnLabel: string;
        emaShort: number | null;
        emaLong: number | null;
        emaShortLabel: string;
        emaLongLabel: string;
        aboveEmaShort: boolean | null;
        aboveEmaLong: boolean | null;
        rsi: number | null;
        reasons: string[];
      };
      weekly: {
        timeframe: 'WEEKLY';
        status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'DATA NOT AVAILABLE';
        score: number | null;
        candlesCount: number;
        returnPct: number | null;
        returnLabel: string;
        emaShort: number | null;
        emaLong: number | null;
        emaShortLabel: string;
        emaLongLabel: string;
        aboveEmaShort: boolean | null;
        aboveEmaLong: boolean | null;
        rsi: number | null;
        reasons: string[];
      };
      monthly: {
        timeframe: 'MONTHLY';
        status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'DATA NOT AVAILABLE';
        score: number | null;
        candlesCount: number;
        returnPct: number | null;
        returnLabel: string;
        emaShort: number | null;
        emaLong: number | null;
        emaShortLabel: string;
        emaLongLabel: string;
        aboveEmaShort: boolean | null;
        aboveEmaLong: boolean | null;
        rsi: number | null;
        reasons: string[];
      };
      bullishTimeframesCount: number;
      availableTimeframesCount: number;
      mtfAlignment: string;
    };
    periodicScore: {
      score: number | null;
      grade: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'WEAK' | 'DATA NOT AVAILABLE';
      formulaText: string;
      definitionSummary: string;
      thresholdGuide: string;
      breakdown: Array<{
        label: string;
        weightPct: number;
        rawScore: number | null;
        weightedPoints: number | null;
        detail: string;
      }>;
    };
  };
  phase5Accumulation: {
    wyckoffSellingClimax: boolean | null;
    wyckoffSecondaryTest: boolean | null;
    wyckoffSpring: boolean | null;
    wyckoffSos: boolean | null;
    vcpDetected: boolean | null;
    vcpDetail: string;
    deliveryDailyPct: number | null;
    delivery5dAvgPct: number | null;
    rvol: number | null;
    aboveVwap: boolean | null;
    bulkDealRepeatedPrints: number;
    bulkBlockConfirmation: {
      totalDeals30d: number;
      bulkBuyCount: number;
      bulkSellCount: number;
      blockBuyCount: number;
      blockSellCount: number;
      netValueCr: number;
      largestBuyDealCr: number | null;
      avgTurnover20DCr: number | null;
      sizeVsAdvPct: number | null;
      largePrintFlag: boolean;
      repeatedBuyClientName: string | null;
      repeatedBuyPrints: number;
      avgBuyDealPrice: number | null;
      recentRange20dHigh: number | null;
      priceContext: 'ABOVE_RANGE' | 'INSIDE_RANGE' | 'BELOW_RANGE' | 'NO_BUY_DEALS';
      confirmationStatus: 'CONFIRMED' | 'ACTIVE_WATCH' | 'SELL_PRESSURE' | 'NO_30D_DEALS';
      confirmationReason: string;
      totalBuyCr?: number;
      totalSellCr?: number;
      buyPct?: number;
      topBuyClients?: string[];
      topSellClients?: string[];
      recentDeals: Array<{
        date: string;
        dealType: string;
        clientName: string;
        buySell: string;
        tradePrice: number;
        valueCr: number;
      }>;
    };
    promoterHoldingPct: number | null;
    fiiHoldingPct: number | null;
    diiHoldingPct: number | null;
    smartMoneyTotalPct: number | null;
    fiiDiiMultiQuarterTrend: 'INCREASING' | 'DECREASING' | 'FLAT / MIXED' | 'DATA NOT AVAILABLE';
    fiiDiiTrendDetail?: string;
    fiiDiiQuarterSeries?: Array<{
      period: string;
      promoterPct: number | null;
      fiiPct: number | null;
      diiPct: number | null;
    }>;
    promoterPledgePct: number | null;
    institutionalLimitationNote: string;
  };
  phase6EntryTriggers: {
    ema9: number | null;
    ema20: number | null;
    ema21: number | null;
    ema44: number | null;
    ema50: number | null;
    ema200: number | null;
    ema21AboveEma44?: boolean | null;
    ema21Cross44Bullish?: boolean | null;
    ema21Cross44DaysAgo?: number | null;
    rsi14: number | null;
    macdHistogram: number | null;
    bbLower: number | null;
    trendAligned20_50_200: boolean | null;
    fastSignalsTriggered: string[];
    anyFastEntryTriggered: boolean;
    gapUpPct: number | null;
    gapUpSkip: boolean;
  };
  phase7Risk: {
    entryPrice: number;
    stopLoss: number;
    stopPct: number;
    target15Pct: number;
    target25Pct: number;
    suggestedPositionSizePct: number;
    trailingBreakevenTriggerPrice: number;
  };
  phase8TopWarnings: {
    fundamentalOvervalued: boolean;
    technicalOverheated: boolean;
    distributionFlatHighDeliv: boolean;
    warnings: string[];
  };
  scoring: {
    totalScore: number;
    verdict: 'STRONG BUY' | 'BUY (75% SIZE)' | 'BUY (50% SIZE)' | 'WATCHLIST' | 'HARD REJECT';
    baseScore: number;
    breakdown: Array<{ label: string; points: number; active: boolean; note: string }>;
  };
  newsBadge?: {
    hasAnnouncement: boolean;
    label: string;
    headlineCount: number;
    hasRiskAlert: boolean;
  };
}

export interface StockLiveNewsItem {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  dateIso: string;
  url: string;
  kind: 'NEWS' | 'ANNOUNCEMENT';
  announcementTag?: string;
  isRiskAlert: boolean;
}

export interface StockLiveNewsResponse {
  symbol: string;
  companyName: string;
  cacheDateIst: string;
  fetchedAtUtc: string;
  providerUsed: string;
  hasRecentAnnouncement: boolean;
  recentAnnouncementLabel: string;
  hasRiskAlert: boolean;
  items: StockLiveNewsItem[];
}

export interface BotBacktestTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  outcome: 'TARGET' | 'STOP' | 'TIME_EXIT';
  phaseSet: string;
  inSample: boolean;
}

export interface BotBacktestPhaseMetrics {
  label: string;
  trades: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  sharpeRatio: number | null;
  compoundedReturnPct: number | null;
}

export interface BotBacktestReport {
  symbol: string;
  paperTradingMode: boolean;
  dataSource: string;
  fromDate: string;
  toDate: string;
  totalSessions: number;
  splitDate: string;
  params: {
    holdDays: number;
    stopPct: number;
    targetPct: number;
  };
  overall: BotBacktestPhaseMetrics;
  inSample: BotBacktestPhaseMetrics;
  outOfSample: BotBacktestPhaseMetrics;
  phaseAblation: BotBacktestPhaseMetrics[];
  recentTrades: BotBacktestTrade[];
}

export interface LiveStockQuote {
  available: boolean;
  symbol: string;
  tickerUsed: string;
  livePrice: number | null;
  prevClose: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  marketTimeIst: string;
  marketState: string;
  lastUpdated?: string | null;
  marketTimestampSec?: number | null;
  marketDateIst?: string | null;
  systemDateIst?: string;
  isStale?: boolean;
  staleReason?: string | null;
  source: string;
  note: string;
}

export type PaperTradeStatus = 'OPEN' | 'CLOSED';

export interface PaperTrade {
  id: string;
  symbol: string;
  sector: string;
  strategyTag: string;
  status: PaperTradeStatus;
  quantity: number;
  entryDate: string;
  entryPrice: number;
  entryPriceSource: 'LIVE_YAHOO' | 'NSE_EOD' | 'MANUAL';
  stopLoss: number | null;
  targetPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitPriceSource: 'LIVE_YAHOO' | 'NSE_EOD' | 'MANUAL' | null;
  realizedPnlInr: number | null;
  realizedPnlPct: number | null;
  rMultiple: number | null;
  notes: string;
  createdAtUtc: string;
  closedAtUtc: string | null;
}

export interface PaperTradeMarked extends PaperTrade {
  currentPrice: number | null;
  currentPriceSource: 'LIVE_YAHOO' | 'NSE_EOD' | 'DATA NOT AVAILABLE';
  unrealizedPnlInr: number | null;
  unrealizedPnlPct: number | null;
}

export interface PaperStrategyStat {
  strategyTag: string;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  capitalDeployedInr: number;
  closedCapitalInr: number;
  realizedPnlInr: number;
  unrealizedPnlInr: number;
  netPnlInr: number;
  roiPct: number | null;
  avgReturnPct: number | null;
  avgRMultiple: number | null;
  profitFactor: number | null;
}

export interface PaperPortfolioSummary {
  trades: PaperTradeMarked[];
  stats: {
    totalTrades: number;
    openCount: number;
    closedCount: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
    totalRealizedPnlInr: number;
    totalUnrealizedPnlInr: number;
    netPnlInr: number;
    avgReturnPct: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
    avgRMultiple: number | null;
    profitFactor: number | null;
    openCapitalInr: number;
    closedInvestedCapitalInr: number;
    totalInvestedCapitalInr: number;
    realizedRoiPct: number | null;
    totalRoiPct: number | null;
  };
  byStrategy: PaperStrategyStat[];
}

export interface RecommendedStockPick {
  symbol: string;
  companyName: string;
  sector: string;
  eodClose: number;
  livePrice: number | null;
  liveChangePct: number | null;
  liveLastUpdated?: string | null;
  liveMarketTimeIst?: string;
  liveMarketDateIst?: string | null;
  liveMarketState?: string;
  liveIsStale?: boolean;
  botScore: number;
  botVerdict: BotStockAnalysis['scoring']['verdict'];
  confluenceScore: number;
  tier: 'ALL_FILTER_PASS' | 'HIGH_CONFLUENCE_WATCH';
  filtersPassed: string[];
  filtersFailedOrMissing: string[];
  entryPrice: number;
  stopLoss: number;
  target15Pct: number;
  target25Pct: number;
  suggestedSizePct: number;
  delivPer: number | null;
  avgDeliv5D: number | null;
  rvol: number | null;
  uTurnStatus: string | null;
  swingTier: string;
  isIpo?: boolean;
  marketCapCr?: number | null;
  marketCapCategory?: MarketCapCategory;
  ema21AboveEma44?: boolean | null;
  ema21Cross44Bullish?: boolean | null;
  aiResearchBrief: {
    headline: string;
    fundamentalVerdict: string;
    technicalSetup: string;
    macroNewsContext: string;
    riskPlan: string;
    dataGaps: string;
  };
}

export interface RecommendedStocksResponse {
  generatedAtUtc: string;
  scannedUniverseCount: number;
  strictPassCount: number;
  regimeVerdict: string;
  picks: RecommendedStockPick[];
}

export type T1T2DailyPresenceStatus = 'DAILY_REPEAT' | 'NEW_TODAY' | 'YESTERDAY_ONLY';

export interface T1T2DailyReportItem {
  symbol: string;
  companyName: string;
  sector: string;
  isIpo: boolean;
  listingDate: string;
  sessionsCount: number;
  todayTier: 'TIER_1_READY' | 'TIER_2_ACCUMULATION' | 'NONE';
  yesterdayTier: 'TIER_1_READY' | 'TIER_2_ACCUMULATION' | 'NONE';
  presenceStatus: T1T2DailyPresenceStatus;
  consecutiveDays: number;
  daysSeenInHistory: number;
  datesAppeared: string[];
  scannerEodClose: number;
  yesterdayEodClose: number | null;
  eodChangePct: number | null;
  rvol: number | null;
  delivPer: number | null;
  delivQtyRatio: number | null;
  rsi14: number | null;
  ema21: number | null;
  aboveEma21: boolean | null;
  avgTurnover20DCr: number | null;
  uTurnStatus: UTurnStatus | null;
  fundamentalCoverage: FundamentalCoverage;
  fundamentalFreshness: FundamentalFreshness;
  livePrice: number | null;
  liveVsScannerEodPct: number | null;
  liveVsScannerEodInr: number | null;
  liveLastUpdated?: string | null;
  liveMarketTimeIst?: string;
  liveMarketDateIst?: string | null;
  liveMarketState?: string;
  liveIsStale?: boolean;
  liveSourceNote: string;
  marketCapCr?: number | null;
  marketCapCategory?: MarketCapCategory;
  ema21AboveEma44?: boolean | null;
  ema21Cross44Bullish?: boolean | null;
}

export interface T1T2DailyReportResponse {
  todayDate: string;
  yesterdayDate: string | null;
  memorizedDates: string[];
  counts: {
    todayTotal: number;
    todayT1: number;
    todayT2: number;
    todayIpoCount: number;
    yesterdayTotal: number;
    dailyRepeatCount: number;
    newTodayCount: number;
    yesterdayOnlyCount: number;
  };
  items: T1T2DailyReportItem[];
}

export interface StrategyAdvisorParams {
  zoneTolerancePct: 2 | 3;
  minDeliveryPct: number;
  minRvol: number;
  minUpwardBurst: number;
  blockDistributionTrend: boolean;
}

export interface StrategyAdvisorParameterCheck {
  parameter: string;
  userRule: string;
  actualValue: string;
  status: 'PASS' | 'FAIL' | 'WATCH' | 'MISSING';
}

export interface AiStrategyAdvisorResult {
  symbol: string;
  recommendation: 'BUY' | 'HOLD' | 'AVOID';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  uTurnViability:
    | 'HIGH_VIABILITY'
    | 'MODERATE_VIABILITY'
    | 'LOW_VIABILITY'
    | 'NO_EPS_DROP_SETUP';
  executiveSummary: string;
  livePriceVsUTurnAnalysis: string;
  epsDropAssessment: string;
  burstProfileAssessment: string;
  actionPlan: string;
  keyRisks: string[];
  parameterAlignment: StrategyAdvisorParameterCheck[];
  snapshotMetrics: {
    eodDate: string;
    eodClose: number;
    livePrice: number | null;
    liveVsEodPct: number | null;
    uTurnTarget: number | null;
    zoneLow: number | null;
    zoneHigh: number | null;
    uTurnStatus: string;
    epsPrev: number | null;
    epsCurr: number | null;
    epsDrop: number | null;
    epsDropPct: number | null;
    avgPeRatio: number | null;
    burstProfileCategory: string;
    upwardBurstNorm: number | null;
    downwardBurstNorm: number | null;
    netBurstNorm: number | null;
    delivPer: number | null;
    rvol: number | null;
    periodicScore: number | null;
    periodicGrade: string;
    nearestSupport: number | null;
    nearestResistance: number | null;
  };
  model: string;
  generatedAtUtc: string;
}

export type CatalystSentimentLabel = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface CorporateFilingHeadline {
  id: string;
  date: string;
  source: 'BSE Filing' | 'NSE Filing' | 'NSE XBRL';
  category: string;
  headline: string;
  details: string;
  url: string;
}

export interface CatalystSentimentBullet {
  sentiment: CatalystSentimentLabel;
  topic: string;
  summary: string;
}

export interface CatalystNewsResponse {
  symbol: string;
  companyName: string;
  fetchedAtUtc: string;
  fromCache: boolean;
  filings: CorporateFilingHeadline[];
  overallSentiment: CatalystSentimentLabel | null;
  sentimentBullets: CatalystSentimentBullet[];
  aiModel: string | null;
  aiError: string | null;
}


