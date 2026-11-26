import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Grid, Layers } from 'lucide-react';
import type {
  MarketSentiment,
  ScreenerFilterPatch,
  SectorSentimentItem,
} from '../types/trading';

interface EmaTrendHeatmapProps {
  marketSentiment: MarketSentiment;
  sectors: SectorSentimentItem[];
  latestSessionDate: string;
  onSelectSector: (sector: string) => void;
  onOpenEmaFilter?: (patch: ScreenerFilterPatch) => void;
}

type HeatmapFilter = 'ALL' | 'BULLISH' | 'NEUTRAL' | 'WEAK';
type HeatmapSortKey = 'COMPOSITE' | 'EMA21' | 'EMA44' | 'EMA200' | 'STACK21_44';

interface HeatTone {
  cellClass: string;
  label: string;
}

function getHeatmapTone(pct: number | null | undefined): HeatTone {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return {
      cellClass: 'bg-slate-100 text-slate-500 border-slate-200',
      label: 'N/A',
    };
  }
  if (pct >= 75) {
    return {
      cellClass: 'bg-emerald-700 text-white border-emerald-800',
      label: 'Strong',
    };
  }
  if (pct >= 60) {
    return {
      cellClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      label: 'Bull',
    };
  }
  if (pct >= 45) {
    return {
      cellClass: 'bg-sky-50 text-sky-900 border-sky-200',
      label: 'Mixed',
    };
  }
  if (pct >= 30) {
    return {
      cellClass: 'bg-amber-100 text-amber-900 border-amber-300',
      label: 'Soft',
    };
  }
  return {
    cellClass: 'bg-rose-100 text-rose-900 border-rose-300',
    label: 'Weak',
  };
}

function computeComposite(sec: SectorSentimentItem): number {
  if (typeof sec.emaTrendCompositePct === 'number' && Number.isFinite(sec.emaTrendCompositePct)) {
    return sec.emaTrendCompositePct;
  }
  const parts: number[] = [sec.aboveEma21Pct];
  if (typeof sec.aboveEma44Pct === 'number' && Number.isFinite(sec.aboveEma44Pct)) {
    parts.push(sec.aboveEma44Pct);
  }
  if (typeof sec.ema21Above44Pct === 'number' && Number.isFinite(sec.ema21Above44Pct)) {
    parts.push(sec.ema21Above44Pct);
  }
  if (sec.aboveEma200Pct !== null && sec.aboveEma200Pct !== undefined) {
    parts.push(sec.aboveEma200Pct);
  }
  return Number((parts.reduce((a, b) => a + b, 0) / parts.length).toFixed(1));
}

export const EmaTrendHeatmap: React.FC<EmaTrendHeatmapProps> = ({
  marketSentiment,
  sectors,
  latestSessionDate,
  onSelectSector,
  onOpenEmaFilter,
}) => {
  const [filterBand, setFilterBand] = useState<HeatmapFilter>('ALL');
  const [sortBy, setSortBy] = useState<HeatmapSortKey>('COMPOSITE');
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  const enrichedSectors = useMemo(() => {
    return sectors.map((sec) => {
      const ema21Pct = sec.aboveEma21Pct;
      const ema44Pct = sec.aboveEma44Pct ?? 0;
      const ema200Pct = sec.aboveEma200Pct ?? null;
      const stackPct = sec.ema21Above44Pct ?? 0;
      const compositePct = computeComposite(sec);
      return {
        ...sec,
        ema21Pct,
        ema44Pct,
        ema200Pct,
        stackPct,
        compositePct,
      };
    });
  }, [sectors]);

  const countsByBand = useMemo(() => {
    let bullish = 0;
    let neutral = 0;
    let weak = 0;
    for (const s of enrichedSectors) {
      if (s.compositePct >= 55) bullish++;
      else if (s.compositePct >= 40) neutral++;
      else weak++;
    }
    return { bullish, neutral, weak };
  }, [enrichedSectors]);

  const visibleSectors = useMemo(() => {
    const filtered = enrichedSectors.filter((s) => {
      if (filterBand === 'BULLISH') return s.compositePct >= 55;
      if (filterBand === 'NEUTRAL') return s.compositePct >= 40 && s.compositePct < 55;
      if (filterBand === 'WEAK') return s.compositePct < 40;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'EMA21') return b.ema21Pct - a.ema21Pct;
      if (sortBy === 'EMA44') return b.ema44Pct - a.ema44Pct;
      if (sortBy === 'EMA200') {
        const av = a.ema200Pct ?? -1;
        const bv = b.ema200Pct ?? -1;
        return bv - av;
      }
      if (sortBy === 'STACK21_44') return b.stackPct - a.stackPct;
      return b.compositePct - a.compositePct;
    });
  }, [enrichedSectors, filterBand, sortBy]);

  const activeInspect = useMemo(() => {
    if (visibleSectors.length === 0) return null;
    if (hoveredSector) {
      return visibleSectors.find((s) => s.sector === hoveredSector) ?? visibleSectors[0];
    }
    return visibleSectors[0];
  }, [visibleSectors, hoveredSector]);

  if (!sectors || sectors.length === 0) {
    return null;
  }

  const m21Tone = getHeatmapTone(marketSentiment.aboveEma21Pct);
  const m44Tone = getHeatmapTone(marketSentiment.aboveEma44Pct ?? null);
  const m200Tone = getHeatmapTone(marketSentiment.aboveEma200Pct);
  const mStackTone = getHeatmapTone(marketSentiment.aboveEma21And44Pct ?? null);

  return (
    <section
      aria-label="EMA 21 44 200 Sector Trend Heatmap"
      className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
    >
      {/* Header + Market State Summary */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Grid className="w-4 h-4 text-blue-700 shrink-0" />
            EMA 21 / 44 / 200 Sector Trend Heatmap
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregate sector participation above 21-EMA, 44-EMA, and 200-EMA plus 21&gt;44 bullish trend stack ({latestSessionDate}) · Click any sector to inspect in Screener
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono shrink-0">
          <span
            className={`px-2.5 py-1 rounded border font-semibold ${
              marketSentiment.status === 'BULLISH'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : marketSentiment.status === 'BEARISH'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            Market: {marketSentiment.status} ({marketSentiment.score}/100)
          </span>
          <span className="text-slate-500" title="Daily Advancing vs Declining ratio across all stocks">
            Daily A/D {marketSentiment.breadthPct.toFixed(1)}% ({marketSentiment.advancers}↑/{marketSentiment.decliners}↓)
          </span>
        </div>
      </div>

      {/* Market-Wide EMA State Tiles (Driven directly from marketSentiment) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
        <div
          className={`rounded-md border px-3 py-2 ${m21Tone.cellClass}`}
          title={
            marketSentiment.ema21EligibleCount !== undefined
              ? `${marketSentiment.aboveEma21Count ?? 0} / ${marketSentiment.ema21EligibleCount} eligible stocks above EMA 21`
              : undefined
          }
        >
          <div className="text-[11px] opacity-85 font-medium">Market &gt; EMA 21</div>
          <div className="mt-0.5 flex items-baseline justify-between font-mono font-bold tabular-nums">
            <span className="text-base">{marketSentiment.aboveEma21Pct.toFixed(1)}%</span>
            <span className="text-[10px] font-semibold">
              {marketSentiment.ema21EligibleCount
                ? `${marketSentiment.aboveEma21Count ?? 0}/${marketSentiment.ema21EligibleCount}`
                : m21Tone.label}
            </span>
          </div>
        </div>

        <div
          className={`rounded-md border px-3 py-2 ${m44Tone.cellClass}`}
          title={
            marketSentiment.ema44EligibleCount !== undefined
              ? `${marketSentiment.aboveEma44Count ?? 0} / ${marketSentiment.ema44EligibleCount} eligible stocks above EMA 44`
              : undefined
          }
        >
          <div className="text-[11px] opacity-85 font-medium">Market &gt; EMA 44</div>
          <div className="mt-0.5 flex items-baseline justify-between font-mono font-bold tabular-nums">
            <span className="text-base">
              {marketSentiment.aboveEma44Pct !== undefined
                ? `${marketSentiment.aboveEma44Pct.toFixed(1)}%`
                : 'N/A'}
            </span>
            <span className="text-[10px] font-semibold">
              {marketSentiment.ema44EligibleCount
                ? `${marketSentiment.aboveEma44Count ?? 0}/${marketSentiment.ema44EligibleCount}`
                : m44Tone.label}
            </span>
          </div>
        </div>

        <div
          className={`rounded-md border px-3 py-2 ${m200Tone.cellClass}`}
          title={
            marketSentiment.ema200SampleCount
              ? `${marketSentiment.aboveEma200Count ?? 0} / ${marketSentiment.ema200SampleCount} stocks with >=200D OHLCV history above EMA 200`
              : 'Requires 200D OHLCV cache from Bot Scan / Deep-Dive'
          }
        >
          <div className="text-[11px] opacity-85 font-medium">Market &gt; EMA 200</div>
          <div className="mt-0.5 flex items-baseline justify-between font-mono font-bold tabular-nums">
            <span className="text-base">
              {marketSentiment.aboveEma200Pct !== null && marketSentiment.aboveEma200Pct !== undefined
                ? `${marketSentiment.aboveEma200Pct.toFixed(1)}%`
                : 'N/A'}
            </span>
            <span className="text-[10px] font-semibold">
              {marketSentiment.ema200SampleCount
                ? `${marketSentiment.aboveEma200Count ?? 0}/${marketSentiment.ema200SampleCount}`
                : '<200D'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            onOpenEmaFilter?.({ delivery: 'ALL', liquidity: 'PASS', emaCross: 'BULLISH_ALIGNED' })
          }
          className={`text-left rounded-md border px-3 py-2 transition-opacity hover:opacity-90 ${mStackTone.cellClass}`}
          title={
            marketSentiment.ema21And44EligibleCount
              ? `${marketSentiment.aboveEma21And44Count ?? 0} / ${marketSentiment.ema21And44EligibleCount} eligible stocks with EMA 21 > EMA 44`
              : undefined
          }
        >
          <div className="text-[11px] opacity-85 font-medium flex items-center justify-between">
            <span>EMA 21 &gt; 44</span>
            <ArrowUpRight className="w-3 h-3 opacity-80" />
          </div>
          <div className="mt-0.5 flex items-baseline justify-between font-mono font-bold tabular-nums">
            <span className="text-base">
              {(marketSentiment.aboveEma21And44Pct ?? 0).toFixed(1)}%
            </span>
            <span className="text-[10px] font-semibold">
              {marketSentiment.ema21And44EligibleCount
                ? `${marketSentiment.aboveEma21And44Count ?? 0}/${marketSentiment.ema21And44EligibleCount}`
                : mStackTone.label}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onOpenEmaFilter?.({ delivery: 'ALL', liquidity: 'ALL', emaCross: 'RECENT_CROSS' })
          }
          className="text-left rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900 px-3 py-2 transition-colors"
        >
          <div className="text-[11px] text-slate-600 font-medium flex items-center justify-between">
            <span>5D 21×44 Crosses</span>
            <ArrowUpRight className="w-3 h-3 text-slate-500" />
          </div>
          <div className="mt-0.5 flex items-baseline justify-between font-mono font-bold tabular-nums">
            <span className="text-base text-emerald-700">
              {marketSentiment.emaCrossBullishCount ?? 0}
            </span>
            <span className="text-[10px] font-semibold text-slate-500">Fresh Bull</span>
          </div>
        </button>
      </div>

      {/* Filter & Sort Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md text-xs self-start">
          {(
            [
              ['ALL', `All (${enrichedSectors.length})`],
              ['BULLISH', `Bullish >=55% (${countsByBand.bullish})`],
              ['NEUTRAL', `Neutral 40–54% (${countsByBand.neutral})`],
              ['WEAK', `Weak <40% (${countsByBand.weak})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterBand(key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                filterBand === key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 font-medium inline-flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" />
            Sort:
          </span>
          {(
            [
              ['COMPOSITE', 'Composite'],
              ['EMA21', 'EMA 21'],
              ['EMA44', 'EMA 44'],
              ['EMA200', 'EMA 200'],
              ['STACK21_44', '21 > 44'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              className={`px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap ${
                sortBy === key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Hovered Sector Summary Strip */}
      {activeInspect && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-slate-50 border border-slate-200/80 rounded-md text-xs font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-3 text-slate-700">
            <span className="font-sans font-semibold text-slate-900">{activeInspect.sector}</span>
            <span title="Advancing vs declining stocks within this sector">
              Breadth {activeInspect.breadthPct.toFixed(0)}% ({activeInspect.advancers}↑/{activeInspect.decliners}↓)
            </span>
            <span>Avg Deliv {activeInspect.avgDeliveryPct.toFixed(1)}%</span>
            <span
              className={
                (activeInspect.avg5dReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }
            >
              5D Ret{' '}
              {activeInspect.avg5dReturnPct !== null
                ? `${activeInspect.avg5dReturnPct >= 0 ? '+' : ''}${activeInspect.avg5dReturnPct.toFixed(2)}%`
                : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            <span>
              T1+T2 Setups:{' '}
              <strong className="text-blue-700">
                {activeInspect.tier1Count + activeInspect.tier2Count}
              </strong>
            </span>
            <span>
              5D 21×44 Cross:{' '}
              <strong className="text-emerald-700">{activeInspect.ema21Cross44Count ?? 0}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Color-Coded Sector Matrix Heatmap */}
      {visibleSectors.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md">
          No sectors match the selected trend band filter. Switch back to &ldquo;All&rdquo; to view the full heatmap.
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-md">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <th className="py-2.5 px-3.5 min-w-[190px]">Sector (Count · Regime)</th>
                <th className="py-2.5 px-2 text-center min-w-[105px]">EMA 21</th>
                <th className="py-2.5 px-2 text-center min-w-[105px]">EMA 44</th>
                <th className="py-2.5 px-2 text-center min-w-[115px]">EMA 200</th>
                <th className="py-2.5 px-2 text-center min-w-[115px]">21 &gt; 44 Stack</th>
                <th className="py-2.5 px-2 text-center min-w-[110px]">Trend Composite</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSectors.map((sec) => {
                const t21 = getHeatmapTone(sec.ema21Pct);
                const t44 = getHeatmapTone(sec.ema44Pct);
                const t200 = getHeatmapTone(sec.ema200Pct);
                const tStack = getHeatmapTone(sec.stackPct);
                const tComp = getHeatmapTone(sec.compositePct);

                const ema21Den = sec.ema21EligibleCount ?? 0;
                const ema21Num = Math.min(sec.aboveEma21Count ?? 0, ema21Den);
                const ema44Den = sec.ema44EligibleCount ?? 0;
                const ema44Num = Math.min(sec.aboveEma44Count ?? 0, ema44Den);
                const ema200Den = sec.ema200SampleCount ?? 0;
                const ema200Num = Math.min(sec.aboveEma200Count ?? 0, ema200Den);

                return (
                  <tr
                    key={sec.sector}
                    onMouseEnter={() => setHoveredSector(sec.sector)}
                    onClick={() => onSelectSector(sec.sector)}
                    className="hover:bg-slate-50/90 cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate max-w-[170px]">
                          {sec.sector}
                        </span>
                        <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 mt-0.5">
                        <span>{sec.stockCount} stk</span>
                        <span>·</span>
                        <span
                          className={
                            sec.regime === 'LEADING'
                              ? 'text-emerald-700 font-semibold'
                              : sec.regime === 'IMPROVING'
                                ? 'text-blue-700 font-medium'
                                : sec.regime === 'NEUTRAL'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                          }
                        >
                          {sec.regime}
                        </span>
                      </div>
                    </td>

                    {/* EMA 21 Cell */}
                    <td className="p-1.5">
                      <div
                        title={
                          ema21Den > 0
                            ? `${ema21Num}/${ema21Den} eligible stocks above EMA 21`
                            : undefined
                        }
                        className={`rounded border px-2 py-1.5 text-center font-mono tabular-nums ${t21.cellClass}`}
                      >
                        <div className="font-bold text-xs">{sec.ema21Pct.toFixed(1)}%</div>
                        <div className="text-[10px] opacity-85">
                          {ema21Den > 0 ? `${ema21Num}/${ema21Den}` : t21.label}
                        </div>
                      </div>
                    </td>

                    {/* EMA 44 Cell */}
                    <td className="p-1.5">
                      <div
                        title={
                          ema44Den > 0
                            ? `${ema44Num}/${ema44Den} eligible stocks above EMA 44`
                            : undefined
                        }
                        className={`rounded border px-2 py-1.5 text-center font-mono tabular-nums ${t44.cellClass}`}
                      >
                        <div className="font-bold text-xs">{sec.ema44Pct.toFixed(1)}%</div>
                        <div className="text-[10px] opacity-85">
                          {ema44Den > 0 ? `${ema44Num}/${ema44Den}` : t44.label}
                        </div>
                      </div>
                    </td>

                    {/* EMA 200 Cell */}
                    <td className="p-1.5">
                      <div
                        title={
                          ema200Den > 0
                            ? `${ema200Num}/${ema200Den} stock(s) in ${sec.sector} with 200D OHLCV history above EMA 200`
                            : `No 200D OHLCV history cached yet for ${sec.sector}`
                        }
                        className={`rounded border px-2 py-1.5 text-center font-mono tabular-nums ${t200.cellClass}`}
                      >
                        <div className="font-bold text-xs">
                          {sec.ema200Pct !== null ? `${sec.ema200Pct.toFixed(1)}%` : '—'}
                        </div>
                        <div className="text-[10px] opacity-85">
                          {ema200Den > 0 ? `${ema200Num}/${ema200Den}` : '<200D'}
                        </div>
                      </div>
                    </td>

                    {/* EMA 21 > 44 Stack Cell */}
                    <td className="p-1.5">
                      <div
                        className={`rounded border px-2 py-1.5 text-center font-mono tabular-nums ${tStack.cellClass}`}
                      >
                        <div className="font-bold text-xs">{sec.stackPct.toFixed(1)}%</div>
                        <div className="text-[10px] opacity-85">
                          {sec.ema21Cross44Count ? `+${sec.ema21Cross44Count} ×5D` : tStack.label}
                        </div>
                      </div>
                    </td>

                    {/* Composite Trend Strength Cell */}
                    <td className="p-1.5">
                      <div
                        className={`rounded border px-2 py-1.5 text-center font-mono tabular-nums ${tComp.cellClass}`}
                      >
                        <div className="font-bold text-xs">{sec.compositePct.toFixed(1)}%</div>
                        <div className="text-[10px] opacity-85">{tComp.label}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Intensity Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 pt-1">
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className="font-sans font-medium text-slate-500">Heatmap Scale:</span>
          <span className="px-2 py-0.5 rounded border bg-emerald-700 text-white border-emerald-800">
            &ge;75% Strong
          </span>
          <span className="px-2 py-0.5 rounded border bg-emerald-100 text-emerald-900 border-emerald-300">
            60–74% Bull
          </span>
          <span className="px-2 py-0.5 rounded border bg-sky-50 text-sky-900 border-sky-200">
            45–59% Mixed
          </span>
          <span className="px-2 py-0.5 rounded border bg-amber-100 text-amber-900 border-amber-300">
            30–44% Soft
          </span>
          <span className="px-2 py-0.5 rounded border bg-rose-100 text-rose-900 border-rose-300">
            &lt;30% Weak
          </span>
          <span className="px-2 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-200">
            &lt;200D No Cache
          </span>
        </div>
        <span className="font-mono text-slate-400">
          {visibleSectors.length} sectors shown
        </span>
      </div>
    </section>
  );
};
