import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  CatalystNewsResponse,
  CatalystSentimentLabel,
} from '../types/trading';

interface CatalystNewsCardProps {
  symbol: string;
  externalRefreshSeq?: number;
}

type SourceFilter = 'ALL' | 'BSE' | 'NSE';

function renderSentimentBadge(sentiment: CatalystSentimentLabel) {
  if (sentiment === 'BULL') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
        <span>BULL</span>
      </span>
    );
  }
  if (sentiment === 'BEAR') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 whitespace-nowrap shrink-0">
        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
        <span>BEAR</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
      <Minus className="w-3.5 h-3.5 shrink-0" />
      <span>NEUTRAL</span>
    </span>
  );
}

export const CatalystNewsCard: React.FC<CatalystNewsCardProps> = ({
  symbol,
  externalRefreshSeq = 0,
}) => {
  const [data, setData] = useState<CatalystNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [showAllFilings, setShowAllFilings] = useState(false);

  const loadCatalystNews = useCallback(
    async (forceRefresh = false, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/catalyst-news${
            forceRefresh ? '?refresh=1' : ''
          }`,
          { signal }
        );
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setData(json as CatalystNewsResponse);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Failed to load catalyst news');
        }
      } finally {
        setLoading(false);
      }
    },
    [symbol]
  );

  useEffect(() => {
    setData(null);
    setSourceFilter('ALL');
    setShowAllFilings(false);
    const controller = new AbortController();
    void loadCatalystNews(false, controller.signal);
    return () => controller.abort();
  }, [symbol, loadCatalystNews]);

  useEffect(() => {
    if (externalRefreshSeq > 0) {
      void loadCatalystNews(true);
    }
  }, [externalRefreshSeq, loadCatalystNews]);

  const filteredFilings = useMemo(() => {
    const items = data?.filings ?? [];
    if (sourceFilter === 'BSE') {
      return items.filter((f) => f.source === 'BSE Filing');
    }
    if (sourceFilter === 'NSE') {
      return items.filter((f) => f.source === 'NSE Filing' || f.source === 'NSE XBRL');
    }
    return items;
  }, [data, sourceFilter]);

  const visibleFilings = showAllFilings ? filteredFilings : filteredFilings.slice(0, 5);

  return (
    <section
      aria-label="Catalyst News"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Catalyst News</h3>
            {data?.overallSentiment && (
              <>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <span>Net Tone:</span>
                  {renderSentimentBadge(data.overallSentiment)}
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            Recent corporate filings · AI Bull/Bear/Neutral sentiment summary
            {data ? ` · ${data.filings.length} filings` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadCatalystNews(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Summarizing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Request-level Error State */}
      {error && (
        <div className="px-5 py-4 bg-rose-50/70 border-b border-rose-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-rose-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadCatalystNews(true)}
            className="px-3 py-1.5 text-xs font-medium text-rose-800 bg-white border border-rose-200 hover:bg-rose-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton State */}
      {loading && !data ? (
        <div className="divide-y divide-slate-100">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="px-5 py-3.5 flex items-start gap-4">
              <div className="w-20 h-4 bg-slate-100 rounded animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="w-36 h-3.5 bg-slate-100 rounded animate-pulse" />
                <div className="w-full h-3.5 bg-slate-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : data && data.filings.length === 0 ? (
        <div className="px-5 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              No recent BSE or NSE corporate filings were found for {symbol} over the last 45 days.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadCatalystNews(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Check Again
          </button>
        </div>
      ) : (
        <>
          {/* 3-Bullet AI Bull / Bear / Neutral Sentiment List */}
          <div className="border-b border-slate-200">
            <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                3-Bullet AI Filing Sentiment Summary
              </span>
              {data?.aiModel && (
                <span className="text-[11px] font-mono text-slate-500">
                  Model: {data.aiModel}
                </span>
              )}
            </div>

            {data?.aiError ? (
              <div className="px-5 py-3.5 bg-amber-50/60 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>AI summary unavailable: {data.aiError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadCatalystNews(true)}
                  className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-200 hover:bg-amber-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  Retry Summary
                </button>
              </div>
            ) : data && data.sentimentBullets.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {data.sentimentBullets.slice(0, 3).map((bullet, idx) => (
                  <li
                    key={`${bullet.sentiment}-${idx}`}
                    className="px-5 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4"
                  >
                    <div className="w-24 pt-0.5 shrink-0">
                      {renderSentimentBadge(bullet.sentiment)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-900">{bullet.topic}</div>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                        {bullet.summary}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-3.5 text-xs text-slate-500">
                No AI sentiment bullets returned for current filings.
              </div>
            )}
          </div>

          {/* Corporate Filing Headlines List */}
          <div>
            <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Corporate Filing Headlines ({filteredFilings.length})
              </span>

              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                {(['ALL', 'BSE', 'NSE'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setSourceFilter(tab);
                      setShowAllFilings(false);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      sourceFilter === tab
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab === 'ALL' ? 'All Filings' : tab === 'BSE' ? 'BSE Filings' : 'NSE / XBRL'}
                  </button>
                ))}
              </div>
            </div>

            {visibleFilings.length === 0 ? (
              <div className="px-5 py-4 text-xs text-slate-500">
                No filings match the selected exchange filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleFilings.map((filing) => (
                  <div
                    key={filing.id}
                    className="px-5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      {filing.url ? (
                        <a
                          href={filing.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-slate-900 hover:text-blue-700 hover:underline inline-flex items-start gap-1.5"
                        >
                          <span>{filing.headline}</span>
                          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
                        </a>
                      ) : (
                        <div className="text-xs font-medium text-slate-900">{filing.headline}</div>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{filing.source}</span>
                        <span aria-hidden="true">·</span>
                        <span>{filing.category}</span>
                      </div>
                    </div>

                    <div className="text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                      {filing.date || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {filteredFilings.length > 5 && (
              <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/50">
                <button
                  type="button"
                  onClick={() => setShowAllFilings((v) => !v)}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline whitespace-nowrap shrink-0"
                >
                  {showAllFilings
                    ? 'Show fewer filings'
                    : `Show all ${filteredFilings.length} corporate filings`}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
