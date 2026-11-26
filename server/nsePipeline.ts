import fs from 'node:fs';
import path from 'node:path';
import { parseBhavDateToIso, parseCsvRecords, toNum } from './csvParser.ts';
import {
  classifyMarketCap,
  loadLiveFundamentalOverrides,
  toIstDateIso,
} from './liveFetcher.ts';
import { loadIndianFundamentalsCache } from './indianFundamentals.ts';
import {
  evaluateTurnaroundTopConfirmation,
  evaluateUTurnConfirmation,
  type TurnaroundTopOptions,
  type UTurnOptions,
} from './uturn.ts';
import {
  calculateMarketBreadth,
  calculateSectorBreadth,
  calculateSectorDeliveryTrendMetrics,
  deduplicateBreadthRows,
} from './breadthCalculator.ts';
import {
  calculateEmaSeries,
  calculateLatestRvol,
  calculateLatestWilderRsi,
  calculateRvolSeries,
  calculateWilderRsiSeries,
  type NumericInput,
} from './technicalIndicators.ts';
import {
  classifySwingTier,
  computeFunnelTierCounts,
  computeSequentialFunnelMetrics,
} from './funnelClassifier.ts';
import {
  classifyFundamentalFreshness,
  DEFAULT_MAX_DATA_AGE_DAYS,
} from './fundamentalAudit.ts';
import type {
  AuditFreshnessTier,
  CorrelationCellStats,
  CorrelationPeerMeta,
  DailyBhavRow,
  DeliveryCategory,
  FundamentalAuditEntry,
  FundamentalCoverage,
  FundamentalFreshness,
  FundamentalMetricCheck,
  FundamentalProfile,
  IpoOverviewData,
  LiquidityTier,
  MarketCapCategory,
  MarketSentiment,
  OverviewData,
  PeerCorrelationMatrixData,
  RvolBand,
  ScreenerRow,
  SectorSentimentItem,
  SignalLogEntry,
  SignalSummaryStats,
  StockDetailData,
  SwingTier,
  TurnaroundTopEvaluation,
  UTurnEvaluation,
  UTurnStatus,
  XbrlFiling,
} from '../src/types/trading.ts';

interface Thresholds {
  min_revenue_growth_pct: number;
  min_profit_growth_pct: number;
  min_roe_pct: number;
  min_roce_pct: number;
  max_debt_to_equity: number;
  min_interest_coverage: number;
  require_positive_operating_cash_flow: boolean;
  require_positive_free_cash_flow: boolean;
  max_data_age_days: number;
}

interface StreakInfo {
  consecutiveStreak: number;
  totalQualifyingSessions: number;
  firstStreakDate: string;
  lastCategory: string;
  lastStatus: string;
  lastAvgDelivery5D: number | null;
  lastLatestDeliveryPct: number | null;
}

class NsePipelineEngine {
  private initialized = false;
  private latestSessionDate = '';
  private sessionDates: string[] = [];
  private thresholds: Thresholds = {
    min_revenue_growth_pct: 0,
    min_profit_growth_pct: 0,
    min_roe_pct: 10,
    min_roce_pct: 12,
    max_debt_to_equity: 1,
    min_interest_coverage: 3,
    require_positive_operating_cash_flow: true,
    require_positive_free_cash_flow: false,
    max_data_age_days: DEFAULT_MAX_DATA_AGE_DAYS,
  };
  private historyBySymbol = new Map<string, DailyBhavRow[]>();
  private fundamentalsBySymbol = new Map<string, FundamentalProfile>();
  private xbrlBySymbol = new Map<string, XbrlFiling[]>();
  private xbrlTotalCount = 0;
  private signals: SignalLogEntry[] = [];
  private signalsBySymbol = new Map<string, SignalLogEntry[]>();
  private signalSummaryStats: SignalSummaryStats = {
    total: 0,
    evaluatedCount: 0,
    positiveReturnCount: 0,
    winRatePct: null,
    avgReturnPct: null,
    avgMfePct: null,
    avgMaePct: null,
    rejectionBreakdown: [],
  };
  private screenerRows: ScreenerRow[] = [];
  private screenerBySymbol = new Map<string, ScreenerRow>();
  private overviewCache: OverviewData | null = null;
  private multiYearCsvSymbols = new Set<string>();
  private yahooEma200BySymbol = new Map<string, number>();

  public reload(): void {
    this.initialized = false;
    this.latestSessionDate = '';
    this.sessionDates = [];
    this.historyBySymbol.clear();
    this.fundamentalsBySymbol.clear();
    this.xbrlBySymbol.clear();
    this.xbrlTotalCount = 0;
    this.signals = [];
    this.signalsBySymbol.clear();
    this.screenerRows = [];
    this.screenerBySymbol.clear();
    this.overviewCache = null;
    this.multiYearCsvSymbols.clear();
    this.yahooEma200BySymbol.clear();
    this.ensureLoaded();
  }

  private loadYahooEma200Cache(root: string): void {
    const file = path.join(root, 'data', 'research', 'bot_yahoo_cache.json');
    if (!fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
        string,
        { bars?: Array<{ close?: number }> }
      >;
      if (!parsed || typeof parsed !== 'object') return;
      for (const [sym, entry] of Object.entries(parsed)) {
        const bars = Array.isArray(entry?.bars) ? entry.bars : [];
        const closes = bars
          .map((b) => (typeof b?.close === 'number' && b.close > 0 ? b.close : null))
          .filter((v): v is number => v !== null);
        if (closes.length >= 200) {
          const ema200Series = this.computeEmaSeries(closes, 200);
          const lastVal = ema200Series[ema200Series.length - 1] ?? null;
          if (lastVal !== null && Number.isFinite(lastVal)) {
            this.yahooEma200BySymbol.set(sym.trim().toUpperCase(), Number(lastVal.toFixed(2)));
          }
        }
      }
    } catch {
      // ignore optional cache read errors
    }
  }

  public ensureLoaded(): void {
    if (this.initialized) return;
    const root = process.cwd();
    this.loadThresholds(root);
    const streakMap = this.loadStreakState(root);
    this.loadFundamentals(root);
    this.mergeFreeSourceCache(root);
    this.mergeLiveOverrides();
    this.mergeIndianFundamentalsCache();
    this.mergeScreenerShareholding(root);
    this.loadYahooEma200Cache(root);
    this.loadXbrlFilings(root);
    this.loadBhavcopiesAndBuildScreener(root, streakMap);
    this.loadRawSignals(root);
    this.generateSignalsForMissingSessions();
    this.attachLatestSignalsToScreener();
    this.evaluateSignalOutcomes();
    this.initialized = true;
  }

  private loadThresholds(root: string): void {
    const file = path.join(root, 'data', 'inputs', 'fundamental_thresholds.json');
    if (fs.existsSync(file)) {
      try {
        this.thresholds = JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch {
        // retain defaults
      }
    }
  }

  public updateThresholds(root: string, newThresholds: Partial<Thresholds>): Thresholds {
    const prevMaxAge = this.thresholds.max_data_age_days;
    this.thresholds = { ...this.thresholds, ...newThresholds };
    const file = path.join(root, 'data', 'inputs', 'fundamental_thresholds.json');
    try {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.thresholds, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write fundamental_thresholds.json:', err);
    }
    this.overviewCache = null;
    if (
      newThresholds.max_data_age_days !== undefined &&
      newThresholds.max_data_age_days !== prevMaxAge
    ) {
      this.reload();
    }
    return this.thresholds;
  }

  private loadStreakState(root: string): Map<string, StreakInfo> {
    const map = new Map<string, StreakInfo>();
    const file = path.join(root, 'data', 'cache', 'delivery', 'v8_delivery_scan_streak_state.csv');
    if (!fs.existsSync(file)) return map;
    const records = parseCsvRecords(fs.readFileSync(file, 'utf-8'));
    for (const r of records) {
      const sym = (r.TckrSymb || '').trim().toUpperCase();
      if (!sym) continue;
      map.set(sym, {
        consecutiveStreak: toNum(r.ConsecutiveAorBScanSessions) ?? 0,
        totalQualifyingSessions: toNum(r.TotalAorBQualifyingScanSessions) ?? 0,
        firstStreakDate: (r.FirstDateOfCurrentStreak || '').trim(),
        lastCategory: (r.LastDeliveryCategory || 'NONE').trim(),
        lastStatus: (r.LastDeliveryStatus || '').trim(),
        lastAvgDelivery5D: toNum(r.LastAvgDelivery5D),
        lastLatestDeliveryPct: toNum(r.LastLatestDeliveryPct),
      });
    }
    return map;
  }

  private formatInrCompact(v: number | null): string {
    if (v === null) return 'Missing';
    const abs = Math.abs(v);
    if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
    return `₹${v.toFixed(0)}`;
  }

  private recomputeChecks(profile: FundamentalProfile): FundamentalProfile {
    const t = this.thresholds;
    const {
      revenueGrowthPct,
      profitGrowthPct,
      roePct,
      rocePct,
      debtToEquity,
      interestCoverage,
      operatingCashFlowInr,
    } = profile;

    const checks: FundamentalMetricCheck[] = [
      {
        key: 'revenueGrowthPct',
        label: 'Revenue Growth (YoY)',
        value: revenueGrowthPct,
        formattedValue: revenueGrowthPct !== null ? `${revenueGrowthPct.toFixed(2)}%` : 'Missing',
        thresholdLabel: `>= ${t.min_revenue_growth_pct}%`,
        status:
          revenueGrowthPct === null
            ? 'MISSING'
            : revenueGrowthPct >= t.min_revenue_growth_pct
              ? 'PASS'
              : 'FAIL',
      },
      {
        key: 'profitGrowthPct',
        label: 'Profit Growth (YoY)',
        value: profitGrowthPct,
        formattedValue: profitGrowthPct !== null ? `${profitGrowthPct.toFixed(2)}%` : 'Missing',
        thresholdLabel: `>= ${t.min_profit_growth_pct}%`,
        status:
          profitGrowthPct === null
            ? 'MISSING'
            : profitGrowthPct >= t.min_profit_growth_pct
              ? 'PASS'
              : 'FAIL',
      },
      {
        key: 'roePct',
        label: 'ROE',
        value: roePct,
        formattedValue: roePct !== null ? `${roePct.toFixed(2)}%` : 'Missing',
        thresholdLabel: `>= ${t.min_roe_pct}%`,
        status: roePct === null ? 'MISSING' : roePct >= t.min_roe_pct ? 'PASS' : 'FAIL',
      },
      {
        key: 'rocePct',
        label: 'ROCE',
        value: rocePct,
        formattedValue: rocePct !== null ? `${rocePct.toFixed(2)}%` : 'Missing',
        thresholdLabel: `>= ${t.min_roce_pct}%`,
        status: rocePct === null ? 'MISSING' : rocePct >= t.min_roce_pct ? 'PASS' : 'FAIL',
      },
      {
        key: 'debtToEquity',
        label: 'Debt / Equity',
        value: debtToEquity !== null && debtToEquity >= 0 ? debtToEquity : null,
        formattedValue:
          debtToEquity !== null && debtToEquity >= 0 ? debtToEquity.toFixed(2) : 'Missing',
        thresholdLabel: `<= ${t.max_debt_to_equity}`,
        status:
          debtToEquity === null || debtToEquity < 0
            ? 'MISSING'
            : debtToEquity <= t.max_debt_to_equity
              ? 'PASS'
              : 'FAIL',
      },
      {
        key: 'interestCoverage',
        label: 'Interest Coverage',
        value: interestCoverage,
        formattedValue: interestCoverage !== null ? `${interestCoverage.toFixed(2)}x` : 'Missing',
        thresholdLabel: `>= ${t.min_interest_coverage}x`,
        status:
          interestCoverage === null
            ? 'MISSING'
            : interestCoverage >= t.min_interest_coverage
              ? 'PASS'
              : 'FAIL',
      },
      {
        key: 'operatingCashFlowInr',
        label: 'Operating Cash Flow',
        value: operatingCashFlowInr,
        formattedValue: this.formatInrCompact(operatingCashFlowInr),
        thresholdLabel: t.require_positive_operating_cash_flow ? '> 0' : 'Optional',
        status:
          operatingCashFlowInr === null
            ? 'MISSING'
            : !t.require_positive_operating_cash_flow || operatingCashFlowInr > 0
              ? 'PASS'
              : 'FAIL',
      },
    ];

    const passCount = checks.filter((c) => c.status === 'PASS').length;
    const failCount = checks.filter((c) => c.status === 'FAIL').length;
    const missingCount = checks.filter((c) => c.status === 'MISSING').length;
    const coverage: FundamentalCoverage =
      missingCount === 0 ? 'COMPLETE' : missingCount < checks.length ? 'PARTIAL_DATA' : 'MISSING';

    return {
      ...profile,
      checks,
      passCount,
      failCount,
      missingCount,
      coverage,
    };
  }

  private isValidIsoDate(d: string | undefined | null): d is string {
    return Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  }

  private diffDaysBetween(refIso: string, dateIso: string): number | null {
    if (!this.isValidIsoDate(refIso) || !this.isValidIsoDate(dateIso)) return null;
    const refMs = Date.parse(`${refIso}T00:00:00Z`);
    const dateMs = Date.parse(`${dateIso}T00:00:00Z`);
    if (!Number.isFinite(refMs) || !Number.isFinite(dateMs)) return null;
    return Math.max(0, Math.round((refMs - dateMs) / 86400000));
  }

  private computeSymbolFreshness(
    sym: string,
    fund: FundamentalProfile | undefined,
    refDateIso: string
  ): {
    fundamentalFreshness: FundamentalFreshness;
    fundamentalAgeDays: number | null;
    fundamentalRemark: string;
    fundamentalSources: string[];
    latestFilingDate: string;
  } {
    const xbrlList = this.xbrlBySymbol.get(sym) ?? [];
    const latestXbrl = xbrlList[0];
    const latestFilingDate =
      (latestXbrl && this.isValidIsoDate(latestXbrl.publicationDate) && latestXbrl.publicationDate) ||
      (latestXbrl && this.isValidIsoDate(latestXbrl.financialPeriodEnd) && latestXbrl.financialPeriodEnd) ||
      (fund && this.isValidIsoDate(fund.publicationDate) && fund.publicationDate) ||
      '';

    const srcSet = new Set<string>();
    if (xbrlList.length > 0) srcSet.add('NSE XBRL');
    if (fund) {
      const hasTrustedIndian = (fund.fundamentalSources || []).some(
        (s) => s === 'Screener.in' || s === 'BSE Official'
      );
      for (const s of fund.fundamentalSources || []) {
        if (!s) continue;
        if (hasTrustedIndian && (s === 'YFinance (.NS)' || s === 'BSE (.BO)')) continue;
        srcSet.add(s);
      }
      const rawSrc = (fund.source || '').toLowerCase();
      if (rawSrc.includes('screener')) srcSet.add('Screener.in');
      if (rawSrc.includes('bse official') || rawSrc.includes('.bo') || rawSrc.includes('bse')) {
        if (rawSrc.includes('bse official')) srcSet.add('BSE Official');
        else if (!hasTrustedIndian) srcSet.add('BSE (.BO)');
      }
      if (!hasTrustedIndian && (rawSrc.includes('.ns') || rawSrc.includes('yahoo') || rawSrc.includes('yfinance'))) {
        srcSet.add('YFinance (.NS)');
      }
      if (rawSrc.includes('cache')) srcSet.add('Free Cache');
      if (rawSrc.includes('nse') && !srcSet.has('NSE XBRL')) srcSet.add('NSE Filing');
      if (srcSet.size === 0 && fund.source) srcSet.add('CSV Baseline');
    }
    const fundamentalSources = Array.from(srcSet);
    const sourcesLabel = fundamentalSources.length > 0 ? fundamentalSources.join(' + ') : 'None';

    const hasRatios = Boolean(
      fund && (fund.coverage !== 'MISSING' || fund.epsCurr !== null || fund.trailingPE !== null)
    );

    if (!hasRatios || !fund) {
      if (latestXbrl) {
        const filingPeriod = latestXbrl.financialPeriodEnd || latestFilingDate;
        return {
          fundamentalFreshness: 'NOT_AVAILABLE',
          fundamentalAgeDays: this.diffDaysBetween(refDateIso, filingPeriod),
          fundamentalRemark: `Abhi Mila Nahi (Ratios missing · NSE XBRL filing ${latestFilingDate} exists — run Collect)`,
          fundamentalSources,
          latestFilingDate,
        };
      }
      return {
        fundamentalFreshness: 'NOT_AVAILABLE',
        fundamentalAgeDays: null,
        fundamentalRemark: 'Abhi Mila Nahi (Not available on Screener.in / NSE XBRL / BSE yet)',
        fundamentalSources,
        latestFilingDate: '',
      };
    }

    const periodCandidates = [fund.epsCurrPeriod, fund.financialPeriodEnd].filter((d) =>
      this.isValidIsoDate(d)
    );
    periodCandidates.sort((a, b) => b.localeCompare(a));
    const bestPeriod = periodCandidates[0] || '';
    const ageDays = bestPeriod ? this.diffDaysBetween(refDateIso, bestPeriod) : null;

    const newerXbrlNote =
      latestXbrl?.financialPeriodEnd &&
      bestPeriod &&
      latestXbrl.financialPeriodEnd > bestPeriod
        ? ` · Newer NSE XBRL (${latestXbrl.financialPeriodEnd}) available`
        : '';

    const classified = classifyFundamentalFreshness({
      ageDays,
      maxDataAgeDays: this.thresholds.max_data_age_days,
      bestPeriod,
      sourcesLabel,
      newerXbrlNote,
    });

    return {
      fundamentalFreshness: classified.fundamentalFreshness,
      fundamentalAgeDays: classified.fundamentalAgeDays,
      fundamentalRemark: classified.fundamentalRemark,
      fundamentalSources,
      latestFilingDate,
    };
  }

  private emptyFundamentalProfile(symbol: string): FundamentalProfile {
    return {
      symbol,
      asOfDate: '',
      source: '',
      sourceUrl: '',
      financialPeriodEnd: '',
      publicationDate: '',
      publicationDateStatus: 'UNVERIFIED',
      officialFilingUrl: '',
      officialFilingSource: '',
      periodAlignmentStatus: 'UNVERIFIED',
      providerSector: '',
      revenueGrowthPct: null,
      profitGrowthPct: null,
      roePct: null,
      rocePct: null,
      debtToEquity: null,
      interestCoverage: null,
      operatingCashFlowInr: null,
      freeCashFlowInr: null,
      earningsQualityStatus: '',
      valuationStatus: '',
      trailingPE: null,
      priceToBook: null,
      marketCapInr: null,
      enterpriseValueInr: null,
      dividendYieldPct: null,
      promoterHoldingPct: null,
      fiiHoldingPct: null,
      diiHoldingPct: null,
      publicHoldingPct: null,
      epsPrev: null,
      epsCurr: null,
      epsPrevPeriod: '',
      epsCurrPeriod: '',
      epsTtmPrev: null,
      epsTtmCurr: null,
      coverage: 'MISSING',
      fundamentalFreshness: 'NOT_AVAILABLE',
      fundamentalAgeDays: null,
      fundamentalRemark: 'Abhi Mila Nahi (Not available on Screener.in / NSE XBRL / BSE yet)',
      fundamentalSources: [],
      latestFilingDate: '',
      lastUpdatedUtc: '',
      checks: [],
      passCount: 0,
      failCount: 0,
      missingCount: 7,
    };
  }

  private loadFundamentals(root: string): void {
    const file = path.join(root, 'data', 'inputs', 'fundamental_metrics.csv');
    if (!fs.existsSync(file)) return;
    const records = parseCsvRecords(fs.readFileSync(file, 'utf-8'));
    for (const r of records) {
      const sym = (r.TckrSymb || '').trim().toUpperCase();
      if (!sym) continue;
      const qPeriods = (r.IncomeQuarterPeriodsAvailable || '')
        .split(';')
        .map((p) => p.trim())
        .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
      if (qPeriods.some((p) => p <= '2025-07-01')) {
        this.multiYearCsvSymbols.add(sym);
      }
      const rawDeCsv = toNum(r.DebtToEquity);
      const rawIcCsv = toNum(r.InterestCoverage);
      const base: FundamentalProfile = {
        ...this.emptyFundamentalProfile(sym),
        asOfDate: r.AsOfDate || '',
        source: r.Source || '',
        sourceUrl: r.SourceURL || '',
        financialPeriodEnd: r.FinancialPeriodEnd || '',
        publicationDate: r.PublicationDate || '',
        publicationDateStatus: r.PublicationDateStatus || '',
        officialFilingUrl: r.OfficialFilingURL || '',
        officialFilingSource: r.OfficialFilingSource || '',
        periodAlignmentStatus: r.MetricPeriodAlignmentStatus || '',
        providerSector: r.ProviderSector || '',
        lastUpdatedUtc:
          r.DataRetrievedAtUTC || r.ValuationRetrievedAtUTC || r.AsOfDate || '',
        revenueGrowthPct: toNum(r.RevenueGrowthPct),
        profitGrowthPct: toNum(r.ProfitGrowthPct),
        roePct: toNum(r.ROEPercent),
        rocePct: toNum(r.ROCEPercent),
        debtToEquity: rawDeCsv !== null && rawDeCsv >= 0 ? rawDeCsv : null,
        interestCoverage: rawIcCsv !== null && rawIcCsv > 0.1 ? rawIcCsv : null,
        operatingCashFlowInr: toNum(r.OperatingCashFlowINR),
        freeCashFlowInr: toNum(r.FreeCashFlowINR),
        earningsQualityStatus: r.EarningsQualityStatus || '',
        valuationStatus: r.ValuationStatus || '',
        trailingPE: toNum(r.TrailingPE),
        priceToBook: toNum(r.PriceToBook),
        marketCapInr: toNum(r.MarketCapitalizationINR),
        enterpriseValueInr: toNum(r.EnterpriseValueINR),
        dividendYieldPct: toNum(r.DividendYieldPct),
        promoterHoldingPct: toNum(r.PromoterHoldingPct),
        fiiHoldingPct: toNum(r.FIIHoldingPct),
        diiHoldingPct: toNum(r.DIIHoldingPct),
        publicHoldingPct: toNum(r.PublicHoldingPct),
      };
      this.fundamentalsBySymbol.set(sym, this.recomputeChecks(base));
    }
  }

  private mergeFreeSourceCache(root: string): void {
    const file = path.join(root, 'data', 'research', 'fundamental_free_source_cache.csv');
    if (!fs.existsSync(file)) return;
    const records = parseCsvRecords(fs.readFileSync(file, 'utf-8'));
    const touched = new Set<string>();

    for (const r of records) {
      const sym = (r.Symbol || '').trim().toUpperCase();
      const metric = (r.Metric || '').trim();
      const val = toNum(r.Value);
      if (!sym || !metric || val === null) continue;

      let prof = this.fundamentalsBySymbol.get(sym);
      if (!prof) {
        prof = this.emptyFundamentalProfile(sym);
        prof.source = r.Provider || 'Free Source Cache';
        prof.sourceUrl = r.SourceURL || '';
        prof.financialPeriodEnd = r.FinancialPeriod || '';
        prof.asOfDate = (r.RetrievedAtUTC || '').slice(0, 10);
        prof.lastUpdatedUtc = r.RetrievedAtUTC || '';
      } else if (!prof.lastUpdatedUtc && r.RetrievedAtUTC) {
        prof.lastUpdatedUtc = r.RetrievedAtUTC;
      }

      let changed = false;
      if (metric === 'RevenueGrowthPct' && prof.revenueGrowthPct === null) {
        prof.revenueGrowthPct = val;
        changed = true;
      } else if (metric === 'ProfitGrowthPct' && prof.profitGrowthPct === null) {
        prof.profitGrowthPct = val;
        changed = true;
      } else if (metric === 'ROEPercent' && prof.roePct === null) {
        prof.roePct = val;
        changed = true;
      } else if (metric === 'ROCEPercent' && prof.rocePct === null) {
        prof.rocePct = val;
        changed = true;
      } else if (metric === 'DebtToEquity' && prof.debtToEquity === null) {
        prof.debtToEquity = val;
        changed = true;
      } else if (metric === 'InterestCoverage' && prof.interestCoverage === null) {
        prof.interestCoverage = val;
        changed = true;
      } else if (metric === 'PromoterHoldingPct' && prof.promoterHoldingPct === null) {
        prof.promoterHoldingPct = val;
        changed = true;
      } else if (metric === 'FIIHoldingPct' && prof.fiiHoldingPct === null) {
        prof.fiiHoldingPct = val;
        changed = true;
      } else if (metric === 'DIIHoldingPct' && prof.diiHoldingPct === null) {
        prof.diiHoldingPct = val;
        changed = true;
      } else if (metric === 'PublicHoldingPct' && prof.publicHoldingPct === null) {
        prof.publicHoldingPct = val;
        changed = true;
      }

      if (changed) {
        if (prof.source && !prof.source.includes('Free Cache') && r.Provider) {
          prof.source = `${prof.source} + ${r.Provider}`;
        }
        this.fundamentalsBySymbol.set(sym, prof);
        touched.add(sym);
      }
    }

    for (const sym of touched) {
      const prof = this.fundamentalsBySymbol.get(sym);
      if (prof) {
        this.fundamentalsBySymbol.set(sym, this.recomputeChecks(prof));
      }
    }
  }

  private mergeLiveOverrides(): void {
    const overrides = loadLiveFundamentalOverrides();
    for (const [rawSym, rec] of Object.entries(overrides)) {
      const sym = rawSym.trim().toUpperCase();
      const existing = this.fundamentalsBySymbol.get(sym) ?? this.emptyFundamentalProfile(sym);
      const isTrustedIndian = Boolean(
        rec.sources?.includes('Screener.in') || rec.sources?.includes('BSE Official')
      );
      const validRecDe =
        rec.debtToEquity !== null &&
        rec.debtToEquity !== undefined &&
        rec.debtToEquity >= 0 &&
        (isTrustedIndian || rec.debtToEquity > 0.005 || existing.debtToEquity === null)
          ? rec.debtToEquity
          : existing.debtToEquity;
      const validRecIc =
        rec.interestCoverage !== null &&
        rec.interestCoverage !== undefined &&
        (rec.interestCoverage > 0.1 || existing.interestCoverage === null)
          ? rec.interestCoverage
          : existing.interestCoverage;
      const mergedSources = isTrustedIndian
        ? Array.from(
            new Set([
              ...(existing.fundamentalSources || []).filter(
                (s) => s !== 'YFinance (.NS)' && s !== 'BSE (.BO)'
              ),
              ...(rec.sources || []),
            ])
          )
        : Array.from(
            new Set([...(existing.fundamentalSources || []), ...(rec.sources || [])])
          );
      const merged: FundamentalProfile = {
        ...existing,
        asOfDate: rec.asOfDate || existing.asOfDate,
        source: rec.source || existing.source,
        sourceUrl: rec.sourceUrl || existing.sourceUrl,
        financialPeriodEnd: rec.financialPeriodEnd || existing.financialPeriodEnd,
        publicationDate: rec.publicationDate || existing.publicationDate,
        officialFilingUrl: rec.officialFilingUrl || existing.officialFilingUrl,
        officialFilingSource: rec.officialFilingSource || existing.officialFilingSource,
        fundamentalSources: mergedSources,
        lastUpdatedUtc: rec.fetchedAtUtc || rec.asOfDate || existing.lastUpdatedUtc,
        providerSector: rec.providerSector || existing.providerSector,
        revenueGrowthPct: rec.revenueGrowthPct ?? existing.revenueGrowthPct,
        profitGrowthPct: rec.profitGrowthPct ?? existing.profitGrowthPct,
        roePct: rec.roePct ?? existing.roePct,
        rocePct: rec.rocePct ?? existing.rocePct,
        debtToEquity: validRecDe !== null && validRecDe >= 0 ? validRecDe : null,
        interestCoverage: validRecIc !== null && validRecIc > 0.1 ? validRecIc : null,
        operatingCashFlowInr: rec.operatingCashFlowInr ?? existing.operatingCashFlowInr,
        freeCashFlowInr: rec.freeCashFlowInr ?? existing.freeCashFlowInr,
        trailingPE: rec.trailingPE ?? existing.trailingPE,
        priceToBook: rec.priceToBook ?? existing.priceToBook,
        marketCapInr: rec.marketCapInr ?? existing.marketCapInr,
        enterpriseValueInr: rec.enterpriseValueInr ?? existing.enterpriseValueInr,
        dividendYieldPct: rec.dividendYieldPct ?? existing.dividendYieldPct,
        promoterHoldingPct: rec.promoterHoldingPct ?? existing.promoterHoldingPct,
        epsPrev: rec.epsPrev ?? existing.epsPrev,
        epsCurr: rec.epsCurr ?? existing.epsCurr,
        epsPrevPeriod: rec.epsPrevPeriod || existing.epsPrevPeriod,
        epsCurrPeriod: rec.epsCurrPeriod || existing.epsCurrPeriod,
        epsTtmPrev: rec.epsTtmPrev ?? existing.epsTtmPrev,
        epsTtmCurr: rec.epsTtmCurr ?? existing.epsTtmCurr,
        firstTradeDateIso: rec.firstTradeDateIso || existing.firstTradeDateIso,
        nextEarningsDate: rec.nextEarningsDate || existing.nextEarningsDate,
        companyName: rec.companyName || existing.companyName,
      };
      this.fundamentalsBySymbol.set(sym, this.recomputeChecks(merged));
    }
  }

  private mergeIndianFundamentalsCache(): void {
    const cache = loadIndianFundamentalsCache();
    for (const [rawSym, rec] of Object.entries(cache)) {
      if (!rec) continue;
      const sym = rawSym.trim().toUpperCase();
      const existing = this.fundamentalsBySymbol.get(sym) ?? this.emptyFundamentalProfile(sym);
      const mergedSources = Array.from(
        new Set([
          ...(existing.fundamentalSources || []).filter(
            (s) => s !== 'YFinance (.NS)' && s !== 'BSE (.BO)'
          ),
          ...(rec.sources || []),
        ])
      );
      const merged: FundamentalProfile = {
        ...existing,
        asOfDate: rec.asOfDate || existing.asOfDate,
        source: rec.source || existing.source,
        sourceUrl: rec.sourceUrl || existing.sourceUrl,
        financialPeriodEnd: rec.financialPeriodEnd || existing.financialPeriodEnd,
        publicationDate: rec.publicationDate || existing.publicationDate,
        officialFilingUrl: rec.officialFilingUrl || existing.officialFilingUrl,
        officialFilingSource: rec.officialFilingSource || existing.officialFilingSource,
        fundamentalSources: mergedSources,
        lastUpdatedUtc: rec.fetchedAtUtc || existing.lastUpdatedUtc,
        companyName: rec.companyName || existing.companyName,
        providerSector: rec.providerSector || existing.providerSector,
        nextEarningsDate: rec.nextEarningsDate || existing.nextEarningsDate,
        revenueGrowthPct: rec.revenueGrowthPct ?? existing.revenueGrowthPct,
        profitGrowthPct: rec.profitGrowthPct ?? existing.profitGrowthPct,
        roePct: rec.roePct ?? existing.roePct,
        rocePct: rec.rocePct ?? existing.rocePct,
        debtToEquity:
          rec.debtToEquity !== null && rec.debtToEquity >= 0
            ? rec.debtToEquity
            : existing.debtToEquity,
        interestCoverage:
          rec.interestCoverage !== null && rec.interestCoverage > 0
            ? rec.interestCoverage
            : existing.interestCoverage,
        operatingCashFlowInr: rec.operatingCashFlowInr ?? existing.operatingCashFlowInr,
        freeCashFlowInr: rec.freeCashFlowInr ?? existing.freeCashFlowInr,
        trailingPE: rec.trailingPE ?? existing.trailingPE,
        priceToBook: rec.priceToBook ?? existing.priceToBook,
        marketCapInr: rec.marketCapInr ?? existing.marketCapInr,
        enterpriseValueInr: rec.enterpriseValueInr ?? existing.enterpriseValueInr,
        dividendYieldPct: rec.dividendYieldPct ?? existing.dividendYieldPct,
        promoterHoldingPct: rec.promoterHoldingPct ?? existing.promoterHoldingPct,
        fiiHoldingPct: rec.fiiHoldingPct ?? existing.fiiHoldingPct,
        diiHoldingPct: rec.diiHoldingPct ?? existing.diiHoldingPct,
        publicHoldingPct: rec.publicHoldingPct ?? existing.publicHoldingPct,
        epsPrev: rec.epsPrev ?? existing.epsPrev,
        epsCurr: rec.epsCurr ?? existing.epsCurr,
        epsPrevPeriod: rec.epsPrevPeriod || existing.epsPrevPeriod,
        epsCurrPeriod: rec.epsCurrPeriod || existing.epsCurrPeriod,
        epsTtmPrev: rec.epsTtmPrev ?? existing.epsTtmPrev,
        epsTtmCurr: rec.epsTtmCurr ?? existing.epsTtmCurr,
      };
      this.fundamentalsBySymbol.set(sym, this.recomputeChecks(merged));
    }
  }

  private mergeScreenerShareholding(root: string): void {
    const file = path.join(root, 'data', 'research', 'bot_screener_cache.json');
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
          string,
          {
            latestPromoterPct?: number | null;
            latestFiiPct?: number | null;
            latestDiiPct?: number | null;
          }
        >;
        if (parsed && typeof parsed === 'object') {
          for (const [rawSym, rec] of Object.entries(parsed)) {
            const sym = rawSym.trim().toUpperCase();
            const prof = this.fundamentalsBySymbol.get(sym);
            if (!prof || !rec) continue;
            if (typeof rec.latestFiiPct === 'number' && Number.isFinite(rec.latestFiiPct)) {
              prof.fiiHoldingPct = prof.fiiHoldingPct ?? rec.latestFiiPct;
            }
            if (typeof rec.latestDiiPct === 'number' && Number.isFinite(rec.latestDiiPct)) {
              prof.diiHoldingPct = prof.diiHoldingPct ?? rec.latestDiiPct;
            }
            if (
              typeof rec.latestPromoterPct === 'number' &&
              Number.isFinite(rec.latestPromoterPct)
            ) {
              const sumWithExisting =
                (prof.promoterHoldingPct ?? 0) +
                (prof.fiiHoldingPct ?? 0) +
                (prof.diiHoldingPct ?? 0) +
                (prof.publicHoldingPct ?? 0);
              if (prof.promoterHoldingPct === null || sumWithExisting > 100.5) {
                prof.promoterHoldingPct = rec.latestPromoterPct;
              }
            }
          }
        }
      } catch {
        // non-fatal cache read failure
      }
    }

    // Reconcile total shareholding percentages <= 100%
    for (const prof of this.fundamentalsBySymbol.values()) {
      const prom = prof.promoterHoldingPct ?? 0;
      const fii = prof.fiiHoldingPct ?? 0;
      const dii = prof.diiHoldingPct ?? 0;
      const pub = prof.publicHoldingPct;
      if (pub !== null && prom + fii + dii + pub > 100.5) {
        prof.publicHoldingPct = Number(Math.max(0, 100 - prom - fii - dii).toFixed(2));
      }
    }
  }

  private loadXbrlFilings(root: string): void {
    const file = path.join(root, 'outputs', 'v8_official_financial_results_filings.csv');
    if (!fs.existsSync(file)) return;
    const records = parseCsvRecords(fs.readFileSync(file, 'utf-8'));
    this.xbrlTotalCount = records.length;
    for (const r of records) {
      const sym = (r.TckrSymb || '').trim().toUpperCase();
      if (!sym) continue;
      const item: XbrlFiling = {
        symbol: sym,
        financialPeriodEnd: r.FinancialPeriodEnd || '',
        publicationDate: r.PublicationDate || '',
        publicationDateStatus: r.PublicationDateStatus || '',
        filingDescription: r.FilingDescription || '',
        officialFilingUrl: r.OfficialFilingURL || '',
        officialSource: r.OfficialSource || '',
        retrievedAtUtc: r.RetrievedAtUTC || '',
      };
      const existing = this.xbrlBySymbol.get(sym);
      if (existing) existing.push(item);
      else this.xbrlBySymbol.set(sym, [item]);
    }
    for (const list of this.xbrlBySymbol.values()) {
      list.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate));
    }
  }

  private loadRawSignals(root: string): void {
    const file = path.join(root, 'data', 'signal_history', 'signal_log.csv');
    if (!fs.existsSync(file)) return;
    const records = parseCsvRecords(fs.readFileSync(file, 'utf-8'));
    const parsed: SignalLogEntry[] = [];
    for (const r of records) {
      const sym = (r.TckrSymb || '').trim().toUpperCase();
      if (!sym) continue;
      const stopDistancePct = toNum(r.StopDistancePct);
      const sectorStrengthStatus = r.SectorStrengthStatus || '';
      const marketRegimeStatus = r.MarketRegimeStatus || '';
      const trendClassification = r.TrendClassification || '';
      const setupType = r.SetupType || '';
      const v8Score = toNum(r.V8Score);
      const targetRiskReward = r['Target/RiskReward'] || '';
      const watchlistStatus = r.EODWatchlistStatus || '';

      const skipReasons: string[] = [];
      if (watchlistStatus !== 'WATCH') {
        if (sectorStrengthStatus && sectorStrengthStatus !== 'PASS') skipReasons.push(`Sector ${sectorStrengthStatus}`);
        if (marketRegimeStatus && marketRegimeStatus !== 'PASS') skipReasons.push(`Regime ${marketRegimeStatus}`);
        if (stopDistancePct !== null && stopDistancePct > 8) skipReasons.push('Stop > 8%');
        if (trendClassification.includes('Bearish')) skipReasons.push('Bearish Trend');
        if (setupType === 'No Clear Setup') skipReasons.push('No Setup');
        const rrMatch = targetRiskReward.match(/\/\s*([\d.]+)R/);
        if (rrMatch && Number(rrMatch[1]) < 1.5) skipReasons.push('R:R < 1.5');
        if (v8Score !== null && v8Score < 70) skipReasons.push('Score < 70');
        if (watchlistStatus === 'WAIT_FOR_DATA') skipReasons.push('Risk Config WAIT_FOR_DATA');
      }

      const entry: SignalLogEntry = {
        eodDate: r.EODDate || '',
        symbol: sym,
        watchlistStatus,
        deliveryCategory: r.DeliveryCategory || '',
        liquidityTier: r.LiquidityTier || '',
        rvol: toNum(r.RVOL),
        setupType,
        trendClassification,
        relativeStrengthNifty: toNum(r.RelativeStrengthNifty),
        v8Score,
        entryZoneLow: toNum(r.EntryZoneLow),
        entryZoneHigh: toNum(r.EntryZoneHigh),
        stopLoss: toNum(r.StopLoss),
        targetRiskReward,
        stopDistancePct,
        sectorStrengthStatus,
        marketRegimeStatus,
        closePrice: toNum(r.ClsPric),
        evalSessionsAfter: 0,
        evalReturnPct: null,
        evalMfePct: null,
        evalMaePct: null,
        skipReasons,
      };
      parsed.push(entry);
      const symList = this.signalsBySymbol.get(sym);
      if (symList) symList.push(entry);
      else this.signalsBySymbol.set(sym, [entry]);
    }
    parsed.sort((a, b) => {
      const d = b.eodDate.localeCompare(a.eodDate);
      if (d !== 0) return d;
      return (b.v8Score ?? -999) - (a.v8Score ?? -999);
    });
    this.signals = parsed;
    for (const list of this.signalsBySymbol.values()) {
      list.sort((a, b) => b.eodDate.localeCompare(a.eodDate));
    }
  }

  private isEtfOrFundSymbol(sym: string, companyName = ''): boolean {
    const cname = (companyName || '').trim();
    if (
      /\b(etf|exchange traded|mutual fund|index fund|liquid fund|bharat bond|fof|fund of funds)\b/i.test(
        cname
      ) ||
      /^(icicipramc|utiamc|dspamc|miraeamc|nipponind|kotakmamc|hdfcamc|sbiamc|motilal|edelweiss|axisamc|tataamc|adityabirla|bajaj|growwamc)\s*[-–]/i.test(
        cname
      )
    ) {
      return true;
    }
    if (
      /(BEES|IETF|LIQID|NIFTYBETA|GOLDETF|SILVERETF|GILT\d+BETA|BHARAT22)$/i.test(sym) ||
      /^(NV20|SELECTIPO|MOIPO|NETF|SETF|EBBETF|IVZ(GOLD|SILVER|SENSEX|NIFTY)|GROWW(LIQID|GOLD|NIFTY|RAIL|EV|DEF|SLV|GLD)|MOM100|MON100|MONQ50|MAFANG|MASPTOP50|NIF100BEES|MIDCAPETF|MONIFTY)/i.test(
        sym
      ) ||
      /(GOLD|SILVER|NIFTY|SENSEX|PSUBANK|PVTBANK|IT|BANK|GSEC|SDL)ADD$/i.test(sym)
    ) {
      return true;
    }
    return false;
  }

  private pickFutureDate(dateStr: string | undefined, refIso: string): string {
    if (!dateStr || !this.isValidIsoDate(dateStr)) return '';
    return dateStr >= refIso ? dateStr : '';
  }

  private computeDeliveryAtSlice(
    seriesSlice: DailyBhavRow[],
    asOfDate: string,
    isIpo: boolean
  ): {
    deliveryCategory: DeliveryCategory;
    rolling5dGt60Count: number;
    dailyGt60Count: number;
    valid30dCount: number;
  } {
    const asOfMs = Date.parse(`${asOfDate}T00:00:00Z`);
    const cutoff30dMs = Number.isFinite(asOfMs) ? asOfMs - 29 * 24 * 60 * 60 * 1000 : 0;
    const window30d = seriesSlice.filter((d) => {
      const ms = Date.parse(`${d.date}T00:00:00Z`);
      return ms >= cutoff30dMs && d.delivPer !== null;
    });

    let dailyGt60Count = 0;
    let rolling5dGt60Count = 0;
    for (let i = 0; i < window30d.length; i++) {
      if ((window30d[i].delivPer ?? 0) >= 60.0) dailyGt60Count++;
      if (i >= 4) {
        const avg5 =
          ((window30d[i - 4].delivPer ?? 0) +
            (window30d[i - 3].delivPer ?? 0) +
            (window30d[i - 2].delivPer ?? 0) +
            (window30d[i - 1].delivPer ?? 0) +
            (window30d[i].delivPer ?? 0)) /
          5;
        if (avg5 >= 60.0) rolling5dGt60Count++;
      }
    }

    let deliveryCategory: DeliveryCategory = 'NONE';
    if (window30d.length < 5) {
      if (isIpo && window30d.length >= 2) {
        const avgDelivShort =
          window30d.reduce((acc, d) => acc + (d.delivPer ?? 0), 0) / window30d.length;
        const passA = avgDelivShort >= 60.0;
        const passB = dailyGt60Count >= Math.ceil(window30d.length * 0.6);
        if (passA && passB) deliveryCategory = 'A_AND_B';
        else if (passA) deliveryCategory = 'A_ONLY';
        else if (passB) deliveryCategory = 'B_ONLY';
      } else {
        deliveryCategory = 'WAIT_FOR_DATA';
      }
    } else {
      const passA = rolling5dGt60Count >= 5;
      const passB = dailyGt60Count >= 5;
      if (passA && passB) deliveryCategory = 'A_AND_B';
      else if (passA) deliveryCategory = 'A_ONLY';
      else if (passB) deliveryCategory = 'B_ONLY';
    }

    return {
      deliveryCategory,
      rolling5dGt60Count,
      dailyGt60Count,
      valid30dCount: window30d.length,
    };
  }

  private computeDynamicStreak(seriesHistory: DailyBhavRow[], isIpo: boolean): {
    consecutiveStreak: number;
    totalQualifyingSessions: number;
    firstStreakDate: string;
    deliveryStatus: string;
  } {
    const isAB = (c: DeliveryCategory) =>
      c === 'A_AND_B' || c === 'A_ONLY' || c === 'B_ONLY';

    let totalQualifyingSessions = 0;
    let consecutiveStreak = 0;
    let firstStreakDate = '';
    let streakOpen = true;
    let latestCat: DeliveryCategory = 'NONE';

    for (let i = seriesHistory.length - 1; i >= 0; i--) {
      const slice = seriesHistory.slice(0, i + 1);
      const res = this.computeDeliveryAtSlice(slice, seriesHistory[i].date, isIpo);
      if (i === seriesHistory.length - 1) latestCat = res.deliveryCategory;
      if (isAB(res.deliveryCategory)) {
        totalQualifyingSessions++;
        if (streakOpen) {
          consecutiveStreak++;
          firstStreakDate = seriesHistory[i].date;
        }
      } else {
        streakOpen = false;
      }
    }

    const deliveryStatus = isAB(latestCat)
      ? consecutiveStreak > 1
        ? `ACTIVE_STREAK_${consecutiveStreak}D`
        : 'NEW_QUALIFIER'
      : latestCat;

    return {
      consecutiveStreak,
      totalQualifyingSessions,
      firstStreakDate,
      deliveryStatus,
    };
  }

  private generateSignalsForMissingSessions(): void {
    if (this.sessionDates.length === 0) return;
    let maxCsvDate = '';
    for (const s of this.signals) {
      if (s.eodDate > maxCsvDate) maxCsvDate = s.eodDate;
    }
    const missingDates = this.sessionDates.filter((d) => !maxCsvDate || d > maxCsvDate);
    if (missingDates.length === 0) return;

    const generated: SignalLogEntry[] = [];

    for (const eodDate of missingDates) {
      // Compute market breadth & sector breadth strictly from Bhavcopy rows on eodDate
      let marketAdv = 0;
      let marketDec = 0;
      const sectorStats = new Map<
        string,
        { adv: number; dec: number; ret5dSum: number; ret5dCount: number }
      >();

      for (const [sym, fullHistory] of this.historyBySymbol.entries()) {
        const fund = this.fundamentalsBySymbol.get(sym);
        if (this.isEtfOrFundSymbol(sym, fund?.companyName || '')) continue;
        const idx = fullHistory.findIndex((h) => h.date === eodDate);
        if (idx < 0) continue;
        const bar = fullHistory[idx];
        if (bar.close === null || bar.close <= 0) continue;
        const chg =
          bar.prevClose && bar.prevClose > 0
            ? ((bar.close - bar.prevClose) / bar.prevClose) * 100
            : null;
        if (chg !== null) {
          if (chg > 0.05) marketAdv++;
          else if (chg < -0.05) marketDec++;
        }

        const sec = (fund?.providerSector || '').trim().toUpperCase();
        if (sec) {
          const st = sectorStats.get(sec) || { adv: 0, dec: 0, ret5dSum: 0, ret5dCount: 0 };
          if (chg !== null) {
            if (chg > 0.05) st.adv++;
            else if (chg < -0.05) st.dec++;
          }
          if (idx >= 5 && fullHistory[idx - 5]?.close && (fullHistory[idx - 5].close as number) > 0) {
            st.ret5dSum += ((bar.close - (fullHistory[idx - 5].close as number)) / (fullHistory[idx - 5].close as number)) * 100;
            st.ret5dCount++;
          }
          sectorStats.set(sec, st);
        }
      }

      const marketAd = marketAdv + marketDec;
      const marketBreadthPct = marketAd > 0 ? (marketAdv / marketAd) * 100 : 50;
      const marketRegimeStatus = marketBreadthPct >= 42 ? 'PASS' : 'FAIL';

      for (const [sym, fullHistory] of this.historyBySymbol.entries()) {
        const fund = this.fundamentalsBySymbol.get(sym);
        if (this.isEtfOrFundSymbol(sym, fund?.companyName || '')) continue;
        const hist = fullHistory.filter((h) => h.date <= eodDate);
        const latest = hist[hist.length - 1];
        if (!latest || latest.date !== eodDate || latest.close === null || latest.close <= 0) {
          continue;
        }

        const scrRow = this.screenerBySymbol.get(sym);
        const isIpo = scrRow?.isIpo ?? false;
        const seriesHistory = hist.filter((d) => d.series === latest.series);
        const delivInfo = this.computeDeliveryAtSlice(seriesHistory, eodDate, isIpo);
        const isDeliveryAB =
          delivInfo.deliveryCategory === 'A_AND_B' ||
          delivInfo.deliveryCategory === 'A_ONLY' ||
          delivInfo.deliveryCategory === 'B_ONLY';

        const minLiqLookback = isIpo ? 2 : 20;
        if (hist.length < minLiqLookback) continue;
        const liqWindow = hist.slice(-20);
        const avgTurnover20DCr =
          liqWindow.reduce((acc, s) => acc + s.turnoverLacs, 0) / liqWindow.length / 100;
        if (avgTurnover20DCr < 1.5) continue;

        const liquidityTier: LiquidityTier =
          avgTurnover20DCr >= 10 ? 'STRONG' : avgTurnover20DCr >= 3 ? 'MODERATE' : 'LOW';

        const priorSessions = hist.slice(0, -1);
        const rvol = calculateLatestRvol(
          hist.map((s) => s.volume),
          20
        );
        let delivQtyRatio: number | null = null;
        if (priorSessions.length >= 2) {
          const prevWindow = priorSessions.slice(-20);
          const prevDeliv = prevWindow
            .map((s) => s.delivQty)
            .filter((q): q is number => q !== null && q > 0);
          const minDelivCount = isIpo ? 2 : 10;
          if (prevDeliv.length >= minDelivCount && latest.delivQty !== null) {
            const avgDelivQty = prevDeliv.reduce((a, b) => a + b, 0) / prevDeliv.length;
            if (avgDelivQty > 0) delivQtyRatio = latest.delivQty / avgDelivQty;
          }
        }

        const isHighRvol = rvol !== null && rvol > 1.5;
        if (!isDeliveryAB && !isHighRvol) continue;

        const closes = hist.map((d) => d.close);
        const ema21Period = closes.length >= 21 ? 21 : Math.max(3, closes.length);
        const ema21Series = this.computeEmaSeries(closes, ema21Period);
        const ema21 = ema21Series[ema21Series.length - 1] ?? null;
        const aboveEma21 = ema21 !== null ? latest.close > ema21 : false;

        const rsi14 =
          closes.length >= 15
            ? this.computeRsi14(closes, 14)
            : isIpo && closes.length >= 4
              ? this.computeRsi14(closes, closes.length - 1)
              : null;
        const atr14 =
          hist.length >= 15
            ? this.computeAtr14(hist, 14)
            : isIpo && hist.length >= 3
              ? this.computeAtr14(hist, Math.max(2, hist.length - 1))
              : null;

        const changePct =
          latest.prevClose && latest.prevClose > 0
            ? ((latest.close - latest.prevClose) / latest.prevClose) * 100
            : null;
        const highsWindow = hist.map((d) => d.high ?? d.close ?? 0).filter((h) => h > 0);
        const maxHigh = highsWindow.length > 0 ? Math.max(...highsWindow) : null;
        const distFromHighPct =
          maxHigh && maxHigh > 0 ? ((latest.close - maxHigh) / maxHigh) * 100 : null;

        const secKey = (fund?.providerSector || '').trim().toUpperCase();
        const secSt = secKey ? sectorStats.get(secKey) : undefined;
        let sectorStrengthStatus = 'PASS';
        if (secSt) {
          const secAd = secSt.adv + secSt.dec;
          const secBreadth = secAd > 0 ? (secSt.adv / secAd) * 100 : 50;
          const secRet5d = secSt.ret5dCount > 0 ? secSt.ret5dSum / secSt.ret5dCount : 0;
          sectorStrengthStatus = secBreadth >= 45 || secRet5d > 0 ? 'PASS' : 'FAIL';
        }

        let setupType = 'No Clear Setup';
        if (
          (changePct ?? 0) > 1.0 &&
          isHighRvol &&
          aboveEma21 &&
          (distFromHighPct ?? -99) >= -3.5
        ) {
          setupType = 'Breakout';
        } else if (isDeliveryAB && (delivQtyRatio ?? 0) >= 1.2 && aboveEma21) {
          setupType = 'Delivery Accumulation';
        } else if (aboveEma21 && (rsi14 ?? 50) >= 45 && (rsi14 ?? 50) <= 68 && (changePct ?? 0) >= 0) {
          setupType = 'Pullback Entry';
        } else if ((changePct ?? 0) < 0 && isHighRvol) {
          setupType = 'Possible Pullback';
        }

        const trendClassification = aboveEma21
          ? 'Bullish (Close > EMA21)'
          : 'Bearish (Close < EMA21)';

        const entryZoneLow = Number((latest.close * 0.99).toFixed(2));
        const entryZoneHigh = Number((latest.close * 1.005).toFixed(2));
        const stopLoss =
          atr14 !== null
            ? Math.max(0.05, Number((latest.close - 1.5 * atr14).toFixed(2)))
            : Number((latest.close * 0.94).toFixed(2));
        const riskPerShare = Math.max(0.05, latest.close - stopLoss);
        const stopDistancePct = Number(((riskPerShare / latest.close) * 100).toFixed(2));
        const targetPrice = Number((latest.close + 2 * riskPerShare).toFixed(2));
        const targetRiskReward = `${targetPrice.toFixed(2)} / 2.0R`;

        let score = 0;
        if (delivInfo.deliveryCategory === 'A_AND_B') score += 25;
        else if (isDeliveryAB) score += 18;
        if (liquidityTier === 'STRONG') score += 15;
        else if (liquidityTier === 'MODERATE') score += 12;
        else score += 8;
        if (aboveEma21) score += 15;
        if (rsi14 !== null && rsi14 >= 45 && rsi14 <= 78) score += 10;
        if (rvol !== null && rvol > 2.0) score += 15;
        else if (rvol !== null && rvol > 1.5) score += 10;
        if ((delivQtyRatio ?? 0) >= 1.5) score += 10;
        else if ((delivQtyRatio ?? 0) >= 1.2) score += 6;
        if (sectorStrengthStatus === 'PASS') score += 5;
        if (marketRegimeStatus === 'PASS') score += 5;
        const v8Score = Math.min(100, Math.round(score));

        const skipReasons: string[] = [];
        if (sectorStrengthStatus !== 'PASS') skipReasons.push(`Sector ${sectorStrengthStatus}`);
        if (marketRegimeStatus !== 'PASS') skipReasons.push(`Regime ${marketRegimeStatus}`);
        if (stopDistancePct > 8) skipReasons.push('Stop > 8%');
        if (!aboveEma21) skipReasons.push('Bearish Trend');
        if (setupType === 'No Clear Setup') skipReasons.push('No Setup');
        if (!isDeliveryAB) skipReasons.push('No Deliv A/B');
        if (!isHighRvol) skipReasons.push('RVOL <= 1.5x');
        if (v8Score < 70) skipReasons.push('Score < 70');

        const watchlistStatus =
          skipReasons.length === 0 && v8Score >= 70 && isDeliveryAB ? 'WATCH' : 'SKIP';

        generated.push({
          eodDate,
          symbol: sym,
          watchlistStatus,
          deliveryCategory: delivInfo.deliveryCategory,
          liquidityTier,
          rvol: rvol !== null ? Number(rvol.toFixed(2)) : null,
          setupType,
          trendClassification,
          relativeStrengthNifty: null,
          v8Score,
          entryZoneLow,
          entryZoneHigh,
          stopLoss,
          targetRiskReward,
          stopDistancePct,
          sectorStrengthStatus,
          marketRegimeStatus,
          closePrice: latest.close,
          evalSessionsAfter: 0,
          evalReturnPct: null,
          evalMfePct: null,
          evalMaePct: null,
          skipReasons,
        });
      }
    }

    const merged = [...generated, ...this.signals].filter((s) =>
      !this.isEtfOrFundSymbol(s.symbol, this.fundamentalsBySymbol.get(s.symbol)?.companyName || '')
    );
    merged.sort((a, b) => {
      const d = b.eodDate.localeCompare(a.eodDate);
      if (d !== 0) return d;
      const wDiff = (b.watchlistStatus === 'WATCH' ? 1 : 0) - (a.watchlistStatus === 'WATCH' ? 1 : 0);
      if (wDiff !== 0) return wDiff;
      return (b.v8Score ?? -999) - (a.v8Score ?? -999);
    });
    this.signals = merged;
    this.signalsBySymbol.clear();
    for (const entry of merged) {
      const list = this.signalsBySymbol.get(entry.symbol);
      if (list) list.push(entry);
      else this.signalsBySymbol.set(entry.symbol, [entry]);
    }
  }

  private attachLatestSignalsToScreener(): void {
    for (const row of this.screenerRows) {
      const latestSignal = this.signalsBySymbol.get(row.symbol)?.[0] ?? null;
      row.latestSignalSetup = latestSignal?.setupType ?? null;
      row.latestV8Score = latestSignal?.v8Score ?? null;
    }
  }

  private evaluateSignalOutcomes(): void {
    let evaluatedCount = 0;
    let positiveReturnCount = 0;
    let sumRet = 0;
    let sumMfe = 0;
    let sumMae = 0;
    const reasonCounts = new Map<string, number>();

    for (const sig of this.signals) {
      for (const reason of sig.skipReasons) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }

      const hist = this.historyBySymbol.get(sig.symbol);
      const baseClose = sig.closePrice;
      if (!hist || !baseClose || baseClose <= 0) continue;

      const future = hist.filter((d) => d.date > sig.eodDate && d.close !== null);
      if (future.length === 0) continue;

      sig.evalSessionsAfter = future.length;
      const latestClose = future[future.length - 1].close as number;
      sig.evalReturnPct = ((latestClose - baseClose) / baseClose) * 100;

      const highs = future.map((d) => d.high ?? d.close ?? baseClose);
      const lows = future.map((d) => d.low ?? d.close ?? baseClose);
      const maxHigh = Math.max(...highs);
      const minLow = Math.min(...lows);
      sig.evalMfePct = ((maxHigh - baseClose) / baseClose) * 100;
      sig.evalMaePct = ((minLow - baseClose) / baseClose) * 100;

      evaluatedCount++;
      if (sig.evalReturnPct > 0) positiveReturnCount++;
      sumRet += sig.evalReturnPct;
      sumMfe += sig.evalMfePct;
      sumMae += sig.evalMaePct;
    }

    const rejectionBreakdown = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    this.signalSummaryStats = {
      total: this.signals.length,
      evaluatedCount,
      positiveReturnCount,
      winRatePct: evaluatedCount > 0 ? (positiveReturnCount / evaluatedCount) * 100 : null,
      avgReturnPct: evaluatedCount > 0 ? sumRet / evaluatedCount : null,
      avgMfePct: evaluatedCount > 0 ? sumMfe / evaluatedCount : null,
      avgMaePct: evaluatedCount > 0 ? sumMae / evaluatedCount : null,
      rejectionBreakdown,
    };
  }

  private computeEmaSeries(closes: ReadonlyArray<NumericInput>, period: number): Array<number | null> {
    return calculateEmaSeries(closes, period);
  }

  private computeRsi14(closes: ReadonlyArray<NumericInput>, period = 14): number | null {
    return calculateLatestWilderRsi(closes, period);
  }

  private computeAtr14(history: DailyBhavRow[], period = 14): number | null {
    if (history.length < period + 1) return null;
    const trs: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const curr = history[i];
      const prevClose = history[i - 1].close ?? curr.prevClose;
      if (curr.high === null || curr.low === null || prevClose === null) continue;
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prevClose),
        Math.abs(curr.low - prevClose)
      );
      trs.push(tr);
    }
    if (trs.length < period) return null;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  private loadBhavcopiesAndBuildScreener(root: string, streakMap: Map<string, StreakInfo>): void {
    const dir = path.join(root, 'data', 'cache', 'delivery');
    if (!fs.existsSync(dir)) return;

    const files = fs
      .readdirSync(dir)
      .filter((f) => /^sec_bhavdata_full_\d{8}\.csv$/.test(f))
      .map((f) => {
        const m = f.match(/(\d{2})(\d{2})(\d{4})/);
        return {
          f,
          iso: m ? `${m[3]}-${m[2]}-${m[1]}` : f,
        };
      })
      .sort((a, b) => a.iso.localeCompare(b.iso));

    this.sessionDates = files.map((x) => x.iso);
    this.latestSessionDate = files[files.length - 1]?.iso || '';

    const ALLOWED_SERIES = new Set(['EQ', 'BE', 'BZ']);

    for (const { f, iso } of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      const lines = content.split(/\r?\n/);
      if (lines.length < 2) continue;

      const headerCols = lines[0].split(',').map((h) => h.trim());
      const idx = {
        SYMBOL: headerCols.indexOf('SYMBOL'),
        SERIES: headerCols.indexOf('SERIES'),
        DATE1: headerCols.indexOf('DATE1'),
        PREV_CLOSE: headerCols.indexOf('PREV_CLOSE'),
        OPEN_PRICE: headerCols.indexOf('OPEN_PRICE'),
        HIGH_PRICE: headerCols.indexOf('HIGH_PRICE'),
        LOW_PRICE: headerCols.indexOf('LOW_PRICE'),
        CLOSE_PRICE: headerCols.indexOf('CLOSE_PRICE'),
        AVG_PRICE: headerCols.indexOf('AVG_PRICE'),
        TTL_TRD_QNTY: headerCols.indexOf('TTL_TRD_QNTY'),
        TURNOVER_LACS: headerCols.indexOf('TURNOVER_LACS'),
        NO_OF_TRADES: headerCols.indexOf('NO_OF_TRADES'),
        DELIV_QTY: headerCols.indexOf('DELIV_QTY'),
        DELIV_PER: headerCols.indexOf('DELIV_PER'),
      };

      const seenToday = new Map<string, DailyBhavRow>();
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.trim() === '') continue;
        const cols = line.split(',');
        const sym = (cols[idx.SYMBOL] || '').trim().toUpperCase();
        const series = (cols[idx.SERIES] || '').trim().toUpperCase();
        if (!sym || !ALLOWED_SERIES.has(series)) continue;

        const prev = seenToday.get(sym);
        if (prev && prev.series === 'EQ') continue;

        const row: DailyBhavRow = {
          date: idx.DATE1 >= 0 && cols[idx.DATE1] ? parseBhavDateToIso(cols[idx.DATE1]) : iso,
          symbol: sym,
          series,
          prevClose: toNum(cols[idx.PREV_CLOSE]),
          open: toNum(cols[idx.OPEN_PRICE]),
          high: toNum(cols[idx.HIGH_PRICE]),
          low: toNum(cols[idx.LOW_PRICE]),
          close: toNum(cols[idx.CLOSE_PRICE]),
          avgPrice: toNum(cols[idx.AVG_PRICE]),
          volume: toNum(cols[idx.TTL_TRD_QNTY]) ?? 0,
          turnoverLacs: toNum(cols[idx.TURNOVER_LACS]) ?? 0,
          trades: toNum(cols[idx.NO_OF_TRADES]) ?? 0,
          delivQty: toNum(cols[idx.DELIV_QTY]),
          delivPer: toNum(cols[idx.DELIV_PER]),
        };
        seenToday.set(sym, row);
      }

      for (const [sym, row] of seenToday.entries()) {
        const list = this.historyBySymbol.get(sym);
        if (list) list.push(row);
        else this.historyBySymbol.set(sym, [row]);
      }
    }

    const ipoCutoffDate = this.sessionDates.length > 3 ? this.sessionDates[3] : '';

    const rows: ScreenerRow[] = [];

    for (const [sym, history] of this.historyBySymbol.entries()) {
      const latest = history[history.length - 1];
      if (!latest || latest.date !== this.latestSessionDate || latest.close === null) continue;
      const fundPreCheck = this.fundamentalsBySymbol.get(sym);
      if (this.isEtfOrFundSymbol(sym, fundPreCheck?.companyName || '')) continue;
      const streak = streakMap.get(sym);

      const bhavListingDate = history[0]?.date || '';
      const sessionsCount = history.length;
      const fundPre = fundPreCheck;
      const refIsoForIpo = this.latestSessionDate || toIstDateIso();
      const hasKnownFirstTrade = Boolean(
        fundPre?.firstTradeDateIso && this.isValidIsoDate(fundPre.firstTradeDateIso)
      );
      const listingDate = hasKnownFirstTrade
        ? (fundPre!.firstTradeDateIso as string)
        : bhavListingDate;

      const xbrlListForIpo = this.xbrlBySymbol.get(sym) ?? [];
      let hasOldXbrlHistory = false;
      for (const xf of xbrlListForIpo) {
        const pd = this.isValidIsoDate(xf.financialPeriodEnd)
          ? xf.financialPeriodEnd
          : this.isValidIsoDate(xf.publicationDate)
            ? xf.publicationDate
            : '';
        if (pd) {
          const pdAge = this.diffDaysBetween(refIsoForIpo, pd);
          if (pdAge !== null && pdAge > 450) {
            hasOldXbrlHistory = true;
            break;
          }
        }
      }
      const isSeasonedCompany = hasOldXbrlHistory || this.multiYearCsvSymbols.has(sym);

      const knownFirstTradeAge = hasKnownFirstTrade
        ? this.diffDaysBetween(refIsoForIpo, fundPre!.firstTradeDateIso as string)
        : null;
      const isRecentBhavIpo = Boolean(
        !sym.endsWith('-RE') &&
          !hasKnownFirstTrade &&
          !isSeasonedCompany &&
          ipoCutoffDate &&
          bhavListingDate >= ipoCutoffDate &&
          sessionsCount <= 15
      );
      const ipoAgeDays =
        hasKnownFirstTrade || isRecentBhavIpo
          ? this.diffDaysBetween(refIsoForIpo, listingDate)
          : null;
      const isIpo = Boolean(
        !sym.endsWith('-RE') &&
          !isSeasonedCompany &&
          ((knownFirstTradeAge !== null && knownFirstTradeAge <= 365) || isRecentBhavIpo)
      );

      // Filter history strictly to latest's series for delivery integrity
      const seriesHistory = history.filter((d) => d.series === latest.series);
      const delivSlice = this.computeDeliveryAtSlice(seriesHistory, this.latestSessionDate, isIpo);
      const rolling5dGt60Count = delivSlice.rolling5dGt60Count;
      const dailyGt60Count = delivSlice.dailyGt60Count;
      const valid30dCount = delivSlice.valid30dCount;
      const computedCategory = delivSlice.deliveryCategory;

      // Use streak file only if latestSessionDate matches streak's LastScanDate; otherwise compute dynamically across all sessions
      const useStaticStreak = this.latestSessionDate === '2026-11-13';
      const dynamicStreak = useStaticStreak
        ? null
        : this.computeDynamicStreak(seriesHistory, isIpo);

      const streakCat = streak?.lastCategory;
      let deliveryCategory: DeliveryCategory = computedCategory;
      if (
        useStaticStreak &&
        (streakCat === 'A_AND_B' ||
          streakCat === 'A_ONLY' ||
          streakCat === 'B_ONLY' ||
          streakCat === 'NONE' ||
          streakCat === 'WAIT_FOR_DATA')
      ) {
        deliveryCategory = streakCat;
      }

      const validDelivTail = seriesHistory
        .filter((d) => d.delivPer !== null)
        .slice(-5)
        .map((d) => d.delivPer as number);
      const avgDeliv5D =
        useStaticStreak && streak?.lastAvgDelivery5D !== null && streak?.lastAvgDelivery5D !== undefined
          ? streak.lastAvgDelivery5D
          : validDelivTail.length === 5 || (isIpo && validDelivTail.length >= 2)
            ? validDelivTail.reduce((acc, n) => acc + n, 0) / validDelivTail.length
            : null;

      // 20-Session RVOL (requires >=21 sessions: 20 prior sessions + 1 current session)
      const priorSessions = history.slice(0, -1);
      const rvol = calculateLatestRvol(
        history.map((s) => s.volume),
        20
      );
      const rvolBand: RvolBand =
        rvol === null ? 'WAIT_FOR_DATA' : rvol > 1.5 ? 'HIGH' : 'LOW';
      let delivQtyRatio: number | null = null;
      const minDelivLookback = isIpo ? 2 : 20;
      if (priorSessions.length >= minDelivLookback) {
        const prevWindow = priorSessions.slice(-20);
        const prevDeliv = prevWindow
          .map((s) => s.delivQty)
          .filter((q): q is number => q !== null && q > 0);
        const minDelivCount = isIpo ? 2 : 10;
        if (prevDeliv.length >= minDelivCount && latest.delivQty !== null) {
          const avgDelivQty = prevDeliv.reduce((a, b) => a + b, 0) / prevDeliv.length;
          if (avgDelivQty > 0) {
            delivQtyRatio = latest.delivQty / avgDelivQty;
          }
        }
      }

      const delivValueCr =
        latest.delivQty !== null && latest.close !== null
          ? (latest.delivQty * latest.close) / 1e7
          : null;

      // 20-Session Liquidity Check (adaptive >=2 sessions for IPO stocks)
      let avgTurnover20DCr: number | null = null;
      let liquidityTier: LiquidityTier = 'WAIT_FOR_DATA';
      let liquidityPass = false;
      const minLiqLookback = isIpo ? 2 : 20;
      if (history.length >= minLiqLookback) {
        const liqWindow = history.slice(-20);
        const avgLacs = liqWindow.reduce((acc, s) => acc + s.turnoverLacs, 0) / liqWindow.length;
        avgTurnover20DCr = avgLacs / 100;
        if (avgTurnover20DCr >= 10) {
          liquidityTier = 'STRONG';
          liquidityPass = true;
        } else if (avgTurnover20DCr >= 3) {
          liquidityTier = 'MODERATE';
          liquidityPass = true;
        } else if (avgTurnover20DCr >= 1.5) {
          liquidityTier = 'LOW';
          liquidityPass = true;
        } else {
          liquidityTier = 'BELOW_MIN';
          liquidityPass = false;
        }
      }

      // Technical Swing Indicators: SMA20, EMA21 (adaptive for IPOs), RSI14, ATR14, 35D High proximity, Up/Down Vol Ratio
      const closes = history.map((d) => d.close);
      const validClosesTail = closes.filter((c): c is number => c !== null && Number.isFinite(c));
      let sma20: number | null = null;
      let aboveSma20: boolean | null = null;
      if (validClosesTail.length >= 20) {
        sma20 = validClosesTail.slice(-20).reduce((a, b) => a + b, 0) / 20;
        aboveSma20 = latest.close > sma20;
      } else if (isIpo && validClosesTail.length >= 3) {
        sma20 = validClosesTail.reduce((a, b) => a + b, 0) / validClosesTail.length;
        aboveSma20 = latest.close > sma20;
      }

      const emaPeriod = closes.length >= 21 ? 21 : isIpo && closes.length >= 3 ? closes.length : 21;
      const ema21Series = this.computeEmaSeries(closes, emaPeriod);
      const ema21 = ema21Series[ema21Series.length - 1] ?? null;
      const aboveEma21 = ema21 !== null ? latest.close > ema21 : null;

      const ema21FullSeries = closes.length >= 21 ? this.computeEmaSeries(closes, 21) : [];
      const ema44Series = closes.length >= 44 ? this.computeEmaSeries(closes, 44) : [];
      const ema44 = ema44Series.length > 0 ? (ema44Series[ema44Series.length - 1] ?? null) : null;
      const aboveEma44 = ema44 !== null ? latest.close > ema44 : null;
      const ema200 = this.yahooEma200BySymbol.get(sym) ?? null;
      const aboveEma200 = ema200 !== null ? latest.close > ema200 : null;
      const ema21Strict =
        ema21FullSeries.length > 0 ? (ema21FullSeries[ema21FullSeries.length - 1] ?? null) : null;
      const ema21AboveEma44 =
        ema21Strict !== null && ema44 !== null ? ema21Strict > ema44 : null;
      let ema21Cross44DaysAgo: number | null = null;
      if (ema21AboveEma44 === true && ema21FullSeries.length === closes.length && ema44Series.length === closes.length) {
        const lastI = closes.length - 1;
        for (let offset = 0; offset < 5; offset++) {
          const idx = lastI - offset;
          if (idx < 1) break;
          const p21 = ema21FullSeries[idx - 1];
          const p44 = ema44Series[idx - 1];
          const c21 = ema21FullSeries[idx];
          const c44 = ema44Series[idx];
          if (p21 !== null && p44 !== null && c21 !== null && c44 !== null && p21 <= p44 && c21 > c44) {
            ema21Cross44DaysAgo = offset;
            break;
          }
        }
      }
      const ema21Cross44Bullish = ema21AboveEma44 === true && ema21Cross44DaysAgo !== null;

      const rsi14 =
        closes.length >= 15
          ? this.computeRsi14(closes, 14)
          : isIpo && closes.length >= 4
            ? this.computeRsi14(closes, closes.length - 1)
            : null;
      const atr14 =
        history.length >= 15
          ? this.computeAtr14(history, 14)
          : isIpo && history.length >= 3
            ? this.computeAtr14(history, Math.max(2, history.length - 1))
            : null;
      const atrPct = atr14 !== null && latest.close > 0 ? (atr14 / latest.close) * 100 : null;
      const suggestedStopLoss =
        atr14 !== null ? Math.max(0.05, Number((latest.close - 1.5 * atr14).toFixed(2))) : null;
      const suggestedStopPct =
        suggestedStopLoss !== null && latest.close > 0
          ? ((latest.close - suggestedStopLoss) / latest.close) * 100
          : null;

      const highs35 = history.map((d) => d.high ?? d.close ?? 0).filter((h) => h > 0);
      const max35High = highs35.length > 0 ? Math.max(...highs35) : null;
      const distFrom35dHighPct =
        max35High && max35High > 0 ? ((latest.close - max35High) / max35High) * 100 : null;

      let upDownVolRatio10d: number | null = null;
      if (history.length >= (isIpo ? 3 : 10)) {
        const last10 = history.slice(-10);
        let upVol = 0;
        let downVol = 0;
        for (const s of last10) {
          if (s.close !== null && s.prevClose !== null) {
            if (s.close >= s.prevClose) upVol += s.volume;
            else downVol += s.volume;
          }
        }
        upDownVolRatio10d = downVol > 0 ? upVol / downVol : upVol > 0 ? 5.0 : null;
      }

      let clv: number | null = null;
      if (
        latest.high !== null &&
        latest.low !== null &&
        latest.close !== null &&
        latest.high > latest.low
      ) {
        clv = (latest.close - latest.low) / (latest.high - latest.low);
      }

      const changePct =
        latest.prevClose && latest.prevClose > 0
          ? ((latest.close - latest.prevClose) / latest.prevClose) * 100
          : null;

      const isDeliveryAB =
        deliveryCategory === 'A_AND_B' ||
        deliveryCategory === 'A_ONLY' ||
        deliveryCategory === 'B_ONLY';

      const swingTier: SwingTier = classifySwingTier({
        avgTurnover20DCr,
        liquidityPass,
        deliveryCategory,
        aboveEma21,
        delivQtyRatio,
        rvol,
        rvolBand,
        changePct,
        rsi14,
      });

      const fund = this.fundamentalsBySymbol.get(sym);
      const symSignals = this.signalsBySymbol.get(sym);
      const latestSignal = symSignals?.[0] ?? null;
      const hasEpsDrop =
        fund?.epsPrev !== null &&
        fund?.epsPrev !== undefined &&
        fund?.epsCurr !== null &&
        fund?.epsCurr !== undefined &&
        fund.epsPrev > fund.epsCurr &&
        fund.trailingPE !== null &&
        fund.trailingPE > 0;

      const uTurnEval = evaluateUTurnConfirmation(history, {
        symbol: sym,
        correctionMode: hasEpsDrop ? 'EPS_VALUATION' : 'PCT',
        epsPrev: fund?.epsPrev ?? null,
        epsCurr: fund?.epsCurr ?? null,
        epsPrevPeriod: fund?.epsPrevPeriod ?? '',
        epsCurrPeriod: fund?.epsCurrPeriod ?? '',
        avgPeRatio: fund?.trailingPE ?? null,
        correctionPct: 10,
      });

      const hasEpsJump =
        fund?.epsPrev !== null &&
        fund?.epsPrev !== undefined &&
        fund?.epsCurr !== null &&
        fund?.epsCurr !== undefined &&
        fund.epsCurr > fund.epsPrev &&
        fund.epsTtmCurr !== null &&
        fund.epsTtmCurr !== undefined &&
        fund.epsTtmCurr > 0 &&
        fund.trailingPE !== null &&
        fund.trailingPE > 0;

      const topTurnEval = hasEpsJump
        ? evaluateTurnaroundTopConfirmation(history, {
            symbol: sym,
            epsQPrev: fund?.epsPrev ?? null,
            epsQCurr: fund?.epsCurr ?? null,
            epsPrevPeriod: fund?.epsPrevPeriod ?? '',
            epsCurrPeriod: fund?.epsCurrPeriod ?? '',
            epsTtmPrev: fund?.epsTtmPrev ?? null,
            epsTtmCurr: fund?.epsTtmCurr ?? null,
            liveTrailingPE: fund?.trailingPE ?? null,
          })
        : null;

      const refDateIso = this.latestSessionDate || toIstDateIso();
      const freshnessInfo = this.computeSymbolFreshness(sym, fund, refDateIso);
      const hasVerifiedFund = Boolean(
        fund && (fund.coverage !== 'MISSING' || fund.epsCurr !== null || fund.trailingPE !== null)
      );
      const rowLastUpdatedUtc = hasVerifiedFund && fund
        ? fund.lastUpdatedUtc || (this.isValidIsoDate(fund.asOfDate) ? `${fund.asOfDate}T00:00:00Z` : '')
        : '';

      if (fund) {
        fund.fundamentalFreshness = freshnessInfo.fundamentalFreshness;
        fund.fundamentalAgeDays = freshnessInfo.fundamentalAgeDays;
        fund.fundamentalRemark = freshnessInfo.fundamentalRemark;
        fund.fundamentalSources = freshnessInfo.fundamentalSources;
        fund.latestFilingDate = freshnessInfo.latestFilingDate;
        if (rowLastUpdatedUtc && !fund.lastUpdatedUtc) {
          fund.lastUpdatedUtc = rowLastUpdatedUtc;
        }
      }

      const fundamentalVerified = Boolean(
        fund &&
          (fund.coverage === 'COMPLETE' || fund.coverage === 'PARTIAL_DATA') &&
          (freshnessInfo.fundamentalFreshness === 'LATEST' ||
            freshnessInfo.fundamentalFreshness === 'OLD_3M') &&
          fund.epsPrev !== null &&
          fund.epsCurr !== null &&
          fund.trailingPE !== null &&
          fund.trailingPE > 0 &&
          freshnessInfo.fundamentalSources.length > 0
      );

      const capInfo = classifyMarketCap(fund?.marketCapInr ?? null);

      const row: ScreenerRow = {
        symbol: sym,
        series: latest.series,
        latestDate: latest.date,
        closePrice: latest.close,
        prevClose: latest.prevClose,
        changePct,
        volume: latest.volume,
        turnoverCr: latest.turnoverLacs / 100,
        avgTurnover20DCr,
        delivQty: latest.delivQty,
        delivPer: latest.delivPer,
        avgDeliv5D,
        delivQtyRatio,
        delivValueCr,
        deliveryCategory,
        deliveryStatus: useStaticStreak
          ? streak?.lastStatus || (isDeliveryAB ? 'PASS_A_OR_B' : deliveryCategory)
          : dynamicStreak?.deliveryStatus || deliveryCategory,
        rolling5dGt60Count,
        dailyGt60Count,
        valid30dSessions: valid30dCount,
        consecutiveStreak: useStaticStreak
          ? streak?.consecutiveStreak ?? 0
          : dynamicStreak?.consecutiveStreak ?? 0,
        totalQualifyingSessions: useStaticStreak
          ? streak?.totalQualifyingSessions ?? 0
          : dynamicStreak?.totalQualifyingSessions ?? 0,
        firstStreakDate: useStaticStreak
          ? streak?.firstStreakDate ?? ''
          : dynamicStreak?.firstStreakDate ?? '',
        rvol,
        rvolBand,
        liquidityTier,
        liquidityPass,
        fundamentalCoverage: fund?.coverage ?? 'MISSING',
        fundamentalPassCount: fund?.passCount ?? 0,
        fundamentalFailCount: fund?.failCount ?? 0,
        fundamentalFreshness: freshnessInfo.fundamentalFreshness,
        fundamentalAgeDays: freshnessInfo.fundamentalAgeDays,
        fundamentalRemark: freshnessInfo.fundamentalRemark,
        fundamentalSources: freshnessInfo.fundamentalSources,
        fundamentalVerified,
        latestFilingDate: freshnessInfo.latestFilingDate,
        lastUpdatedUtc: rowLastUpdatedUtc,
        providerSector: fund?.providerSector || (isIpo ? 'IPO / Recent Listings' : ''),
        isIpo,
        listingDate,
        ipoAgeDays,
        companyName: fund?.companyName || '',
        nextEarningsDate: this.pickFutureDate(fund?.nextEarningsDate, refDateIso),
        marketCapInr: fund?.marketCapInr ?? null,
        marketCapCr: capInfo.marketCapCr,
        marketCapCategory: capInfo.marketCapCategory,
        sessionsCount,
        sma20,
        ema21,
        ema44,
        ema200,
        aboveSma20,
        aboveEma21,
        aboveEma44,
        aboveEma200,
        ema21AboveEma44,
        ema21Cross44Bullish,
        ema21Cross44DaysAgo,
        rsi14,
        atr14,
        atrPct,
        suggestedStopLoss,
        suggestedStopPct,
        distFrom35dHighPct,
        upDownVolRatio10d,
        swingTier,
        clv,
        xbrlFilingCount: this.xbrlBySymbol.get(sym)?.length ?? 0,
        latestSignalSetup: latestSignal?.setupType ?? null,
        latestV8Score: latestSignal?.v8Score ?? null,
        uTurnPeakPrice: uTurnEval?.peakPrice ?? null,
        uTurnTarget: uTurnEval?.uTurnTarget ?? null,
        uTurnDistPct: uTurnEval?.distFromTargetPct ?? null,
        uTurnStatus: uTurnEval?.status ?? null,
        uTurnSubsequentCount: uTurnEval?.subsequentSessionsCount ?? 0,
        uTurnBasis: uTurnEval
          ? uTurnEval.correctionMode === 'EPS_VALUATION'
            ? 'EPS_PE'
            : 'PCT_10'
          : null,
        topTurnTarget: topTurnEval?.topTargetPrice ?? null,
        topTurnDistPct: topTurnEval?.distFromTopPct ?? null,
        topTurnStatus: topTurnEval?.status ?? null,
      };

      rows.push(row);
      this.screenerBySymbol.set(sym, row);
    }

    rows.sort((a, b) => (b.rvol ?? -1) - (a.rvol ?? -1));
    this.screenerRows = rows;
  }

  public getXbrlBySymbolMap(): Map<string, XbrlFiling[]> {
    this.ensureLoaded();
    return this.xbrlBySymbol;
  }

  public getXbrlFilingsForSymbol(symbol: string): XbrlFiling[] {
    this.ensureLoaded();
    return this.xbrlBySymbol.get(symbol.trim().toUpperCase()) ?? [];
  }

  public getAuditCollectionTargets(
    scope: 'MISSING_OR_OLD' | 'NOT_AVAILABLE' | 'LIQUID' | 'ALL',
    limit?: number
  ): string[] {
    this.ensureLoaded();
    const tierOrder: Record<SwingTier, number> = {
      TIER_1_READY: 0,
      TIER_2_ACCUMULATION: 1,
      TIER_3_RVOL_WATCH: 2,
      NONE: 3,
    };

    let candidates = this.screenerRows;
    if (scope === 'NOT_AVAILABLE') {
      candidates = candidates.filter((r) => r.fundamentalFreshness === 'NOT_AVAILABLE');
    } else if (scope === 'LIQUID') {
      candidates = candidates.filter(
        (r) =>
          r.liquidityPass &&
          (r.fundamentalFreshness !== 'LATEST' || r.fundamentalCoverage !== 'COMPLETE')
      );
    } else if (scope === 'MISSING_OR_OLD') {
      candidates = candidates.filter(
        (r) => r.fundamentalFreshness !== 'LATEST' || r.fundamentalCoverage === 'MISSING'
      );
    }

    const sorted = [...candidates].sort((a, b) => {
      // Prioritize liquidityPass, then higher swingTier, then higher turnover/RVOL
      if (a.liquidityPass !== b.liquidityPass) return a.liquidityPass ? -1 : 1;
      const tDiff = tierOrder[a.swingTier] - tierOrder[b.swingTier];
      if (tDiff !== 0) return tDiff;
      const xDiff = (b.xbrlFilingCount > 0 ? 1 : 0) - (a.xbrlFilingCount > 0 ? 1 : 0);
      if (xDiff !== 0) return xDiff;
      return (b.avgTurnover20DCr ?? 0) - (a.avgTurnover20DCr ?? 0);
    });

    const syms = sorted.map((r) => r.symbol);
    return limit && limit > 0 ? syms.slice(0, limit) : syms;
  }

  public getMissingFundamentalCandidates(limit = 25): string[] {
    return this.getAuditCollectionTargets('LIQUID', limit);
  }

  private computeMarketSentiment(unionCount: number): MarketSentiment {
    const rows = this.screenerRows;
    const total = rows.length || 1;

    const breadthMetrics = calculateMarketBreadth(rows);
    let delivSum = 0;
    let delivCount = 0;
    let deliveryExpandingUp = 0;
    let deliveryExpandingDown = 0;
    let highRvolUp = 0;
    let highRvolDown = 0;

    for (const r of rows) {
      const chg = r.changePct ?? 0;
      if (r.delivPer !== null) {
        delivSum += r.delivPer;
        delivCount++;
      }

      if (r.liquidityPass) {
        if (r.delivQtyRatio !== null && r.delivQtyRatio >= 1.2) {
          if (chg > 0) deliveryExpandingUp++;
          else if (chg < 0) deliveryExpandingDown++;
        }
        if (r.rvolBand === 'HIGH') {
          if (chg > 0) highRvolUp++;
          else if (chg < 0) highRvolDown++;
        }
      }
    }

    const {
      advancers,
      decliners,
      unchanged,
      breadthPct,
      aboveEma21Count,
      ema21EligibleCount,
      aboveEma21Pct,
      aboveEma44Count,
      ema44EligibleCount,
      aboveEma44Pct,
      aboveEma200Count,
      ema200SampleCount,
      aboveEma200Pct,
      aboveEma21And44Count,
      ema21And44EligibleCount,
      aboveEma21And44Pct,
      emaCrossBullishCount,
    } = breadthMetrics;

    const avgDeliveryPct = delivCount > 0 ? delivSum / delivCount : 0;

    const delivExpTotal = deliveryExpandingUp + deliveryExpandingDown;
    const deliveryAccumPct =
      delivExpTotal > 0 ? (deliveryExpandingUp / delivExpTotal) * 100 : 50;

    const rvolTotal = highRvolUp + highRvolDown;
    const highRvolUpPct = rvolTotal > 0 ? (highRvolUp / rvolTotal) * 100 : 50;
    const unionPct = (unionCount / total) * 100;

    // Weighted composite score (0-100): Delivery Accumulation (35%), High-RVOL Flow (25%), Breadth (20%), EMA21 Trend (20%)
    const rawScore =
      deliveryAccumPct * 0.35 +
      highRvolUpPct * 0.25 +
      breadthPct * 0.2 +
      aboveEma21Pct * 0.2;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const status: MarketSentiment['status'] =
      score >= 58 ? 'BULLISH' : score <= 42 ? 'BEARISH' : 'NEUTRAL';

    const summary =
      status === 'BULLISH'
        ? `Institutional delivery accumulation dominates (${deliveryExpandingUp} up vs ${deliveryExpandingDown} down on >=1.2x DelivQty) with ${aboveEma21Pct.toFixed(1)}% (${aboveEma21Count}/${ema21EligibleCount}) eligible stocks above EMA21 (${emaCrossBullishCount} fresh EMA 21/44 crosses).`
        : status === 'BEARISH'
          ? `Distribution pressure outweighs accumulation (${deliveryExpandingDown} down vs ${deliveryExpandingUp} up on >=1.2x DelivQty; ${aboveEma21Pct.toFixed(1)}% above EMA21 across ${ema21EligibleCount} eligible); keep strict stop & selective Tier 1 discipline.`
          : `Mixed EOD delivery flow (${deliveryExpandingUp} up vs ${deliveryExpandingDown} down on >=1.2x DelivQty; ${breadthPct.toFixed(1)}% A/D breadth; ${aboveEma21Pct.toFixed(1)}% > EMA21) — stay selective on Tier 1 setups.`;

    return {
      status,
      score,
      asOfDate: this.latestSessionDate,
      advancers,
      decliners,
      unchanged,
      breadthPct,
      avgDeliveryPct: Number(avgDeliveryPct.toFixed(1)),
      deliveryExpandingUp,
      deliveryExpandingDown,
      deliveryAccumPct: Number(deliveryAccumPct.toFixed(1)),
      highRvolUp,
      highRvolDown,
      aboveEma21Pct,
      aboveEma21Count,
      ema21EligibleCount,
      aboveEma44Pct,
      aboveEma44Count,
      ema44EligibleCount,
      aboveEma200Pct,
      aboveEma200Count,
      ema200SampleCount,
      aboveEma21And44Pct,
      aboveEma21And44Count,
      ema21And44EligibleCount,
      emaCrossBullishCount,
      unionPct: Number(unionPct.toFixed(1)),
      summary,
    };
  }

  private buildSectorSentimentItem(sector: string, rawList: ScreenerRow[]): SectorSentimentItem {
    const list = deduplicateBreadthRows(rawList);
    const secBreadth = calculateSectorBreadth(list);
    let chgSum = 0;
    let chgCount = 0;
    let ret5dSum = 0;
    let ret5dCount = 0;
    let delivSum = 0;
    let delivCount = 0;
    let rvolSum = 0;
    let rvolCount = 0;
    let delivExpandingUp = 0;
    let delivExpandingDown = 0;
    let liquidCount = 0;
    let tier1Count = 0;
    let tier2Count = 0;

    const sectorDelivByDate = new Map<string, { sum: number; count: number }>();

    for (const r of list) {
      if (r.liquidityPass) liquidCount++;
      if (r.swingTier === 'TIER_1_READY') tier1Count++;
      else if (r.swingTier === 'TIER_2_ACCUMULATION') tier2Count++;

      const chg = r.changePct ?? 0;
      if (r.changePct !== null) {
        chgSum += chg;
        chgCount++;
      }

      // 5-session return & 30-session delivery history from cached Bhavcopy
      const hist = this.historyBySymbol.get(r.symbol);
      if (hist && hist.length >= 6) {
        const base5 = hist[hist.length - 6]?.close;
        if (base5 && base5 > 0) {
          ret5dSum += ((r.closePrice - base5) / base5) * 100;
          ret5dCount++;
        }
      }
      if (hist && hist.length > 0) {
        for (const pt of hist) {
          if (
            pt.delivPer !== null &&
            Number.isFinite(pt.delivPer) &&
            pt.delivPer >= 0 &&
            pt.delivPer <= 100
          ) {
            const cur = sectorDelivByDate.get(pt.date);
            if (cur) {
              cur.sum += pt.delivPer;
              cur.count += 1;
            } else {
              sectorDelivByDate.set(pt.date, { sum: pt.delivPer, count: 1 });
            }
          }
        }
      }

      if (r.delivPer !== null) {
        delivSum += r.delivPer;
        delivCount++;
      }
      if (r.rvol !== null) {
        rvolSum += r.rvol;
        rvolCount++;
      }
      if (r.delivQtyRatio !== null && r.delivQtyRatio >= 1.2) {
        if (chg > 0) delivExpandingUp++;
        else if (chg < 0) delivExpandingDown++;
      }
    }

    const minDailySamples = Math.max(1, Math.floor(list.length * 0.25));
    const deliveryTrend30d = Array.from(sectorDelivByDate.entries())
      .filter(([, agg]) => agg.count >= minDailySamples)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
      .map(([date, agg]) => ({
        date,
        avgDeliveryPct: Number((agg.sum / agg.count).toFixed(1)),
      }));

    const fallbackDelivAvg = delivCount > 0 ? delivSum / delivCount : 0;
    const { delivery30dAvg, delivery5dAvg, deliveryShiftPp } =
      calculateSectorDeliveryTrendMetrics(deliveryTrend30d, fallbackDelivAvg);

    const {
      advancers,
      decliners,
      breadthPct,
      aboveEma21Count,
      ema21EligibleCount,
      aboveEma21Pct,
      aboveEma44Count,
      ema44EligibleCount,
      aboveEma44Pct,
      aboveEma200Count,
      ema200SampleCount,
      aboveEma200Pct,
      ema21Above44Pct,
      emaCrossBullishCount: ema21Cross44Count,
      emaTrendCompositePct,
    } = secBreadth;

    const avgChangePct = chgCount > 0 ? chgSum / chgCount : 0;
    const avg5dReturnPct = ret5dCount > 0 ? ret5dSum / ret5dCount : null;
    const avgDeliveryPct = delivCount > 0 ? delivSum / delivCount : 0;
    const avgRvol = rvolCount > 0 ? rvolSum / rvolCount : null;

    const delivExpTotal = delivExpandingUp + delivExpandingDown;
    const delivFlowPct =
      delivExpTotal > 0 ? (delivExpandingUp / delivExpTotal) * 100 : breadthPct;

    // Normalize 5D return around 50 (roughly -5% -> 0, 0% -> 50, +5% -> 100)
    const norm5dScore =
      avg5dReturnPct !== null
        ? Math.max(0, Math.min(100, 50 + avg5dReturnPct * 10))
        : breadthPct;

    const rawScore =
      norm5dScore * 0.3 +
      breadthPct * 0.25 +
      aboveEma21Pct * 0.25 +
      delivFlowPct * 0.2;
    const rotationScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const regime: SectorSentimentItem['regime'] =
      rotationScore >= 60
        ? 'LEADING'
        : rotationScore >= 50
          ? 'IMPROVING'
          : rotationScore >= 42
            ? 'NEUTRAL'
            : 'LAGGING';

    return {
      sector,
      stockCount: list.length,
      liquidCount,
      advancers,
      decliners,
      breadthPct,
      avgChangePct: Number(avgChangePct.toFixed(2)),
      avg5dReturnPct: avg5dReturnPct !== null ? Number(avg5dReturnPct.toFixed(2)) : null,
      avgDeliveryPct: Number(avgDeliveryPct.toFixed(1)),
      deliveryTrend30d,
      delivery30dAvg,
      delivery5dAvg,
      deliveryShiftPp,
      avgRvol: avgRvol !== null ? Number(avgRvol.toFixed(2)) : null,
      delivExpandingUp,
      delivExpandingDown,
      aboveEma21Pct,
      aboveEma21Count,
      ema21EligibleCount,
      aboveEma44Pct,
      aboveEma44Count,
      ema44EligibleCount,
      aboveEma200Pct,
      aboveEma200Count,
      ema200SampleCount,
      ema21Above44Pct,
      ema21Cross44Count,
      emaTrendCompositePct,
      tier1Count,
      tier2Count,
      rotationScore,
      regime,
    };
  }

  private computeSectorSentiment(): SectorSentimentItem[] {
    const bySector = new Map<string, ScreenerRow[]>();
    const seenBySector = new Map<string, Set<string>>();
    const ipoList: ScreenerRow[] = [];
    const seenIpo = new Set<string>();

    for (const r of this.screenerRows) {
      const symKey = r.symbol.trim().toUpperCase();
      if (!symKey) continue;

      if (r.isIpo && !seenIpo.has(symKey)) {
        seenIpo.add(symKey);
        ipoList.push(r);
      }
      const sec = (r.providerSector || '').trim();
      if (!sec || sec.toUpperCase() === 'IPO / RECENT LISTINGS') continue;
      let seen = seenBySector.get(sec);
      if (!seen) {
        seen = new Set<string>();
        seenBySector.set(sec, seen);
      }
      if (seen.has(symKey)) continue;
      seen.add(symKey);

      const arr = bySector.get(sec);
      if (arr) arr.push(r);
      else bySector.set(sec, [r]);
    }

    const items: SectorSentimentItem[] = [];
    for (const [sector, list] of bySector.entries()) {
      if (list.length < 3) continue;
      items.push(this.buildSectorSentimentItem(sector, list));
    }

    if (ipoList.length >= 3) {
      items.push(this.buildSectorSentimentItem('IPO / Recent Listings', ipoList));
    }

    return items.sort((a, b) => b.rotationScore - a.rotationScore);
  }

  public getOverview(): OverviewData {
    this.ensureLoaded();
    if (this.overviewCache) return this.overviewCache;

    const union = this.screenerRows.filter(
      (r) =>
        r.deliveryCategory === 'A_AND_B' ||
        r.deliveryCategory === 'A_ONLY' ||
        r.deliveryCategory === 'B_ONLY'
    );
    const liqPassInUnion = union.filter((r) => r.liquidityPass);

    const tierOrder: Record<SwingTier, number> = {
      TIER_1_READY: 0,
      TIER_2_ACCUMULATION: 1,
      TIER_3_RVOL_WATCH: 2,
      NONE: 3,
    };

    const topDeliveryMovers = [...this.screenerRows]
      .filter((r) => r.liquidityPass && (r.swingTier !== 'NONE' || r.rvolBand === 'HIGH'))
      .sort((a, b) => {
        const tDiff = tierOrder[a.swingTier] - tierOrder[b.swingTier];
        if (tDiff !== 0) return tDiff;
        return (b.rvol ?? 0) - (a.rvol ?? 0);
      })
      .slice(0, 12);

    const marketSentiment = this.computeMarketSentiment(union.length);
    const sectorSentiment = this.computeSectorSentiment();

    const refDateIso = this.latestSessionDate || toIstDateIso();
    const recentFiling90dCount = this.screenerRows.filter((r) => {
      const d = this.diffDaysBetween(refDateIso, r.latestFilingDate);
      return d !== null && d <= 90;
    }).length;

    const seqFunnel = computeSequentialFunnelMetrics(this.screenerRows);

    this.overviewCache = {
      latestSessionDate: this.latestSessionDate,
      sessionsLoaded: this.sessionDates.length,
      sessionDateRange: {
        from: this.sessionDates[0] || '',
        to: this.latestSessionDate,
      },
      marketSentiment,
      sectorSentiment,
      funnel: {
        universeMainboard: seqFunnel.universeMainboard,
        deliveryAorBUnion: seqFunnel.deliveryAorBUnion,
        deliveryAAndB: seqFunnel.deliveryAAndB,
        deliveryAOnly: seqFunnel.deliveryAOnly,
        deliveryBOnly: seqFunnel.deliveryBOnly,
        liquidityPassInUnion: seqFunnel.liquidityPassInUnion,
        liquidityBelowMinInUnion: seqFunnel.liquidityBelowMinInUnion,
        rvolHighInLiquidUnion: seqFunnel.rvolHighInLiquidUnion,
        rvolLowInLiquidUnion: seqFunnel.rvolLowInLiquidUnion,
        rvolWaitInLiquidUnion: seqFunnel.rvolWaitInLiquidUnion,
        rvolHighInUnion: union.filter((r) => r.rvolBand === 'HIGH').length,
        rvolLowInUnion: union.filter((r) => r.rvolBand === 'LOW').length,
        rvolWaitInUnion: union.filter((r) => r.rvolBand === 'WAIT_FOR_DATA').length,
        fundamentalsCompleteInLiquidity: liqPassInUnion.filter(
          (r) => r.fundamentalCoverage === 'COMPLETE'
        ).length,
        fundamentalsPartialInLiquidity: liqPassInUnion.filter(
          (r) => r.fundamentalCoverage === 'PARTIAL_DATA'
        ).length,
        sequentialTieredCount: seqFunnel.sequentialTieredCount,
        sequentialTier1Count: seqFunnel.sequentialTier1Count,
        sequentialTier2Count: seqFunnel.sequentialTier2Count,
        sequentialTier3Count: seqFunnel.sequentialTier3Count,
        tier1ReadyCount: seqFunnel.tier1ReadyCount,
        tier2AccumulationCount: seqFunnel.tier2AccumulationCount,
        tier3RvolWatchCount: seqFunnel.tier3RvolWatchCount,
        tieredWatchlistCount: seqFunnel.tieredWatchlistCount,
        signalLogTotalRows: this.signals.length,
        xbrlFilingsTotalRows: this.xbrlTotalCount,
      },
      thresholds: this.thresholds,
      fundamentalAudit: {
        totalStocks: this.screenerRows.length,
        latestCount: this.screenerRows.filter((r) => r.fundamentalFreshness === 'LATEST').length,
        old3mCount: this.screenerRows.filter((r) => r.fundamentalFreshness === 'OLD_3M').length,
        staleCount: this.screenerRows.filter((r) => r.fundamentalFreshness === 'STALE').length,
        notAvailableCount: this.screenerRows.filter(
          (r) => r.fundamentalFreshness === 'NOT_AVAILABLE'
        ).length,
        withXbrlFilingsCount: this.screenerRows.filter((r) => r.xbrlFilingCount > 0).length,
        recentFiling90dCount,
        sourcesBreakdown: {
          nseXbrl: this.screenerRows.filter((r) =>
            r.fundamentalSources.some((s) => s.includes('NSE'))
          ).length,
          yahooNs: this.screenerRows.filter(
            (r) =>
              r.fundamentalSources.includes('Screener.in') ||
              r.fundamentalSources.includes('YFinance (.NS)')
          ).length,
          bseBo: this.screenerRows.filter(
            (r) =>
              r.fundamentalSources.includes('BSE Official') ||
              r.fundamentalSources.includes('BSE (.BO)')
          ).length,
          csvBaseline: this.screenerRows.filter((r) =>
            r.fundamentalSources.includes('CSV Baseline')
          ).length,
        },
      },
      topDeliveryMovers,
      recentSignals: [
        ...this.signals.filter((s) => s.eodDate === this.latestSessionDate).slice(0, 6),
        ...this.signals
          .filter((s) => s.eodDate !== this.latestSessionDate && s.evalSessionsAfter > 0)
          .slice(0, 6),
      ].slice(0, 12),
    };

    return this.overviewCache;
  }

  public queryScreener(params: {
    q?: string;
    sector?: string;
    delivery?: string;
    rvol?: string;
    liquidity?: string;
    fundamental?: string;
    freshness?: string;
    swingTier?: string;
    uTurn?: string;
    cap?: string;
    emaCross?: string;
    upcomingResults?: boolean;
    symbols?: string;
    sort?: string;
    dir?: string;
    limit?: number;
    offset?: number;
  }): { total: number; rows: ScreenerRow[]; latestDate: string } {
    this.ensureLoaded();
    let list = this.screenerRows;

    const rawSymbols = (params.symbols || '').trim();
    if (rawSymbols) {
      const symSet = new Set(
        rawSymbols
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      );
      if (symSet.size === 0) {
        return { total: 0, rows: [], latestDate: this.latestSessionDate };
      }
      list = list.filter((r) => symSet.has(r.symbol));
    }

    const q = (params.q || '').trim().toUpperCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.symbol.includes(q) ||
          r.providerSector.toUpperCase().includes(q) ||
          (r.isIpo && 'IPO'.includes(q))
      );
    }

    const sector = (params.sector || 'ALL').trim().toUpperCase();
    if (sector === 'TOP_3_SECTORS') {
      const top3 = this.getOverview().sectorSentiment.slice(0, 3);
      const topSet = new Set(top3.map((s) => s.sector.trim().toUpperCase()));
      const includeIpo = topSet.has('IPO / RECENT LISTINGS');
      if (topSet.size > 0) {
        list = list.filter(
          (r) =>
            topSet.has(r.providerSector.trim().toUpperCase()) ||
            (includeIpo && r.isIpo)
        );
      }
    } else if (sector === 'IPO / RECENT LISTINGS' || sector === 'IPO') {
      list = list.filter(
        (r) => r.isIpo || r.providerSector.trim().toUpperCase() === 'IPO / RECENT LISTINGS'
      );
    } else if (sector !== 'ALL') {
      list = list.filter((r) => r.providerSector.trim().toUpperCase() === sector);
    }

    const delivery = (params.delivery || 'ALL').toUpperCase();
    if (delivery === 'UNION') {
      list = list.filter(
        (r) =>
          r.deliveryCategory === 'A_AND_B' ||
          r.deliveryCategory === 'A_ONLY' ||
          r.deliveryCategory === 'B_ONLY'
      );
    } else if (delivery !== 'ALL') {
      list = list.filter((r) => r.deliveryCategory === delivery);
    }

    const rvol = (params.rvol || 'ALL').toUpperCase();
    if (rvol !== 'ALL') {
      list = list.filter((r) => r.rvolBand === rvol);
    }

    const liquidity = (params.liquidity || 'ALL').toUpperCase();
    if (liquidity === 'PASS') {
      list = list.filter((r) => r.liquidityPass);
    } else if (liquidity === 'BELOW_MIN') {
      list = list.filter((r) => !r.liquidityPass);
    }

    const fundamental = (params.fundamental || 'ALL').toUpperCase();
    if (fundamental === 'VERIFIED_MUST') {
      list = list.filter((r) => r.fundamentalVerified === true);
    } else if (fundamental === 'STRONG_PASS') {
      list = list.filter((r) => r.fundamentalPassCount >= 5);
    } else if (fundamental === 'PASS_4') {
      list = list.filter((r) => r.fundamentalPassCount >= 4);
    } else if (fundamental !== 'ALL') {
      list = list.filter((r) => r.fundamentalCoverage === fundamental);
    }

    const freshness = (params.freshness || 'ALL').toUpperCase();
    if (freshness !== 'ALL') {
      list = list.filter((r) => r.fundamentalFreshness === freshness);
    }

    const swingTier = (params.swingTier || 'ALL').toUpperCase();
    if (swingTier === 'ANY_SWING') {
      list = list.filter((r) => r.swingTier !== 'NONE');
    } else if (swingTier === 'T1_T2') {
      list = list.filter(
        (r) => r.swingTier === 'TIER_1_READY' || r.swingTier === 'TIER_2_ACCUMULATION'
      );
    } else if (swingTier !== 'ALL') {
      list = list.filter((r) => r.swingTier === swingTier);
    }

    const uTurn = (params.uTurn || 'ALL').toUpperCase();
    if (uTurn === 'CONFIRMED_OR_TRIGGER') {
      list = list.filter(
        (r) => r.uTurnStatus === 'CONFIRMED_SUPPORT' || r.uTurnStatus === 'ACTIVE_TRIGGER'
      );
    } else if (uTurn === 'TOP_CONFIRMED_OR_TRIGGER') {
      list = list.filter(
        (r) => r.topTurnStatus === 'CONFIRMED_TOP' || r.topTurnStatus === 'ACTIVE_TOP_TRIGGER'
      );
    } else if (
      uTurn === 'CONFIRMED_TOP' ||
      uTurn === 'ACTIVE_TOP_TRIGGER' ||
      uTurn === 'TOP_ZONE_WATCH' ||
      uTurn === 'TOP_BREAKOUT' ||
      uTurn === 'BELOW_TOP_ZONE'
    ) {
      list = list.filter((r) => r.topTurnStatus === uTurn);
    } else if (uTurn !== 'ALL') {
      list = list.filter((r) => r.uTurnStatus === uTurn);
    }

    if (params.upcomingResults) {
      const refIso = this.getAuditRefDateIso();
      list = list.filter((r) => Boolean(r.nextEarningsDate && r.nextEarningsDate >= refIso));
    }

    const cap = (params.cap || 'ALL').toUpperCase();
    if (
      cap === 'LARGE_CAP' ||
      cap === 'MID_CAP' ||
      cap === 'SMALL_CAP' ||
      cap === 'UNKNOWN'
    ) {
      list = list.filter((r) => r.marketCapCategory === cap);
    }

    const emaCross = (params.emaCross || 'ALL').toUpperCase();
    if (emaCross === 'RECENT_CROSS') {
      list = list.filter((r) => r.ema21Cross44Bullish === true);
    } else if (emaCross === 'BULLISH_ALIGNED') {
      list = list.filter((r) => r.ema21AboveEma44 === true);
    } else if (emaCross === 'BELOW') {
      list = list.filter((r) => r.ema21AboveEma44 === false);
    }

    const sortKey = params.sort || 'rvol';
    const dirMul = params.dir === 'asc' ? 1 : -1;
    const covRank = { COMPLETE: 2, PARTIAL_DATA: 1, MISSING: 0 } as const;
    const freshRank: Record<FundamentalFreshness, number> = {
      LATEST: 3,
      OLD_3M: 2,
      STALE: 1,
      NOT_AVAILABLE: 0,
    };
    const uTurnRank: Record<UTurnStatus, number> = {
      CONFIRMED_SUPPORT: 5,
      ACTIVE_TRIGGER: 4,
      SUPPORT_HOLD: 3,
      IN_ZONE: 2,
      ABOVE_ZONE: 1,
      BROKEN_DOWN: 0,
    };
    const sorted = [...list].sort((a, b) => {
      let va = 0;
      let vb = 0;
      switch (sortKey) {
        case 'symbol':
          return dirMul * a.symbol.localeCompare(b.symbol);
        case 'close':
          va = a.closePrice;
          vb = b.closePrice;
          break;
        case 'changePct':
          va = a.changePct ?? -999;
          vb = b.changePct ?? -999;
          break;
        case 'delivPer':
          va = a.delivPer ?? -1;
          vb = b.delivPer ?? -1;
          break;
        case 'avgDeliv5D':
          va = a.avgDeliv5D ?? -1;
          vb = b.avgDeliv5D ?? -1;
          break;
        case 'delivQtyRatio':
          va = a.delivQtyRatio ?? -1;
          vb = b.delivQtyRatio ?? -1;
          break;
        case 'rsi14':
          va = a.rsi14 ?? -1;
          vb = b.rsi14 ?? -1;
          break;
        case 'atrPct':
          va = a.atrPct ?? -1;
          vb = b.atrPct ?? -1;
          break;
        case 'turnover':
          va = a.avgTurnover20DCr ?? -1;
          vb = b.avgTurnover20DCr ?? -1;
          break;
        case 'streak':
          va = a.consecutiveStreak;
          vb = b.consecutiveStreak;
          break;
        case 'fundamental':
          va = a.fundamentalPassCount * 10 + covRank[a.fundamentalCoverage];
          vb = b.fundamentalPassCount * 10 + covRank[b.fundamentalCoverage];
          break;
        case 'freshness':
          va =
            freshRank[a.fundamentalFreshness] * 10000 -
            (a.fundamentalAgeDays ?? 9999);
          vb =
            freshRank[b.fundamentalFreshness] * 10000 -
            (b.fundamentalAgeDays ?? 9999);
          break;
        case 'uTurn':
          va = (a.uTurnStatus ? uTurnRank[a.uTurnStatus] : -1) * 100 + (a.rvol ?? 0);
          vb = (b.uTurnStatus ? uTurnRank[b.uTurnStatus] : -1) * 100 + (b.rvol ?? 0);
          break;
        case 'nextEarningsDate':
          return (
            dirMul *
            (a.nextEarningsDate || '9999-12-31').localeCompare(
              b.nextEarningsDate || '9999-12-31'
            )
          );
        case 'rvol':
        default:
          va = a.rvol ?? -1;
          vb = b.rvol ?? -1;
          break;
      }
      return dirMul * (va - vb);
    });

    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    return {
      total: sorted.length,
      rows: sorted.slice(offset, offset + limit),
      latestDate: this.latestSessionDate,
    };
  }

  public getUTurnEvaluation(symbol: string, options?: UTurnOptions): UTurnEvaluation | null {
    this.ensureLoaded();
    const sym = symbol.trim().toUpperCase();
    if (!this.screenerBySymbol.has(sym)) return null;
    const rawHistory = this.historyBySymbol.get(sym) ?? [];
    const fund = this.fundamentalsBySymbol.get(sym);
    return evaluateUTurnConfirmation(rawHistory, {
      ...options,
      symbol: sym,
      epsPrev: options?.epsPrev !== undefined ? options.epsPrev : (fund?.epsPrev ?? null),
      epsCurr: options?.epsCurr !== undefined ? options.epsCurr : (fund?.epsCurr ?? null),
      epsPrevPeriod: fund?.epsPrevPeriod ?? '',
      epsCurrPeriod: fund?.epsCurrPeriod ?? '',
      avgPeRatio:
        options?.avgPeRatio !== undefined ? options.avgPeRatio : (fund?.trailingPE ?? null),
    });
  }

  public getTurnaroundTopEvaluation(
    symbol: string,
    options?: TurnaroundTopOptions
  ): TurnaroundTopEvaluation | null {
    this.ensureLoaded();
    const sym = symbol.trim().toUpperCase();
    if (!this.screenerBySymbol.has(sym)) return null;
    const rawHistory = this.historyBySymbol.get(sym) ?? [];
    const fund = this.fundamentalsBySymbol.get(sym);
    return evaluateTurnaroundTopConfirmation(rawHistory, {
      ...options,
      symbol: sym,
      epsQPrev: fund?.epsPrev ?? null,
      epsQCurr: fund?.epsCurr ?? null,
      epsPrevPeriod: fund?.epsPrevPeriod ?? '',
      epsCurrPeriod: fund?.epsCurrPeriod ?? '',
      epsTtmPrev: fund?.epsTtmPrev ?? null,
      epsTtmCurr: fund?.epsTtmCurr ?? null,
      liveTrailingPE: fund?.trailingPE ?? null,
    });
  }

  private getAuditRefDateIso(): string {
    const todayIso = toIstDateIso();
    if (this.latestSessionDate && this.latestSessionDate > todayIso) {
      return this.latestSessionDate;
    }
    return todayIso;
  }

  private classifyAgeTier(ageDays: number | null): AuditFreshnessTier {
    if (ageDays === null) return 'UNVERIFIED';
    if (ageDays < 30) return 'UNDER_1M';
    if (ageDays <= 90) return 'ONE_TO_3M';
    return 'OVER_3M';
  }

  private buildAuditEntryForRow(row: ScreenerRow, refDateIso = this.getAuditRefDateIso()): FundamentalAuditEntry {
    const fund = this.fundamentalsBySymbol.get(row.symbol);
    const xbrlList = this.xbrlBySymbol.get(row.symbol) ?? [];

    const verifiedIso =
      row.lastUpdatedUtc && row.lastUpdatedUtc.length >= 10
        ? row.lastUpdatedUtc.slice(0, 10)
        : '';
    const verifiedAgeDays = this.isValidIsoDate(verifiedIso)
      ? this.diffDaysBetween(refDateIso, verifiedIso)
      : null;

    const periodCandidates = fund
      ? [fund.epsCurrPeriod, fund.financialPeriodEnd].filter((d) => this.isValidIsoDate(d))
      : [];
    periodCandidates.sort((a, b) => b.localeCompare(a));
    const financialPeriodEnd = periodCandidates[0] || '';
    const periodAgeDays = financialPeriodEnd
      ? this.diffDaysBetween(refDateIso, financialPeriodEnd)
      : null;

    const freshnessTier = this.classifyAgeTier(verifiedAgeDays);
    const bseMapped =
      row.fundamentalSources.includes('BSE Official') ||
      row.fundamentalSources.includes('BSE (.BO)');

    return {
      symbol: row.symbol,
      series: row.series,
      sector: row.providerSector || '',
      nseMapped: true,
      nseTicker: `${row.symbol}.NS`,
      nseXbrlCount: xbrlList.length,
      nseLatestFilingDate: row.latestFilingDate,
      bseMapped,
      bseTicker: `${row.symbol}.BO`,
      financialPeriodEnd,
      lastUpdatedUtc: row.lastUpdatedUtc,
      verifiedAgeDays,
      periodAgeDays,
      freshnessTier,
      coverage: row.fundamentalCoverage,
      passCount: row.fundamentalPassCount,
      sources: row.fundamentalSources,
    };
  }

  public queryFundamentalAudit(params: {
    q?: string;
    tier?: string;
    exchange?: string;
    basis?: string;
    limit?: number;
    offset?: number;
  }): {
    total: number;
    rows: FundamentalAuditEntry[];
    counts: {
      under1m: number;
      oneTo3m: number;
      over3m: number;
      unverified: number;
      nseMapped: number;
      bseMapped: number;
    };
  } {
    this.ensureLoaded();
    const refDateIso = this.getAuditRefDateIso();
    const usePeriodBasis = (params.basis || '').toUpperCase() === 'PERIOD';

    const allEntries = this.screenerRows.map((r) => this.buildAuditEntryForRow(r, refDateIso));

    const effectiveTier = (entry: FundamentalAuditEntry): AuditFreshnessTier =>
      usePeriodBasis ? this.classifyAgeTier(entry.periodAgeDays) : entry.freshnessTier;

    const counts = {
      under1m: 0,
      oneTo3m: 0,
      over3m: 0,
      unverified: 0,
      nseMapped: allEntries.length,
      bseMapped: 0,
    };

    for (const entry of allEntries) {
      if (entry.bseMapped) counts.bseMapped += 1;
      const t = effectiveTier(entry);
      if (t === 'UNDER_1M') counts.under1m += 1;
      else if (t === 'ONE_TO_3M') counts.oneTo3m += 1;
      else if (t === 'OVER_3M') counts.over3m += 1;
      else counts.unverified += 1;
    }

    let list = allEntries;
    const q = (params.q || '').trim().toUpperCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.symbol.includes(q) ||
          e.nseTicker.includes(q) ||
          e.bseTicker.includes(q) ||
          e.sector.toUpperCase().includes(q)
      );
    }

    const tier = (params.tier || 'ALL').toUpperCase();
    if (tier === 'OVER_3M_OR_UNVERIFIED') {
      list = list.filter((e) => {
        const t = effectiveTier(e);
        return t === 'OVER_3M' || t === 'UNVERIFIED';
      });
    } else if (tier !== 'ALL') {
      list = list.filter((e) => effectiveTier(e) === tier);
    }

    const exchange = (params.exchange || 'ALL').toUpperCase();
    if (exchange === 'BSE_VERIFIED' || exchange === 'BOTH') {
      list = list.filter((e) => e.bseMapped);
    } else if (exchange === 'NSE_XBRL') {
      list = list.filter((e) => e.nseXbrlCount > 0);
    } else if (exchange === 'NSE_YAHOO' || exchange === 'SCREENER') {
      list = list.filter(
        (e) =>
          e.sources.includes('Screener.in') || e.sources.includes('YFinance (.NS)')
      );
    }

    const tierRank: Record<AuditFreshnessTier, number> = {
      UNDER_1M: 0,
      ONE_TO_3M: 1,
      OVER_3M: 2,
      UNVERIFIED: 3,
    };

    const sorted = [...list].sort((a, b) => {
      const ta = effectiveTier(a);
      const tb = effectiveTier(b);
      if (ta !== tb) return tierRank[ta] - tierRank[tb];
      const ageA = usePeriodBasis ? (a.periodAgeDays ?? 99999) : (a.verifiedAgeDays ?? 99999);
      const ageB = usePeriodBasis ? (b.periodAgeDays ?? 99999) : (b.verifiedAgeDays ?? 99999);
      if (ageA !== ageB) return ageA - ageB;
      return b.nseXbrlCount - a.nseXbrlCount || a.symbol.localeCompare(b.symbol);
    });

    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.min(200, Math.max(1, params.limit ?? 30));

    return {
      total: sorted.length,
      rows: sorted.slice(offset, offset + limit),
      counts,
    };
  }

  public getStockDetail(symbol: string): StockDetailData | null {
    this.ensureLoaded();
    const sym = symbol.trim().toUpperCase();
    const summary = this.screenerBySymbol.get(sym);
    if (!summary) return null;

    const rawHistory = this.historyBySymbol.get(sym) ?? [];
    const closes = rawHistory.map((d) => d.close);
    const ema21Series = this.computeEmaSeries(closes, 21);
    const ema44Series = this.computeEmaSeries(closes, 44);
    const rsi14Series = calculateWilderRsiSeries(closes, 14);
    const rvolSeries = calculateRvolSeries(
      rawHistory.map((d) => d.volume),
      20
    );

    const historyWithMa = rawHistory.map((row, idx) => {
      let sma20: number | null = null;
      if (idx >= 19) {
        const slice = rawHistory.slice(idx - 19, idx + 1);
        const validCloses = slice.map((s) => s.close).filter((c): c is number => c !== null);
        if (validCloses.length === 20) {
          sma20 = validCloses.reduce((a, b) => a + b, 0) / 20;
        }
      }
      const rawRvol = rvolSeries[idx] ?? null;
      const rvol = rawRvol !== null ? Number(rawRvol.toFixed(2)) : null;
      const rawRsi = rsi14Series[idx] ?? null;
      const rsi14 = rawRsi !== null ? Number(rawRsi.toFixed(2)) : null;
      return {
        ...row,
        sma20,
        ema21: ema21Series[idx] ?? null,
        ema44: ema44Series[idx] ?? null,
        rvol,
        rsi14,
      };
    });

    const refDateIso = this.getAuditRefDateIso();
    const activeAudit = this.buildAuditEntryForRow(summary, refDateIso);
    const activeSector = summary.providerSector.trim().toUpperCase();

    const sameSectorPeers = activeSector
      ? this.screenerRows.filter(
          (r) => r.symbol !== sym && r.providerSector.trim().toUpperCase() === activeSector
        )
      : [];
    const sameSectorSorted = [...sameSectorPeers].sort(
      (a, b) => (b.avgTurnover20DCr ?? 0) - (a.avgTurnover20DCr ?? 0)
    );

    const selectedPeers: ScreenerRow[] = sameSectorSorted.slice(0, 14);
    const chosenSet = new Set<string>([sym, ...selectedPeers.map((r) => r.symbol)]);

    if (selectedPeers.length < 14) {
      const liquidFallback = [...this.screenerRows]
        .filter((r) => !chosenSet.has(r.symbol))
        .sort((a, b) => (b.avgTurnover20DCr ?? 0) - (a.avgTurnover20DCr ?? 0));
      for (const candidate of liquidFallback) {
        if (selectedPeers.length >= 14) break;
        selectedPeers.push(candidate);
        chosenSet.add(candidate.symbol);
      }
    }

    const fundamentalAuditRows: FundamentalAuditEntry[] = [
      activeAudit,
      ...selectedPeers.map((peer) => this.buildAuditEntryForRow(peer, refDateIso)),
    ];

    const seasonalityRes = computeSeasonality(rawHistory);
    const peerCorrelation = this.getPeerCorrelationMatrix(sym, { windowDays: 14 }) ?? undefined;

    return {
      summary,
      history: historyWithMa,
      fundamentals: this.fundamentalsBySymbol.get(sym) ?? null,
      xbrlFilings: this.xbrlBySymbol.get(sym) ?? [],
      signals: this.signalsBySymbol.get(sym) ?? [],
      fundamentalAuditRows,
      seasonality: seasonalityRes.seasonalityList,
      currentMonthNegative: seasonalityRes.currentMonthNegative,
      peerCorrelation,
    };
  }

  private computePearsonCorrelation(xs: number[], ys: number[]): number | null {
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return null;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i];
      sumY += ys[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const denom = Math.sqrt(denX * denY);
    if (!Number.isFinite(denom) || denom <= 1e-12) return null;
    const r = num / denom;
    return Math.max(-1, Math.min(1, Number(r.toFixed(4))));
  }

  public getPeerCorrelationMatrix(
    symbol: string,
    options?: { windowDays?: number; customPeers?: string[] }
  ): PeerCorrelationMatrixData | null {
    this.ensureLoaded();
    const sym = symbol.trim().toUpperCase();
    const summary = this.screenerBySymbol.get(sym);
    if (!summary) return null;

    const rawWindow = options?.windowDays ?? 14;
    const windowDays = Math.min(45, Math.max(5, Math.round(rawWindow)));

    const primaryHist = (this.historyBySymbol.get(sym) ?? []).filter(
      (r) => r.close !== null && Number.isFinite(r.close) && r.close > 0
    );
    if (primaryHist.length < 3) return null;

    const targetSlice = primaryHist.slice(-windowDays);
    const sessionDates = targetSlice.map((d) => d.date);
    if (sessionDates.length < 3) return null;

    const activeSector = summary.providerSector.trim().toUpperCase();
    const sameSectorSorted = (
      activeSector
        ? this.screenerRows.filter(
            (r) =>
              r.symbol !== sym &&
              r.providerSector.trim().toUpperCase() === activeSector &&
              (this.historyBySymbol.get(r.symbol)?.length ?? 0) >= 5
          )
        : []
    ).sort((a, b) => {
      const turnDiff = (b.avgTurnover20DCr ?? 0) - (a.avgTurnover20DCr ?? 0);
      if (Math.abs(turnDiff) > 0.01) return turnDiff;
      return (b.marketCapCr ?? 0) - (a.marketCapCr ?? 0);
    });

    const chosenPeers: Array<{ row: ScreenerRow; isSameSector: boolean }> = [];
    const seen = new Set<string>([sym]);

    if (options?.customPeers && options.customPeers.length > 0) {
      for (const rawPeer of options.customPeers) {
        const peerSym = rawPeer.trim().toUpperCase();
        if (!peerSym || seen.has(peerSym)) continue;
        const row = this.screenerBySymbol.get(peerSym);
        if (!row || (this.historyBySymbol.get(peerSym)?.length ?? 0) < 3) continue;
        const isSame =
          Boolean(activeSector) && row.providerSector.trim().toUpperCase() === activeSector;
        chosenPeers.push({ row, isSameSector: isSame });
        seen.add(peerSym);
        if (chosenPeers.length >= 3) break;
      }
    }

    for (const candidate of sameSectorSorted) {
      if (chosenPeers.length >= 3) break;
      if (seen.has(candidate.symbol)) continue;
      chosenPeers.push({ row: candidate, isSameSector: true });
      seen.add(candidate.symbol);
    }

    if (chosenPeers.length < 3) {
      const liquidFallback = [...this.screenerRows]
        .filter(
          (r) => !seen.has(r.symbol) && (this.historyBySymbol.get(r.symbol)?.length ?? 0) >= 5
        )
        .sort((a, b) => (b.avgTurnover20DCr ?? 0) - (a.avgTurnover20DCr ?? 0));
      for (const candidate of liquidFallback) {
        if (chosenPeers.length >= 3) break;
        chosenPeers.push({ row: candidate, isSameSector: false });
        seen.add(candidate.symbol);
      }
    }

    const participants: Array<{ row: ScreenerRow; isPrimary: boolean; isSameSector: boolean }> = [
      { row: summary, isPrimary: true, isSameSector: true },
      ...chosenPeers.map((p) => ({
        row: p.row,
        isPrimary: false,
        isSameSector: p.isSameSector,
      })),
    ];

    const closeMaps = new Map<string, Map<string, number>>();
    const returnMaps = new Map<string, Map<string, number>>();

    for (const p of participants) {
      const hist = (this.historyBySymbol.get(p.row.symbol) ?? []).filter(
        (r) => r.close !== null && Number.isFinite(r.close) && r.close > 0
      );
      const cMap = new Map<string, number>();
      const rMap = new Map<string, number>();
      for (let i = 0; i < hist.length; i++) {
        const c = hist[i].close as number;
        cMap.set(hist[i].date, c);
        if (i > 0) {
          const prev = hist[i - 1].close as number;
          if (prev > 0) {
            rMap.set(hist[i].date, (c - prev) / prev);
          }
        }
      }
      closeMaps.set(p.row.symbol, cMap);
      returnMaps.set(p.row.symbol, rMap);
    }

    const peers: CorrelationPeerMeta[] = participants.map((p) => {
      const cMap = closeMaps.get(p.row.symbol)!;
      const validCloses = sessionDates
        .map((dt) => cMap.get(dt) ?? null)
        .filter((v): v is number => v !== null && v > 0);
      const returnWindowPct =
        validCloses.length >= 2
          ? Number(
              (
                ((validCloses[validCloses.length - 1] - validCloses[0]) / validCloses[0]) *
                100
              ).toFixed(2)
            )
          : null;
      return {
        symbol: p.row.symbol,
        companyName: p.row.companyName || p.row.symbol,
        sector: p.row.providerSector || 'Unclassified',
        isPrimary: p.isPrimary,
        isSameSector: p.isSameSector,
        closePrice: p.row.closePrice,
        changePct: p.row.changePct,
        returnWindowPct,
        avgTurnover20DCr: p.row.avgTurnover20DCr,
        delivPer: p.row.delivPer,
      };
    });

    const n = participants.length;
    const priceMatrix: CorrelationCellStats[][] = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => ({ r: null, sampleCount: 0 }))
    );
    const returnMatrix: CorrelationCellStats[][] = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => ({ r: null, sampleCount: 0 }))
    );

    for (let i = 0; i < n; i++) {
      const symA = participants[i].row.symbol;
      const cMapA = closeMaps.get(symA)!;
      const rMapA = returnMaps.get(symA)!;

      for (let j = i; j < n; j++) {
        const symB = participants[j].row.symbol;
        const cMapB = closeMaps.get(symB)!;
        const rMapB = returnMaps.get(symB)!;

        if (i === j) {
          const selfPriceCount = sessionDates.filter((dt) => cMapA.has(dt)).length;
          const selfRetCount = sessionDates.filter((dt) => rMapA.has(dt)).length;
          priceMatrix[i][j] = { r: 1, sampleCount: selfPriceCount };
          returnMatrix[i][j] = { r: 1, sampleCount: selfRetCount };
          continue;
        }

        const pxA: number[] = [];
        const pxB: number[] = [];
        const rxA: number[] = [];
        const rxB: number[] = [];

        for (const dt of sessionDates) {
          const ca = cMapA.get(dt);
          const cb = cMapB.get(dt);
          if (ca !== undefined && cb !== undefined) {
            pxA.push(ca);
            pxB.push(cb);
          }
          const ra = rMapA.get(dt);
          const rb = rMapB.get(dt);
          if (ra !== undefined && rb !== undefined) {
            rxA.push(ra);
            rxB.push(rb);
          }
        }

        const priceCell: CorrelationCellStats = {
          r: this.computePearsonCorrelation(pxA, pxB),
          sampleCount: pxA.length,
        };
        const retCell: CorrelationCellStats = {
          r: this.computePearsonCorrelation(rxA, rxB),
          sampleCount: rxA.length,
        };

        priceMatrix[i][j] = priceCell;
        priceMatrix[j][i] = priceCell;
        returnMatrix[i][j] = retCell;
        returnMatrix[j][i] = retCell;
      }
    }

    const normalizedSeries = participants.map((p) => {
      const cMap = closeMaps.get(p.row.symbol)!;
      const rMap = returnMaps.get(p.row.symbol)!;
      let baseClose: number | null = null;
      for (const dt of sessionDates) {
        const c = cMap.get(dt);
        if (c !== undefined && c > 0) {
          baseClose = c;
          break;
        }
      }
      return {
        symbol: p.row.symbol,
        points: sessionDates.map((dt) => {
          const close = cMap.get(dt) ?? null;
          const ret = rMap.get(dt) ?? null;
          return {
            date: dt,
            close,
            normBase100:
              baseClose && close !== null ? Number(((close / baseClose) * 100).toFixed(2)) : null,
            dailyRetPct: ret !== null ? Number((ret * 100).toFixed(2)) : null,
          };
        }),
      };
    });

    const sameSectorPeerCount = chosenPeers.filter((p) => p.isSameSector).length;

    return {
      primarySymbol: sym,
      sector: summary.providerSector || 'Unclassified',
      windowDays: sessionDates.length,
      startDate: sessionDates[0],
      endDate: sessionDates[sessionDates.length - 1],
      sessionDates,
      sameSectorPeerCount,
      peers,
      priceMatrix,
      returnMatrix,
      normalizedSeries,
      availableSectorPeers: sameSectorSorted.slice(0, 12).map((r) => ({
        symbol: r.symbol,
        companyName: r.companyName || r.symbol,
        avgTurnover20DCr: r.avgTurnover20DCr,
      })),
    };
  }

  public querySignals(params: {
    q?: string;
    date?: string;
    setup?: string;
    delivery?: string;
    limit?: number;
  }): {
    total: number;
    dates: string[];
    setups: string[];
    rows: SignalLogEntry[];
    summary: SignalSummaryStats;
  } {
    this.ensureLoaded();
    const dates = Array.from(new Set(this.signals.map((s) => s.eodDate))).sort((a, b) =>
      b.localeCompare(a)
    );
    const setups = Array.from(new Set(this.signals.map((s) => s.setupType).filter(Boolean)));

    let list = this.signals;
    const q = (params.q || '').trim().toUpperCase();
    if (q) {
      list = list.filter((s) => s.symbol.includes(q));
    }
    if (params.date && params.date !== 'ALL') {
      list = list.filter((s) => s.eodDate === params.date);
    }
    if (params.setup && params.setup !== 'ALL') {
      list = list.filter((s) => s.setupType === params.setup);
    }
    if (params.delivery && params.delivery !== 'ALL') {
      const delivFilter = params.delivery.toUpperCase();
      if (delivFilter === 'A') {
        list = list.filter(
          (s) => s.deliveryCategory === 'A' || s.deliveryCategory === 'A_ONLY'
        );
      } else if (delivFilter === 'B') {
        list = list.filter(
          (s) => s.deliveryCategory === 'B' || s.deliveryCategory === 'B_ONLY'
        );
      } else {
        list = list.filter((s) => s.deliveryCategory === delivFilter);
      }
    }

    const limit = Math.min(300, Math.max(1, params.limit ?? 100));
    const enrichedRows = list.slice(0, limit).map((s) => {
      const sr = this.screenerBySymbol.get(s.symbol);
      if (!sr) return s;
      return {
        ...s,
        marketCapCr: sr.marketCapCr,
        marketCapCategory: sr.marketCapCategory,
        ema21AboveEma44: sr.ema21AboveEma44,
        ema21Cross44Bullish: sr.ema21Cross44Bullish,
      };
    });
    return {
      total: list.length,
      dates,
      setups,
      rows: enrichedRows,
      summary: this.signalSummaryStats,
    };
  }

  public getAllSymbols(): string[] {
    this.ensureLoaded();
    return this.screenerRows.map((r) => r.symbol);
  }

  public getLatestSessionRefIso(): string {
    this.ensureLoaded();
    return this.getAuditRefDateIso();
  }

  public getAllScreenerRows(): ScreenerRow[] {
    this.ensureLoaded();
    return this.screenerRows;
  }

  public getFundamentalsMap(): Map<string, FundamentalProfile> {
    this.ensureLoaded();
    return this.fundamentalsBySymbol;
  }

  public getHistoryForSymbol(symbol: string): DailyBhavRow[] {
    this.ensureLoaded();
    return this.historyBySymbol.get(symbol.trim().toUpperCase()) ?? [];
  }

  public getSector1mReturnMap(): Map<string, number> {
    this.ensureLoaded();
    const sums = new Map<string, { sum: number; count: number }>();
    for (const r of this.screenerRows) {
      const sec = (r.providerSector || '').trim();
      if (!sec) continue;
      const hist = this.historyBySymbol.get(r.symbol);
      if (!hist || hist.length < 15) continue;
      const lookbackIdx = Math.max(0, hist.length - 22);
      const baseClose = hist[lookbackIdx]?.close;
      if (!baseClose || baseClose <= 0) continue;
      const ret1m = ((r.closePrice - baseClose) / baseClose) * 100;
      const key = sec.toUpperCase();
      const cur = sums.get(key) || { sum: 0, count: 0 };
      cur.sum += ret1m;
      cur.count += 1;
      sums.set(key, cur);
    }
    const out = new Map<string, number>();
    for (const [sec, v] of sums.entries()) {
      if (v.count > 0) {
        out.set(sec, Number((v.sum / v.count).toFixed(2)));
      }
    }
    return out;
  }

  public getIpoOverview(): IpoOverviewData {
    this.ensureLoaded();
    const refDateIso = this.getAuditRefDateIso();
    const ipoRows = this.screenerRows
      .filter((r) => r.isIpo)
      .sort((a, b) => {
        const uRank = (s: UTurnStatus | null) =>
          s === 'CONFIRMED_SUPPORT'
            ? 5
            : s === 'ACTIVE_TRIGGER'
              ? 4
              : s === 'SUPPORT_HOLD'
                ? 3
                : s === 'IN_ZONE'
                  ? 2
                  : s === 'ABOVE_ZONE'
                    ? 1
                    : 0;
        const uDiff = uRank(b.uTurnStatus) - uRank(a.uTurnStatus);
        if (uDiff !== 0) return uDiff;
        return (b.rvol ?? -1) - (a.rvol ?? -1);
      });

    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let delivSum = 0;
    let delivCount = 0;
    let deliveryExpandingUp = 0;
    let deliveryExpandingDown = 0;
    let highRvolUp = 0;
    let highRvolDown = 0;
    let withEma = 0;
    let aboveEma = 0;
    let abUnionCount = 0;
    let under3mCount = 0;
    let under6mCount = 0;
    let under1yCount = 0;
    let highRvolCount = 0;
    let liquidCount = 0;
    let uTurnReadyCount = 0;
    let topTurnWarnCount = 0;
    let auditUnder1m = 0;
    let audit1To3m = 0;
    let auditOver3m = 0;
    let auditUnverified = 0;

    for (const r of ipoRows) {
      const chg = r.changePct ?? 0;
      if (chg > 0.05) advancers++;
      else if (chg < -0.05) decliners++;
      else unchanged++;

      if (r.delivPer !== null) {
        delivSum += r.delivPer;
        delivCount++;
      }
      if (r.delivQtyRatio !== null && r.delivQtyRatio >= 1.2) {
        if (chg > 0) deliveryExpandingUp++;
        else if (chg < 0) deliveryExpandingDown++;
      }
      if (r.rvolBand === 'HIGH') {
        highRvolCount++;
        if (chg > 0) highRvolUp++;
        else if (chg < 0) highRvolDown++;
      }
      if (r.aboveEma21 !== null) {
        withEma++;
        if (r.aboveEma21) aboveEma++;
      }
      if (
        r.deliveryCategory === 'A_AND_B' ||
        r.deliveryCategory === 'A_ONLY' ||
        r.deliveryCategory === 'B_ONLY'
      ) {
        abUnionCount++;
      }
      if (r.liquidityPass) liquidCount++;
      if (r.uTurnStatus === 'CONFIRMED_SUPPORT' || r.uTurnStatus === 'ACTIVE_TRIGGER') {
        uTurnReadyCount++;
      }
      if (r.topTurnStatus === 'CONFIRMED_TOP' || r.topTurnStatus === 'ACTIVE_TOP_TRIGGER') {
        topTurnWarnCount++;
      }

      const age = r.ipoAgeDays ?? null;
      if (age !== null) {
        if (age <= 90) under3mCount++;
        if (age <= 180) under6mCount++;
        if (age <= 365) under1yCount++;
      } else {
        under3mCount++;
        under6mCount++;
        under1yCount++;
      }

      const auditEntry = this.buildAuditEntryForRow(r, refDateIso);
      if (auditEntry.freshnessTier === 'UNDER_1M') auditUnder1m++;
      else if (auditEntry.freshnessTier === 'ONE_TO_3M') audit1To3m++;
      else if (auditEntry.freshnessTier === 'OVER_3M') auditOver3m++;
      else auditUnverified++;
    }

    const adTotal = advancers + decliners;
    const breadthPct = adTotal > 0 ? (advancers / adTotal) * 100 : 50;
    const avgDeliveryPct = delivCount > 0 ? delivSum / delivCount : 0;
    const delivExpTotal = deliveryExpandingUp + deliveryExpandingDown;
    const deliveryAccumPct =
      delivExpTotal > 0 ? (deliveryExpandingUp / delivExpTotal) * 100 : breadthPct;
    const rvolTotal = highRvolUp + highRvolDown;
    const highRvolUpPct = rvolTotal > 0 ? (highRvolUp / rvolTotal) * 100 : breadthPct;
    const aboveEma21Pct = withEma > 0 ? (aboveEma / withEma) * 100 : 50;
    const unionPct = ipoRows.length > 0 ? (abUnionCount / ipoRows.length) * 100 : 0;

    const rawScore =
      deliveryAccumPct * 0.35 +
      highRvolUpPct * 0.25 +
      breadthPct * 0.2 +
      aboveEma21Pct * 0.2;
    const score = ipoRows.length > 0 ? Math.max(0, Math.min(100, Math.round(rawScore))) : 50;
    const status: MarketSentiment['status'] =
      score >= 58 ? 'BULLISH' : score <= 42 ? 'BEARISH' : 'NEUTRAL';

    const summary =
      ipoRows.length === 0
        ? 'No recent IPOs (<1 year) detected yet; run Quote Calendar & IPO Sync to scan first-trade dates across all NSE symbols.'
        : status === 'BULLISH'
          ? `IPO cohort (<1Y, ${ipoRows.length} stocks) shows strong institutional accumulation (${deliveryExpandingUp} up vs ${deliveryExpandingDown} down on >=1.2x DelivQty) with ${uTurnReadyCount} U-Turn Ready setups.`
          : status === 'BEARISH'
            ? `Post-listing distribution pressure across recent IPOs (${deliveryExpandingDown} down vs ${deliveryExpandingUp} up on >=1.2x DelivQty); wait for U-Turn zone confirmation.`
            : `Selective IPO rotation (${advancers} adv / ${decliners} dec · Avg Deliv ${avgDeliveryPct.toFixed(1)}%) — focus on liquid U-Turn Confirmed/Trigger IPOs.`;

    return {
      asOfDate: this.latestSessionDate,
      cutoffDays: 365,
      sentiment: {
        status,
        score,
        asOfDate: this.latestSessionDate,
        advancers,
        decliners,
        unchanged,
        breadthPct: Number(breadthPct.toFixed(1)),
        avgDeliveryPct: Number(avgDeliveryPct.toFixed(1)),
        deliveryExpandingUp,
        deliveryExpandingDown,
        deliveryAccumPct: Number(deliveryAccumPct.toFixed(1)),
        highRvolUp,
        highRvolDown,
        aboveEma21Pct: Number(aboveEma21Pct.toFixed(1)),
        unionPct: Number(unionPct.toFixed(1)),
        summary,
      },
      stats: {
        totalIpos: ipoRows.length,
        under3mCount,
        under6mCount,
        under1yCount,
        deliveryABCount: abUnionCount,
        highRvolCount,
        liquidCount,
        uTurnReadyCount,
        topTurnWarnCount,
        auditUnder1m,
        audit1To3m,
        auditOver3m,
        auditUnverified,
      },
      rows: ipoRows,
    };
  }

  public getScreenerSessionMeta(): {
    latestDate: string;
    sessionDates: string[];
    rows: ScreenerRow[];
  } {
    this.ensureLoaded();
    return {
      latestDate: this.latestSessionDate,
      sessionDates: [...this.sessionDates],
      rows: this.screenerRows,
    };
  }

  public getT1T2SnapshotForDate(targetDate: string): Array<{
    symbol: string;
    companyName: string;
    sector: string;
    isIpo: boolean;
    listingDate: string;
    sessionsCount: number;
    swingTier: 'TIER_1_READY' | 'TIER_2_ACCUMULATION';
    closePrice: number;
    changePct: number | null;
    rvol: number | null;
    delivPer: number | null;
    delivQtyRatio: number | null;
    rsi14: number | null;
    ema21: number | null;
    aboveEma21: boolean | null;
    avgTurnover20DCr: number | null;
  }> {
    this.ensureLoaded();
    if (!targetDate) return [];

    if (targetDate === this.latestSessionDate) {
      return this.screenerRows
        .filter(
          (r) =>
            r.swingTier === 'TIER_1_READY' || r.swingTier === 'TIER_2_ACCUMULATION'
        )
        .map((r) => ({
          symbol: r.symbol,
          companyName: r.companyName || '',
          sector: r.providerSector || (r.isIpo ? 'IPO / Recent Listings' : ''),
          isIpo: r.isIpo,
          listingDate: r.listingDate,
          sessionsCount: r.sessionsCount,
          swingTier: r.swingTier as 'TIER_1_READY' | 'TIER_2_ACCUMULATION',
          closePrice: r.closePrice,
          changePct: r.changePct,
          rvol: r.rvol,
          delivPer: r.delivPer,
          delivQtyRatio: r.delivQtyRatio,
          rsi14: r.rsi14,
          ema21: r.ema21,
          aboveEma21: r.aboveEma21,
          avgTurnover20DCr: r.avgTurnover20DCr,
        }));
    }

    const targetMs = Date.parse(`${targetDate}T00:00:00Z`);
    if (!Number.isFinite(targetMs)) return [];
    const cutoff30dMs = targetMs - 29 * 24 * 60 * 60 * 1000;
    const ipoCutoffDate = this.sessionDates.length > 3 ? this.sessionDates[3] : '';
    const out: Array<{
      symbol: string;
      companyName: string;
      sector: string;
      isIpo: boolean;
      listingDate: string;
      sessionsCount: number;
      swingTier: 'TIER_1_READY' | 'TIER_2_ACCUMULATION';
      closePrice: number;
      changePct: number | null;
      rvol: number | null;
      delivPer: number | null;
      delivQtyRatio: number | null;
      rsi14: number | null;
      ema21: number | null;
      aboveEma21: boolean | null;
      avgTurnover20DCr: number | null;
    }> = [];

    for (const [sym, fullHistory] of this.historyBySymbol.entries()) {
      const history = fullHistory.filter((h) => h.date <= targetDate);
      const latest = history[history.length - 1];
      if (!latest || latest.date !== targetDate || latest.close === null) continue;
      if (this.isEtfOrFundSymbol(sym, this.fundamentalsBySymbol.get(sym)?.companyName || '')) {
        continue;
      }

      const curRow = this.screenerBySymbol.get(sym);
      const fundPre = this.fundamentalsBySymbol.get(sym);
      const bhavListingDate = history[0]?.date || '';
      const sessionsCount = history.length;
      const hasKnownFirstTrade = Boolean(
        fundPre?.firstTradeDateIso && this.isValidIsoDate(fundPre.firstTradeDateIso)
      );
      const listingDate = hasKnownFirstTrade
        ? (fundPre!.firstTradeDateIso as string)
        : bhavListingDate;

      const knownFirstTradeAge = hasKnownFirstTrade
        ? this.diffDaysBetween(targetDate, fundPre!.firstTradeDateIso as string)
        : null;
      const isRecentBhavIpo = Boolean(
        !sym.endsWith('-RE') &&
          !hasKnownFirstTrade &&
          !this.multiYearCsvSymbols.has(sym) &&
          ipoCutoffDate &&
          bhavListingDate >= ipoCutoffDate &&
          sessionsCount <= 15
      );
      const isIpo =
        curRow?.isIpo ??
        Boolean(
          !sym.endsWith('-RE') &&
            !this.multiYearCsvSymbols.has(sym) &&
            ((knownFirstTradeAge !== null && knownFirstTradeAge <= 365) || isRecentBhavIpo)
        );

      const seriesHistory = history.filter((d) => d.series === latest.series);
      const window30d = seriesHistory.filter((d) => {
        const ms = Date.parse(`${d.date}T00:00:00Z`);
        return ms >= cutoff30dMs && d.delivPer !== null;
      });

      let dailyGt60Count = 0;
      let rolling5dGt60Count = 0;
      for (let i = 0; i < window30d.length; i++) {
        if ((window30d[i].delivPer ?? 0) >= 60.0) dailyGt60Count++;
        if (i >= 4) {
          const avg5 =
            ((window30d[i - 4].delivPer ?? 0) +
              (window30d[i - 3].delivPer ?? 0) +
              (window30d[i - 2].delivPer ?? 0) +
              (window30d[i - 1].delivPer ?? 0) +
              (window30d[i].delivPer ?? 0)) /
            5;
          if (avg5 >= 60.0) rolling5dGt60Count++;
        }
      }

      let isDeliveryAB = false;
      if (window30d.length < 5) {
        if (isIpo && window30d.length >= 2) {
          const avgDelivShort =
            window30d.reduce((acc, d) => acc + (d.delivPer ?? 0), 0) / window30d.length;
          const passA = avgDelivShort >= 60.0;
          const passB = dailyGt60Count >= Math.ceil(window30d.length * 0.6);
          isDeliveryAB = passA || passB;
        }
      } else {
        isDeliveryAB = rolling5dGt60Count >= 5 || dailyGt60Count >= 5;
      }
      if (!isDeliveryAB) continue;

      const minLiqLookback = isIpo ? 2 : 20;
      if (history.length < minLiqLookback) continue;
      const liqWindow = history.slice(-20);
      const avgTurnover20DCr =
        liqWindow.reduce((acc, s) => acc + s.turnoverLacs, 0) / liqWindow.length / 100;
      if (avgTurnover20DCr < 1.5) continue;

      const priorSessions = history.slice(0, -1);
      const rvol = calculateLatestRvol(
        history.map((s) => s.volume),
        20
      );
      const rvolBand: RvolBand =
        rvol === null ? 'WAIT_FOR_DATA' : rvol > 1.5 ? 'HIGH' : 'LOW';
      let delivQtyRatio: number | null = null;
      const minDelivLookback = isIpo ? 2 : 20;
      if (priorSessions.length >= minDelivLookback) {
        const prevWindow = priorSessions.slice(-20);
        const prevDeliv = prevWindow
          .map((s) => s.delivQty)
          .filter((q): q is number => q !== null && q > 0);
        const minDelivCount = isIpo ? 2 : 10;
        if (prevDeliv.length >= minDelivCount && latest.delivQty !== null) {
          const avgDelivQty = prevDeliv.reduce((a, b) => a + b, 0) / prevDeliv.length;
          if (avgDelivQty > 0) delivQtyRatio = latest.delivQty / avgDelivQty;
        }
      }
      if ((delivQtyRatio ?? 0) < 1.2) continue;

      const closes = history.map((d) => d.close);
      const emaPeriod = closes.length >= 21 ? 21 : isIpo && closes.length >= 3 ? closes.length : 21;
      const ema21Series = this.computeEmaSeries(closes, emaPeriod);
      const ema21 = ema21Series[ema21Series.length - 1] ?? null;
      const aboveEma21 = ema21 !== null ? latest.close > ema21 : null;
      if (aboveEma21 !== true) continue;

      const rsi14 =
        closes.length >= 15
          ? this.computeRsi14(closes, 14)
          : isIpo && closes.length >= 4
            ? this.computeRsi14(closes, closes.length - 1)
            : null;
      const changePct =
        latest.prevClose && latest.prevClose > 0
          ? ((latest.close - latest.prevClose) / latest.prevClose) * 100
          : null;

      const classified = classifySwingTier({
        avgTurnover20DCr,
        liquidityPass: true,
        deliveryCategory: 'A_AND_B',
        aboveEma21,
        delivQtyRatio,
        rvol,
        rvolBand,
        changePct,
        rsi14,
      });
      if (classified !== 'TIER_1_READY' && classified !== 'TIER_2_ACCUMULATION') continue;
      const swingTier: 'TIER_1_READY' | 'TIER_2_ACCUMULATION' = classified;

      out.push({
        symbol: sym,
        companyName: curRow?.companyName || fundPre?.companyName || '',
        sector: curRow?.providerSector || fundPre?.providerSector || (isIpo ? 'IPO / Recent Listings' : ''),
        isIpo,
        listingDate: curRow?.listingDate || listingDate,
        sessionsCount,
        swingTier,
        closePrice: latest.close,
        changePct,
        rvol,
        delivPer: latest.delivPer,
        delivQtyRatio,
        rsi14,
        ema21,
        aboveEma21,
        avgTurnover20DCr,
      });
    }

    return out;
  }
}

function computeSeasonality(history: DailyBhavRow[]) {
  const monthReturns: Record<string, number[]> = {
    Jan: [], Feb: [], Mar: [], Apr: [], May: [], Jun: [],
    Jul: [], Aug: [], Sep: [], Oct: [], Nov: [], Dec: [],
  };
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (!curr.date || curr.close === null || prev.close === null || prev.close <= 0) continue;
    const d = new Date(curr.date);
    if (isNaN(d.getTime())) continue;
    const mName = monthNames[d.getMonth()];
    const ret = ((curr.close - prev.close) / prev.close) * 100;
    monthReturns[mName].push(ret);
  }
  const currentMonthName = monthNames[new Date().getMonth()];
  const seasonalityList = monthNames.map((m) => {
    const arr = monthReturns[m];
    const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return { month: m, avgReturnPct: Number(avg.toFixed(2)), isPositive: avg >= 0 };
  });
  const currentMonthItem = seasonalityList.find((s) => s.month === currentMonthName);
  const currentMonthNegative = currentMonthItem ? currentMonthItem.avgReturnPct < 0 : false;
  return { seasonalityList, currentMonthNegative };
}

export const nsePipeline = new NsePipelineEngine();

