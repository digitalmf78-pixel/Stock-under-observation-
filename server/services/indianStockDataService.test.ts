import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiResponse, CompanyData, CompanyMode } from 'screener-india';
import type { QuoteData as BseQuoteData } from 'nse-bse-api/bse';
import type { EquityHistoricalParams, EquityQuoteData } from 'nse-bse-api/nse';
import {
  IndianStockDataService,
  type BseClientLike,
  type NseClientLike,
  type ScreenerClientLike,
} from './indianStockDataService.ts';
import {
  mapScreenerToIndianPayload,
  verifyFundamentalIntegrity,
} from './fundamentalService.ts';

function buildMockScreenerResponse(symbol = 'TCS'): ApiResponse<CompanyData> {
  return {
    data: {
      name: 'Tata Consultancy Services Ltd',
      symbol,
      mode: 'consolidated',
      topRatios: [
        { name: 'Market Cap', value: '14,50,000 Cr.' },
        { name: 'Current Price', value: '4,010' },
        { name: 'High / Low', value: '4,592 / 3,591' },
        { name: 'Stock P/E', value: '29.4' },
        { name: 'Book Value', value: '254' },
        { name: 'Dividend Yield', value: '1.42 %' },
        { name: 'ROCE', value: '64.3 %' },
        { name: 'ROE', value: '51.5 %' },
        { name: 'Face Value', value: '1.00' },
      ],
      quarters: {
        headers: ['', 'Jun 2024', 'Sep 2024', 'Dec 2024', 'Mar 2025', 'Jun 2025'],
        rows: [
          { '': 'Sales +', 'Jun 2024': '62,613', 'Sep 2024': '64,259', 'Dec 2024': '63,973', 'Mar 2025': '64,479', 'Jun 2025': '66,000' },
          { '': 'Expenses +', 'Jun 2024': '45,951', 'Sep 2024': '47,493', 'Dec 2024': '46,912', 'Mar 2025': '47,400', 'Jun 2025': '48,200' },
          { '': 'Operating Profit', 'Jun 2024': '16,662', 'Sep 2024': '16,766', 'Dec 2024': '17,061', 'Mar 2025': '17,079', 'Jun 2025': '17,800' },
          { '': 'OPM %', 'Jun 2024': '27%', 'Sep 2024': '26%', 'Dec 2024': '27%', 'Mar 2025': '26%', 'Jun 2025': '27%' },
          { '': 'Interest', 'Jun 2024': '173', 'Sep 2024': '162', 'Dec 2024': '234', 'Mar 2025': '227', 'Jun 2025': '200' },
          { '': 'Net Profit +', 'Jun 2024': '12,105', 'Sep 2024': '11,955', 'Dec 2024': '12,444', 'Mar 2025': '12,293', 'Jun 2025': '13,100' },
          { '': 'EPS in Rs', 'Jun 2024': '33.28', 'Sep 2024': '32.92', 'Dec 2024': '34.21', 'Mar 2025': '33.79', 'Jun 2025': '36.10' },
        ],
      },
      balanceSheet: {
        headers: ['', 'Mar 2024', 'Mar 2025'],
        rows: [
          { '': 'Equity Capital', 'Mar 2024': '362', 'Mar 2025': '362' },
          { '': 'Reserves', 'Mar 2024': '90,127', 'Mar 2025': '95,000' },
          { '': 'Borrowings +', 'Mar 2024': '8,021', 'Mar 2025': '9,536' },
          { '': 'Other Liabilities +', 'Mar 2024': '47,962', 'Mar 2025': '50,102' },
          { '': 'Total Liabilities', 'Mar 2024': '1,46,472', 'Mar 2025': '1,55,000' },
          { '': 'Fixed Assets +', 'Mar 2024': '19,604', 'Mar 2025': '21,000' },
          { '': 'Total Assets', 'Mar 2024': '1,46,472', 'Mar 2025': '1,55,000' },
        ],
      },
      profitLoss: {
        headers: ['', 'Mar 2024', 'Mar 2025'],
        rows: [
          { '': 'Sales +', 'Mar 2024': '2,40,893', 'Mar 2025': '2,55,324' },
          { '': 'Operating Profit', 'Mar 2024': '64,296', 'Mar 2025': '67,568' },
          { '': 'Depreciation', 'Mar 2024': '4,985', 'Mar 2025': '5,200' },
          { '': 'Interest', 'Mar 2024': '778', 'Mar 2025': '796' },
          { '': 'Net Profit +', 'Mar 2024': '46,099', 'Mar 2025': '48,797' },
          { '': 'EPS in Rs', 'Mar 2024': '126.88', 'Mar 2025': '134.20' },
        ],
      },
      cashFlow: {
        headers: ['', 'Mar 2024', 'Mar 2025'],
        rows: [
          { '': 'Cash from Operating Activity +', 'Mar 2024': '44,338', 'Mar 2025': '48,500' },
          { '': 'Fixed Assets Purchased', 'Mar 2024': '-2,650', 'Mar 2025': '-3,100' },
        ],
      },
      shareholding: {
        headers: ['', 'Dec 2024', 'Mar 2025'],
        rows: [
          { '': 'Promoters +', 'Dec 2024': '71.77%', 'Mar 2025': '71.77%' },
          { '': 'FIIs +', 'Dec 2024': '12.68%', 'Mar 2025': '12.40%' },
          { '': 'DIIs +', 'Dec 2024': '10.90%', 'Mar 2025': '11.20%' },
          { '': 'Public +', 'Dec 2024': '4.65%', 'Mar 2025': '4.63%' },
        ],
      },
      analysis: {
        pros: ['Company has a good return on equity (ROE) track record: 3 Years ROE 51.5%'],
        cons: ['Stock is trading at 15.8 times its book value'],
        description: 'IT Services leader',
      },
    },
    meta: {
      sourceUrl: `https://www.screener.in/company/${symbol}/consolidated/`,
      fetchedAt: '2026-11-24T10:00:00.000Z',
      parserVersion: '1.0.1',
    },
    warnings: [],
  };
}

test('parses Screener.in fundamentals (P/E, ROE, ROCE, Debt/Equity, quarterly results, balance sheet) and caches in LRUCache', async () => {
  let screenerCalls = 0;
  const mockScreener: ScreenerClientLike = {
    async getCompany(symbol: string, _mode?: CompanyMode) {
      screenerCalls += 1;
      return buildMockScreenerResponse(symbol);
    },
  };
  const mockNse: NseClientLike = {
    async quote() {
      return {};
    },
    async equityQuote() {
      return {};
    },
    async fetch_equity_historical_data() {
      return [];
    },
  };
  const mockBse: BseClientLike = {
    async getScripCode() {
      return '532540';
    },
    async quote() {
      return {};
    },
  };

  const service = new IndianStockDataService({
    screenerClient: mockScreener,
    nseClient: mockNse,
    bseClient: mockBse,
  });

  const first = await service.getFundamentals('tcs.ns');
  assert.equal(first.ok, true);
  assert.equal(first.cacheMeta.fromCache, false);
  assert.ok(first.data);
  assert.equal(first.data.symbol, 'TCS');
  assert.equal(first.data.peRatio, 29.4);
  assert.equal(first.data.roePct, 51.5);
  assert.equal(first.data.rocePct, 64.3);
  // Debt/Equity derived from Balance Sheet: 9536 / (362 + 95000) = 0.10
  assert.equal(first.data.debtToEquity, 0.1);
  assert.equal(first.data.quarterlyResults.records.length, 5);
  assert.equal(first.data.quarterlyResults.records[4].salesCr, 66000);
  assert.equal(first.data.balanceSheet.records[1].borrowingsCr, 9536);

  // Second call should hit LRUCache without invoking ScreenerClient
  const second = await service.getFundamentals('TCS');
  assert.equal(second.ok, true);
  assert.equal(second.cacheMeta.fromCache, true);
  assert.equal(screenerCalls, 1);

  // Verify mapping into IndianFundamentalsPayload & integrity score
  const mapped = mapScreenerToIndianPayload(first.data, {
    symbol: 'TCS',
    exchange: 'NSE',
    lastPrice: 4050,
    open: 4000,
    high: 4065,
    low: 3995,
    previousClose: 4005,
    change: 45,
    changePct: 1.12,
    volume: 1_500_000,
    timestamp: '2026-11-24T10:05:00Z',
    source: 'nse-bse-api:NSE',
  });
  assert.equal(mapped.currentPrice, 4050);
  assert.equal(mapped.trailingPE, 29.4);
  assert.equal(mapped.roePct, 51.5);
  assert.equal(mapped.rocePct, 64.3);
  assert.equal(mapped.debtToEquity, 0.1);
  assert.equal(mapped.epsTtmCurr, 137.02); // 32.92 + 34.21 + 33.79 + 36.10
  const integrity = verifyFundamentalIntegrity(mapped, false);
  assert.equal(integrity.status, 'VERIFIED');
  assert.equal(integrity.scorePct, 100);
});

test('fetches live quotes (NSE with BSE fallback) and historical prices strictly via nse-bse-api', async () => {
  let nseShouldFail = false;
  let historicalCalls = 0;

  const mockScreener: ScreenerClientLike = {
    async getCompany(symbol: string) {
      return buildMockScreenerResponse(symbol);
    },
  };
  const mockNse: NseClientLike = {
    async quote({ symbol }) {
      if (nseShouldFail) throw new Error('NSE rate limited (403)');
      return {
        info: { companyName: `${symbol} Limited` },
        metadata: { lastUpdateTime: '24-Nov-2026 15:30:00' },
        priceInfo: {
          lastPrice: 1285.5,
          open: 1270,
          previousClose: 1265,
          change: 20.5,
          pChange: 1.62,
          intraDayHighLow: { max: 1292, min: 1264 },
        },
        preOpenMarket: { totalTradedVolume: 4250000 },
      };
    },
    async equityQuote(): Promise<EquityQuoteData> {
      throw new Error('Simplified NSE fallback disabled in test');
    },
    async fetch_equity_historical_data(_params: EquityHistoricalParams) {
      historicalCalls += 1;
      return [
        {
          CH_TIMESTAMP: '21-Nov-2026',
          CH_OPENING_PRICE: 1250,
          CH_TRADE_HIGH_PRICE: 1270,
          CH_TRADE_LOW_PRICE: 1245,
          CH_CLOSING_PRICE: 1265,
          CH_TOT_TRADED_QTY: 3100000,
          CH_SERIES: 'EQ',
        },
        {
          CH_TIMESTAMP: '20-Nov-2026',
          CH_OPENING_PRICE: 1240,
          CH_TRADE_HIGH_PRICE: 1258,
          CH_TRADE_LOW_PRICE: 1235,
          CH_CLOSING_PRICE: 1250,
          CH_TOT_TRADED_QTY: 2800000,
          CH_SERIES: 'EQ',
        },
      ];
    },
  };
  const mockBse: BseClientLike = {
    async getScripCode() {
      return '500325';
    },
    async quote(): Promise<BseQuoteData> {
      return {
        LTP: 1284.75,
        Open: 1269,
        High: 1290,
        Low: 1262,
        PrevClose: 1264,
      };
    },
  };

  const service = new IndianStockDataService({
    screenerClient: mockScreener,
    nseClient: mockNse,
    bseClient: mockBse,
  });

  const nseQuote = await service.getLiveQuote('RELIANCE');
  assert.equal(nseQuote.ok, true);
  assert.equal(nseQuote.data?.exchange, 'NSE');
  assert.equal(nseQuote.data?.lastPrice, 1285.5);
  assert.equal(nseQuote.data?.source, 'nse-bse-api:NSE');

  // Force refresh while NSE fails -> graceful fallback to BSE quote
  nseShouldFail = true;
  const bseQuote = await service.getLiveQuote('RELIANCE', { forceRefresh: true });
  assert.equal(bseQuote.ok, true);
  assert.equal(bseQuote.data?.exchange, 'BSE');
  assert.equal(bseQuote.data?.bseScripCode, '500325');
  assert.equal(bseQuote.data?.lastPrice, 1284.75);
  assert.equal(bseQuote.data?.source, 'nse-bse-api:BSE');

  const fromDate = new Date('2026-11-01T00:00:00Z');
  const toDate = new Date('2026-11-24T00:00:00Z');
  const hist1 = await service.getHistoricalPrices('RELIANCE', { fromDate, toDate });
  assert.equal(hist1.ok, true);
  assert.equal(hist1.cacheMeta.fromCache, false);
  assert.equal(hist1.data?.length, 2);
  // Sorted chronologically
  assert.equal(hist1.data?.[0].date, '2026-11-20');
  assert.equal(hist1.data?.[1].date, '2026-11-21');
  assert.equal(hist1.data?.[1].close, 1265);

  const hist2 = await service.getHistoricalPrices('RELIANCE', { fromDate, toDate });
  assert.equal(hist2.cacheMeta.fromCache, true);
  assert.equal(historicalCalls, 1);
});

test('falls back gracefully to stale LRU cache on upstream failure and deduplicates in-flight calls', async () => {
  let failUpstream = false;
  let calls = 0;

  const mockScreener: ScreenerClientLike = {
    async getCompany(symbol: string) {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      if (failUpstream) throw new Error('HTTP 429 Too Many Requests');
      return buildMockScreenerResponse(symbol);
    },
  };
  const mockNse: NseClientLike = {
    async quote() {
      throw new Error('offline');
    },
    async equityQuote() {
      throw new Error('offline');
    },
    async fetch_equity_historical_data() {
      throw new Error('offline');
    },
  };
  const mockBse: BseClientLike = {
    async getScripCode() {
      throw new Error('offline');
    },
    async quote() {
      throw new Error('offline');
    },
  };

  const service = new IndianStockDataService({
    screenerClient: mockScreener,
    nseClient: mockNse,
    bseClient: mockBse,
  });

  // Concurrent requests share 1 in-flight fetch
  const [a, b] = await Promise.all([
    service.getFundamentals('INFY'),
    service.getFundamentals('INFY'),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.cacheMeta.dedupedInFlight || b.cacheMeta.dedupedInFlight, true);

  // Force refresh while upstream fails -> returns stale fallback gracefully without throwing
  failUpstream = true;
  const staleRes = await service.getFundamentals('INFY', { forceRefresh: true });
  assert.equal(staleRes.ok, true);
  assert.equal(staleRes.cacheMeta.staleFallback, true);
  assert.ok(staleRes.data);
  assert.equal(staleRes.data.symbol, 'INFY');

  // Uncached ticker when upstream fails -> ok: false, graceful error object
  const missingRes = await service.getFundamentals('UNKNOWN_TICKER');
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.data, null);
  assert.match(missingRes.error ?? '', /429/);
});

test('marks live quote as stale when API lastUpdated belongs to previous session or is missing', async () => {
  const mockScreener: ScreenerClientLike = {
    async getCompany(symbol: string) {
      return buildMockScreenerResponse(symbol);
    },
  };
  let nseFail = false;
  const mockNse: NseClientLike = {
    async quote({ symbol }: { symbol: string }) {
      if (nseFail) throw new Error('NSE timeout');
      return {
        info: { companyName: `${symbol} Ltd` },
        metadata: { lastUpdateTime: '20-Nov-2020 15:30:00' },
        priceInfo: { lastPrice: 500, previousClose: 495, open: 496 },
      };
    },
    async equityQuote() {
      throw new Error('offline');
    },
    async fetch_equity_historical_data() {
      return [];
    },
  };
  const mockBse: BseClientLike = {
    async getScripCode() {
      return '500001';
    },
    async quote(): Promise<BseQuoteData> {
      return { LTP: 501, PrevClose: 495 };
    },
  };

  const service = new IndianStockDataService({
    screenerClient: mockScreener,
    nseClient: mockNse,
    bseClient: mockBse,
  });

  const oldSessionQuote = await service.getLiveQuote('TCS', { exchange: 'NSE' });
  assert.equal(oldSessionQuote.ok, true);
  assert.equal(oldSessionQuote.data?.isStale, true);
  assert.equal(oldSessionQuote.data?.lastUpdated, '20-Nov-2020 15:30:00');
  assert.equal(oldSessionQuote.data?.quoteDateIst, '2020-11-20');

  // BSE quote without a timestamp from API must NOT fabricate system time; fails safe as stale
  const bseNoTimestamp = await service.getLiveQuote('TCS', { exchange: 'BSE' });
  assert.equal(bseNoTimestamp.ok, true);
  assert.equal(bseNoTimestamp.data?.isStale, true);
  assert.equal(bseNoTimestamp.data?.lastUpdated, null);

  // When NSE fails after caching, stale fallback forces isStale: true
  nseFail = true;
  const fallback = await service.getLiveQuote('TCS', { exchange: 'NSE', forceRefresh: true });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.cacheMeta.staleFallback, true);
  assert.equal(fallback.data?.isStale, true);
});
