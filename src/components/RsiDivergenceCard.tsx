import React, { useMemo, useState } from 'react';
import { Activity, Eye, TrendingDown, TrendingUp } from 'lucide-react';
import type {
  RsiDivergenceAnalysis,
  RsiDivergenceCategory,
  RsiDivergenceSignal,
} from '../utils/rsiDivergence';

interface RsiDivergenceCardProps {
  symbol: string;
  analysis: RsiDivergenceAnalysis;
  selectedDivergenceId: string | null;
  onInspectDivergence: (signal: RsiDivergenceSignal) => void;
}

type CategoryFilter = 'ALL' | RsiDivergenceCategory;

export const RsiDivergenceCard: React.FC<RsiDivergenceCardProps> = ({
  symbol,
  analysis,
  selectedDivergenceId,
  onInspectDivergence,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');

  const counts = useMemo(() => {
    let regularBull = 0;
    let regularBear = 0;
    let hiddenBull = 0;
    let hiddenBear = 0;
    for (const d of analysis.divergences) {
      if (d.kind === 'REGULAR_BULLISH') regularBull++;
      else if (d.kind === 'REGULAR_BEARISH') regularBear++;
      else if (d.kind === 'HIDDEN_BULLISH') hiddenBull++;
      else if (d.kind === 'HIDDEN_BEARISH') hiddenBear++;
    }
    return {
      regularBull,
      regularBear,
      hiddenBull,
      hiddenBear,
      total: analysis.divergences.length,
    };
  }, [analysis.divergences]);

  const visibleDivergences = useMemo(() => {
    if (categoryFilter === 'ALL') return analysis.divergences;
    return analysis.divergences.filter((d) => d.category === categoryFilter);
  }, [analysis.divergences, categoryFilter]);

  const rsiZoneLabel =
    analysis.latestRsi === null
      ? 'Warm-up'
      : analysis.latestRsi >= 70
        ? 'Overbought (>=70)'
        : analysis.latestRsi <= 30
          ? 'Oversold (<=30)'
          : analysis.latestRsi >= 55
            ? 'Bullish Zone'
            : analysis.latestRsi <= 45
              ? 'Weak Zone'
              : 'Neutral';

  const rsiBadgeClass =
    analysis.latestRsi === null
      ? 'bg-slate-100 text-slate-600 border-slate-200'
      : analysis.latestRsi >= 70
        ? 'bg-rose-50 text-rose-800 border-rose-200'
        : analysis.latestRsi <= 30
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : 'bg-blue-50 text-blue-800 border-blue-200';

  return (
    <section
      id="rsi-divergence-section"
      aria-label="Automated RSI Divergence Detection Engine"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/70">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="w-4 h-4 text-blue-700 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900">
              Automated RSI(14) Divergence Detection Engine
            </h3>
            <span
              className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${rsiBadgeClass}`}
            >
              RSI(14): {analysis.latestRsi !== null ? analysis.latestRsi.toFixed(1) : '—'} · {rsiZoneLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Scans {symbol} swing highs/lows using Wilder&apos;s RSI(14) to label Regular Reversal (LL Price + HL RSI / HH Price + LH RSI) &amp; Hidden Continuation divergences
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs">
            {(
              [
                ['ALL', `All (${counts.total})`],
                ['REGULAR', `Regular (${counts.regularBull + counts.regularBear})`],
                ['HIDDEN', `Hidden (${counts.hiddenBull + counts.hiddenBear})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategoryFilter(key)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  categoryFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-3.5 border-b border-slate-100 text-xs font-mono">
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2">
          <div className="font-sans text-[11px] text-emerald-800 font-medium">
            Regular Bullish (Reversal)
          </div>
          <div className="text-base font-bold text-emerald-700 mt-0.5 tabular-nums">
            {counts.regularBull}
          </div>
          <div className="text-[10px] text-emerald-700/80">Price LL · RSI HL</div>
        </div>

        <div className="rounded-md border border-rose-200 bg-rose-50/40 px-3 py-2">
          <div className="font-sans text-[11px] text-rose-800 font-medium">
            Regular Bearish (Reversal)
          </div>
          <div className="text-base font-bold text-rose-700 mt-0.5 tabular-nums">
            {counts.regularBear}
          </div>
          <div className="text-[10px] text-rose-700/80">Price HH · RSI LH</div>
        </div>

        <div className="rounded-md border border-sky-200 bg-sky-50/40 px-3 py-2">
          <div className="font-sans text-[11px] text-sky-800 font-medium">
            Hidden Bullish (Trend)
          </div>
          <div className="text-base font-bold text-sky-700 mt-0.5 tabular-nums">
            {counts.hiddenBull}
          </div>
          <div className="text-[10px] text-sky-700/80">Price HL · RSI LL</div>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2">
          <div className="font-sans text-[11px] text-amber-800 font-medium">
            Hidden Bearish (Trend)
          </div>
          <div className="text-base font-bold text-amber-700 mt-0.5 tabular-nums">
            {counts.hiddenBear}
          </div>
          <div className="text-[10px] text-amber-700/80">Price LH · RSI HH</div>
        </div>
      </div>

      {analysis.insufficientData ? (
        <div className="p-5 text-xs text-slate-500">
          Needs at least 20 sessions of valid OHLC history after RSI(14) warm-up to detect swing pivot divergences.
        </div>
      ) : visibleDivergences.length === 0 ? (
        <div className="p-5 text-xs text-slate-500">
          No {categoryFilter === 'ALL' ? '' : `${categoryFilter.toLowerCase()} `}RSI(14) divergences detected across the loaded {symbol} sessions ({analysis.swingHighs.length} swing highs, {analysis.swingLows.length} swing lows evaluated).
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-4">Divergence Signal</th>
                <th className="py-2.5 px-3">Pivot Window</th>
                <th className="py-2.5 px-3 text-right">Price Swing</th>
                <th className="py-2.5 px-3 text-right">RSI(14) Swing</th>
                <th className="py-2.5 px-3 text-center">Strength</th>
                <th className="py-2.5 px-4 text-right">Chart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDivergences.map((sig) => {
                const isBull = sig.polarity === 'BULLISH';
                const isSelected = selectedDivergenceId === sig.id;
                const badgeClass =
                  sig.kind === 'REGULAR_BULLISH'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : sig.kind === 'REGULAR_BEARISH'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : sig.kind === 'HIDDEN_BULLISH'
                        ? 'bg-sky-50 text-sky-800 border-sky-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200';

                return (
                  <tr
                    key={sig.id}
                    onClick={() => onInspectDivergence(sig)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${badgeClass}`}
                        >
                          {isBull ? (
                            <TrendingUp className="w-3 h-3 shrink-0" />
                          ) : (
                            <TrendingDown className="w-3 h-3 shrink-0" />
                          )}
                          {sig.label}
                        </span>
                        {sig.isRecent && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-900 text-white rounded">
                            RECENT ({sig.barsSinceEnd}d ago)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">{sig.description}</div>
                    </td>

                    <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                      <div>
                        {sig.from.date} → {sig.to.date}
                      </div>
                      <div className="text-[10px] text-slate-400">{sig.barsApart} sessions apart</div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-slate-900 font-medium">
                        ₹{sig.from.price.toFixed(1)} → ₹{sig.to.price.toFixed(1)}
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          sig.priceDeltaPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {sig.priceDeltaPct >= 0 ? '+' : ''}
                        {sig.priceDeltaPct.toFixed(2)}%
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-slate-900 font-medium">
                        {sig.from.rsi.toFixed(1)} → {sig.to.rsi.toFixed(1)}
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          sig.rsiDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {sig.rsiDelta >= 0 ? '+' : ''}
                        {sig.rsiDelta.toFixed(1)} pts
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-center font-mono">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                          sig.strength === 'STRONG'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {sig.strength}
                      </span>
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectDivergence(sig);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors whitespace-nowrap"
                      >
                        <Eye className="w-3 h-3" />
                        Plot
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
