import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Layers,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import type { BotStockAnalysis, CheckGateStatus } from '../types/trading';
import { formatMarketCapCr, getCapBadgeClass, getCapLabel } from '../utils/marketCap';

interface BotStockAuditCardProps {
  symbol: string;
  externalRefreshSeq?: number;
  onAnalysisLoaded?: (analysis: BotStockAnalysis | null) => void;
}

const GateBadge: React.FC<{ status: CheckGateStatus }> = ({ status }) => {
  if (status === 'PASS') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5" />
        PASS
      </span>
    );
  }
  if (status === 'FAIL') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-rose-700">
        <XCircle className="w-3.5 h-3.5" />
        FAIL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-amber-700">
      <AlertTriangle className="w-3.5 h-3.5" />
      DATA NOT AVAILABLE
    </span>
  );
};

export const BotStockAuditCard: React.FC<BotStockAuditCardProps> = ({
  symbol,
  externalRefreshSeq = 0,
  onAnalysisLoaded,
}) => {
  const [data, setData] = useState<BotStockAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPiotroski, setShowPiotroski] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(true);

  const loadAnalysis = useCallback(async (sym: string, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/bot/stock/${encodeURIComponent(sym)}${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      onAnalysisLoaded?.(json);
    } catch (err) {
      setError((err as Error).message || 'Failed to compute v3 Bot analysis');
      onAnalysisLoaded?.(null);
    } finally {
      setLoading(false);
    }
  }, [onAnalysisLoaded]);

  useEffect(() => {
    void loadAnalysis(symbol, false);
  }, [symbol, loadAnalysis]);

  useEffect(() => {
    if (externalRefreshSeq > 0) {
      void loadAnalysis(symbol, true);
    }
  }, [externalRefreshSeq, symbol, loadAnalysis]);

  const verdictTone = (v: BotStockAnalysis['scoring']['verdict']) => {
    if (v === 'STRONG BUY') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (v === 'BUY (75% SIZE)' || v === 'BUY (50% SIZE)')
      return 'bg-blue-50 text-blue-800 border-blue-200';
    if (v === 'HARD REJECT') return 'bg-rose-50 text-rose-800 border-rose-200';
    return 'bg-slate-100 text-slate-800 border-slate-200';
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Open-Source v3 Swing Bot Audit (Phases 1–8 · Paper Trading Default)
            </h3>
            {data && getCapLabel(data.marketCapCategory) && (
              <span
                className={`px-2 py-0.5 text-[10px] font-mono font-semibold border rounded ${getCapBadgeClass(
                  data.marketCapCategory
                )}`}
              >
                {getCapLabel(data.marketCapCategory)}
                {data.marketCapCr ? ` · ${formatMarketCapCr(data.marketCapCr)}` : ''}
              </span>
            )}
            {data?.isIpo && (
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                IPO (&lt;1Y)
              </span>
            )}
            {data?.phase6EntryTriggers.ema21Cross44Bullish ? (
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                EMA 21×44 Bullish Cross
              </span>
            ) : data?.phase6EntryTriggers.ema21AboveEma44 ? (
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-50/70 text-emerald-700 border border-emerald-200 rounded">
                EMA 21 &gt; 44
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            100% Open-Source (Screener.in + BSE Official + NSE XBRL Fundamentals · Yahoo 3Y OHLCV · NSE Bhavcopy · ET/BS/LiveMint RSS) · Zero API Keys · Zero Fake Data
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {data && (
            <div className={`px-3 py-1 border rounded-md text-xs font-mono font-bold ${verdictTone(data.scoring.verdict)}`}>
              Score {data.scoring.totalScore}/100 · {data.scoring.verdict}
            </div>
          )}
          <button
            type="button"
            onClick={() => void loadAnalysis(symbol, true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 disabled:opacity-50 rounded-md transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Evaluating...' : 'Refresh Open-Source Bot'}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="p-8 text-center text-xs text-slate-500">
          Fetching Screener.in + BSE Official + NSE XBRL statements (9-pt Piotroski), Yahoo 3Y OHLCV, Graham/DCF, Wyckoff/VCP &amp; live macro RSS...
        </div>
      ) : error ? (
        <div className="p-6 text-xs text-rose-700">{error}</div>
      ) : data ? (
        <div className="p-5 space-y-5 text-xs">
          {/* Highlight Row: Burst Power Score (Sec 5) + Bulk & Block Deal Confirmation (Sec 6D) + Quick Verdict */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Burst Power Score Card (Section 5: Upward + Downward + Net Burst) */}
            <div className="border border-slate-200 rounded-md p-4 bg-slate-50/40 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <Zap className="w-4 h-4 text-blue-700" />
                  <span>Burst Power Score (252D Lookback · Sec 5)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 font-mono text-[10px] font-bold rounded border ${
                      data.phase4Movement.burstBias === 'UPWARD_DOMINANT'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : data.phase4Movement.burstBias === 'DOWNWARD_RISK'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : data.phase4Movement.burstBias === 'BALANCED'
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {data.phase4Movement.burstBias.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`px-2 py-0.5 font-mono text-[11px] font-bold rounded border ${
                      data.phase4Movement.burstPass === true
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : data.phase4Movement.burstPass === false
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {data.phase4Movement.burstPass === true
                      ? (data.phase4Movement.burstPowerNormalized ?? 0) >= 15
                        ? 'PROCEED (+10 PTS)'
                        : 'PROCEED (>=10)'
                      : data.phase4Movement.burstPass === false
                        ? 'SKIP'
                        : 'DATA NOT AVAILABLE'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                <div className="bg-white border border-slate-200 rounded p-2">
                  <div className="text-[10px] text-slate-500 font-sans">Upward Burst %</div>
                  <div className="text-base font-bold text-emerald-700 mt-0.5 tabular-nums">
                    {data.phase4Movement.burstPowerNormalized !== null
                      ? `Up ${data.phase4Movement.burstPowerNormalized.toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {data.phase4Movement.upwardBurstSharePct !== undefined &&
                    data.phase4Movement.upwardBurstSharePct !== null
                      ? `${data.phase4Movement.upwardBurstSharePct}% share · ${data.phase4Movement.upwardBurstDaysPct ?? 0}% days`
                      : `Raw +${data.phase4Movement.burstPowerRaw ?? '—'}`}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded p-2">
                  <div className="text-[10px] text-slate-500 font-sans">Downward Burst %</div>
                  <div className="text-base font-bold text-rose-700 mt-0.5 tabular-nums">
                    {data.phase4Movement.downwardBurstNormalized !== null
                      ? `Dn ${data.phase4Movement.downwardBurstNormalized.toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {data.phase4Movement.downwardBurstSharePct !== undefined &&
                    data.phase4Movement.downwardBurstSharePct !== null
                      ? `${data.phase4Movement.downwardBurstSharePct}% share · ${data.phase4Movement.downwardBurstDaysPct ?? 0}% days`
                      : `Raw -${data.phase4Movement.downwardBurstRaw ?? '—'}`}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded p-2">
                  <div className="text-[10px] text-slate-500 font-sans">Net Burst % (Up−Dn)</div>
                  <div
                    className={`text-base font-bold mt-0.5 tabular-nums ${
                      (data.phase4Movement.netBurstNormalized ?? 0) > 0
                        ? 'text-emerald-700'
                        : (data.phase4Movement.netBurstNormalized ?? 0) < 0
                          ? 'text-rose-700'
                          : 'text-slate-700'
                    }`}
                  >
                    {data.phase4Movement.netBurstNormalized !== null
                      ? `${data.phase4Movement.netBurstNormalized >= 0 ? '+' : ''}${data.phase4Movement.netBurstNormalized.toFixed(1)}%`
                      : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Net Raw {data.phase4Movement.netBurstRaw !== null ? `${data.phase4Movement.netBurstRaw >= 0 ? '+' : ''}${data.phase4Movement.netBurstRaw}` : '—'}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded p-2">
                  <div className="text-[10px] text-slate-500 font-sans">52W Dist / RS %ile</div>
                  <div
                    className={`text-sm font-bold mt-0.5 ${
                      data.phase4Movement.within25PctOf52wHigh ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {data.phase4Movement.distFrom52wHighPct !== null
                      ? `-${data.phase4Movement.distFrom52wHighPct}%`
                      : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    RS:{' '}
                    <span className={data.phase4Movement.rsPass ? 'text-emerald-700 font-bold' : 'text-slate-700'}>
                      {data.phase4Movement.relativeStrengthPctRank !== null
                        ? `${data.phase4Movement.relativeStrengthPctRank}%ile`
                        : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Upward vs Downward Ratio Bar */}
              {data.phase4Movement.burstPowerRaw !== null &&
                data.phase4Movement.downwardBurstRaw !== null && (() => {
                  const up = data.phase4Movement.burstPowerRaw ?? 0;
                  const dn = data.phase4Movement.downwardBurstRaw ?? 0;
                  const tot = up + dn;
                  const upPct =
                    data.phase4Movement.upwardBurstSharePct !== undefined &&
                    data.phase4Movement.upwardBurstSharePct !== null
                      ? data.phase4Movement.upwardBurstSharePct
                      : tot > 0
                        ? Number(((up / tot) * 100).toFixed(1))
                        : 0;
                  const dnPct =
                    data.phase4Movement.downwardBurstSharePct !== undefined &&
                    data.phase4Movement.downwardBurstSharePct !== null
                      ? data.phase4Movement.downwardBurstSharePct
                      : tot > 0
                        ? Number((100 - upPct).toFixed(1))
                        : 0;
                  return (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-slate-600">
                        <span className="text-emerald-700 font-semibold">Upward Share {upPct}% (+{up})</span>
                        <span>Lookback: {data.phase4Movement.lookbackDays} sessions</span>
                        <span className="text-rose-700 font-semibold">Downward Share {dnPct}% (-{dn})</span>
                      </div>
                      <div className="h-2 w-full rounded-full overflow-hidden bg-slate-200 flex">
                        <div className="bg-emerald-500 h-full" style={{ width: `${tot > 0 ? upPct : 50}%` }} />
                        <div className="bg-rose-500 h-full" style={{ width: `${tot > 0 ? dnPct : 50}%` }} />
                      </div>
                    </div>
                  );
                })()}

              <div className="text-[11px] bg-blue-50/50 border border-blue-200 rounded px-2.5 py-1.5 text-slate-700 leading-relaxed">
                <strong>Meaning in %:</strong> Upward % = strength of <code>+5%+</code> rally days; Downward % = strength of <code>-5%+</code> drop days. E.g.{' '}
                <span className="font-mono font-semibold text-slate-900">Up 20% / Dn 20%</span> = balanced 50/50 chop;{' '}
                <span className="font-mono font-semibold text-emerald-700">Up 25% / Dn 5%</span> = 83% bullish control.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono">
                <div className="bg-emerald-50/60 border border-emerald-200 rounded px-2.5 py-1.5 text-emerald-900">
                  ▲ Upward: +5–10% (×1): <strong>{data.phase4Movement.days5To10Pct}</strong> · +10–19% (×2):{' '}
                  <strong>{data.phase4Movement.days10To19Pct}</strong> · +19%+ (×3):{' '}
                  <strong>{data.phase4Movement.days19PlusPct}</strong>
                </div>
                <div className="bg-rose-50/60 border border-rose-200 rounded px-2.5 py-1.5 text-rose-900">
                  ▼ Downward: -5–10% (×1): <strong>{data.phase4Movement.downDays5To10Pct}</strong> · -10–19% (×2):{' '}
                  <strong>{data.phase4Movement.downDays10To19Pct}</strong> · -19%- (×3):{' '}
                  <strong>{data.phase4Movement.downDays19PlusPct}</strong>
                </div>
              </div>
            </div>

            {/* Bulk & Block Deal Confirmation Card (Section 6D) */}
            {(() => {
              const bb = data.phase5Accumulation.bulkBlockConfirmation;
              const badgeClass =
                bb.confirmationStatus === 'CONFIRMED'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : bb.confirmationStatus === 'ACTIVE_WATCH'
                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                    : bb.confirmationStatus === 'SELL_PRESSURE'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200';
              return (
                <div className="border border-slate-200 rounded-md p-4 bg-slate-50/40 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <Layers className="w-4 h-4 text-blue-700" />
                      <span>Bulk &amp; Block Deal Confirmation (30D NSE · Sec 6D)</span>
                    </div>
                    <span className={`px-2 py-0.5 font-mono text-[11px] font-bold rounded border ${badgeClass}`}>
                      {bb.confirmationStatus.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                    <div className="bg-white border border-slate-200 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-sans">Buy vs Sell Value</div>
                      <div className="text-xs font-bold mt-0.5">
                        <span className="text-emerald-700">₹{(bb.totalBuyCr ?? 0).toFixed(1)}Cr</span>
                        <span className="text-slate-400"> / </span>
                        <span className="text-rose-700">₹{(bb.totalSellCr ?? 0).toFixed(1)}Cr</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {bb.totalDeals30d} deals ({bb.bulkBuyCount + bb.blockBuyCount}B/{bb.bulkSellCount + bb.blockSellCount}S)
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-sans">Repeat Client</div>
                      <div className="text-sm font-bold text-slate-900 mt-0.5">
                        {bb.repeatedBuyPrints}x
                      </div>
                      <div className="text-[10px] text-slate-500 truncate" title={bb.repeatedBuyClientName || ''}>
                        {bb.repeatedBuyClientName || 'No repeat buyer'}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-sans">Net Deal Flow</div>
                      <div
                        className={`text-sm font-bold mt-0.5 ${
                          bb.netValueCr > 0
                            ? 'text-emerald-700'
                            : bb.netValueCr < 0
                              ? 'text-rose-700'
                              : 'text-slate-700'
                        }`}
                      >
                        {bb.totalDeals30d > 0
                          ? `${bb.netValueCr >= 0 ? '+' : ''}₹${bb.netValueCr} Cr`
                          : '₹0 Cr'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {bb.buyPct !== undefined ? `Buy Share ${bb.buyPct}%` : 'Flow Balance'}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-sans">Max Buy vs ADV</div>
                      <div className="text-sm font-bold text-slate-900 mt-0.5">
                        {bb.largestBuyDealCr !== null ? `₹${bb.largestBuyDealCr}Cr` : '—'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {bb.sizeVsAdvPct !== null ? `${bb.sizeVsAdvPct}% 20D ADV` : 'ADV N/A'}
                      </div>
                    </div>
                  </div>

                  {bb.totalDeals30d > 0 && bb.buyPct !== undefined && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-slate-600">
                        <span className="text-emerald-700 font-semibold">
                          Buy Share {bb.buyPct}% (₹{(bb.totalBuyCr ?? 0).toFixed(2)} Cr)
                        </span>
                        <span className="text-rose-700 font-semibold">
                          Sell Share {100 - bb.buyPct}% (₹{(bb.totalSellCr ?? 0).toFixed(2)} Cr)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full overflow-hidden bg-slate-200 flex">
                        <div className="bg-emerald-500 h-full" style={{ width: `${bb.buyPct}%` }} />
                        <div className="bg-rose-500 h-full" style={{ width: `${100 - bb.buyPct}%` }} />
                      </div>
                    </div>
                  )}

                  {((bb.topBuyClients && bb.topBuyClients.length > 0) ||
                    (bb.topSellClients && bb.topSellClients.length > 0)) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                      {bb.topBuyClients && bb.topBuyClients.length > 0 && (
                        <div className="bg-emerald-50/60 border border-emerald-200 rounded p-2">
                          <div className="font-semibold text-emerald-900 mb-1">Top Institutional / Bulk Buyers</div>
                          <div className="flex flex-wrap gap-1">
                            {bb.topBuyClients.map((c) => (
                              <span key={c} className="px-1.5 py-0.5 bg-white border border-emerald-200 rounded text-emerald-800 truncate max-w-full" title={c}>
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {bb.topSellClients && bb.topSellClients.length > 0 && (
                        <div className="bg-rose-50/60 border border-rose-200 rounded p-2">
                          <div className="font-semibold text-rose-900 mb-1">Top Institutional / Bulk Sellers</div>
                          <div className="flex flex-wrap gap-1">
                            {bb.topSellClients.map((c) => (
                              <span key={c} className="px-1.5 py-0.5 bg-white border border-rose-200 rounded text-rose-800 truncate max-w-full" title={c}>
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-[11px] font-mono text-slate-700 space-y-1 bg-white border border-slate-200 rounded p-2.5">
                    <div>
                      Price Context:{' '}
                      <strong
                        className={
                          bb.priceContext === 'ABOVE_RANGE'
                            ? 'text-emerald-700'
                            : 'text-slate-800'
                        }
                      >
                        {bb.priceContext.replace(/_/g, ' ')}
                      </strong>
                      {bb.avgBuyDealPrice !== null && bb.recentRange20dHigh !== null
                        ? ` (Avg Buy ₹${bb.avgBuyDealPrice} vs 20D High ₹${bb.recentRange20dHigh})`
                        : ''}
                    </div>
                    <div className="text-slate-700 font-sans leading-relaxed">{bb.confirmationReason}</div>
                  </div>

                  {bb.recentDeals.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[11px] font-mono">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-sans">
                            <th className="py-1 px-2">Date</th>
                            <th className="py-1 px-2">Type</th>
                            <th className="py-1 px-2">Side</th>
                            <th className="py-1 px-2">Client</th>
                            <th className="py-1 px-2 text-right">Price</th>
                            <th className="py-1 px-2 text-right">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {bb.recentDeals.slice(0, 5).map((d, idx) => (
                            <tr key={idx}>
                              <td className="py-1 px-2 text-slate-600">{d.date}</td>
                              <td className="py-1 px-2">{d.dealType}</td>
                              <td
                                className={`py-1 px-2 font-semibold ${
                                  d.buySell.toUpperCase().includes('BUY')
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {d.buySell}
                              </td>
                              <td className="py-1 px-2 font-sans text-slate-800 truncate max-w-[160px]" title={d.clientName}>
                                {d.clientName}
                              </td>
                              <td className="py-1 px-2 text-right">₹{d.tradePrice.toFixed(2)}</td>
                              <td className="py-1 px-2 text-right">₹{d.valueCr.toFixed(2)} Cr</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Support & Resistance + Daily/Weekly/Monthly Bullish Sentiment + Periodic Score Definition */}
          {data.periodicAnalysis && (() => {
            const pa = data.periodicAnalysis;
            const sr = pa.supportResistance;
            const sent = pa.sentiment;
            const ps = pa.periodicScore;

            const srBadgeTone =
              sr.positionStatus === 'NEAR_SUPPORT' || sr.positionStatus === 'BREAKOUT_ABOVE_R1'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : sr.positionStatus === 'NEAR_RESISTANCE' || sr.positionStatus === 'BELOW_SUPPORT'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : sr.positionStatus === 'MID_RANGE'
                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';

            const psGradeTone =
              ps.grade === 'STRONG_BULLISH'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : ps.grade === 'BULLISH'
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : ps.grade === 'NEUTRAL'
                    ? 'bg-slate-100 text-slate-800 border-slate-200'
                    : ps.grade === 'WEAK'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200';

            const tfTone = (status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'DATA NOT AVAILABLE') =>
              status === 'BULLISH'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : status === 'BEARISH'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : status === 'NEUTRAL'
                    ? 'bg-slate-100 text-slate-700 border-slate-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';

            const tfBarColor = (status: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'DATA NOT AVAILABLE') =>
              status === 'BULLISH'
                ? 'bg-emerald-500'
                : status === 'BEARISH'
                  ? 'bg-rose-500'
                  : 'bg-slate-400';

            const range52Pct =
              sr.low52W !== null && sr.high52W !== null && sr.high52W > sr.low52W
                ? Math.max(
                    0,
                    Math.min(100, Math.round(((data.closePrice - sr.low52W) / (sr.high52W - sr.low52W)) * 100))
                  )
                : null;

            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Support & Resistance Card */}
                  <div className="border border-slate-200 rounded-md p-4 bg-slate-50/40 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <Compass className="w-4 h-4 text-blue-700" />
                        <span>Support &amp; Resistance Levels (OHLCV Pivots)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {sr.riskRewardToR1 !== null && (
                          <span className="px-2 py-0.5 font-mono text-[10px] font-semibold rounded border bg-white text-slate-700 border-slate-200">
                            R:R to R1 = {sr.riskRewardToR1}x
                          </span>
                        )}
                        <span className={`px-2 py-0.5 font-mono text-[11px] font-bold rounded border ${srBadgeTone}`}>
                          {sr.positionStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                      <div className="bg-emerald-50/50 border border-emerald-200 rounded p-2">
                        <div className="text-[10px] text-emerald-800 font-sans font-semibold">S2 · Major Support</div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">
                          {sr.secondarySupport !== null ? `₹${sr.secondarySupport.toFixed(2)}` : 'N/A'}
                        </div>
                        <div className="text-[10px] text-slate-600 truncate" title={sr.secondarySupportLabel}>
                          {sr.secondarySupportLabel}
                        </div>
                      </div>
                      <div className="bg-emerald-50/80 border border-emerald-300 rounded p-2">
                        <div className="text-[10px] text-emerald-800 font-sans font-semibold">S1 · Nearest Support</div>
                        <div className="text-sm font-bold text-emerald-800 mt-0.5">
                          {sr.nearestSupport !== null ? `₹${sr.nearestSupport.toFixed(2)}` : 'N/A'}
                        </div>
                        <div className="text-[10px] text-emerald-700">
                          {sr.supportDistPct !== null ? `-${sr.supportDistPct}% below LTP` : sr.nearestSupportLabel}
                        </div>
                      </div>
                      <div className="bg-rose-50/80 border border-rose-300 rounded p-2">
                        <div className="text-[10px] text-rose-800 font-sans font-semibold">R1 · Nearest Resist</div>
                        <div className="text-sm font-bold text-rose-800 mt-0.5">
                          {sr.nearestResistance !== null ? `₹${sr.nearestResistance.toFixed(2)}` : 'Breakout'}
                        </div>
                        <div className="text-[10px] text-rose-700">
                          {sr.resistanceDistPct !== null ? `+${sr.resistanceDistPct}% upside` : sr.nearestResistanceLabel}
                        </div>
                      </div>
                      <div className="bg-rose-50/50 border border-rose-200 rounded p-2">
                        <div className="text-[10px] text-rose-800 font-sans font-semibold">R2 · Major Resist</div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">
                          {sr.secondaryResistance !== null ? `₹${sr.secondaryResistance.toFixed(2)}` : 'N/A'}
                        </div>
                        <div className="text-[10px] text-slate-600 truncate" title={sr.secondaryResistanceLabel}>
                          {sr.secondaryResistanceLabel}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600 bg-white border border-slate-200 rounded px-2.5 py-1.5">
                      <span>
                        LTP: <strong className="text-slate-900">₹{data.closePrice.toFixed(2)}</strong>
                      </span>
                      <span>
                        Pivot: <strong>{sr.pivot !== null ? `₹${sr.pivot}` : 'N/A'}</strong> (S1{' '}
                        {sr.pivotS1 !== null ? `₹${sr.pivotS1}` : '—'} · R1{' '}
                        {sr.pivotR1 !== null ? `₹${sr.pivotR1}` : '—'})
                      </span>
                    </div>

                    {range52Pct !== null && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono text-slate-600">
                          <span>52W Low: ₹{sr.low52W?.toFixed(2)}</span>
                          <span className="font-semibold text-slate-800">52W Range Position: {range52Pct}%</span>
                          <span>52W High: ₹{sr.high52W?.toFixed(2)}</span>
                        </div>
                        <div className="h-2 w-full bg-slate-200 rounded-full relative overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${range52Pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Daily / Weekly / Monthly Bullish Sentiment Card */}
                  <div className="border border-slate-200 rounded-md p-4 bg-slate-50/40 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <BarChart3 className="w-4 h-4 text-blue-700" />
                        <span>Daily · Weekly · Monthly Bullish Sentiment</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 font-mono text-[11px] font-bold rounded border ${
                          sent.bullishTimeframesCount === sent.availableTimeframesCount &&
                          sent.availableTimeframesCount > 0
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : sent.bullishTimeframesCount >= 2
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {sent.mtfAlignment}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[sent.daily, sent.weekly, sent.monthly].map((tf) => (
                        <div key={tf.timeframe} className="bg-white border border-slate-200 rounded p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-[11px] font-bold text-slate-900">
                              {tf.timeframe}
                            </span>
                            <span className={`px-1.5 py-0.5 font-mono text-[10px] font-bold rounded border ${tfTone(tf.status)}`}>
                              {tf.status}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between font-mono">
                            <span className="text-base font-bold text-slate-900">
                              {tf.score !== null ? `${tf.score}/100` : 'N/A'}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {tf.candlesCount} {tf.timeframe === 'DAILY' ? 'D' : tf.timeframe === 'WEEKLY' ? 'W' : 'M'}
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${tfBarColor(tf.status)}`}
                              style={{ width: `${tf.score ?? 0}%` }}
                            />
                          </div>
                          <div className="text-[10px] font-mono text-slate-600 space-y-0.5">
                            <div>
                              {tf.returnLabel}:{' '}
                              <strong
                                className={
                                  (tf.returnPct ?? 0) > 0
                                    ? 'text-emerald-700'
                                    : (tf.returnPct ?? 0) < 0
                                      ? 'text-rose-700'
                                      : 'text-slate-700'
                                }
                              >
                                {tf.returnPct !== null ? `${tf.returnPct >= 0 ? '+' : ''}${tf.returnPct}%` : 'N/A'}
                              </strong>
                            </div>
                            <div>
                              {tf.emaShortLabel}: {tf.emaShort !== null ? `₹${tf.emaShort}` : '—'}
                              {tf.aboveEmaShort !== null && (
                                <span className={tf.aboveEmaShort ? ' text-emerald-700' : ' text-rose-700'}>
                                  {tf.aboveEmaShort ? ' ▲' : ' ▼'}
                                </span>
                              )}
                            </div>
                            <div>
                              {tf.emaLongLabel}: {tf.emaLong !== null ? `₹${tf.emaLong}` : '—'} · RSI:{' '}
                              {tf.rsi ?? '—'}
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-500 leading-snug border-t border-slate-100 pt-1">
                            {tf.reasons.slice(0, 2).join(' · ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Periodic Score Definition, Formula & Breakdown */}
                <div className="border border-slate-200 rounded-md p-4 bg-white space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-700" />
                        <span className="font-semibold text-slate-900">
                          Periodic Score Definition &amp; Multi-Timeframe Breakdown
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-blue-800 mt-0.5">
                        {ps.formulaText}
                      </div>
                    </div>
                    <div className={`px-3 py-1 font-mono text-xs font-bold rounded border ${psGradeTone}`}>
                      Periodic Score: {ps.score !== null ? `${ps.score}/100` : 'DATA NOT AVAILABLE'} ·{' '}
                      {ps.grade.replace(/_/g, ' ')}
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-700 space-y-1">
                    <div>
                      <strong className="text-slate-900">What is Periodic Score?</strong> {ps.definitionSummary}
                    </div>
                    <div className="font-mono text-[10px] text-slate-600">
                      Thresholds: {ps.thresholdGuide}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                    {ps.breakdown.map((b) => (
                      <div key={b.label} className="border border-slate-200 rounded p-2.5 bg-slate-50/50 space-y-1">
                        <div className="flex items-center justify-between gap-1 text-[11px]">
                          <span className="font-semibold text-slate-800 leading-tight">{b.label}</span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 shrink-0">
                            {b.weightPct}% wt
                          </span>
                        </div>
                        <div className="font-mono text-sm font-bold text-slate-900">
                          {b.rawScore !== null ? `${b.rawScore}/100` : 'N/A'}
                          <span className="text-[11px] font-normal text-blue-700 ml-1.5">
                            ({b.weightedPoints !== null ? `+${b.weightedPoints} pts` : '0 pts'})
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 truncate" title={b.detail}>
                          {b.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Top Warning Banner (Phase 8 & Phase 1) */}
          {(data.phase8TopWarnings.warnings.length > 0 || data.phase1Regime.verdict !== 'PROCEED') && (
            <div className="p-3.5 rounded-md border border-amber-200 bg-amber-50/70 space-y-1">
              <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-700" />
                Regime &amp; Top-Zone Alerts (Phase 1 &amp; Phase 8)
              </div>
              <div className="text-amber-800 font-mono text-[11px]">
                Phase 1 Market Regime: <strong>{data.phase1Regime.verdict}</strong> —{' '}
                {data.phase1Regime.reasons.join(' | ')}
              </div>
              {data.phase8TopWarnings.warnings.map((w, idx) => (
                <div key={idx} className="text-rose-800 font-mono text-[11px]">
                  • {w}
                </div>
              ))}
            </div>
          )}

          {/* Phase 2 + Phase 4 + Phase 7 Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-slate-200 rounded-md p-3.5 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Phase 2 · Sector, RSS News &amp; Macro
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Sector 1M vs Nifty 1M</span>
                <span className="font-mono font-semibold text-slate-900">
                  {data.phase2SectorMacroNews.sector1mReturnPct !== null
                    ? `${data.phase2SectorMacroNews.sector1mReturnPct >= 0 ? '+' : ''}${data.phase2SectorMacroNews.sector1mReturnPct}%`
                    : 'DATA NOT AVAILABLE'}{' '}
                  /{' '}
                  {data.phase2SectorMacroNews.nifty1mReturnPct !== null
                    ? `${data.phase2SectorMacroNews.nifty1mReturnPct >= 0 ? '+' : ''}${data.phase2SectorMacroNews.nifty1mReturnPct}%`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">RSS News Bias</span>
                <span
                  className={`font-mono font-semibold ${
                    data.phase2SectorMacroNews.newsBias === 'BOOST'
                      ? 'text-emerald-700'
                      : data.phase2SectorMacroNews.newsBias === 'AVOID'
                        ? 'text-rose-700'
                        : 'text-slate-700'
                  }`}
                >
                  {data.phase2SectorMacroNews.newsBias}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">DXY / Brent Flag</span>
                <span className="font-mono text-slate-800">
                  {data.phase2SectorMacroNews.dxySectorFlag} · {data.phase2SectorMacroNews.brentFlag}
                </span>
              </div>
            </div>

            <div className="border border-slate-200 rounded-md p-3.5 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Phase 4 · Movement Potential (252D)
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Up / Down / Net Burst %</span>
                <span
                  className={`font-mono font-semibold ${
                    data.phase4Movement.burstPass === true
                      ? 'text-emerald-700'
                      : data.phase4Movement.burstPass === false
                        ? 'text-rose-700'
                        : 'text-amber-700'
                  }`}
                >
                  {data.phase4Movement.burstPowerNormalized !== null
                    ? `Up ${data.phase4Movement.burstPowerNormalized.toFixed(1)}% / Dn ${
                        data.phase4Movement.downwardBurstNormalized?.toFixed(1) ?? '0.0'
                      }% (Net ${
                        data.phase4Movement.netBurstNormalized !== null &&
                        data.phase4Movement.netBurstNormalized >= 0
                          ? '+'
                          : ''
                      }${data.phase4Movement.netBurstNormalized?.toFixed(1) ?? '0.0'}%)`
                    : 'DATA NOT AVAILABLE'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Up vs Down Days (252D)</span>
                <span className="font-mono text-slate-800">
                  ▲ {data.phase4Movement.days5To10Pct}/{data.phase4Movement.days10To19Pct}/{data.phase4Movement.days19PlusPct} · ▼{' '}
                  {data.phase4Movement.downDays5To10Pct}/{data.phase4Movement.downDays10To19Pct}/{data.phase4Movement.downDays19PlusPct}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">52W High Dist / Univ RS</span>
                <span className="font-mono text-slate-800">
                  {data.phase4Movement.distFrom52wHighPct !== null
                    ? `-${data.phase4Movement.distFrom52wHighPct}%`
                    : 'N/A'}{' '}
                  · RS{' '}
                  {data.phase4Movement.relativeStrengthPctRank !== null
                    ? `${data.phase4Movement.relativeStrengthPctRank}%ile`
                    : 'N/A'}
                </span>
              </div>
            </div>

            <div className="border border-slate-200 rounded-md p-3.5 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Phase 7 · Paper Trade Risk Plan
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Entry / Stop ({data.phase7Risk.stopPct}%)</span>
                <span className="font-mono font-semibold text-slate-900">
                  ₹{data.phase7Risk.entryPrice.toFixed(2)} / ₹{data.phase7Risk.stopLoss.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Targets (15% / 25%)</span>
                <span className="font-mono text-emerald-700 font-semibold">
                  ₹{data.phase7Risk.target15Pct.toFixed(2)} – ₹{data.phase7Risk.target25Pct.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Size / +20% Trail BE</span>
                <span className="font-mono text-slate-800">
                  {data.phase7Risk.suggestedPositionSizePct}% cap · BE @ ₹{data.phase7Risk.trailingBreakevenTriggerPrice.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Phase 3: Hard Reject Filters + Valuation Zones */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="font-semibold text-slate-900">
                  Phase 3 · 7 Hard Reject Filters ({data.phase3Fundamentals.hardRejectPassCount}/7 Pass ·{' '}
                  {data.phase3Fundamentals.hardRejectFailCount} Fail)
                </div>
                <span
                  className={`font-mono font-bold ${
                    data.phase3Fundamentals.hardRejectPass ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {data.phase3Fundamentals.hardRejectPass ? 'APPROVED' : 'HARD REJECT'}
                </span>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                    <th className="py-1.5 px-3">Filter</th>
                    <th className="py-1.5 px-2 text-right">Value</th>
                    <th className="py-1.5 px-2 text-right">Rule</th>
                    <th className="py-1.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.phase3Fundamentals.gates.map((g) => (
                    <tr key={g.label}>
                      <td className="py-1.5 px-3 text-slate-800">{g.label}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-900">
                        {g.valueText}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-500">
                        {g.threshold}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <GateBadge status={g.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-600">
                  9-Point Piotroski F-Score:{' '}
                  {data.phase3Fundamentals.piotroskiScore !== null
                    ? `${data.phase3Fundamentals.piotroskiScore}/${data.phase3Fundamentals.piotroskiAvailable} available`
                    : 'DATA NOT AVAILABLE'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowPiotroski((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline"
                >
                  {showPiotroski ? 'Hide 9 Checks' : 'View 9 Checks'}
                  {showPiotroski ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
              {showPiotroski && (
                <div className="p-3 bg-slate-50/50 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {data.phase3Fundamentals.piotroskiChecks.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center justify-between bg-white border border-slate-200 rounded px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="text-slate-700 truncate pr-2">{c.label}</span>
                      <span
                        className={`font-mono shrink-0 ${
                          c.status === 'PASS'
                            ? 'text-emerald-700 font-semibold'
                            : c.status === 'FAIL'
                              ? 'text-rose-700 font-semibold'
                              : 'text-amber-700'
                        }`}
                      >
                        {c.detail}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Valuation + Phase 5 Accumulation + Phase 6 Fast Entry */}
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-md p-3.5 space-y-2">
                <div className="font-semibold text-slate-900">
                  Phase 3B &amp; 3C · Bottom Value / Top Valuation Zone
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="bg-slate-50 border border-slate-100 rounded p-2">
                    <div className="text-slate-500">Graham Number</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {data.phase3Fundamentals.valuation.grahamNumber !== null
                        ? `₹${data.phase3Fundamentals.valuation.grahamNumber.toFixed(2)}`
                        : 'DATA NOT AVAILABLE'}
                    </div>
                    <div className="font-mono text-slate-600 mt-0.5">
                      {data.phase3Fundamentals.valuation.grahamRatio !== null
                        ? `${data.phase3Fundamentals.valuation.grahamRatio}x · ${data.phase3Fundamentals.valuation.grahamZone}`
                        : 'Need EPS>0 & BVPS>0'}
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded p-2">
                    <div className="text-slate-500">5Y DCF (11% Disc)</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {data.phase3Fundamentals.valuation.dcfIntrinsicPerShare !== null
                        ? `₹${data.phase3Fundamentals.valuation.dcfIntrinsicPerShare.toFixed(2)}`
                        : 'DATA NOT AVAILABLE'}
                    </div>
                    <div className="font-mono text-slate-600 mt-0.5">
                      {data.phase3Fundamentals.valuation.dcfZone}
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded p-2">
                    <div className="text-slate-500">EV / EBITDA</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {data.phase3Fundamentals.valuation.evToEbitda !== null
                        ? `${data.phase3Fundamentals.valuation.evToEbitda.toFixed(1)}x`
                        : 'DATA NOT AVAILABLE'}
                    </div>
                    <div
                      className={`font-mono mt-0.5 ${
                        data.phase3Fundamentals.valuation.evToEbitda5YrAvg !== null
                          ? 'text-slate-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {data.phase3Fundamentals.valuation.evToEbitda5YrAvg !== null
                        ? `${data.phase3Fundamentals.valuation.evToEbitdaHistLabel || 'Hist Avg'}: ${data.phase3Fundamentals.valuation.evToEbitda5YrAvg.toFixed(1)}x`
                        : 'Hist Avg: DATA NOT AVAILABLE'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3.5 space-y-2">
                <div className="font-semibold text-slate-900">
                  Phase 5 · Accumulation (Wyckoff, VCP, Delivery &amp; Institutional)
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Wyckoff Spring / SOS</span>
                    <span className="font-mono text-slate-900">
                      {data.phase5Accumulation.wyckoffSpring === null
                        ? 'DATA NOT AVAILABLE'
                        : `${data.phase5Accumulation.wyckoffSpring ? 'SPRING YES' : 'No'} · ${data.phase5Accumulation.wyckoffSos ? 'SOS YES' : 'No'}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Selling Climax / Test</span>
                    <span className="font-mono text-slate-900">
                      {data.phase5Accumulation.wyckoffSellingClimax ? 'SC YES' : 'No'} ·{' '}
                      {data.phase5Accumulation.wyckoffSecondaryTest ? 'ST YES' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">VCP Pattern</span>
                    <span className="font-mono text-slate-900 truncate max-w-[160px]" title={data.phase5Accumulation.vcpDetail}>
                      {data.phase5Accumulation.vcpDetected ? 'VCP YES' : data.phase5Accumulation.vcpDetail}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Deliv 5D / Above VWAP</span>
                    <span className="font-mono text-slate-900">
                      {data.phase5Accumulation.delivery5dAvgPct !== null
                        ? `${data.phase5Accumulation.delivery5dAvgPct.toFixed(1)}%`
                        : 'N/A'}{' '}
                      · {data.phase5Accumulation.aboveVwap === null ? 'N/A' : data.phase5Accumulation.aboveVwap ? 'Above VWAP' : 'Below VWAP'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">30D Bulk/Block Confirmation</span>
                    <span className="font-mono text-slate-900">
                      {data.phase5Accumulation.bulkBlockConfirmation.confirmationStatus} ({data.phase5Accumulation.bulkBlockConfirmation.totalDeals30d} deals)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Prom / FII / DII (Total)</span>
                    <span className="font-mono text-slate-900">
                      {data.phase5Accumulation.promoterHoldingPct !== null
                        ? `${data.phase5Accumulation.promoterHoldingPct}%`
                        : '—'}
                      /{data.phase5Accumulation.fiiHoldingPct !== null ? `${data.phase5Accumulation.fiiHoldingPct}%` : '—'}
                      /{data.phase5Accumulation.diiHoldingPct !== null ? `${data.phase5Accumulation.diiHoldingPct}%` : '—'}{' '}
                      ({data.phase5Accumulation.smartMoneyTotalPct !== null ? `${data.phase5Accumulation.smartMoneyTotalPct}%` : 'N/A'})
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 col-span-2 pt-1 border-t border-slate-100">
                    <span className="text-slate-500">FII/DII 2-3Q Trend &amp; Pledge %</span>
                    <span
                      className={`font-mono ${
                        data.phase5Accumulation.fiiDiiMultiQuarterTrend === 'INCREASING'
                          ? 'text-emerald-700 font-semibold'
                          : data.phase5Accumulation.fiiDiiMultiQuarterTrend === 'DECREASING'
                            ? 'text-rose-700 font-semibold'
                            : data.phase5Accumulation.fiiDiiMultiQuarterTrend === 'FLAT / MIXED'
                              ? 'text-slate-800'
                              : 'text-amber-700'
                      }`}
                    >
                      {data.phase5Accumulation.fiiDiiMultiQuarterTrend}
                      {data.phase5Accumulation.fiiDiiTrendDetail &&
                      data.phase5Accumulation.fiiDiiMultiQuarterTrend !== 'DATA NOT AVAILABLE'
                        ? ` (${data.phase5Accumulation.fiiDiiTrendDetail})`
                        : ''}{' '}
                      · Pledge: DATA NOT AVAILABLE
                    </span>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    Phase 6 · Fast Entry Triggers (Earlier than EMA 44)
                  </span>
                  <span className="font-mono text-[11px] text-slate-600">
                    Trend 20&gt;50&gt;200:{' '}
                    <strong className={data.phase6EntryTriggers.trendAligned20_50_200 ? 'text-emerald-700' : 'text-slate-700'}>
                      {data.phase6EntryTriggers.trendAligned20_50_200 === null
                        ? 'N/A'
                        : data.phase6EntryTriggers.trendAligned20_50_200
                          ? 'ALIGNED'
                          : 'NO'}
                    </strong>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-700">
                  <div>
                    EMA9: {data.phase6EntryTriggers.ema9 ?? '—'} · EMA21: {data.phase6EntryTriggers.ema21 ?? '—'} · EMA44:{' '}
                    {data.phase6EntryTriggers.ema44 ?? '—'} · EMA200: {data.phase6EntryTriggers.ema200 ?? '—'} · RSI(14):{' '}
                    {data.phase6EntryTriggers.rsi14 ?? '—'}
                  </div>
                  {data.phase6EntryTriggers.ema21AboveEma44 !== undefined &&
                    data.phase6EntryTriggers.ema21AboveEma44 !== null && (
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                          data.phase6EntryTriggers.ema21Cross44Bullish
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : data.phase6EntryTriggers.ema21AboveEma44
                              ? 'bg-emerald-50/70 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {data.phase6EntryTriggers.ema21Cross44Bullish
                          ? `21×44 Bullish Cross (${data.phase6EntryTriggers.ema21Cross44DaysAgo ?? 0}d ago)`
                          : data.phase6EntryTriggers.ema21AboveEma44
                            ? 'EMA 21 > EMA 44 Bullish'
                            : 'EMA 21 < EMA 44'}
                      </span>
                    )}
                </div>
                {data.phase6EntryTriggers.fastSignalsTriggered.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.phase6EntryTriggers.fastSignalsTriggered.map((sig) => (
                      <span
                        key={sig}
                        className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[11px] font-semibold"
                      >
                        {sig}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    No fast entry signal fired on latest close.
                  </div>
                )}
                {data.phase6EntryTriggers.gapUpSkip && (
                  <div className="text-[11px] font-mono text-rose-700 font-semibold">
                    GAP-UP SKIP ACTIVE: Opened +{data.phase6EntryTriggers.gapUpPct}% (&gt;=3% chase guard)
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 11 Score Breakdown Toggle */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setShowScoreBreakdown((v) => !v)}
              className="w-full px-4 py-2.5 bg-slate-50 flex items-center justify-between text-left hover:bg-slate-100 transition-colors"
            >
              <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-700" />
                Section 11 Scoring Breakdown ({data.scoring.totalScore}/100 · Base {data.scoring.baseScore})
              </span>
              {showScoreBreakdown ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>
            {showScoreBreakdown && (
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 bg-white border-t border-slate-200">
                {data.scoring.breakdown.map((b, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded border text-[11px] ${
                      b.active
                        ? b.points >= 0
                          ? 'bg-emerald-50/60 border-emerald-200'
                          : 'bg-rose-50/60 border-rose-200'
                        : 'bg-slate-50 border-slate-100 text-slate-500'
                    }`}
                  >
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-800">{b.label}</span>
                      <span className="font-mono">
                        {b.active ? (b.points >= 0 ? `+${b.points}` : b.points) : '0'}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate" title={b.note}>
                      {b.note}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
