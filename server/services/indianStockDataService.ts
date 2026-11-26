import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LRUCache } from 'lru-cache';
import {
  ScreenerClient,
  type ApiResponse,
  type CompanyData,
  type CompanyMode,
  type FinancialTable,
  type TopRatio,
} from 'screener-india';
import { BSE, NSEClient } from 'nse-bse-api';
import type { QuoteData as BseQuoteData } from 'nse-bse-api/bse';
import type { EquityQuoteData, EquityHistoricalParams } from 'nse-bse-api/nse';
import { evaluateQuoteFreshness } from '../../src/utils/quoteFreshness.ts';

// ============================================================================
// Strictly Typed Domain Models
// ============================================================================

export type ExchangeCode = 'NSE' | 'BSE';

export interface ParsedTableRow {
  label: string;
  valuesByPeriod: Record<string, number | null>;
  rawByPeriod: Record<string, string>;
}

export interface QuarterlyResultPeriod {
  period: string;
  salesCr: number | null;
  expensesCr: number | null;
  operatingProfitCr: number | null;
  opmPct: number | null;
  otherIncomeCr: number | null;
  interestCr: number | null;
  depreciationCr: number | null;
  pbtCr: number | null;
  taxPct: number | null;
  netProfitCr: number | null;
  eps: number | null;
}

export interface BalanceSheetPeriod {
  period: string;
  equityCapitalCr: number | null;
  reservesCr: number | null;
  borrowingsCr: number | null;
  otherLiabilitiesCr: number | null;
  totalLiabilitiesCr: number | null;
  fixedAssetsCr: number | null;
  cwipCr: number | null;
  investmentsCr: number | null;
  otherAssetsCr: number | null;
  totalAssetsCr: number | null;
  debtToEquity: number | null;
}

export interface ScreenerShareholdingSnapshot {
  period: string;
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  publicPct: number | null;
}

export interface ScreenerFundamentals {
  symbol: string;
  companyName: string;
  mode: CompanyMode;
  sourceUrl: string;
  fetchedAtUtc: string;
  topRatios: {
    marketCapCr: number | null;
    currentPrice: number | null;
    high52Week: number | null;
    low52Week: number | null;
    peRatio: number | null;
    bookValue: number | null;
    dividendYieldPct: number | null;
    rocePct: number | null;
    roePct: number | null;
    debtToEquity: number | null;
    faceValue: number | null;
  };
  peRatio: number | null;
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  quarterlyResults: {
    periods: string[];
    records: QuarterlyResultPeriod[];
    rawRows: ParsedTableRow[];
  };
  balanceSheet: {
    periods: string[];
    records: BalanceSheetPeriod[];
    rawRows: ParsedTableRow[];
  };
  profitLossRows: ParsedTableRow[];
  cashFlowRows: ParsedTableRow[];
  ratiosRows: ParsedTableRow[];
  shareholding: ScreenerShareholdingSnapshot[];
  pros: string[];
  cons: string[];
  warnings: string[];
}

export interface LiveQuote {
  symbol: string;
  exchange: ExchangeCode;
  bseScripCode?: string;
  companyName?: string;
  lastPrice: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  timestamp: string;
  lastUpdated?: string | null;
  quoteDateIst?: string | null;
  systemDateIst?: string;
  isStale?: boolean;
  staleReason?: string | null;
  source: 'nse-bse-api:NSE' | 'nse-bse-api:BSE';
}

export interface HistoricalPriceBar {
  symbol: string;
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number | null;
  volume: number;
  turnoverInr: number | null;
  series: string;
}

export interface CacheMeta {
  fromCache: boolean;
  staleFallback: boolean;
  dedupedInFlight: boolean;
  fetchedAtUtc: string;
}

export interface ServiceResult<T> {
  ok: boolean;
  symbol: string;
  data: T | null;
  cacheMeta: CacheMeta;
  warnings: string[];
  error: string | null;
}

export interface StockSnapshot {
  symbol: string;
  fundamentals: ServiceResult<ScreenerFundamentals>;
  liveQuote: ServiceResult<LiveQuote>;
  historicalPrices: ServiceResult<HistoricalPriceBar[]>;
}

export interface ScreenerClientLike {
  getCompany(symbol: string, mode?: CompanyMode): Promise<ApiResponse<CompanyData>>;
}

export interface NseClientLike {
  quote(params: { symbol: string; type?: 'equity' | 'fno'; section?: 'trade_info' }): Promise<Record<string, unknown>>;
  equityQuote(symbol: string): Promise<EquityQuoteData>;
  fetch_equity_historical_data(params: EquityHistoricalParams): Promise<Record<string, unknown>[]>;
}

export interface BseClientLike {
  getScripCode(scripname: string): Promise<string>;
  quote(scripcode: string): Promise<BseQuoteData>;
}

export interface IndianStockDataServiceConfig {
  fundamentalsCacheMax?: number;
  fundamentalsTtlMs?: number;
  quoteCacheMax?: number;
  quoteTtlMs?: number;
  historicalCacheMax?: number;
  historicalTtlMs?: number;
  staleCacheMax?: number;
  staleTtlMs?: number;
  screenerCookies?: string;
  screenerMinIntervalMs?: number;
  nseDownloadDir?: string;
  screenerClient?: ScreenerClientLike;
  nseClient?: NseClientLike;
  bseClient?: BseClientLike;
}

export interface CacheHealthStats {
  fundamentalsCachedCount: number;
  liveQuotesCachedCount: number;
  historicalCachedCount: number;
  staleFallbackCount: number;
  inFlightCount: number;
  metrics: {
    fundamentalsHits: number;
    fundamentalsMisses: number;
    quoteHits: number;
    quoteMisses: number;
    historicalHits: number;
    historicalMisses: number;
    staleFallbacks: number;
    dedupedCalls: number;
    upstreamErrors: number;
  };
}

// ============================================================================
// Parsing & Normalization Helpers
// ============================================================================

const MONTH_INDEX: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

export function normalizeSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO)$/i, '');
}

export function parseNumericValue(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const cleaned = raw
    .replace(/,/g, '')
    .replace(/₹/g, '')
    .replace(/Cr\.?/gi, '')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned === '-' || cleaned === '--' || cleaned === 'N/A' || cleaned === 'NA') {
    return null;
  }

  // Handle accounting negatives like "(123.45)"
  const parenMatch = cleaned.match(/^\(([-+]?\d+(?:\.\d+)?)\)$/);
  if (parenMatch) {
    const n = Number(parenMatch[1]);
    return Number.isFinite(n) ? -n : null;
  }

  const numMatch = cleaned.match(/^[-+]?\d+(?:\.\d+)?/);
  if (!numMatch) return null;
  const parsed = Number(numMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabel(label: string): string {
  return label
    .replace(/\+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseTopRatioNumber(topRatios: TopRatio[], matchers: string[]): number | null {
  for (const ratio of topRatios) {
    const name = normalizeLabel(ratio.name);
    if (matchers.some((m) => name.includes(m))) {
      const val = parseNumericValue(ratio.value);
      if (val !== null) return val;
    }
  }
  return null;
}

function parseHighLow52Week(topRatios: TopRatio[]): { high: number | null; low: number | null } {
  for (const ratio of topRatios) {
    const name = normalizeLabel(ratio.name);
    if (name.includes('high / low') || name.includes('high/low')) {
      const parts = ratio.value.split('/');
      if (parts.length >= 2) {
        return {
          high: parseNumericValue(parts[0]),
          low: parseNumericValue(parts[1]),
        };
      }
    }
  }
  return { high: null, low: null };
}

function extractPeriodHeaders(table?: FinancialTable): string[] {
  if (!table || !Array.isArray(table.headers)) return [];
  // First header is typically empty "" (row label column)
  return table.headers.slice(1).map((h) => h.trim()).filter(Boolean);
}

export function parseFinancialTableRows(table?: FinancialTable): ParsedTableRow[] {
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
    return [];
  }

  const labelKey = table.headers[0] ?? 'col_0';
  const periodKeys = table.headers.slice(1).map((h) => h.trim()).filter(Boolean);
  const parsedRows: ParsedTableRow[] = [];

  for (const row of table.rows) {
    const rawLabel =
      row[labelKey] ??
      row[''] ??
      row['col_0'] ??
      Object.values(row)[0] ??
      '';
    const label = String(rawLabel).replace(/\s+/g, ' ').trim();
    if (!label) continue;

    const valuesByPeriod: Record<string, number | null> = {};
    const rawByPeriod: Record<string, string> = {};

    for (const period of periodKeys) {
      const rawCell = row[period] ?? '';
      rawByPeriod[period] = String(rawCell).trim();
      valuesByPeriod[period] = parseNumericValue(rawCell);
    }

    parsedRows.push({ label, valuesByPeriod, rawByPeriod });
  }

  return parsedRows;
}

function findRowMetric(
  rows: ParsedTableRow[],
  period: string,
  matchers: string[],
  exactFirst = false
): number | null {
  if (exactFirst) {
    for (const row of rows) {
      const norm = normalizeLabel(row.label);
      if (matchers.some((m) => norm === m)) {
        return row.valuesByPeriod[period] ?? null;
      }
    }
  }

  for (const row of rows) {
    const norm = normalizeLabel(row.label);
    if (matchers.some((m) => norm.includes(m))) {
      return row.valuesByPeriod[period] ?? null;
    }
  }
  return null;
}

function parseQuarterlyResults(table?: FinancialTable): {
  periods: string[];
  records: QuarterlyResultPeriod[];
  rawRows: ParsedTableRow[];
} {
  const periods = extractPeriodHeaders(table);
  const rawRows = parseFinancialTableRows(table);

  const records: QuarterlyResultPeriod[] = periods.map((period) => ({
    period,
    salesCr: findRowMetric(rawRows, period, ['sales', 'revenue', 'interest earned']),
    expensesCr: findRowMetric(rawRows, period, ['expenses']),
    operatingProfitCr: findRowMetric(rawRows, period, ['operating profit', 'financing profit']),
    opmPct: findRowMetric(rawRows, period, ['opm %', 'financing margin %']),
    otherIncomeCr: findRowMetric(rawRows, period, ['other income']),
    interestCr: findRowMetric(rawRows, period, ['interest'], true),
    depreciationCr: findRowMetric(rawRows, period, ['depreciation']),
    pbtCr: findRowMetric(rawRows, period, ['profit before tax']),
    taxPct: findRowMetric(rawRows, period, ['tax %']),
    netProfitCr: findRowMetric(rawRows, period, ['net profit']),
    eps: findRowMetric(rawRows, period, ['eps in rs', 'eps']),
  }));

  return { periods, records, rawRows };
}

function parseBalanceSheet(table?: FinancialTable): {
  periods: string[];
  records: BalanceSheetPeriod[];
  rawRows: ParsedTableRow[];
} {
  const periods = extractPeriodHeaders(table);
  const rawRows = parseFinancialTableRows(table);

  const records: BalanceSheetPeriod[] = periods.map((period) => {
    const equityCapitalCr = findRowMetric(rawRows, period, ['equity capital', 'share capital']);
    const reservesCr = findRowMetric(rawRows, period, ['reserves']);
    const borrowingsCr = findRowMetric(rawRows, period, ['borrowings', 'debt']);
    const otherLiabilitiesCr = findRowMetric(rawRows, period, ['other liabilities']);
    const totalLiabilitiesCr = findRowMetric(rawRows, period, ['total liabilities']);
    const fixedAssetsCr = findRowMetric(rawRows, period, ['fixed assets']);
    const cwipCr = findRowMetric(rawRows, period, ['cwip']);
    const investmentsCr = findRowMetric(rawRows, period, ['investments']);
    const otherAssetsCr = findRowMetric(rawRows, period, ['other assets']);
    const totalAssetsCr = findRowMetric(rawRows, period, ['total assets']);

    let debtToEquity: number | null = null;
    if (borrowingsCr !== null && equityCapitalCr !== null && reservesCr !== null) {
      const totalEquity = equityCapitalCr + reservesCr;
      if (totalEquity > 0) {
        debtToEquity = Number((borrowingsCr / totalEquity).toFixed(2));
      }
    }

    return {
      period,
      equityCapitalCr,
      reservesCr,
      borrowingsCr,
      otherLiabilitiesCr,
      totalLiabilitiesCr,
      fixedAssetsCr,
      cwipCr,
      investmentsCr,
      otherAssetsCr,
      totalAssetsCr,
      debtToEquity,
    };
  });

  return { periods, records, rawRows };
}

function parseShareholding(table?: FinancialTable): ScreenerShareholdingSnapshot[] {
  const periods = extractPeriodHeaders(table);
  const rawRows = parseFinancialTableRows(table);
  return periods.map((period) => ({
    period,
    promoterPct: findRowMetric(rawRows, period, ['promoters']),
    fiiPct: findRowMetric(rawRows, period, ['fiis', 'fii']),
    diiPct: findRowMetric(rawRows, period, ['diis', 'dii']),
    publicPct: findRowMetric(rawRows, period, ['public']),
  }));
}

export function transformScreenerCompanyData(
  symbol: string,
  response: ApiResponse<CompanyData>
): ScreenerFundamentals {
  const data = response.data;
  const topRatios = Array.isArray(data.topRatios) ? data.topRatios : [];
  const highLow = parseHighLow52Week(topRatios);

  const marketCapCr = parseTopRatioNumber(topRatios, ['market cap']);
  const currentPrice = parseTopRatioNumber(topRatios, ['current price']);
  const peRatio = parseTopRatioNumber(topRatios, ['stock p/e', 'p/e']);
  const bookValue = parseTopRatioNumber(topRatios, ['book value']);
  const dividendYieldPct = parseTopRatioNumber(topRatios, ['dividend yield']);
  const faceValue = parseTopRatioNumber(topRatios, ['face value']);

  const quarterlyResults = parseQuarterlyResults(data.quarters);
  const balanceSheet = parseBalanceSheet(data.balanceSheet);
  const profitLossRows = parseFinancialTableRows(data.profitLoss);
  const cashFlowRows = parseFinancialTableRows(data.cashFlow);
  const ratiosRows = parseFinancialTableRows(data.ratios);
  const shareholding = parseShareholding(data.shareholding);

  // ROE & ROCE from top ratios, with ratios-table fallback if omitted in topRatios
  const ratioPeriods = extractPeriodHeaders(data.ratios);
  const latestRatioPeriod = ratioPeriods[ratioPeriods.length - 1];

  const roePct =
    parseTopRatioNumber(topRatios, ['roe']) ??
    (latestRatioPeriod ? findRowMetric(ratiosRows, latestRatioPeriod, ['roe %', 'roe']) : null);

  const rocePct =
    parseTopRatioNumber(topRatios, ['roce']) ??
    (latestRatioPeriod ? findRowMetric(ratiosRows, latestRatioPeriod, ['roce %', 'roce']) : null);

  // Debt/Equity from top ratios or ratios table or latest Balance Sheet (Borrowings / Total Equity)
  const latestBsRecord = balanceSheet.records[balanceSheet.records.length - 1];
  const debtToEquity =
    parseTopRatioNumber(topRatios, ['debt to equity', 'debt / eq']) ??
    (latestRatioPeriod
      ? findRowMetric(ratiosRows, latestRatioPeriod, ['debt to equity', 'debt/equity'])
      : null) ??
    latestBsRecord?.debtToEquity ??
    null;

  const cleanName = (data.name || '')
    .replace(/\s+share\s+price$/i, '')
    .trim();

  return {
    symbol: normalizeSymbol(data.symbol || symbol),
    companyName: cleanName || normalizeSymbol(symbol),
    mode: data.mode || 'consolidated',
    sourceUrl: response.meta?.sourceUrl || `https://www.screener.in/company/${normalizeSymbol(symbol)}/`,
    fetchedAtUtc: response.meta?.fetchedAt || new Date().toISOString(),
    topRatios: {
      marketCapCr,
      currentPrice,
      high52Week: highLow.high,
      low52Week: highLow.low,
      peRatio,
      bookValue,
      dividendYieldPct,
      rocePct,
      roePct,
      debtToEquity,
      faceValue,
    },
    peRatio,
    roePct,
    rocePct,
    debtToEquity,
    quarterlyResults,
    balanceSheet,
    profitLossRows,
    cashFlowRows,
    ratiosRows,
    shareholding,
    pros: data.analysis?.pros ?? [],
    cons: data.analysis?.cons ?? [],
    warnings: response.warnings ?? [],
  };
}

function normalizeDateToIso(raw: unknown): string | null {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const str = String(raw ?? '').trim();
  if (!str) return null;

  // YYYY-MM-DD (or ISO timestamp)
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD-MMM-YYYY or DD-MM-YYYY (common in NSE NextApi responses, e.g. "21-Nov-2026" or "21-11-2026")
  const dmyAlpha = str.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/);
  if (dmyAlpha) {
    const dd = dmyAlpha[1].padStart(2, '0');
    const mm = MONTH_INDEX[dmyAlpha[2].toLowerCase()];
    if (mm) return `${dmyAlpha[3]}-${mm}-${dd}`;
  }

  const dmyNum = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyNum) {
    return `${dmyNum[3]}-${dmyNum[2].padStart(2, '0')}-${dmyNum[1].padStart(2, '0')}`;
  }

  const parsed = Date.parse(str);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

export function normalizeHistoricalRows(
  symbol: string,
  rawRows: Record<string, unknown>[],
  defaultSeries = 'EQ'
): HistoricalPriceBar[] {
  const sym = normalizeSymbol(symbol);
  const byDate = new Map<string, HistoricalPriceBar>();

  for (const row of rawRows) {
    const dateStr = normalizeDateToIso(
      row.mtimestamp ??
        row.CH_TIMESTAMP ??
        row.mTIMESTAMP ??
        row.TIMESTAMP ??
        row.date ??
        row.Date
    );
    if (!dateStr) continue;

    const close =
      parseNumericValue(
        row.chClosingPrice ??
          row.CH_CLOSING_PRICE ??
          row.CLOSE ??
          row.close ??
          row.chLastTradedPrice ??
          row.CH_LAST_TRADED_PRICE
      ) ?? null;
    const open =
      parseNumericValue(row.chOpeningPrice ?? row.CH_OPENING_PRICE ?? row.OPEN ?? row.open) ??
      close;
    const high =
      parseNumericValue(
        row.chTradeHighPrice ?? row.CH_TRADE_HIGH_PRICE ?? row.HIGH ?? row.high
      ) ?? close;
    const low =
      parseNumericValue(
        row.chTradeLowPrice ?? row.CH_TRADE_LOW_PRICE ?? row.LOW ?? row.low
      ) ?? close;
    const ltp = parseNumericValue(
      row.chLastTradedPrice ?? row.CH_LAST_TRADED_PRICE ?? row.LTP ?? row.ltp
    );
    const volume =
      parseNumericValue(
        row.chTotTradedQty ?? row.CH_TOT_TRADED_QTY ?? row.VOLUME ?? row.volume
      ) ?? 0;
    const turnoverInr = parseNumericValue(
      row.chTotTradedVal ?? row.CH_TOT_TRADED_VAL ?? row.VALUE ?? row.turnover
    );
    const series =
      String(row.chSeries ?? row.CH_SERIES ?? row.SERIES ?? defaultSeries).trim() ||
      defaultSeries;

    if (close === null || open === null || high === null || low === null || close <= 0) {
      continue;
    }

    byDate.set(dateStr, {
      symbol: sym,
      date: dateStr,
      open,
      high,
      low,
      close,
      ltp,
      volume: Math.max(0, Math.round(volume)),
      turnoverInr,
      series,
    });
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function readNestedRecord(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const val = (obj as Record<string, unknown>)[key];
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : null;
}

// ============================================================================
// Service Factory & LRU Caching Layer
// ============================================================================

interface CacheWrapper<T> {
  value: T;
  fetchedAtUtc: string;
}

export class IndianStockDataService {
  private readonly screener: ScreenerClientLike;
  private readonly nse: NseClientLike;
  private readonly bse: BseClientLike;

  private readonly fundamentalsCache: LRUCache<string, CacheWrapper<ScreenerFundamentals>>;
  private readonly liveQuoteCache: LRUCache<string, CacheWrapper<LiveQuote>>;
  private readonly historicalCache: LRUCache<string, CacheWrapper<HistoricalPriceBar[]>>;
  private readonly staleFundamentalsCache: LRUCache<string, CacheWrapper<ScreenerFundamentals>>;
  private readonly staleQuoteCache: LRUCache<string, CacheWrapper<LiveQuote>>;
  private readonly staleHistoricalCache: LRUCache<string, CacheWrapper<HistoricalPriceBar[]>>;

  private readonly inFlight = new Map<string, Promise<unknown>>();

  private metrics = {
    fundamentalsHits: 0,
    fundamentalsMisses: 0,
    quoteHits: 0,
    quoteMisses: 0,
    historicalHits: 0,
    historicalMisses: 0,
    staleFallbacks: 0,
    dedupedCalls: 0,
    upstreamErrors: 0,
  };

  constructor(config: IndianStockDataServiceConfig = {}) {
    const nseDir =
      config.nseDownloadDir ?? path.join(os.tmpdir(), 'nse-bse-api-cache');
    fs.mkdirSync(nseDir, { recursive: true });

    this.screener =
      config.screenerClient ??
      new ScreenerClient({
        cacheTtlMs: 0, // Managed by our unified LRUCache layer
        minIntervalMs: config.screenerMinIntervalMs ?? 350,
        maxRetries: 2,
        timeoutMs: 20_000,
        cookies: config.screenerCookies ?? process.env.SCREENER_COOKIES,
      });

    this.nse =
      config.nseClient ??
      new NSEClient(nseDir, {
        server: true,
        timeout: 12_000,
      });

    this.bse =
      config.bseClient ??
      new BSE({
        downloadFolder: nseDir,
        timeout: 12_000,
      });

    const staleMax = config.staleCacheMax ?? 500;
    const staleTtl = config.staleTtlMs ?? 7 * 24 * 60 * 60 * 1000;

    this.fundamentalsCache = new LRUCache<string, CacheWrapper<ScreenerFundamentals>>({
      max: config.fundamentalsCacheMax ?? 500,
      ttl: config.fundamentalsTtlMs ?? 12 * 60 * 60 * 1000, // 12 hours
      ttlAutopurge: false,
    });

    this.liveQuoteCache = new LRUCache<string, CacheWrapper<LiveQuote>>({
      max: config.quoteCacheMax ?? 500,
      ttl: config.quoteTtlMs ?? 30_000, // 30 seconds
      ttlAutopurge: false,
    });

    this.historicalCache = new LRUCache<string, CacheWrapper<HistoricalPriceBar[]>>({
      max: config.historicalCacheMax ?? 300,
      ttl: config.historicalTtlMs ?? 15 * 60 * 1000, // 15 minutes
      ttlAutopurge: false,
    });

    this.staleFundamentalsCache = new LRUCache<string, CacheWrapper<ScreenerFundamentals>>({
      max: staleMax,
      ttl: staleTtl,
    });
    this.staleQuoteCache = new LRUCache<string, CacheWrapper<LiveQuote>>({
      max: staleMax,
      ttl: staleTtl,
    });
    this.staleHistoricalCache = new LRUCache<string, CacheWrapper<HistoricalPriceBar[]>>({
      max: staleMax,
      ttl: staleTtl,
    });
  }

  /**
   * Fetch all NSE/BSE fundamental data (P/E, ROE, ROCE, Debt/Equity,
   * quarterly results, balance sheet) exclusively via `screener-india`.
   */
  async getFundamentals(
    symbol: string,
    options: { mode?: CompanyMode; forceRefresh?: boolean } = {}
  ): Promise<ServiceResult<ScreenerFundamentals>> {
    const sym = normalizeSymbol(symbol);
    if (!sym) {
      return {
        ok: false,
        symbol: '',
        data: null,
        cacheMeta: {
          fromCache: false,
          staleFallback: false,
          dedupedInFlight: false,
          fetchedAtUtc: '',
        },
        warnings: ['Empty symbol provided.'],
        error: 'Symbol is required.',
      };
    }

    const mode: CompanyMode = options.mode ?? 'consolidated';
    const cacheKey = `fund:${sym}:${mode}`;

    if (!options.forceRefresh) {
      const cached = this.fundamentalsCache.get(cacheKey);
      if (cached) {
        this.metrics.fundamentalsHits += 1;
        return {
          ok: true,
          symbol: sym,
          data: cached.value,
          cacheMeta: {
            fromCache: true,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: cached.fetchedAtUtc,
          },
          warnings: cached.value.warnings,
          error: null,
        };
      }
    }

    const flightKey = `${cacheKey}:${options.forceRefresh ? '1' : '0'}`;
    const existing = this.inFlight.get(flightKey) as
      | Promise<ServiceResult<ScreenerFundamentals>>
      | undefined;

    if (existing) {
      this.metrics.dedupedCalls += 1;
      const shared = await existing;
      return {
        ...shared,
        cacheMeta: { ...shared.cacheMeta, dedupedInFlight: true },
      };
    }

    const task = (async (): Promise<ServiceResult<ScreenerFundamentals>> => {
      this.metrics.fundamentalsMisses += 1;
      const warnings: string[] = [];

      try {
        let response: ApiResponse<CompanyData> | null = null;
        let primaryErr: Error | null = null;

        try {
          response = await this.screener.getCompany(sym, mode);
        } catch (err) {
          primaryErr = err instanceof Error ? err : new Error(String(err));
        }

        // Fall back to standalone ("default") if consolidated page is missing or empty
        if (
          mode === 'consolidated' &&
          (!response ||
            (response.data.topRatios.length === 0 &&
              (!response.data.quarters || response.data.quarters.rows.length === 0)))
        ) {
          try {
            const standaloneRes = await this.screener.getCompany(sym, 'default');
            if (
              standaloneRes.data.topRatios.length > 0 ||
              (standaloneRes.data.quarters?.rows.length ?? 0) > 0
            ) {
              response = standaloneRes;
              warnings.push('Consolidated Screener view unavailable; used standalone financials.');
            }
          } catch (fallbackErr) {
            if (!primaryErr) {
              primaryErr =
                fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
            }
          }
        }

        if (!response) {
          throw primaryErr ?? new Error(`Screener.in returned no data for ${sym}`);
        }

        const parsed = transformScreenerCompanyData(sym, response);
        const allWarnings = Array.from(new Set([...warnings, ...parsed.warnings]));
        parsed.warnings = allWarnings;

        const hasMeaningfulData =
          parsed.peRatio !== null ||
          parsed.roePct !== null ||
          parsed.rocePct !== null ||
          parsed.quarterlyResults.records.length > 0 ||
          parsed.balanceSheet.records.length > 0;

        if (!hasMeaningfulData) {
          throw new Error(`Screener.in returned empty fundamental tables for ${sym}`);
        }

        const wrapped: CacheWrapper<ScreenerFundamentals> = {
          value: parsed,
          fetchedAtUtc: parsed.fetchedAtUtc,
        };
        this.fundamentalsCache.set(cacheKey, wrapped);
        this.staleFundamentalsCache.set(cacheKey, wrapped);

        return {
          ok: true,
          symbol: sym,
          data: parsed,
          cacheMeta: {
            fromCache: false,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: parsed.fetchedAtUtc,
          },
          warnings: allWarnings,
          error: null,
        };
      } catch (err) {
        this.metrics.upstreamErrors += 1;
        const message = err instanceof Error ? err.message : String(err);
        const stale = this.staleFundamentalsCache.get(cacheKey);

        if (stale) {
          this.metrics.staleFallbacks += 1;
          return {
            ok: true,
            symbol: sym,
            data: stale.value,
            cacheMeta: {
              fromCache: true,
              staleFallback: true,
              dedupedInFlight: false,
              fetchedAtUtc: stale.fetchedAtUtc,
            },
            warnings: [
              ...warnings,
              `Screener.in fetch failed (${message}); served stale cached fundamentals.`,
            ],
            error: null,
          };
        }

        return {
          ok: false,
          symbol: sym,
          data: null,
          cacheMeta: {
            fromCache: false,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: '',
          },
          warnings,
          error: message,
        };
      }
    })();

    this.inFlight.set(flightKey, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  /**
   * Fetch live equity quote exclusively via `nse-bse-api` (NSEClient / BSE).
   */
  async getLiveQuote(
    symbol: string,
    options: { exchange?: 'AUTO' | ExchangeCode; bseScripCode?: string; forceRefresh?: boolean } = {}
  ): Promise<ServiceResult<LiveQuote>> {
    const sym = normalizeSymbol(symbol);
    if (!sym) {
      return {
        ok: false,
        symbol: '',
        data: null,
        cacheMeta: {
          fromCache: false,
          staleFallback: false,
          dedupedInFlight: false,
          fetchedAtUtc: '',
        },
        warnings: ['Empty symbol provided.'],
        error: 'Symbol is required.',
      };
    }

    const exchangePref = options.exchange ?? 'AUTO';
    const cacheKey = `quote:${sym}:${exchangePref}:${options.bseScripCode ?? ''}`;

    if (!options.forceRefresh) {
      const cached = this.liveQuoteCache.get(cacheKey);
      if (cached) {
        this.metrics.quoteHits += 1;
        const freshness = evaluateQuoteFreshness({
          lastUpdated: cached.value.lastUpdated ?? cached.value.timestamp,
          timestamp: cached.value.timestamp,
        });
        const checkedValue: LiveQuote = {
          ...cached.value,
          lastUpdated: cached.value.lastUpdated ?? (cached.value.timestamp || null),
          quoteDateIst: freshness.quoteDateIst,
          systemDateIst: freshness.systemDateIst,
          isStale: freshness.isStale,
          staleReason: freshness.reason,
        };
        return {
          ok: true,
          symbol: sym,
          data: checkedValue,
          cacheMeta: {
            fromCache: true,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: cached.fetchedAtUtc,
          },
          warnings: freshness.reason ? [freshness.reason] : [],
          error: null,
        };
      }
    }

    const flightKey = `${cacheKey}:${options.forceRefresh ? '1' : '0'}`;
    const existing = this.inFlight.get(flightKey) as
      | Promise<ServiceResult<LiveQuote>>
      | undefined;

    if (existing) {
      this.metrics.dedupedCalls += 1;
      const shared = await existing;
      return {
        ...shared,
        cacheMeta: { ...shared.cacheMeta, dedupedInFlight: true },
      };
    }

    const task = (async (): Promise<ServiceResult<LiveQuote>> => {
      this.metrics.quoteMisses += 1;
      const warnings: string[] = [];
      let nseError: string | null = null;
      let bseError: string | null = null;

      try {
        let quoteResult: LiveQuote | null = null;

        if (exchangePref === 'NSE' || exchangePref === 'AUTO') {
          try {
            quoteResult = await this.fetchNseLiveQuote(sym);
          } catch (err) {
            nseError = err instanceof Error ? err.message : String(err);
            if (exchangePref === 'AUTO') {
              warnings.push(`NSE quote failed (${nseError}); attempting BSE fallback.`);
            }
          }
        }

        if (!quoteResult && (exchangePref === 'BSE' || exchangePref === 'AUTO')) {
          try {
            quoteResult = await this.fetchBseLiveQuote(sym, options.bseScripCode);
          } catch (err) {
            bseError = err instanceof Error ? err.message : String(err);
          }
        }

        if (!quoteResult) {
          throw new Error(
            [nseError ? `NSE: ${nseError}` : '', bseError ? `BSE: ${bseError}` : '']
              .filter(Boolean)
              .join(' | ') || `Live quote unavailable for ${sym}`
          );
        }

        const freshness = evaluateQuoteFreshness({
          lastUpdated: quoteResult.lastUpdated ?? quoteResult.timestamp,
          timestamp: quoteResult.timestamp,
        });
        const checkedQuote: LiveQuote = {
          ...quoteResult,
          lastUpdated: quoteResult.lastUpdated ?? (quoteResult.timestamp || null),
          quoteDateIst: freshness.quoteDateIst,
          systemDateIst: freshness.systemDateIst,
          isStale: freshness.isStale,
          staleReason: freshness.reason,
        };
        if (freshness.reason) {
          warnings.push(freshness.reason);
        }

        const fetchedAtUtc = new Date().toISOString();
        const wrapped: CacheWrapper<LiveQuote> = { value: checkedQuote, fetchedAtUtc };
        this.liveQuoteCache.set(cacheKey, wrapped);
        this.staleQuoteCache.set(cacheKey, wrapped);

        return {
          ok: true,
          symbol: sym,
          data: checkedQuote,
          cacheMeta: {
            fromCache: false,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc,
          },
          warnings,
          error: null,
        };
      } catch (err) {
        this.metrics.upstreamErrors += 1;
        const message = err instanceof Error ? err.message : String(err);
        const stale = this.staleQuoteCache.get(cacheKey);

        if (stale) {
          this.metrics.staleFallbacks += 1;
          const staleFreshness = evaluateQuoteFreshness({
            lastUpdated: stale.value.lastUpdated ?? stale.value.timestamp,
            timestamp: stale.value.timestamp,
          });
          const checkedStale: LiveQuote = {
            ...stale.value,
            quoteDateIst: staleFreshness.quoteDateIst,
            systemDateIst: staleFreshness.systemDateIst,
            isStale: true,
            staleReason: staleFreshness.reason || 'Serving stale cached quote after upstream failure.',
          };
          return {
            ok: true,
            symbol: sym,
            data: checkedStale,
            cacheMeta: {
              fromCache: true,
              staleFallback: true,
              dedupedInFlight: false,
              fetchedAtUtc: stale.fetchedAtUtc,
            },
            warnings: [...warnings, `Live quote failed (${message}); served stale cached quote.`],
            error: null,
          };
        }

        return {
          ok: false,
          symbol: sym,
          data: null,
          cacheMeta: {
            fromCache: false,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: '',
          },
          warnings,
          error: message,
        };
      }
    })();

    this.inFlight.set(flightKey, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  /**
   * Fetch historical OHLCV price data exclusively via `nse-bse-api` (`NSEClient`).
   */
  async getHistoricalPrices(
    symbol: string,
    options: {
      fromDate?: Date;
      toDate?: Date;
      series?: string[];
      forceRefresh?: boolean;
    } = {}
  ): Promise<ServiceResult<HistoricalPriceBar[]>> {
    const sym = normalizeSymbol(symbol);
    if (!sym) {
      return {
        ok: false,
        symbol: '',
        data: null,
        cacheMeta: {
          fromCache: false,
          staleFallback: false,
          dedupedInFlight: false,
          fetchedAtUtc: '',
        },
        warnings: ['Empty symbol provided.'],
        error: 'Symbol is required.',
      };
    }

    const toDate = options.toDate ?? new Date();
    const fromDate = options.fromDate ?? new Date(toDate.getTime() - 90 * 86_400_000);
    const series = options.series && options.series.length > 0 ? options.series : ['EQ'];

    const fromKey = fromDate.toISOString().slice(0, 10);
    const toKey = toDate.toISOString().slice(0, 10);
    const cacheKey = `hist:${sym}:${fromKey}:${toKey}:${series.join(',')}`;

    if (!options.forceRefresh) {
      const cached = this.historicalCache.get(cacheKey);
      if (cached) {
        this.metrics.historicalHits += 1;
        return {
          ok: true,
          symbol: sym,
          data: cached.value,
          cacheMeta: {
            fromCache: true,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: cached.fetchedAtUtc,
          },
          warnings: [],
          error: null,
        };
      }
    }

    const flightKey = `${cacheKey}:${options.forceRefresh ? '1' : '0'}`;
    const existing = this.inFlight.get(flightKey) as
      | Promise<ServiceResult<HistoricalPriceBar[]>>
      | undefined;

    if (existing) {
      this.metrics.dedupedCalls += 1;
      const shared = await existing;
      return {
        ...shared,
        cacheMeta: { ...shared.cacheMeta, dedupedInFlight: true },
      };
    }

    const task = (async (): Promise<ServiceResult<HistoricalPriceBar[]>> => {
      this.metrics.historicalMisses += 1;

      try {
        if (fromDate > toDate) {
          throw new Error(`Invalid date range: ${fromKey} > ${toKey}`);
        }

        const rawRows = await this.nse.fetch_equity_historical_data({
          symbol: sym,
          from_date: fromDate,
          to_date: toDate,
          series,
        });

        const bars = normalizeHistoricalRows(sym, rawRows, series[0] ?? 'EQ');
        if (bars.length === 0) {
          throw new Error(`NSE returned no historical OHLCV bars for ${sym} (${fromKey} to ${toKey})`);
        }

        const fetchedAtUtc = new Date().toISOString();
        const wrapped: CacheWrapper<HistoricalPriceBar[]> = { value: bars, fetchedAtUtc };
        this.historicalCache.set(cacheKey, wrapped);
        this.staleHistoricalCache.set(cacheKey, wrapped);

        return {
          ok: true,
          symbol: sym,
          data: bars,
          cacheMeta: {
            fromCache: false,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc,
          },
          warnings: [],
          error: null,
        };
      } catch (err) {
        this.metrics.upstreamErrors += 1;
        const message = err instanceof Error ? err.message : String(err);
        const stale = this.staleHistoricalCache.get(cacheKey);

        if (stale) {
          this.metrics.staleFallbacks += 1;
          return {
            ok: true,
            symbol: sym,
            data: stale.value,
            cacheMeta: {
              fromCache: true,
              staleFallback: true,
              dedupedInFlight: false,
              fetchedAtUtc: stale.fetchedAtUtc,
            },
            warnings: [`Historical fetch failed (${message}); served stale cached bars.`],
            error: null,
          };
        }

        return {
          ok: false,
          symbol: sym,
          data: null,
          cacheMeta: {
            fromCache: false,
            staleFallback: false,
            dedupedInFlight: false,
            fetchedAtUtc: '',
          },
          warnings: [],
          error: message,
        };
      }
    })();

    this.inFlight.set(flightKey, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  /**
   * Combined snapshot fetching Screener fundamentals + NSE/BSE live quote + historical prices concurrently.
   */
  async getStockSnapshot(
    symbol: string,
    options: {
      mode?: CompanyMode;
      exchange?: 'AUTO' | ExchangeCode;
      bseScripCode?: string;
      fromDate?: Date;
      toDate?: Date;
      forceRefresh?: boolean;
    } = {}
  ): Promise<StockSnapshot> {
    const sym = normalizeSymbol(symbol);
    const [fundamentals, liveQuote, historicalPrices] = await Promise.all([
      this.getFundamentals(sym, { mode: options.mode, forceRefresh: options.forceRefresh }),
      this.getLiveQuote(sym, {
        exchange: options.exchange,
        bseScripCode: options.bseScripCode,
        forceRefresh: options.forceRefresh,
      }),
      this.getHistoricalPrices(sym, {
        fromDate: options.fromDate,
        toDate: options.toDate,
        forceRefresh: options.forceRefresh,
      }),
    ]);

    return {
      symbol: sym,
      fundamentals,
      liveQuote,
      historicalPrices,
    };
  }

  evictSymbol(symbol?: string): { clearedEntries: number } {
    if (!symbol) {
      const total =
        this.fundamentalsCache.size +
        this.liveQuoteCache.size +
        this.historicalCache.size;
      this.fundamentalsCache.clear();
      this.liveQuoteCache.clear();
      this.historicalCache.clear();
      this.staleFundamentalsCache.clear();
      this.staleQuoteCache.clear();
      this.staleHistoricalCache.clear();
      return { clearedEntries: total };
    }

    const sym = normalizeSymbol(symbol);
    let cleared = 0;

    for (const cache of [
      this.fundamentalsCache,
      this.liveQuoteCache,
      this.historicalCache,
      this.staleFundamentalsCache,
      this.staleQuoteCache,
      this.staleHistoricalCache,
    ]) {
      for (const key of cache.keys()) {
        if (key.includes(`:${sym}:`) || key.endsWith(`:${sym}`)) {
          if (cache.delete(key)) cleared += 1;
        }
      }
    }
    return { clearedEntries: cleared };
  }

  getCacheHealth(): CacheHealthStats {
    return {
      fundamentalsCachedCount: this.fundamentalsCache.size,
      liveQuotesCachedCount: this.liveQuoteCache.size,
      historicalCachedCount: this.historicalCache.size,
      staleFallbackCount:
        this.staleFundamentalsCache.size +
        this.staleQuoteCache.size +
        this.staleHistoricalCache.size,
      inFlightCount: this.inFlight.size,
      metrics: { ...this.metrics },
    };
  }

  private async fetchNseLiveQuote(symbol: string): Promise<LiveQuote> {
    // Rich quote payload from NSE API gives priceInfo, metadata, and companyName;
    // fallback to simplified equityQuote if needed.
    let rawQuote: Record<string, unknown> | null = null;
    try {
      rawQuote = await this.nse.quote({ symbol, type: 'equity' });
    } catch {
      rawQuote = null;
    }

    const priceInfo = readNestedRecord(rawQuote, 'priceInfo');
    const info = readNestedRecord(rawQuote, 'info');
    const metadata = readNestedRecord(rawQuote, 'metadata');
    const intraDay = readNestedRecord(priceInfo, 'intraDayHighLow');
    const preOpen = readNestedRecord(rawQuote, 'preOpenMarket');

    const richLastPrice =
      parseNumericValue(priceInfo?.lastPrice) ?? parseNumericValue(priceInfo?.close);

    if (richLastPrice !== null && richLastPrice > 0) {
      const prevClose = parseNumericValue(priceInfo?.previousClose);
      const change =
        parseNumericValue(priceInfo?.change) ??
        (prevClose !== null ? Number((richLastPrice - prevClose).toFixed(2)) : null);
      const changePct =
        parseNumericValue(priceInfo?.pChange) ??
        (prevClose !== null && prevClose > 0 && change !== null
          ? Number(((change / prevClose) * 100).toFixed(2))
          : null);

      const rawApiTimestamp =
        typeof metadata?.lastUpdateTime === 'string' && metadata.lastUpdateTime.trim()
          ? metadata.lastUpdateTime.trim()
          : typeof rawQuote?.timestamp === 'string' && rawQuote.timestamp.trim()
            ? rawQuote.timestamp.trim()
            : '';

      return {
        symbol,
        exchange: 'NSE',
        companyName: typeof info?.companyName === 'string' ? info.companyName : undefined,
        lastPrice: richLastPrice,
        open: parseNumericValue(priceInfo?.open),
        high: parseNumericValue(intraDay?.max),
        low: parseNumericValue(intraDay?.min),
        previousClose: prevClose,
        change,
        changePct,
        volume: parseNumericValue(preOpen?.totalTradedVolume),
        timestamp: rawApiTimestamp,
        lastUpdated: rawApiTimestamp || null,
        source: 'nse-bse-api:NSE',
      };
    }

    const simple = await this.nse.equityQuote(symbol);
    const simpleClose = parseNumericValue(simple.close);
    if (simpleClose === null || simpleClose <= 0) {
      throw new Error(`NSE quote did not return a valid price for ${symbol}`);
    }

    const simpleTimestamp = typeof simple.date === 'string' ? simple.date.trim() : '';

    return {
      symbol,
      exchange: 'NSE',
      lastPrice: simpleClose,
      open: parseNumericValue(simple.open),
      high: parseNumericValue(simple.high),
      low: parseNumericValue(simple.low),
      previousClose: null,
      change: null,
      changePct: null,
      volume: parseNumericValue(simple.volume),
      timestamp: simpleTimestamp,
      lastUpdated: simpleTimestamp || null,
      source: 'nse-bse-api:NSE',
    };
  }

  private async fetchBseLiveQuote(symbol: string, explicitScripCode?: string): Promise<LiveQuote> {
    const scripCode = explicitScripCode?.trim() || (await this.bse.getScripCode(symbol));
    const bseQuote = await this.bse.quote(scripCode);

    const lastPrice = parseNumericValue(bseQuote.LTP ?? bseQuote.ltp);
    if (lastPrice === null || lastPrice <= 0) {
      throw new Error(`BSE quote did not return a valid LTP for ${symbol} (${scripCode})`);
    }

    const previousClose = parseNumericValue(bseQuote.PrevClose ?? bseQuote.previousclose);
    const change =
      parseNumericValue(bseQuote.change) ??
      (previousClose !== null ? Number((lastPrice - previousClose).toFixed(2)) : null);
    const changePct =
      parseNumericValue(bseQuote.pchange) ??
      (previousClose !== null && previousClose > 0 && change !== null
        ? Number(((change / previousClose) * 100).toFixed(2))
        : null);

    const rawRecord = bseQuote as Record<string, unknown>;
    const rawBseTimestamp =
      typeof rawRecord.updTime === 'string' && rawRecord.updTime.trim()
        ? rawRecord.updTime.trim()
        : typeof rawRecord.timestamp === 'string' && rawRecord.timestamp.trim()
          ? rawRecord.timestamp.trim()
          : typeof rawRecord.DT_TM === 'string' && rawRecord.DT_TM.trim()
            ? rawRecord.DT_TM.trim()
            : '';

    return {
      symbol,
      exchange: 'BSE',
      bseScripCode: scripCode,
      companyName: bseQuote.companyname,
      lastPrice,
      open: parseNumericValue(bseQuote.Open ?? bseQuote.open),
      high: parseNumericValue(bseQuote.High ?? bseQuote.high),
      low: parseNumericValue(bseQuote.Low ?? bseQuote.low),
      previousClose,
      change,
      changePct,
      volume: parseNumericValue(bseQuote.volume),
      timestamp: rawBseTimestamp,
      lastUpdated: rawBseTimestamp || null,
      source: 'nse-bse-api:BSE',
    };
  }
}

export const defaultIndianStockDataService = new IndianStockDataService();

// ============================================================================
// Standalone Runnable CLI Entrypoint (`npx tsx server/services/indianStockDataService.ts TCS`)
// ============================================================================

async function runCli(): Promise<void> {
  const symbolArg = process.argv[2] || 'TCS';
  const symbol = normalizeSymbol(symbolArg);
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 30 * 86_400_000);

  console.log(`Fetching Screener.in fundamentals & NSE/BSE market data for ${symbol}...`);
  const snapshot = await defaultIndianStockDataService.getStockSnapshot(symbol, {
    fromDate,
    toDate,
  });

  const f = snapshot.fundamentals.data;
  const q = snapshot.liveQuote.data;
  const h = snapshot.historicalPrices.data;

  console.log(
    JSON.stringify(
      {
        symbol,
        fundamentals: snapshot.fundamentals.ok && f
          ? {
              companyName: f.companyName,
              mode: f.mode,
              peRatio: f.peRatio,
              roePct: f.roePct,
              rocePct: f.rocePct,
              debtToEquity: f.debtToEquity,
              latestQuarter:
                f.quarterlyResults.records[f.quarterlyResults.records.length - 1] ?? null,
              latestBalanceSheet:
                f.balanceSheet.records[f.balanceSheet.records.length - 1] ?? null,
              fromCache: snapshot.fundamentals.cacheMeta.fromCache,
            }
          : { error: snapshot.fundamentals.error, warnings: snapshot.fundamentals.warnings },
        liveQuote: snapshot.liveQuote.ok && q
          ? q
          : { error: snapshot.liveQuote.error, warnings: snapshot.liveQuote.warnings },
        historicalPrices: snapshot.historicalPrices.ok && h
          ? {
              barCount: h.length,
              firstBar: h[0] ?? null,
              lastBar: h[h.length - 1] ?? null,
            }
          : { error: snapshot.historicalPrices.error },
        cacheHealth: defaultIndianStockDataService.getCacheHealth(),
      },
      null,
      2
    )
  );
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runCli().catch((err) => {
    console.error('Fatal CLI error:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
