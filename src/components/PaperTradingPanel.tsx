import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Download,
  History,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { PaperPortfolioSummary, PaperTradeMarked } from '../types/trading';
import {
  buildFallbackPortfolioFromVault,
  executePaperBuy,
  executePaperDelete,
  executePaperSell,
  syncAndLoadPaperPortfolio,
} from '../utils/paperTradeClient';

interface PaperTradingPanelProps {
  symbol?: string;
  currentClose?: number;
  livePrice?: number | null;
  suggestedStopLoss?: number | null;
  defaultStrategyTag?: string;
  onSelectSymbol?: (symbol: string) => void;
  externalSeq?: number;
  onPortfolioChanged?: () => void;
}

export const PaperTradingPanel: React.FC<PaperTradingPanelProps> = ({
  symbol,
  currentClose,
  livePrice,
  suggestedStopLoss,
  defaultStrategyTag = 'v3 Bot',
  onSelectSymbol,
  externalSeq = 0,
  onPortfolioChanged,
}) => {
  const [portfolio, setPortfolio] = useState<PaperPortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Quick Paper BUY form state (when inside StockDetailView or custom symbol)
  const [buyOpen, setBuyOpen] = useState(false);
  const [buySymbol, setBuySymbol] = useState(symbol || '');
  const [buyQty, setBuyQty] = useState<string>('');
  const [buyPrice, setBuyPrice] = useState<string>('');
  const [buyStop, setBuyStop] = useState<string>('');
  const [buyTarget, setBuyTarget] = useState<string>('');
  const [buyStrategy, setBuyStrategy] = useState(defaultStrategyTag);
  const [buyNotes, setBuyNotes] = useState('');

  // Optional custom exit price modal/inline input
  const [sellingTrade, setSellingTrade] = useState<PaperTradeMarked | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState('');
  const [exitNotesInput, setExitNotesInput] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [journalScope, setJournalScope] = useState<'ALL' | 'SYMBOL'>('ALL');
  const [historyStrategyFilter, setHistoryStrategyFilter] = useState<string>('ALL');

  const effectiveRefPrice = livePrice ?? currentClose ?? 0;

  useEffect(() => {
    if (symbol) setBuySymbol(symbol);
    setBuyStrategy(defaultStrategyTag || 'v3 Bot');
    if (effectiveRefPrice > 0) {
      setBuyPrice(effectiveRefPrice.toFixed(2));
      setBuyQty(String(Math.max(1, Math.floor(25000 / effectiveRefPrice))));
      const sl = suggestedStopLoss ?? Number((effectiveRefPrice * 0.92).toFixed(2));
      setBuyStop(sl.toFixed(2));
      setBuyTarget((effectiveRefPrice * 1.15).toFixed(2));
    }
  }, [symbol, effectiveRefPrice, suggestedStopLoss, defaultStrategyTag]);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Sync client localStorage vault <-> server JSON so yesterday's OPEN picks never disappear across restarts
      const { portfolio: synced, restoredCount } = await syncAndLoadPaperPortfolio({ live: true });
      setPortfolio(synced);
      if (restoredCount > 0) {
        setNotice(
          `Restored ${restoredCount} saved paper portfolio position${restoredCount === 1 ? '' : 's'} from browser backup.`
        );
      }
    } catch (err) {
      const fallback = buildFallbackPortfolioFromVault();
      if (fallback.trades.length > 0) {
        setPortfolio(fallback);
      }
      setError((err as Error).message || 'Failed to sync paper trading portfolio');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio, externalSeq]);

  const handlePaperBuySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSym = (buySymbol || symbol || '').trim().toUpperCase();
    if (!targetSym) return;
    setBusyId('NEW_BUY');
    setError(null);
    setNotice(null);
    try {
      const json = await executePaperBuy({
        symbol: targetSym,
        quantity: buyQty ? Number(buyQty) : undefined,
        entryPrice: buyPrice ? Number(buyPrice) : undefined,
        stopLoss: buyStop ? Number(buyStop) : undefined,
        targetPrice: buyTarget ? Number(buyTarget) : undefined,
        strategyTag: buyStrategy,
        notes: buyNotes,
        preferLive: true,
      });
      setPortfolio(json.portfolio);
      setNotice(
        `Paper BUY locked in portfolio: ${json.trade.symbol} x ${json.trade.quantity} @ ₹${json.trade.entryPrice.toFixed(2)} (${json.trade.entryPriceSource})`
      );
      setBuyOpen(false);
      setBuyNotes('');
      onPortfolioChanged?.();
    } catch (err) {
      setError((err as Error).message || 'Paper BUY failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickSell = async (trade: PaperTradeMarked, customPrice?: number, notes?: string) => {
    setBusyId(trade.id);
    setError(null);
    setNotice(null);
    try {
      const json = await executePaperSell(trade.id, {
        exitPrice: customPrice && customPrice > 0 ? customPrice : undefined,
        notes: notes || undefined,
      });
      const closed = json.trade;
      setPortfolio(json.portfolio);
      setNotice(
        `Paper SELL closed: ${closed.symbol} @ ₹${closed.exitPrice?.toFixed(2)} · Realized P&L ${
          (closed.realizedPnlInr ?? 0) >= 0 ? '+' : ''
        }₹${closed.realizedPnlInr?.toFixed(2)} (${closed.realizedPnlPct?.toFixed(2)}%)`
      );
      setSellingTrade(null);
      setExitPriceInput('');
      setExitNotesInput('');
      onPortfolioChanged?.();
    } catch (err) {
      setError((err as Error).message || 'Paper SELL failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const updatedPortfolio = await executePaperDelete(id);
      setConfirmDeleteId(null);
      setPortfolio(updatedPortfolio);
      onPortfolioChanged?.();
    } catch (err) {
      setError((err as Error).message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const allTrades = portfolio?.trades || [];
  const activeSymbolCount = symbol
    ? allTrades.filter((t) => t.symbol === symbol.toUpperCase()).length
    : allTrades.length;
  const visibleTrades =
    symbol && journalScope === 'SYMBOL'
      ? allTrades.filter((t) => t.symbol === symbol.toUpperCase())
      : allTrades;

  const stats = portfolio?.stats;
  const openTrades = visibleTrades.filter((t) => t.status === 'OPEN');
  const closedTrades = visibleTrades.filter((t) => t.status === 'CLOSED');

  const todayIst = new Date(Date.now() + 19800 * 1000).toISOString().slice(0, 10);
  const todayUtc = new Date().toISOString().slice(0, 10);

  const isClosedToday = useCallback(
    (t: PaperTradeMarked): boolean => {
      if (t.closedAtUtc) {
        const ms = Date.parse(t.closedAtUtc);
        if (Number.isFinite(ms)) {
          const closedIst = new Date(ms + 19800 * 1000).toISOString().slice(0, 10);
          return closedIst === todayIst;
        }
      }
      return t.exitDate === todayIst || t.exitDate === todayUtc;
    },
    [todayIst, todayUtc]
  );

  const calcHoldDays = (entryDate: string, exitDate: string | null): string => {
    if (!entryDate || !exitDate) return '—';
    const eMs = Date.parse(`${entryDate}T00:00:00Z`);
    const xMs = Date.parse(`${exitDate}T00:00:00Z`);
    if (!Number.isFinite(eMs) || !Number.isFinite(xMs)) return '—';
    const days = Math.max(0, Math.round((xMs - eMs) / (24 * 60 * 60 * 1000)));
    return days === 0 ? 'Intraday' : `${days}d`;
  };

  const todaysClosedTrades = useMemo(
    () => closedTrades.filter((t) => isClosedToday(t)),
    [closedTrades, isClosedToday]
  );

  const allHistoricalClosedTrades = useMemo(
    () =>
      closedTrades
        .filter((t) => !isClosedToday(t))
        .sort((a, b) =>
          (b.exitDate || b.closedAtUtc || '').localeCompare(a.exitDate || a.closedAtUtc || '')
        ),
    [closedTrades, isClosedToday]
  );

  const historyStrategies = useMemo(
    () =>
      Array.from(
        new Set(allHistoricalClosedTrades.map((t) => t.strategyTag || 'Manual'))
      ).sort(),
    [allHistoricalClosedTrades]
  );

  const filteredHistoricalTrades = useMemo(
    () =>
      historyStrategyFilter === 'ALL'
        ? allHistoricalClosedTrades
        : allHistoricalClosedTrades.filter(
            (t) => (t.strategyTag || 'Manual') === historyStrategyFilter
          ),
    [allHistoricalClosedTrades, historyStrategyFilter]
  );

  const summarizeBucket = (list: PaperTradeMarked[]) => {
    const wins = list.filter((t) => (t.realizedPnlInr ?? 0) > 0).length;
    const losses = list.filter((t) => (t.realizedPnlInr ?? 0) <= 0).length;
    const pnlInr = list.reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0);
    const pcts = list
      .map((t) => t.realizedPnlPct)
      .filter((v): v is number => v !== null);
    const avgPct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    const winRate = list.length > 0 ? (wins / list.length) * 100 : null;
    return { wins, losses, pnlInr, avgPct, winRate };
  };

  const todayBucketStats = useMemo(
    () => summarizeBucket(todaysClosedTrades),
    [todaysClosedTrades]
  );
  const historicalBucketStats = useMemo(
    () => summarizeBucket(filteredHistoricalTrades),
    [filteredHistoricalTrades]
  );

  const todaysPnlSummary = useMemo(() => {
    const realizedInr = Number(
      todaysClosedTrades.reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0).toFixed(2)
    );
    const unrealizedInr = Number(
      openTrades.reduce((acc, t) => acc + (t.unrealizedPnlInr ?? 0), 0).toFixed(2)
    );
    const totalInr = Number((realizedInr + unrealizedInr).toFixed(2));
    const activeCapitalInr =
      todaysClosedTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0) +
      openTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0);
    const roiPct =
      activeCapitalInr > 0
        ? Number(((totalInr / activeCapitalInr) * 100).toFixed(2))
        : null;
    const hasData = todaysClosedTrades.length > 0 || openTrades.length > 0;
    return {
      realizedInr,
      unrealizedInr,
      totalInr,
      roiPct,
      hasData,
    };
  }, [todaysClosedTrades, openTrades]);

  const handleExportJournalCsv = () => {
    if (visibleTrades.length === 0) return;
    const headers = [
      'Status',
      'PeriodBucket',
      'Symbol',
      'Sector',
      'Strategy',
      'Qty',
      'EntryDate',
      'EntryPriceINR',
      'EntrySource',
      'CurrentOrExitPriceINR',
      'PriceSource',
      'StopLossINR',
      'TargetINR',
      'UnrealizedPnlINR',
      'UnrealizedPnlPct',
      'ExitDate',
      'RealizedPnlINR',
      'RealizedPnlPct',
      'RMultiple',
      'Notes',
    ];
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(','),
      ...visibleTrades.map((t) => {
        const periodBucket =
          t.status === 'OPEN'
            ? 'OPEN_POSITION'
            : isClosedToday(t)
              ? 'TODAY_CLOSED'
              : 'HISTORICAL_CLOSED';
        return [
          t.status,
          periodBucket,
          t.symbol,
          t.sector,
          t.strategyTag,
          t.quantity,
          t.entryDate,
          t.entryPrice.toFixed(2),
          t.entryPriceSource,
          t.status === 'CLOSED'
            ? t.exitPrice !== null
              ? t.exitPrice.toFixed(2)
              : ''
            : t.currentPrice !== null
              ? t.currentPrice.toFixed(2)
              : 'DATA NOT AVAILABLE',
          t.status === 'CLOSED' ? t.exitPriceSource || '' : t.currentPriceSource,
          t.stopLoss ?? '',
          t.targetPrice ?? '',
          t.unrealizedPnlInr ?? '',
          t.unrealizedPnlPct ?? '',
          t.exitDate ?? '',
          t.realizedPnlInr ?? '',
          t.realizedPnlPct ?? '',
          t.rMultiple ?? '',
          t.notes,
        ]
          .map(esc)
          .join(',');
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper_trading_journal_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Paper Trading Portfolio, BUY/SELL Journal &amp; Strategy Profit Tracker
            </h3>
            {symbol && (
              <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={() => setJournalScope('ALL')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    journalScope === 'ALL'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Observation Stocks ({allTrades.length})
                </button>
                <button
                  type="button"
                  onClick={() => setJournalScope('SYMBOL')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    journalScope === 'SYMBOL'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Only {symbol} ({activeSymbolCount})
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            All selected stocks remain in your journal across symbol switches for full observation, 1-click SELL exit &amp; Strategy ROI tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJournalCsv}
            disabled={visibleTrades.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 disabled:opacity-50 rounded-md"
          >
            <Download className="w-3.5 h-3.5" />
            Export Journal CSV
          </button>
          <button
            type="button"
            onClick={() => void loadPortfolio()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Live Marks
          </button>
          <button
            type="button"
            onClick={() => setBuyOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
          >
            <Plus className="w-3.5 h-3.5" />
            {symbol ? `Paper BUY ${symbol}` : 'New Paper BUY'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs font-mono text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Quick Paper BUY Form */}
      {buyOpen && (
        <form
          onSubmit={handlePaperBuySubmit}
          className="p-4 bg-emerald-50/40 border-b border-emerald-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 text-xs items-end"
        >
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Symbol</label>
            <input
              type="text"
              required
              value={buySymbol}
              onChange={(e) => setBuySymbol(e.target.value.toUpperCase())}
              placeholder="BEL"
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-white font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Qty (₹25k default)
            </label>
            <input
              type="number"
              min={1}
              value={buyQty}
              onChange={(e) => setBuyQty(e.target.value)}
              placeholder="Auto"
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Entry ₹ (Live/EOD)
            </label>
            <input
              type="number"
              step="0.05"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              placeholder="Auto Live"
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Stop Loss ₹</label>
            <input
              type="number"
              step="0.05"
              value={buyStop}
              onChange={(e) => setBuyStop(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Target ₹</label>
            <input
              type="number"
              step="0.05"
              value={buyTarget}
              onChange={(e) => setBuyTarget(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Strategy</label>
            <select
              value={buyStrategy}
              onChange={(e) => setBuyStrategy(e.target.value)}
              className="w-full px-2 py-1.5 border border-slate-200 rounded bg-white"
            >
              <option value="v3 Bot">v3 Bot</option>
              <option value="U-Turn">U-Turn</option>
              <option value="Delivery A/B">Delivery A/B</option>
              <option value="Swing Tier 1">Swing Tier 1</option>
              <option value="Manual">Manual</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busyId === 'NEW_BUY'}
              className="flex-1 px-3 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded"
            >
              {busyId === 'NEW_BUY' ? 'Buying...' : 'Confirm BUY'}
            </button>
            <button
              type="button"
              onClick={() => setBuyOpen(false)}
              className="px-2.5 py-1.5 text-slate-600 bg-white border border-slate-200 rounded"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Strategy Performance Widget */}
      {stats && (
        <section
          aria-label="Strategy Performance"
          className="border-b border-slate-200 bg-slate-50/40 p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-700" />
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Strategy Performance
              </h4>
              <span className="px-2 py-0.5 text-[11px] font-mono bg-white border border-slate-200 rounded text-slate-600">
                {stats.totalTrades} Executed · {stats.closedCount} Closed · {stats.openCount} Open
              </span>
            </div>

            {(() => {
              const best = (portfolio?.byStrategy || [])
                .filter((s) => s.closedTrades > 0 && s.roiPct !== null)
                .sort((a, b) => (b.roiPct ?? -999) - (a.roiPct ?? -999))[0];
              if (!best) return null;
              return (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded text-[11px] font-mono text-slate-700">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Top Strategy:</span>
                  <span className="font-bold text-slate-900">{best.strategyTag}</span>
                  <span
                    className={
                      (best.roiPct ?? 0) >= 0
                        ? 'text-emerald-700 font-semibold'
                        : 'text-rose-700 font-semibold'
                    }
                  >
                    ({(best.roiPct ?? 0) >= 0 ? '+' : ''}
                    {best.roiPct}% ROI)
                  </span>
                </div>
              );
            })()}
          </div>

          {/* 5 Core Aggregated KPIs: Today's P&L, Historical Win Rate, Avg Profit %, Total Paper ROI %, Capital & Expectancy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div
              aria-label="Today's P&L"
              className={`bg-white border rounded-md p-3 ${
                !todaysPnlSummary.hasData
                  ? 'border-slate-200'
                  : todaysPnlSummary.totalInr >= 0
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : 'border-rose-200 bg-rose-50/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-600">Today&apos;s P&amp;L</span>
                <span className="px-1.5 py-0.5 font-mono text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded">
                  {todayIst}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span
                  className={`font-mono text-lg font-bold ${
                    !todaysPnlSummary.hasData
                      ? 'text-slate-900'
                      : todaysPnlSummary.totalInr >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }`}
                >
                  {todaysPnlSummary.hasData
                    ? `${todaysPnlSummary.totalInr >= 0 ? '+' : '-'}₹${Math.abs(
                        todaysPnlSummary.totalInr
                      ).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : '—'}
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    todaysPnlSummary.roiPct === null
                      ? 'text-slate-500'
                      : todaysPnlSummary.roiPct >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }`}
                >
                  {todaysPnlSummary.roiPct !== null
                    ? `${todaysPnlSummary.roiPct >= 0 ? '+' : ''}${todaysPnlSummary.roiPct}%`
                    : '—'}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-slate-600 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span>Realized ({todaysClosedTrades.length}):</span>
                  <strong
                    className={
                      todaysPnlSummary.realizedInr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }
                  >
                    {todaysPnlSummary.realizedInr >= 0 ? '+' : '-'}₹
                    {Math.abs(todaysPnlSummary.realizedInr).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span>Unrealized ({openTrades.length}):</span>
                  <strong
                    className={
                      todaysPnlSummary.unrealizedInr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }
                  >
                    {todaysPnlSummary.unrealizedInr >= 0 ? '+' : '-'}₹
                    {Math.abs(todaysPnlSummary.unrealizedInr).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Historical Win Rate</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg font-bold text-slate-900">
                  {stats.winRatePct !== null ? `${stats.winRatePct}%` : '—'}
                </span>
                <span className="font-mono text-[11px] text-slate-600">
                  {stats.wins}W / {stats.losses}L
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-sm overflow-hidden flex">
                {stats.closedCount > 0 ? (
                  <>
                    <div
                      className="h-full bg-emerald-600"
                      style={{ width: `${(stats.wins / stats.closedCount) * 100}%` }}
                    />
                    <div
                      className="h-full bg-rose-500"
                      style={{ width: `${(stats.losses / stats.closedCount) * 100}%` }}
                    />
                  </>
                ) : (
                  <div className="h-full w-0" />
                )}
              </div>
              <div className="mt-1.5 text-[11px] text-slate-500">
                {stats.closedCount > 0
                  ? `Across ${stats.closedCount} closed journal trade${stats.closedCount === 1 ? '' : 's'}`
                  : 'Close a trade to record win rate'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Average Profit % (Per Trade)</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span
                  className={`font-mono text-lg font-bold ${
                    stats.avgReturnPct === null
                      ? 'text-slate-900'
                      : stats.avgReturnPct >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }`}
                >
                  {stats.avgReturnPct !== null
                    ? `${stats.avgReturnPct >= 0 ? '+' : ''}${stats.avgReturnPct}%`
                    : '—'}
                </span>
                <span className="font-mono text-[11px] text-slate-600">
                  PF: {stats.profitFactor !== null ? stats.profitFactor : '—'}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-slate-600 flex items-center justify-between">
                <span>
                  Avg Win:{' '}
                  <strong className="text-emerald-700">
                    {stats.avgWinPct !== null ? `+${stats.avgWinPct}%` : '—'}
                  </strong>
                </span>
                <span>
                  Avg Loss:{' '}
                  <strong className="text-rose-700">
                    {stats.avgLossPct !== null ? `${stats.avgLossPct}%` : '—'}
                  </strong>
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Total Paper Trading ROI</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span
                  className={`font-mono text-lg font-bold ${
                    stats.totalRoiPct === null
                      ? 'text-slate-900'
                      : stats.totalRoiPct >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }`}
                >
                  {stats.totalRoiPct !== null
                    ? `${stats.totalRoiPct >= 0 ? '+' : ''}${stats.totalRoiPct}%`
                    : '—'}
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    stats.netPnlInr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {stats.netPnlInr >= 0 ? '+' : ''}₹{stats.netPnlInr.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-slate-600 flex items-center justify-between">
                <span>
                  Realized ROI:{' '}
                  <strong
                    className={
                      (stats.realizedRoiPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }
                  >
                    {stats.realizedRoiPct !== null
                      ? `${stats.realizedRoiPct >= 0 ? '+' : ''}${stats.realizedRoiPct}%`
                      : '—'}
                  </strong>
                </span>
                <span>Open MTM: {stats.totalUnrealizedPnlInr >= 0 ? '+' : ''}₹{stats.totalUnrealizedPnlInr.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] text-slate-500">Capital Deployed &amp; Expectancy</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg font-bold text-slate-900">
                  ₹{stats.totalInvestedCapitalInr.toLocaleString('en-IN')}
                </span>
                <span className="font-mono text-[11px] text-slate-600">
                  Avg R:{' '}
                  {stats.avgRMultiple !== null
                    ? `${stats.avgRMultiple >= 0 ? '+' : ''}${stats.avgRMultiple}R`
                    : '—'}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-slate-600 flex items-center justify-between">
                <span>Open: ₹{stats.openCapitalInr.toLocaleString('en-IN')}</span>
                <span>Realized: ₹{stats.totalRealizedPnlInr.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {/* Per-Strategy Performance Breakdown */}
          {portfolio && portfolio.byStrategy.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Strategy-by-Strategy Breakdown (Journal Aggregation)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                      <th className="py-2 px-3.5">Strategy</th>
                      <th className="py-2 px-3 text-right">Executed (C / O)</th>
                      <th className="py-2 px-3 text-right">Win Rate</th>
                      <th className="py-2 px-3 text-right">Avg Profit %</th>
                      <th className="py-2 px-3 text-right">ROI %</th>
                      <th className="py-2 px-3 text-right">Net P&amp;L ₹</th>
                      <th className="py-2 px-3.5 text-right">Profit Factor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {portfolio.byStrategy.map((s) => {
                      const roiPos = (s.roiPct ?? 0) >= 0;
                      const netPos = s.netPnlInr >= 0;
                      const avgPos = (s.avgReturnPct ?? 0) >= 0;
                      return (
                        <tr key={s.strategyTag} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3.5 font-sans font-semibold text-slate-900">
                            {s.strategyTag}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">
                            {s.totalTrades}{' '}
                            <span className="text-slate-400">
                              ({s.closedTrades}C / {s.openTrades}O)
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-slate-800">
                            {s.winRatePct !== null ? `${s.winRatePct}%` : '—'}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-semibold ${
                              s.avgReturnPct === null
                                ? 'text-slate-400'
                                : avgPos
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {s.avgReturnPct !== null
                              ? `${s.avgReturnPct >= 0 ? '+' : ''}${s.avgReturnPct}%`
                              : '—'}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-semibold ${
                              s.roiPct === null
                                ? 'text-slate-400'
                                : roiPos
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {s.roiPct !== null ? `${s.roiPct >= 0 ? '+' : ''}${s.roiPct}%` : '—'}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-semibold ${
                              netPos ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {netPos ? '+' : ''}₹{s.netPnlInr.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2 px-3.5 text-right text-slate-700">
                            {s.profitFactor !== null ? s.profitFactor : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-dashed border-slate-200 rounded-md px-4 py-3 text-xs text-slate-500">
              No executed paper trades in the journal yet. Execute a <strong>Paper BUY</strong> to begin aggregating historical win rate, average profit %, and paper trading ROI.
            </div>
          )}
        </section>
      )}

      {/* Sell / Exit Confirmation Strip */}
      {sellingTrade && (
        <div className="p-4 bg-amber-50/70 border-b border-amber-200 flex flex-wrap items-end gap-3 text-xs">
          <div>
            <div className="font-semibold text-amber-950">
              Exit {sellingTrade.symbol} ({sellingTrade.quantity} qty @ Entry ₹
              {sellingTrade.entryPrice.toFixed(2)})
            </div>
            <div className="text-[11px] text-amber-800">
              Leave Exit Price blank to auto-sell at latest Yahoo Live checking price (or EOD fallback).
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-slate-600 mb-0.5">Exit Price ₹ (optional)</label>
            <input
              type="number"
              step="0.05"
              value={exitPriceInput}
              onChange={(e) => setExitPriceInput(e.target.value)}
              placeholder={sellingTrade.currentPrice?.toFixed(2) || 'Auto Live'}
              className="w-28 px-2 py-1 border border-slate-300 rounded bg-white font-mono"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] text-slate-600 mb-0.5">Exit Reason</label>
            <input
              type="text"
              value={exitNotesInput}
              onChange={(e) => setExitNotesInput(e.target.value)}
              placeholder="Target hit / trailing stop / manual exit"
              className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyId === sellingTrade.id}
              onClick={() =>
                void handleQuickSell(
                  sellingTrade,
                  exitPriceInput ? Number(exitPriceInput) : undefined,
                  exitNotesInput
                )
              }
              className="px-3 py-1.5 font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded"
            >
              {busyId === sellingTrade.id ? 'Exiting...' : 'Confirm SELL'}
            </button>
            <button
              type="button"
              onClick={() => setSellingTrade(null)}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Open & Closed Trades Tables */}
      {loading && !portfolio ? (
        <div className="p-8 text-center text-xs text-slate-500">
          Loading paper trading journal &amp; live Yahoo checking marks...
        </div>
      ) : (openTrades.length === 0 && closedTrades.length === 0) ? (
        <div className="p-6 text-center text-xs text-slate-500">
          No paper trades recorded{symbol && journalScope === 'SYMBOL' ? ` for ${symbol}` : ''} yet. Click{' '}
          <strong>Paper BUY</strong> above or from any Stock Detail / Recommended Pick to start tracking real strategy P&amp;L.
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {openTrades.length > 0 && (
            <div>
              <div className="px-4 sm:px-5 py-2 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <span>Open Paper Positions ({openTrades.length})</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium normal-case text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                  <Lock className="w-3 h-3" />
                  Held permanently until you click SELL / EXIT (Server + Browser Backup)
                </span>
              </div>
              {/* Mobile Cards for Open Trades */}
              <div className="md:hidden divide-y divide-slate-100">
                {openTrades.map((t) => {
                  const pos = (t.unrealizedPnlInr ?? 0) >= 0;
                  const isCurrent = Boolean(symbol && t.symbol === symbol.toUpperCase());
                  return (
                    <div
                      key={`m-open-${t.id}`}
                      className={`p-3.5 space-y-2 ${isCurrent ? 'bg-blue-50/40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {onSelectSymbol ? (
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(t.symbol)}
                                className="font-mono text-sm font-bold text-blue-700 hover:underline"
                              >
                                {t.symbol}
                              </button>
                            ) : (
                              <span className="font-mono text-sm font-bold text-slate-900">
                                {t.symbol}
                              </span>
                            )}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                              {t.strategyTag}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {t.entryDate} · Qty {t.quantity}
                          </div>
                        </div>
                        <div
                          className={`text-right font-mono text-xs font-semibold ${
                            pos ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {t.unrealizedPnlInr !== null ? (
                            <>
                              <div>
                                {pos ? '+' : ''}₹{t.unrealizedPnlInr.toFixed(2)}
                              </div>
                              <div className="text-[11px]">
                                ({pos ? '+' : ''}
                                {t.unrealizedPnlPct?.toFixed(2)}%)
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 font-mono text-[11px] bg-slate-50 border border-slate-100 rounded p-2">
                        <div>
                          <span className="text-[10px] text-slate-400 font-sans block">Entry</span>₹
                          {t.entryPrice.toFixed(2)}
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-sans block">Check</span>
                          {t.currentPrice !== null ? `₹${t.currentPrice.toFixed(2)}` : 'N/A'}
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-sans block">SL / Tgt</span>
                          {t.stopLoss ? `₹${t.stopLoss}` : '—'} /{' '}
                          {t.targetPrice ? `₹${t.targetPrice}` : '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === t.id}
                          onClick={() => void handleQuickSell(t)}
                          className="flex-1 min-h-[38px] px-3 py-1.5 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded"
                        >
                          {busyId === t.id ? 'Selling...' : 'SELL / EXIT'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSellingTrade(t);
                            setExitPriceInput(t.currentPrice?.toFixed(2) || '');
                          }}
                          className="min-h-[38px] px-3 py-1.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
                        >
                          Custom
                        </button>
                        {confirmDeleteId === t.id ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === t.id}
                              onClick={() => void handleDelete(t.id)}
                              className="min-h-[38px] px-2.5 py-1.5 text-[11px] font-semibold text-white bg-rose-600 rounded"
                            >
                              Delete?
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[38px] px-2 py-1.5 text-[11px] text-slate-600 bg-white border border-slate-200 rounded"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(t.id)}
                            aria-label={`Delete ${t.symbol}`}
                            className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-rose-700 border border-slate-200 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                    <th className="py-2 px-4">Symbol / Strategy</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3 text-right">Entry ₹</th>
                    <th className="py-2 px-3 text-right">Current Check ₹</th>
                    <th className="py-2 px-3 text-right">SL / Target</th>
                    <th className="py-2 px-3 text-right">Unrealized P&amp;L</th>
                    <th className="py-2 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {openTrades.map((t) => {
                    const pos = (t.unrealizedPnlInr ?? 0) >= 0;
                    const isCurrent = Boolean(symbol && t.symbol === symbol.toUpperCase());
                    return (
                      <tr
                        key={t.id}
                        className={`hover:bg-slate-50/60 ${isCurrent ? 'bg-blue-50/40' : ''}`}
                      >
                        <td className="py-2.5 px-4 font-sans">
                          <div className="flex items-center gap-2">
                            {onSelectSymbol ? (
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(t.symbol)}
                                className="font-mono font-bold text-blue-700 hover:underline"
                              >
                                {t.symbol}
                              </button>
                            ) : (
                              <span className="font-mono font-bold text-slate-900">{t.symbol}</span>
                            )}
                            {isCurrent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono font-semibold">
                                Selected
                              </span>
                            )}
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                              {t.strategyTag}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {t.entryDate} · {t.entryPriceSource}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">{t.quantity}</td>
                        <td className="py-2.5 px-3 text-right">₹{t.entryPrice.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right">
                          {t.currentPrice !== null ? `₹${t.currentPrice.toFixed(2)}` : 'DATA NOT AVAILABLE'}
                          <div className="text-[10px] text-slate-400">{t.currentPriceSource}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-[11px] text-slate-600">
                          {t.stopLoss ? `₹${t.stopLoss}` : '—'} / {t.targetPrice ? `₹${t.targetPrice}` : '—'}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-semibold ${pos ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {t.unrealizedPnlInr !== null ? (
                            <span className="inline-flex items-center gap-0.5">
                              {pos ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                              {pos ? '+' : ''}₹{t.unrealizedPnlInr.toFixed(2)} ({pos ? '+' : ''}
                              {t.unrealizedPnlPct?.toFixed(2)}%)
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 font-sans">
                            <button
                              type="button"
                              disabled={busyId === t.id}
                              onClick={() => void handleQuickSell(t)}
                              title="Instant Paper SELL at Live Checking Price"
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded"
                            >
                              {busyId === t.id ? 'Selling...' : 'SELL / EXIT'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSellingTrade(t);
                                setExitPriceInput(t.currentPrice?.toFixed(2) || '');
                              }}
                              className="px-2 py-1 text-[11px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200"
                            >
                              Custom
                            </button>
                            {confirmDeleteId === t.id ? (
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busyId === t.id}
                                  onClick={() => void handleDelete(t.id)}
                                  className="px-1.5 py-0.5 text-[10px] font-semibold text-white bg-rose-600 rounded"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-1.5 py-0.5 text-[10px] text-slate-600 bg-slate-100 rounded"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(t.id)}
                                title="Delete"
                                className="p-1 text-slate-400 hover:text-rose-700"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Today's Closed Trades */}
          {todaysClosedTrades.length > 0 && (
            <div>
              <div className="px-4 sm:px-5 py-2.5 bg-blue-50/60 border-b border-blue-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-blue-700" />
                  <span className="font-semibold uppercase tracking-wide text-blue-900">
                    Today&apos;s Closed Trades ({todaysClosedTrades.length})
                  </span>
                  <span className="px-1.5 py-0.5 font-mono text-[10px] font-bold bg-blue-700 text-white rounded">
                    TODAY · {todayIst}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-slate-700">
                  <span>
                    W/L:{' '}
                    <strong>
                      {todayBucketStats.wins}W / {todayBucketStats.losses}L
                    </strong>
                  </span>
                  <span
                    className={`font-semibold ${
                      todayBucketStats.pnlInr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    Today P&amp;L: {todayBucketStats.pnlInr >= 0 ? '+' : ''}₹
                    {todayBucketStats.pnlInr.toFixed(2)}
                  </span>
                </div>
              </div>
              {/* Mobile Today Closed Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {todaysClosedTrades.map((t) => {
                  const pos = (t.realizedPnlInr ?? 0) >= 0;
                  return (
                    <div key={`m-today-${t.id}`} className="p-3.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-mono">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol?.(t.symbol)}
                            className="font-bold text-blue-700"
                          >
                            {t.symbol}
                          </button>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {t.strategyTag}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Qty {t.quantity} · ₹{t.entryPrice.toFixed(2)} → ₹{t.exitPrice?.toFixed(2) ?? '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className={`text-right font-mono font-semibold ${pos ? 'text-emerald-700' : 'text-rose-700'}`}>
                          <div>
                            {pos ? '+' : ''}₹{t.realizedPnlInr?.toFixed(2) ?? '—'}
                          </div>
                          <div className="text-[10px]">
                            ({pos ? '+' : ''}
                            {t.realizedPnlPct?.toFixed(2) ?? '—'}%)
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDelete(t.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                    <th className="py-2 px-4">Symbol / Strategy</th>
                    <th className="py-2 px-3">Session</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3 text-right">Entry → Exit</th>
                    <th className="py-2 px-3 text-right">Realized P&amp;L</th>
                    <th className="py-2 px-3 text-right">R-Mult</th>
                    <th className="py-2 px-4 text-right">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {todaysClosedTrades.map((t) => {
                    const pos = (t.realizedPnlInr ?? 0) >= 0;
                    const isCurrent = Boolean(symbol && t.symbol === symbol.toUpperCase());
                    return (
                      <tr
                        key={t.id}
                        className={`hover:bg-slate-50/60 ${isCurrent ? 'bg-blue-50/30' : ''}`}
                      >
                        <td className="py-2 px-4 font-sans">
                          <div className="flex items-center gap-2">
                            {onSelectSymbol ? (
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(t.symbol)}
                                className="font-mono font-bold text-blue-700 hover:underline"
                              >
                                {t.symbol}
                              </button>
                            ) : (
                              <span className="font-mono font-bold text-slate-900">{t.symbol}</span>
                            )}
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                              {t.strategyTag}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {t.entryDate} → {t.exitDate} ({calcHoldDays(t.entryDate, t.exitDate)})
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 rounded">
                            TODAY
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">{t.quantity}</td>
                        <td className="py-2 px-3 text-right">
                          ₹{t.entryPrice.toFixed(2)} → ₹{t.exitPrice?.toFixed(2) ?? '—'}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-semibold ${
                            pos ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {pos ? '+' : ''}₹{t.realizedPnlInr?.toFixed(2) ?? '—'} ({pos ? '+' : ''}
                          {t.realizedPnlPct?.toFixed(2) ?? '—'}%)
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">
                          {t.rMultiple !== null
                            ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R`
                            : '—'}
                        </td>
                        <td className="py-2 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDelete(t.id)}
                            className="p-1 text-slate-400 hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Historical Trades (Memorized Past Closed History) */}
          <div aria-label="Historical Trades">
            <div className="px-5 py-2.5 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <History className="w-3.5 h-3.5 text-slate-700" />
                <span className="font-semibold uppercase tracking-wide text-slate-800">
                  Historical Trades ({filteredHistoricalTrades.length})
                </span>
                <span className="px-1.5 py-0.5 font-mono text-[10px] font-semibold bg-slate-700 text-white rounded">
                  PAST HISTORY
                </span>
                {historyStrategies.length > 1 && (
                  <select
                    value={historyStrategyFilter}
                    onChange={(e) => setHistoryStrategyFilter(e.target.value)}
                    aria-label="Filter Historical Trades by Strategy"
                    className="ml-1 px-2 py-0.5 text-[11px] bg-white border border-slate-300 rounded font-sans text-slate-700"
                  >
                    <option value="ALL">All Strategies</option>
                    {historyStrategies.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {filteredHistoricalTrades.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 font-mono text-slate-700">
                  <span>
                    Win Rate:{' '}
                    <strong>
                      {historicalBucketStats.winRate !== null
                        ? `${historicalBucketStats.winRate.toFixed(1)}%`
                        : '—'}
                    </strong>{' '}
                    ({historicalBucketStats.wins}W/{historicalBucketStats.losses}L)
                  </span>
                  {historicalBucketStats.avgPct !== null && (
                    <span>
                      Avg:{' '}
                      <strong
                        className={
                          historicalBucketStats.avgPct >= 0
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                        }
                      >
                        {historicalBucketStats.avgPct >= 0 ? '+' : ''}
                        {historicalBucketStats.avgPct.toFixed(2)}%
                      </strong>
                    </span>
                  )}
                  <span
                    className={`font-semibold ${
                      historicalBucketStats.pnlInr >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    Hist P&amp;L: {historicalBucketStats.pnlInr >= 0 ? '+' : ''}₹
                    {historicalBucketStats.pnlInr.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {filteredHistoricalTrades.length === 0 ? (
              <div className="px-5 py-4 text-xs text-slate-500">
                No past-date historical closed trades memorized yet. Every trade closed on previous dates stays permanently stored here (separate from Today&apos;s trades) to track strategy performance over time.
              </div>
            ) : (
              <>
              {/* Mobile Historical Trade Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredHistoricalTrades.map((t) => {
                  const pos = (t.realizedPnlInr ?? 0) >= 0;
                  return (
                    <div key={`m-hist-${t.id}`} className="p-3.5 flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol?.(t.symbol)}
                            className="font-bold text-blue-700"
                          >
                            {t.symbol}
                          </button>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {t.strategyTag}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {t.exitDate || '—'} ({calcHoldDays(t.entryDate, t.exitDate)})
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Qty {t.quantity} · ₹{t.entryPrice.toFixed(2)} → ₹{t.exitPrice?.toFixed(2) ?? '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className={`text-right font-mono font-semibold ${pos ? 'text-emerald-700' : 'text-rose-700'}`}>
                          <div>
                            {pos ? '+' : ''}₹{t.realizedPnlInr?.toFixed(2) ?? '—'}
                          </div>
                          <div className="text-[10px]">
                            ({pos ? '+' : ''}
                            {t.realizedPnlPct?.toFixed(2) ?? '—'}%)
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDelete(t.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-500 bg-slate-50/50">
                    <th className="py-2 px-4">Closed Date / Period</th>
                    <th className="py-2 px-3">Symbol / Strategy</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3 text-right">Entry → Exit</th>
                    <th className="py-2 px-3 text-right">Realized P&amp;L</th>
                    <th className="py-2 px-3 text-right">R-Mult</th>
                    <th className="py-2 px-3">Notes</th>
                    <th className="py-2 px-4 text-right">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredHistoricalTrades.map((t) => {
                    const pos = (t.realizedPnlInr ?? 0) >= 0;
                    const isCurrent = Boolean(symbol && t.symbol === symbol.toUpperCase());
                    return (
                      <tr
                        key={t.id}
                        className={`hover:bg-slate-50/60 ${isCurrent ? 'bg-blue-50/30' : ''}`}
                      >
                        <td className="py-2 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-800">
                              {t.exitDate || '—'}
                            </span>
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded">
                              PAST
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            In {t.entryDate} · Hold {calcHoldDays(t.entryDate, t.exitDate)}
                          </div>
                        </td>
                        <td className="py-2 px-3 font-sans">
                          <div className="flex items-center gap-1.5">
                            {onSelectSymbol ? (
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(t.symbol)}
                                className="font-mono font-bold text-blue-700 hover:underline"
                              >
                                {t.symbol}
                              </button>
                            ) : (
                              <span className="font-mono font-bold text-slate-900">{t.symbol}</span>
                            )}
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                              {t.strategyTag}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                            {t.sector}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">{t.quantity}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          ₹{t.entryPrice.toFixed(2)} → ₹{t.exitPrice?.toFixed(2) ?? '—'}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${
                            pos ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {pos ? '+' : ''}₹{t.realizedPnlInr?.toFixed(2) ?? '—'} ({pos ? '+' : ''}
                          {t.realizedPnlPct?.toFixed(2) ?? '—'}%)
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">
                          {t.rMultiple !== null
                            ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R`
                            : '—'}
                        </td>
                        <td
                          className="py-2 px-3 font-sans text-[11px] text-slate-500 max-w-[180px] truncate"
                          title={t.notes}
                        >
                          {t.notes || '—'}
                        </td>
                        <td className="py-2 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDelete(t.id)}
                            className="p-1 text-slate-400 hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
