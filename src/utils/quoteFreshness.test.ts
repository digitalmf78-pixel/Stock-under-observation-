import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuoteFreshness, extractQuoteDateIst } from './quoteFreshness.ts';

describe('Live Quote Freshness Safety Check', () => {
  it('treats same-day IST quote during active trading as Live (no stale/closed badge)', () => {
    const now = new Date('2026-11-25T06:00:00Z'); // 2026-11-25 11:30 IST
    const marketTimeUnixSec = Math.floor(new Date('2026-11-25T05:59:00Z').getTime() / 1000);

    const res = evaluateQuoteFreshness({
      marketTimeUnixSec,
      marketTimeIst: '2026-11-25 11:29 IST',
      marketState: 'REGULAR',
      now,
    });

    assert.equal(res.isLive, true);
    assert.equal(res.isStale, false);
    assert.equal(res.isPreviousTradingDay, false);
    assert.equal(res.isSameTradingDay, true);
    assert.equal(res.badgeLabel, null);
    assert.equal(res.headerLabel, 'Current Live Price (vs EOD)');
  });

  it('flags previous-trading-day quote with STALE DATA badge and disables isLive', () => {
    const now = new Date('2026-11-25T04:00:00Z'); // 2026-11-25 09:30 IST
    const prevDayUnixSec = Math.floor(new Date('2026-11-24T09:59:00Z').getTime() / 1000); // 2026-11-24 15:29 IST

    const res = evaluateQuoteFreshness({
      lastUpdated: new Date(prevDayUnixSec * 1000).toISOString(),
      marketTimeUnixSec: prevDayUnixSec,
      marketTimeIst: '2026-11-24 15:29 IST',
      marketState: '',
      now,
    });

    assert.equal(res.isLive, false);
    assert.equal(res.isStale, true);
    assert.equal(res.isPreviousTradingDay, true);
    assert.equal(res.quoteDateIst, '2026-11-24');
    assert.equal(res.systemDateIst, '2026-11-25');
    assert.equal(res.badgeLabel, 'STALE DATA');
    assert.equal(res.headerLabel.toLowerCase().includes('live'), false);
  });

  it('compares API lastUpdated string directly against system date when unix sec is absent', () => {
    const now = new Date('2026-11-25T06:00:00Z'); // 2026-11-25 11:30 IST
    const oldSession = evaluateQuoteFreshness({
      lastUpdated: '2026-11-24T09:59:00Z',
      now,
    });
    assert.equal(oldSession.isLive, false);
    assert.equal(oldSession.isStale, true);
    assert.equal(oldSession.isPreviousTradingDay, true);
    assert.equal(oldSession.badgeLabel, 'STALE DATA');

    const currentSession = evaluateQuoteFreshness({
      lastUpdated: '2026-11-25T05:45:00Z',
      now,
    });
    assert.equal(currentSession.isLive, true);
    assert.equal(currentSession.isStale, false);
    assert.equal(currentSession.badgeLabel, null);
  });

  it('parses NSE DD-MMM-YYYY timestamps accurately and detects prior trading day', () => {
    const now = new Date('2026-11-25T05:00:00Z'); // 2026-11-25 10:30 IST

    assert.equal(
      extractQuoteDateIst({ timestamp: '24-Nov-2026 15:30:00' }),
      '2026-11-24'
    );

    const res = evaluateQuoteFreshness({
      lastUpdated: '24-Nov-2026 15:30:00',
      now,
    });

    assert.equal(res.isLive, false);
    assert.equal(res.isStale, true);
    assert.equal(res.isPreviousTradingDay, true);
    assert.equal(res.badgeLabel, 'STALE DATA');
  });

  it('marks same-day CLOSED/POST marketState with CLOSED badge and disables isLive', () => {
    const now = new Date('2026-11-25T11:00:00Z'); // 2026-11-25 16:30 IST
    const res = evaluateQuoteFreshness({
      lastUpdated: '2026-11-25 15:30 IST',
      marketState: 'CLOSED',
      now,
    });

    assert.equal(res.isLive, false);
    assert.equal(res.isPreviousTradingDay, false);
    assert.equal(res.isMarketClosed, true);
    assert.equal(res.badgeLabel, 'CLOSED');
    assert.equal(res.headerLabel.toLowerCase().includes('live'), false);
  });

  it('fails safe with STALE DATA when API lastUpdated/timestamp is missing or unparseable', () => {
    const now = new Date('2026-11-25T06:00:00Z');
    const res = evaluateQuoteFreshness({
      lastUpdated: '',
      marketTimeIst: '',
      timestamp: '',
      marketState: 'CLOSED',
      now,
    });

    assert.equal(res.isLive, false);
    assert.equal(res.isStale, true);
    assert.equal(res.quoteDateIst, null);
    assert.equal(res.badgeLabel, 'STALE DATA');
    assert.equal(res.headerLabel.toLowerCase().includes('live'), false);
  });
});
