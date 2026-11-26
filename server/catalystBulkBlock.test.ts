import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterDealsWithin30Days,
  getBulkBlock30DSummaryForSymbol,
  mergeAndDeduplicateBulkBlockDeals,
  parseNseDealDateToIso,
  parseNseDealsCsv,
} from './catalystFetcher.ts';
import { computeWeightedAvgBuyDealPrice } from './swingBotEngine.ts';
import type { BulkBlockDealItem } from '../src/types/trading.ts';

test('parseNseDealDateToIso normalizes DD-MMM-YYYY, DD-MMM-YY, DD/MM/YYYY, YYYY-MM-DD and rejects invalid dates', () => {
  assert.equal(parseNseDealDateToIso('\uFEFF23-NOV-2026'), '2026-11-23');
  assert.equal(parseNseDealDateToIso('03-Nov-26'), '2026-11-03');
  assert.equal(parseNseDealDateToIso('26/10/2026'), '2026-10-26');
  assert.equal(parseNseDealDateToIso('2026-11-20'), '2026-11-20');
  assert.equal(parseNseDealDateToIso('not-a-date'), '');
  assert.equal(parseNseDealDateToIso(''), '');
});

test('parseNseDealsCsv strips UTF-8 BOM, handles Indian comma formatting, and preserves small-value precision', () => {
  const csv = [
    '\uFEFF"Date ","Symbol ","Security Name ","Client Name ","Buy / Sell ","Quantity Traded ","Trade Price / Wght. Avg. Price ","Remarks "',
    '"23-NOV-2026","LENSKART","Lenskart Solutions Ltd","STEADVIEW   CAPITAL MAURITIUS","SELL","1,15,20,222","725.00","-"',
    '"23-NOV-2026","VINEETLAB","Vineet Labs","K L B SECURITIES PVT LTD","BUY","43","38.79","-"',
    '"INVALID-DT","BADROW","Bad Corp","CLIENT","BUY","100","10.00","-"',
  ].join('\n');

  const parsed = parseNseDealsCsv(csv, 'BULK');
  assert.equal(parsed.length, 2);

  assert.equal(parsed[0].symbol, 'LENSKART');
  assert.equal(parsed[0].date, '2026-11-23');
  assert.equal(parsed[0].clientName, 'STEADVIEW CAPITAL MAURITIUS');
  assert.equal(parsed[0].buySell, 'SELL');
  assert.equal(parsed[0].quantity, 11520222);
  assert.equal(parsed[0].tradePrice, 725);
  assert.equal(parsed[0].valueCr, 835.2161);

  assert.equal(parsed[1].symbol, 'VINEETLAB');
  assert.ok(parsed[1].valueCr > 0 && parsed[1].valueCr < 0.01);
});

test('mergeAndDeduplicateBulkBlockDeals collapses cross-listed BULK+BLOCK duplicate prints and enforces 30D window', () => {
  const deals: BulkBlockDealItem[] = [
    {
      date: '2026-11-23',
      dealType: 'BULK',
      symbol: 'LENSKART',
      clientName: 'STEADVIEW CAPITAL MAURITIUS LIMITED-FDI',
      buySell: 'SELL',
      quantity: 11520222,
      tradePrice: 725,
      valueCr: 835.2161,
    },
    {
      date: '2026-11-23',
      dealType: 'BLOCK',
      symbol: 'LENSKART',
      clientName: 'STEADVIEW  CAPITAL MAURITIUS LIMITED-FDI',
      buySell: 'SELL',
      quantity: 11520222,
      tradePrice: 725,
      valueCr: 835.2161,
    },
    {
      date: '2026-11-23',
      dealType: 'BLOCK',
      symbol: 'LENSKART',
      clientName: 'SOCIETE GENERALE - ODI',
      buySell: 'BUY',
      quantity: 11520222,
      tradePrice: 725,
      valueCr: 835.2161,
    },
    {
      date: '2026-09-01',
      dealType: 'BULK',
      symbol: 'LENSKART',
      clientName: 'STALE CLIENT',
      buySell: 'SELL',
      quantity: 500000,
      tradePrice: 700,
      valueCr: 35,
    },
  ];

  const merged = mergeAndDeduplicateBulkBlockDeals([], deals, '2026-11-24');
  assert.equal(merged.length, 2);
  const steadview = merged.find((d) => d.buySell === 'SELL');
  assert.equal(steadview?.dealType, 'BLOCK');

  const summary = getBulkBlock30DSummaryForSymbol(
    'LENSKART',
    { lastSyncedUtc: '2026-11-24T00:00:00Z', deals },
    '2026-11-24'
  );
  assert.equal(summary.totalDeals, 2);
  assert.equal(summary.buyValueCr, 835.22);
  assert.equal(summary.sellValueCr, 835.22);
  assert.equal(summary.netValueCr, 0);
  assert.equal(summary.sentiment, 'NEUTRAL');
});

test('filterDealsWithin30Days drops expired and invalid dates cleanly', () => {
  const sample: BulkBlockDealItem[] = [
    {
      date: '2026-11-23',
      dealType: 'BULK',
      symbol: 'INFY',
      clientName: 'A',
      buySell: 'BUY',
      quantity: 1000,
      tradePrice: 1500,
      valueCr: 0.15,
    },
    {
      date: '2026-10-01',
      dealType: 'BULK',
      symbol: 'INFY',
      clientName: 'B',
      buySell: 'SELL',
      quantity: 1000,
      tradePrice: 1500,
      valueCr: 0.15,
    },
    {
      date: 'BAD',
      dealType: 'BULK',
      symbol: 'INFY',
      clientName: 'C',
      buySell: 'BUY',
      quantity: 1000,
      tradePrice: 1500,
      valueCr: 0.15,
    },
  ];

  const filtered = filterDealsWithin30Days(sample, '2026-11-24', 30);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].date, '2026-11-23');
});

test('computeWeightedAvgBuyDealPrice computes quantity-weighted VWAP rather than arithmetic mean', () => {
  const deals: BulkBlockDealItem[] = [
    {
      date: '2026-11-23',
      dealType: 'BULK',
      symbol: 'TEST',
      clientName: 'SMALL PRINT',
      buySell: 'BUY',
      quantity: 100,
      tradePrice: 100,
      valueCr: 0.001,
    },
    {
      date: '2026-11-23',
      dealType: 'BLOCK',
      symbol: 'TEST',
      clientName: 'INSTITUTION',
      buySell: 'BUY',
      quantity: 999900,
      tradePrice: 200,
      valueCr: 19.998,
    },
  ];

  const vwap = computeWeightedAvgBuyDealPrice(deals);
  assert.equal(vwap, 199.99);
});
