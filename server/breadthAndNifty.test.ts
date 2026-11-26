import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMarketBreadth,
  calculatePercentage,
  calculateSectorBreadth,
  calculateSectorDeliveryTrendMetrics,
  type BreadthInputRow,
} from './breadthCalculator.ts';
import { fetchNifty50MacroSeries, fetchYahooMacroSeries } from './openMacroNewsEngine.ts';

describe('calculatePercentage', () => {
  it('computes (above / eligible) * 100 rounded to 1 decimal place', () => {
    assert.equal(calculatePercentage(702, 2558), 27.4);
    assert.equal(calculatePercentage(1, 3), 33.3);
    assert.equal(calculatePercentage(0, 100), 0);
  });

  it('returns 0 when totalEligible is 0 or negative', () => {
    assert.equal(calculatePercentage(5, 0), 0);
    assert.equal(calculatePercentage(5, -10), 0);
  });
});

describe('calculateMarketBreadth', () => {
  it('computes exact EMA21, EMA44, EMA200, and A/D percentages across ALL eligible stocks regardless of liquidityPass', () => {
    // 10 stocks: 8 eligible for EMA21 (5 above -> 62.5%), 2 ineligible (null).
    // 6 eligible for EMA44 (2 above -> 33.3%), 4 null.
    // 4 eligible for EMA200 (3 above -> 75.0%), 6 null.
    // A/D: 3 advancers, 5 decliners, 2 unchanged -> 3 / 8 = 37.5%.
    const rows: BreadthInputRow[] = [
      { changePct: 2.1, aboveEma21: true, aboveEma44: true, aboveEma200: true, ema21AboveEma44: true, ema21Cross44Bullish: true },
      { changePct: 1.4, aboveEma21: true, aboveEma44: true, aboveEma200: true, ema21AboveEma44: true, ema21Cross44Bullish: false },
      { changePct: 0.8, aboveEma21: true, aboveEma44: false, aboveEma200: true, ema21AboveEma44: true, ema21Cross44Bullish: false },
      { changePct: -1.2, aboveEma21: true, aboveEma44: false, aboveEma200: false, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { changePct: -2.0, aboveEma21: true, aboveEma44: false, aboveEma200: null, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { changePct: -0.5, aboveEma21: false, aboveEma44: false, aboveEma200: null, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { changePct: -1.8, aboveEma21: false, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
      { changePct: -3.1, aboveEma21: false, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
      { changePct: 0.0, aboveEma21: null, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
      { changePct: null, aboveEma21: null, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
    ];

    const res = calculateMarketBreadth(rows);

    assert.equal(res.aboveEma21Count, 5);
    assert.equal(res.ema21EligibleCount, 8);
    assert.equal(res.aboveEma21Pct, 62.5);

    assert.equal(res.aboveEma44Count, 2);
    assert.equal(res.ema44EligibleCount, 6);
    assert.equal(res.aboveEma44Pct, 33.3);

    assert.equal(res.aboveEma200Count, 3);
    assert.equal(res.ema200SampleCount, 4);
    assert.equal(res.aboveEma200Pct, 75);

    assert.equal(res.aboveEma21And44Count, 3);
    assert.equal(res.ema21And44EligibleCount, 6);
    assert.equal(res.aboveEma21And44Pct, 50);

    assert.equal(res.advancers, 3);
    assert.equal(res.decliners, 5);
    assert.equal(res.unchanged, 2);
    assert.equal(res.breadthPct, 37.5);
    assert.equal(res.emaCrossBullishCount, 1);
  });

  it('handles an empty market array cleanly without NaN or division by zero', () => {
    const res = calculateMarketBreadth([]);
    assert.equal(res.aboveEma21Pct, 0);
    assert.equal(res.aboveEma44Pct, 0);
    assert.equal(res.aboveEma200Pct, null);
    assert.equal(res.aboveEma21And44Pct, 0);
    assert.equal(res.breadthPct, 0);
  });
});

describe('calculateSectorBreadth', () => {
  it('computes exact sector EMA percentages and composite trend score without fake 50% fallbacks', () => {
    const sectorRows: BreadthInputRow[] = [
      { changePct: 1.5, aboveEma21: true, aboveEma44: true, aboveEma200: null, ema21AboveEma44: true, ema21Cross44Bullish: false },
      { changePct: -0.9, aboveEma21: false, aboveEma44: true, aboveEma200: null, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { changePct: -1.1, aboveEma21: false, aboveEma44: false, aboveEma200: null, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { changePct: 0.2, aboveEma21: null, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
    ];

    const res = calculateSectorBreadth(sectorRows);

    // 1 / 3 = 33.3% above EMA21, 2 / 3 = 66.7% above EMA44, 1 / 3 = 33.3% EMA21>44
    assert.equal(res.aboveEma21Pct, 33.3);
    assert.equal(res.aboveEma44Pct, 66.7);
    assert.equal(res.ema21Above44Pct, 33.3);
    assert.equal(res.aboveEma200Pct, null);
    // Composite mean of [33.3, 66.7, 33.3] = 44.4
    assert.equal(res.emaTrendCompositePct, 44.4);
  });

  it('returns 0% instead of 50% when a sector has no eligible EMA rows', () => {
    const res = calculateSectorBreadth([
      { changePct: 0.4, aboveEma21: null, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
    ]);
    assert.equal(res.aboveEma21Pct, 0);
    assert.equal(res.aboveEma44Pct, 0);
    assert.equal(res.ema21Above44Pct, 0);
    assert.equal(res.emaTrendCompositePct, 0);
  });

  it('deduplicates duplicate sector symbols and guarantees numerator <= denominator across all EMA and Breadth counts', () => {
    // Regression test for invalid fractions like 18/16 EMA21 or >100% caused by duplicate symbol rows
    const duplicateSectorRows: BreadthInputRow[] = [
      { symbol: 'CHEM1', changePct: 2.0, aboveEma21: true, aboveEma44: true, aboveEma200: true, ema21AboveEma44: true, ema21Cross44Bullish: true },
      { symbol: 'chem1 ', changePct: 2.0, aboveEma21: true, aboveEma44: true, aboveEma200: true, ema21AboveEma44: true, ema21Cross44Bullish: true },
      { symbol: 'CHEM1', changePct: 2.0, aboveEma21: true, aboveEma44: true, aboveEma200: true, ema21AboveEma44: true, ema21Cross44Bullish: true },
      { symbol: 'CHEM2', changePct: 1.1, aboveEma21: true, aboveEma44: false, aboveEma200: null, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { symbol: 'CHEM3', changePct: -1.4, aboveEma21: false, aboveEma44: false, aboveEma200: false, ema21AboveEma44: false, ema21Cross44Bullish: false },
      { symbol: 'CHEM4', changePct: null, aboveEma21: null, aboveEma44: null, aboveEma200: null, ema21AboveEma44: null, ema21Cross44Bullish: false },
    ];

    const res = calculateSectorBreadth(duplicateSectorRows);

    assert.equal(res.totalValidStocks, 4);
    assert.equal(res.ema21EligibleCount, 3);
    assert.equal(res.aboveEma21Count, 2);
    assert.ok(res.aboveEma21Count <= res.ema21EligibleCount);
    assert.ok(res.ema21EligibleCount <= res.totalValidStocks);
    assert.equal(res.aboveEma21Pct, 66.7);

    assert.equal(res.ema44EligibleCount, 3);
    assert.equal(res.aboveEma44Count, 1);
    assert.ok(res.aboveEma44Count <= res.ema44EligibleCount);

    assert.equal(res.ema200SampleCount, 2);
    assert.equal(res.aboveEma200Count, 1);
    assert.ok(res.aboveEma200Count <= res.ema200SampleCount);

    assert.equal(res.advancers, 2);
    assert.equal(res.decliners, 1);
    assert.ok(res.advancers <= res.advancers + res.decliners);
    assert.ok(res.breadthPct <= 100);
    assert.equal(res.emaCrossBullishCount, 1);
  });
});

describe('calculateSectorDeliveryTrendMetrics', () => {
  it('computes deliveryShiftPp strictly as 5D Avg - 30D Avg so shift matches displayed card numbers', () => {
    // 25 sessions at 55.0%, followed by 5 sessions at 57.0% -> 30D Avg = 55.3%, 5D Avg = 57.0%, Shift = +1.7pp (NOT +2.0pp)
    const points = [
      ...Array.from({ length: 25 }, () => ({ avgDeliveryPct: 55.0 })),
      ...Array.from({ length: 5 }, () => ({ avgDeliveryPct: 57.0 })),
    ];

    const res = calculateSectorDeliveryTrendMetrics(points, 55.0);
    assert.equal(res.delivery30dAvg, 55.3);
    assert.equal(res.delivery5dAvg, 57.0);
    assert.equal(res.deliveryShiftPp, 1.7);
    assert.equal(
      res.deliveryShiftPp,
      Number((res.delivery5dAvg - res.delivery30dAvg).toFixed(1))
    );
  });

  it('handles cooling shifts and empty trend arrays cleanly', () => {
    const cooling = [
      ...Array.from({ length: 25 }, () => ({ avgDeliveryPct: 60.0 })),
      ...Array.from({ length: 5 }, () => ({ avgDeliveryPct: 54.0 })),
    ];
    const coolRes = calculateSectorDeliveryTrendMetrics(cooling, 58.0);
    assert.equal(coolRes.delivery30dAvg, 59.0);
    assert.equal(coolRes.delivery5dAvg, 54.0);
    assert.equal(coolRes.deliveryShiftPp, -5.0);

    const emptyRes = calculateSectorDeliveryTrendMetrics([], 52.45);
    assert.equal(emptyRes.delivery30dAvg, 52.5);
    assert.equal(emptyRes.delivery5dAvg, 52.5);
    assert.equal(emptyRes.deliveryShiftPp, 0);
  });
});

describe('fetchYahooMacroSeries & fetchNifty50MacroSeries', () => {
  it('prioritizes Yahoo Finance meta.regularMarketPrice and falls back from query1 to query2 on HTTP error', async () => {
    const timestamps = Array.from({ length: 25 }, (_, idx) => 1730000000 + idx * 86400);
    const closes = Array.from({ length: 25 }, (_, idx) => 24000 + idx * 10);

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('query1.finance.yahoo.com')) {
        return new Response('Rate limited', { status: 429 });
      }
      if (url.includes('query2.finance.yahoo.com')) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    regularMarketPrice: 24315.45,
                    previousClose: 24200.0,
                  },
                  timestamp: timestamps,
                  indicators: { quote: [{ close: closes }] },
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const nifty = await fetchYahooMacroSeries('^NSEI', 'Nifty 50', mockFetch);
    assert.equal(nifty.available, true);
    assert.equal(nifty.latestPrice, 24315.45);
    assert.equal(nifty.aboveEma20, true);
    assert.equal(nifty.source, 'Yahoo Finance (^NSEI)');
  });

  it('falls back to NSE India allIndices NIFTY 50 when both Yahoo Finance hosts fail', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('finance.yahoo.com')) {
        return new Response('Upstream unavailable', { status: 503 });
      }
      if (url.includes('nseindia.com/api/allIndices')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                index: 'NIFTY 50',
                indexSymbol: 'NIFTY 50',
                last: 24188.65,
                previousClose: 24090.0,
                percentChange: 0.41,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const nifty = await fetchNifty50MacroSeries(mockFetch);
    assert.equal(nifty.available, true);
    assert.equal(nifty.latestPrice, 24188.65);
    assert.equal(nifty.prevClose, 24090);
    assert.equal(nifty.changePct, 0.41);
    assert.equal(nifty.source, 'NSE India (allIndices NIFTY 50)');
  });
});
