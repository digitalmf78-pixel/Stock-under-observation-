import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deduplicateFilings,
  getCatalystNewsWithAiSummary,
} from './catalystNewsService.ts';
import type { CorporateFilingHeadline } from '../../src/types/trading.ts';

test('deduplicateFilings sorts newest-first and removes duplicate headlines', () => {
  const filings: CorporateFilingHeadline[] = [
    {
      id: '1',
      date: '2026-11-18',
      source: 'BSE Filing',
      category: 'Order / Contract',
      headline: 'Company bags Rs 450 Cr infrastructure order',
      details: '',
      url: 'https://bseindia.com/1.pdf',
    },
    {
      id: '2',
      date: '2026-11-18',
      source: 'NSE Filing',
      category: 'Order / Contract',
      headline: 'Company bags Rs 450 Cr infrastructure order!',
      details: '',
      url: 'https://nseindia.com/1.pdf',
    },
    {
      id: '3',
      date: '2026-11-22',
      source: 'BSE Filing',
      category: 'Results / Board',
      headline: 'Outcome of Board Meeting - Q2 FY27 Results Approved',
      details: '',
      url: 'https://bseindia.com/2.pdf',
    },
  ];

  const deduped = deduplicateFilings(filings, 10);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].date, '2026-11-22');
  assert.equal(deduped[1].date, '2026-11-18');
});

test('getCatalystNewsWithAiSummary returns 3-bullet Bull/Bear/Neutral sentiment list with corporate filings', async () => {
  const result = await getCatalystNewsWithAiSummary(
    {
      symbol: 'TCS',
      companyName: 'Tata Consultancy Services Ltd',
      xbrlFilings: [
        {
          symbol: 'TCS',
          financialPeriodEnd: '2026-09-30',
          publicationDate: '2026-10-12',
          publicationDateStatus: 'ON_TIME',
          filingDescription: 'Audited Standalone & Consolidated Financial Results',
          officialFilingUrl: 'https://nsearchives.nseindia.com/tcs.xml',
          officialSource: 'NSE',
          retrievedAtUtc: '2026-10-12T10:00:00Z',
        },
      ],
    },
    {
      fetchBseFilings: async () => [
        {
          id: 'bse-1',
          date: '2026-11-20',
          source: 'BSE Filing',
          category: 'Order / Contract',
          headline: 'TCS signs multi-year European banking modernization deal',
          details: 'Multi-year digital transformation contract',
          url: 'https://bseindia.com/deal.pdf',
        },
        {
          id: 'bse-2',
          date: '2026-11-19',
          source: 'BSE Filing',
          category: 'Regulatory Filing',
          headline: 'Receipt of GST demand notice of Rs 12 Cr under appeal',
          details: 'Tax order contested before appellate authority',
          url: 'https://bseindia.com/gst.pdf',
        },
      ],
      fetchNseFilings: async () => [],
      generateSummary: async ({ filings }) => {
        assert.equal(filings.length, 3);
        return {
          overallSentiment: 'BULL',
          model: 'gemini-4-hydrogen',
          sentimentBullets: [
            {
              sentiment: 'BULL',
              topic: 'European Banking Deal',
              summary: 'Nov 20 filing highlights a new multi-year European banking transformation contract.',
            },
            {
              sentiment: 'BEAR',
              topic: 'GST Demand Notice',
              summary: 'Nov 19 disclosure flags a Rs 12 Cr tax demand currently under appellate contest.',
            },
            {
              sentiment: 'NEUTRAL',
              topic: 'Quarterly XBRL Filing',
              summary: 'Oct 12 on-time consolidated results filing for period ended Sep 2026.',
            },
          ],
        };
      },
    }
  );

  assert.equal(result.symbol, 'TCS');
  assert.equal(result.filings.length, 3);
  assert.equal(result.overallSentiment, 'BULL');
  assert.equal(result.sentimentBullets.length, 3);
  assert.deepEqual(
    result.sentimentBullets.map((b) => b.sentiment),
    ['BULL', 'BEAR', 'NEUTRAL']
  );
  assert.equal(result.aiError, null);
});

test('getCatalystNewsWithAiSummary preserves fetched filings and exposes explicit aiError if Gemini fails', async () => {
  const result = await getCatalystNewsWithAiSummary(
    { symbol: 'INFY', companyName: 'Infosys Ltd' },
    {
      fetchBseFilings: async () => [
        {
          id: 'bse-infy-1',
          date: '2026-11-21',
          source: 'BSE Filing',
          category: 'Corporate Action',
          headline: 'Intimation of Record Date for Interim Dividend',
          details: '',
          url: 'https://bseindia.com/infy.pdf',
        },
      ],
      fetchNseFilings: async () => [],
      generateSummary: async () => {
        throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
      },
    }
  );

  assert.equal(result.filings.length, 1);
  assert.equal(result.sentimentBullets.length, 0);
  assert.match(result.aiError ?? '', /GEMINI_API_KEY/);
});
