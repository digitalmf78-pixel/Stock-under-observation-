import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, Edit3, Plus, Trash2, X } from 'lucide-react';
import type {
  TradeJournalAction,
  TradeJournalEntry,
  TradeJournalSentiment,
} from '../types/trading';
import { authFetch } from '../utils/authClient';

interface TradeJournalPanelProps {
  symbol: string;
  latestDate: string;
  currentClose: number;
  suggestedStopLoss: number | null;
  defaultSetupTag?: string;
  onSelectSymbol?: (symbol: string) => void;
}

interface JournalFormState {
  tradeDate: string;
  action: TradeJournalAction;
  sentiment: TradeJournalSentiment;
  setupTag: string;
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  entryExitNotes: string;
  sentimentNotes: string;
  lessonsLearned: string;
}

function emptyForm(
  latestDate: string,
  defaultSetupTag = ''
): JournalFormState {
  return {
    tradeDate: latestDate || new Date().toISOString().slice(0, 10),
    action: 'WATCHING',
    sentiment: 'BULLISH',
    setupTag: defaultSetupTag,
    entryPrice: '',
    exitPrice: '',
    stopLoss: '',
    entryExitNotes: '',
    sentimentNotes: '',
    lessonsLearned: '',
  };
}

export const TradeJournalPanel: React.FC<TradeJournalPanelProps> = ({
  symbol,
  latestDate,
  currentClose,
  suggestedStopLoss,
  defaultSetupTag = '',
  onSelectSymbol,
}) => {
  const [entries, setEntries] = useState<TradeJournalEntry[]>([]);
  const [allEntries, setAllEntries] = useState<TradeJournalEntry[]>([]);
  const [scope, setScope] = useState<'SYMBOL' | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<JournalFormState>(() =>
    emptyForm(latestDate, defaultSetupTag)
  );

  const loadJournal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [symRes, allRes] = await Promise.all([
        fetch(`/api/stock/${encodeURIComponent(symbol)}/journal`),
        fetch('/api/journal'),
      ]);
      const symJson = await symRes.json();
      const allJson = await allRes.json();
      if (!symRes.ok) throw new Error(symJson.error || `HTTP ${symRes.status}`);
      setEntries(Array.isArray(symJson.entries) ? symJson.entries : []);
      setAllEntries(Array.isArray(allJson.entries) ? allJson.entries : []);
    } catch (err) {
      setError((err as Error).message || 'Failed to load trade journal');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    setComposerOpen(false);
    setEditingId(null);
    setConfirmDeleteId(null);
    setForm(emptyForm(latestDate, defaultSetupTag));
    void loadJournal();
  }, [symbol, latestDate, defaultSetupTag, loadJournal]);

  const displayedEntries = scope === 'ALL' ? allEntries : entries;

  const stats = useMemo(() => {
    const list = displayedEntries;
    const closed = list.filter((e) => e.pnlPct !== null);
    const wins = closed.filter((e) => (e.pnlPct ?? 0) > 0).length;
    const avgPnl =
      closed.length > 0
        ? closed.reduce((acc, e) => acc + (e.pnlPct ?? 0), 0) / closed.length
        : null;
    return {
      total: list.length,
      closedCount: closed.length,
      wins,
      avgPnl,
      lessonsCount: list.filter((e) => e.lessonsLearned.trim().length > 0).length,
    };
  }, [displayedEntries]);

  const previewPnlPct = useMemo(() => {
    const ep = Number(form.entryPrice);
    const xp = Number(form.exitPrice);
    if (Number.isFinite(ep) && ep > 0 && Number.isFinite(xp) && xp > 0) {
      return ((xp - ep) / ep) * 100;
    }
    return null;
  }, [form.entryPrice, form.exitPrice]);

  const handlePrefillLiveLevels = () => {
    setForm((prev) => ({
      ...prev,
      entryPrice: currentClose > 0 ? currentClose.toFixed(2) : prev.entryPrice,
      stopLoss:
        suggestedStopLoss !== null && suggestedStopLoss > 0
          ? suggestedStopLoss.toFixed(2)
          : prev.stopLoss,
      tradeDate: latestDate || prev.tradeDate,
    }));
  };

  const handleOpenNew = () => {
    setEditingId(null);
    setError(null);
    setForm(emptyForm(latestDate, defaultSetupTag));
    setComposerOpen(true);
  };

  const handleStartEdit = (entry: TradeJournalEntry) => {
    setEditingId(entry.id);
    setError(null);
    setForm({
      tradeDate: entry.tradeDate,
      action: entry.action,
      sentiment: entry.sentiment,
      setupTag: entry.setupTag,
      entryPrice: entry.entryPrice !== null ? String(entry.entryPrice) : '',
      exitPrice: entry.exitPrice !== null ? String(entry.exitPrice) : '',
      stopLoss: entry.stopLoss !== null ? String(entry.stopLoss) : '',
      entryExitNotes: entry.entryExitNotes,
      sentimentNotes: entry.sentimentNotes,
      lessonsLearned: entry.lessonsLearned,
    });
    setComposerOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const targetSymbol = editingId
        ? displayedEntries.find((x) => x.id === editingId)?.symbol || symbol
        : symbol;
      const url = editingId
        ? `/api/stock/${encodeURIComponent(targetSymbol)}/journal/${encodeURIComponent(editingId)}`
        : `/api/stock/${encodeURIComponent(symbol)}/journal`;
      const method = editingId ? 'PATCH' : 'POST';

      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeDate: form.tradeDate,
          action: form.action,
          sentiment: form.sentiment,
          setupTag: form.setupTag,
          entryPrice: form.entryPrice ? Number(form.entryPrice) : null,
          exitPrice: form.exitPrice ? Number(form.exitPrice) : null,
          stopLoss: form.stopLoss ? Number(form.stopLoss) : null,
          entryExitNotes: form.entryExitNotes,
          sentimentNotes: form.sentimentNotes,
          lessonsLearned: form.lessonsLearned,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setComposerOpen(false);
      setEditingId(null);
      setForm(emptyForm(latestDate, defaultSetupTag));
      await loadJournal();
    } catch (err) {
      setError((err as Error).message || 'Failed to save journal entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: TradeJournalEntry) => {
    setError(null);
    try {
      const res = await authFetch(
        `/api/stock/${encodeURIComponent(entry.symbol)}/journal/${encodeURIComponent(entry.id)}`,
        { method: 'DELETE' }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setConfirmDeleteId(null);
      await loadJournal();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete entry');
    }
  };

  return (
    <section
      aria-label="Trade Journal"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Trade Journal ({scope === 'ALL' ? 'All Stocks' : symbol})
            </h3>
            <span className="text-xs text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-mono text-slate-600 tabular-nums">
              {stats.total} {stats.total === 1 ? 'entry' : 'entries'}
              {stats.closedCount > 0 && (
                <>
                  {' '}
                  · {stats.wins}/{stats.closedCount} closed wins (
                  {stats.avgPnl !== null
                    ? `${stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(1)}% avg`
                    : '—'}
                  )
                </>
              )}
              {stats.lessonsCount > 0 ? ` · ${stats.lessonsCount} lessons logged` : ''}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Record manual entry/exit rationale, sentiment observations, and post-trade lessons learned across sessions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex p-0.5 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setScope('SYMBOL')}
              className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap ${
                scope === 'SYMBOL'
                  ? 'bg-white text-slate-900 font-medium shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {symbol} ({entries.length})
            </button>
            <button
              type="button"
              onClick={() => setScope('ALL')}
              className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap ${
                scope === 'ALL'
                  ? 'bg-white text-slate-900 font-medium shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All History ({allEntries.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => (composerOpen ? setComposerOpen(false) : handleOpenNew())}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {composerOpen ? (
              <>
                <X className="w-3.5 h-3.5" />
                Close Form
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                Log Trade Note
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Entry / Exit & Lessons Composer */}
      {composerOpen && (
        <form
          onSubmit={handleSubmit}
          className="p-5 bg-slate-50/70 border-b border-slate-200 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900">
              {editingId ? 'Update Journal Entry' : `New Journal Entry for ${symbol}`}
            </span>
            <button
              type="button"
              onClick={handlePrefillLiveLevels}
              className="px-2.5 py-1 text-[11px] font-mono font-medium text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded transition-colors"
            >
              Prefill EOD ₹{currentClose.toFixed(2)}
              {suggestedStopLoss ? ` & ATR Stop ₹${suggestedStopLoss.toFixed(2)}` : ''}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Trade Date
              </label>
              <input
                type="date"
                value={form.tradeDate}
                onChange={(e) => setForm((p) => ({ ...p, tradeDate: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Status / Action
              </label>
              <select
                value={form.action}
                onChange={(e) =>
                  setForm((p) => ({ ...p, action: e.target.value as TradeJournalAction }))
                }
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="WATCHING">Watching</option>
                <option value="ENTERED">Entered</option>
                <option value="EXITED">Exited</option>
                <option value="SKIPPED">Skipped</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Sentiment
              </label>
              <select
                value={form.sentiment}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    sentiment: e.target.value as TradeJournalSentiment,
                  }))
                }
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="BULLISH">Bullish</option>
                <option value="NEUTRAL">Neutral</option>
                <option value="BEARISH">Bearish</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Setup Tag
              </label>
              <input
                type="text"
                value={form.setupTag}
                onChange={(e) => setForm((p) => ({ ...p, setupTag: e.target.value }))}
                placeholder="e.g., T1 Breakout / U-Turn"
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Entry Price (₹)
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={form.entryPrice}
                onChange={(e) => setForm((p) => ({ ...p, entryPrice: e.target.value }))}
                placeholder="Optional"
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Exit Price (₹)
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={form.exitPrice}
                onChange={(e) => setForm((p) => ({ ...p, exitPrice: e.target.value }))}
                placeholder="Optional"
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Stop Loss (₹)
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={form.stopLoss}
                onChange={(e) => setForm((p) => ({ ...p, stopLoss: e.target.value }))}
                placeholder="Optional"
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Entry / Exit Notes
              </label>
              <textarea
                rows={3}
                value={form.entryExitNotes}
                onChange={(e) => setForm((p) => ({ ...p, entryExitNotes: e.target.value }))}
                placeholder="Why entering/exiting here? Volume, delivery %, U-Turn trigger, target/stop plan..."
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Sentiment Observations
              </label>
              <textarea
                rows={3}
                value={form.sentimentNotes}
                onChange={(e) => setForm((p) => ({ ...p, sentimentNotes: e.target.value }))}
                placeholder="Sector rotation, institutional delivery flow, news/bulk deal reaction..."
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Lessons Learned
              </label>
              <textarea
                rows={3}
                value={form.lessonsLearned}
                onChange={(e) => setForm((p) => ({ ...p, lessonsLearned: e.target.value }))}
                placeholder="What worked, mistakes to avoid, discipline/sizing takeaways..."
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-mono text-slate-600">
              {previewPnlPct !== null ? (
                <span>
                  Computed Trade Return:{' '}
                  <strong
                    className={
                      previewPnlPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }
                  >
                    {previewPnlPct >= 0 ? '+' : ''}
                    {previewPnlPct.toFixed(2)}%
                  </strong>
                </span>
              ) : (
                <span className="text-slate-500">
                  Fill at least one note field to save entry.
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setComposerOpen(false);
                  setEditingId(null);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Save Journal Entry'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Recorded Entries List */}
      <div className="divide-y divide-slate-100">
        {loading ? (
          <div className="p-6 text-xs text-slate-500">Loading trade journal...</div>
        ) : displayedEntries.length === 0 ? (
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
            <span>
              No manual journal notes logged {scope === 'SYMBOL' ? `for ${symbol}` : 'yet'}. Record your entry/exit plan, sentiment read, and post-trade lessons to build your trading history.
            </span>
            {!composerOpen && (
              <button
                type="button"
                onClick={handleOpenNew}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Add First Note
              </button>
            )}
          </div>
        ) : (
          displayedEntries.map((entry) => {
            const actionTone =
              entry.action === 'ENTERED'
                ? 'text-blue-700'
                : entry.action === 'EXITED'
                  ? 'text-emerald-700'
                  : entry.action === 'SKIPPED'
                    ? 'text-slate-500'
                    : 'text-amber-700';
            const sentimentTone =
              entry.sentiment === 'BULLISH'
                ? 'text-emerald-700'
                : entry.sentiment === 'BEARISH'
                  ? 'text-rose-700'
                  : 'text-slate-600';

            return (
              <article key={entry.id} className="p-5 space-y-3 hover:bg-slate-50/40 transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                    {scope === 'ALL' && (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectSymbol?.(entry.symbol)}
                          className="font-bold text-blue-700 hover:underline"
                        >
                          {entry.symbol}
                        </button>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                      </>
                    )}
                    <span className="font-semibold text-slate-900">{entry.tradeDate}</span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className={`font-semibold ${actionTone}`}>{entry.action}</span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className={`font-semibold ${sentimentTone}`}>{entry.sentiment}</span>
                    {entry.setupTag && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-700">{entry.setupTag}</span>
                      </>
                    )}
                    {(entry.entryPrice !== null || entry.exitPrice !== null || entry.stopLoss !== null) && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-700 tabular-nums">
                          {entry.entryPrice !== null ? `In ₹${entry.entryPrice.toFixed(2)}` : ''}
                          {entry.exitPrice !== null ? ` → Out ₹${entry.exitPrice.toFixed(2)}` : ''}
                          {entry.stopLoss !== null ? ` (SL ₹${entry.stopLoss.toFixed(2)})` : ''}
                        </span>
                      </>
                    )}
                    {entry.pnlPct !== null && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`font-bold tabular-nums ${
                            entry.pnlPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {entry.pnlPct >= 0 ? '+' : ''}
                          {entry.pnlPct.toFixed(2)}%
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(entry)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                    >
                      <Edit3 className="w-3 h-3" />
                      Edit
                    </button>

                    {confirmDeleteId === entry.id ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          className="px-2 py-1 text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(entry.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="bg-slate-50 border border-slate-100 rounded p-3">
                    <div className="text-[11px] font-semibold text-slate-700 mb-1">
                      Entry / Exit Notes
                    </div>
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {entry.entryExitNotes || '—'}
                    </p>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded p-3">
                    <div className="text-[11px] font-semibold text-slate-700 mb-1">
                      Sentiment Observations
                    </div>
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {entry.sentimentNotes || '—'}
                    </p>
                  </div>

                  <div className="bg-amber-50/50 border border-amber-100 rounded p-3">
                    <div className="text-[11px] font-semibold text-amber-900 mb-1">
                      Lessons Learned
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {entry.lessonsLearned || '—'}
                    </p>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};
