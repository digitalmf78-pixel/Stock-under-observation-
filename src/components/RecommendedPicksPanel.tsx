import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { RecommendedStockPick, RecommendedStocksResponse } from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapShortLabel } from '../utils/marketCap';
import { evaluateQuoteFreshness } from '../utils/quoteFreshness';
import {
  executePaperBuy,
  getOpenVaultSymbolCounts,
  syncAndLoadPaperPortfolio,
} from '../utils/paperTradeClient';

interface RecommendedPicksPanelProps {
  onSelectSymbol: (symbol: string) => void;
  onPaperBought?: () => void;
}

export const RecommendedPicksPanel: React.FC<RecommendedPicksPanelProps> = ({
  onSelectSymbol,
  onPaperBought,
}) => {
  const [data, setData] = useState<RecommendedStocksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingSym, setBuyingSym] = useState<string | null>(null);
  const [buyNotice, setBuyNotice] = useState<string | null>(null);
  const [heldCounts, setHeldCounts] = useState<Record<string, number>>(() =>
    getOpenVaultSymbolCounts()
  );

  useEffect(() => {
    const refreshHeld = () => setHeldCounts(getOpenVaultSymbolCounts());
    window.addEventListener('paper-portfolio-updated', refreshHeld);
    void syncAndLoadPaperPortfolio({ live: false })
      .then(() => refreshHeld())
      .catch(() => undefined);
    return () => window.removeEventListener('paper-portfolio-updated', refreshHeld);
  }, []);

  const loadRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bot/recommendations?limit=8');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message || 'Failed to load recommended stocks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  const handlePaperBuyPick = async (pick: RecommendedStockPick) => {
    setBuyingSym(pick.symbol);
    setBuyNotice(null);
    try {
      const json = await executePaperBuy({
        symbol: pick.symbol,
        entryPrice: pick.livePrice ?? pick.entryPrice,
        stopLoss: pick.stopLoss,
        targetPrice: pick.target15Pct,
        strategyTag: 'v3 Bot',
        notes: `Confluence ${pick.confluenceScore}/100 · ${pick.filtersPassed.slice(0, 4).join(', ')}`,
        preferLive: true,
      });
      setHeldCounts(getOpenVaultSymbolCounts());
      setBuyNotice(
        `Paper BUY locked in portfolio: ${json.trade.symbol} x ${json.trade.quantity} @ ₹${json.trade.entryPrice.toFixed(2)} (${json.trade.entryPriceSource})`
      );
      onPaperBought?.();
    } catch (err) {
      setError((err as Error).message || 'Paper BUY failed');
    } finally {
      setBuyingSym(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              All-Filter Recommended Stocks &amp; Open-Source Research Analysis
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Daily scanner picks refresh dynamically each session — click <strong>Paper BUY</strong> to lock any stock into your permanent Paper Portfolio below until you explicitly Exit.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRecommendations()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analyzing Universe...' : 'Re-Run All-Filter Picks'}
        </button>
      </div>

      {buyNotice && (
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs font-mono text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{buyNotice}</span>
        </div>
      )}
      {error && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="p-8 text-center text-xs text-slate-500">
          Scanning top NSE Mainboard confluence candidates across all fundamental, delivery, U-Turn, Wyckoff &amp; macro filters...
        </div>
      ) : data && data.picks.length > 0 ? (
        <div className="p-4 space-y-4">
          <div className="text-[11px] font-mono text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <span>
              Evaluated Top {data.scannedUniverseCount} Confluence Candidates · Strict All-Filter Passes:{' '}
              <strong className="text-slate-900">{data.strictPassCount}</strong> · Regime:{' '}
              <strong className="text-slate-900">{data.regimeVerdict}</strong>
            </span>
            <span>Click Paper BUY to send any pick straight to your Paper Trading Journal</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.picks.map((pick) => (
              <div
                key={pick.symbol}
                className={`border rounded-lg p-4 space-y-3 text-xs ${
                  pick.tier === 'ALL_FILTER_PASS'
                    ? 'border-emerald-300 bg-emerald-50/20'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(pick.symbol)}
                        className="font-mono text-sm font-bold text-blue-700 hover:underline"
                      >
                        {pick.symbol}
                      </button>
                      {(heldCounts[pick.symbol.toUpperCase()] || 0) > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-emerald-700 text-white rounded">
                          IN PORTFOLIO ({heldCounts[pick.symbol.toUpperCase()]})
                        </span>
                      )}
                      {getCapShortLabel(pick.marketCapCategory) && (
                        <span
                          title={formatMarketCapCr(pick.marketCapCr)}
                          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                            pick.marketCapCategory
                          )}`}
                        >
                          {getCapShortLabel(pick.marketCapCategory)}
                        </span>
                      )}
                      {pick.isIpo && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                          IPO
                        </span>
                      )}
                      {pick.ema21Cross44Bullish ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                          21×44 Cross
                        </span>
                      ) : pick.ema21AboveEma44 ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-emerald-50/60 text-emerald-700 border border-emerald-200 rounded">
                          EMA 21&gt;44
                        </span>
                      ) : null}
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border ${
                          pick.tier === 'ALL_FILTER_PASS'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {pick.tier === 'ALL_FILTER_PASS' ? 'ALL FILTERS PASS' : 'HIGH CONFLUENCE WATCH'}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-slate-800">
                        Confluence {pick.confluenceScore}/100 · Bot {pick.botScore}/100
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {pick.companyName} · {pick.sector}
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    {pick.livePrice !== null ? (
                      (() => {
                        const diffInr = pick.livePrice - pick.eodClose;
                        const diffPct =
                          pick.eodClose > 0 ? (diffInr / pick.eodClose) * 100 : null;
                        const isUp = diffInr >= 0;
                        const freshness = evaluateQuoteFreshness({
                          lastUpdated: pick.liveLastUpdated,
                          marketTimeIst: pick.liveMarketTimeIst,
                          marketDateIst: pick.liveMarketDateIst,
                          marketState: pick.liveMarketState,
                        });
                        return (
                          <>
                            <div className="font-bold text-slate-900 inline-flex flex-wrap items-center justify-end gap-1">
                              {freshness.isLive && (
                                <span className="inline-flex items-center gap-1 text-emerald-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span>Live</span>
                                </span>
                              )}
                              <span>₹{pick.livePrice.toFixed(2)}</span>
                              {freshness.badgeLabel && (
                                <span
                                  title={freshness.reason ?? undefined}
                                  className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase text-white ${
                                    freshness.isStale ? 'bg-rose-600' : 'bg-slate-600'
                                  }`}
                                >
                                  {freshness.badgeLabel}
                                </span>
                              )}
                              <span
                                className={`text-[11px] ${
                                  freshness.isStale
                                    ? 'text-slate-500'
                                    : isUp
                                      ? 'text-emerald-700'
                                      : 'text-rose-700'
                                }`}
                              >
                                ({diffInr >= 0 ? '+' : ''}₹{diffInr.toFixed(2)}
                                {diffPct !== null
                                  ? ` / ${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`
                                  : ''}
                                )
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Scanner EOD ₹{pick.eodClose.toFixed(2)}
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <div className="font-bold text-amber-700">Live: DATA NOT AVAILABLE</div>
                        <div className="text-[11px] text-slate-500">
                          Scanner EOD ₹{pick.eodClose.toFixed(2)}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5 text-[11px]">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                    {pick.aiResearchBrief.headline}
                  </div>
                  <div className="text-slate-700">
                    <strong>Fundamentals &amp; Value:</strong> {pick.aiResearchBrief.fundamentalVerdict}
                  </div>
                  <div className="text-slate-700">
                    <strong>Technical Setup:</strong> {pick.aiResearchBrief.technicalSetup}
                  </div>
                  <div className="text-slate-700">
                    <strong>Macro &amp; News:</strong> {pick.aiResearchBrief.macroNewsContext}
                  </div>
                  <div className="font-mono text-slate-800">
                    <strong>Risk Plan:</strong> {pick.aiResearchBrief.riskPlan}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                  {pick.filtersPassed.slice(0, 6).map((fp) => (
                    <span
                      key={fp}
                      className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800"
                    >
                      ✓ {fp}
                    </span>
                  ))}
                  {pick.filtersFailedOrMissing.slice(0, 3).map((ff) => (
                    <span
                      key={ff}
                      className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-800"
                    >
                      ✕ {ff}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span className="text-[10px] text-slate-500">{pick.aiResearchBrief.dataGaps}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => onSelectSymbol(pick.symbol)}
                      className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
                    >
                      Deep-Dive
                    </button>
                    <button
                      type="button"
                      disabled={buyingSym === pick.symbol}
                      onClick={() => void handlePaperBuyPick(pick)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      {buyingSym === pick.symbol ? 'Buying...' : 'Paper BUY'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-slate-500">
          No confluence recommendations generated yet.
        </div>
      )}
    </div>
  );
};
