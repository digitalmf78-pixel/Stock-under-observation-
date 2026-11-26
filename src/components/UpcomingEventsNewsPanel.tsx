import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Landmark,
  Newspaper,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type { CorporateAnnouncementItem, StockCatalystProfile } from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapLabel } from '../utils/marketCap';

interface UpcomingEventsNewsPanelProps {
  symbol: string;
  data: StockCatalystProfile | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export const UpcomingEventsNewsPanel: React.FC<UpcomingEventsNewsPanelProps> = ({
  symbol,
  data,
  loading,
  error,
  onRefresh,
}) => {
  const [newsQ, setNewsQ] = useState('');
  const [newsSentiment, setNewsSentiment] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL');
  const [filingCat, setFilingCat] = useState<'ALL' | CorporateAnnouncementItem['category']>('ALL');
  const [dealTypeFilter, setDealTypeFilter] = useState<'ALL' | 'BULK' | 'BLOCK'>('ALL');
  const [dealSideFilter, setDealSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [showAllDeals, setShowAllDeals] = useState(false);

  const formatDealCr = (valCr: number): string => {
    const abs = Math.abs(valCr);
    if (abs > 0 && abs < 0.01) {
      return `₹${(abs * 100).toFixed(2)} L`;
    }
    return `₹${abs.toFixed(2)} Cr`;
  };

  const filteredDeals = useMemo(() => {
    const rawDeals = data?.bulkBlock30D.deals ?? [];
    return rawDeals.filter((d) => {
      if (dealTypeFilter !== 'ALL' && d.dealType !== dealTypeFilter) return false;
      if (dealSideFilter !== 'ALL' && d.buySell !== dealSideFilter) return false;
      return true;
    });
  }, [data, dealTypeFilter, dealSideFilter]);

  const filteredNews = useMemo(() => {
    if (!data) return [];
    const q = newsQ.trim().toLowerCase();
    return data.news7D.filter((n) => {
      if (newsSentiment !== 'ALL' && n.sentiment !== newsSentiment) return false;
      if (q && !`${n.title} ${n.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, newsQ, newsSentiment]);

  const filteredAnnouncements = useMemo(() => {
    if (!data) return [];
    const q = newsQ.trim().toLowerCase();
    return data.announcements.filter((a) => {
      if (newsSentiment !== 'ALL' && a.sentiment !== newsSentiment) return false;
      if (filingCat !== 'ALL' && a.category !== filingCat) return false;
      if (q && !`${a.subject} ${a.details} ${a.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, newsQ, newsSentiment, filingCat]);

  const posNewsCount = data ? data.news7D.filter((n) => n.sentiment === 'POSITIVE').length : 0;
  const negNewsCount = data ? data.news7D.filter((n) => n.sentiment === 'NEGATIVE').length : 0;
  const posEventsCount = data
    ? data.announcements.filter((a) => a.sentiment === 'POSITIVE').length
    : 0;
  const negEventsCount = data
    ? data.announcements.filter((a) => a.sentiment === 'NEGATIVE').length
    : 0;
  const boardMeetingsCount = data
    ? data.announcements.filter((a) => a.category === 'RESULTS_BOARD_MEETING').length
    : 0;

  const overallImpact = (() => {
    if (!data) return null;
    let score = 0;
    if (data.resultPolarity3M === 'POSITIVE') score += 2;
    if (data.resultPolarity3M === 'NEGATIVE') score -= 2;
    if (data.bulkBlock30D.sentiment === 'POSITIVE') score += 2;
    if (data.bulkBlock30D.sentiment === 'NEGATIVE') score -= 2;
    score += posNewsCount + posEventsCount;
    score -= negNewsCount + negEventsCount;

    if (score >= 2) return 'POSITIVE' as const;
    if (score <= -1) return 'NEGATIVE' as const;
    return 'NEUTRAL' as const;
  })();

  const inNext3M =
    data?.resultPriority === 'WITHIN_1M' ||
    data?.resultPriority === 'WITHIN_2M' ||
    data?.resultPriority === 'WITHIN_3M';

  const formatPriorityLabel = (tier: StockCatalystProfile['resultPriority']) => {
    switch (tier) {
      case 'WITHIN_1M':
        return 'Next 1 Month (Priority 1)';
      case 'WITHIN_2M':
        return 'Next 2 Months (Priority 2)';
      case 'WITHIN_3M':
        return 'Next 3 Months (Priority 3)';
      case 'BEYOND_3M':
        return 'Beyond 3 Months';
      default:
        return 'Unscheduled';
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Section Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-700" />
              Upcoming Events &amp; News
            </h3>
            {data && getCapLabel(data.marketCapCategory) && (
              <span
                title={formatMarketCapCr(data.marketCapCr)}
                className={`px-2 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                  data.marketCapCategory
                )}`}
              >
                {getCapLabel(data.marketCapCategory)}
              </span>
            )}
            {data?.ema21Cross44Bullish ? (
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                EMA 21×44 Cross
              </span>
            ) : data?.ema21AboveEma44 ? (
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50/70 text-emerald-700 border border-emerald-200 rounded">
                EMA 21 &gt; 44
              </span>
            ) : null}
            {overallImpact && (
              <span
                className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${
                  overallImpact === 'POSITIVE'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : overallImpact === 'NEGATIVE'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {overallImpact === 'POSITIVE'
                  ? 'POSITIVE SENTIMENT'
                  : overallImpact === 'NEGATIVE'
                    ? 'NEGATIVE SENTIMENT'
                    : 'MIXED / NEUTRAL'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Last 7 days live news &amp; BSE corporate filings, upcoming result announcements (next 3 months), and 30-day Bulk/Block deals with Green/Red sentiment coding.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {data?.fetchedAtUtc && (
            <span className="hidden sm:inline font-mono text-[11px] text-slate-400">
              Synced {data.fetchedAtUtc.slice(0, 16).replace('T', ' ')} UTC
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Fetching 7D Feed...' : 'Refresh 7D & Deals'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-5 text-xs text-rose-700">{error}</div>
      ) : !data ? (
        <div className="p-6 text-xs text-slate-500">
          Fetching last 7 days news, upcoming 3-month result dates &amp; 30-day Bulk/Block deals for {symbol}...
        </div>
      ) : (
        <div className="p-5 space-y-5 text-xs">
          {/* 4-Card Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Upcoming Result Announcement (Next 3 Months) */}
            <div
              className={`p-3 border rounded-md ${
                inNext3M && data.resultPolarity3M === 'POSITIVE'
                  ? 'bg-emerald-50/50 border-emerald-200'
                  : inNext3M && data.resultPolarity3M === 'NEGATIVE'
                    ? 'bg-rose-50/50 border-rose-200'
                    : inNext3M
                      ? 'bg-blue-50/40 border-blue-200'
                      : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="text-slate-600 font-medium">Upcoming Result (Next 3M)</div>
              <div
                className={`mt-1 font-mono font-semibold ${
                  inNext3M ? 'text-slate-900' : 'text-slate-500'
                }`}
              >
                {formatPriorityLabel(data.resultPriority)}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-700">
                {data.nextResultDate ? (
                  <>
                    {data.nextResultDate}
                    {data.daysToResult !== null ? ` · in ${data.daysToResult}d` : ''}
                    {data.isResultEstimate ? ' (Est)' : ' (Official)'}
                  </>
                ) : (
                  'No upcoming result date announced'
                )}
              </div>
            </div>

            {/* Card 2: 3M Result Polarity */}
            <div
              className={`p-3 border rounded-md ${
                data.resultPolarity3M === 'POSITIVE'
                  ? 'bg-emerald-50/60 border-emerald-200'
                  : data.resultPolarity3M === 'NEGATIVE'
                    ? 'bg-rose-50/60 border-rose-200'
                    : 'bg-amber-50/50 border-amber-200'
              }`}
            >
              <div className="text-slate-600 font-medium">3M Earnings Sentiment</div>
              <div
                className={`mt-1 font-mono font-semibold inline-flex items-center gap-1 ${
                  data.resultPolarity3M === 'POSITIVE'
                    ? 'text-emerald-700'
                    : data.resultPolarity3M === 'NEGATIVE'
                      ? 'text-rose-700'
                      : 'text-amber-700'
                }`}
              >
                {data.resultPolarity3M === 'POSITIVE' ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : data.resultPolarity3M === 'NEGATIVE' ? (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                ) : null}
                {data.resultPolarity3M}
              </div>
              <div className="mt-1 text-[11px] text-slate-700 leading-snug">
                {data.result3MReason}
              </div>
            </div>

            {/* Card 3: 30-Day Bulk & Block Deals Summary */}
            <div
              className={`p-3 border rounded-md ${
                data.bulkBlock30D.sentiment === 'POSITIVE'
                  ? 'bg-emerald-50/60 border-emerald-200'
                  : data.bulkBlock30D.sentiment === 'NEGATIVE'
                    ? 'bg-rose-50/60 border-rose-200'
                    : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="text-slate-600 font-medium">30D Bulk &amp; Block Deals</div>
              <div
                className={`mt-1 font-mono font-semibold tabular-nums ${
                  data.bulkBlock30D.sentiment === 'POSITIVE'
                    ? 'text-emerald-700'
                    : data.bulkBlock30D.sentiment === 'NEGATIVE'
                      ? 'text-rose-700'
                      : 'text-slate-800'
                }`}
              >
                {data.bulkBlock30D.totalDeals > 0
                  ? `${data.bulkBlock30D.netValueCr >= 0 ? '+' : '-'}₹${Math.abs(data.bulkBlock30D.netValueCr).toFixed(2)} Cr (${data.bulkBlock30D.sentimentLabel || data.bulkBlock30D.sentiment})`
                  : '0 Deals (Neutral)'}
              </div>
              <div className="mt-1 font-mono text-[11px] tabular-nums flex flex-wrap items-center gap-1.5">
                <span className="text-emerald-700 font-medium">
                  Buy {data.bulkBlock30D.buyCount} (₹{data.bulkBlock30D.buyValueCr.toFixed(2)}Cr)
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-rose-700 font-medium">
                  Sell {data.bulkBlock30D.sellCount} (₹{data.bulkBlock30D.sellValueCr.toFixed(2)}Cr)
                </span>
                {data.bulkBlock30D.buyPct !== undefined && data.bulkBlock30D.totalDeals > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-700 font-semibold">{data.bulkBlock30D.buyPct}% Buy</span>
                  </>
                )}
              </div>
              {data.bulkBlock30D.sentimentReason && (
                <div className="mt-1 text-[10px] text-slate-600 leading-snug">
                  {data.bulkBlock30D.sentimentReason}
                </div>
              )}
            </div>

            {/* Card 4: Rejection Gate Verdict */}
            <div
              className={`p-3 border rounded-md ${
                data.rejectionGate === 'PASS_OBSERVATION'
                  ? 'bg-emerald-50/60 border-emerald-200'
                  : data.rejectionGate === 'PENDING_VERIFICATION'
                    ? 'bg-amber-50/60 border-amber-200'
                    : 'bg-rose-50/60 border-rose-200'
              }`}
            >
              <div className="text-slate-600 font-medium">3M Catalyst Gate</div>
              <div
                className={`mt-1 font-mono font-semibold inline-flex items-center gap-1 ${
                  data.rejectionGate === 'PASS_OBSERVATION'
                    ? 'text-emerald-800'
                    : data.rejectionGate === 'PENDING_VERIFICATION'
                      ? 'text-amber-800'
                      : 'text-rose-800'
                }`}
              >
                {data.rejectionGate === 'PASS_OBSERVATION' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : data.rejectionGate !== 'PENDING_VERIFICATION' ? (
                  <ShieldAlert className="w-3.5 h-3.5" />
                ) : null}
                {data.rejectionGate}
              </div>
              <div className="mt-1 text-[11px] text-slate-700 leading-snug">
                {data.rejectionReasons[0] || ''}
              </div>
            </div>
          </div>

          {/* 30-Day Bulk & Block Deals Detailed Summary Table */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 text-slate-600" />
                30-Day Bulk &amp; Block Deals Log ({data.bulkBlock30D.totalDeals})
                {data.bulkBlock30D.sentimentLabel && (
                  <span className="ml-1 px-2 py-0.5 text-[10px] font-mono rounded bg-white border border-slate-200 text-slate-700">
                    {data.bulkBlock30D.sentimentLabel}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                {data.bulkBlock30D.deals.length > 0 && (
                  <>
                    <select
                      aria-label="Filter Deal Type"
                      value={dealTypeFilter}
                      onChange={(e) => setDealTypeFilter(e.target.value as typeof dealTypeFilter)}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px] font-sans text-slate-700"
                    >
                      <option value="ALL">All Types</option>
                      <option value="BULK">BULK Only</option>
                      <option value="BLOCK">BLOCK Only</option>
                    </select>
                    <select
                      aria-label="Filter Deal Action"
                      value={dealSideFilter}
                      onChange={(e) => setDealSideFilter(e.target.value as typeof dealSideFilter)}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-[11px] font-sans text-slate-700"
                    >
                      <option value="ALL">Buy &amp; Sell</option>
                      <option value="BUY">BUY Only</option>
                      <option value="SELL">SELL Only</option>
                    </select>
                  </>
                )}
                <span className="text-emerald-700 font-medium hidden sm:inline">
                  Green = Buy
                </span>
                <span className="text-rose-700 font-medium hidden sm:inline">
                  Red = Sell
                </span>
              </div>
            </div>

            {data.bulkBlock30D.totalDeals > 0 && (
              <div className="px-4 py-2.5 bg-white border-b border-slate-100 space-y-2 text-[11px]">
                {data.bulkBlock30D.buyPct !== undefined && (
                  <div className="space-y-1">
                    <div className="flex justify-between font-mono text-[10px]">
                      <span className="text-emerald-700 font-semibold">
                        Buy Flow {data.bulkBlock30D.buyPct}% (₹{data.bulkBlock30D.buyValueCr.toFixed(2)} Cr)
                      </span>
                      <span className="text-slate-600">
                        {data.bulkBlock30D.sentimentReason || ''}
                      </span>
                      <span className="text-rose-700 font-semibold">
                        Sell Flow {(100 - data.bulkBlock30D.buyPct).toFixed(1)}% (₹{data.bulkBlock30D.sellValueCr.toFixed(2)} Cr)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full overflow-hidden bg-slate-200 flex">
                      <div className="bg-emerald-500 h-full" style={{ width: `${data.bulkBlock30D.buyPct}%` }} />
                      <div className="bg-rose-500 h-full" style={{ width: `${100 - data.bulkBlock30D.buyPct}%` }} />
                    </div>
                  </div>
                )}
                {((data.bulkBlock30D.topBuyClients && data.bulkBlock30D.topBuyClients.length > 0) ||
                  (data.bulkBlock30D.topSellClients && data.bulkBlock30D.topSellClients.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-4 text-[11px]">
                    {data.bulkBlock30D.topBuyClients && data.bulkBlock30D.topBuyClients.length > 0 && (
                      <div>
                        <span className="font-semibold text-emerald-800">Top Institutional Buyers:</span>{' '}
                        <span className="text-slate-700">{data.bulkBlock30D.topBuyClients.join(' · ')}</span>
                      </div>
                    )}
                    {data.bulkBlock30D.topSellClients && data.bulkBlock30D.topSellClients.length > 0 && (
                      <div>
                        <span className="font-semibold text-rose-800">Top Institutional Sellers:</span>{' '}
                        <span className="text-slate-700">{data.bulkBlock30D.topSellClients.join(' · ')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {filteredDeals.length === 0 ? (
              <div className="p-3.5 text-slate-500 bg-white">
                {data.bulkBlock30D.deals.length === 0
                  ? <>No NSE Bulk or Block deals recorded for <span className="font-mono font-medium">{data.symbol}</span> in the trailing 30-day archive.</>
                  : 'No deals match the selected Bulk/Block or Buy/Sell filter.'}
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 font-medium">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Deal Type</th>
                        <th className="py-2 px-3">Client / Institution</th>
                        <th className="py-2 px-3">Action</th>
                        <th className="py-2 px-3 text-right">Quantity</th>
                        <th className="py-2 px-3 text-right">Price (₹)</th>
                        <th className="py-2 px-3 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(showAllDeals ? filteredDeals : filteredDeals.slice(0, 12)).map((d, idx) => {
                        const isBuy = d.buySell === 'BUY';
                        return (
                          <tr
                            key={`${d.date}-${d.dealType}-${d.clientName}-${idx}`}
                            className={
                              isBuy
                                ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                                : 'bg-rose-50/30 hover:bg-rose-50/60'
                            }
                          >
                            <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                              {d.date}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-700">{d.dealType}</td>
                            <td className="py-2 px-3 text-slate-900 font-medium max-w-[260px] truncate" title={d.clientName}>
                              {d.clientName}
                            </td>
                            <td className="py-2 px-3 font-mono">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                                  isBuy
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {isBuy ? (
                                  <ArrowUpRight className="w-3 h-3" />
                                ) : (
                                  <ArrowDownRight className="w-3 h-3" />
                                )}
                                {d.buySell}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                              {d.quantity.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                              ₹{d.tradePrice.toFixed(2)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                isBuy ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {isBuy ? '+' : '-'}{formatDealCr(d.valueCr)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredDeals.length > 12 && (
                  <div className="px-4 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-mono">
                      Showing {showAllDeals ? filteredDeals.length : 12} of {filteredDeals.length} deals
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllDeals((prev) => !prev)}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      {showAllDeals ? 'Show latest 12' : `Show all ${filteredDeals.length} deals`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive Filter Toolbar for 7D News & Corporate Filings */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={newsQ}
                  onChange={(e) => setNewsQ(e.target.value)}
                  placeholder="Search 7D news or BSE filings..."
                  className="pl-7 pr-2.5 py-1 bg-white border border-slate-200 rounded text-xs w-52 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>
              <select
                aria-label="Filter News Sentiment"
                value={newsSentiment}
                onChange={(e) => setNewsSentiment(e.target.value as typeof newsSentiment)}
                className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
              >
                <option value="ALL">All Sentiments</option>
                <option value="POSITIVE">Positive</option>
                <option value="NEGATIVE">Negative</option>
                <option value="NEUTRAL">Neutral</option>
              </select>
              <select
                aria-label="Filter Corporate Event Category"
                value={filingCat}
                onChange={(e) => setFilingCat(e.target.value as typeof filingCat)}
                className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700"
              >
                <option value="ALL">All Filing Categories</option>
                <option value="ORDER_WIN">Order Wins</option>
                <option value="RESULTS_BOARD_MEETING">Results / Board Meetings</option>
                <option value="EXPANSION_FUNDRAISE">Expansion / Fundraise</option>
                <option value="CORPORATE_ACTION">Corporate Action</option>
                <option value="GENERAL">General</option>
              </select>
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
              <span>
                News {filteredNews.length}/{data.news7D.length} · Filings {filteredAnnouncements.length}/
                {data.announcements.length}
              </span>
              {(newsQ || newsSentiment !== 'ALL' || filingCat !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setNewsQ('');
                    setNewsSentiment('ALL');
                    setFilingCat('ALL');
                  }}
                  className="px-2 py-0.5 text-[11px] font-sans font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* 2-Column Feed: Last 7 Days News + Upcoming Corporate Events & Board Meetings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Last 7 Days News */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Newspaper className="w-3.5 h-3.5 text-slate-500" />
                  Last 7 Days News ({filteredNews.length})
                </div>
                <div className="font-mono text-[11px] flex items-center gap-2">
                  <span className="text-emerald-700">+{posNewsCount} Pos</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-rose-700">-{negNewsCount} Neg</span>
                </div>
              </div>

              {filteredNews.length === 0 ? (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded text-slate-500">
                  No matching news articles indexed within the last 7 days.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden max-h-80 overflow-y-auto">
                  {filteredNews.slice(0, 15).map((n, idx) => {
                    const isPos = n.sentiment === 'POSITIVE';
                    const isNeg = n.sentiment === 'NEGATIVE';
                    return (
                      <li
                        key={idx}
                        className={`p-3 border-l-4 transition-colors ${
                          isPos
                            ? 'border-l-emerald-500 bg-emerald-50/20 hover:bg-emerald-50/40'
                            : isNeg
                              ? 'border-l-rose-500 bg-rose-50/20 hover:bg-rose-50/40'
                              : 'border-l-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <a
                            href={n.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-slate-900 hover:text-blue-700 inline-flex items-start gap-1 leading-snug"
                          >
                            <span>{n.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
                          </a>
                          <span
                            className={`shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                              isPos
                                ? 'bg-emerald-100 text-emerald-800'
                                : isNeg
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {n.sentiment}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                          <span>{n.source || 'Google News'}</span>
                          <span>·</span>
                          <span>{n.ageDays}d ago</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Corporate Events, Result Board Meetings & Orders */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5 text-slate-500" />
                  Upcoming Result Notices, Orders &amp; Filings ({filteredAnnouncements.length})
                </div>
                <div className="font-mono text-[11px] flex items-center gap-2 text-slate-500">
                  <span className="text-blue-700">{boardMeetingsCount} Result</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-emerald-700">{data.orderWinsCount} Orders</span>
                </div>
              </div>

              {filteredAnnouncements.length === 0 ? (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded text-slate-500">
                  No matching BSE corporate events, board meeting notices, or order filings in the last 45 days.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden max-h-80 overflow-y-auto">
                  {filteredAnnouncements.slice(0, 15).map((a, idx) => {
                    const isPos = a.sentiment === 'POSITIVE' || a.category === 'ORDER_WIN';
                    const isNeg = a.sentiment === 'NEGATIVE';
                    return (
                      <li
                        key={idx}
                        className={`p-3 border-l-4 transition-colors ${
                          isPos
                            ? 'border-l-emerald-500 bg-emerald-50/20 hover:bg-emerald-50/40'
                            : isNeg
                              ? 'border-l-rose-500 bg-rose-50/20 hover:bg-rose-50/40'
                              : a.category === 'RESULTS_BOARD_MEETING'
                                ? 'border-l-blue-500 bg-blue-50/15 hover:bg-blue-50/30'
                                : 'border-l-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                a.category === 'ORDER_WIN'
                                  ? 'font-semibold text-emerald-700'
                                  : a.category === 'RESULTS_BOARD_MEETING'
                                    ? 'font-semibold text-blue-700'
                                    : 'text-slate-600'
                              }
                            >
                              {a.category}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                isPos
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isNeg
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {isPos ? 'POSITIVE' : isNeg ? 'NEGATIVE' : 'NEUTRAL'}
                            </span>
                          </div>
                          <span className="text-slate-500">{a.date}</span>
                        </div>
                        <div className="mt-1 font-medium text-slate-900 leading-snug">
                          {a.subject}
                        </div>
                        {a.attachmentUrl && (
                          <a
                            href={a.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline"
                          >
                            View Official PDF
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
